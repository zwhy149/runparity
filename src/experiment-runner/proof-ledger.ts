import { canonicalJsonString, sha256Hex } from "../backend/digest.js";
import type { CaseFamily, InterventionDescriptor } from "./case-plans.js";
import { evaluateSingleTokenDelta } from "./delta-check.js";
import { buildPathShadowingSignature, signatureSha256 } from "./failure-signature.js";
import type { ArmRunRecord } from "./isolated-arm-runner.js";
import { evaluateFrozenOracle, type FrozenOracleV1 } from "./oracle-evaluator.js";
import type { ExternalArtifactEvidence } from "./run-case.js";

/**
 * ProofLedger assembly and verification.
 *
 * The ledger embeds, for every arm, the bounded observation (exit code plus
 * classified stream lines), the recomputed failure signature, the frozen
 * oracle evaluation for B arms, and the normalized argv. The verifier in
 * proof-ledger-verifier.ts is the only module in this repository allowed to
 * derive the VERIFIED_INTERVENTION verdict, and it re-derives every embedded
 * claim from the raw observations before doing so.
 */

export type LedgerArmEvidence = Readonly<{
  identity: "A1" | "B" | "A2";
  sequence_index: number;
  freshness_id: string;
  arm_name: string;
  outcome: "completed" | "refused";
  exit_code: number | null;
  stdout_lines: readonly string[];
  stderr_lines: readonly string[];
  duration_ms: number | null;
  normalized_argv: readonly string[];
  argv_sha256: string;
  signature: ReturnType<typeof buildPathShadowingSignature> | null;
  signature_sha256: string | null;
  oracle_evaluation: ReturnType<typeof evaluateFrozenOracle> | null;
  post_run_container_absent: boolean | null;
  home_dir_created_fresh: boolean;
  home_prep: readonly (readonly string[])[];
}>;

export type VerificationLedgerV1 = Readonly<{
  schema_version: "runparity.fixture-verification-ledger/v1";
  ledger_kind: "a1_b_a2";
  case_id: string;
  family: string;
  repetitions: 3;
  manifest_sha256: string;
  build_receipt_sha256: string;
  backend_qualification_sha256: string;
  backend_image_digest: string;
  arm_isolation_policy_digest: string;
  oracle_frozen: FrozenOracleV1;
  intervention: InterventionDescriptor;
  external_artifacts: readonly ExternalArtifactEvidence[];
  sequences: readonly Readonly<{
    index: number;
    arms: readonly LedgerArmEvidence[];
    delta_check: Readonly<{
      a1_a2_normalized_argv_equal: boolean;
      single_token_delta: boolean;
      delta_valid: boolean;
      delta_reason: string;
      b_single_path_prepend: boolean;
      prepended_directory: string | null;
    }>;
  }>[];
  safety: Readonly<{
    all_arms_completed: boolean;
    all_containers_removed: boolean;
    all_home_dirs_fresh: boolean;
  }>;
  runner_version: string;
  verified_at: string;
  status: "passed" | "failed";
}>;

const MAX_LEDGER_STREAM_LINES = 16;
const MAX_LEDGER_LINE_BYTES = 256;

function boundedLines(text: string): readonly string[] {
  return Object.freeze(
    text
      .split("\n")
      .map((line) =>
        line.length > MAX_LEDGER_LINE_BYTES ? line.slice(0, MAX_LEDGER_LINE_BYTES) : line,
      )
      .slice(0, MAX_LEDGER_STREAM_LINES),
  );
}

export function armEvidenceFromRunRecord(
  record: ArmRunRecord,
  oracle: FrozenOracleV1,
): LedgerArmEvidence {
  const stdoutLines = boundedLines(record.stdout);
  const stderrLines = boundedLines(record.stderr);
  const observation = {
    exit_code: record.exit_code,
    stdout_lines: stdoutLines,
    stderr_lines: stderrLines,
  };
  const signature = record.identity === "B" ? null : buildPathShadowingSignature(observation);
  const oracleEvaluation =
    record.identity === "B" && record.outcome === "completed"
      ? evaluateFrozenOracle(oracle, { exitCode: record.exit_code, stdout: record.stdout })
      : null;
  return Object.freeze({
    identity: record.identity,
    sequence_index: record.sequence_index,
    freshness_id: record.freshness_id,
    arm_name: record.arm_name,
    outcome: record.outcome,
    exit_code: record.exit_code,
    stdout_lines: stdoutLines,
    stderr_lines: stderrLines,
    duration_ms: record.duration_ms,
    normalized_argv: record.normalized_argv,
    argv_sha256: sha256Hex(canonicalJsonString(record.normalized_argv)),
    signature,
    signature_sha256: signature === null ? null : signatureSha256(signature),
    oracle_evaluation: oracleEvaluation,
    post_run_container_absent: record.post_run_container_absent,
    home_dir_created_fresh: record.home_dir_created_fresh,
    home_prep: record.home_prep,
  });
}

export function buildVerificationLedger(
  input: Readonly<{
    caseId: string;
    family: CaseFamily;
    manifestSha256: string;
    buildReceiptSha256: string;
    backendQualificationSha256: string;
    backendImageDigest: string;
    armIsolationPolicyDigest: string;
    oracle: FrozenOracleV1;
    intervention: InterventionDescriptor;
    externalArtifacts?: readonly ExternalArtifactEvidence[];
    records: readonly ArmRunRecord[];
    runnerVersion: string;
    verifiedAtIso: string;
  }>,
): VerificationLedgerV1 {
  if (input.records.length !== 9) {
    throw new Error("RP_LEDGER_INVALID_RECORD_COUNT");
  }
  const sequences = [1, 2, 3].map((index) => {
    const arms = input.records
      .filter((record) => record.sequence_index === index)
      .sort((left, right) => {
        const order = { A1: 0, B: 1, A2: 2 } as const;
        return order[left.identity] - order[right.identity];
      })
      .map((record) => armEvidenceFromRunRecord(record, input.oracle));
    if (
      arms.length !== 3 ||
      arms[0]?.identity !== "A1" ||
      arms[1]?.identity !== "B" ||
      arms[2]?.identity !== "A2"
    ) {
      throw new Error(`RP_LEDGER_SEQUENCE_${index}_INCOMPLETE`);
    }
    const a1 = arms[0];
    const b = arms[1];
    const a2 = arms[2];
    const a1a2Equal =
      a1.normalized_argv.length === a2.normalized_argv.length &&
      a1.normalized_argv.every((token, tokenIndex) => token === a2.normalized_argv[tokenIndex]);
    const delta = evaluateSingleTokenDelta(
      a1.normalized_argv,
      b.normalized_argv,
      input.intervention,
    );
    return Object.freeze({
      index,
      arms: Object.freeze(arms),
      delta_check: Object.freeze({
        a1_a2_normalized_argv_equal: a1a2Equal,
        single_token_delta: delta.single_token_delta,
        delta_valid: delta.delta_valid,
        delta_reason: delta.reason,
        b_single_path_prepend: delta.delta_valid,
        prepended_directory: input.intervention.directory ?? null,
      }),
    });
  });

  const allArms = input.records;
  return Object.freeze({
    schema_version: "runparity.fixture-verification-ledger/v1",
    ledger_kind: "a1_b_a2",
    case_id: input.caseId,
    family: input.family,
    repetitions: 3,
    manifest_sha256: input.manifestSha256,
    build_receipt_sha256: input.buildReceiptSha256,
    backend_qualification_sha256: input.backendQualificationSha256,
    backend_image_digest: input.backendImageDigest,
    arm_isolation_policy_digest: input.armIsolationPolicyDigest,
    oracle_frozen: Object.freeze({ ...input.oracle }),
    intervention: Object.freeze({ ...input.intervention }),
    external_artifacts: Object.freeze([...(input.externalArtifacts ?? [])]),
    sequences: Object.freeze(sequences),
    safety: Object.freeze({
      all_arms_completed: allArms.every((record) => record.outcome === "completed"),
      all_containers_removed: allArms.every((record) => record.post_run_container_absent === true),
      all_home_dirs_fresh: allArms.every((record) => record.home_dir_created_fresh),
    }),
    runner_version: input.runnerVersion,
    verified_at: input.verifiedAtIso,
    status: "failed",
  });
}

export function verificationLedgerSha256(ledger: VerificationLedgerV1): string {
  return sha256Hex(canonicalJsonString(ledger));
}
