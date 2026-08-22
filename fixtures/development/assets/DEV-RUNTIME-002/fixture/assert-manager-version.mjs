// DEV-RUNTIME-002 fixture: assert the observed package-manager version against
// the exact packageManager pin in this package.json.
//
// The launcher chain records the observed manager version in
// RUNPARITY_FIXTURE_MANAGER_VERSION (an adjacent fixture identity; the real
// backend must bind the actual pnpm version identity externally). The assertion
// reads the frozen packageManager declaration from its own working directory
// and never contacts a registry or mutates files.
const observed = process.env.RUNPARITY_FIXTURE_MANAGER_VERSION;
if (observed === undefined || observed === "") {
  process.stderr.write("RP_FIXTURE_INVALID_MANAGER_ASSERTION\n");
  process.exitCode = 64;
} else {
  let declared = null;
  try {
    const { readFileSync } = await import("node:fs");
    declared = JSON.parse(readFileSync("package.json", "utf8")).packageManager;
  } catch {
    declared = null;
  }
  if (typeof declared !== "string" || !/^pnpm@[0-9]+\.[0-9]+\.[0-9]+$/u.test(declared)) {
    process.stderr.write("RP_FIXTURE_INVALID_MANAGER_ASSERTION\n");
    process.exitCode = 64;
  } else if (`pnpm@${observed}` === declared) {
    process.stdout.write("RUNPARITY_OK:dev-runtime-002\n");
    process.exitCode = 0;
  } else {
    process.stderr.write(
      `RP_FIXTURE_PACKAGE_MANAGER_VERSION observed=pnpm@${observed} expected=${declared}\n`,
    );
    process.exitCode = 23;
  }
}
