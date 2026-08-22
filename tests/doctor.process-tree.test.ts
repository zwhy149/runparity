import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = resolve(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs");
const runParityCli = resolve(repositoryRoot, "src", "cli.ts");
const temporaryDirectories: string[] = [];
const fallbackCleanupPids: number[] = [];

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function forceCleanup(pid: number): void {
  if (!isAlive(pid)) return;
  if (process.platform === "win32") {
    const windowsDirectory = process.env["SystemRoot"] ?? process.env["windir"];
    if (windowsDirectory !== undefined && isAbsolute(windowsDirectory)) {
      const taskkill = resolve(windowsDirectory, "System32", "taskkill.exe");
      if (existsSync(taskkill)) {
        spawnSync(taskkill, ["/PID", String(pid), "/T", "/F"], {
          shell: false,
          stdio: "ignore",
          windowsHide: true,
        });
        return;
      }
    }
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // The process already exited.
  }
}

async function waitUntilDead(pid: number): Promise<boolean> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  return !isAlive(pid);
}

afterEach(async () => {
  const cleanupPids = fallbackCleanupPids.splice(0);
  for (const pid of cleanupPids) forceCleanup(pid);
  await Promise.all(cleanupPids.map((pid) => waitUntilDead(pid)));
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true, maxRetries: 20, retryDelay: 50 });
  }
});

describe("timeout cleanup", () => {
  test("attempts attached-tree cleanup without claiming host containment", async () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-process-tree-"));
    temporaryDirectories.push(project);
    const grandchildProgram = [
      "process.on('SIGTERM', () => undefined)",
      "setInterval(() => undefined, 1_000)",
    ].join(";");
    const targetProgram = [
      "const { spawn } = require('node:child_process')",
      `const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildProgram)}], { stdio: 'ignore' })`,
      "process.stdout.write('GRANDCHILD_PID=' + child.pid + '\\n')",
      "setInterval(() => undefined, 1_000)",
    ].join(";");

    const result = spawnSync(
      process.execPath,
      [
        tsxCli,
        runParityCli,
        "--json",
        "doctor",
        "--timeout",
        "500ms",
        "--",
        process.execPath,
        "-e",
        targetProgram,
      ],
      { cwd: project, encoding: "utf8", shell: false, timeout: 10_000 },
    );

    expect(result.status).toBe(74);
    const report = JSON.parse(result.stdout).data.report;
    const match = report.observation.result.stdout.redacted_excerpt.match(/GRANDCHILD_PID=(\d+)/);
    expect(match?.[1]).toBeDefined();
    const grandchildPid = Number(match?.[1]);
    fallbackCleanupPids.push(grandchildPid);

    expect(report.observation.result.cleanup).toMatchObject({
      attempted: true,
      status: "best_effort",
      containment: "uncontained_host",
      reason_code: "RP_PROCESS_TREE_NOT_CONTAINED",
    });
    expect(await waitUntilDead(grandchildPid)).toBe(true);
    fallbackCleanupPids.splice(fallbackCleanupPids.indexOf(grandchildPid), 1);
  });

  test("reports a safety abort when a descendant detached before timeout", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-detached-process-"));
    temporaryDirectories.push(project);
    const grandchildProgram = "setTimeout(() => undefined, 10_000)";
    const intermediateProgram = [
      "const { spawn } = require('node:child_process')",
      `const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildProgram)}], { detached: true, stdio: 'ignore' })`,
      "process.stdout.write(String(grandchild.pid))",
      "grandchild.unref()",
    ].join(";");
    const targetProgram = [
      "const { spawnSync } = require('node:child_process')",
      `const bridge = spawnSync(process.execPath, ['-e', ${JSON.stringify(intermediateProgram)}], { encoding: 'utf8' })`,
      "process.stdout.write('GRANDCHILD_PID=' + bridge.stdout.trim() + '\\n')",
      "setInterval(() => undefined, 1_000)",
    ].join(";");

    const result = spawnSync(
      process.execPath,
      [
        tsxCli,
        runParityCli,
        "--json",
        "doctor",
        "--report-only",
        "--timeout",
        // This deadline includes controller startup, the target's synchronous
        // bridge, and the detached spawn. It must allow the PID evidence to
        // exist before the execution timeout exercises the safety path.
        "1000ms",
        "--",
        process.execPath,
        "-e",
        targetProgram,
      ],
      { cwd: project, encoding: "utf8", shell: false, timeout: 10_000 },
    );

    expect(result.status).toBe(74);
    const output = JSON.parse(result.stdout);
    const match =
      output.data.report.observation.result.stdout.redacted_excerpt.match(/GRANDCHILD_PID=(\d+)/);
    expect(match?.[1]).toBeDefined();
    const grandchildPid = Number(match?.[1]);
    fallbackCleanupPids.push(grandchildPid);
    expect(isAlive(grandchildPid)).toBe(true);
    expect(output).toMatchObject({
      ok: true,
      data: {
        report: {
          verdict: "ABORTED_SAFETY",
          exit_policy: "report_only",
          observation: {
            result: {
              cleanup: {
                attempted: true,
                status: "best_effort",
                containment: "uncontained_host",
                reason_code: "RP_PROCESS_TREE_NOT_CONTAINED",
              },
            },
          },
        },
      },
      warnings: [{ code: "RP_TARGET_TIMEOUT" }, { code: "RP_PROCESS_TREE_NOT_CONTAINED" }],
    });
  });

  test("bounds stream draining when a detached descendant keeps the pipes open", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-open-pipe-"));
    temporaryDirectories.push(project);
    const grandchildProgram = "setTimeout(() => undefined, 10_000)";
    const intermediateProgram = [
      "const { spawn } = require('node:child_process')",
      `const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildProgram)}], { detached: true, stdio: 'inherit' })`,
      "process.stdout.write('GRANDCHILD_PID=' + grandchild.pid + '\\n')",
      "grandchild.unref()",
    ].join(";");
    // The intermediate is launched synchronously so its detached grandchild and
    // the pid write are guaranteed to exist before the execution deadline, even
    // on a loaded host.
    const targetProgram = [
      "const { spawnSync } = require('node:child_process')",
      `spawnSync(process.execPath, ['-e', ${JSON.stringify(intermediateProgram)}], { stdio: 'inherit' })`,
      "setInterval(() => undefined, 1_000)",
    ].join(";");
    const startedAt = Date.now();

    const result = spawnSync(
      process.execPath,
      [
        tsxCli,
        runParityCli,
        "--json",
        "doctor",
        "--timeout",
        "1000ms",
        "--",
        process.execPath,
        "-e",
        targetProgram,
      ],
      { cwd: project, encoding: "utf8", shell: false, timeout: 8_000 },
    );
    const elapsedMs = Date.now() - startedAt;

    expect(result.status).toBe(74);
    expect(elapsedMs).toBeLessThan(5_000);
    const output = JSON.parse(result.stdout);
    const match =
      output.data.report.observation.result.stdout.redacted_excerpt.match(/GRANDCHILD_PID=(\d+)/);
    // The detached descendant must exist before the timeout fires, otherwise the
    // test cannot exercise the held-open pipe path at all. The synchronous
    // intermediate launch plus the deadline gives the spawn chain time to
    // complete on every supported platform; the detached grandchild still
    // outlives the timeout by design.
    expect(match?.[1]).toBeDefined();
    if (match?.[1] !== undefined) fallbackCleanupPids.push(Number(match[1]));
    expect(output.data.report.observation.result.stream_capture).toEqual({
      status: "incomplete",
      reason_code: "RP_STREAM_DRAIN_INCOMPLETE",
    });
    expect(output.warnings).toContainEqual({
      code: "RP_STREAM_DRAIN_INCOMPLETE",
      message: expect.any(String),
    });
  });

  test("does not turn post-exit pipe draining into an execution timeout", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-post-exit-drain-"));
    temporaryDirectories.push(project);
    const grandchildProgram = "setTimeout(() => undefined, 10_000)";
    const intermediateProgram = [
      "const { spawn } = require('node:child_process')",
      `const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildProgram)}], { detached: true, stdio: 'inherit' })`,
      "process.stdout.write('GRANDCHILD_PID=' + grandchild.pid + '\\n')",
      "grandchild.unref()",
    ].join(";");
    // The intermediate is launched synchronously so its detached grandchild and
    // the pid write are guaranteed to exist before the target exits.
    const targetProgram = [
      "const { spawnSync } = require('node:child_process')",
      `spawnSync(process.execPath, ['-e', ${JSON.stringify(intermediateProgram)}], { stdio: 'inherit' })`,
      "setTimeout(() => process.exit(0), 150)",
    ].join(";");
    const startedAt = Date.now();

    const result = spawnSync(
      process.execPath,
      [
        tsxCli,
        runParityCli,
        "--json",
        "doctor",
        "--timeout",
        // This deadline includes controller startup and the target's
        // synchronous spawn chain; it must expire after the root can exit, not
        // while a loaded Linux worker has not yet scheduled that chain.
        "1000ms",
        "--",
        process.execPath,
        "-e",
        targetProgram,
      ],
      { cwd: project, encoding: "utf8", shell: false, timeout: 7_000 },
    );
    const elapsedMs = Date.now() - startedAt;

    const output = JSON.parse(result.stdout);
    const observedResult = output.data.report.observation.result;
    const match = observedResult.stdout.redacted_excerpt.match(/GRANDCHILD_PID=(\d+)/);
    expect(match?.[1]).toBeDefined();
    if (match?.[1] !== undefined) fallbackCleanupPids.push(Number(match[1]));
    expect(result.status).toBe(0);
    expect(elapsedMs).toBeLessThan(5_000);
    expect(observedResult).toMatchObject({
      status: "passed",
      exit_code: 0,
      timed_out: false,
      cleanup: {
        attempted: false,
        status: "not_required",
      },
      stream_capture: {
        status: "incomplete",
        reason_code: "RP_STREAM_DRAIN_INCOMPLETE",
      },
    });
  });
});
