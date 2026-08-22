import { describe, expect, test } from "vitest";
import type { ProcessCleanup } from "../src/process-observer.js";
import { classifyHostOutcome, decideHostOutcome } from "../src/verdict.js";

const cleanup = (
  status: ProcessCleanup["status"],
  attempted = status !== "not_required",
): ProcessCleanup => ({
  attempted,
  status,
  containment: "uncontained_host",
  strategy: attempted ? "windows_taskkill" : null,
  reason_code:
    status === "failed"
      ? "RP_PROCESS_TREE_CLEANUP_FAILED"
      : status === "best_effort"
        ? "RP_PROCESS_TREE_NOT_CONTAINED"
        : null,
});

describe("deterministic Host Observe verdict policy", () => {
  test.each([
    {
      name: "failed target",
      input: {
        started: true,
        exitCode: 23,
        timedOut: false,
        timeoutPhase: null,
        cleanup: cleanup("not_required"),
      },
      expected: {
        reportStatus: "failure_observed",
        resultStatus: "failed",
        verdict: "PARTIAL_EVIDENCE",
        experimentReasonCode: "RP_PROOF_NOT_REQUESTED",
        warningCodes: ["RP_REFERENCE_NOT_FOUND"],
      },
    },
    {
      name: "successful target",
      input: {
        started: true,
        exitCode: 0,
        timedOut: false,
        timeoutPhase: null,
        cleanup: cleanup("not_required"),
      },
      expected: {
        reportStatus: "success_observed",
        resultStatus: "passed",
        verdict: "INCONCLUSIVE",
        experimentReasonCode: "RP_FAILURE_NOT_OBSERVED",
        warningCodes: ["RP_FAILURE_NOT_OBSERVED"],
      },
    },
    {
      name: "deadline expired before launch",
      input: {
        started: false,
        exitCode: null,
        timedOut: true,
        timeoutPhase: "before_launch",
        cleanup: cleanup("not_required"),
      },
      expected: {
        reportStatus: "observation_deadline_expired",
        resultStatus: "deadline_expired_before_launch",
        verdict: "INCONCLUSIVE",
        experimentReasonCode: "RP_OBSERVATION_DEADLINE_EXPIRED",
        warningCodes: ["RP_OBSERVATION_DEADLINE_EXPIRED"],
      },
    },
    {
      name: "uncontained execution timeout",
      input: {
        started: true,
        exitCode: null,
        timedOut: true,
        timeoutPhase: "execution",
        cleanup: cleanup("best_effort"),
      },
      expected: {
        reportStatus: "execution_timed_out",
        resultStatus: "timed_out",
        verdict: "ABORTED_SAFETY",
        experimentReasonCode: "RP_PROCESS_TREE_NOT_CONTAINED",
        warningCodes: ["RP_TARGET_TIMEOUT", "RP_PROCESS_TREE_NOT_CONTAINED"],
      },
    },
    {
      name: "failed timeout cleanup",
      input: {
        started: true,
        exitCode: null,
        timedOut: true,
        timeoutPhase: "execution",
        cleanup: cleanup("failed"),
      },
      expected: {
        reportStatus: "execution_timed_out",
        resultStatus: "timed_out",
        verdict: "ABORTED_SAFETY",
        experimentReasonCode: "RP_PROCESS_TREE_CLEANUP_FAILED",
        warningCodes: ["RP_TARGET_TIMEOUT", "RP_PROCESS_TREE_CLEANUP_FAILED"],
      },
    },
  ] as const)("classifies $name", ({ input, expected }) => {
    expect(decideHostOutcome(classifyHostOutcome(input))).toEqual(expected);
  });

  test.each([
    {
      name: "a process that never started cannot pass",
      input: {
        started: false,
        exitCode: 0,
        timedOut: false,
        timeoutPhase: null,
        cleanup: cleanup("not_required"),
      },
    },
    {
      name: "before-launch timeout cannot describe a started process",
      input: {
        started: true,
        exitCode: null,
        timedOut: true,
        timeoutPhase: "before_launch",
        cleanup: cleanup("not_required"),
      },
    },
    {
      name: "a non-timeout cannot carry an execution timeout phase",
      input: {
        started: true,
        exitCode: 0,
        timedOut: false,
        timeoutPhase: "execution",
        cleanup: cleanup("not_required"),
      },
    },
    {
      name: "a Host execution timeout requires a cleanup attempt",
      input: {
        started: true,
        exitCode: null,
        timedOut: true,
        timeoutPhase: "execution",
        cleanup: cleanup("not_required"),
      },
    },
    {
      name: "uncontained Host cleanup cannot claim verified",
      input: {
        started: true,
        exitCode: null,
        timedOut: true,
        timeoutPhase: "execution",
        cleanup: cleanup("verified"),
      },
    },
  ] as const)("rejects $name", ({ input }) => {
    expect(() => classifyHostOutcome(input)).toThrowError(/RP_INVALID_HOST_OUTCOME/u);
  });
});
