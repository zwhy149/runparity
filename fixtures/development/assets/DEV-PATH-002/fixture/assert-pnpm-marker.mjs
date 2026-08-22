// DEV-PATH-002 fixture: assert the approved pnpm marker.
//
// Only the approved pnpm launcher chain stamps RUNPARITY_FIXTURE_PNPM_MARKER
// before reaching this assertion. The stale launcher chain dies earlier with a
// genuine missing-entry Node module error, so it never prints this marker.
const marker = process.env.RUNPARITY_FIXTURE_PNPM_MARKER;
if (marker === undefined || marker === "") {
  process.stderr.write("RP_FIXTURE_INVALID_PNPM_MARKER\n");
  process.exitCode = 64;
} else if (marker === "approved") {
  process.stdout.write("RUNPARITY_OK:dev-path-002\n");
  process.exitCode = 0;
} else {
  process.stderr.write("RP_FIXTURE_INVALID_PNPM_MARKER\n");
  process.exitCode = 64;
}
