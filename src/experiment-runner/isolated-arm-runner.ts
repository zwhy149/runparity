import {
  ARM_ISOLATION_POLICY_V1,
  type ArmMount,
  buildArmRunArgv,
} from "../backend/arm-isolation-policy.js";
import { canonicalSha256Hex } from "../backend/digest.js";
import { joinRemoteArgv } from "../backend/remote-command.js";
import type { BackendTransport } from "../backend/ssh-backend-transport.js";

/**
 * IsolatedArmRunner: creates and destroys one fresh arm container through the
 * qualified backend transport. It records bounded arm evidence and cleanup
 * evidence; it never decides a verdict.
 */

export type ArmIdentity = "A1" | "B" | "A2";

/**
 * Programs allowed in per-arm home preparation. Every prep argv must start
 * with one of these and pass the remote allowlist; the runner refuses any
 * other program so case plans can never smuggle arbitrary remote commands.
 */
const HOME_PREP_PROGRAMS: ReadonlySet<string> = new Set([
  "rm",
  "mkdir",
  "cp",
  "ln",
  "chmod",
  "sha256sum",
]);

export type ArmRunRequest = Readonly<{
  identity: ArmIdentity;
  sequenceIndex: number;
  caseSlug: string;
  freshnessId: string;
  environment: Readonly<Record<string, string>>;
  targetArgv: readonly string[];
  workingDirectory: string;
  /**
   * Per-arm home preparation argv, executed into the fresh arm home before
   * the container starts. Supports the placeholders {armHome} and {assets}
   * for the arm's host home dir and the case asset dir.
   */
  homePrep?: readonly (readonly string[])[];
  extraMounts?: readonly ArmMount[];
}>;

export type ArmBackendConfig = Readonly<{
  imageDigestRef: string;
  assetsHostRoot: string;
  armsHostRoot: string;
  perArmDeadlineNanoseconds: bigint;
  nowNanoseconds: () => bigint;
}>;

export type ArmRunRecord = Readonly<{
  identity: ArmIdentity;
  sequence_index: number;
  freshness_id: string;
  arm_name: string;
  outcome: "completed" | "refused";
  refusal_reason: string | null;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  duration_ms: number | null;
  argv: readonly string[];
  normalized_argv: readonly string[];
  post_run_container_absent: boolean | null;
  home_dir_created_fresh: boolean;
  home_prep: readonly (readonly string[])[];
}>;

function armName(request: ArmRunRequest): string {
  const suffix = request.identity.toLowerCase();
  return `${request.caseSlug}-s${request.sequenceIndex}-${suffix}`;
}

function normalizeArgv(argv: readonly string[], arm: string, homeDir: string): readonly string[] {
  const normalized: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    normalized.push(token.replaceAll(arm, "<ARM_NAME>").replaceAll(homeDir, "<ARM_HOME>"));
  }
  return Object.freeze(normalized);
}

function resolvePrepArgv(
  prep: readonly (readonly string[])[],
  homeDir: string,
  assetsDir: string,
): readonly (readonly string[])[] {
  return prep.map((command) =>
    Object.freeze(
      command.map((token) =>
        token.replaceAll("{armHome}", homeDir).replaceAll("{assets}", assetsDir),
      ),
    ),
  );
}

function resolveMounts(
  mounts: readonly ArmMount[] | undefined,
  homeDir: string,
  assetsDir: string,
): readonly ArmMount[] {
  return (mounts ?? []).map((mount) =>
    Object.freeze({
      hostDir: mount.hostDir.replaceAll("{armHome}", homeDir).replaceAll("{assets}", assetsDir),
      containerPath: mount.containerPath,
      options: mount.options,
    }),
  );
}

export async function runIsolatedArm(
  transport: BackendTransport,
  backend: ArmBackendConfig,
  request: ArmRunRequest,
): Promise<ArmRunRecord> {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/u.test(request.caseSlug)) {
    throw new Error("RP_ARM_RUNNER_INVALID_CASE_SLUG");
  }
  const arm = armName(request);
  const armsRoot = backend.armsHostRoot.replace(/\/+$/u, "");
  const homeDir = `${armsRoot}/${arm}`;
  const assetsDir = backend.assetsHostRoot.replace(/\/+$/u, "");
  const armDeadline = backend.nowNanoseconds() + backend.perArmDeadlineNanoseconds;

  const runSimple = async (args: readonly string[]): Promise<number | null> => {
    if (backend.nowNanoseconds() >= armDeadline) {
      return null;
    }
    const completion = await transport.run({ args, deadlineNanoseconds: armDeadline });
    return completion.kind === "completed" ? completion.exitCode : null;
  };

  await runSimple(["rm", "-rf", homeDir]);
  const mkdirExit = await runSimple(["mkdir", "-p", homeDir]);
  const homeFresh = mkdirExit === 0;

  const resolvedPrep = resolvePrepArgv(request.homePrep ?? [], homeDir, assetsDir);
  let prepOk = true;
  for (const command of resolvedPrep) {
    const program = command[0] ?? "";
    if (!HOME_PREP_PROGRAMS.has(program)) {
      throw new Error(`RP_ARM_RUNNER_PREP_PROGRAM_FORBIDDEN:${program}`);
    }
    joinRemoteArgv(command);
    const exit = await runSimple(command);
    if (exit !== 0) {
      prepOk = false;
      break;
    }
  }

  const argv = buildArmRunArgv({
    armName: arm,
    imageDigestRef: backend.imageDigestRef,
    environment: request.environment,
    assetHostDir: assetsDir,
    armHomeHostDir: homeDir,
    workingDirectory: request.workingDirectory,
    timeoutSeconds: ARM_ISOLATION_POLICY_V1.podman_timeout_seconds,
    targetArgv: request.targetArgv,
    extraMounts: resolveMounts(request.extraMounts, homeDir, assetsDir),
    mode: "run",
  });

  const completion =
    prepOk === false ? null : await transport.run({ args: argv, deadlineNanoseconds: armDeadline });

  const leftover = await transport.run({
    args: ["podman", "ps", "-a", "--filter", `name=${arm}`, "--format", "json"],
    deadlineNanoseconds: armDeadline,
  });
  let containerAbsent: boolean | null = null;
  if (leftover.kind === "completed") {
    try {
      const parsed = JSON.parse(leftover.stdout.trim() || "[]") as unknown;
      containerAbsent = Array.isArray(parsed) && parsed.length === 0;
    } catch {
      containerAbsent = null;
    }
  }

  const base = {
    identity: request.identity,
    sequence_index: request.sequenceIndex,
    freshness_id: request.freshnessId,
    arm_name: arm,
    argv,
    normalized_argv: normalizeArgv(argv, arm, homeDir),
    post_run_container_absent: containerAbsent,
    home_dir_created_fresh: homeFresh,
    home_prep: resolvedPrep as readonly (readonly string[])[],
  };

  if (completion === null || completion.kind === "refused") {
    return Object.freeze({
      ...base,
      outcome: "refused",
      refusal_reason:
        completion === null ? "RP_ARM_RUNNER_HOME_PREP_FAILED" : completion.reasonCode,
      exit_code: null,
      stdout: "",
      stderr: "",
      duration_ms: null,
    });
  }

  return Object.freeze({
    ...base,
    outcome: "completed",
    refusal_reason: null,
    exit_code: completion.exitCode,
    stdout: completion.stdout,
    stderr: completion.stderr,
    duration_ms: completion.durationMs,
  });
}

export function armArgvDigest(argv: readonly string[]): string {
  return canonicalSha256Hex(argv);
}
