import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const supervisor = vi.hoisted(() => ({
  run: vi.fn(),
}));

vi.mock("../src/supervised-process.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/supervised-process.js")>();
  return { ...original, runSupervisedProcess: supervisor.run };
});

import {
  createControlPlaneProcessAdapter,
  runControlPlaneCommand,
} from "../src/control-plane-process.js";

describe("control-plane supervision failures", () => {
  afterEach(() => supervisor.run.mockReset());

  test("an unclassified supervisor rejection can never masquerade as not started", async () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-controller-rejection-"));
    const fixture = resolve(project, "fixture.mjs");
    writeFileSync(fixture, "process.exit(0);", "utf8");
    try {
      const adapter = createControlPlaneProcessAdapter({
        executablePath: process.execPath,
        baseArgs: [fixture],
        cwd: project,
      });
      supervisor.run.mockRejectedValueOnce(new Error("unknown post-start supervisor failure"));

      const result = await runControlPlaneCommand(adapter, {
        args: Object.freeze([]),
        deadlineNanoseconds: process.hrtime.bigint() + 5_000_000_000n,
      });

      expect(result).toEqual({
        kind: "aborted_safety",
        reasonCode: "RP_CONTROLLER_SUPERVISION_FAILED",
        cleanup: {
          attempted: false,
          status: "not_required",
          containment: "uncontained_host",
          strategy: null,
          reason_code: null,
        },
      });
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
