import { describe, expect, test } from "vitest";
import {
  applyProofRefusal,
  decideProofRefusal,
  type ProofRefusalEnvelopeShape,
} from "../src/proof-refusal.js";

function envelopeWith(verdict: string, reasons: string[] = []): ProofRefusalEnvelopeShape {
  return {
    data: {
      report: {
        verdict,
        experiment: { status: "not_attempted", reason_codes: reasons },
      },
    },
  };
}

describe("proof-request refusal decision", () => {
  test("windows and macOS hosts are refused as unsupported platform isolation", () => {
    expect(decideProofRefusal("win32", "PARTIAL_EVIDENCE")).toEqual({
      refused: true,
      reasonCode: "RP_UNSUPPORTED_PLATFORM_ISOLATION",
    });
    expect(decideProofRefusal("darwin", "INCONCLUSIVE")).toEqual({
      refused: true,
      reasonCode: "RP_UNSUPPORTED_PLATFORM_ISOLATION",
    });
  });

  test("linux hosts without a wired backend are refused as sandbox unavailable", () => {
    expect(decideProofRefusal("linux", "PARTIAL_EVIDENCE")).toEqual({
      refused: true,
      reasonCode: "RP_SANDBOX_UNAVAILABLE",
    });
  });

  test("safety aborts and deadline errors keep their verdict", () => {
    expect(decideProofRefusal("win32", "ABORTED_SAFETY")).toEqual({ refused: false });
    expect(decideProofRefusal("linux", "REFUSED_OUT_OF_SCOPE")).toEqual({ refused: false });
  });
});

describe("proof-request refusal envelope transform", () => {
  test("overwrites the verdict and appends the refusal reason once", () => {
    const envelope = envelopeWith("PARTIAL_EVIDENCE", ["RP_REFERENCE_NOT_FOUND"]);
    const refused = applyProofRefusal(envelope, {
      refused: true,
      reasonCode: "RP_UNSUPPORTED_PLATFORM_ISOLATION",
    });
    expect(refused.data.report.verdict).toBe("REFUSED_OUT_OF_SCOPE");
    expect(refused.data.report.experiment.reason_codes).toEqual([
      "RP_REFERENCE_NOT_FOUND",
      "RP_UNSUPPORTED_PLATFORM_ISOLATION",
    ]);
    // idempotent on re-application
    const twice = applyProofRefusal(refused, {
      refused: true,
      reasonCode: "RP_UNSUPPORTED_PLATFORM_ISOLATION",
    });
    expect(twice.data.report.experiment.reason_codes).toHaveLength(2);
  });

  test("does not mutate the input envelope", () => {
    const envelope = envelopeWith("PARTIAL_EVIDENCE", []);
    applyProofRefusal(envelope, {
      refused: true,
      reasonCode: "RP_SANDBOX_UNAVAILABLE",
    });
    expect(envelope.data.report.verdict).toBe("PARTIAL_EVIDENCE");
  });

  test("a non-refusal returns the envelope unchanged", () => {
    const envelope = envelopeWith("ABORTED_SAFETY", []);
    const same = applyProofRefusal(envelope, { refused: false });
    expect(same).toBe(envelope);
  });
});
