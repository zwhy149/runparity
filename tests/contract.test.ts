import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { compileContract } from "../src/contract.js";

const temporaryDirectories: string[] = [];

function project(prefix: string): string {
  const directory = mkdtempSync(resolve(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("Contract compiler file boundary", () => {
  test("reports an unsafe package.json file type instead of treating it as absent", () => {
    const root = project("runparity-contract-unsafe-");
    mkdirSync(resolve(root, "package.json"));

    expect(compileContract(root)).toEqual({
      status: "partial",
      constraints: [],
      unresolved: [
        {
          file: "package.json",
          pointer: "",
          reason_code: "RP_CONTRACT_UNSAFE_FILE",
        },
      ],
    });
  });

  test("rejects an oversized package.json at the bounded-read boundary", () => {
    const root = project("runparity-contract-large-");
    writeFileSync(resolve(root, "package.json"), Buffer.alloc(1024 * 1024 + 1, 0x20));

    expect(compileContract(root)).toEqual({
      status: "partial",
      constraints: [],
      unresolved: [
        {
          file: "package.json",
          pointer: "",
          reason_code: "RP_CONTRACT_FILE_TOO_LARGE",
        },
      ],
    });
  });

  test("reports invalid JSON without evaluating repository code", () => {
    const root = project("runparity-contract-invalid-");
    writeFileSync(resolve(root, "package.json"), '{"engines": process.exit(99)}');

    expect(compileContract(root)).toEqual({
      status: "partial",
      constraints: [],
      unresolved: [
        {
          file: "package.json",
          pointer: "",
          reason_code: "RP_CONTRACT_INVALID_JSON",
        },
      ],
    });
  });

  test("hashes only each allowlisted contract projection, not unrelated manifest fields", () => {
    const root = project("runparity-contract-projection-");
    writeFileSync(
      resolve(root, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@11.19.0",
        engines: { node: ">=22" },
        privateCredentialHint: "alpha",
      }),
    );
    const first = compileContract(root);
    writeFileSync(
      resolve(root, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@11.19.0",
        engines: { node: ">=22" },
        privateCredentialHint: "beta",
      }),
    );
    const second = compileContract(root);

    const firstDigests = first.constraints.map(
      (constraint) => constraint.provenance.projection_sha256,
    );
    const secondDigests = second.constraints.map(
      (constraint) => constraint.provenance.projection_sha256,
    );
    expect(firstDigests).toEqual([
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.stringMatching(/^[a-f0-9]{64}$/),
    ]);
    expect(secondDigests).toEqual(firstDigests);
    expect(first.constraints[0]?.provenance).not.toHaveProperty("sha256");
  });
});
