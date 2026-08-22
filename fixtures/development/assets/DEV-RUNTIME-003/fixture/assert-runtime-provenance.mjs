// DEV-RUNTIME-003 fixture: assert the runtime provenance of the running
// process.
//
// The static launcher chain records the selected runtime role in
// RUNPARITY_FIXTURE_RUNTIME_ROLE (an adjacent fixture identity). In A arms the
// package-manager launcher is bound to the unintended runtime-manager slot
// while the direct PATH-resolved node is the approved slot, so the expected
// role must not match. The real backend binds actual executable identity
// externally instead of the marker.
const observed = process.env.RUNPARITY_FIXTURE_RUNTIME_ROLE;
const expected = process.env.RUNPARITY_FIXTURE_EXPECTED_RUNTIME_ROLE;
if (observed === undefined || observed === "" || expected === undefined || expected === "") {
  process.stderr.write("RP_FIXTURE_INVALID_RUNTIME_ASSERTION\n");
  process.exitCode = 64;
} else if (observed === expected) {
  process.stdout.write("RUNPARITY_OK:dev-runtime-003\n");
  process.exitCode = 0;
} else {
  process.stderr.write(
    `RP_FIXTURE_RUNTIME_PROVENANCE_SPLIT observed=${observed} expected=${expected}\n`,
  );
  process.exitCode = 23;
}
