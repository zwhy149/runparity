import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { resolveLaunch } from "../src/command-resolution.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = resolve(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs");
const runParityCli = resolve(repositoryRoot, "src", "cli.ts");
const temporaryDirectories: string[] = [];

function invokeRunParity(project: string, targetArgv: string[], environment: NodeJS.ProcessEnv) {
  return spawnSync(
    process.execPath,
    [tsxCli, runParityCli, "--json", "doctor", "--", ...targetArgv],
    {
      cwd: project,
      encoding: "utf8",
      env: environment,
      shell: false,
    },
  );
}

function windowsPathEnvironment(bin: string): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"),
  );
  environment["PATH"] = [bin, process.env["PATH"] ?? ""].join(delimiter);
  return environment;
}

function officialNpmShim(command: "npm" | "npx", family: "legacy" | "current"): string {
  const isNpx = command === "npx";
  const variable = isNpx ? "NPX_CLI_JS" : "NPM_CLI_JS";
  const scriptName = isNpx ? "npx-cli.js" : "npm-cli.js";
  const prefixVariable = isNpx ? "NPM_PREFIX_NPX_CLI_JS" : "NPM_PREFIX_NPM_CLI_JS";
  const resolverSetup =
    family === "current"
      ? ['SET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"']
      : isNpx
        ? ['SET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"']
        : [];
  const resolverInvocation =
    family === "current"
      ? 'CALL "%NODE_EXE%" "%NPM_PREFIX_JS%"'
      : 'CALL "%NODE_EXE%" "%NPM_CLI_JS%" prefix -g';
  return [
    ":: Created by npm, please don't edit manually.",
    "@ECHO OFF",
    "",
    "SETLOCAL",
    "",
    'SET "NODE_EXE=%~dp0\\node.exe"',
    'IF NOT EXIST "%NODE_EXE%" (',
    '  SET "NODE_EXE=node"',
    ")",
    "",
    ...resolverSetup,
    `SET "${variable}=%~dp0\\node_modules\\npm\\bin\\${scriptName}"`,
    `FOR /F "delims=" %%F IN ('${resolverInvocation}') DO (`,
    `  SET "${prefixVariable}=%%F\\node_modules\\npm\\bin\\${scriptName}"`,
    ")",
    `IF EXIST "%${prefixVariable}%" (`,
    `  SET "${variable}=%${prefixVariable}%"`,
    ")",
    "",
    `"%NODE_EXE%" "%${variable}%" %*`,
  ].join("\r\n");
}

function createOfficialNpmFixture(
  project: string,
  command: "npm" | "npx",
  family: "legacy" | "current",
): { bin: string; selectedScript: string } {
  const bin = resolve(project, "bin");
  const adjacentNpmBin = resolve(bin, "node_modules", "npm", "bin");
  const prefix = resolve(project, "prefix");
  const prefixNpmBin = resolve(prefix, "node_modules", "npm", "bin");
  mkdirSync(adjacentNpmBin, { recursive: true });
  mkdirSync(prefixNpmBin, { recursive: true });
  copyFileSync(process.execPath, resolve(bin, "node.exe"));

  const prefixLiteral = JSON.stringify(prefix);
  writeFileSync(
    resolve(adjacentNpmBin, "npm-prefix.js"),
    `process.stdout.write(${prefixLiteral} + "\\n");`,
  );
  writeFileSync(
    resolve(adjacentNpmBin, "npm-cli.js"),
    family === "legacy"
      ? `if (process.argv.slice(2).join(" ") === "prefix -g") process.stdout.write(${prefixLiteral} + "\\n"); else process.stdout.write("ADJACENT\\n");`
      : 'process.stdout.write("ADJACENT\\n");',
  );
  writeFileSync(resolve(adjacentNpmBin, "npx-cli.js"), 'process.stdout.write("ADJACENT\\n");');

  const selectedScript = resolve(prefixNpmBin, command === "npx" ? "npx-cli.js" : "npm-cli.js");
  writeFileSync(
    resolve(prefixNpmBin, "..", "package.json"),
    JSON.stringify({ name: "npm", version: family === "legacy" ? "9.9.4" : "11.6.2" }),
  );
  writeFileSync(
    selectedScript,
    `process.stdout.write("PREFIX:${command}\\n"); if (process.argv.includes("--fail")) process.exit(23);`,
  );
  writeFileSync(resolve(bin, `${command}.cmd`), officialNpmShim(command, family));
  return { bin, selectedScript };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe.runIf(process.platform === "win32")("Windows Node command shims", () => {
  test("matches Node's Windows current-directory search even when the cmd opt-out is set", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-windows-cwd-search-"));
    temporaryDirectories.push(project);
    const executable = resolve(project, "rp-cwd-probe.exe");
    copyFileSync(process.execPath, executable);
    const isolatedEnvironment = { PATH: "", PATHEXT: ".EXE" };

    expect(
      realpathSync.native(
        resolveLaunch(["rp-cwd-probe"], isolatedEnvironment, { cwd: project }).resolvedPath ?? "",
      ),
    ).toBe(realpathSync.native(executable));
    const environmentWithCmdOptOut = {
      ...isolatedEnvironment,
      NoDefaultCurrentDirectoryInExePath: "1",
    };
    expect(
      spawnSync("rp-cwd-probe", ["--version"], {
        cwd: project,
        encoding: "utf8",
        env: environmentWithCmdOptOut,
        shell: false,
      }).status,
    ).toBe(0);
    expect(
      resolveLaunch(["rp-cwd-probe"], environmentWithCmdOptOut, { cwd: project }),
    ).toMatchObject({ resolvedPath: executable });
  });

  test("uses Node's code-unit ordering for duplicate-case Windows environment keys", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-windows-env-order-"));
    temporaryDirectories.push(project);
    const uppercaseBin = resolve(project, "uppercase-bin");
    const titlecaseBin = resolve(project, "titlecase-bin");
    mkdirSync(uppercaseBin);
    mkdirSync(titlecaseBin);
    const executableName = "rp-env-order-probe.exe";
    const expectedExecutable = resolve(uppercaseBin, executableName);
    copyFileSync(process.execPath, expectedExecutable);
    copyFileSync(process.execPath, resolve(titlecaseBin, executableName));
    const environment: NodeJS.ProcessEnv = {
      Path: titlecaseBin,
      PATH: uppercaseBin,
      PATHEXT: ".EXE",
    };

    const native = spawnSync(
      "rp-env-order-probe",
      ["-e", "process.stdout.write(process.execPath)"],
      { cwd: project, encoding: "utf8", env: environment, shell: false },
    );

    expect(native.status).toBe(0);
    // CI temp dirs surface as 8.3 short names to child processes; compare
    // canonical realpaths instead of raw spellings.
    expect(realpathSync.native(native.stdout.trim())).toBe(realpathSync.native(expectedExecutable));
    expect(
      realpathSync.native(
        resolveLaunch(["rp-env-order-probe"], environment, { cwd: project }).resolvedPath ?? "",
      ),
    ).toBe(realpathSync.native(expectedExecutable));
  });

  test("executes the first recognized forwarding shim without shell parsing", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-shim-"));
    temporaryDirectories.push(project);
    const firstBin = resolve(project, "first-bin");
    const secondBin = resolve(project, "second-bin");
    mkdirSync(firstBin);
    mkdirSync(secondBin);

    const firstScript = resolve(firstBin, "probe.mjs");
    const secondScript = resolve(secondBin, "probe.mjs");
    const secondMarker = resolve(project, "second-ran.txt");
    writeFileSync(
      firstScript,
      "process.stdout.write(JSON.stringify(process.argv.slice(2)) + '\\n'); process.exit(42);",
    );
    writeFileSync(
      secondScript,
      `await import("node:fs").then(({ writeFileSync }) => writeFileSync(${JSON.stringify(secondMarker)}, "ran"));`,
    );

    const firstShim = resolve(firstBin, "rp-probe.cmd");
    writeFileSync(firstShim, `@echo off\r\n"${process.execPath}" "${firstScript}" %*\r\n`);
    writeFileSync(
      resolve(secondBin, "rp-probe.cmd"),
      `@echo off\r\n"${process.execPath}" "${secondScript}" %*\r\n`,
    );

    const environment = windowsPathEnvironment(firstBin);
    environment["PATH"] = [firstBin, secondBin, process.env["PATH"] ?? ""].join(delimiter);

    const result = invokeRunParity(project, ["rp-probe", "--label", "two words"], environment);

    expect(result.status).toBe(42);
    expect(result.stderr).toBe("");

    const output = JSON.parse(result.stdout);
    // CI temp dirs surface as 8.3 short names in resolved paths; compare
    // canonical realpaths outside the shape matcher.
    expect(realpathSync.native(output.data.report.observation.launch?.resolved_path ?? "")).toBe(
      realpathSync.native(firstShim),
    );
    expect(output.data.report.observation).toMatchObject({
      requested_argv: ["rp-probe", "--label", "two words"],
      launch: {
        requested_program: "rp-probe",
        kind: "recognized_node_shim",
        executable_path: process.execPath,
        script_path: firstScript,
      },
      result: {
        exit_code: 42,
        stdout: {
          redacted_excerpt: '["--label","two words"]\n',
        },
      },
    });
    expect(output.data.report.observation.launch.candidates).toEqual([
      firstShim,
      resolve(secondBin, "rp-probe.cmd"),
    ]);
    expect(existsSync(secondMarker)).toBe(false);
  });

  test("refuses an unknown batch program without executing it", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-unsafe-shim-"));
    temporaryDirectories.push(project);
    const bin = resolve(project, "bin");
    mkdirSync(bin);
    const marker = resolve(project, "batch-ran.txt");
    writeFileSync(resolve(bin, "rp-unsafe.cmd"), `@echo off\r\necho ran > "${marker}"\r\n`);

    const environment = windowsPathEnvironment(bin);

    const result = invokeRunParity(project, ["rp-unsafe", "argument with spaces"], environment);

    expect(result.status).toBe(77);
    expect(result.stderr).toBe("");
    expect(existsSync(marker)).toBe(false);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: "runparity.cli/v1",
      ok: false,
      command: "doctor",
      data: null,
      error: {
        code: "RP_UNVERIFIED_WINDOWS_SHIM",
        retryable: false,
      },
      warnings: [],
      meta: {
        cli_version: "0.0.0",
      },
    });
  });

  test("refuses an official npm shim until prefix selection is supervised", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-npm-shim-"));
    temporaryDirectories.push(project);

    const result = invokeRunParity(project, ["npm", "--version"], process.env);

    expect(result.status).toBe(77);
    expect(result.stderr).toBe("");
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      ok: false,
      data: null,
      error: {
        code: "RP_UNVERIFIED_WINDOWS_SHIM",
        message: expect.stringContaining("prefix-selection stage"),
      },
    });
  });

  test.each([
    ["npm", "legacy"],
    ["npx", "legacy"],
    ["npm", "current"],
    ["npx", "current"],
  ] as const)("fails closed for %s %s until staged execution exists", (command, family) => {
    const project = mkdtempSync(resolve(tmpdir(), `runparity-${command}-${family}-`));
    temporaryDirectories.push(project);
    const fixture = createOfficialNpmFixture(project, command, family);

    const result = invokeRunParity(
      project,
      [command, "--version"],
      windowsPathEnvironment(fixture.bin),
    );

    expect(result.status).toBe(77);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      data: null,
      error: { code: "RP_UNVERIFIED_WINDOWS_SHIM" },
    });
  });

  test("does not infer package-manager drift from a refused staged shim", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-manager-drift-"));
    temporaryDirectories.push(project);
    writeFileSync(
      resolve(project, "package.json"),
      JSON.stringify({ name: "fixture", private: true, packageManager: "npm@99.0.0" }),
    );
    const fixture = createOfficialNpmFixture(project, "npm", "current");

    const result = invokeRunParity(project, ["npm", "--fail"], windowsPathEnvironment(fixture.bin));

    expect(result.status).toBe(77);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      data: null,
      error: { code: "RP_UNVERIFIED_WINDOWS_SHIM" },
    });
  });

  test("preserves safe literal environment assignments from a recognized shim", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-shim-env-"));
    temporaryDirectories.push(project);
    const bin = resolve(project, "bin");
    mkdirSync(bin);
    const script = resolve(bin, "environment-probe.mjs");
    const secret = "rp-shim-secret-credential-123456789";
    writeFileSync(
      script,
      'process.stdout.write((process.env.RP_SHIM_PROBE ?? "MISSING") + "|" + (process.env.RP_ACCESS_TOKEN ?? "MISSING") + "\\n");',
    );
    writeFileSync(
      resolve(bin, "rp-env.cmd"),
      [
        "@echo off",
        "setlocal",
        'set "RP_SHIM_PROBE=FROM_SHIM"',
        `set "RP_ACCESS_TOKEN=${secret}"`,
        `"${process.execPath}" "${script}" %*`,
      ].join("\r\n"),
    );

    const result = invokeRunParity(project, ["rp-env"], windowsPathEnvironment(bin));

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(secret);
    expect(JSON.parse(result.stdout).data.report.observation.result.stdout.redacted_excerpt).toBe(
      "FROM_SHIM|[REDACTED]\n",
    );
  });

  test("refuses a generic shim whose exit appears before its forwarding instruction", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-shim-early-exit-"));
    temporaryDirectories.push(project);
    const bin = resolve(project, "bin");
    mkdirSync(bin);
    const marker = resolve(project, "should-not-run.txt");
    const script = resolve(bin, "side-effect.mjs");
    writeFileSync(
      script,
      `await import("node:fs").then(({ writeFileSync }) => writeFileSync(${JSON.stringify(marker)}, "ran"));`,
    );
    writeFileSync(
      resolve(bin, "rp-early-exit.cmd"),
      ["@echo off", "exit /b %errorlevel%", `"${process.execPath}" "${script}" %*`].join("\r\n"),
    );

    const result = invokeRunParity(project, ["rp-early-exit"], windowsPathEnvironment(bin));

    expect(result.status).toBe(77);
    expect(existsSync(marker)).toBe(false);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "RP_UNVERIFIED_WINDOWS_SHIM" },
    });
  });

  test("refuses environment expansion hidden inside a batch comment", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-shim-comment-expansion-"));
    temporaryDirectories.push(project);
    const bin = resolve(project, "bin");
    mkdirSync(bin);
    const marker = resolve(project, "should-not-run.txt");
    const script = resolve(bin, "side-effect.mjs");
    writeFileSync(
      script,
      `await import("node:fs").then(({ writeFileSync }) => writeFileSync(${JSON.stringify(marker)}, "ran"));`,
    );
    writeFileSync(
      resolve(bin, "rp-comment-expansion.cmd"),
      ["@echo off", "rem %RP_COMMENT_INJECT%", `"${process.execPath}" "${script}" %*`].join("\r\n"),
    );
    const environment = windowsPathEnvironment(bin);
    environment["RP_COMMENT_INJECT"] = "& exit /b 0";

    const result = invokeRunParity(project, ["rp-comment-expansion"], environment);

    expect(result.status).toBe(77);
    expect(existsSync(marker)).toBe(false);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "RP_UNVERIFIED_WINDOWS_SHIM" },
    });
  });

  test("preserves the unset semantics of an empty generic shim assignment", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-shim-env-unset-"));
    temporaryDirectories.push(project);
    const bin = resolve(project, "bin");
    mkdirSync(bin);
    const script = resolve(bin, "unset-probe.mjs");
    writeFileSync(
      script,
      'process.stdout.write(Object.hasOwn(process.env, "RP_EMPTY_PROBE") ? "PRESENT:" + process.env.RP_EMPTY_PROBE : "ABSENT");',
    );
    writeFileSync(
      resolve(bin, "rp-unset.cmd"),
      [
        "@echo off",
        "setlocal",
        'set "RP_EMPTY_PROBE="',
        `"${process.execPath}" "${script}" %*`,
        "exit /b %errorlevel%",
      ].join("\r\n"),
    );
    const environment = windowsPathEnvironment(bin);
    environment["RP_EMPTY_PROBE"] = "PARENT";

    const result = invokeRunParity(project, ["rp-unset"], environment);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).data.report.observation.result.stdout.redacted_excerpt).toBe(
      "ABSENT",
    );
  });

  test("refuses dynamic environment expansion in a generic shim", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-shim-dynamic-env-"));
    temporaryDirectories.push(project);
    const bin = resolve(project, "bin");
    mkdirSync(bin);
    const script = resolve(bin, "probe.mjs");
    writeFileSync(script, "process.exit(0);");
    writeFileSync(
      resolve(bin, "rp-dynamic.cmd"),
      `@echo off\r\nset "RP_SHIM_PROBE=%PATH%"\r\n"${process.execPath}" "${script}" %*\r\n`,
    );

    const result = invokeRunParity(project, ["rp-dynamic"], windowsPathEnvironment(bin));

    expect(result.status).toBe(77);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "RP_UNVERIFIED_WINDOWS_SHIM" },
    });
  });

  test("refuses an oversized command shim", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-shim-oversized-"));
    temporaryDirectories.push(project);
    const bin = resolve(project, "bin");
    mkdirSync(bin);
    writeFileSync(resolve(bin, "rp-large.cmd"), Buffer.alloc(64 * 1024 + 1, 0x3a));

    const result = invokeRunParity(project, ["rp-large"], windowsPathEnvironment(bin));

    expect(result.status).toBe(77);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "RP_UNVERIFIED_WINDOWS_SHIM" },
    });
  });

  test("refuses an npm-like shim with an inserted batch command", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-fake-npm-shim-"));
    temporaryDirectories.push(project);
    const bin = resolve(project, "bin");
    const npmBin = resolve(bin, "node_modules", "npm", "bin");
    mkdirSync(npmBin, { recursive: true });
    writeFileSync(resolve(npmBin, "npm-cli.js"), "process.exit(42);");
    const marker = resolve(project, "injected.txt");
    const source = [
      ":: Created by npm, please don't edit manually.",
      "@ECHO OFF",
      "",
      "SETLOCAL",
      "",
      'SET "NODE_EXE=%~dp0\\node.exe"',
      'IF NOT EXIST "%NODE_EXE%" (',
      '  SET "NODE_EXE=node"',
      ")",
      "",
      'SET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"',
      'SET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"',
      'FOR /F "delims=" %%F IN (\'CALL "%NODE_EXE%" "%NPM_PREFIX_JS%"\') DO (',
      '  SET "NPM_PREFIX_NPM_CLI_JS=%%F\\node_modules\\npm\\bin\\npm-cli.js"',
      ")",
      'IF EXIST "%NPM_PREFIX_NPM_CLI_JS%" (',
      '  SET "NPM_CLI_JS=%NPM_PREFIX_NPM_CLI_JS%"',
      ")",
      "",
      `echo injected > "${marker}"`,
      '"%NODE_EXE%" "%NPM_CLI_JS%" %*',
      "",
    ].join("\r\n");
    writeFileSync(resolve(bin, "npm.cmd"), source);

    const environment = windowsPathEnvironment(bin);

    const result = invokeRunParity(project, ["npm", "--version"], environment);

    expect(result.status).toBe(77);
    expect(existsSync(marker)).toBe(false);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "RP_UNVERIFIED_WINDOWS_SHIM" },
    });
  });

  test("never executes an official npm prefix helper during command resolution", () => {
    const project = mkdtempSync(resolve(tmpdir(), "runparity-npm-resolution-side-effect-"));
    temporaryDirectories.push(project);
    const fixture = createOfficialNpmFixture(project, "npm", "current");
    const marker = resolve(project, "resolver-ran.txt");
    writeFileSync(
      resolve(fixture.bin, "node_modules", "npm", "bin", "npm-prefix.js"),
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");`,
    );

    const result = invokeRunParity(
      project,
      ["npm", "--version"],
      windowsPathEnvironment(fixture.bin),
    );

    expect(result.status).toBe(77);
    expect(existsSync(marker)).toBe(false);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "RP_UNVERIFIED_WINDOWS_SHIM" },
    });
  });
});
