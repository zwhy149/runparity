import { type ProcessController, runSupervisedProcess } from "../supervised-process.js";
import { joinRemoteArgv } from "./remote-command.js";

/**
 * Production transport for the qualified Linux backend: a supervised SSH
 * client with a frozen environment, one absolute monotonic deadline per
 * command, and bounded output decoding.
 *
 * Containment note (honest boundary): the host-side `ssh` client is a thin
 * network process; its cleanup remains branded by the shared supervisor
 * exactly as observed (`uncontained_host`, `best_effort`). No evidence rule
 * in this repository derives safety from that host cleanup. Backend safety
 * and containment are demonstrated remotely and observationally inside the
 * backend VM (privilege probes, write-escape probes, post-destroy liveness),
 * which is strictly stronger than trusting host-side process-tree cleanup.
 */

export const BACKEND_TRANSPORT_MAX_STREAM_BYTES = 64 * 1024;

export type BackendTransportCommand = Readonly<{
  args: readonly string[];
  deadlineNanoseconds: bigint;
}>;

export type BackendTransportCompletion =
  | Readonly<{
      kind: "completed";
      exitCode: number;
      stdout: string;
      stderr: string;
      durationMs: number;
      cleanupStatus: "not_required" | "best_effort" | "verified" | "failed";
    }>
  | Readonly<{
      kind: "refused";
      reasonCode:
        | "RP_BACKEND_TRANSPORT_DEADLINE_BEFORE_LAUNCH"
        | "RP_BACKEND_TRANSPORT_DEADLINE_DURING_EXECUTION"
        | "RP_BACKEND_TRANSPORT_TERMINATED_BY_SIGNAL"
        | "RP_BACKEND_TRANSPORT_SUPERVISION_FAILED"
        | "RP_BACKEND_TRANSPORT_STREAM_INCOMPLETE"
        | "RP_BACKEND_TRANSPORT_INVALID_OUTPUT";
      detail: string;
    }>;

export type BackendTransport = Readonly<{
  run(command: BackendTransportCommand): Promise<BackendTransportCompletion>;
}>;

export type SshBackendTransportConfig = Readonly<{
  sshExecutablePath: string;
  host: string;
  port: number;
  user: string;
  identityFile: string;
  knownHostsFile: string;
  connectTimeoutSeconds: number;
  workingDirectory: string;
}>;

const WINDOWS_ENV_KEYS = [
  "SystemRoot",
  "ComSpec",
  "SystemDrive",
  "PROGRAMDATA",
  "ALLUSERSPROFILE",
] as const;

function frozenSshEnvironment(): Readonly<NodeJS.ProcessEnv> {
  if (process.platform !== "win32") {
    return Object.freeze({});
  }
  const environment: Record<string, string> = {};
  for (const key of WINDOWS_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) {
      environment[key] = value;
    }
  }
  if (environment["SystemRoot"] === undefined || environment["PROGRAMDATA"] === undefined) {
    throw new Error(
      "RP_BACKEND_TRANSPORT_CONFIG_INVALID: SystemRoot and PROGRAMDATA are required on win32 (ssh.exe resolves its system configuration path from PROGRAMDATA even under -F NUL)",
    );
  }
  return Object.freeze(environment);
}

function strictUtf8(buffer: Buffer): string | null {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    for (const character of decoded) {
      const code = character.codePointAt(0);
      if (code === undefined || code === 0) {
        return null;
      }
    }
    return decoded;
  } catch {
    return null;
  }
}

export function createSshBackendTransport(
  config: SshBackendTransportConfig,
  controller: ProcessController,
): BackendTransport {
  if (!Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error("RP_BACKEND_TRANSPORT_CONFIG_INVALID: port");
  }
  if (
    !Number.isSafeInteger(config.connectTimeoutSeconds) ||
    config.connectTimeoutSeconds < 1 ||
    config.connectTimeoutSeconds > 30
  ) {
    throw new Error("RP_BACKEND_TRANSPORT_CONFIG_INVALID: connect timeout");
  }
  const nullConfig = process.platform === "win32" ? "NUL" : "/dev/null";
  const destination = `${config.user}@${config.host}`;
  const baseArgs: readonly string[] = [
    "-F",
    nullConfig,
    "-i",
    config.identityFile,
    "-p",
    String(config.port),
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${config.knownHostsFile}`,
    "-o",
    `ConnectTimeout=${config.connectTimeoutSeconds}`,
    "-o",
    "ClearAllForwardings=yes",
    "-o",
    "LogLevel=ERROR",
    "-T",
    destination,
  ];
  const environment = frozenSshEnvironment();

  return Object.freeze({
    async run(command: BackendTransportCommand): Promise<BackendTransportCompletion> {
      const remoteCommand = joinRemoteArgv(command.args);
      let result: Awaited<ReturnType<typeof runSupervisedProcess>>;
      try {
        result = await runSupervisedProcess({
          launch: {
            executablePath: config.sshExecutablePath,
            argv0: "ssh",
            args: [...baseArgs, remoteCommand],
            environmentMutations: { set: {}, unset: [] },
          },
          cwd: config.workingDirectory,
          environment,
          deadlineNanoseconds: command.deadlineNanoseconds,
          controller,
        });
      } catch (failure) {
        return {
          kind: "refused",
          reasonCode: "RP_BACKEND_TRANSPORT_SUPERVISION_FAILED",
          detail: failure instanceof Error ? failure.message : "unknown supervision failure",
        };
      }
      if (!result.started && result.timedOut && result.timeoutPhase === "before_launch") {
        return {
          kind: "refused",
          reasonCode: "RP_BACKEND_TRANSPORT_DEADLINE_BEFORE_LAUNCH",
          detail: "controller deadline expired before ssh launch",
        };
      }
      if (result.timedOut) {
        return {
          kind: "refused",
          reasonCode: "RP_BACKEND_TRANSPORT_DEADLINE_DURING_EXECUTION",
          detail: `execution deadline expired; cleanup=${result.cleanup.status}`,
        };
      }
      if (result.exitCode === null || result.signal !== null) {
        return {
          kind: "refused",
          reasonCode: "RP_BACKEND_TRANSPORT_TERMINATED_BY_SIGNAL",
          detail: `signal=${result.signal ?? "unknown"}; cleanup=${result.cleanup.status}`,
        };
      }
      if (result.streamCapture.status !== "complete") {
        return {
          kind: "refused",
          reasonCode: "RP_BACKEND_TRANSPORT_STREAM_INCOMPLETE",
          detail: result.streamCapture.reasonCode ?? "RP_STREAM_DRAIN_INCOMPLETE",
        };
      }
      const stdout = strictUtf8(result.stdout.tail);
      const stderr = strictUtf8(result.stderr.tail);
      if (stdout === null || stderr === null) {
        return {
          kind: "refused",
          reasonCode: "RP_BACKEND_TRANSPORT_INVALID_OUTPUT",
          detail: "ssh output was not strict UTF-8 without NUL bytes",
        };
      }
      return Object.freeze({
        kind: "completed",
        exitCode: result.exitCode,
        stdout,
        stderr,
        durationMs: result.durationMs,
        cleanupStatus: result.cleanup.status,
      });
    },
  });
}
