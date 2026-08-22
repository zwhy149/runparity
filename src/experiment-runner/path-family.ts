import type { BackendTransport } from "../backend/ssh-backend-transport.js";
import { type ArmBackendConfig, type ArmRunRecord, runIsolatedArm } from "./isolated-arm-runner.js";

/**
 * PATH_SHADOWING family execution adapter.
 *
 * Maps one fixture case to concrete arm requests without reading the gold
 * label or the expected marker: only the case's declared target argv, PATH
 * ordering, and the single declared intervention directory enter here.
 */

export type PathFamilyCasePlan = Readonly<{
  caseId: string;
  caseSlug: string;
  assetSubdir: string;
  workingDirectory: string;
  targetArgv: readonly string[];
  baseEnvironment: Readonly<Record<string, string>>;
  interventionDirectory: string;
  repetitions: 3;
}>;

export const DEV_PATH_001_PLAN: PathFamilyCasePlan = Object.freeze({
  caseId: "DEV-PATH-001",
  caseSlug: "rp-dev-path-001",
  assetSubdir: "DEV-PATH-001",
  workingDirectory: "/arm/assets",
  targetArgv: Object.freeze(["node", "fixture/assert-node-marker.mjs"]),
  baseEnvironment: Object.freeze({
    PATH: "/arm/assets/wrong-node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: "/home/arm",
    RUNPARITY_FIXTURE_REAL_NODE: "/usr/local/bin/node",
  }),
  interventionDirectory: "/arm/assets/intended-node/bin",
  repetitions: 3,
});

function armEnvironment(
  plan: PathFamilyCasePlan,
  isBaseline: boolean,
): Readonly<Record<string, string>> {
  if (!isBaseline) {
    const base = plan.baseEnvironment;
    if (typeof base["PATH"] !== "string") {
      throw new Error("RP_PATH_FAMILY_PLAN_MISSING_PATH");
    }
    return Object.freeze({
      ...base,
      PATH: `${plan.interventionDirectory}:${base["PATH"]}`,
    });
  }
  return plan.baseEnvironment;
}

export function buildArmRequestsForPlan(
  plan: PathFamilyCasePlan,
  freshnessIds: Readonly<Record<"a1" | "b" | "a2", string>>[],
): Readonly<Parameters<typeof runIsolatedArm>[2]>[] {
  if (freshnessIds.length !== plan.repetitions) {
    throw new Error("RP_PATH_FAMILY_PLAN_REPETITION_MISMATCH");
  }
  const requests: Parameters<typeof runIsolatedArm>[2][] = [];
  for (let sequence = 1; sequence <= plan.repetitions; sequence += 1) {
    const ids = freshnessIds[sequence - 1];
    if (ids === undefined) {
      throw new Error("RP_PATH_FAMILY_PLAN_FRESHNESS_MISSING");
    }
    requests.push(
      {
        identity: "A1",
        sequenceIndex: sequence,
        caseSlug: plan.caseSlug,
        freshnessId: ids.a1,
        environment: armEnvironment(plan, true),
        targetArgv: plan.targetArgv,
        workingDirectory: plan.workingDirectory,
      },
      {
        identity: "B",
        sequenceIndex: sequence,
        caseSlug: plan.caseSlug,
        freshnessId: ids.b,
        environment: armEnvironment(plan, false),
        targetArgv: plan.targetArgv,
        workingDirectory: plan.workingDirectory,
      },
      {
        identity: "A2",
        sequenceIndex: sequence,
        caseSlug: plan.caseSlug,
        freshnessId: ids.a2,
        environment: armEnvironment(plan, true),
        targetArgv: plan.targetArgv,
        workingDirectory: plan.workingDirectory,
      },
    );
  }
  return requests;
}

export async function runPathFamilyExperiment(
  transport: BackendTransport,
  backend: ArmBackendConfig,
  plan: PathFamilyCasePlan,
  freshnessIds: Readonly<Record<"a1" | "b" | "a2", string>>[],
): Promise<ArmRunRecord[]> {
  const requests = buildArmRequestsForPlan(plan, freshnessIds);
  const records: ArmRunRecord[] = [];
  for (const request of requests) {
    records.push(await runIsolatedArm(transport, backend, request));
  }
  return records;
}
