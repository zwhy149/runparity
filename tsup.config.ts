import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    "linux-rootless-privilege-probe": "src/oci/linux-rootless-privilege-probe-entry.ts",
  },
  format: ["esm"],
  target: "node18",
  platform: "node",
  clean: true,
  dts: false,
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
