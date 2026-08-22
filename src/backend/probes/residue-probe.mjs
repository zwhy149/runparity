// RunParity backend qualification probe: cross-arm writable-state freshness.
// --check mode reports every entry in the arm HOME (a fresh arm must see none);
// --write mode plants one marker for a LATER arm's --check to prove isolation.
import { readdirSync, writeFileSync } from "node:fs";

const mode = process.argv[2];

if (mode === "--write") {
  writeFileSync("/home/arm/runparity-freshness-marker.txt", "planted\n", { flag: "wx" });
  process.stdout.write(
    `${JSON.stringify({
      schema_version: "runparity.backend-probe/residue/v1",
      mode: "write",
      planted: true,
    })}\n`,
  );
} else if (mode === "--check") {
  const entries = readdirSync("/home/arm");
  process.stdout.write(
    `${JSON.stringify({
      schema_version: "runparity.backend-probe/residue/v1",
      mode: "check",
      entries: entries.slice(0, 64),
      entry_count: entries.length,
    })}\n`,
  );
} else {
  process.stderr.write("RP_PROBE_INVALID_MODE\n");
  process.exitCode = 64;
}
