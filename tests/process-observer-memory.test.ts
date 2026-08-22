import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import type { LaunchPlan } from "../src/command-resolution.js";
import { currentProcessController, observeProcess } from "../src/process-observer.js";
import { createRedactionContext } from "../src/redaction.js";

describe("process observer raw-buffer ownership", () => {
  test("zeros both streams when one redaction projection throws", async () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-observer-memory-"));
    const stderrCanary = "runparity-stderr-memory-canary";
    const rawBuffers: Buffer[] = [];
    const originalConcat = Buffer.concat;
    const concat = vi.spyOn(Buffer, "concat").mockImplementation((list, totalLength) => {
      const combined =
        totalLength === undefined ? originalConcat(list) : originalConcat(list, totalLength);
      if (combined.includes(stderrCanary)) rawBuffers.push(combined);
      return combined;
    });
    const launch: LaunchPlan = {
      requestedProgram: process.execPath,
      selectedSearchPath: process.execPath,
      resolvedPath: process.execPath,
      kind: "native_executable",
      executablePath: process.execPath,
      argv0: process.execPath,
      scriptPath: null,
      args: [
        "-e",
        `process.stdout.write("stdout-canary");process.stderr.write(${JSON.stringify(stderrCanary)})`,
      ],
      candidates: [process.execPath],
      candidateResolutions: [{ searchPath: process.execPath, canonicalPath: process.execPath }],
      candidateResolutionsTruncated: false,
      environmentMutations: { set: {}, unset: [] },
    };
    const baseRedaction = createRedactionContext([]);
    const throwingRedaction = {
      ...baseRedaction,
      redactExcerpt: () => {
        throw new Error("fixture redaction failure");
      },
    };
    try {
      await expect(
        observeProcess(
          {
            launch,
            cwd: project,
            environment: process.env,
            deadlineNanoseconds: process.hrtime.bigint() + 2_000_000_000n,
            controller: currentProcessController(),
          },
          throwingRedaction,
        ),
      ).rejects.toThrow("fixture redaction failure");
      expect(rawBuffers.length).toBeGreaterThan(0);
      expect(rawBuffers.every((buffer) => !buffer.includes(stderrCanary))).toBe(true);
    } finally {
      concat.mockRestore();
      for (const buffer of rawBuffers) buffer.fill(0);
      rmSync(project, { recursive: true, force: true });
    }
  });
});
