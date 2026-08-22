import { describe, expect, test } from "vitest";
import type { LaunchPlan } from "../src/command-resolution.js";
import {
  diagnoseNativeAbiMismatch,
  diagnosePathShadowing,
  type Finding,
  rankFindings,
} from "../src/diagnosis.js";

describe("diagnosis rules", () => {
  test("emits a bounded PATH candidate when resolution found shadowed executables", () => {
    const launch: LaunchPlan = {
      requestedProgram: "tool",
      selectedSearchPath: "/workspace/bin/tool",
      resolvedPath: "/workspace/bin/tool",
      kind: "native_executable",
      executablePath: "/workspace/bin/tool",
      argv0: "tool",
      scriptPath: null,
      args: ["test"],
      candidates: ["/workspace/bin/tool", "/usr/local/bin/tool", "/usr/bin/tool"],
      candidateResolutions: [
        { searchPath: "/workspace/bin/tool", canonicalPath: "/workspace/bin/tool" },
        { searchPath: "/usr/local/bin/tool", canonicalPath: "/usr/local/bin/tool" },
        { searchPath: "/usr/bin/tool", canonicalPath: "/usr/bin/tool" },
      ],
      candidateResolutionsTruncated: false,
      environmentMutations: { set: {}, unset: [] },
    };

    expect(diagnosePathShadowing(launch)).toEqual([
      {
        id: "RP-PATH-0001",
        category: "PATH_SHADOWING",
        state: "candidate",
        reason_code: "RP_MULTIPLE_EXECUTABLE_CANDIDATES",
        title: "PATH resolution selected one of multiple executable candidates",
        selected: "/workspace/bin/tool",
        alternatives: ["/usr/local/bin/tool", "/usr/bin/tool"],
        intervention: null,
        limitations: [
          "Multiple candidates do not establish that the selected executable caused the failure",
          "No qualified reference identifies which candidate is intended",
          "No isolated A1/B/A2 experiment has tested a PATH intervention",
        ],
      },
    ]);
  });

  test("does not create PATH noise when resolution found one executable", () => {
    const launch: LaunchPlan = {
      requestedProgram: "tool",
      selectedSearchPath: "/usr/bin/tool",
      resolvedPath: "/usr/bin/tool",
      kind: "native_executable",
      executablePath: "/usr/bin/tool",
      argv0: "tool",
      scriptPath: null,
      args: [],
      candidates: ["/usr/bin/tool"],
      candidateResolutions: [{ searchPath: "/usr/bin/tool", canonicalPath: "/usr/bin/tool" }],
      candidateResolutionsTruncated: false,
      environmentMutations: { set: {}, unset: [] },
    };

    expect(diagnosePathShadowing(launch)).toEqual([]);
  });

  test("recognizes an explicit Node native-module ABI mismatch without prescribing rebuild", () => {
    const stderr = [
      "The module was compiled against a different Node.js version using",
      "NODE_MODULE_VERSION 127. This version of Node.js requires",
      "NODE_MODULE_VERSION 136. Please try re-compiling or re-installing",
    ].join("\n");

    expect(diagnoseNativeAbiMismatch(stderr)).toEqual([
      {
        id: "RP-NATIVE-0001",
        category: "NATIVE_ABI_ARCH_MISMATCH",
        state: "supported",
        reason_code: "RP_NODE_MODULE_VERSION_MISMATCH",
        title: "The loaded native module ABI differs from the active runtime ABI",
        observed_module_abi: 127,
        required_runtime_abi: 136,
        source: "target_output",
        intervention: null,
        limitations: [
          "The target output does not identify which native artifact was loaded",
          "Rebuilding with the wrong Node or Electron runtime can preserve the mismatch",
          "No isolated A1/B/A2 experiment has tested a native-artifact intervention",
        ],
      },
    ]);
  });

  test("owns stable finding priority and the three-item report limit", () => {
    const findings = [
      {
        id: "RP-PATH-0001",
        category: "PATH_SHADOWING",
        state: "candidate",
        reason_code: "RP_MULTIPLE_EXECUTABLE_CANDIDATES",
        title: "path",
        selected: "/one/tool",
        alternatives: ["/two/tool"],
        intervention: null,
        limitations: [],
      },
      {
        id: "RP-RUNTIME-0002",
        category: "RUNTIME_MANAGER_DRIFT",
        state: "candidate",
        reason_code: "RP_PACKAGE_MANAGER_VERSION_MISMATCH",
        title: "manager",
        observed: { name: "pnpm", version: "8.0.0" },
        expected: { name: "pnpm", version: "9.0.0" },
        intervention: { type: "runtime.select", mode: "preview_only", selector: "pnpm@9.0.0" },
        limitations: [],
      },
      {
        id: "RP-RUNTIME-0001",
        category: "RUNTIME_MANAGER_DRIFT",
        state: "candidate",
        reason_code: "RP_NODE_OUTSIDE_DECLARED_RANGE",
        title: "runtime",
        observed: "20.0.0",
        expected: ">=22",
        intervention: { type: "runtime.select", mode: "preview_only", selector: ">=22" },
        limitations: [],
      },
      {
        id: "RP-NATIVE-0001",
        category: "NATIVE_ABI_ARCH_MISMATCH",
        state: "supported",
        reason_code: "RP_NODE_MODULE_VERSION_MISMATCH",
        title: "native",
        observed_module_abi: 127,
        required_runtime_abi: 136,
        source: "target_output",
        intervention: null,
        limitations: [],
      },
    ] satisfies Finding[];

    expect(rankFindings(findings).map((finding) => finding.id)).toEqual([
      "RP-NATIVE-0001",
      "RP-RUNTIME-0001",
      "RP-RUNTIME-0002",
    ]);
  });
});
