import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import type { LaunchPlan } from "../src/command-resolution.js";
import { currentProcessController, observeProcess } from "../src/process-observer.js";
import { createRedactionContext } from "../src/redaction.js";

describe("process observation deadline", () => {
  test("does not turn an absolute deadline beyond Node's timer range into an immediate timeout", async () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-large-deadline-"));
    const launch: LaunchPlan = {
      requestedProgram: process.execPath,
      selectedSearchPath: process.execPath,
      resolvedPath: process.execPath,
      kind: "native_executable",
      executablePath: process.execPath,
      argv0: process.execPath,
      scriptPath: null,
      args: ["-e", "setTimeout(() => process.exit(0), 75)"],
      candidates: [process.execPath],
      candidateResolutions: [{ searchPath: process.execPath, canonicalPath: process.execPath }],
      candidateResolutionsTruncated: false,
      environmentMutations: { set: {}, unset: [] },
    };
    try {
      const nodeTimerMaximumMilliseconds = 2_147_483_647n;
      const result = await observeProcess(
        {
          launch,
          cwd: project,
          environment: process.env,
          deadlineNanoseconds:
            process.hrtime.bigint() + (nodeTimerMaximumMilliseconds + 60_000n) * 1_000_000n,
          controller: currentProcessController(),
        },
        createRedactionContext([]),
      );

      expect(result).toMatchObject({
        started: true,
        exitCode: 0,
        timedOut: false,
        timeoutPhase: null,
      });
    } finally {
      rmSync(project, { force: true, recursive: true });
    }
  });

  test("rechecks the absolute deadline after synchronous launch preparation", async () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-pre-spawn-deadline-"));
    const marker = resolve(project, "started.txt");
    const launch: LaunchPlan = {
      requestedProgram: process.execPath,
      selectedSearchPath: process.execPath,
      resolvedPath: process.execPath,
      kind: "native_executable",
      executablePath: process.execPath,
      argv0: process.execPath,
      scriptPath: null,
      args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started')`],
      candidates: [process.execPath],
      candidateResolutions: [{ searchPath: process.execPath, canonicalPath: process.execPath }],
      candidateResolutionsTruncated: false,
      environmentMutations: { set: {}, unset: [] },
    };
    try {
      const deadlineNanoseconds = process.hrtime.bigint() + 100_000_000n;
      const result = await observeProcess(
        {
          launch,
          cwd: project,
          environment: process.env,
          deadlineNanoseconds,
          controller: currentProcessController(),
        },
        createRedactionContext([]),
        {
          beforeSpawn: () => {
            const releaseAt = process.hrtime.bigint() + 150_000_000n;
            while (process.hrtime.bigint() < releaseAt) {
              // Intentionally models a slow synchronous launch adapter.
            }
          },
        },
      );

      expect(existsSync(marker)).toBe(false);
      expect(result).toMatchObject({
        started: false,
        timedOut: true,
        timeoutPhase: "before_launch",
      });
    } finally {
      rmSync(project, { force: true, recursive: true });
    }
  });
});
