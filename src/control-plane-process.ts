import { accessSync, constants, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, resolve, win32 } from "node:path";
import { isProxy } from "node:util/types";
import type { OciPreflightCommand, OciPreflightTransport } from "./oci/linux-rootless-preflight.js";
import {
  currentProcessController,
  inspectSupervisedProcessFailure,
  type ProcessCleanup,
  runSupervisedProcess,
  type SupervisedProcessResult,
} from "./supervised-process.js";

const MAX_ARGUMENTS = 128;
const MAX_ARGUMENT_BYTES = 64 * 1024;
const MAX_SINGLE_ARGUMENT_BYTES = 8 * 1024;
const CONTROL_PLANE_ADAPTER = Symbol("RunParity.ControlPlaneProcessAdapter");

const CAPTURED_WINDOWS_ROOT = (() => {
  if (process.platform !== "win32") return null;
  const key = Object.keys(process.env)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .find((name) => name.toLowerCase() === "systemroot");
  const value = key === undefined ? undefined : process.env[key];
  if (value === undefined || !isAbsolute(value)) return null;
  try {
    return realpathSync.native(value);
  } catch {
    return null;
  }
})();

type AdapterData = Readonly<{
  executablePath: string;
  baseArgs: readonly string[];
  cwd: string;
  environment: Readonly<NodeJS.ProcessEnv>;
}>;

export type ControlPlaneProcessAdapter = Readonly<{
  [CONTROL_PLANE_ADAPTER]: true;
}>;

type FrozenCleanup = Readonly<ProcessCleanup>;

export type ControlPlaneProcessResult =
  | Readonly<{
      kind: "not_started";
      reasonCode: "RP_CONTROLLER_DEADLINE_EXPIRED" | "RP_CONTROLLER_LAUNCH_FAILED";
      cleanup: FrozenCleanup;
    }>
  | Readonly<{
      kind: "aborted_safety";
      reasonCode:
        | "RP_CONTROLLER_INVALID_COMMAND"
        | "RP_CONTROLLER_INVALID_OUTPUT"
        | "RP_CONTROLLER_OUTPUT_LIMIT_EXCEEDED"
        | "RP_CONTROLLER_PROCESS_NOT_CONTAINED"
        | "RP_CONTROLLER_STREAM_INCOMPLETE"
        | "RP_CONTROLLER_PROCESS_TERMINATED"
        | "RP_CONTROLLER_SUPERVISION_FAILED";
      cleanup: FrozenCleanup;
    }>;

const adapterData = new WeakMap<ControlPlaneProcessAdapter, AdapterData>();

function failAdapter(reason: string): never {
  throw new TypeError(`RP_CONTROLLER_INVALID_ADAPTER: ${reason}`);
}

function isSafeScalar(value: string): boolean {
  if (value.length === 0 || Buffer.byteLength(value) > MAX_SINGLE_ARGUMENT_BYTES) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint === 0 || codePoint <= 31 || codePoint === 127)) {
      return false;
    }
  }
  return true;
}

function ownDataDescriptors(
  value: unknown,
  expectedKeys?: readonly string[],
): Readonly<Record<string, PropertyDescriptor>> | null {
  if (typeof value !== "object" || value === null || isProxy(value) || Array.isArray(value)) {
    return null;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    (expectedKeys !== undefined &&
      (keys.length !== expectedKeys.length ||
        !expectedKeys.every((key) => Object.hasOwn(descriptors, key))))
  ) {
    return null;
  }
  for (const key of keys) {
    const descriptor = descriptors[String(key)];
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
      return null;
    }
  }
  return descriptors;
}

function snapshotStringArray(value: unknown, allowEmpty: boolean): readonly string[] | null {
  if (typeof value !== "object" || value === null || isProxy(value) || !Array.isArray(value)) {
    return null;
  }
  if (Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_ARGUMENTS) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    keys.length !== value.length + 1 ||
    !Object.hasOwn(descriptors, "length")
  ) {
    return null;
  }
  const snapshot: string[] = [];
  let totalBytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const indexKey = String(index);
    if (!Object.hasOwn(descriptors, indexKey)) return null;
    const descriptor = descriptors[indexKey];
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value") ||
      !descriptor.enumerable ||
      typeof descriptor.value !== "string" ||
      (!allowEmpty && descriptor.value.length === 0) ||
      (descriptor.value.length > 0 && !isSafeScalar(descriptor.value))
    ) {
      return null;
    }
    totalBytes += Buffer.byteLength(descriptor.value);
    if (totalBytes > MAX_ARGUMENT_BYTES) return null;
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}

function minimalControllerEnvironment(cwd: string): Readonly<NodeJS.ProcessEnv> {
  if (process.platform !== "win32") {
    return Object.freeze({
      HOME: cwd,
      LANG: "C",
      LC_ALL: "C",
      PATH: "",
      TMPDIR: cwd,
    });
  }
  if (CAPTURED_WINDOWS_ROOT === null) {
    return failAdapter("a captured Windows system root is required");
  }
  const systemDrive = win32.parse(CAPTURED_WINDOWS_ROOT).root.slice(0, 2);
  return Object.freeze({
    APPDATA: cwd,
    COMSPEC: resolve(CAPTURED_WINDOWS_ROOT, "System32", "cmd.exe"),
    HOME: cwd,
    HOMEDRIVE: systemDrive,
    HOMEPATH: "\\",
    LOCALAPPDATA: cwd,
    LOGONSERVER: "",
    PATH: "",
    PROGRAMDATA: "",
    RUNPARITY_CONTROL_PLANE: "1",
    SYSTEMDRIVE: systemDrive,
    SYSTEMROOT: CAPTURED_WINDOWS_ROOT,
    TEMP: cwd,
    TMP: cwd,
    USERDOMAIN: "",
    USERNAME: "",
    USERPROFILE: cwd,
    WINDIR: CAPTURED_WINDOWS_ROOT,
  });
}

function canonicalExecutable(value: unknown): string {
  if (typeof value !== "string" || !isAbsolute(value) || !isSafeScalar(value)) {
    return failAdapter("executablePath must be a safe absolute path");
  }
  let canonical: string;
  try {
    canonical = realpathSync.native(value);
    const stat = lstatSync(canonical, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink()) return failAdapter("executable must be regular");
    if (process.platform !== "win32") accessSync(canonical, constants.X_OK);
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith("RP_CONTROLLER_INVALID_ADAPTER:")) {
      throw error;
    }
    return failAdapter("executable cannot be resolved or executed");
  }
  return canonical;
}

function canonicalDirectory(value: unknown): string {
  if (typeof value !== "string" || !isAbsolute(value) || !isSafeScalar(value)) {
    return failAdapter("cwd must be a safe absolute path");
  }
  try {
    const canonical = realpathSync.native(value);
    if (!lstatSync(canonical, { bigint: true }).isDirectory()) {
      return failAdapter("cwd must be a directory");
    }
    return canonical;
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith("RP_CONTROLLER_INVALID_ADAPTER:")) {
      throw error;
    }
    return failAdapter("cwd cannot be resolved");
  }
}

/**
 * @internal Creates an opaque adapter whose executable, cwd, and minimal
 * environment are fixed before any command is accepted. The caller cannot
 * provide an environment snapshot.
 */
export function createControlPlaneProcessAdapter(
  input: Readonly<{
    executablePath: string;
    baseArgs: readonly string[];
    cwd: string;
  }>,
): ControlPlaneProcessAdapter {
  const descriptors = ownDataDescriptors(input, ["executablePath", "baseArgs", "cwd"]);
  if (descriptors === null) return failAdapter("input must contain exact inert data properties");
  const baseArgs = snapshotStringArray(descriptors["baseArgs"]?.value, true);
  if (baseArgs === null) return failAdapter("baseArgs exceeds the controller policy");
  const cwd = canonicalDirectory(descriptors["cwd"]?.value);
  const data = Object.freeze({
    executablePath: canonicalExecutable(descriptors["executablePath"]?.value),
    baseArgs,
    cwd,
    environment: minimalControllerEnvironment(cwd),
  });
  const adapter: ControlPlaneProcessAdapter = Object.freeze({
    [CONTROL_PLANE_ADAPTER]: true as const,
  });
  adapterData.set(adapter, data);
  return adapter;
}

function frozenCleanup(cleanup: ProcessCleanup): FrozenCleanup {
  return Object.freeze({ ...cleanup });
}

function safetyResult(
  reasonCode: Extract<ControlPlaneProcessResult, { kind: "aborted_safety" }>["reasonCode"],
  cleanup: ProcessCleanup,
): ControlPlaneProcessResult {
  return Object.freeze({ kind: "aborted_safety", reasonCode, cleanup: frozenCleanup(cleanup) });
}

function notStartedResult(
  reasonCode: Extract<ControlPlaneProcessResult, { kind: "not_started" }>["reasonCode"],
  cleanup: ProcessCleanup,
): ControlPlaneProcessResult {
  return Object.freeze({ kind: "not_started", reasonCode, cleanup: frozenCleanup(cleanup) });
}

function decodeUtf8(value: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    return null;
  }
}

export async function runControlPlaneCommand(
  adapter: ControlPlaneProcessAdapter,
  command: Readonly<OciPreflightCommand>,
): Promise<ControlPlaneProcessResult> {
  const data = adapterData.get(adapter);
  if (data === undefined) throw new TypeError("A captured ControlPlaneProcessAdapter is required.");
  const descriptors = ownDataDescriptors(command, ["args", "deadlineNanoseconds"]);
  const args = snapshotStringArray(descriptors?.["args"]?.value, true);
  const deadlineNanoseconds = descriptors?.["deadlineNanoseconds"]?.value as unknown;
  if (args === null || typeof deadlineNanoseconds !== "bigint" || deadlineNanoseconds <= 0n) {
    return safetyResult("RP_CONTROLLER_INVALID_COMMAND", {
      attempted: false,
      status: "not_required",
      containment: "uncontained_host",
      strategy: null,
      reason_code: null,
    });
  }
  const combinedArgs = snapshotStringArray([...data.baseArgs, ...args], true);
  if (combinedArgs === null) {
    return safetyResult("RP_CONTROLLER_INVALID_COMMAND", {
      attempted: false,
      status: "not_required",
      containment: "uncontained_host",
      strategy: null,
      reason_code: null,
    });
  }

  let result: SupervisedProcessResult;
  try {
    result = await runSupervisedProcess({
      launch: {
        executablePath: data.executablePath,
        argv0: data.executablePath,
        args: combinedArgs,
        environmentMutations: { set: {}, unset: [] },
      },
      cwd: data.cwd,
      environment: data.environment,
      deadlineNanoseconds,
      controller: currentProcessController(),
    });
  } catch (error) {
    const failure = inspectSupervisedProcessFailure(error);
    if (failure?.phase === "before_launch") {
      return notStartedResult("RP_CONTROLLER_LAUNCH_FAILED", failure.cleanup);
    }
    return safetyResult(
      "RP_CONTROLLER_SUPERVISION_FAILED",
      failure?.cleanup ?? {
        attempted: false,
        status: "not_required",
        containment: "uncontained_host",
        strategy: null,
        reason_code: null,
      },
    );
  }

  const cleanup = result.cleanup;
  try {
    if (!result.started) {
      return notStartedResult("RP_CONTROLLER_DEADLINE_EXPIRED", cleanup);
    }
    if (result.timedOut || cleanup.attempted) {
      return safetyResult("RP_CONTROLLER_PROCESS_NOT_CONTAINED", cleanup);
    }
    if (result.streamCapture.status !== "complete") {
      return safetyResult("RP_CONTROLLER_STREAM_INCOMPLETE", cleanup);
    }
    if (result.stdout.truncated || result.stderr.truncated) {
      return safetyResult("RP_CONTROLLER_OUTPUT_LIMIT_EXCEEDED", cleanup);
    }
    const stdout = decodeUtf8(result.stdout.tail);
    const stderr = decodeUtf8(result.stderr.tail);
    if (stdout === null || stderr === null) {
      return safetyResult("RP_CONTROLLER_INVALID_OUTPUT", cleanup);
    }
    if (result.exitCode === null) {
      return safetyResult("RP_CONTROLLER_PROCESS_TERMINATED", cleanup);
    }
    return safetyResult("RP_CONTROLLER_PROCESS_NOT_CONTAINED", cleanup);
  } finally {
    result.stdout.tail.fill(0);
    result.stderr.tail.fill(0);
  }
}

/** @internal Bridges static OCI preflight to a supervised process adapter. */
export function createOciPreflightProcessTransport(
  adapter: ControlPlaneProcessAdapter,
): OciPreflightTransport {
  if (!adapterData.has(adapter)) {
    throw new TypeError("A captured ControlPlaneProcessAdapter is required.");
  }
  return Object.freeze({
    run(command, abortSignal, complete) {
      if (abortSignal.aborted) {
        complete(null);
        return;
      }
      void runControlPlaneCommand(adapter, command).then(
        (result) => {
          if (abortSignal.aborted) return;
          if (result.kind === "not_started") {
            complete(Object.freeze({ exitCode: 70, stdout: "", stderr: "" }));
            return;
          }
          complete(null);
        },
        () => complete(null),
      );
    },
  });
}
