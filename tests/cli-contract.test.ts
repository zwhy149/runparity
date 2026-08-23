import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = resolve(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs");
const runParityCli = resolve(repositoryRoot, "src", "cli.ts");
const temporaryDirectories: string[] = [];

function invoke(project: string, args: string[], environment: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, [tsxCli, runParityCli, ...args], {
    cwd: project,
    encoding: "utf8",
    env: environment,
    shell: false,
  });
}

function temporaryProject(prefix: string): string {
  const project = mkdtempSync(resolve(tmpdir(), prefix));
  temporaryDirectories.push(project);
  return project;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("machine-readable CLI contract", () => {
  test("returns exactly one JSON error envelope for a missing doctor argv", () => {
    const result = invoke(temporaryProject("runparity-usage-"), ["--json", "doctor"]);

    expect(result.status).toBe(64);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(result.stdout).not.toContain("Usage:");
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: "runparity.cli/v1",
      ok: false,
      command: "doctor",
      data: null,
      error: {
        code: "RP_USAGE_ERROR",
        retryable: false,
      },
      warnings: [],
    });
  });

  test("does not treat a target-side --json after the separator as a global option", () => {
    const result = invoke(temporaryProject("runparity-target-json-option-"), [
      "not-a-command",
      "--",
      "--json",
    ]);

    expect(result.status).toBe(64);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("RunParity:");
  });

  test("keeps parse-time human errors on one evidence line", () => {
    const hostileCommand = "bad\nVerdict    VERIFIED_INTERVENTION\tforged";
    const result = invoke(temporaryProject("runparity-parse-error-single-line-"), [hostileCommand]);

    expect(result.status).toBe(64);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("bad\\nVerdict    VERIFIED_INTERVENTION\\tforged");
    expect(result.stderr.split("\n")).not.toContain("Verdict    VERIFIED_INTERVENTION\tforged'");
  });

  test("passes a target-side --html through without changing the report mode", () => {
    const result = invoke(temporaryProject("runparity-target-html-option-"), [
      "doctor",
      "--",
      process.execPath,
      "-e",
      "process.stdout.write(process.argv[1])",
      "--",
      "--html",
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/^RunParity\r?\n/u);
    expect(result.stdout).toContain("--html");
    expect(result.stdout).not.toContain("<!doctype html>");
  });

  test("requires the target separator before any command can execute", () => {
    const project = temporaryProject("runparity-required-separator-");
    const marker = resolve(project, "target-ran.txt");
    const script = resolve(project, "target.mjs");
    writeFileSync(
      script,
      `await import("node:fs").then(({ writeFileSync }) => writeFileSync(${JSON.stringify(marker)}, "ran"));`,
    );

    const result = invoke(project, ["--json", "doctor", process.execPath, script, "--report-only"]);

    expect(result.status).toBe(64);
    expect(existsSync(marker)).toBe(false);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "RP_USAGE_ERROR" },
    });
  });

  test("rejects a separator placed after target arguments", () => {
    const project = temporaryProject("runparity-misplaced-separator-");
    const marker = resolve(project, "target-ran.txt");
    const script = resolve(project, "target.mjs");
    writeFileSync(
      script,
      `await import("node:fs").then(({ writeFileSync }) => writeFileSync(${JSON.stringify(marker)}, "ran"));`,
    );

    const result = invoke(project, [
      "--json",
      "doctor",
      process.execPath,
      script,
      "--report-only",
      "--",
    ]);

    expect(result.status).toBe(64);
    expect(existsSync(marker)).toBe(false);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "RP_USAGE_ERROR" },
    });
  });

  test("report-only returns zero without hiding the target result in the report", () => {
    const result = invoke(temporaryProject("runparity-report-only-"), [
      "--json",
      "doctor",
      "--report-only",
      "--",
      process.execPath,
      "-e",
      "process.exit(23)",
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        report: {
          status: "failure_observed",
          exit_policy: "report_only",
          observation: {
            result: {
              status: "failed",
              exit_code: 23,
            },
          },
        },
      },
    });
  });

  test("html mode emits one offline escaped report while preserving report-only policy", () => {
    const hostileOutput = '<svg onload="alert(1)">';
    const result = invoke(temporaryProject("runparity-html-report-"), [
      "--html",
      "doctor",
      "--report-only",
      "--",
      process.execPath,
      "-e",
      `process.stdout.write(${JSON.stringify(hostileOutput)});process.exit(23)`,
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/^<!doctype html>/u);
    expect(result.stdout).not.toContain(hostileOutput);
    expect(result.stdout).toContain("&lt;svg onload=&quot;alert(1)&quot;&gt;");
    expect(result.stdout).toContain("Observed failure");
    expect(result.stdout).toContain("Partial evidence");
    expect(result.stdout).toContain("Generated offline · no scripts or external assets");
    expect(result.stdout).not.toContain("http://");
    expect(result.stdout).not.toContain("https://");
  });

  test("json and html output modes conflict before the target can start", () => {
    const project = temporaryProject("runparity-output-mode-conflict-");
    const marker = resolve(project, "target-ran.txt");
    const script = resolve(project, "target.mjs");
    writeFileSync(
      script,
      `await import("node:fs").then(({ writeFileSync }) => writeFileSync(${JSON.stringify(marker)}, "ran"));`,
    );

    const result = invoke(project, ["--json", "--html", "doctor", "--", process.execPath, script]);

    expect(result.status).toBe(64);
    expect(result.stderr).toBe("");
    expect(existsSync(marker)).toBe(false);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        code: "RP_USAGE_ERROR",
        message: "Choose only one report output mode: --json or --html.",
      },
    });
  });

  test("preserves the requested bare program as target argv0", () => {
    const result = invoke(temporaryProject("runparity-argv0-"), [
      "--json",
      "doctor",
      "--",
      "node",
      "-e",
      "process.stdout.write(process.argv0)",
    ]);

    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout).data.report;
    expect(report.observation.launch.argv0).toBe("node");
    expect(report.observation.result.stdout.redacted_excerpt).toBe("node");
  });

  test("marks a successful Host Observe as inconclusive because no failure reproduced", () => {
    const result = invoke(temporaryProject("runparity-success-observed-"), [
      "--json",
      "doctor",
      "--",
      process.execPath,
      "-e",
      "process.exit(0)",
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      data: {
        report: {
          status: "success_observed",
          verdict: "INCONCLUSIVE",
          experiment: {
            status: "not_attempted",
            reason_codes: ["RP_FAILURE_NOT_OBSERVED"],
          },
        },
      },
      warnings: [
        {
          code: "RP_FAILURE_NOT_OBSERVED",
        },
      ],
    });
  });

  test("removes terminal controls before redacting and serializing evidence", () => {
    const obfuscatedSecret = `ghp_\u001b[31m${"0".repeat(36)}`;
    const targetProgram = [
      "process.stdout.write(process.argv[1] + '\\n')",
      "process.stderr.write(String.fromCharCode(27) + ']8;;https://example.invalid' + String.fromCharCode(7) + 'click' + String.fromCharCode(27) + ']8;;' + String.fromCharCode(7) + '\\n')",
      "process.exit(23)",
    ].join(";");
    const result = invoke(temporaryProject("runparity-controls-"), [
      "--json",
      "doctor",
      "--",
      process.execPath,
      "-e",
      targetProgram,
      obfuscatedSecret,
    ]);

    expect(result.status).toBe(23);
    const serialized = result.stdout;
    const report = JSON.parse(serialized).data.report;
    expect(serialized).not.toContain("\\u001b");
    expect(report.observation.requested_argv.at(-1)).toBe("[REDACTED]");
    expect(report.observation.result.stdout.redacted_excerpt).toBe("[REDACTED]\n");
    expect(report.observation.result.stderr.redacted_excerpt).toBe("click\n");
  });

  test("redacts values learned from sensitive target flags everywhere", () => {
    const inlineSecret = "runparity-fixture-secret-123456789";
    const separateSecret = "another-fixture-password-987654321";
    const targetProgram = [
      "process.stdout.write(process.argv.slice(1).join('|'))",
      "process.exit(23)",
    ].join(";");
    const result = invoke(temporaryProject("runparity-sensitive-flags-"), [
      "--json",
      "doctor",
      "--",
      process.execPath,
      "-e",
      targetProgram,
      "--",
      `--token=${inlineSecret}`,
      "--password",
      separateSecret,
    ]);

    expect(result.status).toBe(23);
    expect(result.stdout).not.toContain(inlineSecret);
    expect(result.stdout).not.toContain(separateSecret);
    const report = JSON.parse(result.stdout).data.report;
    expect(report.observation.requested_argv.slice(-3)).toEqual([
      "--token=[REDACTED]",
      "--password",
      "[REDACTED]",
    ]);
    expect(report.observation.result.stdout.redacted_excerpt).toBe(
      "--token=[REDACTED]|--password|[REDACTED]",
    );
  });

  test("learns compound sensitive flags and colon-style Windows switches", () => {
    const refreshSecret = "rp-refresh-credential-987654321";
    const databaseSecret = "rp-database-password-123456789";
    const targetProgram = [
      "process.stdout.write(process.argv.slice(1).join('|'))",
      "process.exit(23)",
    ].join(";");
    const result = invoke(temporaryProject("runparity-compound-sensitive-flags-"), [
      "--json",
      "doctor",
      "--",
      process.execPath,
      "-e",
      targetProgram,
      "--",
      "--refresh-token",
      refreshSecret,
      `/database-password:${databaseSecret}`,
    ]);

    expect(result.status).toBe(23);
    expect(result.stdout).not.toContain(refreshSecret);
    expect(result.stdout).not.toContain(databaseSecret);
    const report = JSON.parse(result.stdout).data.report;
    expect(report.observation.requested_argv.slice(-3)).toEqual([
      "--refresh-token",
      "[REDACTED]",
      "/database-password:[REDACTED]",
    ]);
  });

  test("does not skip a sensitive flag that follows another sensitive flag", () => {
    const secret = "runparity-chained-sensitive-value-987654321";
    const targetProgram = [
      "process.stdout.write(process.argv.slice(1).join('|'))",
      "process.exit(23)",
    ].join(";");
    const result = invoke(temporaryProject("runparity-chained-sensitive-flags-"), [
      "--json",
      "doctor",
      "--",
      process.execPath,
      "-e",
      targetProgram,
      "--",
      "--password",
      "--token",
      secret,
    ]);

    expect(result.status).toBe(23);
    expect(result.stdout).not.toContain(secret);
    expect(JSON.parse(result.stdout).data.report.observation.requested_argv.slice(-3)).toEqual([
      "--password",
      "[REDACTED]",
      "[REDACTED]",
    ]);
  });

  test("learns inherited sensitive environment values before target execution", () => {
    const secret = "runparity-inherited-database-password-987654321";
    const result = invoke(
      temporaryProject("runparity-sensitive-environment-"),
      [
        "--json",
        "doctor",
        "--",
        process.execPath,
        "-e",
        "process.stdout.write(process.env.RP_DATABASE_PASSWORD);process.exit(23)",
      ],
      { ...process.env, RP_DATABASE_PASSWORD: secret },
    );

    expect(result.status).toBe(23);
    expect(result.stdout).not.toContain(secret);
    expect(JSON.parse(result.stdout).data.report.observation.result.stdout.redacted_excerpt).toBe(
      "[REDACTED]",
    );
  });

  test("preserves control-plane schema when a sensitive value is a common short word", () => {
    const result = invoke(temporaryProject("runparity-short-sensitive-value-"), [
      "--json",
      "doctor",
      "--",
      process.execPath,
      "-e",
      "process.stdout.write(process.argv[2]);process.exit(23)",
      "--",
      "--password",
      "runparity",
    ]);

    expect(result.status).toBe(23);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.schema).toBe("runparity.cli/v1");
    expect(envelope.data.report.schema).toBe("runparity.report/v1");
    expect(envelope.data.report.observation.requested_argv.at(-1)).toBe("[REDACTED]");
    expect(envelope.data.report.observation.result.stdout.redacted_excerpt).not.toContain(
      "runparity",
    );
  });

  test("never applies learned-secret replacement to control-plane constants", () => {
    const secret = "runparity.cli";
    const result = invoke(temporaryProject("runparity-control-plane-redaction-"), [
      "--json",
      "doctor",
      "--",
      process.execPath,
      "-e",
      "process.stdout.write(process.argv[2]);process.exit(23)",
      "--",
      "--password",
      secret,
    ]);

    expect(result.status).toBe(23);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.schema).toBe("runparity.cli/v1");
    expect(envelope.data.report.schema).toBe("runparity.report/v1");
    expect(envelope.data.report.observation.requested_argv.at(-1)).toBe("[REDACTED]");
    expect(envelope.data.report.observation.result.stdout.redacted_excerpt).toBe("[REDACTED]");
  });

  test("suppresses a truncated capture when a multiline learned secret crosses the tail", () => {
    const secret = [
      "FIRST-PRIVATE-KEY-LINE-123456789",
      "SECOND-PRIVATE-KEY-LINE-987654321",
      "THIRD-PRIVATE-KEY-LINE-456789123",
    ].join("\n");
    const targetProgram = [
      "const secret = process.argv[2]",
      `process.stdout.write(secret + 'x'.repeat(${64 * 1024} - Buffer.byteLength(secret) + 5))`,
      "process.exitCode = 23",
    ].join(";");
    const result = invoke(temporaryProject("runparity-multiline-secret-boundary-"), [
      "--json",
      "doctor",
      "--",
      process.execPath,
      "-e",
      targetProgram,
      "--",
      "--private-key",
      secret,
    ]);

    expect(result.status).toBe(23);
    expect(result.stdout).not.toContain("SECOND-PRIVATE-KEY-LINE-987654321");
    expect(result.stdout).not.toContain("THIRD-PRIVATE-KEY-LINE-456789123");
    const excerpt = JSON.parse(result.stdout).data.report.observation.result.stdout
      .redacted_excerpt;
    expect(excerpt.includes("[REDACTED_BOUNDARY]") || excerpt.includes("[REDACTED]")).toBe(true);
  });

  test("redacts inline sensitive values from parse-time usage errors", () => {
    const secret = "runparity-parse-error-secret-987654321";
    const result = invoke(temporaryProject("runparity-parse-error-redaction-"), [
      "--json",
      "doctor",
      `--password=${secret}`,
    ]);

    expect(result.status).toBe(64);
    expect(result.stdout).not.toContain(secret);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "RP_USAGE_ERROR" },
    });
  });

  test("does not leak a sensitive flag value split by the excerpt boundary", () => {
    const secret = "runparity-boundary-secret-123456789";
    const targetProgram = [
      `const secret = process.argv[2]`,
      `process.stdout.write(secret + 'x'.repeat(${64 * 1024} - Buffer.byteLength(secret) + 5))`,
      "process.exitCode = 23",
    ].join(";");
    const result = invoke(temporaryProject("runparity-redaction-boundary-"), [
      "--json",
      "doctor",
      "--",
      process.execPath,
      "-e",
      targetProgram,
      "--",
      "--token",
      secret,
    ]);

    expect(result.status).toBe(23);
    expect(result.stdout).not.toContain(secret);
    expect(result.stdout).not.toContain(secret.slice(5));
    const captured = JSON.parse(result.stdout).data.report.observation.result.stdout;
    expect(captured.truncated).toBe(true);
    // The exact boundary position depends on platform pipe chunking; both a
    // boundary split and a full redaction are compliant outcomes. The hard
    // security assertions above (no plaintext secret anywhere) stand.
    expect(
      captured.redacted_excerpt.includes("[REDACTED_BOUNDARY]") ||
        captured.redacted_excerpt.includes("[REDACTED]"),
    ).toBe(true);
  });

  test("redacts a complete secret that begins exactly at the excerpt boundary", () => {
    const secret = "a-runparity-super-secret-value-a";
    const targetProgram = [
      "const secret = process.argv[2]",
      `process.stdout.write('12345' + secret + 'x'.repeat(${64 * 1024} - Buffer.byteLength(secret)))`,
      "process.exitCode = 23",
    ].join(";");
    const result = invoke(temporaryProject("runparity-redaction-boundary-full-"), [
      "--json",
      "doctor",
      "--",
      process.execPath,
      "-e",
      targetProgram,
      "--",
      "--token",
      secret,
    ]);

    expect(result.status).toBe(23);
    expect(result.stdout).not.toContain(secret);
    expect(result.stdout).not.toContain("ecret-value-a");
    expect(
      JSON.parse(result.stdout).data.report.observation.result.stdout.redacted_excerpt.includes(
        "[REDACTED_BOUNDARY]",
      ) ||
        JSON.parse(result.stdout).data.report.observation.result.stdout.redacted_excerpt.includes(
          "[REDACTED]",
        ),
    ).toBe(true);
  });

  test("drops a partial first line when a Bearer credential prefix was truncated away", () => {
    const secret = "runparity-bearer-credential-987654321";
    const targetProgram = [
      `const secret = ['runparity', 'bearer', 'credential', '987654321'].join('-')`,
      `const line = 'Bearer ' + secret + '\\nSAFE\\n'`,
      `process.stdout.write('Authorization: ' + line + 'x'.repeat(${64 * 1024} - Buffer.byteLength(line)))`,
      "process.exitCode = 23",
    ].join(";");
    const result = invoke(temporaryProject("runparity-bearer-boundary-"), [
      "--json",
      "doctor",
      "--",
      process.execPath,
      "-e",
      targetProgram,
    ]);

    expect(result.status).toBe(23);
    expect(result.stdout).not.toContain(secret);
    expect(result.stdout).not.toContain("credential-987654321");
    const excerpt = JSON.parse(result.stdout).data.report.observation.result.stdout
      .redacted_excerpt;
    expect(excerpt).toContain("[REDACTED_BOUNDARY]");
  });

  test("neutralizes bidi controls and Unicode line separators before redaction", () => {
    const secret = `ghp_\u202e${"0".repeat(36)}`;
    const targetProgram = [
      "process.stdout.write(process.argv[1] + '\\n')",
      "process.stderr.write('before' + String.fromCodePoint(0x2066) + 'FAKE PASS' + String.fromCodePoint(0x2069) + String.fromCodePoint(0x2028) + 'after\\n')",
      "process.exit(23)",
    ].join(";");
    const result = invoke(temporaryProject("runparity-unicode-controls-"), [
      "--json",
      "doctor",
      "--",
      process.execPath,
      "-e",
      targetProgram,
      secret,
    ]);

    expect(result.status).toBe(23);
    expect(result.stdout).not.toMatch(
      /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029]/u,
    );
    const report = JSON.parse(result.stdout).data.report;
    expect(report.observation.requested_argv.at(-1)).toBe("[REDACTED]");
    expect(report.observation.result.stdout.redacted_excerpt).toBe("[REDACTED]\n");
    expect(report.observation.result.stderr.redacted_excerpt).toBe("beforeFAKE PASS\nafter\n");
  });

  test("removes spoofing-oriented default-ignorable controls without stripping joiners", () => {
    const targetProgram = [
      "const unsafe = 'FA' + String.fromCodePoint(0x00ad, 0x034f, 0x180e, 0x206a, 0xe0020) + 'IL'",
      "const legitimate = 'A' + String.fromCodePoint(0x200c, 0x200d, 0xfe0f) + 'B'",
      "process.stderr.write(unsafe + '|' + legitimate)",
      "process.exit(23)",
    ].join(";");
    const result = invoke(temporaryProject("runparity-default-ignorables-"), [
      "--json",
      "doctor",
      "--",
      process.execPath,
      "-e",
      targetProgram,
    ]);

    expect(result.status).toBe(23);
    expect(result.stdout).not.toMatch(
      /(?:\u00ad|\u034f|\u180e|[\u206a-\u206f]|[\ufff9-\ufffb]|\u{e0001}|[\u{e0020}-\u{e007f}])/u,
    );
    expect(JSON.parse(result.stdout).data.report.observation.result.stderr.redacted_excerpt).toBe(
      `FAIL|A\u200c\u200d\ufe0fB`,
    );
  });

  test("sanitizes learned secrets and display controls across the complete envelope", () => {
    const project = temporaryProject("runparity-envelope-redaction-");
    const secret = "rpUniqueCredential987654321";
    const executable = resolve(
      project,
      `probe-${secret}-\u202eevil${process.platform === "win32" ? ".exe" : ""}`,
    );
    copyFileSync(process.execPath, executable);
    if (process.platform !== "win32") chmodSync(executable, 0o755);

    const result = invoke(project, [
      "--json",
      "doctor",
      "--",
      executable,
      "-e",
      "process.exit(23)",
      "--",
      "--token",
      secret,
    ]);

    expect(result.status).toBe(23);
    expect(result.stdout).not.toContain(secret);
    expect(result.stdout).not.toMatch(
      /[\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u,
    );
    const launch = JSON.parse(result.stdout).data.report.observation.launch;
    expect(JSON.stringify(launch)).toContain("[REDACTED]");
  });
});
