// RunParity backend qualification probe: read-only and write-containment facts.
// Runs INSIDE an arm container. Emits one JSON line; the qualification policy,
// not this probe, decides demonstrated/missing/contradictory.
import { accessSync, constants, writeFileSync } from "node:fs";

const attempts = [];
function attemptWrite(label, path) {
  try {
    writeFileSync(path, "runparity-probe\n", { flag: "wx" });
    attempts.push({ target: label, path, outcome: "wrote", error_code: null });
  } catch (error) {
    attempts.push({
      target: label,
      path,
      outcome: "refused",
      error_code: error instanceof Error && typeof error.code === "string" ? error.code : "UNKNOWN",
    });
  }
}

attemptWrite("root_filesystem", "/probe-write-canary");
attemptWrite("read_only_mount", "/probe/runparity-write-canary");
attemptWrite("writable_arm_home", "/home/arm/runparity-write-canary");
attemptWrite("writable_tmpfs", "/tmp/runparity-write-canary");

let homeWritable = false;
try {
  accessSync("/home/arm", constants.W_OK);
  homeWritable = true;
} catch {
  homeWritable = false;
}

process.stdout.write(
  `${JSON.stringify({
    schema_version: "runparity.backend-probe/readonly-write/v1",
    arm_user: `${process.getuid?.() ?? null}:${process.getgid?.() ?? null}`,
    attempts,
    home_accessible_writable: homeWritable,
  })}\n`,
);
