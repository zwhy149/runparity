import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  createControlPlaneProcessAdapter,
  runControlPlaneCommand,
} from "../src/control-plane-process.js";

function temporaryProject(): string {
  return mkdtempSync(resolve(tmpdir(), "runparity-control-plane-"));
}

function nodeAdapter(project: string, source: string) {
  const fixture = resolve(project, "fixture.mjs");
  writeFileSync(fixture, source, "utf8");
  return createControlPlaneProcessAdapter({
    executablePath: process.execPath,
    baseArgs: [fixture],
    cwd: project,
  });
}

describe("supervised control-plane process", () => {
  test("rejects an accessor adapter field under descriptor prototype pollution", () => {
    let getterCalls = 0;
    const input = { baseArgs: [], cwd: process.cwd() } as Record<string, unknown>;
    Object.defineProperty(input, "executablePath", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return process.execPath;
      },
    });
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      value: process.execPath,
    });
    let thrown: unknown;
    try {
      createControlPlaneProcessAdapter(
        input as Parameters<typeof createControlPlaneProcessAdapter>[0],
      );
    } catch (error) {
      thrown = error;
    } finally {
      Reflect.deleteProperty(Object.prototype, "value");
    }
    expect(String(thrown)).toMatch(/RP_CONTROLLER_INVALID_ADAPTER/u);
    expect(getterCalls).toBe(0);
  });

  test("rejects an accessor argument under descriptor prototype pollution", () => {
    let getterCalls = 0;
    const baseArgs = ["placeholder"];
    Object.defineProperty(baseArgs, "0", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "caller code";
      },
    });
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      value: "ambient",
    });
    let thrown: unknown;
    try {
      createControlPlaneProcessAdapter({
        executablePath: process.execPath,
        baseArgs,
        cwd: process.cwd(),
      });
    } catch (error) {
      thrown = error;
    } finally {
      Reflect.deleteProperty(Object.prototype, "value");
    }
    expect(String(thrown)).toMatch(/RP_CONTROLLER_INVALID_ADAPTER/u);
    expect(getterCalls).toBe(0);
  });

  test("rejects a sparse decorated argument array under descriptor prototype pollution", () => {
    const baseArgs = new Array(1) as string[];
    Object.defineProperty(baseArgs, "decorator", {
      enumerable: true,
      value: "fills the key-count budget",
    });
    Object.defineProperty(Object.prototype, "0", {
      configurable: true,
      writable: true,
      value: { enumerable: true, value: "ambient" },
    });
    let thrown: unknown;
    try {
      createControlPlaneProcessAdapter({
        executablePath: process.execPath,
        baseArgs,
        cwd: process.cwd(),
      });
    } catch (error) {
      thrown = error;
    } finally {
      Reflect.deleteProperty(Object.prototype, "0");
    }

    expect(String(thrown)).toMatch(/RP_CONTROLLER_INVALID_ADAPTER/u);
  });

  test("freezes a minimal environment and never promotes an uncontained exit", async () => {
    const project = temporaryProject();
    const ambientName = "RUNPARITY_CONTROL_PLANE_CREDENTIAL";
    const observedEnvironment = resolve(project, "environment.json");
    const ambientProfile = process.env["USERPROFILE"];
    const ambientPath = process.env["PATH"];
    const previous = process.env[ambientName];
    try {
      const adapter = nodeAdapter(
        project,
        [
          'import { writeFileSync } from "node:fs";',
          `writeFileSync(${JSON.stringify(observedEnvironment)}, JSON.stringify({`,
          "  environment: process.env,",
          "  argv: process.argv.slice(2),",
          "  cwd: process.cwd(),",
          '}), "utf8");',
        ].join("\n"),
      );
      process.env[ambientName] = "must-not-reach-child";
      process.env["USERPROFILE"] = "RP_AMBIENT_PROFILE_CANARY";
      process.env["PATH"] = "RP_AMBIENT_PATH_CANARY";
      const result = await runControlPlaneCommand(adapter, {
        args: Object.freeze(["context", "inspect"]),
        deadlineNanoseconds: process.hrtime.bigint() + 5_000_000_000n,
      });

      expect(result).toEqual({
        kind: "aborted_safety",
        reasonCode: "RP_CONTROLLER_PROCESS_NOT_CONTAINED",
        cleanup: {
          attempted: false,
          status: "not_required",
          containment: "uncontained_host",
          strategy: null,
          reason_code: null,
        },
      });
      const observed = JSON.parse(readFileSync(observedEnvironment, "utf8")) as {
        environment: Record<string, string>;
        argv: string[];
        cwd: string;
      };
      expect(observed.argv).toEqual(["context", "inspect"]);
      // CI runners expose the temp directory in 8.3 short-name form to child
      // processes; compare canonical realpaths instead of raw spellings.
      expect(realpathSync.native(observed.cwd)).toBe(realpathSync.native(project));
      expect(JSON.stringify(observed.environment)).not.toContain("must-not-reach-child");
      expect(JSON.stringify(observed.environment)).not.toContain("RP_AMBIENT_PROFILE_CANARY");
      expect(JSON.stringify(observed.environment)).not.toContain("RP_AMBIENT_PATH_CANARY");
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.cleanup)).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(
        /qualified|receipt|ledger|verdict|authorization/iu,
      );
    } finally {
      if (previous === undefined) delete process.env[ambientName];
      else process.env[ambientName] = previous;
      if (ambientProfile === undefined) delete process.env["USERPROFILE"];
      else process.env["USERPROFILE"] = ambientProfile;
      if (ambientPath === undefined) delete process.env["PATH"];
      else process.env["PATH"] = ambientPath;
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("does not trust a normal parent exit when a detached descendant can survive", async () => {
    const project = temporaryProject();
    const marker = resolve(project, "detached-marker.txt");
    const descendantPid = resolve(project, "detached-pid.txt");
    try {
      const adapter = nodeAdapter(
        project,
        [
          'import { spawn } from "node:child_process";',
          'import { tmpdir } from "node:os";',
          "const program = " +
            JSON.stringify(
              [
                `require("node:fs").writeFileSync(${JSON.stringify(descendantPid)}, String(process.pid))`,
                `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "survived"), 500)`,
              ].join(";"),
            ) +
            ";",
          'const child = spawn(process.execPath, ["-e", program], { cwd: tmpdir(), detached: true, stdio: "ignore" });',
          "child.unref();",
          'process.stdout.write("syntactically valid response");',
        ].join("\n"),
      );
      const result = await runControlPlaneCommand(adapter, {
        args: Object.freeze([]),
        deadlineNanoseconds: process.hrtime.bigint() + 5_000_000_000n,
      });

      expect(result).toEqual({
        kind: "aborted_safety",
        reasonCode: "RP_CONTROLLER_PROCESS_NOT_CONTAINED",
        cleanup: {
          attempted: false,
          status: "not_required",
          containment: "uncontained_host",
          strategy: null,
          reason_code: null,
        },
      });
      await expect.poll(() => existsSync(marker), { timeout: 2_000 }).toBe(true);
      const pid = Number(readFileSync(descendantPid, "utf8"));
      await expect
        .poll(
          () => {
            try {
              process.kill(pid, 0);
              return true;
            } catch {
              return false;
            }
          },
          { timeout: 3_000 },
        )
        .toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
    }
  });

  test("does not start a command after its absolute deadline", async () => {
    const project = temporaryProject();
    const marker = resolve(project, "started.txt");
    try {
      const adapter = nodeAdapter(
        project,
        `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "started");`,
      );
      const result = await runControlPlaneCommand(adapter, {
        args: Object.freeze([]),
        deadlineNanoseconds: process.hrtime.bigint() - 1n,
      });

      expect(result).toEqual({
        kind: "not_started",
        reasonCode: "RP_CONTROLLER_DEADLINE_EXPIRED",
        cleanup: {
          attempted: false,
          status: "not_required",
          containment: "uncontained_host",
          strategy: null,
          reason_code: null,
        },
      });
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("keeps a proven pre-launch spawn failure distinct from an unknown supervisor failure", async () => {
    const project = temporaryProject();
    const adapter = nodeAdapter(project, "process.exit(0);");
    rmSync(project, { recursive: true, force: true });

    const result = await runControlPlaneCommand(adapter, {
      args: Object.freeze([]),
      deadlineNanoseconds: process.hrtime.bigint() + 5_000_000_000n,
    });

    expect(result).toEqual({
      kind: "not_started",
      reasonCode: "RP_CONTROLLER_LAUNCH_FAILED",
      cleanup: {
        attempted: false,
        status: "not_required",
        containment: "uncontained_host",
        strategy: null,
        reason_code: null,
      },
    });
  });

  test("applies one argument budget across fixed and per-stage argv", async () => {
    const project = temporaryProject();
    const marker = resolve(project, "over-budget-started.txt");
    const fixture = resolve(project, "fixture.mjs");
    writeFileSync(
      fixture,
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "started");`,
      "utf8",
    );
    try {
      const adapter = createControlPlaneProcessAdapter({
        executablePath: process.execPath,
        baseArgs: [fixture, ...Array.from({ length: 127 }, () => "fixed")],
        cwd: project,
      });
      const result = await runControlPlaneCommand(adapter, {
        args: Object.freeze(["one-too-many"]),
        deadlineNanoseconds: process.hrtime.bigint() + 5_000_000_000n,
      });

      expect(result).toMatchObject({
        kind: "aborted_safety",
        reasonCode: "RP_CONTROLLER_INVALID_COMMAND",
      });
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("fails closed when control-plane output exceeds the bounded capture", async () => {
    const project = temporaryProject();
    try {
      const adapter = nodeAdapter(project, 'process.stdout.write("x".repeat(64 * 1024 + 1));');
      const result = await runControlPlaneCommand(adapter, {
        args: Object.freeze([]),
        deadlineNanoseconds: process.hrtime.bigint() + 5_000_000_000n,
      });

      expect(result).toEqual({
        kind: "aborted_safety",
        reasonCode: "RP_CONTROLLER_OUTPUT_LIMIT_EXCEEDED",
        cleanup: {
          attempted: false,
          status: "not_required",
          containment: "uncontained_host",
          strategy: null,
          reason_code: null,
        },
      });
      expect(JSON.stringify(result)).not.toContain("x".repeat(128));
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("accepts the exact stderr byte budget without exposing uncontained output", async () => {
    const project = temporaryProject();
    try {
      const adapter = nodeAdapter(
        project,
        'process.stderr.write("boundary-token-" + "x".repeat(64 * 1024 - 15));',
      );
      const result = await runControlPlaneCommand(adapter, {
        args: Object.freeze([]),
        deadlineNanoseconds: process.hrtime.bigint() + 5_000_000_000n,
      });

      expect(result).toMatchObject({
        kind: "aborted_safety",
        reasonCode: "RP_CONTROLLER_PROCESS_NOT_CONTAINED",
      });
      expect(JSON.stringify(result)).not.toContain("boundary-token");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("rejects invalid UTF-8 before any control-plane output can be parsed", async () => {
    const project = temporaryProject();
    try {
      const adapter = nodeAdapter(
        project,
        "process.stdout.write(Buffer.from([0x66, 0x6f, 0x80, 0x6f]));",
      );
      const result = await runControlPlaneCommand(adapter, {
        args: Object.freeze([]),
        deadlineNanoseconds: process.hrtime.bigint() + 5_000_000_000n,
      });

      expect(result).toMatchObject({
        kind: "aborted_safety",
        reasonCode: "RP_CONTROLLER_INVALID_OUTPUT",
      });
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("rejects incomplete stream drain after the root process exits", async () => {
    const project = temporaryProject();
    const descendantExited = resolve(project, "descendant-exited.txt");
    const descendantPid = resolve(project, "descendant-pid.txt");
    try {
      const adapter = nodeAdapter(
        project,
        [
          'import { spawn } from "node:child_process";',
          'import { tmpdir } from "node:os";',
          "const program = " +
            JSON.stringify(
              [
                `require("node:fs").writeFileSync(${JSON.stringify(descendantPid)}, String(process.pid))`,
                `setTimeout(() => { require("node:fs").writeFileSync(${JSON.stringify(descendantExited)}, "done"); process.exit(0); }, 600)`,
              ].join(";"),
            ) +
            ";",
          'const child = spawn(process.execPath, ["-e", program], { cwd: tmpdir(), detached: true, stdio: "inherit" });',
          "child.unref();",
        ].join("\n"),
      );
      const result = await runControlPlaneCommand(adapter, {
        args: Object.freeze([]),
        deadlineNanoseconds: process.hrtime.bigint() + 5_000_000_000n,
      });

      expect(result).toMatchObject({
        kind: "aborted_safety",
        reasonCode: "RP_CONTROLLER_STREAM_INCOMPLETE",
      });
      await expect.poll(() => existsSync(descendantExited), { timeout: 2_000 }).toBe(true);
      const pid = Number(readFileSync(descendantPid, "utf8"));
      await expect
        .poll(
          () => {
            try {
              process.kill(pid, 0);
              return true;
            } catch {
              return false;
            }
          },
          { timeout: 3_000 },
        )
        .toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
    }
  });

  test.skipIf(process.platform === "win32")(
    "rejects a signal-terminated control-plane process",
    async () => {
      const project = temporaryProject();
      try {
        const adapter = nodeAdapter(project, 'process.kill(process.pid, "SIGTERM");');
        const result = await runControlPlaneCommand(adapter, {
          args: Object.freeze([]),
          deadlineNanoseconds: process.hrtime.bigint() + 5_000_000_000n,
        });

        expect(result).toMatchObject({
          kind: "aborted_safety",
          reasonCode: "RP_CONTROLLER_PROCESS_TERMINATED",
        });
      } finally {
        rmSync(project, { recursive: true, force: true });
      }
    },
  );

  test("reports execution timeout as safety with explicit cleanup evidence", async () => {
    const project = temporaryProject();
    try {
      const adapter = nodeAdapter(project, "setInterval(() => {}, 1_000);");
      const result = await runControlPlaneCommand(adapter, {
        args: Object.freeze([]),
        deadlineNanoseconds: process.hrtime.bigint() + 200_000_000n,
      });

      expect(result).toMatchObject({
        kind: "aborted_safety",
        reasonCode: "RP_CONTROLLER_PROCESS_NOT_CONTAINED",
        cleanup: {
          attempted: true,
          containment: "uncontained_host",
        },
      });
      expect(result.cleanup.status).toMatch(/best_effort|failed/u);
      expect(JSON.stringify(result)).not.toMatch(/qualified|receipt|ledger|verdict/iu);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
