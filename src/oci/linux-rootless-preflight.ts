import { posix as posixPath } from "node:path";
import { isProxy } from "node:util/types";
import { snapshotExactDataRecord } from "../inert-snapshot.js";

const MAX_STREAM_BYTES = 64 * 1024;
const MAX_TIMER_DELAY_MILLISECONDS = 2_147_483_647n;
const BACKEND = "linux_rootless_oci";

export type OciPreflightCommand = Readonly<{
  args: readonly string[];
  deadlineNanoseconds: bigint;
}>;

/**
 * @internal Injected asynchronous execution capability. Implementations must
 * return without blocking and must use `complete` to deliver one response.
 * Its responses are never qualification evidence.
 */
export type OciPreflightTransport = Readonly<{
  run(
    command: OciPreflightCommand,
    abortSignal: AbortSignal,
    complete: (response: unknown) => void,
  ): void;
}>;

/** @internal Static preflight input. This API cannot emit a qualification receipt. */
export type LinuxRootlessOciPreflightInput = Readonly<{
  approvedContext: string;
  imageRef: string;
  deadlineNanoseconds: bigint;
  transport: OciPreflightTransport;
}>;

export type OciPreflightStage =
  | "input"
  | "context"
  | "server"
  | "rootless"
  | "image"
  | "live_probes_not_implemented";

export type OciPreflightResult = Readonly<{
  backend: typeof BACKEND;
  status: "unqualified";
  reasonCode:
    | "RP_BACKEND_QUALIFICATION_PROBES_UNIMPLEMENTED"
    | "RP_SANDBOX_UNAVAILABLE"
    | "RP_SAFETY_GUARD_TRIGGERED";
  stage: OciPreflightStage;
}>;

type TransportResponse = Readonly<{ exitCode: number; stdout: string; stderr: string }>;
type PreflightFailure = "unavailable" | "safety";
type InputSnapshot = Readonly<{
  approvedContext: string;
  imageRef: string;
  deadlineNanoseconds: bigint;
  runTransport(
    command: OciPreflightCommand,
    abortSignal: AbortSignal,
    complete: (response: unknown) => void,
  ): void;
}>;

type StageResult =
  | Readonly<{ kind: "completed"; response: TransportResponse; json: unknown }>
  | Readonly<{ kind: "failed"; failure: PreflightFailure }>;

type DeadlineRace =
  | Readonly<{ kind: "completed"; response: TransportResponse | null }>
  | Readonly<{ kind: "rejected" }>
  | Readonly<{ kind: "deadline_before_start" }>
  | Readonly<{ kind: "deadline" }>;

function result(
  reasonCode: OciPreflightResult["reasonCode"],
  stage: OciPreflightStage,
): OciPreflightResult {
  return Object.freeze({ backend: BACKEND, status: "unqualified", reasonCode, stage });
}

function containsUnsafeControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      ((codePoint >= 0 && codePoint <= 8) ||
        codePoint === 11 ||
        codePoint === 12 ||
        (codePoint >= 14 && codePoint <= 31) ||
        (codePoint >= 127 && codePoint <= 159))
    ) {
      return true;
    }
  }
  return false;
}

function snapshotInput(input: unknown): InputSnapshot | null {
  const snapshot = snapshotExactDataRecord(input, [
    "approvedContext",
    "imageRef",
    "deadlineNanoseconds",
    "transport",
  ]);
  if (snapshot === null) return null;

  const approvedContext = snapshot["approvedContext"];
  const imageRef = snapshot["imageRef"];
  const deadlineNanoseconds = snapshot["deadlineNanoseconds"];
  const transport = snapshot["transport"];
  const transportSnapshot = snapshotExactDataRecord(transport, ["run"]);
  const run = transportSnapshot?.["run"];
  if (
    typeof approvedContext !== "string" ||
    typeof imageRef !== "string" ||
    typeof deadlineNanoseconds !== "bigint" ||
    typeof run !== "function" ||
    isProxy(run)
  ) {
    return null;
  }

  const runTransport = (
    command: OciPreflightCommand,
    abortSignal: AbortSignal,
    complete: (response: unknown) => void,
  ): void => {
    Reflect.apply(run, undefined, [command, abortSignal, complete]);
  };

  return Object.freeze({
    approvedContext,
    imageRef,
    deadlineNanoseconds,
    runTransport,
  });
}

function isValidImageReference(value: string): boolean {
  const component = "[a-z0-9]+(?:[._-][a-z0-9]+)*";
  const pattern = new RegExp(
    `^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[1-9][0-9]{0,4})?/${component}(?:/${component})*@sha256:[a-f0-9]{64}$`,
    "u",
  );
  return pattern.test(value);
}

function isValidInput(input: InputSnapshot): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(input.approvedContext) &&
    isValidImageReference(input.imageRef) &&
    ["darwin", "linux", "win32"].includes(process.platform) &&
    input.deadlineNanoseconds > 0n &&
    !containsUnsafeControl(input.approvedContext) &&
    !containsUnsafeControl(input.imageRef)
  );
}

function deadlineExpired(deadlineNanoseconds: bigint): boolean {
  return process.hrtime.bigint() >= deadlineNanoseconds;
}

function scheduleAbsoluteDeadline(deadlineNanoseconds: bigint, onDeadline: () => void): () => void {
  let timer: NodeJS.Timeout | undefined;
  let cancelled = false;
  const arm = (): void => {
    if (cancelled) return;
    const remainingNanoseconds = deadlineNanoseconds - process.hrtime.bigint();
    if (remainingNanoseconds <= 0n) {
      onDeadline();
      return;
    }
    const remainingMilliseconds = (remainingNanoseconds + 999_999n) / 1_000_000n;
    const delay =
      remainingMilliseconds > MAX_TIMER_DELAY_MILLISECONDS
        ? MAX_TIMER_DELAY_MILLISECONDS
        : remainingMilliseconds;
    timer = setTimeout(arm, Number(delay));
  };
  arm();
  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}

async function invokeWithinDeadline(
  input: InputSnapshot,
  command: OciPreflightCommand,
): Promise<DeadlineRace> {
  const controller = new AbortController();
  return new Promise((resolveRace) => {
    let settled = false;
    let cancelDeadline = (): void => undefined;
    const finish = (race: DeadlineRace): void => {
      if (settled) return;
      settled = true;
      cancelDeadline();
      resolveRace(race);
    };
    cancelDeadline = scheduleAbsoluteDeadline(input.deadlineNanoseconds, () => {
      controller.abort();
      finish(Object.freeze({ kind: "deadline" }));
    });
    if (settled) {
      cancelDeadline();
      return;
    }
    queueMicrotask(() => {
      if (settled) return;
      if (deadlineExpired(input.deadlineNanoseconds)) {
        controller.abort();
        finish(Object.freeze({ kind: "deadline_before_start" }));
        return;
      }
      try {
        input.runTransport(command, controller.signal, (value) => {
          if (settled) return;
          finish(Object.freeze({ kind: "completed", response: responseFromUnknown(value) }));
        });
      } catch {
        finish(Object.freeze({ kind: "rejected" }));
      }
    });
  });
}

function safeString(value: unknown): value is string {
  return typeof value === "string" && !containsUnsafeControl(value);
}

function responseFromUnknown(value: unknown): TransportResponse | null {
  const snapshot = snapshotExactDataRecord(value, ["exitCode", "stdout", "stderr"]);
  if (snapshot === null) return null;
  const exitCode = snapshot["exitCode"];
  const stdout = snapshot["stdout"];
  const stderr = snapshot["stderr"];
  if (
    typeof exitCode !== "number" ||
    !Number.isSafeInteger(exitCode) ||
    !safeString(stdout) ||
    !safeString(stderr) ||
    Buffer.byteLength(stdout) > MAX_STREAM_BYTES ||
    Buffer.byteLength(stderr) > MAX_STREAM_BYTES
  ) {
    return null;
  }
  return Object.freeze({ exitCode, stdout, stderr });
}

function parseJson(stdout: string): unknown | undefined {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeJsonStringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || !value.every(safeString)) return null;
  return value;
}

function validateContext(
  value: unknown,
  context: string,
): Readonly<{ endpoint: string }> | PreflightFailure {
  if (
    !isRecord(value) ||
    !safeString(value["Name"]) ||
    value["Name"] !== context ||
    !isRecord(value["Endpoints"])
  ) {
    return "safety";
  }
  const docker = value["Endpoints"]["docker"];
  if (!isRecord(docker) || !safeString(docker["Host"])) return "safety";
  const endpoint = docker["Host"];
  const unixPath = endpoint.startsWith("unix://") ? endpoint.slice("unix://".length) : "";
  const isUnix =
    posixPath.isAbsolute(unixPath) &&
    unixPath !== "/" &&
    !unixPath.endsWith("/") &&
    posixPath.normalize(unixPath) === unixPath;
  const isNamedPipe = /^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9_.-]+$/u.test(endpoint);
  if ((process.platform === "win32" && !isNamedPipe) || (process.platform !== "win32" && !isUnix)) {
    return "safety";
  }
  return Object.freeze({ endpoint });
}

function validateServer(value: unknown): PreflightFailure | null {
  if (!isRecord(value)) return "unavailable";
  if (!safeString(value["Os"]) || !safeString(value["Arch"])) return "unavailable";
  return value["Os"] === "linux" && value["Arch"] === "amd64" ? null : "safety";
}

function validateRootless(value: unknown): PreflightFailure | null {
  const options = safeJsonStringArray(value);
  if (options === null) return "safety";
  return options.includes("name=rootless") ? null : "safety";
}

function validateImage(value: unknown, imageRef: string): PreflightFailure | null {
  if (!isRecord(value) || !safeString(value["Id"])) return "unavailable";
  const digests = safeJsonStringArray(value["RepoDigests"]);
  if (
    digests === null ||
    !/^sha256:[a-f0-9]{64}$/u.test(value["Id"]) ||
    !safeString(value["Os"]) ||
    value["Os"] !== "linux" ||
    !safeString(value["Architecture"]) ||
    value["Architecture"] !== "amd64"
  ) {
    return "safety";
  }
  return digests.includes(imageRef) ? null : "safety";
}

async function runStage(input: InputSnapshot, args: readonly string[]): Promise<StageResult> {
  if (deadlineExpired(input.deadlineNanoseconds)) {
    return Object.freeze({ kind: "failed", failure: "unavailable" });
  }
  const command = Object.freeze({
    args: Object.freeze([...args]),
    deadlineNanoseconds: input.deadlineNanoseconds,
  });
  const raced = await invokeWithinDeadline(input, command);
  if (raced.kind === "deadline") {
    return Object.freeze({ kind: "failed", failure: "safety" });
  }
  if (raced.kind === "deadline_before_start") {
    return Object.freeze({ kind: "failed", failure: "unavailable" });
  }
  if (raced.kind === "rejected") {
    return Object.freeze({ kind: "failed", failure: "unavailable" });
  }
  const response = raced.response;
  if (response === null) return Object.freeze({ kind: "failed", failure: "safety" });
  if (deadlineExpired(input.deadlineNanoseconds) || response.exitCode !== 0) {
    return Object.freeze({ kind: "failed", failure: "unavailable" });
  }
  const json = parseJson(response.stdout);
  if (json === undefined) return Object.freeze({ kind: "failed", failure: "safety" });
  return Object.freeze({ kind: "completed", response, json });
}

function failureResult(failure: PreflightFailure, stage: OciPreflightStage): OciPreflightResult {
  return result(
    failure === "safety" ? "RP_SAFETY_GUARD_TRIGGERED" : "RP_SANDBOX_UNAVAILABLE",
    stage,
  );
}

/**
 * @internal Parses untrusted preflight responses and always returns `unqualified`.
 * A future trusted backend adapter must not treat this result as authorization.
 */
export async function preflightLinuxRootlessOci(
  input: Readonly<LinuxRootlessOciPreflightInput>,
): Promise<OciPreflightResult> {
  let snapshot: InputSnapshot | null;
  try {
    snapshot = snapshotInput(input);
  } catch {
    return result("RP_SAFETY_GUARD_TRIGGERED", "input");
  }
  if (snapshot === null || !isValidInput(snapshot)) {
    return result("RP_SAFETY_GUARD_TRIGGERED", "input");
  }
  if (deadlineExpired(snapshot.deadlineNanoseconds)) {
    return result("RP_SANDBOX_UNAVAILABLE", "input");
  }

  const context = await runStage(snapshot, [
    "context",
    "inspect",
    snapshot.approvedContext,
    "--format",
    "{{json .}}",
  ]);
  if (context.kind === "failed") return failureResult(context.failure, "context");
  const contextValidation = validateContext(context.json, snapshot.approvedContext);
  if (typeof contextValidation === "string") {
    return failureResult(contextValidation, "context");
  }
  const endpointPrefix = ["--host", contextValidation.endpoint] as const;

  const server = await runStage(snapshot, [
    ...endpointPrefix,
    "version",
    "--format",
    "{{json .Server}}",
  ]);
  if (server.kind === "failed") return failureResult(server.failure, "server");
  const serverFailure = validateServer(server.json);
  if (serverFailure !== null) return failureResult(serverFailure, "server");

  const rootless = await runStage(snapshot, [
    ...endpointPrefix,
    "info",
    "--format",
    "{{json .SecurityOptions}}",
  ]);
  if (rootless.kind === "failed") return failureResult(rootless.failure, "rootless");
  const rootlessFailure = validateRootless(rootless.json);
  if (rootlessFailure !== null) return failureResult(rootlessFailure, "rootless");

  const image = await runStage(snapshot, [
    ...endpointPrefix,
    "image",
    "inspect",
    "--platform",
    "linux/amd64",
    snapshot.imageRef,
    "--format",
    "{{json .}}",
  ]);
  if (image.kind === "failed") return failureResult(image.failure, "image");
  const imageFailure = validateImage(image.json, snapshot.imageRef);
  if (imageFailure !== null) return failureResult(imageFailure, "image");

  return result("RP_BACKEND_QUALIFICATION_PROBES_UNIMPLEMENTED", "live_probes_not_implemented");
}
