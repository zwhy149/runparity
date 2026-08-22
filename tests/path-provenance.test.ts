import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { resolveLaunch } from "../src/command-resolution.js";
import { diagnosePathShadowing } from "../src/diagnosis.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = resolve(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs");
const runParityCli = resolve(repositoryRoot, "src", "cli.ts");
const temporaryDirectories: string[] = [];

function project(prefix: string): string {
  const directory = mkdtempSync(resolve(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function executableName(): string {
  return process.platform === "win32" ? "rp-path-probe.exe" : "rp-path-probe";
}

function searchName(): string {
  return process.platform === "win32" ? "rp-path-probe.EXE" : "rp-path-probe";
}

function makeExecutable(directory: string): string {
  mkdirSync(directory, { recursive: true });
  const executable = resolve(directory, executableName());
  copyFileSync(process.execPath, executable);
  chmodSync(executable, 0o755);
  return executable;
}

function linkDirectory(target: string, alias: string): void {
  symlinkSync(target, alias, process.platform === "win32" ? "junction" : "dir");
}

function pathEnvironment(pathEntries: string[]): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: pathEntries.join(delimiter),
    ...(process.platform === "win32" ? { PATHEXT: ".EXE" } : {}),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("PATH provenance", () => {
  test.runIf(process.platform === "win32")(
    "resolves generic shim forwarding from the matched alias and captured cwd",
    () => {
      const root = project("runparity-shim-lookup-semantics-");
      const targetDirectory = resolve(root, "target");
      const aliasDirectory = resolve(root, "alias");
      mkdirSync(targetDirectory);
      copyFileSync(process.execPath, resolve(targetDirectory, "node.exe"));
      writeFileSync(resolve(targetDirectory, "script.mjs"), "process.exit(23);\n");
      writeFileSync(
        resolve(targetDirectory, "rp-alias.cmd"),
        '@echo off\r\n"%~dp0node.exe" "%~dp0script.mjs" %*\r\n',
      );
      linkDirectory(targetDirectory, aliasDirectory);

      const aliasLaunch = resolveLaunch(
        ["rp-alias"],
        { ...process.env, PATH: aliasDirectory, PATHEXT: ".CMD" },
        { platform: "win32", cwd: root },
      );
      expect(aliasLaunch).toMatchObject({
        selectedSearchPath: resolve(aliasDirectory, "rp-alias.CMD"),
        resolvedPath: realpathSync.native(resolve(targetDirectory, "rp-alias.cmd")),
        executablePath: resolve(aliasDirectory, "node.exe"),
        scriptPath: resolve(aliasDirectory, "script.mjs"),
      });

      const capturedCwd = resolve(root, "captured-cwd");
      const shimBin = resolve(root, "relative-shim-bin");
      mkdirSync(capturedCwd);
      mkdirSync(shimBin);
      copyFileSync(process.execPath, resolve(capturedCwd, "node.exe"));
      writeFileSync(resolve(capturedCwd, "script.mjs"), "process.exit(23);\n");
      writeFileSync(
        resolve(shimBin, "rp-relative.cmd"),
        '@echo off\r\n"node.exe" "script.mjs" %*\r\n',
      );

      const relativeLaunch = resolveLaunch(
        ["rp-relative"],
        { ...process.env, PATH: shimBin, PATHEXT: ".CMD" },
        { platform: "win32", cwd: capturedCwd },
      );
      expect(relativeLaunch.executablePath).toBe(resolve(capturedCwd, "node.exe"));
      expect(relativeLaunch.scriptPath).toBe(resolve(capturedCwd, "script.mjs"));
    },
  );

  test("resolves relative PATH entries against the captured working directory", () => {
    const root = project("runparity-relative-path-");
    const relativeBin = "relative-bin";
    const executable = makeExecutable(resolve(root, relativeBin));

    const launch = resolveLaunch(
      ["rp-path-probe", "-e", "process.exit(23)"],
      pathEnvironment([relativeBin]),
      { cwd: root },
    );

    expect(launch.selectedSearchPath).toBe(resolve(root, relativeBin, searchName()));
    expect(launch.resolvedPath).toBe(realpathSync.native(executable));
  });

  test("records each search path while de-duplicating aliases by canonical target", () => {
    const root = project("runparity-path-aliases-");
    const targetDirectory = resolve(root, "target");
    const firstAlias = resolve(root, "first-alias");
    const secondAlias = resolve(root, "second-alias");
    const executable = makeExecutable(targetDirectory);
    linkDirectory(targetDirectory, firstAlias);
    linkDirectory(targetDirectory, secondAlias);

    const launch = resolveLaunch(
      ["rp-path-probe", "-e", "process.exit(23)"],
      pathEnvironment([firstAlias, secondAlias]),
      { cwd: root },
    );
    const canonicalTarget = realpathSync.native(executable);

    expect(launch).toMatchObject({
      selectedSearchPath: resolve(firstAlias, searchName()),
      resolvedPath: canonicalTarget,
      candidates: [canonicalTarget],
      candidateResolutions: [
        {
          searchPath: resolve(firstAlias, searchName()),
          canonicalPath: canonicalTarget,
        },
        {
          searchPath: resolve(secondAlias, searchName()),
          canonicalPath: canonicalTarget,
        },
      ],
    });
    expect(diagnosePathShadowing(launch)).toEqual([]);
  });

  test("de-duplicates repeated lookup paths and bounds distinct alias provenance", () => {
    const root = project("runparity-path-provenance-bound-");
    const targetDirectory = resolve(root, "target");
    makeExecutable(targetDirectory);
    const alternativeDirectory = resolve(root, "alternative-target");
    makeExecutable(alternativeDirectory);
    const aliases = Array.from({ length: 70 }, (_, index) => resolve(root, `alias-${index}`));
    for (const alias of aliases) linkDirectory(targetDirectory, alias);
    const repeatedAlias = aliases[0];
    if (repeatedAlias === undefined) throw new Error("fixture alias was not created");

    const repeated = resolveLaunch(
      ["rp-path-probe"],
      pathEnvironment(Array.from({ length: 1_000 }, () => repeatedAlias)),
      { cwd: root },
    );
    expect(repeated.candidateResolutions).toHaveLength(1);
    expect(repeated.candidateResolutionsTruncated).toBe(false);

    const bounded = resolveLaunch(
      ["rp-path-probe"],
      pathEnvironment([...aliases, alternativeDirectory]),
      { cwd: root },
    );
    expect(bounded.candidates).toHaveLength(2);
    expect(bounded.candidateResolutions).toHaveLength(64);
    expect(bounded.candidateResolutionsTruncated).toBe(true);
    expect(diagnosePathShadowing(bounded)).toEqual([
      expect.objectContaining({ id: "RP-PATH-0001", state: "candidate" }),
    ]);
  });

  test("reports the selected alias and canonical target without promoting observation to proof", () => {
    const root = project("runparity-path-report-");
    const selectedDirectory = resolve(root, "selected-target");
    const selectedAlias = resolve(root, "selected-alias");
    const alternativeDirectory = resolve(root, "alternative-target");
    const selectedExecutable = makeExecutable(selectedDirectory);
    const alternativeExecutable = makeExecutable(alternativeDirectory);
    linkDirectory(selectedDirectory, selectedAlias);

    const result = spawnSync(
      process.execPath,
      [
        tsxCli,
        runParityCli,
        "--json",
        "doctor",
        "--report-only",
        "--",
        "rp-path-probe",
        "-e",
        "process.stderr.write('RP_PATH_PROBE_FAILURE\\n');process.exit(23)",
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: pathEnvironment([selectedAlias, alternativeDirectory]),
        shell: false,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout).data.report;
    const canonicalSelected = realpathSync.native(selectedExecutable);
    const canonicalAlternative = realpathSync.native(alternativeExecutable);
    expect(report.observation.launch).toMatchObject({
      selected_search_path: resolve(selectedAlias, searchName()),
      resolved_path: canonicalSelected,
      candidates: [canonicalSelected, canonicalAlternative],
      candidate_resolutions: [
        {
          search_path: resolve(selectedAlias, searchName()),
          canonical_path: canonicalSelected,
        },
        {
          search_path: resolve(alternativeDirectory, searchName()),
          canonical_path: canonicalAlternative,
        },
      ],
      candidate_resolutions_truncated: false,
    });
    expect(report).toMatchObject({
      verdict: "PARTIAL_EVIDENCE",
      execution_context: "HOST_OBSERVATION",
      experiment_progress: "OBSERVED",
      reference: {
        resolution: "not_found",
        qualification: "not_applicable",
      },
      experiment: { status: "not_attempted" },
      remediation: { mode: "manual_only", changes: [] },
    });
    expect(report.findings).toEqual([
      expect.objectContaining({
        id: "RP-PATH-0001",
        category: "PATH_SHADOWING",
        state: "candidate",
        intervention: null,
      }),
    ]);

    const humanResult = spawnSync(
      process.execPath,
      [
        tsxCli,
        runParityCli,
        "doctor",
        "--report-only",
        "--",
        "rp-path-probe",
        "-e",
        "process.exit(23)",
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: pathEnvironment([selectedAlias, alternativeDirectory]),
        shell: false,
      },
    );
    expect(humanResult.status).toBe(0);
    expect(humanResult.stdout).toContain(
      `Matched path      ${resolve(selectedAlias, searchName())}`,
    );
    expect(humanResult.stdout).toContain(`Canonical target  ${canonicalSelected}`);
  });

  test.runIf(process.platform !== "win32")(
    "renders hostile path separators as one-line evidence in the human report",
    () => {
      const root = project("runparity-path-single-line-");
      const hostileDirectory = resolve(root, "selected\nVerdict VERIFIED_INTERVENTION\tforged");
      makeExecutable(hostileDirectory);

      const result = spawnSync(
        process.execPath,
        [
          tsxCli,
          runParityCli,
          "doctor",
          "--report-only",
          "--",
          "rp-path-probe",
          "-e",
          "process.exit(23)",
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: pathEnvironment([hostileDirectory]),
          shell: false,
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("\\nVerdict VERIFIED_INTERVENTION\\tforged");
      expect(result.stdout.split("\n")).not.toContain("Verdict VERIFIED_INTERVENTION\tforged");
    },
  );

  test("redacts learned secrets from every serialized path provenance field", () => {
    const secret = "runparity-path-secret-975318642";
    const root = project(`runparity-${secret}-`);
    const targetDirectory = resolve(root, `${secret}-target`);
    const selectedAlias = resolve(root, `${secret}-alias`);
    makeExecutable(targetDirectory);
    linkDirectory(targetDirectory, selectedAlias);
    const targetArguments = ["rp-path-probe", "-e", "process.exit(23)", "--", "--password", secret];
    const environment = pathEnvironment([selectedAlias]);

    const jsonResult = spawnSync(
      process.execPath,
      [tsxCli, runParityCli, "--json", "doctor", "--report-only", "--", ...targetArguments],
      { cwd: root, encoding: "utf8", env: environment, shell: false },
    );

    expect(jsonResult.status).toBe(0);
    expect(jsonResult.stdout).not.toContain(secret);
    const report = JSON.parse(jsonResult.stdout).data.report;
    const launch = report.observation.launch;
    expect(JSON.stringify(launch)).not.toContain(secret);
    expect(launch.selected_search_path).toContain("[REDACTED]");
    expect(launch.resolved_path).toContain("[REDACTED]");
    expect(launch.candidate_resolutions[0]).toMatchObject({
      search_path: expect.stringContaining("[REDACTED]"),
      canonical_path: expect.stringContaining("[REDACTED]"),
    });
    expect(report.findings).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "RP-PATH-0001" })]),
    );

    const htmlResult = spawnSync(
      process.execPath,
      [tsxCli, runParityCli, "--html", "doctor", "--report-only", "--", ...targetArguments],
      { cwd: root, encoding: "utf8", env: environment, shell: false },
    );
    expect(htmlResult.status).toBe(0);
    expect(htmlResult.stdout).not.toContain(secret);
    expect(htmlResult.stdout).toContain("[REDACTED]");
  });
});
