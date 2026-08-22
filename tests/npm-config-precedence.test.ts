import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { observeNpmConfigSourceConflicts } from "../src/npm-config.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("npm configuration precedence", () => {
  test("observes an environment boolean overriding a contradictory project npmrc", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-npm-config-env-"));
    temporaryDirectories.push(project);
    const npmrc = "fund=false\n";
    writeFileSync(resolve(project, ".npmrc"), npmrc);

    expect(
      observeNpmConfigSourceConflicts(["npm", "install"], project, {
        npm_config_fund: "true",
      }),
    ).toEqual([
      {
        command_shape: "npm_like",
        key: "fund",
        values_conflict: true,
        semantics: "unqualified",
        sources: [
          {
            source: "environment",
            value: true,
            provenance: {
              argv_index: null,
              environment_variable: "npm_config_fund",
              file: null,
              line: null,
              projection_sha256: null,
            },
          },
          {
            source: "project_npmrc",
            value: false,
            provenance: {
              argv_index: null,
              environment_variable: null,
              file: ".npmrc",
              line: 1,
              projection_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            },
          },
        ],
      },
    ]);
  });

  test("observes a CLI boolean overriding environment and project sources", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-npm-config-cli-"));
    temporaryDirectories.push(project);
    writeFileSync(resolve(project, ".npmrc"), "strict-peer-deps=true\n");

    const observations = observeNpmConfigSourceConflicts(
      ["npm", "install", "--strict-peer-deps", "false"],
      project,
      { npm_config_strict_peer_deps: "true" },
    );

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      key: "strict-peer-deps",
      values_conflict: true,
      semantics: "unqualified",
      sources: [
        { source: "cli", value: false, provenance: { argv_index: 2 } },
        { source: "environment", value: true },
        { source: "project_npmrc", value: true },
      ],
    });
  });

  test("does not emit a collision when all observed values agree", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-npm-config-equal-"));
    temporaryDirectories.push(project);
    writeFileSync(resolve(project, ".npmrc"), "fund=true\n");

    expect(
      observeNpmConfigSourceConflicts(["npm", "install", "--fund=true"], project, {
        NPM_CONFIG_FUND: "true",
      }),
    ).toEqual([]);
  });

  test.each([
    ["empty environment value", ["npm", "install"], { npm_config_fund: "" }],
    ["uppercase CLI key", ["npm", "install", "--FUND=true"], {}],
    ["uppercase CLI boolean", ["npm", "install", "--fund=TRUE"], {}],
    ["uppercase environment boolean", ["npm", "install"], { NPM_CONFIG_FUND: "TRUE" }],
  ] as const)("ignores an unqualified %s", (_label, argv, environment) => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-npm-config-unqualified-value-"));
    temporaryDirectories.push(project);
    writeFileSync(resolve(project, ".npmrc"), "fund=false\n");

    expect(observeNpmConfigSourceConflicts(argv, project, environment)).toEqual([]);
  });

  test("ignores an uppercase project npmrc key outside the exact parser subset", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-npm-config-uppercase-key-"));
    temporaryDirectories.push(project);
    writeFileSync(resolve(project, ".npmrc"), "FUND=false\n");

    expect(
      observeNpmConfigSourceConflicts(["npm", "install"], project, {
        npm_config_fund: "true",
      }),
    ).toEqual([]);
  });

  test("does not normalize underscores in project npmrc keys", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-npm-config-project-underscore-"));
    temporaryDirectories.push(project);
    writeFileSync(resolve(project, ".npmrc"), "strict_peer_deps=true\n");

    expect(
      observeNpmConfigSourceConflicts(["npm", "install"], project, {
        npm_config_strict_peer_deps: "false",
      }),
    ).toEqual([]);
  });

  test("binds provenance to the allowlisted key projection, not unrelated npmrc secrets", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-npm-config-projection-"));
    temporaryDirectories.push(project);
    writeFileSync(
      resolve(project, ".npmrc"),
      "fund=false\n//registry.example.invalid/:_authToken=alpha\n",
    );
    const first = observeNpmConfigSourceConflicts(["npm", "install"], project, {
      npm_config_fund: "true",
    });
    writeFileSync(
      resolve(project, ".npmrc"),
      "fund=false\n//registry.example.invalid/:_authToken=beta\n",
    );
    const second = observeNpmConfigSourceConflicts(["npm", "install"], project, {
      npm_config_fund: "true",
    });
    const firstProjection = first[0]?.sources.find((source) => source.source === "project_npmrc")
      ?.provenance.projection_sha256;
    const secondProjection = second[0]?.sources.find((source) => source.source === "project_npmrc")
      ?.provenance.projection_sha256;

    expect(firstProjection).toMatch(/^[a-f0-9]{64}$/);
    expect(secondProjection).toBe(firstProjection);
  });

  test("matches npm's double-negation semantics for an explicit false value", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-npm-config-negated-"));
    temporaryDirectories.push(project);
    writeFileSync(resolve(project, ".npmrc"), "fund=false\n");

    expect(
      observeNpmConfigSourceConflicts(["npm", "--no-fund=false", "install"], project, process.env),
    ).toEqual([
      expect.objectContaining({
        key: "fund",
        values_conflict: true,
        sources: [
          expect.objectContaining({ source: "cli", value: true }),
          expect.objectContaining({ source: "project_npmrc", value: false }),
        ],
      }),
    ]);
  });

  test.each([
    ["fund", "--no-fund"],
    ["strict-peer-deps", "--no-strict-peer-deps"],
  ] as const)("matches npm's separated-value negation for %s", (key, flag) => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-npm-config-separated-negation-"));
    temporaryDirectories.push(project);
    writeFileSync(resolve(project, ".npmrc"), `${key}=false\n`);

    expect(
      observeNpmConfigSourceConflicts(["npm", flag, "false", "install"], project, process.env),
    ).toEqual([
      expect.objectContaining({
        key,
        values_conflict: true,
        sources: [
          expect.objectContaining({ source: "cli", value: true }),
          expect.objectContaining({ source: "project_npmrc", value: false }),
        ],
      }),
    ]);
  });

  test("ignores secret-bearing, dynamic, and global-mode configuration", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-npm-config-scope-"));
    temporaryDirectories.push(project);
    writeFileSync(
      resolve(project, ".npmrc"),
      "registry=https://user:secret@example.invalid\nfund=false\n",
    );

    expect(
      observeNpmConfigSourceConflicts(["npm", "install"], project, {
        npm_config_registry: "https://different.invalid",
      }),
    ).toEqual([]);
    expect(
      observeNpmConfigSourceConflicts(["npm", "install", "--global"], project, {
        npm_config_fund: "true",
      }),
    ).toEqual([]);
    for (const globalArgument of ["--global=true", "-g=true", "--location=global"]) {
      expect(
        observeNpmConfigSourceConflicts(["npm", "install", globalArgument], project, {
          npm_config_fund: "true",
        }),
      ).toEqual([]);
    }
    expect(
      observeNpmConfigSourceConflicts(["npm", "install"], project, {
        npm_config_fund: "true",
        npm_config_global: "true",
      }),
    ).toEqual([]);
  });

  test("keeps a fake npm command at unqualified source-conflict semantics", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-npm-config-finding-"));
    temporaryDirectories.push(project);
    writeFileSync(resolve(project, ".npmrc"), "fund=false\n");
    const observations = observeNpmConfigSourceConflicts(["npm", "install"], project, {
      npm_config_fund: "true",
    });

    expect(observations).toEqual([
      expect.objectContaining({
        command_shape: "npm_like",
        key: "fund",
        values_conflict: true,
        semantics: "unqualified",
      }),
    ]);
    expect(observations[0]).not.toHaveProperty("manager");
    expect(observations[0]).not.toHaveProperty("winner_source");
  });
});
