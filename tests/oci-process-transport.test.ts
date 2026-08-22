import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  createControlPlaneProcessAdapter,
  createOciPreflightProcessTransport,
} from "../src/control-plane-process.js";
import { preflightLinuxRootlessOci } from "../src/oci/linux-rootless-preflight.js";

describe("OCI preflight process transport", () => {
  test("refuses uncontained process output before static preflight can trust it", async () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-oci-transport-"));
    const callsPath = resolve(project, "calls.jsonl");
    const fixturePath = resolve(project, "fake-docker.mjs");
    const endpoint =
      process.platform === "win32"
        ? "npipe:////./pipe/runparityFixtureEngine"
        : "unix:///run/user/1000/runparity-fixture-engine.sock";
    writeFileSync(
      fixturePath,
      [
        'import { appendFileSync } from "node:fs";',
        `const callsPath = ${JSON.stringify(callsPath)};`,
        "const args = process.argv.slice(2);",
        'appendFileSync(callsPath, JSON.stringify(args) + "\\n", "utf8");',
        'if (args[0] === "context") {',
        `  process.stdout.write(JSON.stringify({ Name: "approved", Endpoints: { docker: { Host: ${JSON.stringify(endpoint)} } } }));`,
        "  process.exit(0);",
        "}",
        'if (args.includes("version")) {',
        '  process.stderr.write("fixture daemon unavailable");',
        "  process.exit(42);",
        "}",
        'process.stderr.write("unexpected live stage");',
        "process.exit(99);",
      ].join("\n"),
      "utf8",
    );

    try {
      const controller = createControlPlaneProcessAdapter({
        executablePath: process.execPath,
        baseArgs: [fixturePath],
        cwd: project,
      });
      const result = await preflightLinuxRootlessOci({
        approvedContext: "approved",
        imageRef: `registry.example.test/runparity/base@sha256:${"a".repeat(64)}`,
        deadlineNanoseconds: process.hrtime.bigint() + 5_000_000_000n,
        transport: createOciPreflightProcessTransport(controller),
      });

      expect(result).toEqual({
        backend: "linux_rootless_oci",
        status: "unqualified",
        reasonCode: "RP_SAFETY_GUARD_TRIGGERED",
        stage: "context",
      });
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.keys(result).sort()).toEqual(["backend", "reasonCode", "stage", "status"]);
      const calls = readFileSync(callsPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.slice(0, 3)).toEqual(["context", "inspect", "approved"]);
      expect(calls.flat()).not.toContain("version");
      expect(calls.flat()).not.toContain("info");
      expect(calls.flat()).not.toContain("image");
      expect(result).not.toHaveProperty("qualification");
      expect(result).not.toHaveProperty("receipt");
      expect(result).not.toHaveProperty("ledger");
      expect(result).not.toHaveProperty("verdict");
      expect(result).not.toHaveProperty("authorization");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
