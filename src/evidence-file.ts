import type { Stats } from "node:fs";
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

type WorkspaceEvidenceRole = "workspace_contract" | "workspace_config";
type ExternalEvidenceRole = "resolved_launcher" | "adjacent_tool_manifest";

export type EvidenceFileRequest =
  | { role: WorkspaceEvidenceRole; root: string }
  | { role: ExternalEvidenceRole; path: string };

export type EvidenceFileFailureReason =
  | "missing"
  | "unsafe_type"
  | "outside_workspace"
  | "too_large"
  | "changed_during_read"
  | "unreadable";

export type EvidenceFileRead =
  | {
      ok: true;
      path: string;
      bytes: Buffer;
      identity: {
        device: number;
        inode: number;
        size: number;
        modified_ms: number;
      };
    }
  | { ok: false; reason: EvidenceFileFailureReason };

const rolePolicy: Record<
  EvidenceFileRequest["role"],
  { filename: string | null; maxBytes: number; workspaceContained: boolean }
> = {
  workspace_contract: {
    filename: "package.json",
    maxBytes: 1024 * 1024,
    workspaceContained: true,
  },
  workspace_config: {
    filename: ".npmrc",
    maxBytes: 64 * 1024,
    workspaceContained: true,
  },
  resolved_launcher: {
    filename: null,
    maxBytes: 64 * 1024,
    workspaceContained: false,
  },
  adjacent_tool_manifest: {
    filename: null,
    maxBytes: 1024 * 1024,
    workspaceContained: false,
  },
};

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    Reflect.get(error, "code") === "ENOENT"
  );
}

function resolveRequestPath(request: EvidenceFileRequest): string {
  const policy = rolePolicy[request.role];
  if ("root" in request) return resolve(request.root, policy.filename ?? "");
  return resolve(request.path);
}

export function readEvidenceFile(request: EvidenceFileRequest): EvidenceFileRead {
  const policy = rolePolicy[request.role];
  const candidate = resolveRequestPath(request);
  let initial: Stats;
  try {
    initial = lstatSync(candidate);
  } catch (error) {
    return { ok: false, reason: isMissing(error) ? "missing" : "unreadable" };
  }
  if (!initial.isFile() || initial.isSymbolicLink()) {
    return { ok: false, reason: "unsafe_type" };
  }

  let canonicalPath: string;
  try {
    canonicalPath = realpathSync.native(candidate);
    if (policy.workspaceContained && "root" in request) {
      const canonicalRoot = realpathSync.native(request.root);
      const relativePath = relative(canonicalRoot, canonicalPath);
      if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
        return { ok: false, reason: "outside_workspace" };
      }
    }
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  let descriptor: number | null = null;
  try {
    descriptor = openSync(canonicalPath, "r");
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.dev !== initial.dev || before.ino !== initial.ino) {
      return { ok: false, reason: "changed_during_read" };
    }
    if (before.size > policy.maxBytes) return { ok: false, reason: "too_large" };

    const buffer = Buffer.allocUnsafe(policy.maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset > policy.maxBytes) return { ok: false, reason: "too_large" };

    const after = fstatSync(descriptor);
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    ) {
      return { ok: false, reason: "changed_during_read" };
    }
    return {
      ok: true,
      path: canonicalPath,
      bytes: buffer.subarray(0, offset),
      identity: {
        device: after.dev,
        inode: after.ino,
        size: after.size,
        modified_ms: after.mtimeMs,
      },
    };
  } catch {
    return { ok: false, reason: "unreadable" };
  } finally {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // The typed read result remains usable even if descriptor cleanup reports late failure.
      }
    }
  }
}
