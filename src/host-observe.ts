import { realpathSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { type LaunchPlan, resolveLaunch } from "./command-resolution.js";
import {
  type ObservedPackageManager,
  type ObservedRuntime,
  observePackageManager,
  observeRuntime,
} from "./diagnosis.js";
import { type NpmConfigSourceConflict, observeNpmConfigSourceConflicts } from "./npm-config.js";
import {
  currentProcessController,
  type ObservedProcessResult,
  observeProcess,
  type ProcessController,
} from "./process-observer.js";
import { createRedactionContext, type RedactionContext } from "./redaction.js";

const RUN_SPEC = Symbol("RunParity.RunSpec");

export type RunSpecInput = {
  argv: readonly string[];
  cwd: string;
  workspaceRoot: string;
  environment: Readonly<NodeJS.ProcessEnv>;
  timeoutMs: number;
};

type RunSpecData = Readonly<{
  argv: readonly string[];
  cwd: string;
  workspaceRoot: string;
  workspaceCanonicalRoot: string;
  environment: Readonly<NodeJS.ProcessEnv>;
  timeoutMs: number;
  deadlineNanoseconds: bigint;
  redaction: RedactionContext;
  controller: ProcessController;
}>;

export type RunSpec = Readonly<{
  [RUN_SPEC]: true;
}>;

const runSpecData = new WeakMap<RunSpec, RunSpecData>();

export type ObservedRun = {
  request: {
    argv: string[];
    cwd: string;
    workspaceRoot: string;
    workspaceCanonicalRoot: string;
    timeoutMs: number;
    inputPolicy: "ignored";
    environment: {
      snapshot: "captured";
      valuesSerialized: false;
    };
  };
  launch: ObservedLaunch;
  runtime: ObservedRuntime | null;
  packageManager: ObservedPackageManager | null;
  configSourceConflicts: NpmConfigSourceConflict[];
  process: ObservedProcessResult;
};

export type ObservedLaunch = {
  requestedProgram: string;
  selectedSearchPath: string;
  resolvedPath: string;
  kind: LaunchPlan["kind"];
  executablePath: string;
  argv0: string;
  scriptPath: string | null;
  candidates: string[];
  candidateResolutions: Array<{
    searchPath: string;
    canonicalPath: string;
  }>;
  candidateResolutionsTruncated: boolean;
  environmentMutationNames: {
    set: string[];
    unset: string[];
  };
};

function snapshotEnvironment(source: Readonly<NodeJS.ProcessEnv>): Readonly<NodeJS.ProcessEnv> {
  const entries = Object.entries(source).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  if (process.platform !== "win32") return Object.freeze(Object.fromEntries(entries));

  const selected = new Map<string, [string, string]>();
  entries
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .forEach(([name, value]) => {
      const normalizedName = name.toLowerCase();
      if (!selected.has(normalizedName)) selected.set(normalizedName, [name, value]);
    });
  return Object.freeze(Object.fromEntries(selected.values()));
}

export function captureRunSpec(input: RunSpecInput): RunSpec {
  if (input.argv.length === 0 || input.argv.some((value) => typeof value !== "string")) {
    throw new TypeError("RunSpec argv must contain at least one string.");
  }
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1) {
    throw new RangeError("RunSpec timeoutMs must be a positive safe integer.");
  }

  const cwd = resolvePath(input.cwd);
  const workspaceRoot = resolvePath(input.workspaceRoot);
  const argv = Object.freeze([...input.argv]);
  const environment = snapshotEnvironment(input.environment);
  const redaction = createRedactionContext(argv);
  redaction.learnSensitiveEnvironment(environment);
  const data = Object.freeze({
    argv,
    cwd,
    workspaceRoot,
    workspaceCanonicalRoot: realpathSync.native(workspaceRoot),
    environment,
    timeoutMs: input.timeoutMs,
    deadlineNanoseconds: process.hrtime.bigint() + BigInt(input.timeoutMs) * 1_000_000n,
    redaction,
    controller: currentProcessController(),
  });
  const spec: RunSpec = Object.freeze({
    [RUN_SPEC]: true as const,
  });
  runSpecData.set(spec, data);
  return spec;
}

export async function observeHost(spec: RunSpec): Promise<ObservedRun> {
  const data = runSpecData.get(spec);
  if (data === undefined) throw new TypeError("observeHost requires a captured RunSpec.");
  const { redaction } = data;

  const launch = resolveLaunch(data.argv, data.environment, { cwd: data.cwd });
  redaction.learnSensitiveEnvironment(launch.environmentMutations.set);
  const runtime = observeRuntime(launch);
  const rawPackageManager = observePackageManager(launch);
  const configSourceConflicts = observeNpmConfigSourceConflicts(
    data.argv,
    data.cwd,
    data.environment,
  );
  const process = await observeProcess(
    {
      launch,
      cwd: data.cwd,
      environment: data.environment,
      deadlineNanoseconds: data.deadlineNanoseconds,
      controller: data.controller,
    },
    redaction,
  );

  const request = {
    argv: redaction.redactArgv(data.argv),
    cwd: redaction.redactScalar(data.cwd),
    workspaceRoot: redaction.redactScalar(data.workspaceRoot),
    workspaceCanonicalRoot: redaction.redactScalar(data.workspaceCanonicalRoot),
    timeoutMs: data.timeoutMs,
    inputPolicy: "ignored" as const,
    environment: { snapshot: "captured" as const, valuesSerialized: false as const },
  };
  const observedLaunch: ObservedLaunch = {
    requestedProgram: redaction.redactScalar(launch.requestedProgram),
    selectedSearchPath: redaction.redactScalar(launch.selectedSearchPath),
    resolvedPath: redaction.redactScalar(launch.resolvedPath),
    kind: launch.kind,
    executablePath: redaction.redactScalar(launch.executablePath),
    argv0: redaction.redactScalar(launch.argv0),
    scriptPath: launch.scriptPath === null ? null : redaction.redactScalar(launch.scriptPath),
    candidates: launch.candidates.map(redaction.redactScalar),
    candidateResolutions: launch.candidateResolutions.map((candidate) => ({
      searchPath: redaction.redactScalar(candidate.searchPath),
      canonicalPath: redaction.redactScalar(candidate.canonicalPath),
    })),
    candidateResolutionsTruncated: launch.candidateResolutionsTruncated,
    environmentMutationNames: {
      set: Object.keys(launch.environmentMutations.set).map(redaction.redactText),
      unset: launch.environmentMutations.unset.map(redaction.redactText),
    },
  };
  const packageManager =
    rawPackageManager === null
      ? null
      : {
          ...rawPackageManager,
          manifest_path: redaction.redactScalar(rawPackageManager.manifest_path),
        };

  return redaction.sanitizeStructuredDisplay({
    request,
    launch: observedLaunch,
    runtime,
    packageManager,
    configSourceConflicts,
    process,
  });
}
