import { canonicalJsonString, sha256Hex } from "../backend/digest.js";
import type { InterventionDescriptor } from "./case-plans.js";
import { evaluateSingleTokenDelta } from "./delta-check.js";
import {
  buildPathShadowingSignature,
  signatureCanonicalJson,
  signatureSha256,
} from "./failure-signature.js";
import { evaluateFrozenOracle } from "./oracle-evaluator.js";
import type { LedgerArmEvidence, VerificationLedgerV1 } from "./proof-ledger.js";

/**
 * ProofLedgerVerifier — the sole module permitted to derive the
 * VERIFIED_INTERVENTION verdict.
 *
 * It trusts nothing embedded in the ledger: signatures, oracle evaluations,
 * and the single-intervention diff are recomputed from the raw bounded
 * observations before any conclusion is drawn. Family adapters, manifests,
 * runner state, and documentation cannot produce this verdict.
 *
 * Legacy compatibility: ledgers produced before the four-delta-kind protocol
 * (intervention without `kind`) are accepted when their type is
 * `path.prepend` with a declared directory; the committed DEV-PATH-001
 * ledger keeps validating unchanged.
 */

export type ProofLedgerVerdict =
  | Readonly<{ verdict: "VERIFIED_INTERVENTION"; ledger_sha256: string }>
  | Readonly<{ verdict: "PARTIAL_EVIDENCE"; ledger_sha256: string; blocking: readonly string[] }>;

type NormalizedDescriptor = Readonly<{
  type: string;
  kind: "path.prepend" | "env.value" | "mount.source" | "argv.token";
  directory?: string;
  envName?: string;
  value?: string;
  containerPath?: string;
  argvFrom?: string;
  argvTo?: string;
}>;

function normalizeDescriptor(
  descriptor: InterventionDescriptor | null | undefined,
): NormalizedDescriptor | null {
  if (descriptor === null || typeof descriptor !== "object") {
    return null;
  }
  const type = typeof descriptor.type === "string" ? descriptor.type : "";
  const kind = descriptor.kind ?? (type === "path.prepend" ? ("path.prepend" as const) : undefined);
  if (kind === undefined) {
    return null;
  }
  return descriptor as NormalizedDescriptor;
}

function recomputeSignature(
  arm: LedgerArmEvidence,
): ReturnType<typeof buildPathShadowingSignature> {
  return buildPathShadowingSignature({
    exit_code: arm.exit_code,
    stdout_lines: arm.stdout_lines,
    stderr_lines: arm.stderr_lines,
  });
}

export function verifyVerificationLedger(ledger: VerificationLedgerV1): ProofLedgerVerdict {
  const blocking: string[] = [];
  const ledgerSha = sha256Hex(canonicalJsonString(ledger));

  if (ledger.schema_version !== "runparity.fixture-verification-ledger/v1") {
    return { verdict: "PARTIAL_EVIDENCE", ledger_sha256: ledgerSha, blocking: ["schema_version"] };
  }
  if (ledger.ledger_kind !== "a1_b_a2" || ledger.repetitions !== 3) {
    blocking.push("repetitions");
  }
  const descriptor = normalizeDescriptor(ledger.intervention);
  if (descriptor === null) {
    blocking.push("intervention_unsupported");
    return {
      verdict: "PARTIAL_EVIDENCE",
      ledger_sha256: ledgerSha,
      blocking: Object.freeze(blocking),
    };
  }
  if (ledger.status !== "passed") {
    blocking.push("ledger_status_not_passed");
  }
  if (
    !ledger.safety.all_arms_completed ||
    !ledger.safety.all_containers_removed ||
    !ledger.safety.all_home_dirs_fresh
  ) {
    blocking.push("safety");
  }
  for (const artifact of ledger.external_artifacts ?? []) {
    if (artifact.verified !== true || artifact.observed_sha256 !== artifact.expected_sha256) {
      blocking.push(`external_artifact_unverified:${artifact.role ?? "?"}`);
    }
  }
  if (ledger.sequences.length !== 3) {
    blocking.push("sequence_count");
    return {
      verdict: "PARTIAL_EVIDENCE",
      ledger_sha256: ledgerSha,
      blocking: Object.freeze(blocking),
    };
  }

  const referenceSignatureJsons = new Set<string>();

  for (const sequence of ledger.sequences) {
    const arms = sequence.arms;
    if (arms.length !== 3) {
      blocking.push(`sequence_${sequence.index}_arm_count`);
      continue;
    }
    const a1 = arms[0] as LedgerArmEvidence;
    const b = arms[1] as LedgerArmEvidence;
    const a2 = arms[2] as LedgerArmEvidence;
    if (
      a1 === undefined ||
      b === undefined ||
      a2 === undefined ||
      a1.identity !== "A1" ||
      b.identity !== "B" ||
      a2.identity !== "A2"
    ) {
      blocking.push(`sequence_${sequence.index}_arm_order`);
      continue;
    }
    for (const arm of arms) {
      if (arm.outcome !== "completed" || arm.exit_code === null) {
        blocking.push(`sequence_${sequence.index}_${arm.identity}_not_completed`);
      }
      if (arm.post_run_container_absent !== true) {
        blocking.push(`sequence_${sequence.index}_${arm.identity}_container_leftover`);
      }
      if (arm.home_dir_created_fresh !== true) {
        blocking.push(`sequence_${sequence.index}_${arm.identity}_stale_home`);
      }
    }

    for (const arm of [a1, a2]) {
      const recomputed = recomputeSignature(arm);
      if (arm.signature === null || arm.signature_sha256 === null) {
        blocking.push(`sequence_${sequence.index}_${arm.identity}_signature_missing`);
        continue;
      }
      if (signatureCanonicalJson(recomputed) !== signatureCanonicalJson(arm.signature)) {
        blocking.push(`sequence_${sequence.index}_${arm.identity}_signature_mismatch`);
      }
      if (signatureSha256(recomputed) !== arm.signature_sha256) {
        blocking.push(`sequence_${sequence.index}_${arm.identity}_signature_digest_mismatch`);
      }
      if (recomputed.exit_code === 0) {
        blocking.push(`sequence_${sequence.index}_${arm.identity}_unexpected_success`);
      }
      if (recomputed.stderr_sentinels.length === 0 && recomputed.stdout_sentinels.length === 0) {
        blocking.push(`sequence_${sequence.index}_${arm.identity}_no_failure_sentinel`);
      }
      referenceSignatureJsons.add(signatureCanonicalJson(recomputed));
    }

    if (b.oracle_evaluation === null) {
      blocking.push(`sequence_${sequence.index}_B_oracle_missing`);
    } else {
      const recomputedOracle = evaluateFrozenOracle(ledger.oracle_frozen, {
        exitCode: b.exit_code,
        stdout: b.stdout_lines.join("\n"),
      });
      if (recomputedOracle.satisfied !== true || b.oracle_evaluation.satisfied !== true) {
        blocking.push(`sequence_${sequence.index}_B_oracle_not_satisfied`);
      }
    }

    const a1a2Equal =
      a1.normalized_argv.length === a2.normalized_argv.length &&
      a1.normalized_argv.every((token, tokenIndex) => token === a2.normalized_argv[tokenIndex]);
    if (!a1a2Equal) {
      blocking.push(`sequence_${sequence.index}_a1_a2_argv_divergence`);
    }
    if (sequence.delta_check.a1_a2_normalized_argv_equal === false) {
      blocking.push(`sequence_${sequence.index}_a1_a2_flag_false`);
    }
    const recomputedDelta = evaluateSingleTokenDelta(
      a1.normalized_argv,
      b.normalized_argv,
      descriptor,
    );
    if (!recomputedDelta.single_token_delta || !recomputedDelta.delta_valid) {
      blocking.push(`sequence_${sequence.index}_intervention_diff_invalid`);
    }
    if (sequence.delta_check.b_single_path_prepend === false) {
      blocking.push(`sequence_${sequence.index}_delta_flag_false`);
    }
    if (
      descriptor.kind === "path.prepend" &&
      typeof descriptor.directory === "string" &&
      sequence.delta_check.prepended_directory !== undefined &&
      sequence.delta_check.prepended_directory !== descriptor.directory
    ) {
      blocking.push(`sequence_${sequence.index}_directory_mismatch`);
    }
  }

  if (referenceSignatureJsons.size !== 1) {
    blocking.push(`failure_signature_unstable_across_arms:${referenceSignatureJsons.size}`);
  }

  if (blocking.length > 0) {
    return {
      verdict: "PARTIAL_EVIDENCE",
      ledger_sha256: ledgerSha,
      blocking: Object.freeze(blocking),
    };
  }
  return { verdict: "VERIFIED_INTERVENTION", ledger_sha256: ledgerSha };
}
