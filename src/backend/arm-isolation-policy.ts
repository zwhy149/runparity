import { canonicalJsonString, sha256Hex } from "./digest.js";
import { isSafeRemoteArg, REMOTE_COMMAND_REJECTION } from "./remote-command.js";

/**
 * Frozen isolation policy for every experiment arm container.
 *
 * This record is the single source of the podman flag set used for
 * qualification probes and A1/B/A2 arms. Its canonical digest binds backend
 * receipts, ledgers, and the safety auditor to one exact policy: any change
 * here changes the digest and invalidates prior receipts by construction.
 *
 * Each field maps to a control that backend qualification must demonstrate
 * (not configure) before any arm may run.
 */
export const ARM_ISOLATION_POLICY_V1 = Object.freeze({
  schema_version: "runparity.arm-isolation-policy/v1",
  network: "none",
  capabilities: "drop_all",
  no_new_privileges: true,
  read_only_root_filesystem: true,
  user_namespace: "keep-id:uid=10001,gid=10001",
  arm_user: "10001:10001",
  pids_limit: 64,
  memory_bytes: 536870912,
  cpus: 1,
  tmpfs: Object.freeze([
    Object.freeze({ target: "/tmp", options: "rw,size=16m,mode=1777", purpose: "scratch" }),
  ]),
  asset_mount_container_path: "/arm/assets",
  asset_mount_options: "ro",
  arm_home_container_path: "/home/arm",
  podman_timeout_seconds: 120,
} as const);

export type ArmIsolationPolicy = typeof ARM_ISOLATION_POLICY_V1;

export function armIsolationPolicyDigest(
  policy: ArmIsolationPolicy = ARM_ISOLATION_POLICY_V1,
): string {
  return sha256Hex(canonicalJsonString(policy));
}

export type ArmRunRequest = Readonly<{
  armName: string;
  imageDigestRef: string;
  environment: Readonly<Record<string, string>>;
  assetHostDir: string;
  armHomeHostDir: string;
  workingDirectory: string;
  timeoutSeconds: number;
  targetArgv: readonly string[];
  /**
   * "run" executes a foreground --rm arm. "bind" starts the same flag set
   * detached (no --rm) so qualification can read kernel-truth /proc facts for
   * the live arm process before destroying it explicitly.
   */
  mode: "run" | "bind";
}>;

function remoteArg(value: string, what: string): string {
  if (!isSafeRemoteArg(value)) {
    throw new Error(`${REMOTE_COMMAND_REJECTION}: ${what} is not a safe remote token`);
  }
  return value;
}

function posixAbsolutePath(value: string, what: string): string {
  if (!value.startsWith("/") || value.includes("//") || value.endsWith("/")) {
    throw new Error(
      `${REMOTE_COMMAND_REJECTION}: ${what} must be a normalized POSIX absolute path`,
    );
  }
  return remoteArg(value, what);
}

/**
 * Build the exact podman argv for one arm. Pure and fail-closed: every
 * generated token must individually pass the remote allowlist before the
 * argv is returned, so no caller can smuggle shell syntax through any
 * request field.
 */
export function buildArmRunArgv(request: ArmRunRequest): string[] {
  const p = ARM_ISOLATION_POLICY_V1;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(request.armName)) {
    throw new Error(`${REMOTE_COMMAND_REJECTION}: arm name must be lowercase slug`);
  }
  if (!/^[\w./:-]+@sha256:[a-f0-9]{64}$/u.test(request.imageDigestRef)) {
    throw new Error(`${REMOTE_COMMAND_REJECTION}: image must be a digest-pinned reference`);
  }
  if (!Number.isSafeInteger(request.timeoutSeconds) || request.timeoutSeconds < 1) {
    throw new Error(`${REMOTE_COMMAND_REJECTION}: timeout must be a positive integer`);
  }
  const assetDir = posixAbsolutePath(request.assetHostDir, "asset host dir");
  const homeDir = posixAbsolutePath(request.armHomeHostDir, "arm home host dir");
  const workdir = posixAbsolutePath(request.workingDirectory, "working directory");

  const argv: string[] = [
    "podman",
    "run",
    ...(request.mode === "run" ? ["--rm"] : ["-d"]),
    "--name",
    remoteArg(request.armName, "arm name"),
    "--network",
    remoteArg(p.network, "network policy"),
    "--cap-drop",
    remoteArg("ALL", "capability drop"),
    "--security-opt",
    remoteArg("no-new-privileges", "security opt"),
    "--read-only",
    "--userns",
    remoteArg(p.user_namespace, "user namespace"),
    "--user",
    remoteArg(p.arm_user, "arm user"),
    "--pids-limit",
    remoteArg(String(p.pids_limit), "pids limit"),
    "--memory",
    remoteArg(String(p.memory_bytes), "memory limit"),
    "--cpus",
    remoteArg(String(p.cpus), "cpu limit"),
  ];
  for (const mount of p.tmpfs) {
    argv.push("--tmpfs", remoteArg(`${mount.target}:${mount.options}`, "tmpfs mount"));
  }
  argv.push(
    "-v",
    remoteArg(
      `${assetDir}:${p.asset_mount_container_path}:${p.asset_mount_options}`,
      "asset mount",
    ),
    "-v",
    remoteArg(`${homeDir}:${p.arm_home_container_path}:rw`, "arm home mount"),
  );
  for (const [name, value] of Object.entries(request.environment)) {
    remoteArg(name, "environment name");
    argv.push("-e", remoteArg(`${name}=${value}`, "environment assignment"));
  }
  argv.push(
    "--workdir",
    workdir,
    "--timeout",
    remoteArg(String(request.timeoutSeconds), "podman timeout"),
    remoteArg(request.imageDigestRef, "image reference"),
  );
  for (const token of request.targetArgv) {
    argv.push(remoteArg(token, "target argv token"));
  }
  return argv;
}
