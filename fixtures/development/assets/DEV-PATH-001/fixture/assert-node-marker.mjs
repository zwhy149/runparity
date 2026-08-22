const marker = process.env.RUNPARITY_FIXTURE_NODE_MARKER;

if (marker === "intended") {
  process.stdout.write("RUNPARITY_OK:dev-path-001\n");
  process.exitCode = 0;
} else if (marker === "wrong") {
  process.stderr.write("RP_FIXTURE_WRONG_NODE_PATH\n");
  process.exitCode = 23;
} else {
  process.stderr.write("RP_FIXTURE_INVALID_NODE_MARKER\n");
  process.exitCode = 64;
}
