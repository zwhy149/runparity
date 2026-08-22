const requestedArguments = process.argv.slice(2);
const marker = process.env.RUNPARITY_FIXTURE_TOOLCHAIN_MARKER;

if (requestedArguments.length !== 1 || requestedArguments[0] !== "--assert-compatible") {
  process.stderr.write("RP_FIXTURE_INVALID_TOOLCHAIN_ASSERTION\n");
  process.exitCode = 64;
} else if (marker === "compatible") {
  process.stdout.write("RUNPARITY_OK:dev-path-003\n");
  process.exitCode = 0;
} else if (marker === "incompatible") {
  process.stderr.write("RP_FIXTURE_SYMLINK_TOOLCHAIN\n");
  process.exitCode = 23;
} else {
  process.stderr.write("RP_FIXTURE_INVALID_TOOLCHAIN_ASSERTION\n");
  process.exitCode = 64;
}
