import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { eq, satisfies, valid, validRange } from "semver";
import type { LaunchPlan } from "./command-resolution.js";
import type { CompiledContract } from "./contract.js";
import { readEvidenceFile } from "./evidence-file.js";

export type ObservedRuntime = {
  name: "node";
  version: string;
  source: "controller_executable_identity";
};

export type ObservedPackageManager = {
  name: "npm" | "pnpm";
  version: string;
  source: "adjacent_manifest_bin_binding";
  identity_assurance: "local_manifest_claim";
  manifest_path: string;
  manifest_projection_sha256: string;
};

export type RuntimeDriftFinding = {
  id: "RP-RUNTIME-0001";
  category: "RUNTIME_MANAGER_DRIFT";
  state: "candidate";
  reason_code: "RP_NODE_OUTSIDE_DECLARED_RANGE";
  title: string;
  observed: string;
  expected: string;
  intervention: {
    type: "runtime.select";
    mode: "preview_only";
    selector: string;
  };
  limitations: string[];
};

export type PathShadowingFinding = {
  id: "RP-PATH-0001";
  category: "PATH_SHADOWING";
  state: "candidate";
  reason_code: "RP_MULTIPLE_EXECUTABLE_CANDIDATES";
  title: string;
  selected: string;
  alternatives: string[];
  intervention: null;
  limitations: string[];
};

export type NativeAbiMismatchFinding = {
  id: "RP-NATIVE-0001";
  category: "NATIVE_ABI_ARCH_MISMATCH";
  state: "supported";
  reason_code: "RP_NODE_MODULE_VERSION_MISMATCH";
  title: string;
  observed_module_abi: number;
  required_runtime_abi: number;
  source: "target_output";
  intervention: null;
  limitations: string[];
};

export type PackageManagerDriftFinding = {
  id: "RP-RUNTIME-0002";
  category: "RUNTIME_MANAGER_DRIFT";
  state: "candidate";
  reason_code: "RP_PACKAGE_MANAGER_NAME_MISMATCH" | "RP_PACKAGE_MANAGER_VERSION_MISMATCH";
  title: string;
  observed: {
    name: string;
    version: string;
  };
  expected: {
    name: string;
    version: string;
  };
  intervention: {
    type: "runtime.select";
    mode: "preview_only";
    selector: string;
  };
  limitations: string[];
};

export type Finding =
  | RuntimeDriftFinding
  | PackageManagerDriftFinding
  | PathShadowingFinding
  | NativeAbiMismatchFinding;

const FINDING_PRIORITY: Record<Finding["id"], number> = {
  "RP-NATIVE-0001": 0,
  "RP-RUNTIME-0001": 1,
  "RP-RUNTIME-0002": 2,
  "RP-PATH-0001": 3,
};

export function rankFindings(findings: readonly Finding[]): Finding[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort(
      (left, right) =>
        FINDING_PRIORITY[left.finding.id] - FINDING_PRIORITY[right.finding.id] ||
        left.index - right.index,
    )
    .slice(0, 3)
    .map(({ finding }) => finding);
}

function sameFile(left: string, right: string): boolean {
  try {
    const canonicalLeft = realpathSync.native(left);
    const canonicalRight = realpathSync.native(right);
    return process.platform === "win32"
      ? canonicalLeft.toLowerCase() === canonicalRight.toLowerCase()
      : canonicalLeft === canonicalRight;
  } catch {
    return false;
  }
}

export function observeRuntime(launch: LaunchPlan): ObservedRuntime | null {
  const executableName = basename(launch.executablePath).toLowerCase();
  if (executableName !== "node" && executableName !== "node.exe") return null;
  if (!sameFile(launch.executablePath, process.execPath)) return null;

  return {
    name: "node",
    version: process.versions.node,
    source: "controller_executable_identity",
  };
}

function managerCommand(requestedProgram: string): "npm" | "npx" | "pnpm" | "pnpx" | null {
  const command = basename(requestedProgram)
    .toLowerCase()
    .replace(/\.(?:bat|cmd|exe)$/u, "");
  return command === "npm" || command === "npx" || command === "pnpm" || command === "pnpx"
    ? command
    : null;
}

export function observePackageManager(launch: LaunchPlan): ObservedPackageManager | null {
  const command = managerCommand(launch.requestedProgram);
  if (command === null || launch.kind !== "recognized_node_shim" || launch.scriptPath === null) {
    return null;
  }
  const name = command === "npm" || command === "npx" ? "npm" : "pnpm";
  if (basename(dirname(launch.scriptPath)).toLowerCase() !== "bin") return null;

  const packageRoot = dirname(dirname(launch.scriptPath));
  const manifestPath = resolve(packageRoot, "package.json");
  const manifestFile = readEvidenceFile({ role: "adjacent_tool_manifest", path: manifestPath });
  if (!manifestFile.ok) return null;
  const bytes = manifestFile.bytes;

  let manifest: unknown;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) return null;
  const packageName = Reflect.get(manifest, "name");
  const version = Reflect.get(manifest, "version");
  if (packageName !== name || typeof version !== "string" || valid(version) === null) return null;
  const bin = Reflect.get(manifest, "bin");
  const declaredBin =
    typeof bin === "string"
      ? command === name
        ? bin
        : null
      : typeof bin === "object" && bin !== null && !Array.isArray(bin)
        ? Reflect.get(bin, command)
        : null;
  if (typeof declaredBin !== "string" || declaredBin.length === 0) return null;
  const declaredScript = resolve(packageRoot, declaredBin);
  if (!sameFile(declaredScript, launch.scriptPath)) return null;
  const projection = JSON.stringify({
    parser_version: "runparity.package-manager-manifest/v1",
    name,
    version,
    command,
    bin: declaredBin,
  });

  return {
    name,
    version,
    source: "adjacent_manifest_bin_binding",
    identity_assurance: "local_manifest_claim",
    manifest_path: manifestFile.path,
    manifest_projection_sha256: createHash("sha256").update(projection).digest("hex"),
  };
}

export function diagnoseRuntimeDrift(
  contract: CompiledContract,
  runtime: ObservedRuntime | null,
): Finding[] {
  if (runtime === null || valid(runtime.version) === null) return [];
  const constraint = contract.constraints.find(
    (candidate) => candidate.subject === "node_runtime" && candidate.name === "node",
  );
  if (constraint === undefined || validRange(constraint.selector) === null) return [];
  if (satisfies(runtime.version, constraint.selector)) return [];

  return [
    {
      id: "RP-RUNTIME-0001",
      category: "RUNTIME_MANAGER_DRIFT",
      state: "candidate",
      reason_code: "RP_NODE_OUTSIDE_DECLARED_RANGE",
      title: "The target Node runtime is outside the repository's declared range",
      observed: runtime.version,
      expected: constraint.selector,
      intervention: {
        type: "runtime.select",
        mode: "preview_only",
        selector: constraint.selector,
      },
      limitations: [
        "package.json engines.node is advisory unless the package manager enforces it",
        "No isolated A1/B/A2 experiment has tested this intervention",
      ],
    },
  ];
}

export function diagnosePackageManagerDrift(
  contract: CompiledContract,
  observed: ObservedPackageManager | null,
): PackageManagerDriftFinding[] {
  if (observed === null) return [];
  const constraint = contract.constraints.find(
    (candidate) => candidate.subject === "package_manager",
  );
  if (constraint === undefined) return [];
  const expectedName = constraint.name.toLowerCase();
  const expectedVersion = constraint.selector;
  const nameMismatch = observed.name !== expectedName;
  if (!nameMismatch && (valid(expectedVersion) === null || eq(observed.version, expectedVersion))) {
    return [];
  }

  return [
    {
      id: "RP-RUNTIME-0002",
      category: "RUNTIME_MANAGER_DRIFT",
      state: "candidate",
      reason_code: nameMismatch
        ? "RP_PACKAGE_MANAGER_NAME_MISMATCH"
        : "RP_PACKAGE_MANAGER_VERSION_MISMATCH",
      title: nameMismatch
        ? "The invoked package manager differs from the repository contract"
        : "The invoked package-manager version differs from the repository contract",
      observed: { name: observed.name, version: observed.version },
      expected: { name: expectedName, version: expectedVersion },
      intervention: {
        type: "runtime.select",
        mode: "preview_only",
        selector: `${expectedName}@${expectedVersion}`,
      },
      limitations: [
        "The packageManager field identifies project intent but does not prove this drift caused the failure",
        "The observed version is a local manifest claim bound to the invoked script, not publisher authentication",
        "No isolated A1/B/A2 experiment has tested this package-manager selection",
      ],
    },
  ];
}

export function diagnosePathShadowing(launch: {
  candidates: readonly string[];
}): PathShadowingFinding[] {
  const [selected, ...alternatives] = launch.candidates;
  if (selected === undefined || alternatives.length === 0) return [];

  return [
    {
      id: "RP-PATH-0001",
      category: "PATH_SHADOWING",
      state: "candidate",
      reason_code: "RP_MULTIPLE_EXECUTABLE_CANDIDATES",
      title: "PATH resolution selected one of multiple executable candidates",
      selected,
      alternatives,
      intervention: null,
      limitations: [
        "Multiple candidates do not establish that the selected executable caused the failure",
        "No qualified reference identifies which candidate is intended",
        "No isolated A1/B/A2 experiment has tested a PATH intervention",
      ],
    },
  ];
}

export function diagnoseNativeAbiMismatch(output: string): NativeAbiMismatchFinding[] {
  const match = output.match(
    /NODE_MODULE_VERSION\s+(\d+)[\s\S]{0,500}?requires\s+NODE_MODULE_VERSION\s+(\d+)/i,
  );
  const observedModuleAbi = Number(match?.[1]);
  const requiredRuntimeAbi = Number(match?.[2]);
  if (
    !Number.isSafeInteger(observedModuleAbi) ||
    !Number.isSafeInteger(requiredRuntimeAbi) ||
    observedModuleAbi === requiredRuntimeAbi
  ) {
    return [];
  }

  return [
    {
      id: "RP-NATIVE-0001",
      category: "NATIVE_ABI_ARCH_MISMATCH",
      state: "supported",
      reason_code: "RP_NODE_MODULE_VERSION_MISMATCH",
      title: "The loaded native module ABI differs from the active runtime ABI",
      observed_module_abi: observedModuleAbi,
      required_runtime_abi: requiredRuntimeAbi,
      source: "target_output",
      intervention: null,
      limitations: [
        "The target output does not identify which native artifact was loaded",
        "Rebuilding with the wrong Node or Electron runtime can preserve the mismatch",
        "No isolated A1/B/A2 experiment has tested a native-artifact intervention",
      ],
    },
  ];
}
