import { canonicalJsonString, sha256Hex } from "../backend/digest.js";
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
 */

export type ProofLedgerVerdict =
  | Readonly<{ verdict: "VERIFIED_INTERVENTION"; ledger_sha256: string }>
  | Readonly<{ verdict: "PARTIAL_EVIDENCE"; ledger_sha256: string; blocking: readonly string[] }>;

function recomputeSignature(
  arm: LedgerArmEvidence,
): ReturnType<typeof buildPathShadowingSignature> {
  return buildPathShadowingSignature({
    exit_code: arm.exit_code,
    stdout_lines: arm.stdout_lines,
    stderr_lines: arm.stderr_lines,
  });
}

function pathEnvToken(argv: readonly string[]): string | null {
  let expectingValue = false;
  for (const token of argv) {
    if (token === "-e") {
      expectingValue = true;
      continue;
    }
    if (expectingValue) {
      if (token.startsWith("PATH=")) {
        return token;
      }
      expectingValue = false;
    }
  }
  return null;
}

function argvDifferOnlyAtPath(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let differences = 0;
  for (let index = 0; index < a.length; index += 1) {
    if ((a[index] ?? "") !== (b[index] ?? "")) {
      differences += 1;
    }
  }
  return differences === 1;
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
  if (ledger.intervention.type !== "path.prepend") {
    blocking.push("intervention_type");
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
    const [first, second, third] = sequence.arms;
    const a1 = first as LedgerArmEvidence;
    const b = second as LedgerArmEvidence;
    const a2 = third as LedgerArmEvidence;
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

    if (!sequence.delta_check.a1_a2_normalized_argv_equal) {
      blocking.push(`sequence_${sequence.index}_a1_a2_argv_divergence`);
    }
    const recomputedSingleDelta =
      argvDifferOnlyAtPath(a1.normalized_argv, b.normalized_argv) &&
      pathEnvToken(b.normalized_argv) !== null &&
      (pathEnvToken(b.normalized_argv) ?? "").endsWith(
        `:${(pathEnvToken(a1.normalized_argv) ?? "").slice("PATH=".length)}`,
      ) &&
      (pathEnvToken(b.normalized_argv) ?? "").startsWith(`PATH=${ledger.intervention.directory}:`);
    if (!recomputedSingleDelta || !sequence.delta_check.b_single_path_prepend) {
      blocking.push(`sequence_${sequence.index}_intervention_diff_invalid`);
    }
    if (sequence.delta_check.prepended_directory !== ledger.intervention.directory) {
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
