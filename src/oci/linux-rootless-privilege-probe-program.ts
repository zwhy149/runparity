import { isProxy } from "node:util/types";
import { snapshotExactDataRecord } from "../inert-snapshot.js";
import type {
  LinuxRootlessPrivilegeProbeArtifactV1,
  LinuxRootlessPrivilegeProbeBundleV1,
} from "./linux-rootless-privilege-probe-bundle.js";

const OUTPUT_LIMIT_BYTES = 512 * 1024;
const textDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get;
const typedArrayValues = Object.getOwnPropertyDescriptor(typedArrayPrototype, "values")?.value;
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;

export type FixedLinuxGuestPrivilegeSourceId =
  | "proc_self_status"
  | "proc_self_uid_map"
  | "proc_self_gid_map"
  | "overflow_uid"
  | "overflow_gid";

export type FixedLinuxGuestPrivilegeSourceSpec = Readonly<{
  id: FixedLinuxGuestPrivilegeSourceId;
  absolutePath: string;
  maximumBytes: number;
}>;

export type FixedLinuxGuestPrivilegeSourceReadResult =
  | Readonly<{ kind: "observed"; bytes: Uint8Array }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "failed" }>
  | Readonly<{ kind: "limit_exceeded" }>;

export type FixedLinuxGuestPrivilegeProbeRuntime = Readonly<{
  platform: string;
  architecture: string;
  read(source: FixedLinuxGuestPrivilegeSourceSpec): unknown;
}>;

export type FixedLinuxGuestPrivilegeProbeFailureReason =
  | "invalid_invocation"
  | "unsupported_runtime"
  | "invalid_runtime"
  | "invalid_source_response"
  | "source_read_failed"
  | "source_limit_exceeded"
  | "invalid_utf8"
  | "output_limit_exceeded";

export type FixedLinuxGuestPrivilegeProbeProgramResult =
  | Readonly<{
      kind: "assembled_unverified_bundle";
      bundle: LinuxRootlessPrivilegeProbeBundleV1;
    }>
  | Readonly<{
      kind: "probe_failed";
      reason: FixedLinuxGuestPrivilegeProbeFailureReason;
    }>;

export type FixedLinuxGuestPrivilegeProbeRenderedResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

const FIXED_SOURCES: readonly FixedLinuxGuestPrivilegeSourceSpec[] = Object.freeze([
  Object.freeze({
    id: "proc_self_status",
    absolutePath: "/proc/self/status",
    maximumBytes: 64 * 1024,
  }),
  Object.freeze({
    id: "proc_self_uid_map",
    absolutePath: "/proc/self/uid_map",
    maximumBytes: 8 * 1024,
  }),
  Object.freeze({
    id: "proc_self_gid_map",
    absolutePath: "/proc/self/gid_map",
    maximumBytes: 8 * 1024,
  }),
  Object.freeze({
    id: "overflow_uid",
    absolutePath: "/proc/sys/kernel/overflowuid",
    maximumBytes: 32,
  }),
  Object.freeze({
    id: "overflow_gid",
    absolutePath: "/proc/sys/kernel/overflowgid",
    maximumBytes: 32,
  }),
]);

const FAILURE_OUTPUT: Readonly<
  Record<FixedLinuxGuestPrivilegeProbeFailureReason, Readonly<{ exitCode: number; stderr: string }>>
> = Object.freeze({
  invalid_invocation: Object.freeze({ exitCode: 64, stderr: "RP_PROBE_INVALID_INVOCATION\n" }),
  unsupported_runtime: Object.freeze({ exitCode: 78, stderr: "RP_PROBE_UNSUPPORTED_RUNTIME\n" }),
  invalid_runtime: Object.freeze({ exitCode: 70, stderr: "RP_PROBE_INVALID_RUNTIME\n" }),
  invalid_source_response: Object.freeze({
    exitCode: 70,
    stderr: "RP_PROBE_INVALID_SOURCE_RESPONSE\n",
  }),
  source_read_failed: Object.freeze({ exitCode: 74, stderr: "RP_PROBE_SOURCE_READ_FAILED\n" }),
  source_limit_exceeded: Object.freeze({
    exitCode: 74,
    stderr: "RP_PROBE_SOURCE_LIMIT_EXCEEDED\n",
  }),
  invalid_utf8: Object.freeze({ exitCode: 74, stderr: "RP_PROBE_INVALID_UTF8\n" }),
  output_limit_exceeded: Object.freeze({
    exitCode: 74,
    stderr: "RP_PROBE_OUTPUT_LIMIT_EXCEEDED\n",
  }),
});

function failed(
  reason: FixedLinuxGuestPrivilegeProbeFailureReason,
): FixedLinuxGuestPrivilegeProbeProgramResult {
  return Object.freeze({ kind: "probe_failed", reason });
}

function isExactEmptyArgumentArray(candidate: unknown): candidate is readonly [] {
  if (isProxy(candidate) || !Array.isArray(candidate)) return false;
  if (Object.getPrototypeOf(candidate) !== Array.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== 1 || keys[0] !== "length") return false;
  const lengthDescriptor = (descriptors as unknown as Record<string, PropertyDescriptor>)["length"];
  return (
    lengthDescriptor !== undefined &&
    Object.hasOwn(lengthDescriptor, "value") &&
    lengthDescriptor.value === 0
  );
}

function snapshotRuntime(candidate: unknown): FixedLinuxGuestPrivilegeProbeRuntime | null {
  const record = snapshotExactDataRecord(candidate, ["platform", "architecture", "read"]);
  const platform = record?.["platform"];
  const architecture = record?.["architecture"];
  const read = record?.["read"];
  if (
    typeof platform !== "string" ||
    typeof architecture !== "string" ||
    typeof read !== "function" ||
    isProxy(read)
  ) {
    return null;
  }
  return Object.freeze({
    platform,
    architecture,
    read: read as FixedLinuxGuestPrivilegeProbeRuntime["read"],
  });
}

function snapshotReadResult(
  candidate: unknown,
  source: FixedLinuxGuestPrivilegeSourceSpec,
): LinuxRootlessPrivilegeProbeArtifactV1 | FixedLinuxGuestPrivilegeProbeFailureReason {
  const stateOnly = snapshotExactDataRecord(candidate, ["kind"]);
  if (stateOnly?.["kind"] === "missing") return Object.freeze({ state: "missing" });
  if (stateOnly?.["kind"] === "failed") return "source_read_failed";
  if (stateOnly?.["kind"] === "limit_exceeded") return "source_limit_exceeded";

  const observed = snapshotExactDataRecord(candidate, ["kind", "bytes"]);
  if (observed?.["kind"] !== "observed") return "invalid_source_response";
  const bytes = snapshotByteView(observed["bytes"], source.maximumBytes);
  if (bytes === "invalid") return "invalid_source_response";
  if (bytes === "limit_exceeded") return "source_limit_exceeded";

  let text: string;
  try {
    text = textDecoder.decode(bytes);
  } catch {
    return "invalid_utf8";
  }
  return Object.freeze({ state: "observed", text });
}

function snapshotByteView(
  candidate: unknown,
  maximumBytes: number,
): Uint8Array | "invalid" | "limit_exceeded" {
  if (typeof candidate !== "object" || candidate === null || isProxy(candidate)) {
    return "invalid";
  }
  const prototype = Object.getPrototypeOf(candidate);
  if (prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) return "invalid";
  if (
    typedArrayByteLengthGetter === undefined ||
    typedArrayBufferGetter === undefined ||
    typeof typedArrayValues !== "function" ||
    arrayBufferByteLengthGetter === undefined
  ) {
    return "invalid";
  }

  let byteLength: number;
  try {
    const backingBuffer = Reflect.apply(typedArrayBufferGetter, candidate, []);
    if (Object.getPrototypeOf(backingBuffer) !== ArrayBuffer.prototype) return "invalid";
    Reflect.apply(arrayBufferByteLengthGetter, backingBuffer, []);
    new Uint8Array(backingBuffer, 0, 0);
    Reflect.apply(typedArrayValues, candidate, []);
    byteLength = Reflect.apply(typedArrayByteLengthGetter, candidate, []);
  } catch {
    return "invalid";
  }
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) return "invalid";
  if (byteLength > maximumBytes) return "limit_exceeded";

  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== byteLength) return "invalid";

  const copy = new Uint8Array(byteLength);
  for (let index = 0; index < byteLength; index += 1) {
    const key = String(index);
    if (keys[index] !== key || !Object.hasOwn(descriptors, key)) return "invalid";
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value") ||
      typeof descriptor.value !== "number" ||
      !Number.isInteger(descriptor.value) ||
      descriptor.value < 0 ||
      descriptor.value > 0xff
    ) {
      return "invalid";
    }
    copy[index] = descriptor.value;
  }
  return copy;
}

function isFailureReason(
  value: LinuxRootlessPrivilegeProbeArtifactV1 | FixedLinuxGuestPrivilegeProbeFailureReason,
): value is FixedLinuxGuestPrivilegeProbeFailureReason {
  return typeof value === "string";
}

/**
 * Assembles a fixed raw bundle only. Runtime responses and the resulting bundle
 * are unverified inputs, not collector identity, containment, or qualification
 * evidence. The runtime callback is an internal synchronous capability.
 *
 * @internal
 */
export function assembleFixedLinuxGuestPrivilegeProbe(
  argv: unknown,
  runtimeCandidate: unknown,
): FixedLinuxGuestPrivilegeProbeProgramResult {
  if (!isExactEmptyArgumentArray(argv)) return failed("invalid_invocation");
  const runtime = snapshotRuntime(runtimeCandidate);
  if (runtime === null) return failed("invalid_runtime");
  if (runtime.platform !== "linux" || runtime.architecture !== "x64") {
    return failed("unsupported_runtime");
  }

  const artifacts = new Map<
    FixedLinuxGuestPrivilegeSourceId,
    LinuxRootlessPrivilegeProbeArtifactV1
  >();
  for (const source of FIXED_SOURCES) {
    let candidate: unknown;
    try {
      candidate = Reflect.apply(runtime.read, undefined, [source]);
    } catch {
      return failed("source_read_failed");
    }
    const artifact = snapshotReadResult(candidate, source);
    if (isFailureReason(artifact)) return failed(artifact);
    artifacts.set(source.id, artifact);
  }

  const bundle: LinuxRootlessPrivilegeProbeBundleV1 = Object.freeze({
    schema: "runparity.linux_rootless_privilege_probe_bundle/v1",
    captureView: "guest_probe_process_self",
    platform: Object.freeze({ state: "observed", text: "os=linux\narchitecture=amd64\n" }),
    procSelfStatus: artifacts.get("proc_self_status") as LinuxRootlessPrivilegeProbeArtifactV1,
    procSelfUidMap: artifacts.get("proc_self_uid_map") as LinuxRootlessPrivilegeProbeArtifactV1,
    procSelfGidMap: artifacts.get("proc_self_gid_map") as LinuxRootlessPrivilegeProbeArtifactV1,
    overflowUid: artifacts.get("overflow_uid") as LinuxRootlessPrivilegeProbeArtifactV1,
    overflowGid: artifacts.get("overflow_gid") as LinuxRootlessPrivilegeProbeArtifactV1,
  });
  return Object.freeze({ kind: "assembled_unverified_bundle", bundle });
}

/** @internal Renders the fixed helper stdout/stderr contract without side effects. */
export function renderFixedLinuxGuestPrivilegeProbeResult(
  result: FixedLinuxGuestPrivilegeProbeProgramResult,
): FixedLinuxGuestPrivilegeProbeRenderedResult {
  if (result.kind === "assembled_unverified_bundle") {
    const stdout = `${JSON.stringify(result.bundle)}\n`;
    if (Buffer.byteLength(stdout) <= OUTPUT_LIMIT_BYTES) {
      return Object.freeze({ exitCode: 0, stdout, stderr: "" });
    }
    const output = FAILURE_OUTPUT.output_limit_exceeded;
    return Object.freeze({ exitCode: output.exitCode, stdout: "", stderr: output.stderr });
  }
  const output = FAILURE_OUTPUT[result.reason];
  return Object.freeze({ exitCode: output.exitCode, stdout: "", stderr: output.stderr });
}
