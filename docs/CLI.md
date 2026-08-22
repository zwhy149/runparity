# RunParity CLI contract

> **Status key:** **Current** means implemented by source prototype `0.0.0`.
> **Planned V1** reserves the intended public shape but is not a runnable promise.
> The npm package is currently private, so public `npx runparity@latest` examples
> are also planned until publication.

## Current source-prototype surface

From this repository:

```text
pnpm install
pnpm exec tsx src/cli.ts doctor -- <executable> [args...]
pnpm exec tsx src/cli.ts doctor --timeout 30s -- <executable> [args...]
pnpm exec tsx src/cli.ts doctor --report-only -- <executable> [args...]
pnpm exec tsx src/cli.ts --json doctor -- <executable> [args...]
pnpm build
node dist/cli.js --html doctor --report-only -- <executable> [args...] > runparity-report.html
```

## Current fixture verification surface (development only, not a public bin)

`src/fixtures-cli.ts` is the maintainer-side driver for the backend
qualification and A1/B/A2 pipeline (ADR-0005). It is intentionally absent
from the published `bin` map; it runs from the repository through the
toolchain:

```text
pnpm exec tsx src/fixtures-cli.ts backend qualify --config <cfg.json> --out <receipt.json> --facts-out <facts.json>
pnpm exec tsx src/fixtures-cli.ts case run --case DEV-PATH-001 --config <cfg.json> \
  --receipt <receipt.json> --out <ledger.json> [--verified-at <UTC>]
pnpm exec tsx src/fixtures-cli.ts suite status
```

`backend qualify` collects the eleven-control probe battery over a
supervised SSH transport against a digest-pinned rootless Podman backend and
writes a qualification receipt plus its facts sidecar. `case run` executes
three fresh A1→B→A2 sequences, assembles the ledger, and verifies it with
the in-repository proof verifier; `--verified-at` pins the ledger timestamp
to the manifest promotion timestamp (protocol amendment, ADR-0005). Exit
code 0 requires `qualified` / `VERIFIED_INTERVENTION` respectively. The
repository validator (`fixtures/validate.mjs`) re-derives every ledger claim
independently and remains the gate for `fixture_status: verified`.

The current global `--json` or `--html` option is written before `doctor`; the
two output modes are mutually exclusive and a conflict fails before target
launch. The direct built-artifact command above keeps package-manager wrapper
messages out of the redirected HTML document. The doctor-specific `--timeout`
option is written after `doctor` and before `--`.
Its budget starts when RunParity captures the RunSpec, before Contract compilation
and launch resolution; it is not reset immediately before `spawn`.

`--` is mandatory in the public contract. Everything after it is target argv;
RunParity does not interpret pipelines, redirects, globs, or command chaining.
The requested command runs on the host with the user's normal permissions and may
have its normal side effects. Host Observe is not a sandbox.

Current `doctor` behavior is deliberately narrow:

- captures requested argv, environment, resolved working directory, and
  workspace/canonical-workspace roots into an opaque, frozen RunSpec before
  Contract compilation. The timeout becomes one absolute monotonic deadline at
  that point; later stages do not receive a fresh timeout budget;
- the Host Observe module returns a safely serializable ObservedRun projection.
  It includes redacted request/launch facts and only shim environment-mutation
  names; the internal LaunchPlan's target args, literal environment-mutation
  values, and captured environment values are not returned or serialized.
  `doctor` maps selected
  ObservedRun fields into the report; the complete internal request projection is
  not yet a public JSON sub-object;
- resolves an explicit executable without shell parsing and launches it with
  `shell:false`; for a native launch, the requested program spelling is preserved
  as `argv0` while the resolved canonical executable is used for execution;
- records the first executable lookup path separately from its canonical target.
  `candidate_resolutions` retains at most 64 unique lookup-to-canonical mappings
  in search order and sets `candidate_resolutions_truncated:true` if more existed.
  Canonical candidate scanning continues after that display bound;
- directly executes only narrowly recognized generic Windows Node forwarders.
  Exact official legacy/current npm and npx shims are recognized as dynamic-prefix
  shapes and refused with `RP_UNVERIFIED_WINDOWS_SHIM`/77; RunParity does not run
  their prefix helper during resolution;
- parses a generic shim with an ordered grammar: optional preamble, literal
  assignments, exactly one `"node" "script" %*` forwarding line, then an optional
  `exit /b %errorlevel%`. A non-empty `SET "NAME=value"` sets a child variable and
  an empty value unsets it. Assignments after forwarding, duplicate/out-of-order
  control lines, `%`/`!` expansion, controls, unknown commands, and oversized
  shims are refused without executing the batch file;
- records bounded stdout/stderr excerpts and a full-stream HMAC-SHA-256 using one
  random invocation-scoped key shared by the two stream captures; the key is not
  serialized or persisted and digests are not comparable across invocations;
- applies learned-secret replacement only to evidence-bearing fields, including
  argv, stream excerpts, paths, Contract selectors, and selected provenance. It
  deliberately leaves schema names, reason codes, enums, and other control-plane
  constants in a completed observation envelope unchanged, then recursively applies
  display-control sanitization;
- suppresses a complete captured excerpt as `[REDACTED_SENSITIVE_OUTPUT]` when a
  learned secret is shorter than 12 UTF-8 bytes. A truncated excerpt that could
  split a learned short or multiline secret is replaced by
  `[REDACTED_BOUNDARY]`; other truncated excerpts start with that marker and omit
  the potentially partial first line before contextual redaction;
- removes VT and C0/C1 controls, bidi formatting, line-separator ambiguity, and a
  selected set of invisible/default-ignorable display controls; this is limited
  hardening, not arbitrary Unicode confusable or secret detection;
- reads `packageManager` and `engines.node` from a safe regular `package.json` and
  records a SHA-256 over each allowlisted
  `{parser_version, pointer, value}` projection, not over the raw manifest;
- for a recognized generic npm/npx or pnpm/pnpx forwarder, may read the adjacent
  package manifest as bounded data. Observation requires a valid local manager
  name/version and a manifest `bin` entry whose canonical target is the launched
  script. It reports `identity_assurance: "local_manifest_claim"`, the canonical
  manifest path, and a SHA-256 over the allowlisted
  `{parser_version, name, version, command, bin}` projection—not the raw manifest;
- for npm/npx-shaped commands only, records contradictory allowlisted boolean
  `fund` or `strict-peer-deps` values from CLI, `npm_config_*` environment, and
  the current project's `.npmrc`. The JSON field is
  `observation.config_source_conflicts`, its `semantics` is `unqualified`, and a
  project `.npmrc` provenance hash covers only `{parser_version, key, value}`;
- may emit bounded findings for a controller Node outside `engines.node`, a
  recognized package-manager name/version differing from the exact
  `packageManager` Contract, multiple executable candidates on PATH, and an
  explicit Node native-module ABI mismatch signature; output remains capped at
  three findings and none is isolated causal proof. Configuration-source
  conflicts are observation data, not Findings;
- supports `--report-only`, which returns zero after a valid non-timeout
  observation while retaining the target result and
  `exit_policy: "report_only"` in the report;
- supports `--html`, which writes one escaped, responsive, printable offline
  document to stdout after a completed observation. It uses the same
  completed, already-redacted observation envelope and includes an inline CSP and
  stylesheet, but no script or external asset. Typed CLI error envelopes remain
  JSON-only and human errors remain text;
- on an execution timeout, attempts best-effort POSIX process-group or Windows
  `taskkill /T` cleanup, always records `containment: "uncontained_host"`, and
  never promotes current Host Observe cleanup to `verified`. Windows controller
  path and environment are captured independently at module initialization, not
  read from the target environment or later ambient changes;
- cancels the execution timer when the target exits. A separate 250 ms post-exit
  pipe-drain grace may mark `stream_capture.status: "incomplete"`; it does not
  relabel an already exited target as timed out and does not trigger cleanup;
- reports `result.started`, monotonic `result.duration_ms`, and
  `result.timeout_phase`. A deadline exhausted before launch records
  `started:false`, `timed_out:true`, `timeout_phase:"before_launch"`, and
  `duration_ms:0`; RunParity does not start the target or claim a cleanup attempt;
- emits `INCONCLUSIVE` when the target succeeds, `PARTIAL_EVIDENCE` for a
  completed reproduced failure, and `ABORTED_SAFETY` for every current execution
  timeout because cleanup remains unverified;
- reports Reference resolution as `not_found` and experiments as `not_attempted`.

Internally, `doctor` classifies Host process evidence into a discriminated state
before a pure deterministic decision produces its report/result status, verdict,
reason code, and warnings. Contradictory combinations fail closed, including a
non-started process with an exit code and any uncontained Host cleanup represented
as `verified`. This is not a new option, JSON field, or public verdict API.

The source also has an internal pure ExperimentCompiler. It accepts only an
opaque frozen base-arm token, its matching SHA-256, qualification and oracle
SHA-256 values, all nine fixed-input SHA-256 values in the base snapshot, unique
A1/B/A2 freshness IDs, and one `path.prepend` directory that is absolute for the
snapshot's POSIX or Windows PATH style. It compiles A1 and A2 as equivalent
controls and B with exactly that one normalized path delta. Its opaque token can
be inspected only through a safe summary of `COMPILED_PLAN_ONLY`, plan digests,
arm identities/freshness, base digest, and delta type. It does not expose a CLI
command, public preview, arm execution, backend selection, ledger, or proof.

The current config observation ignores registry and all other non-allowlisted or
secret-prone keys, non-boolean/dynamic values, and npm global mode. It does not
read user/global npmrc as a supported source. It records only that two or more
supported source projections disagree. It does not qualify npm's evaluation
semantics, identify an effective value, guess intent, emit an `RP-CONFIG` Finding,
or propose an Intervention.

It does not currently discover or qualify References, expose an experiment
preview, run A1/B/A2, apply an Intervention, create or verify a ledger, import a
saved report, export Markdown/SARIF, or implement the expert command families
below. Current `--html` is a direct rendering mode for the in-memory observation,
not a saved-report import/export command.
The current JSON value `kind: "recognized_node_shim"` means that a narrow generic
forwarding shape was recognized and executed without handing the shim to
`cmd.exe`. Generic templates retain ordered literal set/unset environment
assignments; values requiring batch expansion or other dynamic batch semantics
are refused. Exact official npm/npx dynamic-prefix templates do not produce this
launch record: they fail closed with exit 77 before any prefix helper or target
script runs. Recognition does not mean the shim, resolved Node binary, or
forwarded JavaScript file has a publisher signature or authenticity proof.
Explicit interruption/crash cleanup and containment of descendants that detach
from the observed process group/tree remain release blockers. A recorded
`cleanup.status: "best_effort"` records that the known process group/tree was
targeted; it is not an OS-level containment guarantee and does not prove that an
already detached descendant stopped. A timeout with either `best_effort` or
`failed` cleanup emits `ABORTED_SAFETY` and exits 74, including under
`--report-only`. A detached process can also force bounded stream capture to be
reported as incomplete.

If the RunSpec's shared deadline expires before `spawn`, this is not an execution
timeout: the report status is `observation_deadline_expired`, the result status is
`deadline_expired_before_launch`, the verdict is `INCONCLUSIVE`, and warning plus
experiment reason code are `RP_OBSERVATION_DEADLINE_EXPIRED`. The cleanup record
is `attempted:false`/`status:"not_required"`; no process existed to terminate.
Its `containment:"uncontained_host"` value labels the Host context and is not a
cleanup-success claim. Current CLI exit is 124, including under `--report-only`.

### Current resolution semantics

- **POSIX:** a program containing `/` is resolved only as that explicit absolute
  or working-directory-relative path. A bare program is searched in case-sensitive
  `PATH` order; an absent `PATH` uses `/usr/bin:/bin`, and an empty component means
  the working directory. Non-empty relative PATH components are also resolved
  against the captured working directory. Regular files must pass the executable-access check.
  Non-executable candidates are skipped while searching; if candidates exist but
  none is executable, RunParity returns `RP_COMMAND_NOT_EXECUTABLE`/126.
- **Windows:** a program containing `\` or `/` is resolved as an explicit path;
  a bare program searches the working directory and then the selected `PATH`.
  Relative PATH components are resolved against the captured working directory.
  Extensionless names expand in `PATHEXT` order, with
  `.COM;.EXE;.BAT;.CMD` as the fallback. Environment-key lookup is
  case-insensitive and deterministically selects the first code-unit-sorted key
  when duplicate spellings exist. Canonical candidates are de-duplicated
  case-insensitively. A selected `.cmd` or `.bat` still has to pass the bounded
  shim policy above.
- **Launch identity:** native launches execute the canonical resolved path but
  preserve the requested program as `argv0`. A recognized generic Node shim is
  converted to a direct Node launch: `argv0` is the resolved `node.exe`, the first
  argument is the resolved JavaScript entry point, and the user's target
  arguments remain separate argv elements.

The additive launch-provenance fields have these invariants:

1. `selected_search_path` is the absolute lookup candidate that first matched; it
   can come from an explicit path or the Windows working-directory search, so it
   is not a raw PATH string.
2. `resolved_path` remains that match's `realpathSync.native` canonical target.
3. Each `candidate_resolutions` entry contains `search_path` and
   `canonical_path`; several lookup aliases may map to one canonical target.
4. Exact repeated lookup paths are de-duplicated. The trace is capped at 64 and
   `candidate_resolutions_truncated` discloses overflow, while the resolver still
   scans later entries for distinct canonical candidates.
5. `candidates` remains the search-ordered, platform-deduplicated canonical list
   used by the PATH Finding. Alias count alone never creates that Finding. For a
   recognized shim, these fields describe the matched launcher;
   `executable_path` and `script_path` separately describe the direct Node launch
   chain.

These rules describe the Current `0.0.0` resolver. They are command-resolution
semantics, not evidence that the selected file is authentic or immutable.

## Current JSON envelope

For `runparity --json doctor`, stdout contains one JSON document for observations
and typed usage failures. The following is an abridged excerpt; target output and
the rest of the report remain inside the same document:

```json
{
  "schema": "runparity.cli/v1",
  "ok": true,
  "command": "doctor",
  "data": {
    "report": {
      "schema": "runparity.report/v1",
      "exit_policy": "preserve_target",
      "verdict": "PARTIAL_EVIDENCE",
      "execution_context": "HOST_OBSERVATION",
      "experiment_progress": "OBSERVED",
      "observation": {
        "launch": {
          "selected_search_path": "/workspace/node_modules/.bin/tool",
          "resolved_path": "/workspace/tools/tool.js",
          "candidate_resolutions": [
            {
              "search_path": "/workspace/node_modules/.bin/tool",
              "canonical_path": "/workspace/tools/tool.js"
            }
          ],
          "candidate_resolutions_truncated": false
        },
        "result": {
          "started": true,
          "duration_ms": 42.125,
          "timed_out": false,
          "timeout_phase": null
        }
      }
    }
  },
  "error": null,
  "warnings": [],
  "meta": {
    "cli_version": "0.0.0",
    "invocation_id": "rpi_..."
  }
}
```

`ok` says whether RunParity completed the observation operation. It does not say
that the target command passed or even started. The observation result is under
`data.report.observation.result`; target exit data applies only when
`started:true`.

`duration_ms` uses a monotonic clock from entry into process observation through
process exit or execution timeout. It can include synchronous launch preparation,
but not earlier Contract/resolution work, later cleanup, or pipe-drain time. For a
pre-launch deadline expiration it is `0` because no process-observation interval
is reported.
`timeout_phase` is `null`, `"before_launch"`, or `"execution"`; consumers should
check it together with `started` instead of inferring whether cleanup was needed
from `timed_out` alone.

Before a completed observation envelope is serialized, RunParity applies invocation
learned-secret replacement to an explicit set of evidence-bearing fields. It
then recursively applies display-control sanitization—but not learned-secret
replacement—to all string values. This keeps control-plane schema names, reason
codes, enum values, and fixed messages stable even if a learned secret happens to
equal one of them. Typed error messages use the invocation redaction context
where target argv is available. This is defense in depth, not a guarantee that
every possible secret or Unicode spoof is removed.

The `/v1` shape is the intended compatibility envelope, but package `0.0.0` is
still a prototype. Help and version remain text-oriented paths; commands intended
for machine operation require contract tests before release.

## Current offline HTML document

For `runparity --html doctor`, a completed observation writes exactly one
self-contained HTML document to stdout. Every dynamic value is HTML-escaped.
The document contains no JavaScript or external font, image, style, or network
dependency; its inline stylesheet supports narrow screens, dark preference,
keyboard-scrollable output regions, and print. Status text accompanies color,
and the evidence rail distinguishes Observation, Reference, and Experiment
without implying that planned stages ran. When the matched lookup path differs
materially from the canonical target, the command section labels both values
rather than collapsing them into one path.

HTML mode preserves the same target exit and timeout policy as human and JSON
output. `--report-only` can deliberately make a valid non-timeout report exit 0,
but an execution safety abort still exits 74 and a pre-launch deadline still
exits 124. Pre-observation CLI/resolution failures remain text unless `--json` is
selected; `--html` does not promise a document for those errors. The renderer
consumes the completed, already-redacted in-memory observation envelope only. It does not
parse arbitrary saved JSON, and the security model's redaction limitations still
apply. Review the file before sharing it.

## Current controller compatibility

The built `dist/cli.js` artifact has been executed successfully with Node
`18.20.8`, `20.19.5`, `22.22.0`, and `24.15.0`. The report classifies Node 18 and
20 as `eol_compatibility` and emits `RP_CONTROLLER_NODE_EOL`; they are retained
only so the controller can inspect legacy failure environments. Node 22 and 24
are classified as `supported_lts`.

Those four executions are current compatibility evidence, not a claim of full V1
feature support, every-platform coverage, or release qualification. Normal
development and eventual release qualification target maintained Node 22 and 24.

## Current exit behavior

`doctor` preserves the target result by default:

| Code | Current meaning |
| ---: | --- |
| 0 | Host observation completed and the target exited 0, or `--report-only` produced a valid report with `timed_out:false`. |
| target code | Host observation completed and the target returned that code. |
| 1 | The target ended without an exit code. |
| 64 | Invalid CLI usage or `--timeout` value. |
| 69 | Target executable not found. |
| 70 | Unclassified RunParity error, including infrastructure failures not yet typed more narrowly. |
| 74 | A started target reached its execution deadline and Current Host Observe cleanup is unverified, so the report is `ABORTED_SAFETY`. Both `best_effort` and `failed` cleanup override `--report-only`. |
| 77 | An unverified Windows batch shim was refused without execution. |
| 124 | The target itself returned 124, or the shared observation deadline expired before target launch. The latter has `started:false`, `timeout_phase:"before_launch"`, and `RP_OBSERVATION_DEADLINE_EXPIRED`. |
| 126 | At least one POSIX command candidate existed, but no candidate was executable. |

A target can return the same numeric value as a RunParity error. In JSON mode,
`ok:false` plus `error.code` identifies a RunParity operation failure. An
`ok:true` report can contain either a target result or a pre-launch non-start;
inspect `result.started`. For code 124, `started:false` identifies pre-launch
deadline expiration, while `started:true` with `exit_code:124` identifies a
target-returned code.

## Planned V1 installation

After publication, first use is planned as:

```text
npx runparity@latest doctor -- pnpm test
```

Repeated use should pin the package:

```text
npm install --save-dev --save-exact runparity
npx runparity doctor -- pnpm test
```

## Beginner surface

Commands and options:

```text
runparity doctor -- <executable> [args...]
runparity doctor --report-only -- <executable> [args...]
runparity doctor --attempt-proof -- <executable> [args...]
```

The first two forms are current. `--attempt-proof` is planned.

`--attempt-proof` will request a preview and, only when all policy, oracle,
artifact, and backend gates pass, an isolated experiment. It will never guarantee
`VERIFIED_INTERVENTION` and will never run an Intervention on the host.

`--report-only` requests exit zero when RunParity produced a valid report with
`timed_out:false`, while retaining the target result inside the report. Default
`doctor` continues to propagate the target result. When a started target reaches
the deadline, unverified cleanup makes it a safety abort with exit 74. A deadline
already expired before launch exits 124, because no target result exists to
normalize to success.

### Planned Windows dynamic-prefix stage

Support for official npm/npx shims that select a prefix dynamically is Planned
V1 work. The intended design must model prefix selection as a bounded,
timeout-supervised stage, validate its result, and keep it inside the same cleanup
accounting as target execution. Until that design and its adversarial tests are
implemented, Current `0.0.0` returns `RP_UNVERIFIED_WINDOWS_SHIM`/77 and never
executes the prefix helper.

## Planned V1 expert surface

Every command in this section is planned, not currently implemented:

```text
runparity self-check

runparity observation create --out observation.json -- <argv...>
runparity reference list --observation observation.json
runparity reference resolve --observation observation.json --out resolution.json
runparity reference inspect <reference>
runparity reference qualify <reference> --policy .runparity/trust.json
runparity reference capture --out reference.json -- <argv...>

runparity diagnosis create --observation observation.json --reference resolution.json --out diagnosis.json
runparity experiment plan --diagnosis diagnosis.json --finding <id> --out plan.json
runparity experiment run --plan plan.json --backend auto --out ledger.json

runparity proof show ledger.json
runparity proof verify ledger.json
runparity proof export ledger.json --out evidence/
runparity report show report.json
runparity report export report.json --format markdown|sarif|html --out <path>
runparity report gate report.json --require VERIFIED_INTERVENTION
runparity evidence dump <report-or-ledger>
```

V1 has no planned `fix`, `repair`, `apply`, `--apply`, or host experiment backend.

## Planned V1 machine-output policy

- Current `--json` writes exactly one schema-versioned document to stdout.
- Current `--html` writes exactly one self-contained offline document to stdout
  after a completed observation; saved-report import/export is still planned.
- Progress and diagnostics use stderr.
- Current doctor parse, input, command-resolution, and internal errors retain the
  same top-level envelope and a redacted typed `error` object. Planned provider,
  trust, and experiment errors must follow it.
- Human and machine output use the same verdict engine.
- Numeric confidence is not part of the public contract; evidence, missing facts,
  and stable reason codes are.
- Target streams are bounded and terminal/control sequences are sanitized before
  rendering. Current `0.0.0` additionally implements limited bidi,
  line-separator, invisible/default-ignorable hardening, compound sensitive-flag
  learning, sensitive literal shim-environment learning, provenance-aware
  evidence-field replacement, recursive display-only cleaning, boundary
  suppression markers, and invocation-scoped HMAC-SHA-256. Release qualification still
  requires broader redaction and corpus-based secret/display-control tests;
  prototype behavior must not be described as protection against every secret or
  Unicode confusable, and its digests cannot be correlated across invocations.

Planned non-`doctor` error allocations are:

| Code | Planned meaning |
| ---: | --- |
| 10 | `report gate` condition not met. |
| 64 | CLI argument, input, or schema error. |
| 69 | Requested platform, backend, provider, or executable unavailable. |
| 70 | Unclassified RunParity internal error. |
| 74 | Local I/O or execution-infrastructure failure. |
| 77 | Safety-policy refusal. |
| 78 | Trust, signature, configuration, or artifact verification failure. |
| 124 | Target observation timeout. |
| 130 | User interruption, once explicit signal handling is implemented. |

## Planned authentication and configuration

Local observation requires no account. Public GitHub References should require no
token while anonymous API limits permit. Private GitHub access will use
`GITHUB_TOKEN` or provider-native credentials; no `--token` flag is planned.
Provider integration is not implemented in `0.0.0`.
