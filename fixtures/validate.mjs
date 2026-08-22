import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { inspectAssetTree } from "./lib/asset-inventory.mjs";
import {
  manifestEvidenceSha256,
  verifyBackendQualificationReceipt,
  verifyVerificationLedger as verifyLedgerEvidence,
} from "./lib/evidence-verifier.mjs";

const defaultFixtureRoot = dirname(fileURLToPath(import.meta.url));
const fixtureRootArgument = process.argv.indexOf("--fixture-root");
const fixtureRoot =
  fixtureRootArgument === -1
    ? defaultFixtureRoot
    : resolve(process.argv[fixtureRootArgument + 1] ?? "");
const failures = [];
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const UTC_TIMESTAMP_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/;
const MAX_DIAGNOSTIC_LENGTH = 2048;

function isDiagnosticControl(codePoint) {
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x61c ||
    codePoint === 0xad ||
    codePoint === 0x34f ||
    codePoint === 0x180e ||
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    codePoint === 0x200b ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||
    (codePoint >= 0x206a && codePoint <= 0x206f) ||
    codePoint === 0x2060 ||
    codePoint === 0x2028 ||
    codePoint === 0x2029 ||
    (codePoint >= 0xfff9 && codePoint <= 0xfffb) ||
    codePoint === 0xfeff ||
    codePoint === 0xe0001 ||
    (codePoint >= 0xe0020 && codePoint <= 0xe007f)
  );
}

function sanitizeDiagnostic(value) {
  let escaped = "";
  for (const character of String(value)) {
    const codePoint = character.codePointAt(0);
    const rendered = isDiagnosticControl(codePoint)
      ? codePoint <= 0xffff
        ? `\\u${codePoint.toString(16).padStart(4, "0")}`
        : `\\u{${codePoint.toString(16)}}`
      : character;
    if (escaped.length + rendered.length > MAX_DIAGNOSTIC_LENGTH) {
      return `${escaped}...[truncated]`;
    }
    escaped += rendered;
  }
  return escaped;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    failures.push(
      `${path}: cannot parse JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

function isContained(root, candidate) {
  const pathFromRoot = relative(resolve(root), resolve(candidate));
  return pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`);
}

function isRealContained(root, candidate) {
  try {
    return isContained(realpathSync.native(root), realpathSync.native(candidate));
  } catch {
    return false;
  }
}

function checkNodeSyntax(entrypointPath, workingDirectory) {
  const result = spawnSync(process.execPath, ["--check", entrypointPath], {
    cwd: workingDirectory,
    encoding: "utf8",
    env: {},
    maxBuffer: 64 * 1024,
    shell: false,
    timeout: 1000,
    windowsHide: true,
  });
  return result.error === undefined && result.signal === null && result.status === 0;
}

const LIFECYCLE_SCRIPT_NAME_PATTERN = /^[A-Za-z0-9:_.-]+$/u;
const LIFECYCLE_SCRIPT_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/u;
const LIFECYCLE_SCRIPT_NODE_FORM_PATTERN = /^node\s+[A-Za-z0-9._/-]+$/u;

function lifecycleScriptBindingMatches(assetPath, observedInventory, scriptName, entrypointPath) {
  if (typeof scriptName !== "string" || !LIFECYCLE_SCRIPT_NAME_PATTERN.test(scriptName)) {
    return false;
  }
  const packageJsonFiles = observedInventory.inventory.files.filter(
    (file) => file.path === "package.json" || file.path.endsWith("/package.json"),
  );
  if (packageJsonFiles.length !== 1 || packageJsonFiles[0].path !== "package.json") {
    return false;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(readFileSync(resolve(assetPath, "package.json"), "utf8"));
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const scriptValue = parsed?.scripts?.[scriptName];
  // A lifecycle script may be a bare relative path or the canonical
  // `node <relative path>` form real npm/pnpm launchers can execute through a
  // shell on every platform. Anything else (flags, &&, variables) fails closed.
  let scriptPathValue = null;
  if (typeof scriptValue === "string" && scriptValue.length > 0 && !isAbsolute(scriptValue)) {
    if (LIFECYCLE_SCRIPT_PATH_PATTERN.test(scriptValue)) {
      scriptPathValue = scriptValue;
    } else if (LIFECYCLE_SCRIPT_NODE_FORM_PATTERN.test(scriptValue)) {
      scriptPathValue = scriptValue.slice("node ".length);
    }
  }
  if (scriptPathValue === null) return false;
  const resolvedScriptPath = resolve(assetPath, scriptPathValue);
  return (
    isContained(assetPath, resolvedScriptPath) &&
    resolvedScriptPath === resolve(assetPath, entrypointPath)
  );
}

function resolveEntrypointBinding(plannedTargetArgv, entrypointPath, assetPath, observedInventory) {
  if (!Array.isArray(plannedTargetArgv) || plannedTargetArgv.length === 0) return null;
  const launcher = plannedTargetArgv[0];
  if (launcher === "node") {
    return plannedTargetArgv[1] === entrypointPath ? "direct_argv_script" : null;
  }
  if (launcher !== "pnpm" && launcher !== "npm") return null;
  const occurrences = plannedTargetArgv.filter((token) => token === entrypointPath).length;
  if (occurrences === 1 && plannedTargetArgv.indexOf(entrypointPath) >= 1) {
    return "launcher_argv_script";
  }
  // Lifecycle form: [launcher, ...npm flags, "run", <script name>, ...npm flags].
  // Real npm and pnpm accept config flags before the script name and trailing
  // config flags after it; any other token shape fails closed.
  const runIndex = plannedTargetArgv.indexOf("run");
  if (runIndex >= 1) {
    const scriptName = plannedTargetArgv[runIndex + 1];
    const onlyConfigFlags = (tokens) =>
      tokens.every((token) => typeof token === "string" && /^-/u.test(token));
    if (
      typeof scriptName === "string" &&
      onlyConfigFlags(plannedTargetArgv.slice(1, runIndex)) &&
      onlyConfigFlags(plannedTargetArgv.slice(runIndex + 2)) &&
      lifecycleScriptBindingMatches(assetPath, observedInventory, scriptName, entrypointPath)
    ) {
      return "launcher_lifecycle_script";
    }
  }
  return null;
}

function validateBuildReceipt(item, manifestPath) {
  const receipts = item?.implementation?.receipts;
  const buildReceipt = receipts?.build ?? null;
  if (buildReceipt === null) return false;
  let valid = true;
  const receiptCheck = (condition, message) => {
    check(condition, `${item.case_id}: ${message}`);
    if (!condition) valid = false;
  };
  receiptCheck(typeof buildReceipt === "string", "build receipt reference must be a string");
  if (typeof buildReceipt !== "string") return false;
  const receiptPath = resolve(fixtureRoot, buildReceipt);
  const expectedDirectory = resolve(fixtureRoot, "receipts", "build");
  receiptCheck(
    isContained(expectedDirectory, receiptPath),
    "build receipt must stay inside receipts/build",
  );
  receiptCheck(existsSync(receiptPath), `build receipt is missing: ${buildReceipt}`);
  if (!valid) return false;
  receiptCheck(
    isRealContained(expectedDirectory, receiptPath),
    "build receipt canonical path escapes receipts/build",
  );
  const receiptMetadata = lstatSync(receiptPath);
  receiptCheck(
    receiptMetadata.isFile() && !receiptMetadata.isSymbolicLink(),
    "build receipt must be a regular non-symlink file",
  );
  receiptCheck(receiptMetadata.nlink === 1, "build receipt must have link count one");
  if (!valid) return false;
  const receipt = readJson(receiptPath);
  if (receipt === null) return false;
  receiptCheck(
    receipt.schema_version === "runparity.fixture-build-receipt/v1",
    "invalid build receipt schema_version",
  );
  receiptCheck(
    Object.keys(receipt).sort().join(",") ===
      "asset_inventory_schema_version,asset_inventory_sha256,asset_inventory_stability,asset_root,case_id,created_at,entrypoint,manifest_sha256,schema_version,status",
    "build receipt must contain exactly the versioned inventory, entrypoint, binding, and status fields",
  );
  receiptCheck(receipt.case_id === item.case_id, "build receipt case_id mismatch");
  const manifestSha256 = createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
  receiptCheck(
    receipt.manifest_sha256 === manifestSha256,
    "build receipt manifest_sha256 mismatch",
  );
  receiptCheck(
    receipt.asset_root === item.implementation?.asset_root,
    "build receipt asset_root mismatch",
  );
  receiptCheck(
    typeof receipt.asset_inventory_sha256 === "string" &&
      SHA256_PATTERN.test(receipt.asset_inventory_sha256),
    "build receipt needs a lowercase SHA-256 asset inventory digest",
  );
  receiptCheck(receipt.status === "passed", "build receipt status must be passed");
  receiptCheck(
    typeof receipt.created_at === "string" && UTC_TIMESTAMP_PATTERN.test(receipt.created_at),
    "build receipt created_at must be UTC",
  );
  const assetRoot = item.implementation?.asset_root;
  let assetPath = null;
  receiptCheck(typeof assetRoot === "string", "implemented asset_root must be a string");
  if (typeof assetRoot === "string") {
    assetPath = resolve(fixtureRoot, assetRoot);
    const expectedAssetDirectory = resolve(fixtureRoot, "development", "assets");
    receiptCheck(
      isContained(expectedAssetDirectory, assetPath),
      "asset_root must stay inside development/assets",
    );
    receiptCheck(existsSync(assetPath), `asset_root is missing: ${assetRoot}`);
    if (existsSync(assetPath)) {
      receiptCheck(
        isRealContained(expectedAssetDirectory, assetPath),
        "asset_root canonical path escapes development/assets",
      );
      const assetMetadata = lstatSync(assetPath);
      receiptCheck(
        assetMetadata.isDirectory() && !assetMetadata.isSymbolicLink(),
        "asset_root must be a regular non-symlink directory",
      );
    }
  }
  if (!valid || assetPath === null) return false;

  let observedInventory;
  try {
    observedInventory = inspectAssetTree(assetPath);
  } catch (error) {
    receiptCheck(
      false,
      `asset evidence verifier rejected tree: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
  receiptCheck(
    receipt.asset_inventory_schema_version === observedInventory.inventory.schema_version,
    "asset_inventory_schema_version mismatch",
  );
  receiptCheck(
    receipt.asset_inventory_sha256 === observedInventory.sha256,
    "asset_inventory_sha256 mismatch",
  );
  receiptCheck(
    receipt.asset_inventory_stability === observedInventory.source_stability &&
      observedInventory.source_stability === "unqualified_live_tree",
    "asset inventory must disclose unqualified_live_tree stability",
  );
  const entrypoint = receipt.entrypoint;
  receiptCheck(
    typeof entrypoint === "object" &&
      entrypoint !== null &&
      !Array.isArray(entrypoint) &&
      Object.keys(entrypoint).sort().join(",") === "kind,path",
    "entrypoint must contain exactly kind and path",
  );
  const entrypointPath = entrypoint?.path;
  receiptCheck(entrypoint?.kind === "node_script", "entrypoint kind must be node_script");
  receiptCheck(
    typeof entrypointPath === "string" &&
      /^[A-Za-z0-9._/-]+\.mjs$/u.test(entrypointPath) &&
      !entrypointPath.split("/").includes("..") &&
      observedInventory.inventory.files.some((file) => file.path === entrypointPath),
    "entrypoint path must name an inventoried .mjs file",
  );
  const plannedTargetArgv = item.scenario?.planned_target_argv;
  receiptCheck(
    resolveEntrypointBinding(plannedTargetArgv, entrypointPath, assetPath, observedInventory) !==
      null,
    "entrypoint must match the Node script declared by scenario.planned_target_argv (direct argv[1], exactly one launcher-argv path token, or the launcher lifecycle script in an asset-root package.json)",
  );
  if (!valid || typeof entrypointPath !== "string") return false;
  const absoluteEntrypoint = resolve(assetPath, entrypointPath);
  receiptCheck(
    isRealContained(assetPath, absoluteEntrypoint),
    "entrypoint canonical path escapes asset_root",
  );
  if (!valid) return false;
  receiptCheck(
    checkNodeSyntax(absoluteEntrypoint, assetPath),
    "entrypoint must pass bounded node --check without execution",
  );
  let inventoryAfterSyntaxCheck;
  try {
    inventoryAfterSyntaxCheck = inspectAssetTree(assetPath);
  } catch (error) {
    receiptCheck(
      false,
      `asset evidence verifier rejected post-check tree: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
  receiptCheck(
    inventoryAfterSyntaxCheck.sha256 === observedInventory.sha256,
    "asset inventory changed during entrypoint syntax check",
  );
  return valid;
}

function readReceiptReference(item, key, directory, label) {
  const reference = item?.implementation?.receipts?.[key] ?? null;
  if (reference === null) return null;
  let valid = true;
  const receiptCheck = (condition, message) => {
    check(condition, `${item.case_id}: ${message}`);
    if (!condition) valid = false;
  };
  receiptCheck(typeof reference === "string", `${label} reference must be a string`);
  if (typeof reference !== "string") return null;
  const receiptPath = resolve(fixtureRoot, reference);
  const expectedDirectory = resolve(fixtureRoot, "receipts", directory);
  receiptCheck(
    isContained(expectedDirectory, receiptPath),
    `${label} must stay inside receipts/${directory}`,
  );
  receiptCheck(existsSync(receiptPath), `${label} is missing: ${reference}`);
  if (!valid) return null;
  receiptCheck(
    isRealContained(expectedDirectory, receiptPath),
    `${label} canonical path escapes receipts/${directory}`,
  );
  const metadata = lstatSync(receiptPath);
  receiptCheck(
    metadata.isFile() && !metadata.isSymbolicLink(),
    `${label} must be a regular non-symlink file`,
  );
  receiptCheck(metadata.nlink === 1, `${label} must have link count one`);
  if (!valid) return null;
  const receipt = readJson(receiptPath);
  receiptCheck(
    typeof receipt === "object" && receipt !== null && !Array.isArray(receipt),
    `${label} must contain a JSON object`,
  );
  return valid ? receipt : null;
}

function receiptDigest(item, key) {
  const reference = item?.implementation?.receipts?.[key] ?? null;
  if (typeof reference !== "string") return null;
  const receiptPath = resolve(fixtureRoot, reference);
  if (!existsSync(receiptPath)) return null;
  const directories = {
    build: "build",
    backend_qualification: "backend",
    verification_ledger: "ledger",
  };
  const directory = directories[key];
  if (
    directory === undefined ||
    !isRealContained(resolve(fixtureRoot, "receipts", directory), receiptPath)
  ) {
    return null;
  }
  return createHash("sha256").update(readFileSync(receiptPath)).digest("hex");
}

function validateBackendReceipt(item, receipt, receiptPath) {
  if (receipt === null) return false;
  let valid = true;
  const receiptCheck = (condition, message) => {
    check(condition, `${item.case_id}: invalid backend qualification receipt: ${message}`);
    if (!condition) valid = false;
  };
  receiptCheck(
    receipt.schema_version === "runparity.backend-qualification-receipt/v1",
    "wrong schema_version",
  );
  receiptCheck(receipt.backend === "linux_rootless_oci", "wrong backend");
  receiptCheck(receipt.status === "qualified", "status must be qualified");
  // Platform vocabulary note: manifests use Node's "x64" while OCI engine
  // facts use "amd64" for the same architecture; both are accepted here.
  const archMatches =
    receipt.platform?.arch === item.platform?.arch ||
    (receipt.platform?.arch === "amd64" && item.platform?.arch === "x64") ||
    (receipt.platform?.arch === "x64" && item.platform?.arch === "amd64");
  receiptCheck(
    receipt.platform?.os === "linux" &&
      archMatches &&
      receipt.platform?.libc === item.platform?.libc,
    "platform does not match the case",
  );
  receiptCheck(
    typeof receipt.image_digest === "string" && DIGEST_PATTERN.test(receipt.image_digest),
    "image_digest must be a SHA-256 digest",
  );
  receiptCheck(
    typeof receipt.policy_digest === "string" && DIGEST_PATTERN.test(receipt.policy_digest),
    "policy_digest must be a SHA-256 digest",
  );
  receiptCheck(
    typeof receipt.qualified_at === "string" && UTC_TIMESTAMP_PATTERN.test(receipt.qualified_at),
    "qualified_at must be UTC",
  );
  if (!valid) return false;
  // Independent evidence verification (protocol amendment, see
  // docs/adr/0005): every control must be demonstrated and the receipt must
  // bind its collected facts sidecar by canonical-JSON SHA-256.
  let facts = null;
  const factsPath =
    typeof receiptPath === "string" ? receiptPath.replace(/\.json$/u, ".facts.json") : null;
  if (factsPath !== null && existsSync(factsPath)) {
    try {
      facts = JSON.parse(readFileSync(factsPath, "utf8"));
    } catch {
      facts = null;
    }
  }
  const verdict = verifyBackendQualificationReceipt({ receipt, facts });
  for (const problem of verdict.problems) {
    check(false, `${item.case_id}: backend qualification evidence: ${problem}`);
  }
  return verdict.ok;
}

function validateVerificationLedger(
  item,
  receipt,
  manifestPath,
  buildReceiptSha256,
  backendReceiptSha256,
) {
  if (receipt === null) return false;
  const receiptCheck = (condition, message) => {
    check(condition, `${item.case_id}: invalid verification ledger: ${message}`);
  };
  const expectedKind = item.proof_eligibility?.eligible === true ? "a1_b_a2" : "host_observation";
  receiptCheck(
    receipt.schema_version === "runparity.fixture-verification-ledger/v1",
    "wrong schema_version",
  );
  receiptCheck(receipt.case_id === item.case_id, "case_id mismatch");
  receiptCheck(receipt.ledger_kind === expectedKind, `ledger_kind must be ${expectedKind}`);
  // Protocol amendment (docs/adr/0005): the ledger binds the manifest by its
  // EVIDENCE PROJECTION digest — canonical JSON minus the promotion fields —
  // so promoting status/receipts/verified_at does not invalidate the bound
  // evidence while any scenario/oracle/intervention change still does.
  let manifestForProjection = item;
  try {
    manifestForProjection = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    manifestForProjection = item;
  }
  const evidenceSha = manifestEvidenceSha256(manifestForProjection);
  receiptCheck(
    receipt.manifest_sha256 === evidenceSha,
    "manifest evidence-projection digest mismatch",
  );
  receiptCheck(
    buildReceiptSha256 !== null && receipt.build_receipt_sha256 === buildReceiptSha256,
    "build_receipt_sha256 mismatch",
  );
  const expectedBackendSha256 =
    item.proof_eligibility?.eligible === true ? backendReceiptSha256 : null;
  receiptCheck(
    receipt.backend_qualification_sha256 === expectedBackendSha256,
    "backend_qualification_sha256 mismatch",
  );
  receiptCheck(receipt.repetitions === 3, "repetitions must be 3");
  receiptCheck(receipt.status === "passed", "status must be passed");
  receiptCheck(
    typeof receipt.verified_at === "string" && UTC_TIMESTAMP_PATTERN.test(receipt.verified_at),
    "verified_at must be UTC",
  );
  receiptCheck(
    item.implementation?.verified_at === receipt.verified_at,
    "manifest verified_at must match the ledger",
  );
  // Independent evidence verification: signatures, oracle, and the single
  // intervention diff are recomputed from the embedded observations.
  const verdict = verifyLedgerEvidence({
    ledger: receipt,
    links: {
      manifestEvidenceSha256: evidenceSha,
      buildReceiptSha256,
      backendReceiptSha256,
    },
    item,
  });
  for (const problem of verdict.problems) {
    check(false, `${item.case_id}: verification ledger evidence: ${problem}`);
  }
  return verdict.ok;
}

function deriveFixtureStatus(item, receiptState) {
  if (!receiptState.build) return "scaffold";
  const backendRequired = item?.proof_eligibility?.eligible === true;
  if (receiptState.ledger && (!backendRequired || receiptState.backend)) {
    return "verified";
  }
  return "implemented";
}

const schemaPath = resolve(fixtureRoot, "schema", "case-manifest.schema.json");
const schema = readJson(schemaPath);
check(
  schema?.["$schema"] === "https://json-schema.org/draft/2020-12/schema",
  "case schema must declare Draft 2020-12",
);
check(
  schema?.["$id"] === "https://runparity.dev/schemas/fixture-case/v1.json",
  "case schema id changed unexpectedly",
);
let validateCaseManifest = null;
if (schema !== null) {
  try {
    validateCaseManifest = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  } catch (error) {
    failures.push(
      `case schema cannot compile: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const sourceRegistry = readJson(resolve(fixtureRoot, "evidence-sources.json"));
const sources = Array.isArray(sourceRegistry?.sources) ? sourceRegistry.sources : [];
const sourceIds = new Set();
for (const source of sources) {
  check(
    typeof source?.id === "string" && /^SRC-[A-Z0-9-]+$/.test(source.id),
    "invalid source evidence id",
  );
  check(!sourceIds.has(source?.id), `duplicate source evidence id: ${source?.id}`);
  sourceIds.add(source?.id);
  check(
    typeof source?.locator === "string" && source.locator.length > 0,
    `${source?.id}: missing locator`,
  );
}

const indexPath = resolve(fixtureRoot, "development", "index.json");
const index = readJson(indexPath);
const entries = Array.isArray(index?.cases) ? index.cases : [];
check(index?.schema_version === "runparity.fixture-suite/v1", "invalid suite schema_version");
check(index?.suite === "open-development-v1", "invalid suite id");
check(entries.length === 16, `expected 16 index entries, found ${entries.length}`);

const allowedCategories = new Set([
  "PATH_SHADOWING",
  "RUNTIME_MANAGER_DRIFT",
  "CONFIG_PRECEDENCE",
  "NATIVE_ABI_ARCH_MISMATCH",
]);
const allowedIntervention = new Map([
  ["PATH_SHADOWING", "path.prepend"],
  ["RUNTIME_MANAGER_DRIFT", "runtime.select"],
  ["CONFIG_PRECEDENCE", "config.set"],
  ["NATIVE_ABI_ARCH_MISMATCH", "nativeArtifact.select"],
]);
const expectedCounts = {
  supported_positive: 12,
  out_of_scope_environment: 2,
  hard_negative: 2,
};
const kindCounts = Object.fromEntries(Object.keys(expectedCounts).map((key) => [key, 0]));
const categoryCounts = Object.fromEntries([...allowedCategories].map((key) => [key, 0]));
const caseIds = new Set();
const derivedStatuses = [];
const casesDirectory = resolve(fixtureRoot, "development", "cases");

for (const entry of entries) {
  const manifestPath = resolve(fixtureRoot, "development", entry?.manifest ?? "");
  check(
    manifestPath.startsWith(`${casesDirectory}${sep}`),
    `${entry?.case_id ?? "unknown"}: manifest path escapes development/cases`,
  );
  check(existsSync(manifestPath), `${entry?.case_id ?? "unknown"}: manifest file is missing`);
  const item = readJson(manifestPath);
  if (item === null) continue;

  if (validateCaseManifest !== null && !validateCaseManifest(item)) {
    const schemaErrors = (validateCaseManifest.errors ?? []).slice(0, 8).map((error) => {
      const location = error.instancePath === "" ? "/" : error.instancePath;
      return `${location} ${error.keyword}: ${error.message ?? "schema constraint failed"}`;
    });
    const omitted = (validateCaseManifest.errors?.length ?? 0) - schemaErrors.length;
    failures.push(
      `${entry?.case_id ?? "unknown"}: JSON Schema validation failed: ${schemaErrors.join("; ")}${omitted > 0 ? `; ${omitted} more error(s) omitted` : ""}`,
    );
  }

  check(
    item["$schema"] === "../../schema/case-manifest.schema.json",
    `${item.case_id}: unexpected $schema reference`,
  );
  check(
    item.schema_version === "runparity.fixture-case/v1",
    `${item.case_id}: invalid schema_version`,
  );
  check(item.suite === "open-development-v1", `${item.case_id}: invalid suite`);
  check(item.case_id === entry.case_id, `${entry.case_id}: index and manifest IDs differ`);
  check(
    /^DEV-(PATH|RUNTIME|CONFIG|NATIVE|OOS|NEG)-[0-9]{3}$/.test(item.case_id),
    `${item.case_id}: invalid case id`,
  );
  check(!caseIds.has(item.case_id), `${item.case_id}: duplicate case id`);
  caseIds.add(item.case_id);

  check(Object.hasOwn(expectedCounts, item.kind), `${item.case_id}: invalid kind`);
  if (Object.hasOwn(kindCounts, item.kind)) kindCounts[item.kind] += 1;

  const backendReceipt = readReceiptReference(
    item,
    "backend_qualification",
    "backend",
    "backend qualification receipt",
  );
  const verificationLedger = readReceiptReference(
    item,
    "verification_ledger",
    "ledger",
    "verification ledger",
  );
  const backendReceiptReference = item.implementation?.receipts?.backend_qualification;
  const backendReceiptPath =
    typeof backendReceiptReference === "string"
      ? resolve(fixtureRoot, backendReceiptReference)
      : null;
  const buildReceiptSha256 = receiptDigest(item, "build");
  const backendReceiptSha256 = receiptDigest(item, "backend_qualification");
  const buildReceiptValid = validateBuildReceipt(item, manifestPath);
  const backendReceiptValid = validateBackendReceipt(item, backendReceipt, backendReceiptPath);
  const receiptState = {
    build: buildReceiptValid,
    backend: backendReceiptValid,
    ledger: validateVerificationLedger(
      item,
      verificationLedger,
      manifestPath,
      buildReceiptValid ? buildReceiptSha256 : null,
      backendReceiptValid ? backendReceiptSha256 : null,
    ),
  };
  const receiptSlots = item.implementation?.receipts;
  check(
    typeof receiptSlots === "object" &&
      receiptSlots !== null &&
      !Array.isArray(receiptSlots) &&
      Object.keys(receiptSlots).sort().join(",") ===
        "backend_qualification,build,verification_ledger",
    `${item.case_id}: implementation must declare exactly the build, backend_qualification, and verification_ledger receipt slots`,
  );
  if (item.proof_eligibility?.eligible === false) {
    check(
      receiptSlots?.backend_qualification === null,
      `${item.case_id}: proof-ineligible Host case backend_qualification receipt must remain null`,
    );
  }
  const derivedStatus = deriveFixtureStatus(item, receiptState);
  derivedStatuses.push(derivedStatus);
  check(
    item.fixture_status === derivedStatus,
    `${item.case_id}: declared fixture_status ${item.fixture_status} does not match derived status ${derivedStatus}`,
  );
  if (derivedStatus === "scaffold") {
    check(
      receiptSlots?.build === null &&
        receiptSlots?.backend_qualification === null &&
        receiptSlots?.verification_ledger === null,
      `${item.case_id}: scaffold receipt slots must all be null`,
    );
    check(item.implementation?.runnable === false, `${item.case_id}: scaffold cannot be runnable`);
    check(
      item.implementation?.asset_root === null,
      `${item.case_id}: scaffold asset_root must be null`,
    );
    check(
      Array.isArray(item.implementation?.missing_assets) &&
        item.implementation.missing_assets.length > 0,
      `${item.case_id}: scaffold must list missing assets`,
    );
    check(
      item.implementation?.verified_at === null,
      `${item.case_id}: scaffold cannot have verified_at`,
    );
  } else {
    check(
      item.implementation?.runnable === true,
      `${item.case_id}: ${derivedStatus} must be runnable`,
    );
    check(
      typeof item.implementation?.asset_root === "string" &&
        item.implementation.asset_root.length > 0,
      `${item.case_id}: ${derivedStatus} needs an asset_root`,
    );
    check(
      Array.isArray(item.implementation?.missing_assets) &&
        item.implementation.missing_assets.length === 0,
      `${item.case_id}: ${derivedStatus} cannot list missing assets`,
    );
    if (derivedStatus === "implemented") {
      check(
        item.implementation?.verified_at === null,
        `${item.case_id}: implemented cannot have verified_at`,
      );
    }
  }

  check(item.oracle?.frozen_across_arms === true, `${item.case_id}: oracle must be frozen`);
  check(
    Number.isInteger(item.oracle?.success?.exit_code),
    `${item.case_id}: oracle exit code is required`,
  );
  check(
    Array.isArray(item.scenario?.planned_target_argv) &&
      item.scenario.planned_target_argv.length > 0,
    `${item.case_id}: planned argv is required`,
  );
  check(
    typeof item.scenario?.expected_a_failure_signature === "string",
    `${item.case_id}: A failure signature is required`,
  );
  if (item.case_id === "DEV-CONFIG-001") {
    const safeBooleanTargets = new Map([
      ["npm.fund", "npm_config_fund"],
      ["npm.strict-peer-deps", "npm_config_strict_peer_deps"],
    ]);
    const interventionTarget = item.allowed_typed_intervention?.target;
    check(
      safeBooleanTargets.has(interventionTarget) &&
        item.allowed_typed_intervention?.parameters?.source === "environment" &&
        item.allowed_typed_intervention?.parameters?.key ===
          safeBooleanTargets.get(interventionTarget),
      `${item.case_id}: config precedence fixture must use a safe boolean environment key`,
    );
    check(
      item.scenario?.planned_target_argv?.[0] === "npm" &&
        item.scenario?.planned_target_argv?.[1] === "run" &&
        item.scenario?.planned_target_argv?.[2] === "fixture:assert-config",
      `${item.case_id}: target must be the npm fixture:assert-config lifecycle assertion`,
    );
  }

  check(
    Array.isArray(item.source_evidence_ids) && item.source_evidence_ids.length > 0,
    `${item.case_id}: source evidence is required`,
  );
  for (const sourceId of item.source_evidence_ids ?? []) {
    check(sourceIds.has(sourceId), `${item.case_id}: unknown source evidence id ${sourceId}`);
  }

  const safety = item.safety_expectations;
  for (const key of [
    "sensitive_flag_probe",
    "unicode_control_probe",
    "timeout_cleanup_probe",
    "hmac_digest_probe",
    "recognized_shim_probe",
  ]) {
    check(typeof safety?.[key] === "boolean", `${item.case_id}: ${key} must be boolean`);
  }
  if (item.platform?.execution_context === "host_observation") {
    check(
      safety?.network === "not_used",
      `${item.case_id}: host observation cannot claim network=disabled`,
    );
  }

  if (item.kind === "supported_positive") {
    check(
      allowedCategories.has(item.gold_category),
      `${item.case_id}: supported case needs a V1 gold category`,
    );
    if (allowedCategories.has(item.gold_category)) categoryCounts[item.gold_category] += 1;
    check(
      item.proof_eligibility?.eligible === true,
      `${item.case_id}: supported development case must be proof-eligible`,
    );
    check(
      item.proof_eligibility?.backend === "linux_rootless_oci",
      `${item.case_id}: wrong proof backend`,
    );
    check(item.platform?.os === "linux", `${item.case_id}: proof-eligible case must use Linux`);
    check(
      item.platform?.execution_context === "linux_isolated_experiment",
      `${item.case_id}: wrong execution context`,
    );
    check(
      item.expected_terminal_verdict === "VERIFIED_INTERVENTION",
      `${item.case_id}: wrong target verdict`,
    );
    check(item.expected_refusal === null, `${item.case_id}: supported case cannot have refusal`);
    check(
      item.allowed_typed_intervention?.type === allowedIntervention.get(item.gold_category),
      `${item.case_id}: intervention does not match gold category`,
    );
  } else {
    check(
      item.gold_category === null,
      `${item.case_id}: challenge case gold category must be null`,
    );
    check(
      item.proof_eligibility?.eligible === false,
      `${item.case_id}: challenge case cannot be proof-eligible`,
    );
    check(
      item.allowed_typed_intervention === null,
      `${item.case_id}: challenge case cannot allow intervention`,
    );
    if (item.kind === "out_of_scope_environment") {
      check(
        item.expected_terminal_verdict === "REFUSED_OUT_OF_SCOPE",
        `${item.case_id}: out-of-scope environment case must refuse`,
      );
      check(
        item.expected_refusal?.terminal_verdict === "REFUSED_OUT_OF_SCOPE",
        `${item.case_id}: missing expected refusal`,
      );
      check(
        /^RP_[A-Z0-9_]+$/.test(item.expected_refusal?.reason_code ?? ""),
        `${item.case_id}: invalid refusal reason`,
      );
      check(
        item.safety_expectations?.timeout_cleanup_probe === false,
        `${item.case_id}: a refusal case cannot also be a timeout probe; an uncontained Host timeout requires ABORTED_SAFETY`,
      );
    } else {
      check(
        item.expected_terminal_verdict === "INCONCLUSIVE" ||
          item.expected_terminal_verdict === "PARTIAL_EVIDENCE",
        `${item.case_id}: hard negative must expect a non-actionable inconclusive or partial verdict`,
      );
      check(
        item.expected_refusal === null,
        `${item.case_id}: hard negative cannot claim a typed refusal without supporting evidence`,
      );
    }
  }
}

for (const [kind, expected] of Object.entries(expectedCounts)) {
  check(
    kindCounts[kind] === expected,
    `expected ${expected} ${kind} cases, found ${kindCounts[kind]}`,
  );
}
for (const category of allowedCategories) {
  check(
    categoryCounts[category] === 3,
    `expected 3 ${category} cases, found ${categoryCounts[category]}`,
  );
}

const derivedSuiteStatus = derivedStatuses.every((status) => status === "scaffold")
  ? "scaffold"
  : derivedStatuses.every((status) => status === "verified")
    ? "verified"
    : "in_progress";
check(
  index?.status === derivedSuiteStatus,
  `suite declared status ${index?.status} does not match derived status ${derivedSuiteStatus}`,
);

const requiredProbes = {
  sensitive_flag_probe: 1,
  unicode_control_probe: 1,
  recognized_shim_probe: 1,
};
const manifests = entries
  .map((entry) => readJson(resolve(fixtureRoot, "development", entry.manifest)))
  .filter(Boolean);
for (const [probe, minimum] of Object.entries(requiredProbes)) {
  const count = manifests.filter((item) => item.safety_expectations?.[probe] === true).length;
  check(count >= minimum, `expected at least ${minimum} case with ${probe}, found ${count}`);
}
check(
  manifests.every((item) => item.safety_expectations?.hmac_digest_probe === true),
  "every case must assert invocation-scoped HMAC stream digests",
);

if (failures.length > 0) {
  const safeFailures = failures.map(sanitizeDiagnostic);
  process.stderr.write(
    `Fixture validation failed (${safeFailures.length}):\n- ${safeFailures.join("\n- ")}\n`,
  );
  process.exitCode = 1;
} else {
  const statusCounts = Object.fromEntries(
    ["scaffold", "implemented", "verified"].map((status) => [
      status,
      derivedStatuses.filter((candidate) => candidate === status).length,
    ]),
  );
  process.stdout.write(
    `Validated schema and build bindings for 16 manifests: ${statusCounts.scaffold} scaffold, ${statusCounts.implemented} implemented, ${statusCounts.verified} verified; 12 supported (3/category), 2 out-of-scope environment, 2 hard negatives.\n`,
  );
}
