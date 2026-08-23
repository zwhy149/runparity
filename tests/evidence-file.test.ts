import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { readEvidenceFile } from "../src/evidence-file.js";

const temporaryDirectories: string[] = [];

function workspace(prefix: string): string {
  const directory = mkdtempSync(resolve(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("bounded evidence-file Module", () => {
  test("distinguishes a missing workspace file from an unsafe file type", () => {
    const root = workspace("runparity-evidence-type-");
    expect(readEvidenceFile({ role: "workspace_contract", root })).toEqual({
      ok: false,
      reason: "missing",
    });

    mkdirSync(resolve(root, "package.json"));
    expect(readEvidenceFile({ role: "workspace_contract", root })).toEqual({
      ok: false,
      reason: "unsafe_type",
    });
  });

  test("reads a stable workspace file with canonical identity", () => {
    const root = workspace("runparity-evidence-read-");
    const contents = '{"name":"fixture"}\n';
    writeFileSync(resolve(root, "package.json"), contents);

    const result = readEvidenceFile({ role: "workspace_contract", root });

    expect(result).toMatchObject({
      ok: true,
      path: realpathSync.native(resolve(root, "package.json")),
      identity: {
        size: Buffer.byteLength(contents),
      },
    });
    if (result.ok) expect(result.bytes.toString("utf8")).toBe(contents);
  });

  test("enforces role-specific size limits before returning bytes", () => {
    const root = workspace("runparity-evidence-size-");
    writeFileSync(resolve(root, ".npmrc"), Buffer.alloc(64 * 1024 + 1, 0x20));
    expect(readEvidenceFile({ role: "workspace_config", root })).toEqual({
      ok: false,
      reason: "too_large",
    });

    const launcher = resolve(root, "tool.cmd");
    writeFileSync(launcher, Buffer.alloc(64 * 1024 + 1, 0x3a));
    expect(readEvidenceFile({ role: "resolved_launcher", path: launcher })).toEqual({
      ok: false,
      reason: "too_large",
    });
  });
});
