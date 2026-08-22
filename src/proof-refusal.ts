/**
 * Proof-request refusal for the public doctor command.
 *
 * `doctor --attempt-proof` asks RunParity to go beyond observation and
 * attempt an isolated causal experiment. The refusal seam is deliberately
 * boring and total in the current prototype:
 *
 * - win32 and darwin have no qualified NATIVE isolation backend, so the
 *   request is refused with REFUSED_OUT_OF_SCOPE /
 *   RP_UNSUPPORTED_PLATFORM_ISOLATION before anything beyond observation
 *   happens;
 * - linux hosts have no experiment backend wired into the public CLI, so
 *   the request is refused with REFUSED_OUT_OF_SCOPE /
 *   RP_SANDBOX_UNAVAILABLE;
 * - a safety abort or pre-launch deadline error keeps its original verdict:
 *   safety failures dominate any proof request.
 *
 * The observation itself is untouched: the target ran exactly as without the
 * flag, and only the terminal verdict and the experiment reason codes record
 * the refusal. Nothing about this can emit VERIFIED_INTERVENTION.
 */

export type ProofRefusalReason = "RP_UNSUPPORTED_PLATFORM_ISOLATION" | "RP_SANDBOX_UNAVAILABLE";

export type ProofRefusalDecision =
  | Readonly<{ refused: true; reasonCode: ProofRefusalReason }>
  | Readonly<{ refused: false }>;

/** Verdicts that represent a completed observation a proof request could
 *  have built upon. Safety aborts and deadline errors keep their verdict. */
const REFUSABLE_VERDICTS: ReadonlySet<string> = new Set(["PARTIAL_EVIDENCE", "INCONCLUSIVE"]);

export function decideProofRefusal(
  platform: NodeJS.Platform,
  terminalVerdict: string,
): ProofRefusalDecision {
  if (!REFUSABLE_VERDICTS.has(terminalVerdict)) {
    return { refused: false };
  }
  if (platform === "win32" || platform === "darwin") {
    return { refused: true, reasonCode: "RP_UNSUPPORTED_PLATFORM_ISOLATION" };
  }
  return { refused: true, reasonCode: "RP_SANDBOX_UNAVAILABLE" };
}

export type ProofRefusalEnvelopeShape = Readonly<{
  data: Readonly<{
    report: Readonly<{
      verdict: string;
      experiment: Readonly<{
        status: string;
        reason_codes: readonly string[];
      }>;
    }>;
  }>;
}>;

export function applyProofRefusal<T extends ProofRefusalEnvelopeShape>(
  envelope: T,
  decision: ProofRefusalDecision,
): T {
  if (!decision.refused) {
    return envelope;
  }
  const clone = structuredClone(envelope) as unknown as {
    data: { report: { verdict: string; experiment: { reason_codes: string[] } } };
  };
  clone.data.report.verdict = "REFUSED_OUT_OF_SCOPE";
  const reasons = clone.data.report.experiment.reason_codes;
  if (!reasons.includes(decision.reasonCode)) {
    reasons.push(decision.reasonCode);
  }
  return clone as unknown as T;
}
