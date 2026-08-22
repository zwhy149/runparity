// One-off build-receipt generator for fixture promotion slices.
// Recomputes exactly the fields `fixtures/validate.mjs` derives:
// the live asset inventory and the manifest digest are never hand-written.
// Usage: node work/generate-build-receipt.mjs <CASE_ID> <ENTRYPOINT_PATH>
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectAssetTree } from "../fixtures/lib/asset-inventory.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const caseId = process.argv[2];
const entrypointPath = process.argv[3];
if (typeof caseId !== "string" || typeof entrypointPath !== "string") {
  process.stderr.write("usage: node work/generate-build-receipt.mjs <CASE_ID> <ENTRYPOINT_PATH>\n");
  process.exitCode = 64;
} else {
  const manifestPath = resolve(
    repositoryRoot,
    "fixtures",
    "development",
    "cases",
    `${caseId}.json`,
  );
  const assetRoot = `development/assets/${caseId}`;
  const assetPath = resolve(repositoryRoot, "fixtures", assetRoot);
  const inventory = inspectAssetTree(assetPath);
  const receipt = {
    schema_version: "runparity.fixture-build-receipt/v1",
    case_id: caseId,
    manifest_sha256: createHash("sha256").update(readFileSync(manifestPath)).digest("hex"),
    asset_root: assetRoot,
    asset_inventory_schema_version: inventory.inventory.schema_version,
    asset_inventory_sha256: inventory.sha256,
    asset_inventory_stability: inventory.source_stability,
    entrypoint: { kind: "node_script", path: entrypointPath },
    status: "passed",
    created_at: new Date().toISOString(),
  };
  const receiptPath = resolve(repositoryRoot, "fixtures", "receipts", "build", `${caseId}.json`);
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  process.stdout.write(`wrote ${join("fixtures", "receipts", "build", `${caseId}.json`)}\n`);
}
