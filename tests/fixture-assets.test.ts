import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = resolve(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs");
const runParityCli = resolve(repositoryRoot, "src", "cli.ts");

type DevPath003Layout = Readonly<{
  schema: "runparity.fixture-link-layout/v1";
  command: "node";
  links: readonly Readonly<{ path: string; target: string }>[];
  incompatible_target: string;
  repository_entry: string;
}>;

type MutableDevPath003Layout = {
  schema: string;
  command: string;
  links: [{ path: string; target: string }, { path: string; target: string }];
  incompatible_target: string;
  repository_entry: string;
};

function containedRelativePath(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot.length > 0 &&
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  );
}

function planDevPath003Materialization(workspace: string, candidate: unknown) {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate) ||
    Object.keys(candidate).sort().join(",") !==
      "command,incompatible_target,links,repository_entry,schema"
  ) {
    throw new Error("invalid link recipe");
  }
  const layout = candidate as DevPath003Layout;
  if (
    layout.schema !== "runparity.fixture-link-layout/v1" ||
    layout.command !== "node" ||
    !Array.isArray(layout.links) ||
    layout.links.length !== 2
  ) {
    throw new Error("invalid link recipe contract");
  }
  const root = resolve(workspace);
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync.native(root);
  } catch {
    throw new Error("workspace root must already exist and be reachable");
  }
  if (!statSync(canonicalRoot).isDirectory()) {
    throw new Error("workspace root must be a directory");
  }
  const canonicalParent = realpathSync.native(dirname(root));
  if (canonicalRoot !== resolve(canonicalParent, basename(root))) {
    throw new Error("workspace root must not be a replaced symlink or junction");
  }
  const safeRecipeText = (value: unknown) =>
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    /^[A-Za-z0-9._/-]+$/u.test(value) &&
    !isAbsolute(value);
  const safeAssetPath = (value: unknown) =>
    safeRecipeText(value) &&
    !(value as string).split("/").some((component) => component === "." || component === "..");
  if (!safeAssetPath(layout.incompatible_target) || !safeAssetPath(layout.repository_entry)) {
    throw new Error("invalid launcher role path");
  }
  const incompatiblePath = resolve(root, layout.incompatible_target);
  const repositoryPath = resolve(root, layout.repository_entry);
  if (
    !containedRelativePath(root, incompatiblePath) ||
    !containedRelativePath(root, repositoryPath) ||
    incompatiblePath === repositoryPath
  ) {
    throw new Error("launcher role path escapes or collapses");
  }

  const seenLinkPaths = new Set<string>();
  const links = layout.links.map((link) => {
    if (
      typeof link !== "object" ||
      link === null ||
      Array.isArray(link) ||
      Object.keys(link).sort().join(",") !== "path,target" ||
      !safeAssetPath(link.path) ||
      !safeRecipeText(link.target)
    ) {
      throw new Error("invalid link declaration");
    }
    const absolutePath = resolve(root, link.path);
    const resolvedTarget = resolve(dirname(absolutePath), link.target);
    if (
      !containedRelativePath(root, absolutePath) ||
      !containedRelativePath(root, resolvedTarget) ||
      absolutePath === resolvedTarget ||
      seenLinkPaths.has(absolutePath)
    ) {
      throw new Error("link declaration escapes, loops, or conflicts");
    }
    seenLinkPaths.add(absolutePath);
    return Object.freeze({
      path: link.path,
      target: link.target,
      absolutePath,
      resolvedTarget,
    });
  });
  return Object.freeze({
    layout,
    root,
    links: Object.freeze(links),
    incompatiblePath,
    repositoryPath,
  });
}

function inspectDevPath003MaterializedLayout(workspace: string, candidate: unknown) {
  const plan = planDevPath003Materialization(workspace, candidate);
  const canonicalWorkspace = realpathSync.native(plan.root);
  const linkTexts = plan.links.map((link) => {
    if (!lstatSync(link.absolutePath).isSymbolicLink()) {
      throw new Error("link node is not a symlink");
    }
    const observedTarget = readlinkSync(link.absolutePath);
    if (observedTarget !== link.target) throw new Error("link text changed");
    return observedTarget;
  });
  const shadowEntry = plan.links[0]?.absolutePath ?? "";
  const incompatibleLauncher = plan.incompatiblePath;
  const compatibleLauncher = plan.repositoryPath;
  const canonicalShadow = realpathSync.native(shadowEntry);
  const canonicalIncompatible = realpathSync.native(incompatibleLauncher);
  const canonicalCompatible = realpathSync.native(compatibleLauncher);
  if (canonicalShadow !== canonicalIncompatible) throw new Error("symlink target changed");
  if (canonicalShadow === canonicalCompatible) throw new Error("fixture candidates collapsed");

  const digests: string[] = [];
  for (const target of [canonicalShadow, canonicalCompatible]) {
    const pathFromWorkspace = relative(canonicalWorkspace, target);
    if (
      pathFromWorkspace === ".." ||
      pathFromWorkspace.startsWith(`..${sep}`) ||
      isAbsolute(pathFromWorkspace)
    ) {
      throw new Error("canonical target escapes fixture workspace");
    }
    const metadata = statSync(target);
    if (!metadata.isFile() || metadata.nlink !== 1) throw new Error("unsafe launcher node");
    accessSync(target, constants.X_OK);
    digests.push(createHash("sha256").update(readFileSync(target)).digest("hex"));
  }
  return Object.freeze({
    linkTexts: Object.freeze(linkTexts),
    shadowEntry,
    canonicalShadow,
    canonicalCompatible,
    digests: Object.freeze(digests),
  });
}

describe("implemented development fixture assets", () => {
  test("DEV-RUNTIME-001 evaluates the frozen engines rule without claiming proof", () => {
    const fixtureRoot = resolve(repositoryRoot, "fixtures");
    const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-RUNTIME-001");
    const entrypoint = resolve(assetRoot, "fixture", "assert-engines-range.mjs");
    const manifest = JSON.parse(
      readFileSync(resolve(fixtureRoot, "development", "cases", "DEV-RUNTIME-001.json"), "utf8"),
    );
    const packageManifest = JSON.parse(readFileSync(resolve(assetRoot, "package.json"), "utf8"));

    expect(manifest).toMatchObject({
      fixture_status: "verified",
      implementation: {
        runnable: true,
        asset_root: "development/assets/DEV-RUNTIME-001",
        missing_assets: [],
        receipts: {
          build: "receipts/build/DEV-RUNTIME-001.json",
          backend_qualification: "receipts/backend/qemu-kvm-ubuntu-noble-rpvm-2026-08-22.json",
          verification_ledger: "receipts/ledger/DEV-RUNTIME-001.json",
        },
        verified_at: expect.any(String),
      },
    });
    expect(packageManifest).toMatchObject({
      name: "runparity-fixture-dev-runtime-001",
      private: true,
      engines: { node: ">=22.0.0 <23.0.0" },
    });

    const policyProbe = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        [
          `const fixture = await import(${JSON.stringify(pathToFileURL(entrypoint).href)})`,
          "const results = [",
          "  fixture.evaluateNodeVersion('22.22.0', '>=22.0.0 <23.0.0'),",
          "  fixture.evaluateNodeVersion('24.15.0', '>=22.0.0 <23.0.0'),",
          "  fixture.evaluateNodeVersion('22.22.0', '>=20'),",
          "  fixture.evaluateNodeVersion('22.0.0-rc.1', '>=22.0.0 <23.0.0'),",
          "].map((result) => result.status)",
          "process.stdout.write(JSON.stringify(results))",
        ].join("\n"),
      ],
      { cwd: assetRoot, encoding: "utf8", env: {}, shell: false },
    );
    expect(policyProbe.status).toBe(0);
    expect(JSON.parse(policyProbe.stdout)).toEqual([
      "satisfied",
      "outside_range",
      "invalid_selector",
      "invalid_version",
    ]);

    const direct = spawnSync(process.execPath, [entrypoint], {
      cwd: assetRoot,
      encoding: "utf8",
      env: {},
      shell: false,
    });
    const activeMajor = Number(process.versions.node.split(".")[0]);
    const activeSatisfiesFixture = activeMajor === 22;
    expect(direct.status).toBe(activeSatisfiesFixture ? 0 : 23);
    expect(direct.stdout).toBe(activeSatisfiesFixture ? "RUNPARITY_OK:dev-runtime-001\n" : "");
    expect(direct.stderr).toBe(
      activeSatisfiesFixture
        ? ""
        : `RP_FIXTURE_NODE_OUTSIDE_ENGINES active=${process.versions.node} expected=>=22.0.0 <23.0.0\n`,
    );

    const copiedAssetRoot = mkdtempSync(resolve(tmpdir(), "runparity-runtime-contract-copy-"));
    try {
      const copiedEntrypoint = resolve(copiedAssetRoot, "fixture", "assert-engines-range.mjs");
      mkdirSync(resolve(copiedAssetRoot, "fixture"));
      copyFileSync(entrypoint, copiedEntrypoint);
      writeFileSync(
        resolve(copiedAssetRoot, "package.json"),
        JSON.stringify({ engines: { node: ">=0.0.0 <1.0.0" } }),
      );
      const changedContract = spawnSync(process.execPath, [copiedEntrypoint], {
        cwd: copiedAssetRoot,
        encoding: "utf8",
        env: {},
        shell: false,
      });
      expect(changedContract.status).toBe(23);
      expect(changedContract.stderr).toBe(
        `RP_FIXTURE_NODE_OUTSIDE_ENGINES active=${process.versions.node} expected=>=0.0.0 <1.0.0\n`,
      );
    } finally {
      rmSync(copiedAssetRoot, { force: true, recursive: true });
    }

    const preloadRoot = mkdtempSync(resolve(tmpdir(), "runparity-runtime-preload-"));
    try {
      const preload = resolve(preloadRoot, "spoof-node-version.mjs");
      writeFileSync(
        preload,
        "Object.defineProperty(process.versions, 'node', { value: '22.22.0' });\n",
      );
      const explicitPreload = spawnSync(
        process.execPath,
        [`--import=${pathToFileURL(preload).href}`, entrypoint],
        { cwd: assetRoot, encoding: "utf8", env: {}, shell: false },
      );
      const environmentPreload = spawnSync(process.execPath, [entrypoint], {
        cwd: assetRoot,
        encoding: "utf8",
        env: { NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` },
        shell: false,
      });
      for (const rejected of [explicitPreload, environmentPreload]) {
        expect(rejected.status).toBe(64);
        expect(rejected.stdout).toBe("");
        expect(rejected.stderr).toBe("RP_FIXTURE_UNCONTROLLED_NODE_PRELOAD\n");
      }
    } finally {
      rmSync(preloadRoot, { force: true, recursive: true });
    }

    const observed = spawnSync(
      process.execPath,
      [
        tsxCli,
        runParityCli,
        "--json",
        "doctor",
        "--report-only",
        "--",
        process.execPath,
        entrypoint,
      ],
      { cwd: assetRoot, encoding: "utf8", env: process.env, shell: false },
    );
    expect(observed.status).toBe(0);
    expect(observed.stderr).toBe("");
    const report = JSON.parse(observed.stdout).data.report;
    expect(report.status).toBe(activeSatisfiesFixture ? "success_observed" : "failure_observed");
    expect(report.execution_context).toBe("HOST_OBSERVATION");
    expect(report.reference).toMatchObject({
      resolution: "not_found",
      qualification: "not_applicable",
    });
    expect(report.experiment).toEqual({
      status: "not_attempted",
      reason_codes: expect.any(Array),
    });
    expect(report.remediation).toEqual({ mode: "manual_only", changes: [] });
    expect(report.verdict).toBe(activeSatisfiesFixture ? "INCONCLUSIVE" : "PARTIAL_EVIDENCE");
    expect(report.verdict).not.toBe("VERIFIED_INTERVENTION");
    expect(report.findings).toEqual(
      activeSatisfiesFixture
        ? []
        : [
            expect.objectContaining({
              id: "RP-RUNTIME-0001",
              category: "RUNTIME_MANAGER_DRIFT",
              state: "candidate",
              observed: process.versions.node,
              expected: ">=22.0.0 <23.0.0",
            }),
          ],
    );
    expect(observed.stdout).not.toContain('"verdict":"VERIFIED_INTERVENTION"');
  });

  test("DEV-PATH-001 target assertion is deterministic and fails closed", () => {
    const fixtureRoot = resolve(repositoryRoot, "fixtures");
    const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-PATH-001");
    const entrypoint = resolve(assetRoot, "fixture", "assert-node-marker.mjs");
    const manifest = JSON.parse(
      readFileSync(resolve(fixtureRoot, "development", "cases", "DEV-PATH-001.json"), "utf8"),
    );
    expect(manifest).toMatchObject({
      fixture_status: "verified",
      implementation: {
        runnable: true,
        asset_root: "development/assets/DEV-PATH-001",
        missing_assets: [],
        receipts: {
          build: "receipts/build/DEV-PATH-001.json",
          backend_qualification: "receipts/backend/qemu-kvm-ubuntu-noble-rpvm-2026-08-22.json",
          verification_ledger: "receipts/ledger/DEV-PATH-001.json",
        },
        verified_at: "2026-08-22T09:28:41Z",
      },
    });
    for (const receiptPath of [
      "receipts/backend/qemu-kvm-ubuntu-noble-rpvm-2026-08-22.json",
      "receipts/backend/qemu-kvm-ubuntu-noble-rpvm-2026-08-22.facts.json",
      "receipts/ledger/DEV-PATH-001.json",
    ]) {
      expect(existsSync(resolve(fixtureRoot, receiptPath)), receiptPath).toBe(true);
    }
    const wrongLauncherSource = readFileSync(
      resolve(assetRoot, "wrong-node", "bin", "node"),
      "utf8",
    );
    const intendedLauncherSource = readFileSync(
      resolve(assetRoot, "intended-node", "bin", "node"),
      "utf8",
    );
    expect(wrongLauncherSource.replace("=wrong\n", "=<MARKER>\n")).toBe(
      intendedLauncherSource.replace("=intended\n", "=<MARKER>\n"),
    );
    for (const launcherSource of [wrongLauncherSource, intendedLauncherSource]) {
      expect(launcherSource).toMatch(/^#!\/bin\/sh\n/u);
      expect(launcherSource).toContain('exec "$RUNPARITY_FIXTURE_REAL_NODE" "$@"\n');
      expect(launcherSource).not.toMatch(/`|\$\(|\beval\b|\benv\s/u);
    }

    const runMarker = (marker: string | undefined) =>
      spawnSync(process.execPath, [entrypoint], {
        cwd: assetRoot,
        encoding: "utf8",
        env: marker === undefined ? {} : { RUNPARITY_FIXTURE_NODE_MARKER: marker },
        shell: false,
      });
    const wrong = runMarker("wrong");
    const intended = runMarker("intended");
    const missing = runMarker(undefined);
    const invalidCanary = "RP_INVALID_MARKER_SECRET_97531";
    const invalid = runMarker(invalidCanary);

    expect(wrong).toMatchObject({
      status: 23,
      stdout: "",
      stderr: "RP_FIXTURE_WRONG_NODE_PATH\n",
    });
    expect(intended).toMatchObject({
      status: 0,
      stdout: "RUNPARITY_OK:dev-path-001\n",
      stderr: "",
    });
    for (const rejected of [missing, invalid]) {
      expect(rejected).toMatchObject({
        status: 64,
        stdout: "",
        stderr: "RP_FIXTURE_INVALID_NODE_MARKER\n",
      });
      expect(rejected.stderr).not.toContain(invalidCanary);
    }
  });

  test.runIf(process.platform !== "win32")(
    "DEV-PATH-001 observes real PATH order without claiming an experiment",
    () => {
      const sourceRoot = resolve(
        repositoryRoot,
        "fixtures",
        "development",
        "assets",
        "DEV-PATH-001",
      );
      const workspace = mkdtempSync(resolve(tmpdir(), "runparity-dev-path-001-"));
      try {
        const relativeAssets = [
          "fixture/assert-node-marker.mjs",
          "wrong-node/bin/node",
          "intended-node/bin/node",
        ];
        for (const relativeAsset of relativeAssets) {
          const destination = resolve(workspace, relativeAsset);
          mkdirSync(dirname(destination), { recursive: true });
          copyFileSync(resolve(sourceRoot, relativeAsset), destination);
        }
        const wrongLauncher = resolve(workspace, "wrong-node", "bin", "node");
        const intendedLauncher = resolve(workspace, "intended-node", "bin", "node");
        chmodSync(wrongLauncher, 0o755);
        chmodSync(intendedLauncher, 0o755);
        const targetArgv = ["node", "fixture/assert-node-marker.mjs"] as const;
        const controlledEnvironment = {
          ...process.env,
          NODE_OPTIONS: undefined,
          RUNPARITY_FIXTURE_REAL_NODE: process.execPath,
        };
        const wrongFirst = {
          ...controlledEnvironment,
          PATH: [dirname(wrongLauncher), dirname(intendedLauncher)].join(delimiter),
        };
        const intendedFirst = {
          ...controlledEnvironment,
          PATH: [dirname(intendedLauncher), dirname(wrongLauncher)].join(delimiter),
        };

        const nativeWrong = spawnSync(targetArgv[0], targetArgv.slice(1), {
          cwd: workspace,
          encoding: "utf8",
          env: wrongFirst,
          shell: false,
        });
        const nativeIntended = spawnSync(targetArgv[0], targetArgv.slice(1), {
          cwd: workspace,
          encoding: "utf8",
          env: intendedFirst,
          shell: false,
        });
        expect(nativeWrong).toMatchObject({
          status: 23,
          stdout: "",
          stderr: "RP_FIXTURE_WRONG_NODE_PATH\n",
        });
        expect(nativeIntended).toMatchObject({
          status: 0,
          stdout: "RUNPARITY_OK:dev-path-001\n",
          stderr: "",
        });

        const observed = spawnSync(
          process.execPath,
          [tsxCli, runParityCli, "--json", "doctor", "--report-only", "--", ...targetArgv],
          {
            cwd: workspace,
            encoding: "utf8",
            env: wrongFirst,
            shell: false,
          },
        );
        expect(observed.status).toBe(0);
        expect(observed.stderr).toBe("");
        expect(observed.stdout).not.toContain('"verdict":"VERIFIED_INTERVENTION"');
        const report = JSON.parse(observed.stdout).data.report;
        expect(report).toMatchObject({
          status: "failure_observed",
          verdict: "PARTIAL_EVIDENCE",
          execution_context: "HOST_OBSERVATION",
          reference: { resolution: "not_found", qualification: "not_applicable" },
          experiment: { status: "not_attempted" },
          remediation: { mode: "manual_only", changes: [] },
          observation: {
            runtime: null,
            launch: {
              selected_search_path: wrongLauncher,
              resolved_path: wrongLauncher,
              candidates: [wrongLauncher, intendedLauncher],
              candidate_resolutions: [
                { search_path: wrongLauncher, canonical_path: wrongLauncher },
                { search_path: intendedLauncher, canonical_path: intendedLauncher },
              ],
              candidate_resolutions_truncated: false,
            },
            result: {
              status: "failed",
              exit_code: 23,
              stderr: {
                redacted_excerpt: "RP_FIXTURE_WRONG_NODE_PATH\n",
                digest: { algorithm: "HMAC-SHA-256", key_scope: "invocation" },
              },
            },
          },
        });
        expect(report.findings).toEqual([
          expect.objectContaining({
            id: "RP-PATH-0001",
            category: "PATH_SHADOWING",
            state: "candidate",
            selected: wrongLauncher,
            alternatives: [intendedLauncher],
            intervention: null,
          }),
        ]);
      } finally {
        rmSync(workspace, { force: true, recursive: true });
      }
    },
  );

  test("DEV-PATH-003 has a deterministic symlink-toolchain assertion and inert recipe", () => {
    const fixtureRoot = resolve(repositoryRoot, "fixtures");
    const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-PATH-003");
    const entrypoint = resolve(assetRoot, "fixture", "assert-toolchain-marker.mjs");
    const incompatibleLauncher = resolve(assetRoot, "unintended-toolchain", "bin", "node-target");
    const compatibleLauncher = resolve(assetRoot, "repository-fixture", "bin", "node");
    const manifest = JSON.parse(
      readFileSync(resolve(fixtureRoot, "development", "cases", "DEV-PATH-003.json"), "utf8"),
    );
    const layout = JSON.parse(
      readFileSync(resolve(assetRoot, "fixture", "link-layout.json"), "utf8"),
    );

    expect(manifest).toMatchObject({
      fixture_status: "verified",
      scenario: {
        planned_target_argv: ["node", "fixture/assert-toolchain-marker.mjs", "--assert-compatible"],
      },
      implementation: {
        runnable: true,
        asset_root: "development/assets/DEV-PATH-003",
        missing_assets: [],
        receipts: {
          build: "receipts/build/DEV-PATH-003.json",
          backend_qualification: "receipts/backend/qemu-kvm-ubuntu-noble-rpvm-2026-08-22.json",
          verification_ledger: "receipts/ledger/DEV-PATH-003.json",
        },
        verified_at: expect.any(String),
      },
    });
    expect(layout).toEqual({
      schema: "runparity.fixture-link-layout/v1",
      command: "node",
      links: [
        { path: "preexisting/bin/node", target: "../../link-hops/node-hop" },
        {
          path: "link-hops/node-hop",
          target: "../unintended-toolchain/bin/node-target",
        },
      ],
      incompatible_target: "unintended-toolchain/bin/node-target",
      repository_entry: "repository-fixture/bin/node",
    });

    const hostileRecipeRoot = mkdtempSync(resolve(tmpdir(), "runparity-path003-recipe-"));
    try {
      const recipeWorkspace = resolve(hostileRecipeRoot, "workspace");
      mkdirSync(recipeWorkspace);
      const escapedLink = resolve(hostileRecipeRoot, "escaped-link");
      const escapedTarget = resolve(hostileRecipeRoot, "escaped-target");
      const pathEscape = structuredClone(layout);
      pathEscape.links[0].path = "../escaped-link";
      expect(() => planDevPath003Materialization(recipeWorkspace, pathEscape)).toThrow();
      expect(existsSync(escapedLink)).toBe(false);

      const targetEscape = structuredClone(layout);
      targetEscape.links[0].target = "../../../escaped-target";
      expect(() => planDevPath003Materialization(recipeWorkspace, targetEscape)).toThrow();
      expect(existsSync(escapedTarget)).toBe(false);
    } finally {
      rmSync(hostileRecipeRoot, { force: true, recursive: true });
    }

    const incompatibleSource = readFileSync(incompatibleLauncher, "utf8");
    const compatibleSource = readFileSync(compatibleLauncher, "utf8");
    expect(incompatibleSource.replace("=incompatible\n", "=<MARKER>\n")).toBe(
      compatibleSource.replace("=compatible\n", "=<MARKER>\n"),
    );
    for (const source of [incompatibleSource, compatibleSource]) {
      expect(source).toMatch(/^#!\/bin\/sh\n/u);
      expect(source).toContain('exec "$RUNPARITY_FIXTURE_REAL_NODE" "$@"\n');
      expect(source).not.toMatch(/`|\$\(|\beval\b|\benv\s/iu);
    }

    const runMarker = (marker: string | undefined, args = ["--assert-compatible"]) =>
      spawnSync(process.execPath, [entrypoint, ...args], {
        cwd: assetRoot,
        encoding: "utf8",
        env: marker === undefined ? {} : { RUNPARITY_FIXTURE_TOOLCHAIN_MARKER: marker },
        shell: false,
      });
    expect(runMarker("compatible")).toMatchObject({
      status: 0,
      stdout: "RUNPARITY_OK:dev-path-003\n",
      stderr: "",
    });
    expect(runMarker("incompatible")).toMatchObject({
      status: 23,
      stdout: "",
      stderr: "RP_FIXTURE_SYMLINK_TOOLCHAIN\n",
    });
    const invalidCanary = "RP_INVALID_TOOLCHAIN_SECRET_86420";
    for (const rejected of [
      runMarker(undefined),
      runMarker(invalidCanary),
      runMarker("compatible", []),
      runMarker("compatible", ["--assert-compatible", "extra"]),
    ]) {
      expect(rejected).toMatchObject({
        status: 64,
        stdout: "",
        stderr: "RP_FIXTURE_INVALID_TOOLCHAIN_ASSERTION\n",
      });
      expect(rejected.stderr).not.toContain(invalidCanary);
    }
  });

  test("DEV-PATH-003 materialization planner rejects the hostile recipe matrix", () => {
    const fixtureRoot = resolve(repositoryRoot, "fixtures");
    const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-PATH-003");
    const layout = JSON.parse(
      readFileSync(resolve(assetRoot, "fixture", "link-layout.json"), "utf8"),
    ) as DevPath003Layout;
    const hostileRoot = mkdtempSync(resolve(tmpdir(), "runparity-path003-adversarial-"));
    try {
      const workspace = resolve(hostileRoot, "workspace");
      mkdirSync(workspace);
      const escapeSink = resolve(hostileRoot, "escape-sink");
      mkdirSync(escapeSink);

      const rejectWithoutMaterializing = (mutate: (candidate: MutableDevPath003Layout) => void) => {
        const candidate = structuredClone(layout) as unknown as MutableDevPath003Layout;
        mutate(candidate);
        expect(() => planDevPath003Materialization(workspace, candidate)).toThrow();
        expect(readdirSync(escapeSink)).toEqual([]);
        expect(readdirSync(workspace)).toEqual([]);
      };

      // Path escape through a link node.
      rejectWithoutMaterializing((candidate) => {
        candidate.links[0].path = "../escape-sink/link";
      });
      // Target escape through a relative link target.
      rejectWithoutMaterializing((candidate) => {
        candidate.links[0].target = "../../../escape-sink/target";
      });
      // Duplicate link path.
      rejectWithoutMaterializing((candidate) => {
        candidate.links[1].path = candidate.links[0].path;
      });
      // Self-loop: the target resolves to the link node itself.
      rejectWithoutMaterializing((candidate) => {
        candidate.links[0] = { path: "self-link/node", target: "node" };
      });
      // Launcher role collapse.
      rejectWithoutMaterializing((candidate) => {
        candidate.repository_entry = candidate.incompatible_target;
      });
      // Dot and dot-dot components inside a link path.
      for (const path of ["a/./b/node", "a/../b/node"]) {
        rejectWithoutMaterializing((candidate) => {
          candidate.links[0].path = path;
        });
      }
      // Malformed link declarations: extra key, missing key, non-object,
      // non-string path/target, non-array links, and wrong link counts.
      for (const link of [
        { path: "a/node", target: "b", extra: true },
        { path: "a/node" },
        "a/node",
        { path: 7, target: "b" },
        { path: "a/node", target: 7 },
      ]) {
        rejectWithoutMaterializing((candidate) => {
          candidate.links[0] = link as never;
        });
      }
      for (const links of [
        "not-an-array",
        [layout.links[0]],
        [...layout.links, { path: "extra/node", target: "x" }],
      ]) {
        rejectWithoutMaterializing((candidate) => {
          (candidate as unknown as { links: unknown }).links = links;
        });
      }
      // Malformed top-level recipe keys and contracts.
      rejectWithoutMaterializing((candidate) => {
        (candidate as unknown as { extra: boolean }).extra = true;
      });
      rejectWithoutMaterializing((candidate) => {
        delete (candidate as unknown as Partial<MutableDevPath003Layout>).repository_entry;
      });
      rejectWithoutMaterializing((candidate) => {
        candidate.schema = "other-schema/v9";
      });
      rejectWithoutMaterializing((candidate) => {
        candidate.command = "sh";
      });
      // Non-object or primitive recipes.
      for (const candidate of [null, "recipe", ["links"]]) {
        expect(() => planDevPath003Materialization(workspace, candidate)).toThrow();
      }
      expect(readdirSync(escapeSink)).toEqual([]);
      expect(readdirSync(workspace)).toEqual([]);

      // A missing workspace root must fail closed before any path is planned.
      expect(() =>
        planDevPath003Materialization(resolve(hostileRoot, "missing-workspace"), layout),
      ).toThrow();
      expect(existsSync(resolve(hostileRoot, "missing-workspace"))).toBe(false);
    } finally {
      rmSync(hostileRoot, { force: true, recursive: true });
    }
  });

  test("DEV-PATH-003 materialization planner refuses a symlinked or junction workspace root", (t) => {
    const fixtureRoot = resolve(repositoryRoot, "fixtures");
    const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-PATH-003");
    const layout = JSON.parse(
      readFileSync(resolve(assetRoot, "fixture", "link-layout.json"), "utf8"),
    );
    const hostileRoot = mkdtempSync(resolve(tmpdir(), "runparity-path003-root-race-"));
    try {
      const outside = resolve(hostileRoot, "outside");
      mkdirSync(outside);
      const linkedWorkspace = resolve(hostileRoot, "linked-workspace");
      try {
        symlinkSync(outside, linkedWorkspace, process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        if (process.platform === "win32") {
          t.skip(`junction creation not permitted on this host: ${String(error)}`);
          return;
        }
        throw error;
      }
      expect(() => planDevPath003Materialization(linkedWorkspace, layout)).toThrow();
      expect(readdirSync(outside)).toEqual([]);
      expect(readdirSync(hostileRoot).sort()).toEqual(["linked-workspace", "outside"]);
    } finally {
      rmSync(hostileRoot, { force: true, recursive: true });
    }
  });

  test.runIf(process.platform === "linux")(
    "DEV-PATH-003 observes a two-hop symlink target without claiming an experiment",
    () => {
      const sourceRoot = resolve(
        repositoryRoot,
        "fixtures",
        "development",
        "assets",
        "DEV-PATH-003",
      );
      const workspace = mkdtempSync(resolve(tmpdir(), "runparity-dev-path-003-"));
      try {
        const layout = JSON.parse(
          readFileSync(resolve(sourceRoot, "fixture", "link-layout.json"), "utf8"),
        );
        const materialization = planDevPath003Materialization(workspace, layout);
        const copiedAssets = [
          "fixture/assert-toolchain-marker.mjs",
          "unintended-toolchain/bin/node-target",
          "repository-fixture/bin/node",
        ];
        for (const asset of copiedAssets) {
          const destination = resolve(workspace, asset);
          mkdirSync(dirname(destination), { recursive: true });
          copyFileSync(resolve(sourceRoot, asset), destination);
        }
        const incompatibleLauncher = materialization.incompatiblePath;
        const compatibleLauncher = materialization.repositoryPath;
        chmodSync(compatibleLauncher, 0o755);
        for (const link of materialization.links) {
          mkdirSync(dirname(link.absolutePath), { recursive: true });
          symlinkSync(link.target, link.absolutePath);
          expect(readlinkSync(link.absolutePath)).toBe(link.target);
        }
        chmodSync(incompatibleLauncher, 0o644);
        expect(() => inspectDevPath003MaterializedLayout(workspace, layout)).toThrow();
        chmodSync(incompatibleLauncher, 0o755);
        const materializedBefore = inspectDevPath003MaterializedLayout(workspace, layout);
        const { shadowEntry, canonicalShadow, canonicalCompatible } = materializedBefore;
        const invalidRealNode = spawnSync(
          incompatibleLauncher,
          ["fixture/assert-toolchain-marker.mjs", "--assert-compatible"],
          {
            cwd: workspace,
            encoding: "utf8",
            env: { RUNPARITY_FIXTURE_REAL_NODE: "relative-node" },
            shell: false,
          },
        );
        expect(invalidRealNode).toMatchObject({
          status: 64,
          stdout: "",
          stderr: "RP_FIXTURE_INVALID_REAL_NODE\n",
        });

        const targetArgv = [
          "node",
          "fixture/assert-toolchain-marker.mjs",
          "--assert-compatible",
        ] as const;
        const environmentFor = (path: string) => ({
          PATH: path,
          RUNPARITY_FIXTURE_REAL_NODE: process.execPath,
        });
        const wrongFirstPath = [dirname(shadowEntry), dirname(compatibleLauncher)].join(delimiter);
        const intendedFirstPath = [
          dirname(compatibleLauncher),
          dirname(shadowEntry),
          dirname(compatibleLauncher),
        ].join(delimiter);
        const nativeWrong = spawnSync(targetArgv[0], targetArgv.slice(1), {
          cwd: workspace,
          encoding: "utf8",
          env: environmentFor(wrongFirstPath),
          shell: false,
        });
        const nativeIntended = spawnSync(targetArgv[0], targetArgv.slice(1), {
          cwd: workspace,
          encoding: "utf8",
          env: environmentFor(intendedFirstPath),
          shell: false,
        });
        expect(nativeWrong).toMatchObject({
          status: 23,
          stdout: "",
          stderr: "RP_FIXTURE_SYMLINK_TOOLCHAIN\n",
        });
        expect(nativeIntended).toMatchObject({
          status: 0,
          stdout: "RUNPARITY_OK:dev-path-003\n",
          stderr: "",
        });
        const ambientMarkerCannotOverride = spawnSync(targetArgv[0], targetArgv.slice(1), {
          cwd: workspace,
          encoding: "utf8",
          env: {
            ...environmentFor(wrongFirstPath),
            RUNPARITY_FIXTURE_TOOLCHAIN_MARKER: "compatible",
          },
          shell: false,
        });
        expect(ambientMarkerCannotOverride).toMatchObject({
          status: 23,
          stdout: "",
          stderr: "RP_FIXTURE_SYMLINK_TOOLCHAIN\n",
        });

        const observed = spawnSync(
          process.execPath,
          [tsxCli, runParityCli, "--json", "doctor", "--report-only", "--", ...targetArgv],
          {
            cwd: workspace,
            encoding: "utf8",
            env: environmentFor(wrongFirstPath),
            shell: false,
          },
        );
        expect(observed.status).toBe(0);
        expect(observed.stderr).toBe("");
        expect(observed.stdout).not.toContain('"verdict":"VERIFIED_INTERVENTION"');
        const report = JSON.parse(observed.stdout).data.report;
        expect(report).toMatchObject({
          status: "failure_observed",
          verdict: "PARTIAL_EVIDENCE",
          execution_context: "HOST_OBSERVATION",
          reference: { resolution: "not_found", qualification: "not_applicable" },
          experiment: { status: "not_attempted" },
          remediation: { mode: "manual_only", changes: [] },
          observation: {
            launch: {
              selected_search_path: shadowEntry,
              resolved_path: canonicalShadow,
              candidates: [canonicalShadow, canonicalCompatible],
              candidate_resolutions: [
                { search_path: shadowEntry, canonical_path: canonicalShadow },
                {
                  search_path: compatibleLauncher,
                  canonical_path: canonicalCompatible,
                },
              ],
              candidate_resolutions_truncated: false,
            },
            result: {
              status: "failed",
              exit_code: 23,
              stderr: {
                redacted_excerpt: "RP_FIXTURE_SYMLINK_TOOLCHAIN\n",
                digest: { algorithm: "HMAC-SHA-256", key_scope: "invocation" },
              },
            },
          },
        });
        expect(report.findings).toEqual([
          expect.objectContaining({
            id: "RP-PATH-0001",
            category: "PATH_SHADOWING",
            state: "candidate",
            selected: canonicalShadow,
            alternatives: [canonicalCompatible],
            intervention: null,
          }),
        ]);
        expect(inspectDevPath003MaterializedLayout(workspace, layout)).toEqual(materializedBefore);
      } finally {
        rmSync(workspace, { force: true, recursive: true });
      }
    },
  );

  test("DEV-NEG-001 keeps an application assertion non-actionable and neutralizes display controls", () => {
    const assetRoot = resolve(repositoryRoot, "fixtures", "development", "assets", "DEV-NEG-001");
    const entrypoint = resolve(assetRoot, "fixture.mjs");
    const result = spawnSync(
      process.execPath,
      [tsxCli, runParityCli, "--json", "doctor", "--", process.execPath, entrypoint],
      {
        cwd: assetRoot,
        encoding: "utf8",
        env: process.env,
        shell: false,
      },
    );

    expect(result.status).toBe(21);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toMatch(/[\u202a-\u202e\u2066-\u2069\u2028\u2029]/u);
    const report = JSON.parse(result.stdout).data.report;
    expect(report).toMatchObject({
      status: "failure_observed",
      verdict: "PARTIAL_EVIDENCE",
      execution_context: "HOST_OBSERVATION",
      experiment: { status: "not_attempted" },
      observation: {
        result: {
          status: "failed",
          exit_code: 21,
          stdout: {
            redacted_excerpt: "RP_FIXTURE_APPLICATION_ASSERTION\n",
            digest: {
              algorithm: "HMAC-SHA-256",
              key_scope: "invocation",
            },
          },
          stderr: {
            redacted_excerpt: "expected=2 actual=3\n",
            digest: {
              algorithm: "HMAC-SHA-256",
              key_scope: "invocation",
            },
          },
        },
      },
    });
    expect(report.findings).toEqual([]);
  });

  test("DEV-NEG-002 preserves the failure while redacting its sensitive flag canary", () => {
    const assetRoot = resolve(repositoryRoot, "fixtures", "development", "assets", "DEV-NEG-002");
    const entrypoint = resolve(assetRoot, "fixture.mjs");
    const secretCanary = "FIXTURE_SECRET_CANARY_987654321";
    const result = spawnSync(
      process.execPath,
      [
        tsxCli,
        runParityCli,
        "--json",
        "doctor",
        "--",
        process.execPath,
        entrypoint,
        "--api-key",
        secretCanary,
      ],
      {
        cwd: assetRoot,
        encoding: "utf8",
        env: process.env,
        shell: false,
      },
    );

    expect(result.status).toBe(23);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain(secretCanary);
    const report = JSON.parse(result.stdout).data.report;
    expect(report).toMatchObject({
      status: "failure_observed",
      verdict: "PARTIAL_EVIDENCE",
      execution_context: "HOST_OBSERVATION",
      experiment: { status: "not_attempted" },
      observation: {
        result: {
          status: "failed",
          exit_code: 23,
          stdout: {
            redacted_excerpt: "INVALID_DATA api-key=[REDACTED]\n",
          },
          stderr: {
            redacted_excerpt: "RP_FIXTURE_INVALID_APPLICATION_DATA api-key=[REDACTED]\n",
          },
        },
      },
    });
    expect(report.observation.requested_argv.slice(-2)).toEqual(["--api-key", "[REDACTED]"]);
    expect(report.findings).toEqual([]);
  });

  test("DEV-NEG-002 treats a sensitive-looking token as the preceding sensitive value", () => {
    const assetRoot = resolve(repositoryRoot, "fixtures", "development", "assets", "DEV-NEG-002");
    const entrypoint = resolve(assetRoot, "fixture.mjs");
    const ambiguousCanary = "--token";
    const result = spawnSync(
      process.execPath,
      [
        tsxCli,
        runParityCli,
        "--json",
        "doctor",
        "--",
        process.execPath,
        entrypoint,
        "--api-key",
        ambiguousCanary,
      ],
      {
        cwd: assetRoot,
        encoding: "utf8",
        env: process.env,
        shell: false,
      },
    );

    expect(result.status).toBe(23);
    expect(result.stdout).not.toContain(ambiguousCanary);
    const report = JSON.parse(result.stdout).data.report;
    expect(report.observation.requested_argv.slice(-2)).toEqual(["--api-key", "[REDACTED]"]);
    expect(report.observation.result.stdout.redacted_excerpt).toBe("[REDACTED_SENSITIVE_OUTPUT]");
    expect(report.observation.result.stderr.redacted_excerpt).toBe("[REDACTED_SENSITIVE_OUTPUT]");
  });

  test("DEV-OOS-002 preflight is read-only, deterministic, and refuses the SDK proof", () => {
    const fixtureRoot = resolve(repositoryRoot, "fixtures");
    const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-OOS-002");
    const entrypoint = resolve(assetRoot, "fixture", "macos-sdk-preflight.mjs");
    const manifest = JSON.parse(
      readFileSync(resolve(fixtureRoot, "development", "cases", "DEV-OOS-002.json"), "utf8"),
    );

    expect(manifest).toMatchObject({
      fixture_status: "implemented",
      scenario: {
        planned_target_argv: ["node", "fixture/macos-sdk-preflight.mjs"],
      },
      implementation: {
        runnable: true,
        asset_root: "development/assets/DEV-OOS-002",
        missing_assets: [],
        receipts: {
          build: "receipts/build/DEV-OOS-002.json",
          backend_qualification: null,
          verification_ledger: null,
        },
        verified_at: null,
      },
    });

    const source = readFileSync(entrypoint, "utf8");
    expect(source).toContain("readdirSync");
    expect(source).toContain("process.exitCode = 23");
    expect(source).not.toMatch(
      /\b(?:spawn|spawnSync|exec|execFile|fork|child_process|fetch|http|https|net\.|dns|XMLHttpRequest|WebSocket)\b/u,
    );
    expect(source).not.toMatch(
      /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|rmSync|rm\(|unlink|unlinkSync|chmod|chmodSync|createWriteStream|openSync)\b/u,
    );
    expect(source).not.toContain("process.env");

    const result = spawnSync(process.execPath, [entrypoint], {
      cwd: assetRoot,
      encoding: "utf8",
      env: {},
      shell: false,
    });
    expect(result.status).toBe(23);
    expect(result.stdout).toBe(process.platform === "darwin" ? expect.any(String) : "");
    expect(result.stderr).toBe("RP_FIXTURE_MACOS_SDK_PROOF_UNSUPPORTED\n");
  });

  test("DEV-OOS-002 Host Observe keeps the unsupported platform honest without a proof flow", () => {
    const fixtureRoot = resolve(repositoryRoot, "fixtures");
    const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-OOS-002");
    const entrypoint = resolve(assetRoot, "fixture", "macos-sdk-preflight.mjs");
    const result = spawnSync(
      process.execPath,
      [tsxCli, runParityCli, "--json", "doctor", "--", process.execPath, entrypoint],
      { cwd: assetRoot, encoding: "utf8", env: process.env, shell: false },
    );

    expect(result.status).toBe(23);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain('"verdict":"VERIFIED_INTERVENTION"');
    const report = JSON.parse(result.stdout).data.report;
    expect(report).toMatchObject({
      status: "failure_observed",
      verdict: "PARTIAL_EVIDENCE",
      execution_context: "HOST_OBSERVATION",
      reference: { resolution: "not_found", qualification: "not_applicable" },
      experiment: { status: "not_attempted" },
      remediation: { mode: "manual_only", changes: [] },
      observation: {
        result: {
          status: "failed",
          exit_code: 23,
          stderr: {
            redacted_excerpt: "RP_FIXTURE_MACOS_SDK_PROOF_UNSUPPORTED\n",
            digest: { algorithm: "HMAC-SHA-256", key_scope: "invocation" },
          },
        },
      },
    });
    expect(report.findings).toEqual([]);
    // The CLI has no proof-request/refusal flow yet, so the declared
    // REFUSED_OUT_OF_SCOPE verdict must not be invented from Host evidence.
    expect(report.verdict).not.toBe("REFUSED_OUT_OF_SCOPE");
  });

  function locateRealNpm() {
    const candidates = [
      resolve(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
      "/usr/share/nodejs/npm/bin/npm-cli.js",
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        const probe = spawnSync(process.execPath, [candidate, "--version"], {
          encoding: "utf8",
          shell: false,
        });
        if (probe.status === 0) return candidate;
      }
    }
    return null;
  }

  function configCaseEnvironment() {
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) =>
          name.toLowerCase() !== "path" &&
          !name.toLowerCase().startsWith("npm_config_") &&
          name.toLowerCase() !== "npm_config_userconfig" &&
          name.toLowerCase() !== "npm_config_globalconfig",
      ),
    );
    const isolatedHome = mkdtempSync(resolve(tmpdir(), "runparity-config-home-"));
    environment["HOME"] = isolatedHome;
    environment["USERPROFILE"] = isolatedHome;
    environment["NPM_CONFIG_GLOBALCONFIG"] = resolve(isolatedHome, "missing-global-npmrc");
    return { environment, isolatedHome };
  }

  // A clearly labeled stand-in for `npm config get` used only to exercise the
  // assertion scripts' boundary logic. Real precedence behavior is covered by
  // the gated real-npm smokes below; the stand-in models only the observed
  // value channel (an explicit fake value, else a forwarded CLI flag value,
  // else its own npm_config_* environment).
  function writeFakeNpmCli(workspace: string) {
    const fake = resolve(workspace, "fake-npm-cli.mjs");
    writeFileSync(
      fake,
      [
        "const getIndex = process.argv.indexOf('get');",
        "const key = getIndex >= 0 ? process.argv[getIndex + 1] : '';",
        "const flag = process.argv.slice(getIndex + 2).find((arg) => arg.startsWith('--'));",
        "const envName = 'npm_config_' + key.replace(/-/g, '_');",
        "const flagValue = flag === undefined ? undefined : flag.slice(flag.indexOf('=') + 1);",
        "const value = process.env.RUNPARITY_FAKE_VALUE ?? flagValue ?? process.env[envName] ?? '';",
        "process.stdout.write(value + '\\n');",
      ].join("\n"),
      "utf8",
    );
    return fake;
  }

  test("DEV-CONFIG-001 asserts the npm-resolved fund value deterministically", () => {
    const fixtureRoot = resolve(repositoryRoot, "fixtures");
    const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-CONFIG-001");
    const entrypoint = resolve(assetRoot, "fixture", "assert-config.mjs");
    const manifest = JSON.parse(
      readFileSync(resolve(fixtureRoot, "development", "cases", "DEV-CONFIG-001.json"), "utf8"),
    );

    expect(manifest).toMatchObject({
      fixture_status: "verified",
      scenario: { planned_target_argv: ["npm", "run", "fixture:assert-config"] },
      implementation: {
        runnable: true,
        asset_root: "development/assets/DEV-CONFIG-001",
        missing_assets: [],
        receipts: {
          build: "receipts/build/DEV-CONFIG-001.json",
          backend_qualification: "receipts/backend/qemu-kvm-ubuntu-noble-rpvm-2026-08-22.json",
          verification_ledger: "receipts/ledger/DEV-CONFIG-001.json",
        },
        verified_at: expect.any(String),
      },
    });

    const hostileRoot = mkdtempSync(resolve(tmpdir(), "runparity-config-001-fake-"));
    const { environment, isolatedHome } = configCaseEnvironment();
    try {
      const fake = writeFakeNpmCli(hostileRoot);
      const run = (fakeValue: string | undefined) =>
        spawnSync(process.execPath, [entrypoint], {
          cwd: assetRoot,
          encoding: "utf8",
          env:
            fakeValue === undefined
              ? { ...environment, RUNPARITY_FIXTURE_NPM_CLI: fake }
              : {
                  ...environment,
                  RUNPARITY_FIXTURE_NPM_CLI: fake,
                  RUNPARITY_FAKE_VALUE: fakeValue,
                },
          shell: false,
        });
      expect(run("true")).toMatchObject({
        status: 0,
        stdout: "RUNPARITY_OK:dev-config-001\n",
        stderr: "",
      });
      expect(run("false")).toMatchObject({
        status: 23,
        stdout: "",
        stderr: "RP_FIXTURE_ENV_OVERRIDES_PROJECT_NPMRC\n",
      });
      expect(run("")).toMatchObject({
        status: 64,
        stdout: "",
        stderr: "RP_FIXTURE_INVALID_CONFIG_ASSERTION\n",
      });
      expect(run("banana")).toMatchObject({
        status: 64,
        stdout: "",
        stderr: "RP_FIXTURE_INVALID_CONFIG_ASSERTION\n",
      });
      // A missing inner npm must fail closed with the invalid marker.
      const missing = spawnSync(process.execPath, [entrypoint], {
        cwd: assetRoot,
        encoding: "utf8",
        env: { ...environment, RUNPARITY_FIXTURE_NPM_CLI: resolve(hostileRoot, "missing-npm") },
        shell: false,
      });
      expect(missing).toMatchObject({
        status: 64,
        stdout: "",
        stderr: "RP_FIXTURE_INVALID_CONFIG_ASSERTION\n",
      });
    } finally {
      rmSync(hostileRoot, { force: true, recursive: true });
      rmSync(isolatedHome, { force: true, recursive: true });
    }
  });

  test("DEV-CONFIG-001 real npm lifecycle shows environment precedence over the project", (t) => {
    const npmCli = locateRealNpm();
    if (npmCli === null) {
      t.skip("no usable npm CLI on this host");
      return;
    }
    const fixtureRoot = resolve(repositoryRoot, "fixtures");
    const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-CONFIG-001");
    const workspace = mkdtempSync(resolve(tmpdir(), "runparity-config-001-"));
    const { environment, isolatedHome } = configCaseEnvironment();
    try {
      cpSync(assetRoot, workspace, { recursive: true });
      environment["RUNPARITY_FIXTURE_NPM_CLI"] = npmCli;
      const run = (fund: string) =>
        spawnSync(process.execPath, [npmCli, "run", "fixture:assert-config"], {
          cwd: workspace,
          encoding: "utf8",
          env: { ...environment, npm_config_fund: fund },
          shell: false,
        });

      const overridden = run("false");
      expect(overridden.status).toBe(23);
      expect(overridden.stdout).not.toContain("RUNPARITY_OK:dev-config-001");
      expect(overridden.stderr).toContain("RP_FIXTURE_ENV_OVERRIDES_PROJECT_NPMRC");

      const matched = run("true");
      expect(matched.status).toBe(0);
      expect(matched.stdout).toContain("RUNPARITY_OK:dev-config-001");
      expect(matched.stderr).not.toContain("RP_FIXTURE_ENV_OVERRIDES_PROJECT_NPMRC");
    } finally {
      rmSync(workspace, { force: true, recursive: true });
      rmSync(isolatedHome, { force: true, recursive: true });
    }
  });

  test("DEV-CONFIG-002 asserts the strict-peer-deps value and real npm reads both files", (t) => {
    const npmCli = locateRealNpm();
    if (npmCli === null) {
      t.skip("no usable npm CLI on this host");
      return;
    }
    const fixtureRoot = resolve(repositoryRoot, "fixtures");
    const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-CONFIG-002");
    const entrypoint = resolve(assetRoot, "fixture", "assert-config.mjs");
    const manifest = JSON.parse(
      readFileSync(resolve(fixtureRoot, "development", "cases", "DEV-CONFIG-002.json"), "utf8"),
    );
    expect(manifest).toMatchObject({
      fixture_status: "verified",
      scenario: { planned_target_argv: ["npm", "run", "fixture:assert-config"] },
      implementation: {
        runnable: true,
        asset_root: "development/assets/DEV-CONFIG-002",
        missing_assets: [],
        receipts: {
          build: "receipts/build/DEV-CONFIG-002.json",
          backend_qualification: "receipts/backend/qemu-kvm-ubuntu-noble-rpvm-2026-08-22.json",
          verification_ledger: "receipts/ledger/DEV-CONFIG-002.json",
        },
        verified_at: expect.any(String),
      },
    });

    const hostileRoot = mkdtempSync(resolve(tmpdir(), "runparity-config-002-fake-"));
    const { environment, isolatedHome } = configCaseEnvironment();
    try {
      const fake = writeFakeNpmCli(hostileRoot);
      const run = (fakeValue: string) =>
        spawnSync(process.execPath, [entrypoint], {
          cwd: assetRoot,
          encoding: "utf8",
          env: { ...environment, RUNPARITY_FIXTURE_NPM_CLI: fake, RUNPARITY_FAKE_VALUE: fakeValue },
          shell: false,
        });
      expect(run("false")).toMatchObject({
        status: 0,
        stdout: "RUNPARITY_OK:dev-config-002\n",
        stderr: "",
      });
      expect(run("true")).toMatchObject({
        status: 23,
        stdout: "",
        stderr: "RP_FIXTURE_PROJECT_OVERRIDES_USER_NPMRC\n",
      });
      expect(run("banana")).toMatchObject({
        status: 64,
        stdout: "",
        stderr: "RP_FIXTURE_INVALID_CONFIG_ASSERTION\n",
      });
    } finally {
      rmSync(hostileRoot, { force: true, recursive: true });
      rmSync(isolatedHome, { force: true, recursive: true });
    }

    const workspace = mkdtempSync(resolve(tmpdir(), "runparity-config-002-"));
    const { environment: realEnvironment, isolatedHome: realIsolatedHome } =
      configCaseEnvironment();
    try {
      cpSync(assetRoot, workspace, { recursive: true });
      writeFileSync(resolve(realIsolatedHome, ".npmrc"), "strict-peer-deps=false\n", "utf8");
      realEnvironment["NPM_CONFIG_USERCONFIG"] = resolve(realIsolatedHome, ".npmrc");
      realEnvironment["RUNPARITY_FIXTURE_NPM_CLI"] = npmCli;
      const runNpm = () =>
        spawnSync(process.execPath, [npmCli, "run", "fixture:assert-config"], {
          cwd: workspace,
          encoding: "utf8",
          env: realEnvironment,
          shell: false,
        });

      const projectWins = runNpm();
      expect(projectWins.status).toBe(23);
      expect(projectWins.stdout).not.toContain("RUNPARITY_OK:dev-config-002");
      expect(projectWins.stderr).toContain("RP_FIXTURE_PROJECT_OVERRIDES_USER_NPMRC");

      // A manually selected known-good project value (the future B overlay)
      // must make the same frozen assertion pass.
      writeFileSync(resolve(workspace, ".npmrc"), "strict-peer-deps=false\n", "utf8");
      const matched = runNpm();
      expect(matched.status).toBe(0);
      expect(matched.stdout).toContain("RUNPARITY_OK:dev-config-002");
    } finally {
      rmSync(workspace, { force: true, recursive: true });
      rmSync(realIsolatedHome, { force: true, recursive: true });
    }
  }, 30_000);

  test("DEV-CONFIG-003 forwards the CLI flag and real npm shows CLI precedence over the environment", (t) => {
    const npmCli = locateRealNpm();
    if (npmCli === null) {
      t.skip("no usable npm CLI on this host");
      return;
    }
    const fixtureRoot = resolve(repositoryRoot, "fixtures");
    const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-CONFIG-003");
    const entrypoint = resolve(assetRoot, "fixture", "assert-config.mjs");
    const manifest = JSON.parse(
      readFileSync(resolve(fixtureRoot, "development", "cases", "DEV-CONFIG-003.json"), "utf8"),
    );
    expect(manifest).toMatchObject({
      fixture_status: "verified",
      scenario: {
        planned_target_argv: ["npm", "run", "fixture:assert-config", "--", "--fund=false"],
      },
      implementation: {
        runnable: true,
        asset_root: "development/assets/DEV-CONFIG-003",
        missing_assets: [],
        receipts: {
          build: "receipts/build/DEV-CONFIG-003.json",
          backend_qualification: "receipts/backend/qemu-kvm-ubuntu-noble-rpvm-2026-08-22.json",
          verification_ledger: "receipts/ledger/DEV-CONFIG-003.json",
        },
        verified_at: expect.any(String),
      },
    });

    const hostileRoot = mkdtempSync(resolve(tmpdir(), "runparity-config-003-fake-"));
    const { environment: fakeEnvironment, isolatedHome: fakeIsolatedHome } =
      configCaseEnvironment();
    try {
      const fake = writeFakeNpmCli(hostileRoot);
      const run = (args: string[], fakeValue?: string) =>
        spawnSync(process.execPath, [entrypoint, ...args], {
          cwd: assetRoot,
          encoding: "utf8",
          env:
            fakeValue === undefined
              ? { ...fakeEnvironment, RUNPARITY_FIXTURE_NPM_CLI: fake }
              : {
                  ...fakeEnvironment,
                  RUNPARITY_FIXTURE_NPM_CLI: fake,
                  RUNPARITY_FAKE_VALUE: fakeValue,
                },
          shell: false,
        });
      // The fake echoes the forwarded flag, proving the flag reaches the
      // inner config-get invocation.
      expect(run(["--fund=false"])).toMatchObject({
        status: 23,
        stdout: "",
        stderr: "RP_FIXTURE_CLI_OVERRIDES_ENV_CONFIG\n",
      });
      expect(run(["--fund=true"])).toMatchObject({
        status: 0,
        stdout: "RUNPARITY_OK:dev-config-003\n",
        stderr: "",
      });
      expect(run(["--fund=false"], "true")).toMatchObject({
        status: 0,
        stdout: "RUNPARITY_OK:dev-config-003\n",
        stderr: "",
      });
      for (const rejected of [
        { args: [] as string[] },
        { args: ["--fund=false", "extra"] },
        { args: ["--fund=banana"] },
        { args: ["--other=x"] },
      ]) {
        expect(run(rejected.args)).toMatchObject({
          status: 64,
          stdout: "",
          stderr: "RP_FIXTURE_INVALID_CONFIG_ASSERTION\n",
        });
      }
    } finally {
      rmSync(hostileRoot, { force: true, recursive: true });
      rmSync(fakeIsolatedHome, { force: true, recursive: true });
    }

    const workspace = mkdtempSync(resolve(tmpdir(), "runparity-config-003-"));
    const { environment, isolatedHome } = configCaseEnvironment();
    try {
      cpSync(assetRoot, workspace, { recursive: true });
      environment["npm_config_fund"] = "true";
      environment["RUNPARITY_FIXTURE_NPM_CLI"] = npmCli;
      const runNpm = (flag: string) =>
        spawnSync(process.execPath, [npmCli, "run", "fixture:assert-config", "--", flag], {
          cwd: workspace,
          encoding: "utf8",
          env: environment,
          shell: false,
        });

      const cliWins = runNpm("--fund=false");
      expect(cliWins.status).toBe(23);
      expect(cliWins.stdout).not.toContain("RUNPARITY_OK:dev-config-003");
      expect(cliWins.stderr).toContain("RP_FIXTURE_CLI_OVERRIDES_ENV_CONFIG");

      const matched = runNpm("--fund=true");
      expect(matched.status).toBe(0);
      expect(matched.stdout).toContain("RUNPARITY_OK:dev-config-003");

      // Without the forwarded flag the assertion refuses to guess.
      const noFlag = spawnSync(process.execPath, [npmCli, "run", "fixture:assert-config"], {
        cwd: workspace,
        encoding: "utf8",
        env: environment,
        shell: false,
      });
      expect(noFlag.status).toBe(64);
      expect(noFlag.stderr).toContain("RP_FIXTURE_INVALID_CONFIG_ASSERTION");
    } finally {
      rmSync(workspace, { force: true, recursive: true });
      rmSync(isolatedHome, { force: true, recursive: true });
    }
  }, 30_000);

  test("DEV-CONFIG-001 Host Observe records the unqualified config conflict", () => {
    const fixtureRoot = resolve(repositoryRoot, "fixtures");
    const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-CONFIG-001");
    const workspace = mkdtempSync(resolve(tmpdir(), "runparity-config-observe-"));
    try {
      cpSync(assetRoot, workspace, { recursive: true });
      const bin = resolve(workspace, "bin");
      mkdirSync(bin);
      const targetScript = resolve(workspace, "fixture", "assert-config.mjs");
      if (process.platform === "win32") {
        writeFileSync(
          resolve(bin, "npm.cmd"),
          `@echo off\r\n"${process.execPath}" "${targetScript}" %*\r\n`,
        );
      } else {
        writeFileSync(resolve(bin, "npm"), `#!${process.execPath}\nprocess.exit(23);\n`);
        chmodSync(resolve(bin, "npm"), 0o755);
      }
      const fakeNpm = writeFakeNpmCli(workspace);
      const environment = Object.fromEntries(
        Object.entries(process.env).filter(([name]) => name.toLowerCase() !== "path"),
      );
      environment["PATH"] = [bin, process.env["PATH"] ?? process.env["Path"] ?? ""].join(delimiter);
      environment["npm_config_fund"] = "false";
      environment["RUNPARITY_FIXTURE_NPM_CLI"] = fakeNpm;
      environment["RUNPARITY_FAKE_VALUE"] = "false";

      const result = spawnSync(
        process.execPath,
        [tsxCli, runParityCli, "--json", "doctor", "--", "npm", "run", "fixture:assert-config"],
        { cwd: workspace, encoding: "utf8", env: environment, shell: false },
      );

      expect(result.status).toBe(23);
      expect(result.stderr).toBe("");
      const report = JSON.parse(result.stdout).data.report;
      expect(report.status).toBe("failure_observed");
      expect(report.verdict).toBe("PARTIAL_EVIDENCE");
      expect(report.execution_context).toBe("HOST_OBSERVATION");
      expect(report.observation.config_source_conflicts).toEqual([
        expect.objectContaining({
          command_shape: "npm_like",
          key: "fund",
          values_conflict: true,
          semantics: "unqualified",
        }),
      ]);
      expect(report.observation.config_source_conflicts[0]).not.toHaveProperty("winner_source");
      expect(report.findings).not.toContainEqual(expect.objectContaining({ id: "RP-CONFIG-0001" }));
      expect(result.stdout).not.toContain('"verdict":"VERIFIED_INTERVENTION"');
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test("DEV-PATH-002 launchers and assertion are deterministic and the stale tree lacks its entry", () => {
    const fixtureRoot = resolve(repositoryRoot, "fixtures");
    const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-PATH-002");
    const entrypoint = resolve(assetRoot, "fixture", "assert-pnpm-marker.mjs");
    const manifest = JSON.parse(
      readFileSync(resolve(fixtureRoot, "development", "cases", "DEV-PATH-002.json"), "utf8"),
    );

    expect(manifest).toMatchObject({
      fixture_status: "verified",
      scenario: {
        planned_target_argv: ["pnpm", "exec", "node", "fixture/assert-pnpm-marker.mjs"],
        expected_a_failure_signature: "ERR_MODULE_NOT_FOUND",
      },
      implementation: {
        runnable: true,
        asset_root: "development/assets/DEV-PATH-002",
        missing_assets: [],
        receipts: {
          build: "receipts/build/DEV-PATH-002.json",
          backend_qualification: "receipts/backend/qemu-kvm-ubuntu-noble-rpvm-2026-08-22.json",
          verification_ledger: "receipts/ledger/DEV-PATH-002.json",
        },
        verified_at: expect.any(String),
      },
    });

    const staleLauncher = readFileSync(resolve(assetRoot, "stale-pnpm", "bin", "pnpm"), "utf8");
    const approvedLauncher = readFileSync(
      resolve(assetRoot, "approved-pnpm", "bin", "pnpm"),
      "utf8",
    );
    expect(staleLauncher).toBe(approvedLauncher);
    expect(staleLauncher).toMatch(/^#!\/bin\/sh\n/u);
    expect(staleLauncher).toMatch(
      /exec "\$RUNPARITY_FIXTURE_REAL_NODE" "\$\{0%\/\*\}\/pnpm-entry\.mjs" "\$@"/u,
    );
    expect(staleLauncher).not.toMatch(/`|\$\(|\beval\b|\benv\s/u);
    expect(existsSync(resolve(assetRoot, "stale-pnpm", "bin", "pnpm-entry.mjs"))).toBe(false);
    expect(existsSync(resolve(assetRoot, "approved-pnpm", "bin", "pnpm-entry.mjs"))).toBe(true);

    const runMarker = (marker: string | undefined) =>
      spawnSync(process.execPath, [entrypoint], {
        cwd: assetRoot,
        encoding: "utf8",
        env: marker === undefined ? {} : { RUNPARITY_FIXTURE_PNPM_MARKER: marker },
        shell: false,
      });
    expect(runMarker("approved")).toMatchObject({
      status: 0,
      stdout: "RUNPARITY_OK:dev-path-002\n",
      stderr: "",
    });
    for (const rejected of [runMarker("stale"), runMarker(undefined)]) {
      expect(rejected).toMatchObject({
        status: 64,
        stdout: "",
        stderr: "RP_FIXTURE_INVALID_PNPM_MARKER\n",
      });
    }

    const approvedEntry = resolve(assetRoot, "approved-pnpm", "bin", "pnpm-entry.mjs");
    const entryRun = spawnSync(
      process.execPath,
      [approvedEntry, "exec", "node", "fixture/assert-pnpm-marker.mjs"],
      { cwd: assetRoot, encoding: "utf8", env: {}, shell: false },
    );
    expect(entryRun).toMatchObject({
      status: 0,
      stdout: "RUNPARITY_OK:dev-path-002\n",
      stderr: "",
    });
    const invalidEntryRun = spawnSync(process.execPath, [approvedEntry, "install", "x"], {
      cwd: assetRoot,
      encoding: "utf8",
      env: {},
      shell: false,
    });
    expect(invalidEntryRun).toMatchObject({
      status: 64,
      stdout: "",
      stderr: "RP_FIXTURE_INVALID_PNPM_INVOCATION\n",
    });
  });

  test.runIf(process.platform === "linux")(
    "DEV-PATH-002 stale pnpm launcher fails with a genuine missing module and the doctor observes PATH shadowing",
    () => {
      const sourceRoot = resolve(
        repositoryRoot,
        "fixtures",
        "development",
        "assets",
        "DEV-PATH-002",
      );
      const workspace = mkdtempSync(resolve(tmpdir(), "runparity-dev-path-002-"));
      try {
        const copiedAssets = [
          "fixture/assert-pnpm-marker.mjs",
          "stale-pnpm/bin/pnpm",
          "approved-pnpm/bin/pnpm",
          "approved-pnpm/bin/pnpm-entry.mjs",
        ];
        for (const asset of copiedAssets) {
          const destination = resolve(workspace, asset);
          mkdirSync(dirname(destination), { recursive: true });
          copyFileSync(resolve(sourceRoot, asset), destination);
        }
        const staleLauncher = resolve(workspace, "stale-pnpm", "bin", "pnpm");
        const approvedLauncher = resolve(workspace, "approved-pnpm", "bin", "pnpm");
        chmodSync(staleLauncher, 0o755);
        chmodSync(approvedLauncher, 0o755);
        const targetArgv = ["pnpm", "exec", "node", "fixture/assert-pnpm-marker.mjs"] as const;
        const environmentFor = (path: string) => ({
          PATH: path,
          RUNPARITY_FIXTURE_REAL_NODE: process.execPath,
        });
        const staleFirstPath = [dirname(staleLauncher), dirname(approvedLauncher)].join(delimiter);
        const approvedFirstPath = [dirname(approvedLauncher), dirname(staleLauncher)].join(
          delimiter,
        );

        const nativeStale = spawnSync(targetArgv[0], targetArgv.slice(1), {
          cwd: workspace,
          encoding: "utf8",
          env: environmentFor(staleFirstPath),
          shell: false,
        });
        expect(nativeStale.status).toBe(1);
        expect(nativeStale.stdout).toBe("");
        expect(nativeStale.stderr).toMatch(/Cannot find module/u);

        const nativeApproved = spawnSync(targetArgv[0], targetArgv.slice(1), {
          cwd: workspace,
          encoding: "utf8",
          env: environmentFor(approvedFirstPath),
          shell: false,
        });
        expect(nativeApproved).toMatchObject({
          status: 0,
          stdout: "RUNPARITY_OK:dev-path-002\n",
          stderr: "",
        });

        const observed = spawnSync(
          process.execPath,
          [tsxCli, runParityCli, "--json", "doctor", "--report-only", "--", ...targetArgv],
          {
            cwd: workspace,
            encoding: "utf8",
            env: environmentFor(staleFirstPath),
            shell: false,
          },
        );
        expect(observed.status).toBe(0);
        expect(observed.stderr).toBe("");
        expect(observed.stdout).not.toContain('"verdict":"VERIFIED_INTERVENTION"');
        const report = JSON.parse(observed.stdout).data.report;
        expect(report).toMatchObject({
          status: "failure_observed",
          verdict: "PARTIAL_EVIDENCE",
          execution_context: "HOST_OBSERVATION",
          experiment: { status: "not_attempted" },
          remediation: { mode: "manual_only", changes: [] },
          observation: {
            launch: {
              selected_search_path: staleLauncher,
              resolved_path: staleLauncher,
              candidates: [staleLauncher, approvedLauncher],
            },
          },
        });
        expect(report.findings).toEqual([
          expect.objectContaining({
            id: "RP-PATH-0001",
            category: "PATH_SHADOWING",
            state: "candidate",
            selected: staleLauncher,
            alternatives: [approvedLauncher],
            intervention: null,
          }),
        ]);
        expect(report.observation.result.stderr.redacted_excerpt).toMatch(/Cannot find module/u);
      } finally {
        rmSync(workspace, { force: true, recursive: true });
      }
    },
  );

  test("DEV-RUNTIME-002 asserts the packageManager pin and launchers carry distinct versions", () => {
    const fixtureRoot = resolve(repositoryRoot, "fixtures");
    const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-RUNTIME-002");
    const entrypoint = resolve(assetRoot, "fixture", "assert-manager-version.mjs");
    const manifest = JSON.parse(
      readFileSync(resolve(fixtureRoot, "development", "cases", "DEV-RUNTIME-002.json"), "utf8"),
    );
    expect(manifest).toMatchObject({
      fixture_status: "verified",
      scenario: {
        planned_target_argv: ["pnpm", "exec", "node", "fixture/assert-manager-version.mjs"],
      },
      implementation: {
        runnable: true,
        asset_root: "development/assets/DEV-RUNTIME-002",
        missing_assets: [],
        receipts: {
          build: "receipts/build/DEV-RUNTIME-002.json",
          backend_qualification: "receipts/backend/qemu-kvm-ubuntu-noble-rpvm-2026-08-22.json",
          verification_ledger: "receipts/ledger/DEV-RUNTIME-002.json",
        },
        verified_at: expect.any(String),
      },
    });

    const run = (observedVersion: string | undefined) =>
      spawnSync(process.execPath, [entrypoint], {
        cwd: assetRoot,
        encoding: "utf8",
        env:
          observedVersion === undefined
            ? {}
            : { RUNPARITY_FIXTURE_MANAGER_VERSION: observedVersion },
        shell: false,
      });
    expect(run("9.15.0")).toMatchObject({
      status: 0,
      stdout: "RUNPARITY_OK:dev-runtime-002\n",
      stderr: "",
    });
    expect(run("9.14.2")).toMatchObject({
      status: 23,
      stdout: "",
      stderr: "RP_FIXTURE_PACKAGE_MANAGER_VERSION observed=pnpm@9.14.2 expected=pnpm@9.15.0\n",
    });
    expect(run(undefined)).toMatchObject({
      status: 64,
      stdout: "",
      stderr: "RP_FIXTURE_INVALID_MANAGER_ASSERTION\n",
    });

    const wrongLauncher = readFileSync(
      resolve(assetRoot, "wrong-version-pnpm", "bin", "pnpm"),
      "utf8",
    );
    const approvedLauncher = readFileSync(
      resolve(assetRoot, "approved-pnpm", "bin", "pnpm"),
      "utf8",
    );
    expect(wrongLauncher.replace("=9.14.2", "=<VERSION>")).toBe(
      approvedLauncher.replace("=9.15.0", "=<VERSION>"),
    );
    expect(wrongLauncher).toMatch(/^#!\/bin\/sh\n/u);
    expect(wrongLauncher).not.toMatch(/`|\$\(|\beval\b|\benv\s/u);
  });

  test.runIf(process.platform === "linux")(
    "DEV-RUNTIME-002 wrong pnpm version fails the pin and the doctor keeps partial evidence",
    () => {
      const sourceRoot = resolve(
        repositoryRoot,
        "fixtures",
        "development",
        "assets",
        "DEV-RUNTIME-002",
      );
      const workspace = mkdtempSync(resolve(tmpdir(), "runparity-dev-runtime-002-"));
      try {
        const copiedAssets = [
          "package.json",
          "fixture/assert-manager-version.mjs",
          "wrong-version-pnpm/bin/pnpm",
          "wrong-version-pnpm/bin/pnpm-entry.mjs",
          "approved-pnpm/bin/pnpm",
          "approved-pnpm/bin/pnpm-entry.mjs",
        ];
        for (const asset of copiedAssets) {
          const destination = resolve(workspace, asset);
          mkdirSync(dirname(destination), { recursive: true });
          copyFileSync(resolve(sourceRoot, asset), destination);
        }
        const wrongLauncher = resolve(workspace, "wrong-version-pnpm", "bin", "pnpm");
        const approvedLauncher = resolve(workspace, "approved-pnpm", "bin", "pnpm");
        chmodSync(wrongLauncher, 0o755);
        chmodSync(approvedLauncher, 0o755);
        const targetArgv = ["pnpm", "exec", "node", "fixture/assert-manager-version.mjs"] as const;
        const environmentFor = (path: string) => ({
          PATH: path,
          RUNPARITY_FIXTURE_REAL_NODE: process.execPath,
        });

        const nativeWrong = spawnSync(targetArgv[0], targetArgv.slice(1), {
          cwd: workspace,
          encoding: "utf8",
          env: environmentFor(dirname(wrongLauncher)),
          shell: false,
        });
        expect(nativeWrong.status).toBe(23);
        expect(nativeWrong.stderr).toBe(
          "RP_FIXTURE_PACKAGE_MANAGER_VERSION observed=pnpm@9.14.2 expected=pnpm@9.15.0\n",
        );

        const nativeApproved = spawnSync(targetArgv[0], targetArgv.slice(1), {
          cwd: workspace,
          encoding: "utf8",
          env: environmentFor(dirname(approvedLauncher)),
          shell: false,
        });
        expect(nativeApproved).toMatchObject({
          status: 0,
          stdout: "RUNPARITY_OK:dev-runtime-002\n",
          stderr: "",
        });

        const observed = spawnSync(
          process.execPath,
          [tsxCli, runParityCli, "--json", "doctor", "--report-only", "--", ...targetArgv],
          {
            cwd: workspace,
            encoding: "utf8",
            env: environmentFor(dirname(wrongLauncher)),
            shell: false,
          },
        );
        expect(observed.status).toBe(0);
        const report = JSON.parse(observed.stdout).data.report;
        expect(report).toMatchObject({
          status: "failure_observed",
          verdict: "PARTIAL_EVIDENCE",
          execution_context: "HOST_OBSERVATION",
          experiment: { status: "not_attempted" },
        });
        expect(report.verdict).not.toBe("VERIFIED_INTERVENTION");
        expect(report.observation.result.stderr.redacted_excerpt).toContain(
          "RP_FIXTURE_PACKAGE_MANAGER_VERSION",
        );
      } finally {
        rmSync(workspace, { force: true, recursive: true });
      }
    },
  );

  test("DEV-RUNTIME-003 asserts the runtime provenance split deterministically", () => {
    const fixtureRoot = resolve(repositoryRoot, "fixtures");
    const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-RUNTIME-003");
    const entrypoint = resolve(assetRoot, "fixture", "assert-runtime-provenance.mjs");
    const manifest = JSON.parse(
      readFileSync(resolve(fixtureRoot, "development", "cases", "DEV-RUNTIME-003.json"), "utf8"),
    );
    expect(manifest).toMatchObject({
      fixture_status: "verified",
      scenario: { planned_target_argv: ["pnpm", "run", "assert-runtime-provenance"] },
      implementation: {
        runnable: true,
        asset_root: "development/assets/DEV-RUNTIME-003",
        missing_assets: [],
        receipts: {
          build: "receipts/build/DEV-RUNTIME-003.json",
          backend_qualification: "receipts/backend/qemu-kvm-ubuntu-noble-rpvm-2026-08-22.json",
          verification_ledger: "receipts/ledger/DEV-RUNTIME-003.json",
        },
        verified_at: expect.any(String),
      },
    });

    const run = (observed: string | undefined, expected: string | undefined) =>
      spawnSync(process.execPath, [entrypoint], {
        cwd: assetRoot,
        encoding: "utf8",
        env: {
          ...(observed === undefined ? {} : { RUNPARITY_FIXTURE_RUNTIME_ROLE: observed }),
          ...(expected === undefined ? {} : { RUNPARITY_FIXTURE_EXPECTED_RUNTIME_ROLE: expected }),
        },
        shell: false,
      });
    expect(run("approved", "approved")).toMatchObject({
      status: 0,
      stdout: "RUNPARITY_OK:dev-runtime-003\n",
      stderr: "",
    });
    expect(run("unintended", "approved")).toMatchObject({
      status: 23,
      stdout: "",
      stderr: "RP_FIXTURE_RUNTIME_PROVENANCE_SPLIT observed=unintended expected=approved\n",
    });
    expect(run(undefined, "approved")).toMatchObject({
      status: 64,
      stdout: "",
      stderr: "RP_FIXTURE_INVALID_RUNTIME_ASSERTION\n",
    });

    const pnpmLauncher = readFileSync(resolve(assetRoot, "pnpm-launcher", "bin", "pnpm"), "utf8");
    expect(pnpmLauncher).toMatch(/^#!\/bin\/sh\n/u);
    expect(pnpmLauncher).toContain("RUNPARITY_FIXTURE_RUNTIME_ROLE=unintended");
    expect(pnpmLauncher).not.toMatch(/`|\$\(|\beval\b|\benv\s/u);
    const unintendedNode = readFileSync(
      resolve(assetRoot, "runtime-manager", "unintended", "bin", "node"),
      "utf8",
    );
    const approvedNode = readFileSync(
      resolve(assetRoot, "runtime-manager", "approved", "bin", "node"),
      "utf8",
    );
    expect(unintendedNode.replace("=unintended", "=<ROLE>")).toBe(
      approvedNode.replace("=approved", "=<ROLE>"),
    );

    const pnpmEntry = resolve(assetRoot, "pnpm-launcher", "bin", "pnpm-entry.mjs");
    const entryRun = (role: string) =>
      spawnSync(process.execPath, [pnpmEntry, "run", "assert-runtime-provenance"], {
        cwd: assetRoot,
        encoding: "utf8",
        env: {
          RUNPARITY_FIXTURE_RUNTIME_ROLE: role,
          RUNPARITY_FIXTURE_EXPECTED_RUNTIME_ROLE: "approved",
        },
        shell: false,
      });
    expect(entryRun("unintended")).toMatchObject({
      status: 23,
      stdout: "",
      stderr: "RP_FIXTURE_RUNTIME_PROVENANCE_SPLIT observed=unintended expected=approved\n",
    });
    expect(entryRun("approved")).toMatchObject({
      status: 0,
      stdout: "RUNPARITY_OK:dev-runtime-003\n",
      stderr: "",
    });
  });

  test.runIf(process.platform === "linux")(
    "DEV-RUNTIME-003 splits direct and package-manager runtime provenance",
    () => {
      const sourceRoot = resolve(
        repositoryRoot,
        "fixtures",
        "development",
        "assets",
        "DEV-RUNTIME-003",
      );
      const workspace = mkdtempSync(resolve(tmpdir(), "runparity-dev-runtime-003-"));
      try {
        const copiedAssets = [
          "package.json",
          "fixture/assert-runtime-provenance.mjs",
          "runtime-manager/unintended/bin/node",
          "runtime-manager/approved/bin/node",
          "pnpm-launcher/bin/pnpm",
          "pnpm-launcher/bin/pnpm-entry.mjs",
        ];
        for (const asset of copiedAssets) {
          const destination = resolve(workspace, asset);
          mkdirSync(dirname(destination), { recursive: true });
          copyFileSync(resolve(sourceRoot, asset), destination);
        }
        const pnpmLauncher = resolve(workspace, "pnpm-launcher", "bin", "pnpm");
        const approvedNode = resolve(workspace, "runtime-manager", "approved", "bin", "node");
        chmodSync(pnpmLauncher, 0o755);
        chmodSync(approvedNode, 0o755);
        const environmentFor = (path: string) => ({
          PATH: path,
          RUNPARITY_FIXTURE_REAL_NODE: process.execPath,
          RUNPARITY_FIXTURE_EXPECTED_RUNTIME_ROLE: "approved",
        });
        const aPath = [dirname(pnpmLauncher), dirname(approvedNode)].join(delimiter);

        const directNode = spawnSync("node", ["fixture/assert-runtime-provenance.mjs"], {
          cwd: workspace,
          encoding: "utf8",
          env: environmentFor(aPath),
          shell: false,
        });
        expect(directNode).toMatchObject({
          status: 0,
          stdout: "RUNPARITY_OK:dev-runtime-003\n",
          stderr: "",
        });

        const managerChild = spawnSync("pnpm", ["run", "assert-runtime-provenance"], {
          cwd: workspace,
          encoding: "utf8",
          env: environmentFor(aPath),
          shell: false,
        });
        expect(managerChild).toMatchObject({
          status: 23,
          stdout: "",
          stderr: "RP_FIXTURE_RUNTIME_PROVENANCE_SPLIT observed=unintended expected=approved\n",
        });

        // B-sim: a pnpm launcher bound to the approved slot must pass the same
        // frozen assertion with an otherwise identical environment.
        const approvedPnpm = resolve(workspace, "pnpm-approved", "bin", "pnpm");
        mkdirSync(dirname(approvedPnpm), { recursive: true });
        const approvedLauncherSource = readFileSync(pnpmLauncher, "utf8").replace(
          "=unintended",
          "=approved",
        );
        writeFileSync(approvedPnpm, approvedLauncherSource);
        copyFileSync(
          resolve(workspace, "pnpm-launcher", "bin", "pnpm-entry.mjs"),
          resolve(workspace, "pnpm-approved", "bin", "pnpm-entry.mjs"),
        );
        chmodSync(approvedPnpm, 0o755);
        const bPath = [dirname(approvedPnpm), dirname(pnpmLauncher), dirname(approvedNode)].join(
          delimiter,
        );
        const approvedChild = spawnSync("pnpm", ["run", "assert-runtime-provenance"], {
          cwd: workspace,
          encoding: "utf8",
          env: environmentFor(bPath),
          shell: false,
        });
        expect(approvedChild).toMatchObject({
          status: 0,
          stdout: "RUNPARITY_OK:dev-runtime-003\n",
          stderr: "",
        });

        const observed = spawnSync(
          process.execPath,
          [
            tsxCli,
            runParityCli,
            "--json",
            "doctor",
            "--report-only",
            "--",
            "pnpm",
            "run",
            "assert-runtime-provenance",
          ],
          {
            cwd: workspace,
            encoding: "utf8",
            env: environmentFor(aPath),
            shell: false,
          },
        );
        expect(observed.status).toBe(0);
        const report = JSON.parse(observed.stdout).data.report;
        expect(report).toMatchObject({
          status: "failure_observed",
          verdict: "PARTIAL_EVIDENCE",
          execution_context: "HOST_OBSERVATION",
          experiment: { status: "not_attempted" },
        });
        expect(report.verdict).not.toBe("VERIFIED_INTERVENTION");
      } finally {
        rmSync(workspace, { force: true, recursive: true });
      }
    },
  );

  test("DEV-OOS-001 registry probe is read-only, deterministic, and fails closed off Windows", () => {
    const fixtureRoot = resolve(repositoryRoot, "fixtures");
    const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-OOS-001");
    const entrypoint = resolve(assetRoot, "fixture", "registry-probe.mjs");
    const manifest = JSON.parse(
      readFileSync(resolve(fixtureRoot, "development", "cases", "DEV-OOS-001.json"), "utf8"),
    );
    expect(manifest).toMatchObject({
      fixture_status: "implemented",
      scenario: { planned_target_argv: ["npm", "run", "fixture:registry-probe"] },
      implementation: {
        runnable: true,
        asset_root: "development/assets/DEV-OOS-001",
        missing_assets: [],
        receipts: {
          build: "receipts/build/DEV-OOS-001.json",
          backend_qualification: null,
          verification_ledger: null,
        },
        verified_at: null,
      },
    });

    const hostileRoot = mkdtempSync(resolve(tmpdir(), "runparity-oos-001-fake-"));
    try {
      const fakeReg = resolve(hostileRoot, "fake-reg.mjs");
      writeFileSync(
        fakeReg,
        "const code = Number(process.env.RUNPARITY_FAKE_REG_EXIT ?? 1); process.exitCode = code;\n",
      );
      const runWithReg = (regPath: string | undefined, fakeExit?: string) =>
        spawnSync(process.execPath, [entrypoint], {
          cwd: assetRoot,
          encoding: "utf8",
          env: {
            SystemRoot: process.env["SystemRoot"],
            ...(regPath === undefined
              ? {}
              : { RUNPARITY_FIXTURE_REG_EXE: regPath, RUNPARITY_FAKE_REG_EXIT: fakeExit }),
          },
          shell: false,
        });

      // Boundary logic through the stand-in reg: exit 1 = absent key, exit 0 =
      // premise violated, spawn failure = invalid.
      expect(runWithReg(fakeReg, "1")).toMatchObject({
        status: 23,
        stdout: "",
        stderr: "RP_FIXTURE_WINDOWS_PRIVILEGED_REGISTRY\n",
      });
      expect(runWithReg(fakeReg, "0")).toMatchObject({
        status: 64,
        stdout: "",
        stderr: "RP_FIXTURE_INVALID_REGISTRY_ASSERTION\n",
      });
      expect(runWithReg(resolve(hostileRoot, "missing-reg"), "1")).toMatchObject({
        status: 64,
        stdout: "",
        stderr: "RP_FIXTURE_INVALID_REGISTRY_ASSERTION\n",
      });

      if (process.platform === "win32") {
        // Genuine read-only reg.exe query of the absent fixture key.
        const native = spawnSync(process.execPath, [entrypoint], {
          cwd: assetRoot,
          encoding: "utf8",
          env: {},
          shell: false,
        });
        expect(native).toMatchObject({
          status: 23,
          stdout: "",
          stderr: "RP_FIXTURE_WINDOWS_PRIVILEGED_REGISTRY\n",
        });
      } else {
        const refused = spawnSync(process.execPath, [entrypoint], {
          cwd: assetRoot,
          encoding: "utf8",
          env: {},
          shell: false,
        });
        expect(refused).toMatchObject({
          status: 64,
          stdout: "",
          stderr: "RP_FIXTURE_INVALID_REGISTRY_ASSERTION\n",
        });
      }
    } finally {
      rmSync(hostileRoot, { force: true, recursive: true });
    }
  });

  test.runIf(process.platform === "win32")(
    "DEV-OOS-001 Host Observe records partial evidence without inventing a refusal flow",
    () => {
      const fixtureRoot = resolve(repositoryRoot, "fixtures");
      const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-OOS-001");
      const workspace = mkdtempSync(resolve(tmpdir(), "runparity-oos-001-observe-"));
      try {
        cpSync(assetRoot, workspace, { recursive: true });
        const bin = resolve(workspace, "bin");
        mkdirSync(bin);
        const targetScript = resolve(workspace, "fixture", "registry-probe.mjs");
        writeFileSync(
          resolve(bin, "npm.cmd"),
          `@echo off\r\n"${process.execPath}" "${targetScript}" %*\r\n`,
        );
        const environment = Object.fromEntries(
          Object.entries(process.env).filter(([name]) => name.toLowerCase() !== "path"),
        );
        environment["PATH"] = [bin, process.env["PATH"] ?? process.env["Path"] ?? ""].join(
          delimiter,
        );

        const result = spawnSync(
          process.execPath,
          [tsxCli, runParityCli, "--json", "doctor", "--", "npm", "run", "fixture:registry-probe"],
          { cwd: workspace, encoding: "utf8", env: environment, shell: false },
        );

        expect(result.status).toBe(23);
        expect(result.stderr).toBe("");
        expect(result.stdout).not.toContain('"verdict":"VERIFIED_INTERVENTION"');
        const report = JSON.parse(result.stdout).data.report;
        expect(report).toMatchObject({
          status: "failure_observed",
          verdict: "PARTIAL_EVIDENCE",
          execution_context: "HOST_OBSERVATION",
          experiment: { status: "not_attempted" },
          remediation: { mode: "manual_only", changes: [] },
        });
        expect(report.observation.result.stderr.redacted_excerpt).toContain(
          "RP_FIXTURE_WINDOWS_PRIVILEGED_REGISTRY",
        );
        expect(report.verdict).not.toBe("REFUSED_OUT_OF_SCOPE");
      } finally {
        rmSync(workspace, { force: true, recursive: true });
      }
    },
  );

  test.runIf(process.platform === "linux")(
    "DEV-NATIVE-001 surfaces a real native ABI mismatch through doctor",
    (t) => {
      const fixtureRoot = resolve(repositoryRoot, "fixtures");
      const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-NATIVE-001");
      const entrypoint = resolve(assetRoot, "fixture", "load-native-addon.mjs");
      const manifest = JSON.parse(
        readFileSync(resolve(fixtureRoot, "development", "cases", "DEV-NATIVE-001.json"), "utf8"),
      );
      const environmentA = JSON.parse(
        readFileSync(resolve(assetRoot, "fixture", "environment-a.json"), "utf8"),
      );
      expect(manifest).toMatchObject({
        fixture_status: "verified",
        scenario: {
          expected_a_failure_signature: "NODE_MODULE_VERSION",
        },
        implementation: {
          runnable: true,
          asset_root: "development/assets/DEV-NATIVE-001",
          missing_assets: [],
          receipts: {
            build: "receipts/build/DEV-NATIVE-001.json",
            backend_qualification: "receipts/backend/qemu-kvm-ubuntu-noble-rpvm-2026-08-22.json",
            verification_ledger: "receipts/ledger/DEV-NATIVE-001.json",
          },
          verified_at: expect.any(String),
        },
      });
      expect(environmentA).toMatchObject({
        schema: "runparity.fixture-native-layer/v1",
        platform: { os: "linux", arch: "x64", libc: "glibc" },
        matching_node_module_version: process.versions.modules,
        selected: {
          path: "layers/mismatched.node",
          node_module_version: "137",
          cxx_standard: "c++20",
        },
        matching: {
          path: "layers/matching.node",
          node_module_version: process.versions.modules,
          cxx_standard: "c++20",
        },
      });
      for (const layer of [environmentA.selected, environmentA.matching]) {
        const bytes = readFileSync(resolve(assetRoot, layer.path));
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(layer.sha256);
      }
      expect(environmentA.selected.sha256).not.toBe(environmentA.matching.sha256);
      const header = spawnSync("readelf", ["-h", resolve(assetRoot, environmentA.selected.path)], {
        cwd: assetRoot,
        encoding: "utf8",
        env: {},
        shell: false,
      });
      expect(header.status).toBe(0);
      expect(header.stdout).toMatch(/Class:\s+ELF64/u);
      expect(header.stdout).toMatch(/Machine:\s+Advanced Micro Devices X86-64/u);
      if (environmentA.matching_node_module_version !== process.versions.modules) {
        t.skip(
          `fixture runtime ABI ${environmentA.matching_node_module_version} differs from ${process.versions.modules}`,
        );
        return;
      }

      const native = spawnSync(process.execPath, [entrypoint], {
        cwd: assetRoot,
        encoding: "utf8",
        env: {},
        shell: false,
      });
      expect(native.status).toBe(1);
      expect(native.stdout).toBe("");
      const abiMismatch = native.stderr.match(
        /NODE_MODULE_VERSION\s+(\d+)[\s\S]{0,500}?requires\s+NODE_MODULE_VERSION\s+(\d+)/iu,
      );
      if (abiMismatch === null) throw new Error("expected a native ABI mismatch");
      expect(abiMismatch[1]).not.toBe(abiMismatch[2]);
      expect(abiMismatch[2]).toBe(process.versions.modules);

      const observed = spawnSync(
        process.execPath,
        [tsxCli, runParityCli, "--json", "doctor", "--", process.execPath, entrypoint],
        { cwd: assetRoot, encoding: "utf8", env: {}, shell: false },
      );
      expect(observed.status).toBe(1);
      expect(observed.stderr).toBe("");
      expect(observed.stdout).not.toContain('"verdict":"VERIFIED_INTERVENTION"');
      const report = JSON.parse(observed.stdout).data.report;
      expect(report).toMatchObject({
        status: "failure_observed",
        verdict: "PARTIAL_EVIDENCE",
        execution_context: "HOST_OBSERVATION",
        experiment: { status: "not_attempted" },
        remediation: { mode: "manual_only", changes: [] },
        observation: {
          result: {
            status: "failed",
            exit_code: 1,
            stderr: {
              digest: { algorithm: "HMAC-SHA-256", key_scope: "invocation" },
            },
          },
        },
      });
      expect(report.findings).toEqual([
        expect.objectContaining({
          id: "RP-NATIVE-0001",
          category: "NATIVE_ABI_ARCH_MISMATCH",
          state: "supported",
          reason_code: "RP_NODE_MODULE_VERSION_MISMATCH",
          observed_module_abi: Number(abiMismatch[1]),
          required_runtime_abi: Number(abiMismatch[2]),
          intervention: null,
        }),
      ]);
    },
  );

  test.runIf(process.platform === "linux")(
    "DEV-NATIVE-001 loads its matching content-addressed layer when selected",
    (t) => {
      const fixtureRoot = resolve(repositoryRoot, "fixtures");
      const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-NATIVE-001");
      const environmentPath = resolve(assetRoot, "fixture", "environment-a.json");
      const environment = JSON.parse(readFileSync(environmentPath, "utf8"));
      if (environment.matching_node_module_version !== process.versions.modules) {
        t.skip(
          `fixture runtime ABI ${environment.matching_node_module_version} differs from ${process.versions.modules}`,
        );
        return;
      }

      const workspace = mkdtempSync(resolve(tmpdir(), "runparity-native-001-matching-"));
      try {
        cpSync(assetRoot, workspace, { recursive: true });
        const selectedEnvironment = {
          ...environment,
          selected: environment.matching,
        };
        writeFileSync(
          resolve(workspace, "fixture", "environment-a.json"),
          `${JSON.stringify(selectedEnvironment, null, 2)}\n`,
          "utf8",
        );
        const matching = spawnSync(
          process.execPath,
          [resolve(workspace, "fixture", "load-native-addon.mjs")],
          { cwd: workspace, encoding: "utf8", env: {}, shell: false },
        );
        expect(matching).toMatchObject({
          status: 0,
          stdout: "RUNPARITY_OK:dev-native-001\n",
          stderr: "",
        });
      } finally {
        rmSync(workspace, { force: true, recursive: true });
      }
    },
  );

  test("DEV-NATIVE-001 rejects a malformed layer recipe once without loading an addon", () => {
    const fixtureRoot = resolve(repositoryRoot, "fixtures");
    const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-NATIVE-001");
    const workspace = mkdtempSync(resolve(tmpdir(), "runparity-native-001-invalid-"));
    try {
      cpSync(assetRoot, workspace, { recursive: true });
      writeFileSync(
        resolve(workspace, "fixture", "environment-a.json"),
        "this is not fixture JSON\\n",
        "utf8",
      );
      const rejected = spawnSync(
        process.execPath,
        [resolve(workspace, "fixture", "load-native-addon.mjs")],
        { cwd: workspace, encoding: "utf8", env: {}, shell: false },
      );
      expect(rejected).toMatchObject({
        status: 64,
        stdout: "",
        stderr: "RP_FIXTURE_INVALID_NATIVE_LAYER\n",
      });
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test("DEV-NATIVE-001 rejects a selected layer whose bytes do not match its recipe", () => {
    const fixtureRoot = resolve(repositoryRoot, "fixtures");
    const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-NATIVE-001");
    const workspace = mkdtempSync(resolve(tmpdir(), "runparity-native-001-integrity-"));
    try {
      cpSync(assetRoot, workspace, { recursive: true });
      const environmentPath = resolve(workspace, "fixture", "environment-a.json");
      const environment = JSON.parse(readFileSync(environmentPath, "utf8"));
      environment.selected.sha256 = "0".repeat(64);
      writeFileSync(environmentPath, `${JSON.stringify(environment, null, 2)}\n`, "utf8");
      const rejected = spawnSync(
        process.execPath,
        [resolve(workspace, "fixture", "load-native-addon.mjs")],
        { cwd: workspace, encoding: "utf8", env: {}, shell: false },
      );
      expect(rejected).toMatchObject({
        status: 64,
        stdout: "",
        stderr: "RP_FIXTURE_NATIVE_LAYER_INTEGRITY\n",
      });
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test.runIf(process.platform === "linux" && process.arch === "x64")(
    "DEV-NATIVE-002 keeps its CPU architecture evidence structural and its loader failure genuine",
    (t) => {
      const fixtureRoot = resolve(repositoryRoot, "fixtures");
      const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-NATIVE-002");
      const entrypoint = resolve(assetRoot, "fixture", "load-native-addon.mjs");
      const manifest = JSON.parse(
        readFileSync(resolve(fixtureRoot, "development", "cases", "DEV-NATIVE-002.json"), "utf8"),
      );
      const environment = JSON.parse(
        readFileSync(resolve(assetRoot, "fixture", "environment-a.json"), "utf8"),
      );
      expect(manifest).toMatchObject({
        fixture_status: "verified",
        scenario: { expected_a_failure_signature: "RP_FIXTURE_NATIVE_ARCH_MISMATCH" },
        implementation: {
          runnable: true,
          asset_root: "development/assets/DEV-NATIVE-002",
          missing_assets: [],
          receipts: {
            build: "receipts/build/DEV-NATIVE-002.json",
            backend_qualification: "receipts/backend/qemu-kvm-ubuntu-noble-rpvm-2026-08-22.json",
            verification_ledger: "receipts/ledger/DEV-NATIVE-002.json",
          },
          verified_at: expect.any(String),
        },
      });
      expect(environment).toMatchObject({
        schema: "runparity.fixture-native-architecture-layer/v1",
        platform: { os: "linux", arch: "x64", libc: "glibc" },
        matching_node_module_version: process.versions.modules,
        selected: {
          path: "layers/mismatched-aarch64.node",
          target_arch: "arm64",
          node_module_version: process.versions.modules,
          cxx_standard: "c++20",
        },
        matching: {
          path: "layers/matching-x64.node",
          target_arch: "x64",
          node_module_version: process.versions.modules,
          cxx_standard: "c++20",
        },
      });
      for (const layer of [environment.selected, environment.matching]) {
        const bytes = readFileSync(resolve(assetRoot, layer.path));
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(layer.sha256);
      }
      expect(environment.selected.sha256).not.toBe(environment.matching.sha256);

      const mismatchedHeader = spawnSync(
        "readelf",
        ["-h", resolve(assetRoot, environment.selected.path)],
        { cwd: assetRoot, encoding: "utf8", env: {}, shell: false },
      );
      expect(mismatchedHeader).toMatchObject({ status: 0 });
      expect(mismatchedHeader.stdout).toMatch(/Class:\s+ELF64/u);
      expect(mismatchedHeader.stdout).toMatch(/Machine:\s+AArch64/u);
      const matchingHeader = spawnSync(
        "readelf",
        ["-h", resolve(assetRoot, environment.matching.path)],
        { cwd: assetRoot, encoding: "utf8", env: {}, shell: false },
      );
      expect(matchingHeader).toMatchObject({ status: 0 });
      expect(matchingHeader.stdout).toMatch(/Machine:\s+Advanced Micro Devices X86-64/u);

      const preflight = spawnSync(process.execPath, [entrypoint], {
        cwd: assetRoot,
        encoding: "utf8",
        env: {},
        shell: false,
      });
      expect(preflight).toMatchObject({
        status: 64,
        stdout: "",
        stderr: "RP_FIXTURE_NATIVE_ARCH_MISMATCH\n",
      });

      // Linux dlopen reports a generic failure for this cross-architecture ELF.
      // The preceding ELF header check, not this text, establishes AArch64.
      const actualLoad = spawnSync(
        process.execPath,
        ["-e", "require(process.argv[1])", resolve(assetRoot, environment.selected.path)],
        { cwd: assetRoot, encoding: "utf8", env: {}, shell: false },
      );
      expect(actualLoad.status).toBe(1);
      expect(actualLoad.stdout).toBe("");
      expect(actualLoad.stderr).toContain("ERR_DLOPEN_FAILED");
      expect(actualLoad.stderr).toContain(basename(environment.selected.path));

      if (environment.matching_node_module_version !== process.versions.modules) {
        t.skip(
          `fixture runtime ABI ${environment.matching_node_module_version} differs from ${process.versions.modules}`,
        );
      }
    },
  );

  test.runIf(process.platform === "linux" && process.arch === "x64")(
    "DEV-NATIVE-002 loads the matching content-addressed x64 layer when selected",
    (t) => {
      const fixtureRoot = resolve(repositoryRoot, "fixtures");
      const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-NATIVE-002");
      const environmentPath = resolve(assetRoot, "fixture", "environment-a.json");
      const environment = JSON.parse(readFileSync(environmentPath, "utf8"));
      if (environment.matching_node_module_version !== process.versions.modules) {
        t.skip(
          `fixture runtime ABI ${environment.matching_node_module_version} differs from ${process.versions.modules}`,
        );
        return;
      }

      const workspace = mkdtempSync(resolve(tmpdir(), "runparity-native-002-matching-"));
      try {
        cpSync(assetRoot, workspace, { recursive: true });
        const selectedEnvironment = { ...environment, selected: environment.matching };
        writeFileSync(
          resolve(workspace, "fixture", "environment-a.json"),
          `${JSON.stringify(selectedEnvironment, null, 2)}\n`,
          "utf8",
        );
        const matching = spawnSync(
          process.execPath,
          [resolve(workspace, "fixture", "load-native-addon.mjs")],
          { cwd: workspace, encoding: "utf8", env: {}, shell: false },
        );
        expect(matching).toMatchObject({
          status: 0,
          stdout: "RUNPARITY_OK:dev-native-002\n",
          stderr: "",
        });
      } finally {
        rmSync(workspace, { force: true, recursive: true });
      }
    },
  );

  test("DEV-NATIVE-002 rejects a malformed architecture recipe exactly once", () => {
    const fixtureRoot = resolve(repositoryRoot, "fixtures");
    const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-NATIVE-002");
    const workspace = mkdtempSync(resolve(tmpdir(), "runparity-native-002-invalid-"));
    try {
      cpSync(assetRoot, workspace, { recursive: true });
      writeFileSync(
        resolve(workspace, "fixture", "environment-a.json"),
        "this is not fixture JSON\\n",
        "utf8",
      );
      const rejected = spawnSync(
        process.execPath,
        [resolve(workspace, "fixture", "load-native-addon.mjs")],
        { cwd: workspace, encoding: "utf8", env: {}, shell: false },
      );
      expect(rejected).toMatchObject({
        status: 64,
        stdout: "",
        stderr: "RP_FIXTURE_INVALID_NATIVE_ARCH_LAYER\n",
      });
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test("DEV-NATIVE-002 rejects a selected layer whose bytes do not match its recipe", () => {
    const fixtureRoot = resolve(repositoryRoot, "fixtures");
    const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-NATIVE-002");
    const workspace = mkdtempSync(resolve(tmpdir(), "runparity-native-002-integrity-"));
    try {
      cpSync(assetRoot, workspace, { recursive: true });
      const environmentPath = resolve(workspace, "fixture", "environment-a.json");
      const environment = JSON.parse(readFileSync(environmentPath, "utf8"));
      environment.selected.sha256 = "0".repeat(64);
      writeFileSync(environmentPath, `${JSON.stringify(environment, null, 2)}\n`, "utf8");
      const rejected = spawnSync(
        process.execPath,
        [resolve(workspace, "fixture", "load-native-addon.mjs")],
        { cwd: workspace, encoding: "utf8", env: {}, shell: false },
      );
      expect(rejected).toMatchObject({
        status: 64,
        stdout: "",
        stderr: "RP_FIXTURE_NATIVE_LAYER_INTEGRITY\n",
      });
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test.runIf(process.platform === "linux" && process.arch === "x64")(
    "DEV-NATIVE-003 keeps its libc evidence structural and its loader failure genuine",
    (t) => {
      const fixtureRoot = resolve(repositoryRoot, "fixtures");
      const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-NATIVE-003");
      const entrypoint = resolve(assetRoot, "fixture", "load-native-addon.mjs");
      const manifest = JSON.parse(
        readFileSync(resolve(fixtureRoot, "development", "cases", "DEV-NATIVE-003.json"), "utf8"),
      );
      const environment = JSON.parse(
        readFileSync(resolve(assetRoot, "fixture", "environment-a.json"), "utf8"),
      );
      if (environment.matching_node_version !== process.versions.node) {
        t.skip(
          `fixture runtime ${environment.matching_node_version} differs from ${process.versions.node}`,
        );
        return;
      }
      expect(manifest).toMatchObject({
        fixture_status: "verified",
        scenario: { expected_a_failure_signature: "RP_FIXTURE_NATIVE_LIBC_MISMATCH" },
        implementation: {
          runnable: true,
          asset_root: "development/assets/DEV-NATIVE-003",
          missing_assets: [],
          receipts: {
            build: "receipts/build/DEV-NATIVE-003.json",
            backend_qualification: "receipts/backend/qemu-kvm-ubuntu-noble-rpvm-2026-08-22.json",
            verification_ledger: "receipts/ledger/DEV-NATIVE-003.json",
          },
          verified_at: expect.any(String),
        },
      });
      expect(environment).toMatchObject({
        schema: "runparity.fixture-native-libc-layer/v1",
        platform: { os: "linux", arch: "x64", libc: "glibc" },
        matching_node_version: process.versions.node,
        matching_napi_version: 1,
        selected: {
          path: "layers/mismatched-musl.node",
          target_libc: "musl",
          needed_shared_object: "libc.so",
          napi_version: 1,
          c_standard: "c11",
        },
        matching: {
          path: "layers/matching-glibc.node",
          target_libc: "glibc",
          needed_shared_object: "libc.so.6",
          napi_version: 1,
          c_standard: "c11",
        },
      });
      for (const layer of [environment.selected, environment.matching]) {
        const bytes = readFileSync(resolve(assetRoot, layer.path));
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(layer.sha256);
      }
      expect(environment.selected.sha256).not.toBe(environment.matching.sha256);

      const mismatchedDynamic = spawnSync(
        "readelf",
        ["-d", resolve(assetRoot, environment.selected.path)],
        { cwd: assetRoot, encoding: "utf8", env: {}, shell: false },
      );
      expect(mismatchedDynamic).toMatchObject({ status: 0 });
      expect(mismatchedDynamic.stdout).toContain("Shared library: [libc.so]");
      const matchingDynamic = spawnSync(
        "readelf",
        ["-d", resolve(assetRoot, environment.matching.path)],
        { cwd: assetRoot, encoding: "utf8", env: {}, shell: false },
      );
      expect(matchingDynamic).toMatchObject({ status: 0 });
      expect(matchingDynamic.stdout).toContain("Shared library: [libc.so.6]");

      const preflight = spawnSync(process.execPath, [entrypoint], {
        cwd: assetRoot,
        encoding: "utf8",
        env: {},
        shell: false,
      });
      expect(preflight).toMatchObject({
        status: 64,
        stdout: "",
        stderr: "RP_FIXTURE_NATIVE_LIBC_MISMATCH\n",
      });

      // The dynamic table above, not this generic dlopen text, establishes the
      // musl dependency. This smoke only records that glibc Node cannot load it.
      const actualLoad = spawnSync(
        process.execPath,
        ["-e", "require(process.argv[1])", resolve(assetRoot, environment.selected.path)],
        { cwd: assetRoot, encoding: "utf8", env: {}, shell: false },
      );
      expect(actualLoad.status).toBe(1);
      expect(actualLoad.stdout).toBe("");
      expect(actualLoad.stderr).toContain("ERR_DLOPEN_FAILED");
      expect(actualLoad.stderr).toContain("invalid ELF header");
    },
  );

  test.runIf(process.platform === "linux" && process.arch === "x64")(
    "DEV-NATIVE-003 loads the matching content-addressed glibc layer when selected",
    (t) => {
      const fixtureRoot = resolve(repositoryRoot, "fixtures");
      const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-NATIVE-003");
      const environmentPath = resolve(assetRoot, "fixture", "environment-a.json");
      const environment = JSON.parse(readFileSync(environmentPath, "utf8"));
      if (environment.matching_node_version !== process.versions.node) {
        t.skip(
          `fixture runtime ${environment.matching_node_version} differs from ${process.versions.node}`,
        );
        return;
      }

      const workspace = mkdtempSync(resolve(tmpdir(), "runparity-native-003-matching-"));
      try {
        cpSync(assetRoot, workspace, { recursive: true });
        const selectedEnvironment = { ...environment, selected: environment.matching };
        writeFileSync(
          resolve(workspace, "fixture", "environment-a.json"),
          `${JSON.stringify(selectedEnvironment, null, 2)}\n`,
          "utf8",
        );
        const matching = spawnSync(
          process.execPath,
          [resolve(workspace, "fixture", "load-native-addon.mjs")],
          { cwd: workspace, encoding: "utf8", env: {}, shell: false },
        );
        expect(matching).toMatchObject({
          status: 0,
          stdout: "RUNPARITY_OK:dev-native-003\n",
          stderr: "",
        });
      } finally {
        rmSync(workspace, { force: true, recursive: true });
      }
    },
  );

  test("DEV-NATIVE-003 rejects a malformed libc recipe exactly once", () => {
    const fixtureRoot = resolve(repositoryRoot, "fixtures");
    const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-NATIVE-003");
    const workspace = mkdtempSync(resolve(tmpdir(), "runparity-native-003-invalid-"));
    try {
      cpSync(assetRoot, workspace, { recursive: true });
      writeFileSync(
        resolve(workspace, "fixture", "environment-a.json"),
        "this is not fixture JSON\\n",
        "utf8",
      );
      const rejected = spawnSync(
        process.execPath,
        [resolve(workspace, "fixture", "load-native-addon.mjs")],
        { cwd: workspace, encoding: "utf8", env: {}, shell: false },
      );
      expect(rejected).toMatchObject({
        status: 64,
        stdout: "",
        stderr: "RP_FIXTURE_INVALID_NATIVE_LIBC_LAYER\n",
      });
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test("DEV-NATIVE-003 rejects a selected layer whose bytes do not match its recipe", () => {
    const fixtureRoot = resolve(repositoryRoot, "fixtures");
    const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-NATIVE-003");
    const workspace = mkdtempSync(resolve(tmpdir(), "runparity-native-003-integrity-"));
    try {
      cpSync(assetRoot, workspace, { recursive: true });
      const environmentPath = resolve(workspace, "fixture", "environment-a.json");
      const environment = JSON.parse(readFileSync(environmentPath, "utf8"));
      environment.selected.sha256 = "0".repeat(64);
      writeFileSync(environmentPath, `${JSON.stringify(environment, null, 2)}\n`, "utf8");
      const rejected = spawnSync(
        process.execPath,
        [resolve(workspace, "fixture", "load-native-addon.mjs")],
        { cwd: workspace, encoding: "utf8", env: {}, shell: false },
      );
      expect(rejected).toMatchObject({
        status: 64,
        stdout: "",
        stderr: "RP_FIXTURE_NATIVE_LAYER_INTEGRITY\n",
      });
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  test("DEV-NATIVE-003 rejects libc metadata that disagrees with its checked dynamic table", () => {
    const fixtureRoot = resolve(repositoryRoot, "fixtures");
    const assetRoot = resolve(fixtureRoot, "development", "assets", "DEV-NATIVE-003");
    const workspace = mkdtempSync(resolve(tmpdir(), "runparity-native-003-dynamic-"));
    try {
      cpSync(assetRoot, workspace, { recursive: true });
      const environmentPath = resolve(workspace, "fixture", "environment-a.json");
      const environment = JSON.parse(readFileSync(environmentPath, "utf8"));
      environment.selected.needed_shared_object = "libc.so.6";
      writeFileSync(environmentPath, `${JSON.stringify(environment, null, 2)}\n`, "utf8");
      const rejected = spawnSync(
        process.execPath,
        [resolve(workspace, "fixture", "load-native-addon.mjs")],
        { cwd: workspace, encoding: "utf8", env: {}, shell: false },
      );
      expect(rejected).toMatchObject({
        status: 64,
        stdout: "",
        stderr: "RP_FIXTURE_INVALID_NATIVE_LIBC_LAYER\n",
      });
    } finally {
      rmSync(workspace, { force: true, recursive: true });
    }
  });
});
