import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { LaunchPlan } from "../src/command-resolution.js";
import type { CompiledContract } from "../src/contract.js";
import {
  diagnosePackageManagerDrift,
  type ObservedPackageManager,
  observePackageManager,
} from "../src/diagnosis.js";

const temporaryDirectories: string[] = [];

function contract(name: string, selector: string): CompiledContract {
  return {
    status: "compiled",
    constraints: [
      {
        subject: "package_manager",
        name,
        selector,
        strength: "required",
        provenance: {
          file: "package.json",
          pointer: "/packageManager",
          projection_sha256: "0".repeat(64),
          parser_version: "runparity.package-json/v1",
        },
      },
    ],
    unresolved: [],
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("package-manager observation and drift", () => {
  test("observes a recognized pnpm shim from its adjacent package manifest", () => {
    const root = mkdtempSync(resolve(tmpdir(), "runparity-manager-observation-"));
    temporaryDirectories.push(root);
    const bin = resolve(root, "bin");
    mkdirSync(bin);
    const scriptPath = resolve(bin, "pnpm.mjs");
    const manifestPath = resolve(root, "package.json");
    writeFileSync(scriptPath, "process.exit(0);");
    writeFileSync(
      manifestPath,
      JSON.stringify({ name: "pnpm", version: "9.15.0", bin: { pnpm: "bin/pnpm.mjs" } }),
    );
    const launch: LaunchPlan = {
      requestedProgram: "pnpm",
      selectedSearchPath: resolve(root, "pnpm.cmd"),
      resolvedPath: resolve(root, "pnpm.cmd"),
      kind: "recognized_node_shim",
      executablePath: process.execPath,
      argv0: process.execPath,
      scriptPath,
      args: [scriptPath],
      candidates: [resolve(root, "pnpm.cmd")],
      candidateResolutions: [
        {
          searchPath: resolve(root, "pnpm.cmd"),
          canonicalPath: resolve(root, "pnpm.cmd"),
        },
      ],
      candidateResolutionsTruncated: false,
      environmentMutations: { set: {}, unset: [] },
    };

    expect(observePackageManager(launch)).toEqual({
      name: "pnpm",
      version: "9.15.0",
      source: "adjacent_manifest_bin_binding",
      identity_assurance: "local_manifest_claim",
      manifest_path: realpathSync.native(manifestPath),
      manifest_projection_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  test("does not trust a neighboring manifest with the wrong package name", () => {
    const root = mkdtempSync(resolve(tmpdir(), "runparity-manager-name-"));
    temporaryDirectories.push(root);
    const bin = resolve(root, "bin");
    mkdirSync(bin);
    const scriptPath = resolve(bin, "pnpm.mjs");
    writeFileSync(scriptPath, "process.exit(0);");
    writeFileSync(
      resolve(root, "package.json"),
      JSON.stringify({ name: "not-pnpm", version: "9.15.0" }),
    );
    const launch: LaunchPlan = {
      requestedProgram: "pnpm",
      selectedSearchPath: resolve(root, "pnpm.cmd"),
      resolvedPath: resolve(root, "pnpm.cmd"),
      kind: "recognized_node_shim",
      executablePath: process.execPath,
      argv0: process.execPath,
      scriptPath,
      args: [scriptPath],
      candidates: [resolve(root, "pnpm.cmd")],
      candidateResolutions: [
        {
          searchPath: resolve(root, "pnpm.cmd"),
          canonicalPath: resolve(root, "pnpm.cmd"),
        },
      ],
      candidateResolutionsTruncated: false,
      environmentMutations: { set: {}, unset: [] },
    };

    expect(observePackageManager(launch)).toBeNull();
  });

  test("does not bind a manifest whose declared bin resolves to another script", () => {
    const root = mkdtempSync(resolve(tmpdir(), "runparity-manager-bin-binding-"));
    temporaryDirectories.push(root);
    const bin = resolve(root, "bin");
    mkdirSync(bin);
    const scriptPath = resolve(bin, "pnpm.mjs");
    writeFileSync(scriptPath, "process.exit(0);");
    writeFileSync(resolve(bin, "other.mjs"), "process.exit(0);");
    writeFileSync(
      resolve(root, "package.json"),
      JSON.stringify({ name: "pnpm", version: "9.15.0", bin: { pnpm: "bin/other.mjs" } }),
    );
    const launch: LaunchPlan = {
      requestedProgram: "pnpm",
      selectedSearchPath: resolve(root, "pnpm.cmd"),
      resolvedPath: resolve(root, "pnpm.cmd"),
      kind: "recognized_node_shim",
      executablePath: process.execPath,
      argv0: process.execPath,
      scriptPath,
      args: [scriptPath],
      candidates: [resolve(root, "pnpm.cmd")],
      candidateResolutions: [
        {
          searchPath: resolve(root, "pnpm.cmd"),
          canonicalPath: resolve(root, "pnpm.cmd"),
        },
      ],
      candidateResolutionsTruncated: false,
      environmentMutations: { set: {}, unset: [] },
    };

    expect(observePackageManager(launch)).toBeNull();
  });

  test("reports an observed package-manager version outside the exact contract", () => {
    const observed: ObservedPackageManager = {
      name: "pnpm",
      version: "8.15.9",
      source: "adjacent_manifest_bin_binding",
      identity_assurance: "local_manifest_claim",
      manifest_path: "/tools/pnpm/package.json",
      manifest_projection_sha256: "1".repeat(64),
    };

    expect(diagnosePackageManagerDrift(contract("pnpm", "9.15.0"), observed)).toEqual([
      expect.objectContaining({
        id: "RP-RUNTIME-0002",
        category: "RUNTIME_MANAGER_DRIFT",
        state: "candidate",
        reason_code: "RP_PACKAGE_MANAGER_VERSION_MISMATCH",
        observed: { name: "pnpm", version: "8.15.9" },
        expected: { name: "pnpm", version: "9.15.0" },
      }),
    ]);
  });

  test("reports a different package manager and stays silent on an exact match", () => {
    const observed: ObservedPackageManager = {
      name: "npm",
      version: "11.1.0",
      source: "adjacent_manifest_bin_binding",
      identity_assurance: "local_manifest_claim",
      manifest_path: "/tools/npm/package.json",
      manifest_projection_sha256: "2".repeat(64),
    };

    expect(diagnosePackageManagerDrift(contract("pnpm", "9.15.0"), observed)).toEqual([
      expect.objectContaining({
        reason_code: "RP_PACKAGE_MANAGER_NAME_MISMATCH",
        observed: { name: "npm", version: "11.1.0" },
        expected: { name: "pnpm", version: "9.15.0" },
      }),
    ]);
    expect(diagnosePackageManagerDrift(contract("npm", "11.1.0"), observed)).toEqual([]);
  });
});
