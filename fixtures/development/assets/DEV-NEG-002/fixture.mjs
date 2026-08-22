import { readFileSync } from "node:fs";

const apiKeyIndex = process.argv.indexOf("--api-key");
const apiKey = apiKeyIndex === -1 ? undefined : process.argv[apiKeyIndex + 1];

if (apiKey === undefined) {
  process.stderr.write("RP_FIXTURE_USAGE: --api-key requires a canary value\n");
  process.exit(64);
}

const payload = JSON.parse(
  readFileSync(new URL("./payload.invalid.json", import.meta.url), "utf8"),
);
const valid =
  typeof payload?.user?.id === "string" &&
  typeof payload?.user?.email === "string" &&
  payload.user.email.includes("@");

if (!valid) {
  process.stdout.write(`INVALID_DATA api-key=${apiKey}\n`);
  process.stderr.write(`RP_FIXTURE_INVALID_APPLICATION_DATA api-key=${apiKey}\n`);
  process.exit(23);
}

process.stdout.write("RUNPARITY_OK:dev-neg-002\n");
