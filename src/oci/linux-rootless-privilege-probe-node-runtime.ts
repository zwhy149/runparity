import { closeSync, openSync, readSync } from "node:fs";
import { isAbsolute } from "node:path";
import type {
  FixedLinuxGuestPrivilegeProbeRuntime,
  FixedLinuxGuestPrivilegeSourceReadResult,
  FixedLinuxGuestPrivilegeSourceSpec,
} from "./linux-rootless-privilege-probe-program.js";

const MAXIMUM_SOURCE_BYTES = 64 * 1024;
const MISSING = Object.freeze({ kind: "missing" as const });
const FAILED = Object.freeze({ kind: "failed" as const });
const LIMIT_EXCEEDED = Object.freeze({ kind: "limit_exceeded" as const });

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return descriptor !== undefined &&
    Object.hasOwn(descriptor, "value") &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function validSource(source: FixedLinuxGuestPrivilegeSourceSpec): boolean {
  return (
    isAbsolute(source.absolutePath) &&
    Number.isSafeInteger(source.maximumBytes) &&
    source.maximumBytes > 0 &&
    source.maximumBytes <= MAXIMUM_SOURCE_BYTES
  );
}

/**
 * Reads one internally fixed source with a cap+1 buffer. The returned bytes are
 * owned by this adapter. This function does not establish source authenticity.
 *
 * @internal
 */
export function readBoundedLinuxGuestPrivilegeSource(
  source: FixedLinuxGuestPrivilegeSourceSpec,
): FixedLinuxGuestPrivilegeSourceReadResult {
  if (!validSource(source)) return FAILED;

  let descriptor: number;
  try {
    descriptor = openSync(source.absolutePath, "r");
  } catch (error) {
    const code = errorCode(error);
    return code === "ENOENT" || code === "ENOTDIR" ? MISSING : FAILED;
  }

  let result: FixedLinuxGuestPrivilegeSourceReadResult;
  try {
    const buffer = Buffer.allocUnsafe(source.maximumBytes + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const bytesRead = readSync(descriptor, buffer, offset, buffer.byteLength - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    result =
      offset > source.maximumBytes
        ? LIMIT_EXCEEDED
        : Object.freeze({ kind: "observed", bytes: Uint8Array.from(buffer.subarray(0, offset)) });
  } catch {
    result = FAILED;
  }

  try {
    closeSync(descriptor);
  } catch {
    return FAILED;
  }
  return result;
}

/** @internal Captures only the current Node platform/architecture and fixed reader. */
export function createCurrentNodeLinuxGuestPrivilegeProbeRuntime(): FixedLinuxGuestPrivilegeProbeRuntime {
  return Object.freeze({
    platform: process.platform,
    architecture: process.arch,
    read: readBoundedLinuxGuestPrivilegeSource,
  });
}
