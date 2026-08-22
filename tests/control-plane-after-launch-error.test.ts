import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, test, vi } from "vitest";

const childProcess = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, spawn: childProcess.spawn };
});

import {
  createControlPlaneProcessAdapter,
  runControlPlaneCommand,
} from "../src/control-plane-process.js";

describe("control-plane child error phase", () => {
  test("a child error after spawn is an aborted safety result with failed cleanup", async () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-controller-after-launch-"));
    const fixture = resolve(project, "fixture.mjs");
    writeFileSync(fixture, "process.exit(0);", "utf8");
    try {
      const child = Object.assign(new EventEmitter(), {
        pid: undefined,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        unref: vi.fn(),
        kill: vi.fn(() => false),
      });
      childProcess.spawn.mockImplementationOnce(() => {
        queueMicrotask(() => {
          child.emit("spawn");
          child.emit("error", new Error("simulated post-spawn process error"));
        });
        return child;
      });
      const adapter = createControlPlaneProcessAdapter({
        executablePath: process.execPath,
        baseArgs: [fixture],
        cwd: project,
      });

      const result = await runControlPlaneCommand(adapter, {
        args: Object.freeze([]),
        deadlineNanoseconds: process.hrtime.bigint() + 5_000_000_000n,
      });

      expect(result).toEqual({
        kind: "aborted_safety",
        reasonCode: "RP_CONTROLLER_SUPERVISION_FAILED",
        cleanup: {
          attempted: true,
          status: "failed",
          containment: "uncontained_host",
          strategy: process.platform === "win32" ? "windows_taskkill" : "posix_process_group",
          reason_code: "RP_PROCESS_TREE_CLEANUP_FAILED",
        },
      });
      expect(child.stdout.destroyed).toBe(true);
      expect(child.stderr.destroyed).toBe(true);
      expect(child.unref).toHaveBeenCalledOnce();
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
