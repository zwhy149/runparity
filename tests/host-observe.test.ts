import { copyFileSync, existsSync, linkSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { inspect } from "node:util";
import { describe, expect, test, vi } from "vitest";
import { captureRunSpec, observeHost } from "../src/host-observe.js";

describe("Host Observe", () => {
  test("releases ownership of raw stream buffers so the public adapter can zero them", async () => {
    const secret = "runparity-memory-canary-123456789";
    const rawBuffers: Buffer[] = [];
    const originalConcat = Buffer.concat;
    const concat = vi.spyOn(Buffer, "concat").mockImplementation((list, totalLength) => {
      const combined =
        totalLength === undefined ? originalConcat(list) : originalConcat(list, totalLength);
      if (combined.includes(secret)) rawBuffers.push(combined);
      return combined;
    });
    try {
      const spec = captureRunSpec({
        argv: [
          process.execPath,
          "-e",
          "process.stdout.write(process.argv.at(-1) ?? '')",
          "--",
          "--token",
          secret,
        ],
        cwd: process.cwd(),
        workspaceRoot: process.cwd(),
        environment: process.env,
        timeoutMs: 2_000,
      });
      const observed = await observeHost(spec);

      expect(observed.process.stdout.redacted_excerpt).not.toContain(secret);
      expect(rawBuffers.length).toBeGreaterThan(0);
      expect(rawBuffers.every((buffer) => !buffer.includes(secret))).toBe(true);
    } finally {
      concat.mockRestore();
      for (const buffer of rawBuffers) buffer.fill(0);
    }
  });

  test("uses the RunSpec environment snapshot for the spawned target", async () => {
    const environment = {
      ...process.env,
      RP_RUNPARITY_SPEC_VALUE: "from-run-spec",
    };
    const spec = captureRunSpec({
      argv: [
        process.execPath,
        "-e",
        "setTimeout(() => process.stdout.write(process.env.RP_RUNPARITY_SPEC_VALUE ?? 'MISSING'), 25)",
      ],
      cwd: process.cwd(),
      workspaceRoot: process.cwd(),
      environment,
      timeoutMs: 2_000,
    });
    const observationPromise = observeHost(spec);

    environment.RP_RUNPARITY_SPEC_VALUE = "mutated-after-observe-started";
    const observed = await observationPromise;

    expect(observed.process.stdout.redacted_excerpt).toBe("from-run-spec");
    expect(observed.launch.requestedProgram).toBe(process.execPath);
    expect(observed.process.exitCode).toBe(0);
  });

  test("records bounded monotonic process duration", async () => {
    const spec = captureRunSpec({
      argv: [process.execPath, "-e", "setTimeout(() => undefined, 40)"],
      cwd: process.cwd(),
      workspaceRoot: process.cwd(),
      environment: process.env,
      timeoutMs: 2_000,
    });

    const observed = await observeHost(spec);

    expect(observed.process.durationMs).toBeGreaterThanOrEqual(20);
    expect(observed.process.durationMs).toBeLessThan(2_000);
  });

  test("defensively copies and freezes captured argv and environment", async () => {
    const argv = [
      process.execPath,
      "-e",
      "setTimeout(() => process.stdout.write(process.argv[1] + '|' + process.env.RP_RUNPARITY_SPEC_VALUE), 25)",
      "original-argument",
    ];
    const environment = {
      ...process.env,
      RP_RUNPARITY_SPEC_VALUE: "original-environment",
    };
    const spec = captureRunSpec({
      argv,
      cwd: process.cwd(),
      workspaceRoot: process.cwd(),
      environment,
      timeoutMs: 2_000,
    });

    argv[3] = "mutated-argument";
    environment.RP_RUNPARITY_SPEC_VALUE = "mutated-environment";
    const observed = await observeHost(spec);

    expect(Object.isFrozen(spec)).toBe(true);
    expect(Object.keys(spec)).toEqual([]);
    expect(JSON.stringify(spec)).toBe("{}");
    expect(observed.process.stdout.redacted_excerpt).toBe("original-argument|original-environment");
  });

  test("does not reset an expired RunSpec deadline before launch", async () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-expired-spec-"));
    const marker = resolve(project, "target-started.txt");
    try {
      const spec = captureRunSpec({
        argv: [
          process.execPath,
          "-e",
          `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started')`,
        ],
        cwd: project,
        workspaceRoot: project,
        environment: process.env,
        timeoutMs: 10,
      });

      await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
      const observed = await observeHost(spec);

      expect(existsSync(marker)).toBe(false);
      expect(observed.process).toMatchObject({
        started: false,
        timedOut: true,
        timeoutPhase: "before_launch",
        exitCode: null,
        cleanup: { attempted: false, status: "not_required" },
      });
    } finally {
      rmSync(project, { force: true, recursive: true });
    }
  });

  test("returns a safely serializable observation instead of the execution LaunchPlan", async () => {
    const secret = "runparity-observed-run-secret-987654321";
    const project = mkdtempSync(resolve(tmpdir(), `runparity-safe-observation-${secret}-`));
    const argv = [process.execPath, "-e", "process.exit(23)", "--password", secret];
    try {
      const spec = captureRunSpec({
        argv,
        cwd: project,
        workspaceRoot: project,
        environment: { ...process.env, RP_DATABASE_PASSWORD: secret },
        timeoutMs: 2_000,
      });
      const observed = await observeHost(spec);
      const serialized = JSON.stringify(observed);

      expect(serialized).not.toContain(secret);
      expect(observed.request.argv).toEqual([
        process.execPath,
        "-e",
        "process.exit(23)",
        "--password",
        "[REDACTED]",
      ]);
      expect(observed.request.environment.valuesSerialized).toBe(false);
      expect("args" in observed.launch).toBe(false);
      expect("environmentMutations" in observed.launch).toBe(false);
    } finally {
      rmSync(project, { force: true, recursive: true });
    }
  });

  test("keeps sensitive RunSpec state unreachable through reflection and inspection", async () => {
    const secret = "runparity-private-runspec-secret-246813579";
    const argv = [process.execPath, "-e", "process.exit(23)", "--password", secret];
    const spec = captureRunSpec({
      argv,
      cwd: process.cwd(),
      workspaceRoot: process.cwd(),
      environment: { ...process.env, RP_DATABASE_PASSWORD: secret },
      timeoutMs: 2_000,
    });

    const reflectedValues = Object.getOwnPropertySymbols(spec).map((symbol) =>
      Reflect.get(spec, symbol),
    );
    for (const value of reflectedValues) {
      if (typeof value !== "object" || value === null || !("redaction" in value)) continue;
      const redaction = Reflect.get(value, "redaction");
      if (typeof redaction === "object" && redaction !== null) {
        Reflect.set(redaction, "redactText", (text: string) => text);
        Reflect.set(redaction, "redactArgv", (values: string[]) => values);
      }
    }

    expect(inspect(spec).includes(secret)).toBe(false);
    expect(inspect(reflectedValues).includes(secret)).toBe(false);
    expect(JSON.stringify(await observeHost(spec)).includes(secret)).toBe(false);
  });

  test("uses one captured cwd for resolution, config facts, and target execution", async () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-captured-cwd-"));
    const executableName = process.platform === "win32" ? "npm.exe" : "npm";
    const executable = resolve(project, executableName);
    try {
      try {
        linkSync(process.execPath, executable);
      } catch {
        copyFileSync(process.execPath, executable);
      }
      writeFileSync(resolve(project, ".npmrc"), "fund=true\n");
      const environment = Object.fromEntries(
        Object.entries(process.env).filter(([name]) => name.toLowerCase() !== "path"),
      );
      environment["PATH"] = "";
      environment["npm_config_fund"] = "false";
      const spec = captureRunSpec({
        argv: ["npm", "-e", "process.stdout.write(process.cwd())"],
        cwd: project,
        workspaceRoot: project,
        environment,
        timeoutMs: 10_000,
      });

      const observed = await observeHost(spec);

      expect(observed.launch.resolvedPath).toBe(executable);
      expect(observed.process.stdout.redacted_excerpt).toBe(project);
      expect(observed.configSourceConflicts).toMatchObject([
        {
          key: "fund",
          semantics: "unqualified",
          sources: [
            { source: "environment", value: false },
            { source: "project_npmrc", value: true },
          ],
        },
      ]);
    } finally {
      rmSync(project, { force: true, recursive: true });
    }
  });

  test.skipIf(process.platform !== "win32")(
    "uses controller infrastructure for cleanup even when target env omits SystemRoot",
    async () => {
      const environment = Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => name.toLowerCase() !== "systemroot" && name.toLowerCase() !== "windir",
        ),
      );
      const spec = captureRunSpec({
        argv: [process.execPath, "-e", "setInterval(() => undefined, 1_000)"],
        cwd: process.cwd(),
        workspaceRoot: process.cwd(),
        environment,
        timeoutMs: 100,
      });

      const observed = await observeHost(spec);

      expect(observed.process).toMatchObject({
        started: true,
        timedOut: true,
        timeoutPhase: "execution",
        cleanup: {
          attempted: true,
          status: "best_effort",
          strategy: "windows_taskkill",
        },
      });
    },
  );

  test.skipIf(process.platform !== "win32")(
    "keeps controller cleanup capability stable after RunSpec capture",
    async () => {
      const originalSystemRoot = process.env["SystemRoot"];
      const spec = captureRunSpec({
        argv: [process.execPath, "-e", "setInterval(() => undefined, 1_000)"],
        cwd: process.cwd(),
        workspaceRoot: process.cwd(),
        environment: process.env,
        timeoutMs: 100,
      });
      try {
        process.env["SystemRoot"] = resolve(tmpdir(), "runparity-not-a-windows-root");
        const observed = await observeHost(spec);

        expect(observed.process.cleanup).toMatchObject({
          attempted: true,
          status: "best_effort",
          strategy: "windows_taskkill",
        });
      } finally {
        if (originalSystemRoot === undefined) delete process.env["SystemRoot"];
        else process.env["SystemRoot"] = originalSystemRoot;
      }
    },
  );
});
