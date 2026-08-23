import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = resolve(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs");
const runParityCli = resolve(repositoryRoot, "src", "cli.ts");
const temporaryDirectories: string[] = [];

function invokeRunParity(
  project: string,
  targetArgv: string[],
  doctorOptions: string[] = [],
  environment: NodeJS.ProcessEnv = process.env,
) {
  return spawnSync(
    process.execPath,
    [tsxCli, runParityCli, "--json", "doctor", ...doctorOptions, "--", ...targetArgv],
    {
      cwd: project,
      encoding: "utf8",
      env: environment,
      shell: false,
    },
  );
}

function invokeRunParityHuman(project: string, targetArgv: string[]) {
  return spawnSync(process.execPath, [tsxCli, runParityCli, "doctor", "--", ...targetArgv], {
    cwd: project,
    encoding: "utf8",
    shell: false,
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("runparity doctor", () => {
  test("reports partial evidence when a failing command has no qualified reference", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-partial-"));
    temporaryDirectories.push(project);
    writeFileSync(
      resolve(project, "package.json"),
      JSON.stringify({ name: "failing-fixture", private: true }),
    );

    const targetProgram = "process.stderr.write('fixture failure\\n'); process.exit(23)";
    const result = invokeRunParity(project, [process.execPath, "-e", targetProgram]);

    expect(result.status).toBe(23);
    expect(result.stderr).toBe("");

    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      schema: "runparity.cli/v1",
      ok: true,
      command: "doctor",
      data: {
        report: {
          schema: "runparity.report/v1",
          status: "failure_observed",
          verdict: "PARTIAL_EVIDENCE",
          execution_context: "HOST_OBSERVATION",
          experiment_progress: "OBSERVED",
          observation: {
            requested_argv: [process.execPath, "-e", targetProgram],
            result: {
              status: "failed",
              exit_code: 23,
              stderr: {
                redacted_excerpt: "fixture failure\n",
              },
            },
          },
          reference: {
            resolution: "not_found",
            qualification: "not_applicable",
          },
          experiment: {
            status: "not_attempted",
          },
        },
      },
      error: null,
      warnings: [
        {
          code: "RP_REFERENCE_NOT_FOUND",
        },
      ],
      meta: {
        cli_version: "0.1.0",
      },
    });
  });

  test("never emits a detected secret from target argv or captured streams in JSON mode", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-redaction-"));
    temporaryDirectories.push(project);
    writeFileSync(
      resolve(project, "package.json"),
      JSON.stringify({ name: "redaction-fixture", private: true }),
    );

    const secret = "ghp_000000000000000000000000000000000000";
    const targetProgram = [
      "process.stdout.write(process.argv[1] + '\\n')",
      "process.stderr.write('Authorization: Bearer ' + process.argv[1] + '\\n')",
      "process.exit(23)",
    ].join(";");
    const result = invokeRunParity(project, [process.execPath, "-e", targetProgram, secret]);

    expect(result.status).toBe(23);
    expect(result.stdout).not.toContain(secret);

    const output = JSON.parse(result.stdout);
    expect(output.data.report.observation.requested_argv.at(-1)).toBe("[REDACTED]");
    expect(output.data.report.observation.result.stdout.redacted_excerpt).toBe("[REDACTED]\n");
    expect(output.data.report.observation.result.stderr.redacted_excerpt).toBe(
      "Authorization: Bearer [REDACTED]\n",
    );
  });

  test("returns a typed JSON error instead of a stack when the command is missing", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-missing-command-"));
    temporaryDirectories.push(project);
    const missingCommand = `runparity-command-that-does-not-exist-${process.pid}`;

    const result = invokeRunParity(project, [missingCommand]);

    expect(result.status).toBe(69);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("at ");
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: "runparity.cli/v1",
      ok: false,
      command: "doctor",
      data: null,
      error: {
        code: "RP_COMMAND_NOT_FOUND",
        retryable: false,
      },
      warnings: [],
    });
  });

  test("drains large output while keeping a bounded excerpt and full digest", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-large-output-"));
    temporaryDirectories.push(project);
    const outputBytes = 1024 * 1024 + 1;
    // writeSync keeps the emitted byte count deterministic across platforms:
    // an async process.stdout.write can still be in flight when the child calls
    // process.exit on POSIX, truncating the emitted stream at the OS level.
    const targetProgram = `require("node:fs").writeSync(1, "x".repeat(${outputBytes})); process.exit(23)`;

    const result = invokeRunParity(project, [process.execPath, "-e", targetProgram]);

    expect(result.status).toBe(23);
    expect(result.stderr).toBe("");
    const output = JSON.parse(result.stdout);
    const captured = output.data.report.observation.result.stdout;
    expect(captured).toMatchObject({
      bytes: outputBytes,
      truncated: true,
      digest: {
        algorithm: "HMAC-SHA-256",
        key_scope: "invocation",
      },
    });
    expect(captured).not.toHaveProperty("sha256");
    expect(captured.digest.value).toMatch(/^[a-f0-9]{64}$/);
    expect(captured.digest.value).not.toBe(
      createHash("sha256").update("x".repeat(outputBytes)).digest("hex"),
    );
    expect(Buffer.byteLength(captured.redacted_excerpt)).toBeLessThanOrEqual(64 * 1024);
  });

  test("keeps stream digests comparable only within one invocation", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-hmac-scope-"));
    temporaryDirectories.push(project);
    const targetProgram =
      'process.stdout.write("same"); process.stderr.write("same"); process.exit(23)';

    const first = invokeRunParity(project, [process.execPath, "-e", targetProgram]);
    const second = invokeRunParity(project, [process.execPath, "-e", targetProgram]);

    const firstReport = JSON.parse(first.stdout).data.report;
    const secondReport = JSON.parse(second.stdout).data.report;
    const firstStdoutDigest = firstReport.observation.result.stdout.digest;
    const firstStderrDigest = firstReport.observation.result.stderr.digest;
    const secondStdoutDigest = secondReport.observation.result.stdout.digest;
    expect(firstStdoutDigest).toEqual(firstStderrDigest);
    expect(firstStdoutDigest.value).not.toBe(secondStdoutDigest.value);
    expect(first.stdout).not.toContain('"key":');
    expect(second.stdout).not.toContain('"key":');
  });

  test("times out a target and returns an inconclusive report", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-timeout-"));
    temporaryDirectories.push(project);
    const targetProgram = "setInterval(() => {}, 1_000)";

    const result = invokeRunParity(
      project,
      [process.execPath, "-e", targetProgram],
      ["--timeout", "100ms"],
    );

    expect(result.status).toBe(74);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        report: {
          status: "execution_timed_out",
          verdict: "ABORTED_SAFETY",
          observation: {
            result: {
              status: "timed_out",
              exit_code: null,
              timed_out: true,
              cleanup: {
                status: "best_effort",
                containment: "uncontained_host",
                reason_code: "RP_PROCESS_TREE_NOT_CONTAINED",
              },
            },
          },
        },
      },
      warnings: [
        {
          code: "RP_TARGET_TIMEOUT",
        },
        {
          code: "RP_PROCESS_TREE_NOT_CONTAINED",
        },
      ],
    });
  });

  test("includes provenance-preserving runtime constraints from package.json", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-contract-"));
    temporaryDirectories.push(project);
    const manifest = JSON.stringify(
      {
        name: "contract-fixture",
        private: true,
        packageManager: "pnpm@9.15.0",
        engines: {
          node: ">=22 <25",
        },
      },
      null,
      2,
    );
    writeFileSync(resolve(project, "package.json"), manifest);
    const targetProgram = "process.exit(23)";

    const result = invokeRunParity(project, [process.execPath, "-e", targetProgram]);

    expect(result.status).toBe(23);
    const output = JSON.parse(result.stdout);
    expect(output.data.report.contract).toEqual({
      status: "compiled",
      constraints: [
        {
          subject: "package_manager",
          name: "pnpm",
          selector: "9.15.0",
          strength: "required",
          provenance: {
            file: "package.json",
            pointer: "/packageManager",
            projection_sha256: createHash("sha256")
              .update(
                JSON.stringify({
                  parser_version: "runparity.package-json/v1",
                  pointer: "/packageManager",
                  value: "pnpm@9.15.0",
                }),
              )
              .digest("hex"),
            parser_version: "runparity.package-json/v1",
          },
        },
        {
          subject: "node_runtime",
          name: "node",
          selector: ">=22 <25",
          strength: "advisory",
          provenance: {
            file: "package.json",
            pointer: "/engines/node",
            projection_sha256: createHash("sha256")
              .update(
                JSON.stringify({
                  parser_version: "runparity.package-json/v1",
                  pointer: "/engines/node",
                  value: ">=22 <25",
                }),
              )
              .digest("hex"),
            parser_version: "runparity.package-json/v1",
          },
        },
      ],
      unresolved: [],
    });
  });

  test("reports a bounded runtime-drift hypothesis when the actual Node violates the Contract", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-runtime-drift-"));
    temporaryDirectories.push(project);
    writeFileSync(
      resolve(project, "package.json"),
      JSON.stringify({
        name: "runtime-drift-fixture",
        private: true,
        engines: { node: ">=99" },
      }),
    );

    const result = invokeRunParity(project, [process.execPath, "-e", "process.exit(23)"]);

    expect(result.status).toBe(23);
    const report = JSON.parse(result.stdout).data.report;
    expect(report.observation.runtime).toEqual({
      name: "node",
      version: process.versions.node,
      source: "controller_executable_identity",
    });
    expect(report.findings).toEqual([
      expect.objectContaining({
        id: "RP-RUNTIME-0001",
        category: "RUNTIME_MANAGER_DRIFT",
        state: "candidate",
        reason_code: "RP_NODE_OUTSIDE_DECLARED_RANGE",
        observed: process.versions.node,
        expected: ">=99",
      }),
    ]);
    expect(report.verdict).toBe("PARTIAL_EVIDENCE");
  });

  test("surfaces an explicit native ABI mismatch without blindly recommending rebuild", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-native-abi-"));
    temporaryDirectories.push(project);
    const targetProgram = [
      "process.stderr.write('The module was compiled using NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 136.\\n')",
      "process.exit(23)",
    ].join(";");

    const result = invokeRunParity(project, [process.execPath, "-e", targetProgram]);

    expect(result.status).toBe(23);
    const report = JSON.parse(result.stdout).data.report;
    expect(report.findings[0]).toMatchObject({
      id: "RP-NATIVE-0001",
      category: "NATIVE_ABI_ARCH_MISMATCH",
      state: "supported",
      reason_code: "RP_NODE_MODULE_VERSION_MISMATCH",
      observed_module_abi: 127,
      required_runtime_abi: 136,
      intervention: null,
    });
    expect(JSON.stringify(report.findings[0]).toLowerCase()).not.toContain("npm rebuild");
    expect(report.verdict).toBe("PARTIAL_EVIDENCE");
  });

  test("records an unqualified config source conflict without inventing effective precedence", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-config-precedence-"));
    temporaryDirectories.push(project);
    writeFileSync(
      resolve(project, "package.json"),
      JSON.stringify({ name: "config-precedence-fixture", private: true }),
    );
    writeFileSync(resolve(project, ".npmrc"), "fund=false\n");
    const bin = resolve(project, "bin");
    mkdirSync(bin);
    const targetScript = resolve(bin, "npm-fixture.mjs");
    writeFileSync(targetScript, "process.exit(23);");
    if (process.platform === "win32") {
      writeFileSync(
        resolve(bin, "npm.cmd"),
        `@echo off\r\n"${process.execPath}" "${targetScript}" %*\r\n`,
      );
    } else {
      const npmExecutable = resolve(bin, "npm");
      writeFileSync(npmExecutable, `#!${process.execPath}\nprocess.exit(23);\n`);
      chmodSync(npmExecutable, 0o755);
    }
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => name.toLowerCase() !== "path"),
    );
    environment["PATH"] = [bin, process.env["PATH"] ?? process.env["Path"] ?? ""].join(delimiter);
    environment["npm_config_fund"] = "true";

    const result = invokeRunParity(project, ["npm", "install"], [], environment);

    expect(result.status).toBe(23);
    const report = JSON.parse(result.stdout).data.report;
    expect(report.observation.config_source_conflicts).toEqual([
      expect.objectContaining({
        command_shape: "npm_like",
        key: "fund",
        values_conflict: true,
        semantics: "unqualified",
      }),
    ]);
    expect(report.observation.config_source_conflicts[0]).not.toHaveProperty("winner_source");
    expect(report.findings).not.toContainEqual(expect.objectContaining({ id: "RP-CONFIG-0001" }));
  });

  test("renders a useful plain-language report without implying a host sandbox or root cause", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-human-report-"));
    temporaryDirectories.push(project);
    writeFileSync(
      resolve(project, "package.json"),
      JSON.stringify({
        name: "human-report-fixture",
        private: true,
        engines: { node: ">=99" },
      }),
    );
    const targetProgram = "process.stderr.write('fixture failure\\n'); process.exit(23)";

    const result = invokeRunParityHuman(project, [process.execPath, "-e", targetProgram]);

    expect(result.status).toBe(23);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("FAIL  Command failed (exit 23)");
    expect(result.stdout).toContain(`Resolved   ${process.execPath}`);
    expect(result.stdout).toContain("Verdict    PARTIAL_EVIDENCE");
    expect(result.stdout).toContain(
      `Candidate  Node ${process.versions.node} is outside the declared range >=99`,
    );
    expect(result.stdout).toContain("fixture failure");
    expect(result.stdout).toContain(
      "The requested command ran on the host and may have its own side effects.",
    );
    expect(result.stdout.toLowerCase()).not.toContain("root cause found");
  });
});
