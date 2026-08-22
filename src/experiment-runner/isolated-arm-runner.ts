import { ARM_ISOLATION_POLICY_V1, buildArmRunArgv } from "../backend/arm-isolation-policy.js";
import { canonicalSha256Hex } from "../backend/digest.js";
import type { BackendTransport } from "../backend/ssh-backend-transport.js";

/**
 * IsolatedArmRunner: creates and destroys one fresh arm container through the
 * qualified backend transport. It records bounded arm evidence and cleanup
 * evidence; it never decides a verdict.
 */

export type ArmIdentity = "A1" | "B" | "A2";

export type ArmRunRequest = Readonly<{
  identity: ArmIdentity;
  sequenceIndex: number;
  caseSlug: string;
  freshnessId: string;
  environment: Readonly<Record<string, string>>;
  targetArgv: readonly string[];
  workingDirectory: string;
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

export async function runIsolatedArm(
  transport: BackendTransport,
  backend: ArmBackendConfig,
  request: ArmRunRequest,
): Promise<ArmRunRecord> {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/u.test(request.caseSlug)) {
    throw new Error("RP_ARM_RUNNER_INVALID_CASE_SLUG");
  }
  const arm = armName(request);
  const homeDir = `${backend.armsHostRoot.replace(/\/+$/u, "")}/${arm}`;
  const assetsDir = `${backend.assetsHostRoot.replace(/\/+$/u, "")}`;
  const armDeadline = backend.nowNanoseconds() + backend.perArmDeadlineNanoseconds;

  const runSimple = async (_purpose: string, args: readonly string[]): Promise<number | null> => {
    if (backend.nowNanoseconds() >= armDeadline) {
      return null;
    }
    const completion = await transport.run({ args, deadlineNanoseconds: armDeadline });
    return completion.kind === "completed" ? completion.exitCode : null;
  };

  await runSimple(`fresh_home:${arm}`, ["rm", "-rf", homeDir]);
  const mkdirExit = await runSimple(`mkdir_home:${arm}`, ["mkdir", "-p", homeDir]);
  const homeFresh = mkdirExit === 0;

  const argv = buildArmRunArgv({
    armName: arm,
    imageDigestRef: backend.imageDigestRef,
    environment: request.environment,
    assetHostDir: assetsDir,
    armHomeHostDir: homeDir,
    workingDirectory: request.workingDirectory,
    timeoutSeconds: ARM_ISOLATION_POLICY_V1.podman_timeout_seconds,
    targetArgv: request.targetArgv,
    mode: "run",
  });

  const completion = await transport.run({
    args: argv,
    deadlineNanoseconds: armDeadline,
  });

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

  if (completion.kind === "refused") {
    return Object.freeze({
      identity: request.identity,
      sequence_index: request.sequenceIndex,
      freshness_id: request.freshnessId,
      arm_name: arm,
      outcome: "refused",
      refusal_reason: completion.reasonCode,
      exit_code: null,
      stdout: "",
      stderr: "",
      duration_ms: null,
      argv,
      normalized_argv: normalizeArgv(argv, arm, homeDir),
      post_run_container_absent: containerAbsent,
      home_dir_created_fresh: homeFresh,
    });
  }

  return Object.freeze({
    identity: request.identity,
    sequence_index: request.sequenceIndex,
    freshness_id: request.freshnessId,
    arm_name: arm,
    outcome: "completed",
    refusal_reason: null,
    exit_code: completion.exitCode,
    stdout: completion.stdout,
    stderr: completion.stderr,
    duration_ms: completion.durationMs,
    argv,
    normalized_argv: normalizeArgv(argv, arm, homeDir),
    post_run_container_absent: containerAbsent,
    home_dir_created_fresh: homeFresh,
  });
}

export function armArgvDigest(argv: readonly string[]): string {
  return canonicalSha256Hex(argv);
}
