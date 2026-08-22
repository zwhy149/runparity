import { type ChildProcessByStdio, spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { Readable } from "node:stream";

const MAX_EXCERPT_BYTES = 64 * 1024;
const MAX_TIMER_DELAY_MILLISECONDS = 2_147_483_647;
const MAX_TIMER_DELAY_NANOSECONDS = BigInt(MAX_TIMER_DELAY_MILLISECONDS) * 1_000_000n;

export type RawCapturedStream = {
  tail: Buffer;
  bytes: number;
  digest: {
    algorithm: "HMAC-SHA-256";
    key_scope: "invocation";
    value: string;
  };
  truncated: boolean;
};

export type ProcessCleanup = {
  attempted: boolean;
  status: "not_required" | "best_effort" | "verified" | "failed";
  containment: "uncontained_host";
  strategy: "posix_process_group" | "windows_taskkill" | null;
  reason_code: "RP_PROCESS_TREE_NOT_CONTAINED" | "RP_PROCESS_TREE_CLEANUP_FAILED" | null;
};

export type SupervisedProcessResult = {
  started: boolean;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  timeoutPhase: "before_launch" | "execution" | null;
  stdout: RawCapturedStream;
  stderr: RawCapturedStream;
  cleanup: ProcessCleanup;
  streamCapture: {
    status: "complete" | "incomplete";
    reasonCode: "RP_STREAM_DRAIN_INCOMPLETE" | null;
  };
};

export type SupervisedProcessFailureInfo = Readonly<{
  phase: "before_launch" | "after_launch";
  cleanup: Readonly<ProcessCleanup>;
}>;

const supervisedProcessFailures = new WeakMap<object, SupervisedProcessFailureInfo>();

function supervisedProcessFailure(
  cause: unknown,
  phase: SupervisedProcessFailureInfo["phase"],
  cleanup: ProcessCleanup,
): Error {
  const failure = new Error("RP_PROCESS_SUPERVISION_FAILED", { cause });
  supervisedProcessFailures.set(
    failure,
    Object.freeze({ phase, cleanup: Object.freeze({ ...cleanup }) }),
  );
  return failure;
}

export function inspectSupervisedProcessFailure(
  value: unknown,
): SupervisedProcessFailureInfo | null {
  return typeof value === "object" && value !== null
    ? (supervisedProcessFailures.get(value) ?? null)
    : null;
}

const PROCESS_CONTROLLER = Symbol("RunParity.ProcessController");

export type ProcessController = Readonly<{
  [PROCESS_CONTROLLER]: true;
}>;

type ProcessControllerData = Readonly<{
  platform: NodeJS.Platform;
  windowsTaskkillPath: string | null;
  environment: Readonly<NodeJS.ProcessEnv>;
}>;

const processControllerData = new WeakMap<ProcessController, ProcessControllerData>();

const NO_CLEANUP: ProcessCleanup = Object.freeze({
  attempted: false,
  status: "not_required",
  containment: "uncontained_host",
  strategy: null,
  reason_code: null,
});

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function posixGroupExists(groupId: number): boolean {
  try {
    process.kill(-groupId, 0);
    return true;
  } catch {
    return false;
  }
}

async function terminatePosixProcessGroup(groupId: number): Promise<ProcessCleanup> {
  try {
    process.kill(-groupId, "SIGTERM");
  } catch {
    const groupStillExists = posixGroupExists(groupId);
    return {
      attempted: true,
      status: groupStillExists ? "failed" : "best_effort",
      containment: "uncontained_host",
      strategy: "posix_process_group",
      reason_code: groupStillExists
        ? "RP_PROCESS_TREE_CLEANUP_FAILED"
        : "RP_PROCESS_TREE_NOT_CONTAINED",
    };
  }

  await delay(250);
  if (posixGroupExists(groupId)) {
    try {
      process.kill(-groupId, "SIGKILL");
    } catch {
      // The verification loop below is the source of truth.
    }
  }

  const deadline = Date.now() + 500;
  while (posixGroupExists(groupId) && Date.now() < deadline) {
    await delay(25);
  }
  const completed = !posixGroupExists(groupId);
  return {
    attempted: true,
    status: completed ? "best_effort" : "failed",
    containment: "uncontained_host",
    strategy: "posix_process_group",
    reason_code: completed ? "RP_PROCESS_TREE_NOT_CONTAINED" : "RP_PROCESS_TREE_CLEANUP_FAILED",
  };
}

function detectControllerTaskkillPath(
  platform: NodeJS.Platform,
  environment: Readonly<NodeJS.ProcessEnv>,
): string | null {
  if (platform !== "win32") return null;
  const selectedKey = Object.keys(environment)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .find((name) => name.toLowerCase() === "systemroot");
  const windowsDirectory = selectedKey === undefined ? undefined : environment[selectedKey];
  if (windowsDirectory === undefined || !isAbsolute(windowsDirectory)) return null;
  return resolve(windowsDirectory, "System32", "taskkill.exe");
}

function captureCurrentProcessController(): ProcessController {
  const environment = Object.freeze({ ...process.env });
  const data = Object.freeze({
    platform: process.platform,
    windowsTaskkillPath: detectControllerTaskkillPath(process.platform, environment),
    environment,
  });
  const controller: ProcessController = Object.freeze({
    [PROCESS_CONTROLLER]: true as const,
  });
  processControllerData.set(controller, data);
  return controller;
}

const CURRENT_PROCESS_CONTROLLER = captureCurrentProcessController();

export function currentProcessController(): ProcessController {
  return CURRENT_PROCESS_CONTROLLER;
}

function requireProcessController(controller: ProcessController): ProcessControllerData {
  const data = processControllerData.get(controller);
  if (data === undefined) throw new TypeError("A captured ProcessController is required.");
  return data;
}

function terminateWindowsProcessTree(
  pid: number,
  controller: ProcessControllerData,
): ProcessCleanup {
  const completed =
    controller.windowsTaskkillPath !== null &&
    existsSync(controller.windowsTaskkillPath) &&
    spawnSync(controller.windowsTaskkillPath, ["/PID", String(pid), "/T", "/F"], {
      env: { ...controller.environment },
      shell: false,
      stdio: "ignore",
      timeout: 5_000,
      windowsHide: true,
    }).status === 0;

  return {
    attempted: true,
    status: completed ? "best_effort" : "failed",
    containment: "uncontained_host",
    strategy: "windows_taskkill",
    reason_code: completed ? "RP_PROCESS_TREE_NOT_CONTAINED" : "RP_PROCESS_TREE_CLEANUP_FAILED",
  };
}

async function terminateProcessTree(
  pid: number,
  controller: ProcessControllerData,
): Promise<ProcessCleanup> {
  return controller.platform === "win32"
    ? terminateWindowsProcessTree(pid, controller)
    : terminatePosixProcessGroup(pid);
}

class RawStreamCapture {
  readonly #digest;
  #bytes = 0;
  #tail: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  constructor(digestKey: Buffer) {
    this.#digest = createHmac("sha256", digestKey);
  }

  push(chunk: Buffer): void {
    this.#bytes += chunk.length;
    this.#digest.update(chunk);

    if (chunk.length >= MAX_EXCERPT_BYTES) {
      const nextTail = Buffer.from(chunk.subarray(chunk.length - MAX_EXCERPT_BYTES));
      this.#tail.fill(0);
      chunk.fill(0);
      this.#tail = nextTail;
      return;
    }

    const combined = Buffer.concat([this.#tail, chunk]);
    this.#tail.fill(0);
    chunk.fill(0);
    if (combined.length > MAX_EXCERPT_BYTES) {
      this.#tail = Buffer.from(combined.subarray(combined.length - MAX_EXCERPT_BYTES));
      combined.fill(0);
      return;
    }
    this.#tail = combined;
  }

  finish(): RawCapturedStream {
    const tail = this.#tail;
    this.#tail = Buffer.alloc(0);
    return {
      tail,
      bytes: this.#bytes,
      digest: {
        algorithm: "HMAC-SHA-256",
        key_scope: "invocation",
        value: this.#digest.digest("hex"),
      },
      truncated: this.#bytes > MAX_EXCERPT_BYTES,
    };
  }

  discard(): void {
    this.#tail.fill(0);
    this.#tail = Buffer.alloc(0);
  }
}

type EnvironmentMutations = Readonly<{
  set: Readonly<Record<string, string>>;
  unset: readonly string[];
}>;

function launchEnvironment(
  baseEnvironment: Readonly<NodeJS.ProcessEnv>,
  mutations: EnvironmentMutations,
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...baseEnvironment };
  for (const name of mutations.unset) {
    const existing = Object.keys(environment).find((key) =>
      platform === "win32" ? key.toLowerCase() === name.toLowerCase() : key === name,
    );
    if (existing !== undefined) delete environment[existing];
  }
  for (const [name, value] of Object.entries(mutations.set)) {
    const existing = Object.keys(environment).find((key) =>
      platform === "win32" ? key.toLowerCase() === name.toLowerCase() : key === name,
    );
    if (existing !== undefined) delete environment[existing];
    environment[name] = value;
  }
  return environment;
}

export type SupervisedProcessSpec = {
  launch: {
    executablePath: string;
    argv0: string;
    args: readonly string[];
    environmentMutations: EnvironmentMutations;
  };
  cwd: string;
  environment: Readonly<NodeJS.ProcessEnv>;
  deadlineNanoseconds: bigint;
  controller: ProcessController;
};

export type SupervisedProcessHooks = {
  beforeSpawn?: () => void;
  nowNanoseconds?: () => bigint;
};

function deadlineExpiredResult(
  stdout: RawStreamCapture,
  stderr: RawStreamCapture,
): SupervisedProcessResult {
  return {
    started: false,
    durationMs: 0,
    exitCode: null,
    signal: null,
    timedOut: true,
    timeoutPhase: "before_launch",
    stdout: stdout.finish(),
    stderr: stderr.finish(),
    cleanup: NO_CLEANUP,
    streamCapture: { status: "complete", reasonCode: null },
  };
}

export function runSupervisedProcess(
  spec: SupervisedProcessSpec,
  hooks: SupervisedProcessHooks = {},
): Promise<SupervisedProcessResult> {
  const { launch, cwd } = spec;
  const controller = requireProcessController(spec.controller);
  const nowNanoseconds = hooks.nowNanoseconds ?? process.hrtime.bigint;
  const environment = { ...spec.environment };
  const observationStartedNanoseconds = nowNanoseconds();
  const digestKey = randomBytes(32);
  const stdout = new RawStreamCapture(digestKey);
  const stderr = new RawStreamCapture(digestKey);
  digestKey.fill(0);
  if (spec.deadlineNanoseconds - nowNanoseconds() <= 0n) {
    return Promise.resolve(deadlineExpiredResult(stdout, stderr));
  }
  const childEnvironment = launchEnvironment(
    environment,
    launch.environmentMutations,
    controller.platform,
  );
  hooks.beforeSpawn?.();
  if (spec.deadlineNanoseconds - nowNanoseconds() <= 0n) {
    return Promise.resolve(deadlineExpiredResult(stdout, stderr));
  }

  return new Promise((resolveObservation, rejectObservation) => {
    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(launch.executablePath, launch.args, {
        cwd,
        argv0: launch.argv0,
        detached: controller.platform !== "win32",
        env: childEnvironment,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      stdout.discard();
      stderr.discard();
      rejectObservation(supervisedProcessFailure(error, "before_launch", NO_CLEANUP));
      return;
    }
    let settled = false;
    let spawnConfirmed = false;
    let timedOut = false;
    let streamCaptureIncomplete = false;
    let exitInfo: { exitCode: number | null; signal: NodeJS.Signals | null } | null = null;
    let cleanupPromise: Promise<ProcessCleanup> | null = null;
    let drainGrace: NodeJS.Timeout | null = null;
    let forcedFinalize: NodeJS.Timeout | null = null;
    let executionTimeout: NodeJS.Timeout | null = null;
    let processEndedNanoseconds: bigint | null = null;

    const durationMilliseconds = (): number => {
      const ended = processEndedNanoseconds ?? nowNanoseconds();
      const milliseconds = Number(ended - observationStartedNanoseconds) / 1_000_000;
      return Math.round(milliseconds * 1_000) / 1_000;
    };

    const clearTimers = (): void => {
      if (executionTimeout !== null) clearTimeout(executionTimeout);
      if (drainGrace !== null) clearTimeout(drainGrace);
      if (forcedFinalize !== null) clearTimeout(forcedFinalize);
    };

    const finalize = async (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
    ): Promise<void> => {
      if (settled) return;
      settled = true;
      clearTimers();
      const cleanup = cleanupPromise === null ? NO_CLEANUP : await cleanupPromise;
      resolveObservation({
        started: true,
        durationMs: durationMilliseconds(),
        exitCode: timedOut ? null : exitCode,
        signal,
        timedOut,
        timeoutPhase: timedOut ? "execution" : null,
        stdout: stdout.finish(),
        stderr: stderr.finish(),
        cleanup,
        streamCapture: {
          status: streamCaptureIncomplete ? "incomplete" : "complete",
          reasonCode: streamCaptureIncomplete ? "RP_STREAM_DRAIN_INCOMPLETE" : null,
        },
      });
    };

    const scheduleDrainGrace = (): void => {
      if (settled || drainGrace !== null) return;
      drainGrace = setTimeout(() => {
        drainGrace = null;
        if (settled) return;
        streamCaptureIncomplete = true;
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        forcedFinalize = setTimeout(() => {
          forcedFinalize = null;
          void finalize(exitInfo?.exitCode ?? null, exitInfo?.signal ?? null);
        }, 25);
      }, 250);
    };

    const triggerExecutionTimeout = (): void => {
      if (settled || timedOut || exitInfo !== null) return;
      executionTimeout = null;
      timedOut = true;
      processEndedNanoseconds ??= nowNanoseconds();
      cleanupPromise =
        child.pid === undefined
          ? Promise.resolve({
              attempted: true,
              status: "failed",
              containment: "uncontained_host",
              strategy:
                controller.platform === "win32" ? "windows_taskkill" : "posix_process_group",
              reason_code: "RP_PROCESS_TREE_CLEANUP_FAILED",
            })
          : terminateProcessTree(child.pid, controller);
      void cleanupPromise.then((cleanup) => {
        if (cleanup.status === "failed") child.kill("SIGKILL");
        scheduleDrainGrace();
      });
    };

    const armExecutionDeadline = (): void => {
      if (settled || timedOut || exitInfo !== null) return;
      const remainingAfterSpawn = spec.deadlineNanoseconds - nowNanoseconds();
      if (remainingAfterSpawn <= 0n) {
        triggerExecutionTimeout();
        return;
      }
      const timeoutMs =
        remainingAfterSpawn > MAX_TIMER_DELAY_NANOSECONDS
          ? MAX_TIMER_DELAY_MILLISECONDS
          : Number((remainingAfterSpawn + 999_999n) / 1_000_000n);
      executionTimeout = setTimeout(armExecutionDeadline, timeoutMs);
      executionTimeout.unref();
    };

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("spawn", () => {
      spawnConfirmed = true;
    });
    child.once("exit", (exitCode, signal) => {
      processEndedNanoseconds ??= nowNanoseconds();
      exitInfo = { exitCode, signal };
      if (!timedOut) {
        if (executionTimeout !== null) {
          clearTimeout(executionTimeout);
          executionTimeout = null;
        }
        scheduleDrainGrace();
      }
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      const phase = spawnConfirmed || child.pid !== undefined ? "after_launch" : "before_launch";
      void (async () => {
        let cleanup = NO_CLEANUP;
        if (phase === "after_launch") {
          try {
            cleanup =
              cleanupPromise === null
                ? child.pid === undefined
                  ? {
                      attempted: true,
                      status: "failed",
                      containment: "uncontained_host",
                      strategy:
                        controller.platform === "win32"
                          ? "windows_taskkill"
                          : "posix_process_group",
                      reason_code: "RP_PROCESS_TREE_CLEANUP_FAILED",
                    }
                  : await terminateProcessTree(child.pid, controller)
                : await cleanupPromise;
          } catch {
            cleanup = {
              attempted: true,
              status: "failed",
              containment: "uncontained_host",
              strategy:
                controller.platform === "win32" ? "windows_taskkill" : "posix_process_group",
              reason_code: "RP_PROCESS_TREE_CLEANUP_FAILED",
            };
          }
        }
        stdout.discard();
        stderr.discard();
        rejectObservation(supervisedProcessFailure(error, phase, cleanup));
      })();
    });
    child.once("close", (exitCode, signal) => {
      processEndedNanoseconds ??= nowNanoseconds();
      void finalize(exitCode, signal);
    });

    armExecutionDeadline();
  });
}
