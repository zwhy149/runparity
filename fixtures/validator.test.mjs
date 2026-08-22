import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectAssetTree } from "./lib/asset-inventory.mjs";

const fixtureRoot = dirname(fileURLToPath(import.meta.url));
const validatorPath = join(fixtureRoot, "validate.mjs");

function copiedFixtureRoot(t) {
  const temporaryParent = mkdtempSync(join(tmpdir(), "runparity-fixture-validator-"));
  const copiedRoot = join(temporaryParent, "fixtures");
  cpSync(fixtureRoot, copiedRoot, { recursive: true });
  t.after(() => {
    const resolvedParent = resolve(temporaryParent);
    assert.equal(dirname(resolvedParent), resolve(tmpdir()));
    rmSync(resolvedParent, { recursive: true, force: true });
  });
  return copiedRoot;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runValidator(root) {
  return spawnSync(process.execPath, [validatorPath, "--fixture-root", root], {
    cwd: dirname(fixtureRoot),
    encoding: "utf8",
  });
}

test("executes the Draft 2020-12 case schema instead of trusting manual checks", (t) => {
  const root = copiedFixtureRoot(t);
  const manifestPath = join(root, "development", "cases", "DEV-PATH-001.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.unexpected_unvalidated_claim = "must be rejected by additionalProperties";
  writeJson(manifestPath, manifest);

  const result = runValidator(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(
    result.stderr,
    /JSON Schema.*additional propert|must NOT have additional properties/i,
  );
});

test("schema diagnostics neutralize attacker-controlled display controls", (t) => {
  const root = copiedFixtureRoot(t);
  const manifestPath = join(root, "development", "cases", "DEV-PATH-001.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const hostileProperty = [
    "claim",
    String.fromCodePoint(0x202e),
    "spoof",
    String.fromCodePoint(0x2028),
    "line",
    String.fromCodePoint(0x200b),
    String.fromCodePoint(0xfeff),
    String.fromCodePoint(0xe0020),
  ].join("");
  manifest.allowed_typed_intervention.parameters[hostileProperty] = [];
  writeJson(manifestPath, manifest);

  const result = runValidator(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /JSON Schema validation failed/i);
  assert.equal(result.stderr.includes(String.fromCodePoint(0x202e)), false);
  assert.equal(result.stderr.includes(String.fromCodePoint(0x2028)), false);
  assert.equal(result.stderr.includes(String.fromCodePoint(0x200b)), false);
  assert.equal(result.stderr.includes(String.fromCodePoint(0xfeff)), false);
  assert.equal(result.stderr.includes(String.fromCodePoint(0xe0020)), false);
  assert.match(result.stderr, /\\u202e/iu);
  assert.match(result.stderr, /\\u2028/iu);
  assert.match(result.stderr, /\\u200b/iu);
  assert.match(result.stderr, /\\ufeff/iu);
  assert.match(result.stderr, /\\u\{e0020\}/iu);
});

test("a self-authored backend receipt cannot create backend-qualified state", (t) => {
  const root = copiedFixtureRoot(t);
  const caseId = "DEV-PATH-001";
  const assetRoot = `development/assets/${caseId}`;
  const buildReceipt = `receipts/build/${caseId}.json`;
  const backendReceipt = "receipts/backend/self-authored-linux-rootless.json";
  const entrypoint = "fixture/assert-node-marker.mjs";
  const manifestPath = join(root, "development", "cases", `${caseId}.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.fixture_status = "implemented";
  manifest.implementation = {
    runnable: true,
    asset_root: assetRoot,
    missing_assets: [],
    receipts: {
      build: buildReceipt,
      backend_qualification: backendReceipt,
      verification_ledger: null,
    },
    verified_at: null,
  };
  writeJson(manifestPath, manifest);

  const assetPath = join(root, assetRoot);
  mkdirSync(dirname(join(assetPath, entrypoint)), { recursive: true });
  writeFileSync(join(assetPath, entrypoint), "process.exitCode = 23;\n", "utf8");
  const inventory = inspectAssetTree(assetPath);
  mkdirSync(dirname(join(root, buildReceipt)), { recursive: true });
  mkdirSync(dirname(join(root, backendReceipt)), { recursive: true });
  writeJson(join(root, buildReceipt), {
    schema_version: "runparity.fixture-build-receipt/v1",
    case_id: caseId,
    manifest_sha256: createHash("sha256").update(readFileSync(manifestPath)).digest("hex"),
    asset_root: assetRoot,
    asset_inventory_schema_version: inventory.inventory.schema_version,
    asset_inventory_sha256: inventory.sha256,
    asset_inventory_stability: inventory.source_stability,
    entrypoint: { kind: "node_script", path: entrypoint },
    status: "passed",
    created_at: "2026-08-16T00:00:00Z",
  });
  writeJson(join(root, backendReceipt), {
    schema_version: "runparity.backend-qualification-receipt/v1",
    backend: "linux_rootless_oci",
    platform: { os: "linux", arch: "x64", libc: "glibc" },
    image_digest: `sha256:${"b".repeat(64)}`,
    policy_digest: `sha256:${"c".repeat(64)}`,
    status: "qualified",
    qualified_at: "2026-08-16T00:00:00Z",
  });

  const result = runValidator(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /backend qualification evidence: /i);
  assert.match(result.stderr, /control .* is absent|carries no control judgments/i);
  assert.match(result.stderr, /facts_sha256 missing/i);
  assert.doesNotMatch(result.stdout, /[1-9][0-9]* verified/i);

  writeFileSync(join(root, backendReceipt), "null\n", "utf8");
  const nullReceiptResult = runValidator(root);

  assert.notEqual(nullReceiptResult.status, 0, nullReceiptResult.stdout);
  assert.match(nullReceiptResult.stderr, /backend qualification receipt.*JSON object/i);
});

test("a verified_at timestamp cannot self-certify a fixture as verified", (t) => {
  const root = copiedFixtureRoot(t);
  const manifestPath = join(root, "development", "cases", "DEV-PATH-001.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.fixture_status = "verified";
  manifest.implementation.runnable = true;
  manifest.implementation.asset_root = "development/assets/DEV-PATH-001";
  manifest.implementation.missing_assets = [];
  manifest.implementation.verified_at = "2026-08-15T00:00:00Z";
  writeJson(manifestPath, manifest);

  const result = runValidator(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /derived status/i);
});

test("a self-authored build receipt and empty asset directory cannot derive implemented", (t) => {
  const root = copiedFixtureRoot(t);
  const caseId = "DEV-NATIVE-001";
  const manifestPath = join(root, "development", "cases", `${caseId}.json`);
  const assetRoot = `development/assets/${caseId}`;
  const buildReceipt = `receipts/build/${caseId}.json`;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.fixture_status = "implemented";
  manifest.implementation = {
    runnable: true,
    asset_root: assetRoot,
    missing_assets: [],
    receipts: {
      build: buildReceipt,
      backend_qualification: null,
      verification_ledger: null,
    },
    verified_at: null,
  };
  writeJson(manifestPath, manifest);
  const manifestSha256 = createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
  rmSync(join(root, assetRoot), { force: true, recursive: true });
  mkdirSync(join(root, assetRoot), { recursive: true });
  mkdirSync(dirname(join(root, buildReceipt)), { recursive: true });
  writeJson(join(root, buildReceipt), {
    schema_version: "runparity.fixture-build-receipt/v1",
    case_id: caseId,
    manifest_sha256: manifestSha256,
    asset_root: assetRoot,
    asset_inventory_schema_version: "runparity.asset-inventory/v1",
    asset_inventory_sha256: "a".repeat(64),
    asset_inventory_stability: "unqualified_live_tree",
    entrypoint: { kind: "node_script", path: "fixture/load-native-addon.mjs" },
    status: "passed",
    created_at: "2026-08-15T00:00:00Z",
  });
  const indexPath = join(root, "development", "index.json");
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  index.status = "in_progress";
  writeJson(indexPath, index);

  const result = runValidator(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /asset evidence verifier rejected tree.*regular file/i);
  assert.match(result.stderr, /declared fixture_status implemented.*derived status scaffold/i);
  assert.doesNotMatch(result.stdout, /[1-9][0-9]* implemented/i);
});

test("a recomputed non-empty Node asset can derive implemented without proof", (t) => {
  const root = copiedFixtureRoot(t);
  const caseId = "DEV-NATIVE-001";
  const assetRoot = `development/assets/${caseId}`;
  const buildReceipt = `receipts/build/${caseId}.json`;
  const entrypoint = "fixture/load-native-addon.mjs";
  const manifestPath = join(root, "development", "cases", `${caseId}.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.fixture_status = "implemented";
  manifest.implementation = {
    runnable: true,
    asset_root: assetRoot,
    missing_assets: [],
    receipts: {
      build: buildReceipt,
      backend_qualification: null,
      verification_ledger: null,
    },
    verified_at: null,
  };
  writeJson(manifestPath, manifest);

  const assetPath = join(root, assetRoot);
  mkdirSync(dirname(join(assetPath, entrypoint)), { recursive: true });
  writeFileSync(join(assetPath, entrypoint), "process.exitCode = 23;\n", "utf8");
  const inventory = inspectAssetTree(assetPath);
  mkdirSync(dirname(join(root, buildReceipt)), { recursive: true });
  writeJson(join(root, buildReceipt), {
    schema_version: "runparity.fixture-build-receipt/v1",
    case_id: caseId,
    manifest_sha256: createHash("sha256").update(readFileSync(manifestPath)).digest("hex"),
    asset_root: assetRoot,
    asset_inventory_schema_version: inventory.inventory.schema_version,
    asset_inventory_sha256: inventory.sha256,
    asset_inventory_stability: inventory.source_stability,
    entrypoint: { kind: "node_script", path: entrypoint },
    status: "passed",
    created_at: "2026-08-16T00:00:00Z",
  });
  const indexPath = join(root, "development", "index.json");
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  index.status = "in_progress";
  writeJson(indexPath, index);

  const result = runValidator(root);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 scaffold, 5 implemented, 11 verified/i);
});

test("the checked entrypoint must be the script declared by planned_target_argv", (t) => {
  const root = copiedFixtureRoot(t);
  const caseId = "DEV-NEG-002";
  const assetRoot = `development/assets/${caseId}`;
  const assetPath = join(root, assetRoot);
  const buildReceipt = `receipts/build/${caseId}.json`;
  const receiptPath = join(root, buildReceipt);
  writeFileSync(join(assetPath, "decoy.mjs"), "process.exitCode = 0;\n", "utf8");
  const inventory = inspectAssetTree(assetPath);
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  receipt.asset_inventory_sha256 = inventory.sha256;
  receipt.entrypoint = { kind: "node_script", path: "decoy.mjs" };
  writeJson(receiptPath, receipt);

  const result = runValidator(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /entrypoint.*planned_target_argv/i);
  assert.doesNotMatch(result.stdout, /1 implemented/i);
});

function promoteNativeCaseWithArgv(root, argv, mutateAssets = null) {
  const caseId = "DEV-NATIVE-001";
  const assetRoot = `development/assets/${caseId}`;
  const buildReceipt = `receipts/build/${caseId}.json`;
  const entrypoint = "fixture/load-native-addon.mjs";
  const manifestPath = join(root, "development", "cases", `${caseId}.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.fixture_status = "implemented";
  manifest.scenario.planned_target_argv = argv;
  manifest.implementation = {
    runnable: true,
    asset_root: assetRoot,
    missing_assets: [],
    receipts: {
      build: buildReceipt,
      backend_qualification: null,
      verification_ledger: null,
    },
    verified_at: null,
  };
  writeJson(manifestPath, manifest);
  const assetPath = join(root, assetRoot);
  mkdirSync(dirname(join(assetPath, entrypoint)), { recursive: true });
  writeFileSync(join(assetPath, entrypoint), "process.exitCode = 23;\n", "utf8");
  if (mutateAssets !== null) mutateAssets(assetPath);
  const inventory = inspectAssetTree(assetPath);
  mkdirSync(dirname(join(root, buildReceipt)), { recursive: true });
  writeJson(join(root, buildReceipt), {
    schema_version: "runparity.fixture-build-receipt/v1",
    case_id: caseId,
    manifest_sha256: createHash("sha256").update(readFileSync(manifestPath)).digest("hex"),
    asset_root: assetRoot,
    asset_inventory_schema_version: inventory.inventory.schema_version,
    asset_inventory_sha256: inventory.sha256,
    asset_inventory_stability: inventory.source_stability,
    entrypoint: { kind: "node_script", path: entrypoint },
    status: "passed",
    created_at: "2026-08-16T00:00:00Z",
  });
  const indexPath = join(root, "development", "index.json");
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  index.status = "in_progress";
  writeJson(indexPath, index);
}

test("a launcher-mediated argv path token can bind the entrypoint", (t) => {
  const root = copiedFixtureRoot(t);
  promoteNativeCaseWithArgv(root, ["pnpm", "exec", "node", "fixture/load-native-addon.mjs"]);

  const result = runValidator(root);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /5 implemented, 11 verified/i);
});

test("a launcher lifecycle script can bind the entrypoint through an asset-root package.json", (t) => {
  const root = copiedFixtureRoot(t);
  promoteNativeCaseWithArgv(root, ["npm", "run", "fixture:assert-config"], (assetPath) => {
    writeJson(join(assetPath, "package.json"), {
      name: "runparity-fixture-binding-test",
      private: true,
      scripts: { "fixture:assert-config": "fixture/load-native-addon.mjs" },
    });
  });

  const result = runValidator(root);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /5 implemented, 11 verified/i);
});

test("a lifecycle argv with npm config flags around the script name still binds", (t) => {
  const lifecyclePackageJson = (assetPath) => {
    writeJson(join(assetPath, "package.json"), {
      name: "runparity-fixture-binding-test",
      private: true,
      scripts: { "fixture:assert-config": "fixture/load-native-addon.mjs" },
    });
  };
  for (const argv of [
    ["npm", "run", "fixture:assert-config", "--fund=false"],
    ["npm", "--fund=false", "run", "fixture:assert-config"],
    ["pnpm", "run", "fixture:assert-config", "--stream"],
  ]) {
    const root = copiedFixtureRoot(t);
    promoteNativeCaseWithArgv(root, argv, lifecyclePackageJson);

    const result = runValidator(root);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /5 implemented, 11 verified/i);
  }
});

test("a lifecycle argv with a non-flag token outside the script name fails closed", (t) => {
  const root = copiedFixtureRoot(t);
  promoteNativeCaseWithArgv(
    root,
    ["npm", "run", "fixture:assert-config", "not-a-flag"],
    (assetPath) => {
      writeJson(join(assetPath, "package.json"), {
        name: "runparity-fixture-binding-test",
        private: true,
        scripts: { "fixture:assert-config": "fixture/load-native-addon.mjs" },
      });
    },
  );

  const result = runValidator(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /entrypoint.*planned_target_argv/i);
});

test("the node-prefixed lifecycle script value binds and richer values fail closed", (t) => {
  const withScriptValue = (scriptValue) => (assetPath) => {
    writeJson(join(assetPath, "package.json"), {
      name: "runparity-fixture-binding-test",
      private: true,
      scripts: { "fixture:assert-config": scriptValue },
    });
  };
  const okRoot = copiedFixtureRoot(t);
  promoteNativeCaseWithArgv(
    okRoot,
    ["npm", "run", "fixture:assert-config"],
    withScriptValue("node fixture/load-native-addon.mjs"),
  );
  const okResult = runValidator(okRoot);
  assert.equal(okResult.status, 0, okResult.stderr);
  assert.match(okResult.stdout, /5 implemented, 11 verified/i);

  for (const scriptValue of [
    "node fixture/load-native-addon.mjs --flag",
    "NODE_ENV=test node fixture/load-native-addon.mjs",
    "node /absolute/load-native-addon.mjs",
  ]) {
    const root = copiedFixtureRoot(t);
    promoteNativeCaseWithArgv(
      root,
      ["npm", "run", "fixture:assert-config"],
      withScriptValue(scriptValue),
    );
    const result = runValidator(root);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /entrypoint.*planned_target_argv/i);
  }
});

test("launcher argv binding fails closed when the path token is ambiguous", (t) => {
  const root = copiedFixtureRoot(t);
  promoteNativeCaseWithArgv(root, [
    "pnpm",
    "exec",
    "node",
    "fixture/load-native-addon.mjs",
    "fixture/load-native-addon.mjs",
  ]);

  const result = runValidator(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /entrypoint.*planned_target_argv/i);
});

test("lifecycle binding fails closed without exactly one asset-root package.json", (t) => {
  for (const mutateAssets of [
    null,
    (assetPath) => {
      writeJson(join(assetPath, "package.json"), {
        name: "runparity-fixture-binding-test",
        private: true,
        scripts: { "fixture:assert-config": "fixture/load-native-addon.mjs" },
      });
      mkdirSync(join(assetPath, "fixture", "nested"));
      writeJson(join(assetPath, "fixture", "nested", "package.json"), {
        name: "ambiguous-nested",
      });
    },
  ]) {
    const root = copiedFixtureRoot(t);
    promoteNativeCaseWithArgv(root, ["npm", "run", "fixture:assert-config"], mutateAssets);

    const result = runValidator(root);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /entrypoint.*planned_target_argv/i);
  }
});

test("lifecycle binding fails closed on escaping or argument-bearing script values", (t) => {
  for (const scriptValue of ["../outside.mjs", "fixture/load-native-addon.mjs --flag"]) {
    const root = copiedFixtureRoot(t);
    promoteNativeCaseWithArgv(root, ["npm", "run", "fixture:assert-config"], (assetPath) => {
      writeJson(join(assetPath, "package.json"), {
        name: "runparity-fixture-binding-test",
        private: true,
        scripts: { "fixture:assert-config": scriptValue },
      });
    });

    const result = runValidator(root);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /entrypoint.*planned_target_argv/i);
  }
});

test("an unsupported launcher cannot bind the entrypoint", (t) => {
  const root = copiedFixtureRoot(t);
  promoteNativeCaseWithArgv(root, ["sh", "-c", "fixture/load-native-addon.mjs"]);

  const result = runValidator(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /entrypoint.*planned_target_argv/i);
});

test("a build receipt hard-linked outside the fixture root is rejected", (t) => {
  const root = copiedFixtureRoot(t);
  const receiptPath = join(root, "receipts", "build", "DEV-NEG-002.json");
  const externalPath = join(dirname(root), "external-build-receipt.json");
  writeFileSync(externalPath, readFileSync(receiptPath));
  rmSync(receiptPath);
  linkSync(externalPath, receiptPath);

  const result = runValidator(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /build receipt.*hard.?link|link count/i);
});

test("receipt path strings cannot self-certify a supported fixture as verified", (t) => {
  const root = copiedFixtureRoot(t);
  const caseId = "DEV-PATH-001";
  const manifestPath = join(root, "development", "cases", `${caseId}.json`);
  const assetRoot = `development/assets/${caseId}`;
  const buildReceipt = `receipts/build/${caseId}.json`;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.fixture_status = "verified";
  manifest.implementation = {
    runnable: true,
    asset_root: assetRoot,
    missing_assets: [],
    receipts: {
      build: buildReceipt,
      backend_qualification: "receipts/backend/missing.json",
      verification_ledger: `receipts/ledger/${caseId}-missing.json`,
    },
    verified_at: "2026-08-15T00:00:00Z",
  };
  writeJson(manifestPath, manifest);
  const manifestSha256 = createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
  mkdirSync(join(root, assetRoot), { recursive: true });
  mkdirSync(dirname(join(root, buildReceipt)), { recursive: true });
  writeJson(join(root, buildReceipt), {
    schema_version: "runparity.fixture-build-receipt/v1",
    case_id: caseId,
    manifest_sha256: manifestSha256,
    asset_root: assetRoot,
    asset_inventory_sha256: "a".repeat(64),
    status: "passed",
    created_at: "2026-08-15T00:00:00Z",
  });
  const indexPath = join(root, "development", "index.json");
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  index.status = "in_progress";
  writeJson(indexPath, index);

  const result = runValidator(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(
    result.stderr,
    /backend qualification receipt is missing|verification ledger is missing/i,
  );
});

test("arbitrary JSON files cannot serve as qualification and ledger receipts", (t) => {
  const root = copiedFixtureRoot(t);
  const caseId = "DEV-PATH-001";
  const manifestPath = join(root, "development", "cases", `${caseId}.json`);
  const assetRoot = `development/assets/${caseId}`;
  const buildReceipt = `receipts/build/${caseId}.json`;
  const backendReceipt = "receipts/backend/linux-rootless.json";
  const verificationLedger = `receipts/ledger/${caseId}.json`;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.fixture_status = "verified";
  manifest.implementation = {
    runnable: true,
    asset_root: assetRoot,
    missing_assets: [],
    receipts: {
      build: buildReceipt,
      backend_qualification: backendReceipt,
      verification_ledger: verificationLedger,
    },
    verified_at: "2026-08-15T00:00:00Z",
  };
  writeJson(manifestPath, manifest);
  const manifestSha256 = createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
  mkdirSync(join(root, assetRoot), { recursive: true });
  mkdirSync(dirname(join(root, buildReceipt)), { recursive: true });
  mkdirSync(dirname(join(root, backendReceipt)), { recursive: true });
  mkdirSync(dirname(join(root, verificationLedger)), { recursive: true });
  writeJson(join(root, buildReceipt), {
    schema_version: "runparity.fixture-build-receipt/v1",
    case_id: caseId,
    manifest_sha256: manifestSha256,
    asset_root: assetRoot,
    asset_inventory_sha256: "a".repeat(64),
    status: "passed",
    created_at: "2026-08-15T00:00:00Z",
  });
  writeJson(join(root, backendReceipt), {});
  writeJson(join(root, verificationLedger), {});
  const indexPath = join(root, "development", "index.json");
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  index.status = "in_progress";
  writeJson(indexPath, index);

  const result = runValidator(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /invalid backend qualification receipt|invalid verification ledger/i);
});

test("a verification ledger must bind the manifest and upstream receipt digests", (t) => {
  const root = copiedFixtureRoot(t);
  const caseId = "DEV-PATH-001";
  const manifestPath = join(root, "development", "cases", `${caseId}.json`);
  const assetRoot = `development/assets/${caseId}`;
  const buildReceipt = `receipts/build/${caseId}.json`;
  const backendReceipt = "receipts/backend/linux-rootless.json";
  const verificationLedger = `receipts/ledger/${caseId}.json`;
  const verifiedAt = "2026-08-15T00:00:00Z";
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.fixture_status = "verified";
  manifest.implementation = {
    runnable: true,
    asset_root: assetRoot,
    missing_assets: [],
    receipts: {
      build: buildReceipt,
      backend_qualification: backendReceipt,
      verification_ledger: verificationLedger,
    },
    verified_at: verifiedAt,
  };
  writeJson(manifestPath, manifest);
  const manifestSha256 = createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
  mkdirSync(join(root, assetRoot), { recursive: true });
  mkdirSync(dirname(join(root, buildReceipt)), { recursive: true });
  mkdirSync(dirname(join(root, backendReceipt)), { recursive: true });
  mkdirSync(dirname(join(root, verificationLedger)), { recursive: true });
  writeJson(join(root, buildReceipt), {
    schema_version: "runparity.fixture-build-receipt/v1",
    case_id: caseId,
    manifest_sha256: manifestSha256,
    asset_root: assetRoot,
    asset_inventory_sha256: "a".repeat(64),
    status: "passed",
    created_at: verifiedAt,
  });
  writeJson(join(root, backendReceipt), {
    schema_version: "runparity.backend-qualification-receipt/v1",
    backend: "linux_rootless_oci",
    platform: { os: "linux", arch: "x64", libc: "glibc" },
    image_digest: `sha256:${"b".repeat(64)}`,
    policy_digest: `sha256:${"c".repeat(64)}`,
    status: "qualified",
    qualified_at: verifiedAt,
  });
  writeJson(join(root, verificationLedger), {
    schema_version: "runparity.fixture-verification-ledger/v1",
    ledger_kind: "a1_b_a2",
    case_id: caseId,
    manifest_sha256: "0".repeat(64),
    build_receipt_sha256: "0".repeat(64),
    backend_qualification_sha256: "0".repeat(64),
    repetitions: 3,
    status: "passed",
    verified_at: verifiedAt,
  });
  const indexPath = join(root, "development", "index.json");
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  index.status = "in_progress";
  writeJson(indexPath, index);

  const result = runValidator(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /manifest_sha256 mismatch|build_receipt_sha256 mismatch/i);
});

test("hard negatives may declare non-actionable inconclusive and partial outcomes", (t) => {
  const root = copiedFixtureRoot(t);
  const expectedVerdicts = new Map([
    ["DEV-NEG-001", "PARTIAL_EVIDENCE"],
    ["DEV-NEG-002", "PARTIAL_EVIDENCE"],
  ]);
  for (const [caseId, verdict] of expectedVerdicts) {
    const manifestPath = join(root, "development", "cases", `${caseId}.json`);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.expected_terminal_verdict, verdict);
    assert.equal(manifest.expected_refusal, null);
  }

  const result = runValidator(root);

  assert.equal(result.status, 0, result.stderr);
});

test("an out-of-scope refusal cannot also be a timeout-cleanup probe", (t) => {
  const root = copiedFixtureRoot(t);
  const manifestPath = join(root, "development", "cases", "DEV-OOS-002.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.expected_terminal_verdict = "REFUSED_OUT_OF_SCOPE";
  manifest.safety_expectations.timeout_cleanup_probe = true;
  writeJson(manifestPath, manifest);

  const result = runValidator(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /timeout.*ABORTED_SAFETY|refusal.*timeout/i);
});

test("DEV-CONFIG-001 must use a safe boolean and an npm lifecycle assertion", (t) => {
  const root = copiedFixtureRoot(t);
  const manifestPath = join(root, "development", "cases", "DEV-CONFIG-001.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.allowed_typed_intervention.target = "npm.registry";
  manifest.allowed_typed_intervention.parameters.key = "npm_config_registry";
  manifest.scenario.planned_target_argv = ["npm", "config", "get", "registry"];
  writeJson(manifestPath, manifest);

  const result = runValidator(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /CONFIG-001.*safe boolean|CONFIG-001.*lifecycle assertion/i);
});

test("every scaffold explicitly declares empty build backend and ledger receipt slots", (t) => {
  const root = copiedFixtureRoot(t);
  const manifestPath = join(root, "development", "cases", "DEV-NATIVE-001.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  delete manifest.implementation.receipts;
  writeJson(manifestPath, manifest);

  const result = runValidator(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /receipt slots/i);
});

test("linked self-authored receipts cannot derive verified: the independent evidence verifier rejects them", (t) => {
  const root = copiedFixtureRoot(t);
  const caseId = "DEV-PATH-001";
  const verifiedAt = "2026-08-15T00:00:00Z";
  const manifestPath = join(root, "development", "cases", `${caseId}.json`);
  const assetRoot = `development/assets/${caseId}`;
  const buildReceipt = `receipts/build/${caseId}.json`;
  const backendReceipt = "receipts/backend/linux-rootless.json";
  const verificationLedger = `receipts/ledger/${caseId}.json`;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.fixture_status = "verified";
  manifest.implementation = {
    runnable: true,
    asset_root: assetRoot,
    missing_assets: [],
    receipts: {
      build: buildReceipt,
      backend_qualification: backendReceipt,
      verification_ledger: verificationLedger,
    },
    verified_at: verifiedAt,
  };
  writeJson(manifestPath, manifest);
  const manifestSha256 = createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
  mkdirSync(join(root, assetRoot), { recursive: true });
  mkdirSync(dirname(join(root, buildReceipt)), { recursive: true });
  mkdirSync(dirname(join(root, backendReceipt)), { recursive: true });
  mkdirSync(dirname(join(root, verificationLedger)), { recursive: true });
  writeJson(join(root, buildReceipt), {
    schema_version: "runparity.fixture-build-receipt/v1",
    case_id: caseId,
    manifest_sha256: manifestSha256,
    asset_root: assetRoot,
    asset_inventory_sha256: "a".repeat(64),
    status: "passed",
    created_at: verifiedAt,
  });
  writeJson(join(root, backendReceipt), {
    schema_version: "runparity.backend-qualification-receipt/v1",
    backend: "linux_rootless_oci",
    platform: { os: "linux", arch: "x64", libc: "glibc" },
    image_digest: `sha256:${"b".repeat(64)}`,
    policy_digest: `sha256:${"c".repeat(64)}`,
    status: "qualified",
    qualified_at: verifiedAt,
  });
  const buildReceiptSha256 = createHash("sha256")
    .update(readFileSync(join(root, buildReceipt)))
    .digest("hex");
  const backendReceiptSha256 = createHash("sha256")
    .update(readFileSync(join(root, backendReceipt)))
    .digest("hex");
  writeJson(join(root, verificationLedger), {
    schema_version: "runparity.fixture-verification-ledger/v1",
    ledger_kind: "a1_b_a2",
    case_id: caseId,
    manifest_sha256: manifestSha256,
    build_receipt_sha256: buildReceiptSha256,
    backend_qualification_sha256: backendReceiptSha256,
    repetitions: 3,
    status: "passed",
    verified_at: verifiedAt,
  });
  const indexPath = join(root, "development", "index.json");
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  index.status = "in_progress";
  writeJson(indexPath, index);

  const result = runValidator(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /backend qualification evidence: /i);
  assert.match(result.stderr, /verification ledger evidence: /i);
  assert.match(result.stderr, /expected 3 sequences, found 0/i);
  assert.match(result.stderr, /declared fixture_status verified.*derived status scaffold/i);
  assert.doesNotMatch(result.stdout, /[1-9][0-9]* verified/i);
});

test("a proof-ineligible Host case cannot attach a Linux backend receipt", (t) => {
  const root = copiedFixtureRoot(t);
  const caseId = "DEV-NEG-001";
  const verifiedAt = "2026-08-15T00:00:00Z";
  const manifestPath = join(root, "development", "cases", `${caseId}.json`);
  const assetRoot = `development/assets/${caseId}`;
  const buildReceipt = `receipts/build/${caseId}.json`;
  const backendReceipt = "receipts/backend/linux-rootless.json";
  const verificationLedger = `receipts/ledger/${caseId}.json`;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.fixture_status = "verified";
  manifest.implementation = {
    runnable: true,
    asset_root: assetRoot,
    missing_assets: [],
    receipts: {
      build: buildReceipt,
      backend_qualification: backendReceipt,
      verification_ledger: verificationLedger,
    },
    verified_at: verifiedAt,
  };
  writeJson(manifestPath, manifest);
  const manifestSha256 = createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
  mkdirSync(join(root, assetRoot), { recursive: true });
  mkdirSync(dirname(join(root, buildReceipt)), { recursive: true });
  mkdirSync(dirname(join(root, backendReceipt)), { recursive: true });
  mkdirSync(dirname(join(root, verificationLedger)), { recursive: true });
  writeJson(join(root, buildReceipt), {
    schema_version: "runparity.fixture-build-receipt/v1",
    case_id: caseId,
    manifest_sha256: manifestSha256,
    asset_root: assetRoot,
    asset_inventory_sha256: "a".repeat(64),
    status: "passed",
    created_at: verifiedAt,
  });
  writeJson(join(root, backendReceipt), {
    schema_version: "runparity.backend-qualification-receipt/v1",
    backend: "linux_rootless_oci",
    platform: { os: "linux", arch: "x64", libc: "glibc" },
    image_digest: `sha256:${"b".repeat(64)}`,
    policy_digest: `sha256:${"c".repeat(64)}`,
    status: "qualified",
    qualified_at: verifiedAt,
  });
  const buildReceiptSha256 = createHash("sha256")
    .update(readFileSync(join(root, buildReceipt)))
    .digest("hex");
  writeJson(join(root, verificationLedger), {
    schema_version: "runparity.fixture-verification-ledger/v1",
    ledger_kind: "host_observation",
    case_id: caseId,
    manifest_sha256: manifestSha256,
    build_receipt_sha256: buildReceiptSha256,
    backend_qualification_sha256: null,
    repetitions: 3,
    status: "passed",
    verified_at: verifiedAt,
  });
  const indexPath = join(root, "development", "index.json");
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  index.status = "in_progress";
  writeJson(indexPath, index);

  const result = runValidator(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /proof-ineligible.*backend.*null|Host.*backend.*null/i);
});
