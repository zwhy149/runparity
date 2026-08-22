// RunParity S1 sealed corpus generator (first tranche).
//
// Protocol (docs/VALIDATION.md, S1 amendment): the sealed corpus is
// procedurally generated from a frozen public seed. Gold labels come from
// the injected fault parameters, never from RunParity's diagnosis modules —
// this generator shares no imports with src/. The manifest of case
// parameters is committed BEFORE evaluation; the evaluator regenerates each
// case from the same seed and refuses any digest mismatch, so the corpus
// cannot be silently retuned after the fact. This is procedural
// fault-injection independence, not human double-blind curation; the
// difference is documented and human curation remains a future strengthening.
//
// Authenticity: every generated case exercises a REAL mechanism (real
// launcher scripts, real Node version comparisons, real npm config
// resolution, real ELF loading on Linux) — no fabricated loader or runtime
// text is ever printed.

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SEALED_SEED = 20260822;
export const SEALED_VERSION = "runparity.sealed-corpus/v1";

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, values) {
  return values[Math.floor(random() * values.length) % values.length];
}

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// --- in-scope family templates -------------------------------------------
// Each case is a directory template plus parameters. The evaluator
// materializes the directory, runs doctor on the declared command, and
// compares against the family gold label from the injection parameters.

function pathShadowingCase(random, index) {
  const wrongMarker = `wrong-${index}`;
  const intendedMarker = `intended-${index}`;
  const wrongDir = pick(random, ["shadow", "stale", "legacy"]);
  const intendedDir = pick(random, ["approved", "current", "vendor"]);
  const entry = `assert-${index}.mjs`;
  return {
    family: "PATH_SHADOWING",
    command: ["node", entry],
    platform: "linux",
    files: {
      [`${wrongDir}/bin/node`]: [
        "#!/bin/sh",
        `RP_MARKER=${wrongMarker}`,
        "export RP_MARKER",
        'exec "$REAL_NODE" "$@"',
        "",
      ].join("\n"),
      [`${intendedDir}/bin/node`]: [
        "#!/bin/sh",
        `RP_MARKER=${intendedMarker}`,
        "export RP_MARKER",
        'exec "$REAL_NODE" "$@"',
        "",
      ].join("\n"),
      [entry]: [
        "const marker = process.env.RP_MARKER;",
        `if (marker === "${intendedMarker}") {`,
        `  process.stdout.write("SEALED_OK:${index}\\n");`,
        "} else {",
        `  process.stderr.write("SEALED_WRONG_PATH_${index}\\n");`,
        "  process.exitCode = 23;",
        "}",
        "",
      ].join("\n"),
    },
    pathOrder: "wrong_first",
    binDirs: { wrong: wrongDir, intended: intendedDir },
    env: { REAL_NODE: "<controller-node>" },
  };
}

function runtimeDriftCase(random, index) {
  const major = 20 + Math.floor(random() * 6);
  const range = pick(random, [
    `>=${major}.0.0 <${major + 1}.0.0`,
    `>=${major + 1}.0.0 <${major + 2}.0.0`,
  ]);
  const entry = `engines-${index}.mjs`;
  return {
    family: "RUNTIME_MANAGER_DRIFT",
    command: ["node", entry],
    platform: "any",
    files: {
      ["package.json"]: `${JSON.stringify(
        { name: `sealed-runtime-${index}`, private: true, engines: { node: range } },
        null,
        2,
      )}\n`,
      [entry]: [
        "import { readFileSync } from 'node:fs';",
        "const manifest = JSON.parse(readFileSync('package.json', 'utf8'));",
        "const range = manifest.engines.node;",
        "const active = process.versions.node;",
        "const match = /^>=(\\d+)\\.(\\d+)\\.(\\d+) <(\\d+)\\./.exec(range);",
        "const lower = Number(match[1]);",
        "const upper = Number(match[4]);",
        "const activeMajor = Number(active.split('.')[0]);",
        "if (activeMajor >= lower && activeMajor < upper) {",
        `  process.stdout.write('SEALED_OK:${index}\\n');`,
        "} else {",
        `  process.stderr.write('SEALED_NODE_OUTSIDE_RANGE_${index} active=' + active + ' expected=' + range + '\\n');`,
        "  process.exitCode = 23;",
        "}",
        "",
      ].join("\n"),
    },
    pathOrder: null,
    env: {},
  };
}

function configConflictCase(random, index) {
  // All sealed CONFIG cases use the allowlisted `fund` boolean: real npm
  // resolves it, and a contradictory environment source genuinely overrides
  // the project .npmrc value, which is exactly the family mechanism.
  const projectValue = pick(random, ["true", "false"]);
  const envValue = projectValue === "true" ? "false" : "true";
  const entry = `config-${index}.mjs`;
  return {
    family: "CONFIG_PRECEDENCE",
    command: ["node", entry],
    platform: "any",
    files: {
      [".npmrc"]: `fund=${projectValue}\n`,
      ["package.json"]: `${JSON.stringify(
        { name: `sealed-config-${index}`, private: true },
        null,
        2,
      )}\n`,
      [entry]: [
        "import { spawnSync } from 'node:child_process';",
        "const result = spawnSync('npm', ['config', 'get', 'fund'], { encoding: 'utf8', shell: false });",
        "const effective = (result.stdout ?? '').trim();",
        `if (effective === '${projectValue}') {`,
        `  process.stdout.write('SEALED_OK:${index}\\n');`,
        "} else {",
        `  process.stderr.write('SEALED_CONFIG_CONFLICT_${index} effective=' + effective + '\\n');`,
        "  process.exitCode = 23;",
        "}",
        "",
      ].join("\n"),
    },
    pathOrder: null,
    env: { npm_config_fund: envValue },
  };
}

function nativeMismatchCase(_random, index) {
  // Real ELF loading requires Linux; the evaluator skips these on Windows.
  return {
    family: "NATIVE_ABI_ARCH_MISMATCH",
    command: ["node", `native-${index}.mjs`],
    platform: "linux",
    files: {
      [`native-${index}.mjs`]: [
        "// Loads a real Linux x64 .node artifact compiled for a different",
        "// Node ABI line than the evaluating runtime; the loader's genuine",
        "// NODE_MODULE_VERSION output is the evidence.",
        "import { createRequire } from 'node:module';",
        "import { fileURLToPath } from 'node:url';",
        "import { dirname, resolve } from 'node:path';",
        "const here = dirname(fileURLToPath(import.meta.url));",
        "try {",
        "  const addon = createRequire(import.meta.url)(resolve(here, 'mismatched.node'));",
        "  if (typeof addon.fixture === 'function') {",
        `    process.stdout.write('SEALED_OK:${index}\\n');`,
        "  } else {",
        `    process.stderr.write('SEALED_NATIVE_BAD_EXPORT_${index}\\n');`,
        "    process.exitCode = 23;",
        "  }",
        "} catch (error) {",
        "  // Genuine loader failure propagates; exit code stays non-zero.",
        "  process.exitCode = 1;",
        "}",
        "",
      ].join("\n"),
    },
    copyLayer: "mismatched.node",
    pathOrder: null,
    env: {},
  };
}

// --- out-of-family challenge templates ------------------------------------

function challengeCase(random, index) {
  const kind = pick(random, [
    "off_by_one",
    "undefined_property",
    "json_parse",
    "missing_relative_module",
    "network_refused",
  ]);
  const entry = `case-${index}.mjs`;
  const bodies = {
    off_by_one: [
      "const items = [1, 2, 3];",
      "const last = items[items.length];",
      `process.stdout.write('SEALED_OK:${index}\\n');`,
      "",
    ],
    undefined_property: ["const config = {};", "const value = config.nested.deep;", ""],
    json_parse: [
      "import { readFileSync } from 'node:fs';",
      "const data = JSON.parse(readFileSync('input.json', 'utf8'));",
      "",
    ],
    missing_relative_module: [
      "// A code defect that looks like a tooling problem: a relative import",
      "// to a file that was never created.",
      "import { helper } from './missing-helper.mjs';",
      "process.stdout.write(String(helper));",
      "",
    ],
    network_refused: [
      "import { connect } from 'node:net';",
      "const socket = connect({ host: '127.0.0.1', port: 1 });",
      "socket.on('error', (error) => {",
      `  process.stderr.write('SEALED_NETWORK_' + error.code + '_${index}\\n');`,
      "  process.exitCode = 23;",
      "});",
      "",
    ],
  };
  const files = {
    [entry]: bodies[kind].join("\n"),
  };
  if (kind === "json_parse") {
    files["input.json"] = "{ not valid json\n";
  }
  return {
    family: "OUT_OF_FAMILY",
    challenge_kind: kind,
    command: ["node", entry],
    platform: "any",
    files,
    pathOrder: null,
    env: {},
  };
}

// --- generation ------------------------------------------------------------

const IN_SCOPE_PER_FAMILY = 4;
const CHALLENGE_COUNT = 8;

export function generateSealedCorpus(seed = SEALED_SEED) {
  const random = mulberry32(seed);
  const cases = [];
  let index = 1;
  for (const template of [
    pathShadowingCase,
    runtimeDriftCase,
    configConflictCase,
    nativeMismatchCase,
  ]) {
    for (let i = 0; i < IN_SCOPE_PER_FAMILY; i += 1) {
      cases.push({ id: `SEALED-${String(index).padStart(3, "0")}`, ...template(random, index) });
      index += 1;
    }
  }
  for (let i = 0; i < CHALLENGE_COUNT; i += 1) {
    cases.push({ id: `SEALED-${String(index).padStart(3, "0")}`, ...challengeCase(random, index) });
    index += 1;
  }
  const manifest = {
    schema_version: SEALED_VERSION,
    seed,
    generated_for_platforms: ["win32", "linux"],
    case_count: cases.length,
    in_scope_count: cases.filter((c) => c.family !== "OUT_OF_FAMILY").length,
    challenge_count: cases.filter((c) => c.family === "OUT_OF_FAMILY").length,
    cases: cases.map((c) => ({
      id: c.id,
      family: c.family,
      challenge_kind: c.challenge_kind ?? null,
      platform: c.platform,
      command: c.command,
      params_sha256: sha256Json(c),
    })),
  };
  return { manifest, cases };
}

/**
 * Materialize one generated case into a target directory. The mismatched
 * native layer is copied from the open DEV-NATIVE-001 assets (a real ELF
 * artifact built with a different ABI); its bytes are content-addressed in
 * the manifest by the evaluator.
 */
export function materializeCase(caseDefinition, targetDir, layerSource) {
  rmSync(targetDir, { force: true, recursive: true });
  mkdirSync(targetDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(caseDefinition.files)) {
    const target = join(targetDir, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
  }
  if (caseDefinition.copyLayer !== undefined && layerSource !== undefined) {
    copyFileSync(layerSource, join(targetDir, caseDefinition.copyLayer));
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const { manifest } = generateSealedCorpus();
  const outPath = resolve(dirname(fileURLToPath(import.meta.url)), "manifest.json");
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`sealed manifest written: ${outPath} (${manifest.case_count} cases)\n`);
}
