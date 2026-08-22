import type { ProcessCleanup } from "./process-observer.js";

export type HostOutcomeInput = {
  started: boolean;
  exitCode: number | null;
  timedOut: boolean;
  timeoutPhase: "before_launch" | "execution" | null;
  cleanup: ProcessCleanup;
};

export type HostReportStatus =
  | "failure_observed"
  | "success_observed"
  | "execution_timed_out"
  | "observation_deadline_expired";

export type HostResultStatus =
  | "failed"
  | "passed"
  | "terminated"
  | "timed_out"
  | "deadline_expired_before_launch";

export type HostVerdict = "PARTIAL_EVIDENCE" | "INCONCLUSIVE" | "ABORTED_SAFETY";

export type HostOutcomeReasonCode =
  | "RP_PROOF_NOT_REQUESTED"
  | "RP_FAILURE_NOT_OBSERVED"
  | "RP_OBSERVATION_DEADLINE_EXPIRED"
  | "RP_TARGET_TIMEOUT"
  | "RP_PROCESS_TREE_NOT_CONTAINED"
  | "RP_PROCESS_TREE_CLEANUP_FAILED";

export type HostWarningCode =
  | "RP_REFERENCE_NOT_FOUND"
  | Exclude<HostOutcomeReasonCode, "RP_PROOF_NOT_REQUESTED">;

export type HostOutcomeDecision = {
  reportStatus: HostReportStatus;
  resultStatus: HostResultStatus;
  verdict: HostVerdict;
  experimentReasonCode: HostOutcomeReasonCode;
  warningCodes: HostWarningCode[];
};

type HostTimeoutCleanup = ProcessCleanup & {
  attempted: true;
  status: "best_effort" | "failed";
  strategy: "posix_process_group" | "windows_taskkill";
  reason_code: "RP_PROCESS_TREE_NOT_CONTAINED" | "RP_PROCESS_TREE_CLEANUP_FAILED";
};

export type HostOutcomeState =
  | { kind: "deadline_expired_before_launch" }
  | { kind: "execution_timed_out"; cleanup: HostTimeoutCleanup }
  | { kind: "completed"; exitCode: number }
  | { kind: "terminated" };

function isNoCleanup(cleanup: ProcessCleanup): boolean {
  return (
    cleanup.containment === "uncontained_host" &&
    cleanup.attempted === false &&
    cleanup.status === "not_required" &&
    cleanup.strategy === null &&
    cleanup.reason_code === null
  );
}

function isHostTimeoutCleanup(cleanup: ProcessCleanup): cleanup is HostTimeoutCleanup {
  if (
    cleanup.containment !== "uncontained_host" ||
    cleanup.attempted !== true ||
    cleanup.strategy === null
  ) {
    return false;
  }
  return (
    (cleanup.status === "best_effort" && cleanup.reason_code === "RP_PROCESS_TREE_NOT_CONTAINED") ||
    (cleanup.status === "failed" && cleanup.reason_code === "RP_PROCESS_TREE_CLEANUP_FAILED")
  );
}

function invalidHostOutcome(): never {
  throw new Error("RP_INVALID_HOST_OUTCOME: contradictory Host Observe process evidence.");
}

export function classifyHostOutcome(input: HostOutcomeInput): HostOutcomeState {
  if (!input.started) {
    if (
      input.exitCode === null &&
      input.timedOut &&
      input.timeoutPhase === "before_launch" &&
      isNoCleanup(input.cleanup)
    ) {
      return { kind: "deadline_expired_before_launch" };
    }
    return invalidHostOutcome();
  }

  if (input.timedOut) {
    if (
      input.exitCode === null &&
      input.timeoutPhase === "execution" &&
      isHostTimeoutCleanup(input.cleanup)
    ) {
      return { kind: "execution_timed_out", cleanup: input.cleanup };
    }
    return invalidHostOutcome();
  }

  if (input.timeoutPhase !== null || !isNoCleanup(input.cleanup)) {
    return invalidHostOutcome();
  }
  return input.exitCode === null
    ? { kind: "terminated" }
    : { kind: "completed", exitCode: input.exitCode };
}

export function decideHostOutcome(state: HostOutcomeState): HostOutcomeDecision {
  switch (state.kind) {
    case "deadline_expired_before_launch":
      return {
        reportStatus: "observation_deadline_expired",
        resultStatus: "deadline_expired_before_launch",
        verdict: "INCONCLUSIVE",
        experimentReasonCode: "RP_OBSERVATION_DEADLINE_EXPIRED",
        warningCodes: ["RP_OBSERVATION_DEADLINE_EXPIRED"],
      };
    case "execution_timed_out": {
      const cleanupReason = state.cleanup.reason_code;
      return {
        reportStatus: "execution_timed_out",
        resultStatus: "timed_out",
        verdict: "ABORTED_SAFETY",
        experimentReasonCode: cleanupReason,
        warningCodes: ["RP_TARGET_TIMEOUT", cleanupReason],
      };
    }
    case "completed":
      return state.exitCode === 0
        ? {
            reportStatus: "success_observed",
            resultStatus: "passed",
            verdict: "INCONCLUSIVE",
            experimentReasonCode: "RP_FAILURE_NOT_OBSERVED",
            warningCodes: ["RP_FAILURE_NOT_OBSERVED"],
          }
        : {
            reportStatus: "failure_observed",
            resultStatus: "failed",
            verdict: "PARTIAL_EVIDENCE",
            experimentReasonCode: "RP_PROOF_NOT_REQUESTED",
            warningCodes: ["RP_REFERENCE_NOT_FOUND"],
          };
    case "terminated":
      return {
        reportStatus: "failure_observed",
        resultStatus: "terminated",
        verdict: "PARTIAL_EVIDENCE",
        experimentReasonCode: "RP_PROOF_NOT_REQUESTED",
        warningCodes: ["RP_REFERENCE_NOT_FOUND"],
      };
  }
}
