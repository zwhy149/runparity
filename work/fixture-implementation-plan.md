# RunParity fixture implementation architecture review

> **Historical review snapshot.** This document records the corpus state on its
> review date. For current per-case status and counts, use
> `fixtures/development/index.json` and `docs/VALIDATION.md`.
>
> Review date: 2026-08-15  
> Scope: read-only review of the 16 open-development manifests, their JSON
> Schema and repository validator, the current four diagnosis families, and the
> validation protocol. This document does not promote or modify any fixture.  
> Current truth: `node fixtures/validate.mjs` passes, but all 16 cases remain
> `scaffold`, `runnable:false`, with no executable assets and no qualified OCI
> backend or A1/B/A2 ledger.

## Executive decision

The corpus is a useful design inventory, but it is not yet an executable test
plan. All 12 supported-positive mechanisms can plausibly be built as offline,
unprivileged Linux experiments after their assets have been cached, with one
exception that must first pass an empirical spike: the musl-on-glibc native
addon in `DEV-NATIVE-003`. Several cases nevertheless need specification
changes before implementation because their current oracle, target command, or
expected verdict cannot be true at the same time.

No supported case can currently produce `VERIFIED_INTERVENTION`. The prototype
has Host Observe only. It can surface a subset of the planned observations, but
it has no qualified isolation backend, ExperimentSpec compiler, arm runner,
oracle evaluator, proof-ledger verifier, or status attestor.

The implementation order should therefore be:

1. repair the corpus contract and outcome semantics;
2. build mechanism-authentic assets and attest their identity;
3. qualify one Linux OCI backend without a host fallback;
4. run fresh A1/B/A2 arms and verify a single typed delta;
5. promote status only from machine-verifiable receipts.

## Non-negotiable authenticity rules

These rules prevent a green benchmark that proves only that its own fixture can
print expected words.

1. A target may emit a case marker after a real assertion, but it must not print
   a fabricated npm, Node loader, ELF, ABI, architecture, libc, or PATH error to
   satisfy a diagnosis parser.
2. `PATH_SHADOWING` must be caused by actual executable resolution among two
   pre-existing candidates. The oracle may inspect `process.execPath`, a
   canonical path, or an adjacent signed fixture identity.
3. Runtime cases must execute real, pinned Node or package-manager artifacts.
   Changing only a version string printed by a wrapper is insufficient.
4. Native cases must call the real dynamic loader on real `.node`/ELF artifacts.
   ABI, `e_machine`, and libc dependency facts must also be independently read
   from the runtime or artifact; target stderr alone is not enough.
5. Host Observe is never an isolation adapter. Windows/macOS challenge cases
   can exercise observation and refusal only. A Windows/macOS host run and a
   Linux container arm can never form one experiment.
6. A1, B, and A2 are fresh containers from one immutable base. They share no
   writable HOME, cache, temp, output, or dependency volume. B differs only by
   the normalized delta declared by one typed Intervention.
7. The business oracle is frozen before A1 and is evaluated independently of
   the diagnosis. A case-specific success string alone cannot classify the gold
   diagnosis family.

## What the current diagnosis modules actually support

| Family | Current evidence module | Consequence for the open cases |
| --- | --- | --- |
| `PATH_SHADOWING` | `diagnosePathShadowing` emits a `candidate` when resolution finds more than one existing PATH candidate. It does not identify the intended candidate, canonical symlink chain, or create a `path.prepend` experiment. | The three PATH cases can eventually produce the category, but today they cannot prove causality or emit their declared intervention. Ambiguous runtime/version drift must be removed from their fixture design. |
| `RUNTIME_MANAGER_DRIFT` | Node is observed only when the target executable is the same file as the RunParity controller's `process.execPath`. Package-manager identity is read only from an accepted `recognized_node_shim` package manifest, a path primarily exercised on Windows. | A genuinely different Linux target Node is currently invisible; Linux pnpm provenance is also invisible. None of the three runtime fixtures has adequate target-runtime collection today. |
| `CONFIG_PRECEDENCE` | Only npm/npx boolean `fund` and `strict-peer-deps`, and only CLI, `npm_config_*` environment, and project `.npmrc`, are compared. The finding is a `candidate` and carries no Intervention. Findings are currently generated only after a non-zero target result. | `DEV-CONFIG-003` is close to the current observation surface. `DEV-CONFIG-001` uses unsupported `registry`; `DEV-CONFIG-002` uses unsupported user npmrc. All three need an assertion command that actually fails in A and passes the unchanged oracle in B. |
| `NATIVE_ABI_ARCH_MISMATCH` | Only a bounded regex over target output recognizes the standard `NODE_MODULE_VERSION A ... requires NODE_MODULE_VERSION B` form. No artifact path, ELF header, CPU architecture, libc dependency, or typed artifact selector is collected. | `DEV-NATIVE-001` can exercise the existing observation if it uses a real ABI-mismatched addon. `DEV-NATIVE-002` and `003` require new structured artifact collection and must not be simulated with stderr text. |

The current ordering also caps findings at three and evaluates native, runtime,
package manager, config, then PATH. A fixture that intentionally combines a
wrong Node version with PATH shadowing may therefore receive an arbitrary top
category. Open fixtures should isolate the family instead of teaching the
ranking to memorize ambiguous examples.

### Feasibility matrix

“Offline” below means arm execution is network-disabled after pinned OCI and
artifact blobs have been explicitly acquired and verified. It does not promise
that a fresh clone can obtain several Node/toolchain distributions without an
initial cache-seeding step.

| Case | Offline arm | Unprivileged | Linux rootless OCI | Exactly one typed Intervention | Genuine A1/B/A2 | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| DEV-PATH-001 | Yes | Yes | Yes | Yes | Yes | Rewrite to hold Node version/bytes constant and isolate provenance/PATH. |
| DEV-PATH-002 | Yes | Yes | Yes | Yes | Yes | Use a genuinely stale missing-entry launcher; avoid package-manager version drift. |
| DEV-PATH-003 | Yes | Yes | Yes | Yes | Yes | Feasible with real symlink/canonical-target evidence. |
| DEV-RUNTIME-001 | Yes | Yes | Yes | Yes | Yes | Feasible after adding target-runtime collection distinct from controller runtime. |
| DEV-RUNTIME-002 | Yes | Yes | Yes | Yes | Yes | Feasible after adding POSIX package-manager provenance. |
| DEV-RUNTIME-003 | Yes | Yes | Yes | Yes | Yes, conditional | Freeze stable runtime-slot semantics before building. |
| DEV-CONFIG-001 | Yes | Yes | Yes | Yes | Yes | Replace secret-prone/unsupported `registry` with an allowlisted boolean. |
| DEV-CONFIG-002 | Yes | Yes | Yes | Yes | Yes | Add isolated user-npmrc collection; never read the real host user file. |
| DEV-CONFIG-003 | Yes | Yes | Yes | Yes | Yes | Make the sole CLI-flag replacement explicit in the ledger. |
| DEV-NATIVE-001 | Yes | Yes | Yes | Yes | Yes | Feasible with real non-N-API artifacts from two module ABI lines. |
| DEV-NATIVE-002 | Yes | Yes | Yes | Yes | Yes | Feasible with cross-built ELF files and independent `e_machine` inspection. |
| DEV-NATIVE-003 | Conditional | Yes | Conditional | Yes | Conditional | Keep scaffold until a pinned musl/glibc loader spike is stable. |
| DEV-OOS-001 | Yes | Yes | **No; native Windows Host Observe** | N/A | No | Feasible only as observation plus unsupported-platform refusal. |
| DEV-OOS-002 | Conditional | Yes | **No; native macOS Host Observe** | N/A | No | Incoherent as written; remove timeout/detached helper or expect safety abort. |
| DEV-NEG-001 | Yes | Yes | Not as proof; Linux Host Observe by contract | N/A | No | Feasible negative, but a non-actionable verdict set is more truthful than mandatory refusal. |
| DEV-NEG-002 | Yes | Yes | Not as proof; Linux Host Observe by contract | N/A | No | Feasible redaction negative, with the same verdict correction. |

## Corpus contract defects to fix before assets

### Schema and validator

1. `fixtures/validate.mjs` checks selected fields but does not execute the JSON
   Schema validator. The earlier one-off Ajv result is useful, but repository CI
   needs Draft 2020-12 validation on every run.
2. The validator requires the suite and every case to remain `scaffold`. It will
   reject the first truthful promotion, so it is not yet a lifecycle validator.
3. The schema gives `implemented` no transition-specific constraints. A manifest
   could claim `implemented` while `runnable:false`, with no asset root or build
   receipt.
4. `verified` requires only runnable fields and a timestamp. A manually typed
   `verified_at` can satisfy it without a backend qualification receipt, arm
   ledger, oracle evidence, repetitions, or safety results.
5. The category/Intervention mapping checks only the Intervention type. It does
   not constrain targets or required parameters, so a nonsensical
   `path.prepend` target would pass.
6. Platform combinations are not fully constrained. For example, the schema can
   accept Windows with glibc or macOS with musl unless the case happens to trip a
   suite check.
7. The oracle uses `stdout_contains`, which can pass on a false-positive prefix
   or diagnostic echo. Several planned commands (`npm config get ...`) do not
   emit the declared `RUNPARITY_OK` marker at all.
8. `expected_a_failure_signature` is an opaque string, not a versioned matcher.
   It cannot state which structured facts are compared or which unstable values
   are excluded.
9. There is no asset inventory, content digest, build recipe digest, OCI image
   digest, toolchain identity, runner version, or verification-receipt digest.
10. Host `host_writes:"none"` describes fixture intent, not enforcement. Host
    Observe cannot establish a no-write isolation property.
11. Challenge cases are forced to expect `REFUSED_OUT_OF_SCOPE`, although the S0
    protocol correctly permits `REFUSED_OUT_OF_SCOPE`, `INCONCLUSIVE`, or
    `PARTIAL_EVIDENCE` without an actionable Intervention.
12. The validator does not reject unindexed case files or make the suite status a
    derivation of case receipts. It also should canonicalize manifest paths and
    reject symlink/reparse escapes before reading them.

### Required manifest shape additions

Before promotion, add or derive these concepts:

- an asset inventory containing relative path, role, media type, size, SHA-256,
  executable bit, and builder-receipt digest;
- a pinned OCI base by manifest digest, not a mutable tag;
- a versioned structured failure matcher with safe fields and normalization
  rules;
- an exact or command-based oracle with evaluator version and assertion asset
  digest;
- a normalized Intervention schema for each family, including the sole allowed
  delta;
- a verification receipt reference containing manifest digest, asset-set
  digest, backend-qualification digest, ExperimentSpec digest, three sequence
  ledger digests, safety result, runner commit, and timestamp;
- an expected-outcome object for challenge cases, allowing a non-actionable
  verdict set while independently requiring `intervention:null`;
- separate `fixture_declared_side_effects` and `enforcement` fields for host
  cases instead of implying Host Observe can enforce `host_writes:none`.

The invocation-scoped stream HMAC remains a report-surface safety probe. It must
not be used as the A1/A2 equality signature because independent invocations use
different non-persisted keys.

## Per-case implementation decisions

### PATH_SHADOWING

#### DEV-PATH-001 — feasible after removing runtime drift as a confounder

- **Offline / privilege / backend:** Yes after the OCI image and two Node
  artifacts are present. Runs as a non-root user with networking disabled.
- **Minimum assets:** one pinned Linux x64/glibc Node distribution copied into
  two content-addressed directories; an approval-identity file adjacent to only
  the intended role; `assert-node-provenance.mjs`; package metadata with no
  conflicting `engines.node`; immutable image/build receipts.
- **Build:** copy the same Node build into `shadow/bin` and `approved/bin`, hash
  both, and create the two PATH entries during arm materialization. Using the
  same Node version prevents runtime-range drift from becoming a second gold
  explanation.
- **Frozen oracle:** exit 0 and exact success marker only after the assertion
  confirms that the running executable's canonical provenance is the approved
  role. The assertion file and expected role are hashed before A1.
- **Failure signature:** non-zero assertion plus selected executable identity
  `shadow_node`, with both PATH candidates independently observed. Do not rely on
  the marker alone.
- **A/B difference:** A1/A2 PATH starts with `shadow/bin`; B applies exactly one
  `path.prepend(approved/bin)`. Image, argv, files, Node bytes, oracle, and all
  other environment entries remain identical.
- **Required rewrite:** the current phrase “wrong Node binary” invites a second
  runtime-version diagnosis. Define “wrong” as provenance/path role and hold
  Node version and bytes constant.

#### DEV-PATH-002 — feasible, but use a genuinely stale launcher rather than a fake pnpm version

- **Offline / privilege / backend:** Yes. Cache one pinned pnpm distribution and
  one pinned Node runtime in the image; no install or Corepack download is
  allowed during arms.
- **Minimum assets:** approved pnpm launcher and package, a stale executable
  launcher whose absolute JS entry target no longer exists, target project and
  lockfile, assertion script, PATH layout, receipts.
- **Build:** create both launchers before the experiment. The stale one must fail
  through real Node module resolution (`MODULE_NOT_FOUND` for its moved entry),
  while the approved one invokes the real cached pnpm of the same declared
  version. Do not make the stale launcher merely print a prepared error.
- **Frozen oracle:** the actual pnpm command reaches the assertion script, which
  emits the exact case success marker and exits 0. A never reaches it.
- **Failure signature:** selected stale launcher canonical identity plus a real
  missing-entry error class. Package-manager version must not also violate the
  Contract.
- **A/B difference:** only `path.prepend(approved_pnpm_bin)`.
- **Required rewrite:** state explicitly that the version/Contract is identical;
  otherwise this is ambiguous with `RUNTIME_MANAGER_DRIFT`.

#### DEV-PATH-003 — implemented static assets; proof remains unavailable

- **Offline / privilege / backend:** Yes; rootless creation of symlinks inside a
  fresh writable fixture layer is sufficient.
- **Minimum assets:** two regular Node launchers that forward to the same
  externally supplied absolute Node executable, a fixed marker assertion, and a
  versioned two-hop symlink recipe. The repository stores no symlink node.
- **Build:** inventory the regular files and recipe. A Linux-only Host smoke
  copies them into a temporary workspace, applies equal executable modes, then
  materializes and validates each declared link text and final contained
  canonical target path before and after execution. The build receipt does not
  authenticate that runtime chain or file/content identity.
- **Frozen oracle:** `node fixture/assert-toolchain-marker.mjs
  --assert-compatible` emits the exact success marker only through the launcher
  with the fixed compatible marker.
- **Failure signature:** resolver-selected link path, canonical incompatible
  launcher path, and `RP_FIXTURE_SYMLINK_TOOLCHAIN`.
- **A/B difference:** only `path.prepend(repository_fixture_bin)`; B must not
  rewrite the symlink.
- **Current boundary:** the fixture is `implemented`, not `verified`; backend and
  ledger receipts remain null, and the Host smoke is not A1/B/A2 evidence.

### RUNTIME_MANAGER_DRIFT

#### DEV-RUNTIME-001 — feasible; target runtime collection must be redesigned first

- **Offline / privilege / backend:** Yes. Pre-cache two official/pinned Linux
  x64/glibc Node distributions; never download a runtime in an arm.
- **Minimum assets:** wrong and matching Node distributions, package.json with a
  valid narrow `engines.node`, an assertion script, and artifact receipts.
- **Build:** expose a stable runtime slot such as
  `/opt/runparity/runtime/current/bin/node`; materialize the slot from one of two
  content-addressed runtime artifacts. The RunParity controller remains fixed
  and separate from the target runtime.
- **Frozen oracle:** assertion parses its own `process.version` against the
  hashed package constraint, then emits the exact success marker.
- **Failure signature:** structured target Node version and the exact Contract
  constraint, not the controller's version and not only target stderr.
- **A/B difference:** `runtime.select(node)` changes only the artifact mounted at
  the stable runtime slot. PATH and requested argv remain fixed.
- **Blocker:** current `observeRuntime` discards a target Node that is not the
  same file as the controller. A target-runtime probe/launch-chain collector is
  required before this case can even reach `implemented` as a RunParity case.

#### DEV-RUNTIME-002 — feasible with preinstalled real pnpm versions

- **Offline / privilege / backend:** Yes after explicit asset acquisition. Do
  not use Corepack's network-backed prepare path inside an experiment.
- **Minimum assets:** two exact pnpm package distributions, one Node runtime,
  stable package-manager slot/launchers, package.json pin, lockfile, and a script
  that validates the real lifecycle user-agent/version.
- **Build:** unpack each pnpm version into a content-addressed read-only tree and
  verify its package manifest and entry digest. Both execute under the same Node
  binary.
- **Frozen oracle:** `pnpm run assert-manager-version` reaches a script that
  checks the actual pnpm lifecycle identity against `packageManager` and emits
  the marker only on equality.
- **Failure signature:** invoked manager name/version/provenance plus exact
  packageManager constraint and non-zero assertion outcome.
- **A/B difference:** `runtime.select(package_manager)` swaps only the package
  manager artifact behind the stable slot.
- **Blocker:** current package-manager observation is not available for ordinary
  POSIX launchers. Add a strict POSIX shebang/entry-chain adapter or a safe
  manager self-identification probe with provenance before implementation.

#### DEV-RUNTIME-003 — conditionally feasible after clarifying the runtime slot

- **Offline / privilege / backend:** Yes with two pre-existing runtime paths and
  a fixed package-manager entry.
- **Minimum assets:** two pinned Node paths (the bytes/version may be identical to
  isolate provenance), a package-manager JS entry, a stable package-manager Node
  slot, expected-provenance manifest, and assertion script.
- **Build:** keep shell PATH and direct `node` fixed. Bind the package-manager
  launcher's stable Node slot first to the unintended runtime path and in B to
  the approved direct-runtime role. Record canonical executable identity from
  inside the child, preferably using an OS-backed identity such as
  `/proc/self/exe` plus file digest.
- **Frozen oracle:** the package-manager child proves its runtime canonical
  identity equals the frozen expected role before emitting success.
- **Failure signature:** direct-runtime identity differs from package-manager
  child runtime identity; versions alone are insufficient.
- **A/B difference:** one `runtime.select` changes only the target of the
  package-manager Node slot. PATH remains byte-for-byte identical.
- **Required rewrite:** the current manifest says “select Node” without defining
  whether a launcher, symlink, mount, or environment variable changes. Freeze
  the stable-slot semantics so the diff verifier can prove there was one delta.

### CONFIG_PRECEDENCE

All three cases should use an npm lifecycle assertion command rather than plain
`npm config get`. The outer command must still be npm so the observer can record
the relevant CLI/environment/npmrc sources; the lifecycle script then checks the
effective value and fails A. Plain `npm config get` normally exits 0 even when it
prints the value the fixture considers wrong, which would suppress current
findings and cannot emit the declared success marker.

#### DEV-CONFIG-001 — feasible only after replacing `registry` with a safe boolean key

- **Offline / privilege / backend:** Yes; no package installation or registry
  contact is needed.
- **Minimum assets:** pinned npm/Node, project `.npmrc`, environment manifest,
  package.json lifecycle script, effective-config assertion, receipts.
- **Build:** use `fund` or `strict-peer-deps`, not `registry`. Give the project
  and `npm_config_*` environment contradictory booleans.
- **Frozen oracle:** lifecycle assertion expects the project value and emits the
  exact marker only when the effective value matches.
- **Failure signature:** key, ordered source provenance, environment winner,
  expected value, and assertion failure.
- **A/B difference:** `config.set(environment,key,expected)` changes one
  allowlisted environment value; target argv and project file remain fixed.
- **Required rewrite:** `npm.registry` is outside the current safe-key collector,
  is URL/credential-prone, and does not need to be introduced merely to test
  precedence. Reuse an allowlisted non-secret boolean.

#### DEV-CONFIG-002 — feasible after adding isolated user-npmrc collection

- **Offline / privilege / backend:** Yes. HOME is a fresh per-arm directory
  populated only from fixture assets.
- **Minimum assets:** isolated user `.npmrc`, project `.npmrc`, pinned npm/Node,
  lifecycle assertion, and source provenance receipts.
- **Build:** use `strict-peer-deps` with contradictory values. Both files are
  immutable inputs; the project file wins in A under real npm precedence.
- **Frozen oracle:** assertion expects the isolated user value and succeeds only
  when the effective value equals it.
- **Failure signature:** key, project winner, user source, both boolean values,
  and assertion failure.
- **A/B difference:** `config.set(project_npmrc,key,expected)` is materialized as
  a single read-only overlay file in B. It must not edit the source checkout.
- **Blocker:** current collection intentionally ignores user npmrc. Add this
  source only for the isolated experiment module; do not read a real host user's
  npmrc as part of this fixture.

#### DEV-CONFIG-003 — feasible after making the CLI delta explicit

- **Offline / privilege / backend:** Yes.
- **Minimum assets:** pinned npm/Node, environment manifest, package lifecycle
  assertion, and an ExperimentSpec capable of a typed CLI-config replacement.
- **Build:** use an allowlisted boolean, with environment set to the expected
  value and one contradictory CLI flag in A.
- **Frozen oracle:** the lifecycle assertion reads the effective value, then
  emits the exact marker. The assertion script and expected value never change.
- **Failure signature:** CLI winner, environment loser, values, argv index, and
  assertion failure.
- **A/B difference:** `config.set(cli,key,expected)` replaces exactly one
  normalized CLI flag value. The ledger must treat that replacement as the sole
  typed delta rather than claiming argv is identical.
- **Required rewrite:** replace the current `npm ... config get` target with an
  npm lifecycle assertion and explicitly permit the one argv-field delta.

### NATIVE_ABI_ARCH_MISMATCH

All native artifacts use the same source revision, Node headers, optimization
flags, and exported addon contract unless the declared mismatch requires one
toolchain dimension to differ. Artifact selection occurs at a stable read-only
mount path. A real `require()`/`dlopen` is mandatory in every arm.

#### DEV-NATIVE-001 — feasible with a non-N-API addon

- **Offline / privilege / backend:** Yes after build artifacts and Node headers
  are cached. Compilation can also run unprivileged in a separate builder; arms
  perform no compilation.
- **Minimum assets:** minimal V8/NAN-style ABI-specific addon source (not a stable
  Node-API addon), matching and mismatching `.node` files, build receipts, loader
  assertion, fixed Node runtime.
- **Build:** compile the same source under two pinned Node module ABI lines using
  a pinned x64/glibc toolchain. Verify each artifact's build runtime, ELF machine,
  source hash, and output hash.
- **Frozen oracle:** the addon loads, returns the expected constant/function
  result, and only then emits the marker.
- **Failure signature:** the genuine Node loader's observed and required
  `NODE_MODULE_VERSION` values, plus the selected artifact digest. Never inject
  that sentence from fixture JavaScript.
- **A/B difference:** `nativeArtifact.select(matching_node_abi)` swaps one
  content-addressed artifact at the stable addon path.
- **Required rewrite:** record exact Node versions/module ABI values and prove the
  addon is not Node-API-compatible, otherwise the intended mismatch may not fail.

#### DEV-NATIVE-002 — feasible only with cross-built ELF artifacts and a new collector

- **Offline / privilege / backend:** Yes. A pinned cross-compiler can build arm64
  without privileged emulation; execution remains x64 rootless OCI.
- **Minimum assets:** identical addon source, x64 and arm64 glibc `.node`
  artifacts, cross-toolchain receipts, fixed Node ABI, ELF metadata inspector,
  loader assertion.
- **Build:** cross-compile the arm64 artifact and natively/cross-compile x64 with
  matching Node headers and flags. Verify `e_machine=EM_AARCH64` versus
  `EM_X86_64`, while Node module ABI and intended libc family remain fixed.
- **Frozen oracle:** real addon load and exported-value assertion.
- **Failure signature:** independently parsed artifact `e_machine`, runtime
  architecture, selected digest, and a normalized genuine loader failure class.
  Loader text alone is too platform-dependent.
- **A/B difference:** `nativeArtifact.select(matching_cpu_arch)` at one stable
  path.
- **Blocker:** the current native rule only recognizes ABI-number prose. Add a
  bounded ELF identity module before this case is eligible for promotion.

#### DEV-NATIVE-003 — keep scaffold until an empirical loader spike succeeds

- **Offline / privilege / backend:** Potentially yes, but not yet established.
  A musl-built shared addon can be statically linked or fail with host-dependent
  loader wording; neither behavior should be assumed from the manifest.
- **Minimum assets:** identical addon source, glibc and dynamically linked musl
  x64 artifacts, pinned glibc/musl toolchain receipts, ELF dynamic-section
  inspector, fixed Node ABI, loader assertion.
- **Build:** compile both artifacts with the same source and Node headers. Require
  the musl artifact receipt to show the intended musl dynamic dependency and the
  glibc artifact to show its glibc requirement. Reject a static or unexpectedly
  loadable A artifact.
- **Frozen oracle:** real addon load and exported-value assertion.
- **Failure signature:** structured libc-family evidence from ELF dependencies
  plus a normalized genuine loader failure class. A generic “file not found”
  string is insufficient.
- **A/B difference:** `nativeArtifact.select(matching_libc)` at the same path.
- **Decision gate:** run a two-image build/load spike first. If the failure is not
  stable on the pinned base, rewrite the case to a reproducible glibc symbol-
  version mismatch or remove it from the proof-eligible denominator. Do not
  manufacture a libc error string.

### Out-of-scope environment cases

These cases intentionally have no Intervention and no A1/B/A2. They can be
verified only as native Host Observe/refusal cases on their declared operating
systems. Linux OCI may test fixture scripts separately, but cannot satisfy the
case's platform claim.

#### DEV-OOS-001 — feasible as Windows Host Observe after proof-request refusal exists

- **Offline / privilege / backend:** Native Windows, offline, ordinary user,
  Host Observe only. It is not Linux-rootless proof eligible.
- **Minimum assets:** exact allowlisted npm forwarding shim, pinned local Node/npm
  fixture, Node script that invokes absolute `%SystemRoot%\System32\reg.exe`
  with a read-only HKLM query, package script, and a no-write harness snapshot.
- **Build:** use a deterministic fixture-specific absent HKLM key and query it;
  never create or delete the key and never edit system PATH.
- **Frozen outcome:** Host Observe records the genuine query failure and safe shim
  chain; an explicit future proof request is refused with
  `RP_UNSUPPORTED_PLATFORM_ISOLATION`. No repair is proposed or executed.
- **Failure signature:** Windows platform identity, query target class, read-only
  command outcome, and recognized-shim evidence. Do not infer publisher trust.
- **A/B difference:** none; any B arm would violate the manifest.
- **Blocker:** the current CLI has no proof-request/refusal flow, so it currently
  returns partial Host evidence rather than the declared refusal.

#### DEV-OOS-002 — not coherent as written; rewrite before implementation

- **Offline / privilege / backend:** Native macOS Host Observe only. It cannot be
  implemented or verified on Linux OCI.
- **Current contradiction:** the target intentionally times out with a detached
  helper. Current safety policy correctly gives every uncontained host timeout
  `ABORTED_SAFETY`/74. The manifest simultaneously requires
  `REFUSED_OUT_OF_SCOPE` for unsupported macOS isolation. Both cannot be the one
  terminal verdict.
- **Recommended rewrite:** remove the detached helper and timeout from this
  corpus case. Use a read-only native SDK discovery/build preflight, preserve the
  macOS proof request, and expect `RP_UNSUPPORTED_PLATFORM_ISOLATION`. Keep the
  detached-helper behavior in dedicated process-safety tests whose expected
  verdict is `ABORTED_SAFETY`.
- **Minimum revised assets:** macOS project metadata, read-only `xcrun`/SDK
  preflight wrapper, fixed unsupported proof request, and host no-write audit.
- **Frozen outcome:** observation plus typed platform refusal; no claim that SDK
  absence is deterministic on every host.
- **A/B difference:** none.
- **Do not implement:** a script that merely prints an SDK error, or a Linux
  container pretending to be native macOS.

### Hard negatives

The assets are straightforward, but one observation generally cannot prove that
a failure is environment-independent. The safe evaluation requirement is “no
actionable Intervention and no false verified verdict,” not a forced refusal.

#### DEV-NEG-001 — feasible as a Linux negative, but change the expected verdict contract

- **Offline / privilege / backend:** Linux ordinary-user Host Observe; no network
  and no A/B/A2. It may run in CI, but a surrounding container does not turn the
  report into isolated proof.
- **Minimum assets:** deterministic off-by-one module, standard Node assertion,
  bidi/U+2028/U+2029 output canaries, fixed input, and a harness that scans every
  persisted report byte.
- **Frozen oracle/signature:** stable standard assertion class, stack source
  location, exit code, and input digest. Unicode controls are a rendering probe,
  not evidence for the failure family.
- **Expected outcome:** `PARTIAL_EVIDENCE` or `INCONCLUSIVE`, zero Intervention,
  zero `VERIFIED_INTERVENTION`, and all display controls neutralized. Permit
  `REFUSED_OUT_OF_SCOPE` only after a generic, pre-registered code-defect
  classifier exists.
- **A/B difference:** none.
- **Required rewrite:** replace the mandatory refusal with a set of allowed
  non-actionable verdicts, consistent with the S0 protocol.

#### DEV-NEG-002 — feasible as a redaction negative, but do not over-classify it

- **Offline / privilege / backend:** Linux ordinary-user Host Observe; no network
  and no experiment.
- **Minimum assets:** frozen malformed JSON/data document, deterministic schema
  validator, assertion script, non-secret canary passed through `--api-key`, and
  a report/filesystem canary scanner.
- **Frozen oracle/signature:** standard validation failure code, input digest,
  and stable JSON pointer. The canary must appear in target inputs and attempted
  output but nowhere in rendered/persisted RunParity artifacts.
- **Expected outcome:** `PARTIAL_EVIDENCE` or `INCONCLUSIVE`, no Intervention, no
  false environment family, and no plaintext canary. A typed
  `RP_UNSUPPORTED_FAILURE_DOMAIN` refusal is optional only when supported by a
  generic parser rather than the fixture marker.
- **A/B difference:** none.
- **Required rewrite:** same expected-outcome change as `DEV-NEG-001`.

## Deepened runner architecture

The following modules are intentionally deep: each exposes one small lifecycle
operation while keeping safety, ordering, and evidence invariants local. The
deletion test is useful here—deleting any one of them would force its complexity
to reappear in every family runner and every verification test.

### Stage 0 — FixtureCatalog module

Loads the suite through one interface, runs Draft 2020-12 validation plus suite
invariants, canonicalizes all paths, rejects unindexed/duplicate assets, and
returns an immutable catalog with manifest digests. JSON Schema validation and
cross-case policy live behind the same seam so callers cannot accidentally run a
partially checked manifest.

### Stage 1 — AssetBuilder and AssetInspector modules

`AssetBuilder` has family adapters for scripted fixtures, runtime distributions,
package managers, and native addons. It produces a content-addressed asset set
and build receipt. Network acquisition, when required, is a separate explicit
cache-seeding step. Actual builds and all experiment runs use networking off.

`AssetInspector` independently checks the claimed facts: executable mode and
hash, package manifest/version, Node module ABI/build runtime, ELF machine and
dynamic dependencies, symlink graph, and absence of undeclared files. A builder
cannot attest its own claims merely by writing metadata.

### Stage 2 — BackendQualifier module

The only V1 experiment adapter is Linux OCI. A scripted in-memory adapter may
exercise runner state transitions in tests, but can never issue a qualification
receipt.

Qualification is keyed by host platform, engine/version, OCI image digest, and
policy digest. It must demonstrate, not merely configure:

- target UID/GID are non-zero;
- all capabilities are dropped and no-new-privileges is active;
- root filesystem and source mount are read-only;
- HOME/cache/temp/output are fresh scoped writable mounts;
- network egress is unavailable;
- PID, memory, CPU, output, and wall-clock limits are effective;
- host credentials, SSH/GPG/cloud files, and engine socket are absent;
- writes cannot escape approved mounts;
- detached children disappear when the arm is destroyed; and
- no prior arm's writable state is visible in the next arm.

Failure yields `RP_SANDBOX_UNAVAILABLE` or `RP_SAFETY_GUARD_TRIGGERED`; it never
falls back to Host Observe for proof.

Current workstation note: `docker.exe` 29.6.1 is installed with the
`desktop-linux` context, but on review the Docker API was unavailable because no
server was running. This is only a tooling observation, not backend
qualification.

### Stage 3 — ExperimentCompiler module

Compiles one validated case, asset receipt, qualified backend receipt, and frozen
oracle into an immutable ExperimentSpec. It creates normalized A and B arm specs,
then performs a structural diff before execution:

- A1 and A2 specs are identical except freshness IDs;
- B has exactly one normalized Intervention record;
- every resulting environment, argv, mount, runtime slot, artifact slot, and
  policy difference is attributable to that Intervention; and
- source, input, oracle, network/resource policy, and output contract are fixed.

The compiler refuses ambiguous runtime/PATH combinations or a config change that
also edits the oracle.

### Stage 4 — IsolatedArmRunner module

For each of three repetitions, creates and destroys fresh A1, B, and A2 arms in
order. It never reuses writable layers or volumes. Target execution is an
explicit executable plus argv, not a shell string. Output collection stays
bounded and redacted before its first disk write. The module returns arm evidence
and cleanup evidence; it does not decide the verdict.

### Stage 5 — family EvidenceAdapter modules

Use one adapter per real evidence source, not one per fixture ID:

- executable resolution/canonical identity and symlink graph;
- target Node and package-manager identity/provenance;
- npm effective configuration and source ordering;
- native artifact ABI/ELF architecture/libc metadata and loader result.

Adapters must not read gold labels or expected markers. This keeps open-fixture
helpers from becoming hidden classifier inputs and gives the same interface to
future sealed cases.

### Stage 6 — FailureSignature and OracleEvaluator modules

`FailureSignature` converts allowlisted structured facts into a versioned
canonical JSON signature. It excludes timestamps, PIDs, temporary paths,
container IDs, addresses, stack line noise, and arbitrary raw output. Family
examples are:

- PATH: selected/canonical executable role plus typed target assertion;
- runtime: observed target identity versus frozen Contract selector;
- config: key, ordered sources, values, and winner;
- native: selected artifact digest, ABI/ELF/libc mismatch facts, and normalized
  loader error class.

A1 and A2 compare these canonical signatures. Stream HMACs remain independent
safety metadata and are not expected to match across arms.

`OracleEvaluator` separately executes or evaluates the pre-frozen assertion.
Its input digest and evaluator version are in the ledger. B must satisfy the
whole oracle; a bare exit zero or echoed marker is insufficient unless that was
explicitly justified before execution.

### Stage 7 — SafetyAuditor and ProofLedgerVerifier modules

`SafetyAuditor` validates network denial, write inventory, credential/secret
canaries, output sanitization, process cleanup, resource ceilings, and the exact
Intervention diff. Any zero-tolerance breach aborts verification.

`ProofLedgerVerifier` is the sole module allowed to derive progress and verdict.
For each of three sequences it requires:

1. A1 reproduces the frozen structured failure signature;
2. B satisfies the unchanged oracle;
3. A2 independently reproduces the A1 signature;
4. all three arms use the same qualification and base digests;
5. B's complete normalized spec differs by exactly one allowed Intervention;
6. every safety assertion passes.

It can emit `VERIFIED_INTERVENTION`; family adapters, fixture manifests, AI text,
and expected labels cannot.

### Stage 8 — StatusAttestor and SuiteRunner modules

`StatusAttestor` cross-checks receipts with current manifest/assets/backend/runner
digests and derives whether a declared status is valid. `SuiteRunner` schedules
cases and reports counts but cannot bypass the attestor. This provides locality:
status truth is fixed once rather than reimplemented in docs, scripts, and CI.

Suggested commands, after the modules exist:

```text
runparity-fixtures validate
runparity-fixtures assets build --case DEV-PATH-001 --offline
runparity-fixtures backend qualify --backend linux-rootless-oci
runparity-fixtures case run --case DEV-PATH-001 --repetitions 3
runparity-fixtures case verify --case DEV-PATH-001 --ledger <path>
runparity-fixtures suite verify --suite open-development-v1
```

## Truthful status migration rules

Status is a claim about checked evidence, not a maintainer's confidence.

### `scaffold`

- Manifest and gold design exist.
- `runnable:false`, `asset_root:null`, `verified_at:null`.
- Missing assets/checks are explicit.
- No S0 numerator may include the case.

### `implemented`

Promotion requires all of the following:

- `runnable:true` and a canonical repository-contained asset root;
- complete asset inventory and successful independent asset inspection;
- pinned build/base inputs and builder receipt;
- a dry run through the intended execution context;
- supported positives genuinely reproduce A once and make their frozen oracle
  pass under a manually selected known-good asset; challenge cases reproduce
  their intended observation safely;
- no claim of reproducibility, qualified isolation, proof, or S0 credit;
- `verified_at:null` and an explicit list of outstanding verification gates.

Do not promote a case whose target merely prints the expected signature.

### `verified`

For a supported positive, promotion requires:

- an unexpired backend qualification receipt matching the exact engine, image,
  and policy digest;
- three complete fresh `(A1 -> B -> A2)` sequences;
- identical normalized A1/A2 failure signatures in every sequence;
- unchanged frozen oracle passing in every B;
- exact one-Intervention diff in every sequence;
- all safety probes and zero-tolerance checks passing;
- manifest, assets, builder, ExperimentSpec, runner commit, and ledger digests in
  the verification receipt;
- `verified_at` generated from the receipt, not entered as standalone evidence.

For a challenge case, promotion requires three stable native-platform Host
Observe runs (or the pre-registered challenge repetition count), a permitted
non-actionable verdict, no Intervention, no false verified verdict, and all
applicable redaction/display/process safety checks. It never gets an A1/B/A2
proof ledger.

### Automatic invalidation and suite status

- Any manifest, oracle, signature parser, asset, builder, backend-policy, image,
  or verdict-engine digest change makes the prior receipt stale. A manifest still
  claiming `verified` must fail validation until reverified or downgraded.
- Backend qualification expires on engine/image/policy changes even if fixture
  assets did not change.
- No direct `scaffold -> verified` claim is accepted without both implementation
  and verification receipts; CI may generate them in one workflow, but the
  evidence stages remain distinct.
- Suite status is derived: `scaffold` when all cases are scaffold,
  `in_progress` when any case is implemented/verified but not all are verified,
  and `verified` only when all 16 current receipts validate. The index must not
  hard-code `scaffold` forever.
- S0 still requires its aggregate thresholds; 16 individually verified assets
  do not by themselves prove the category and safety thresholds unless the
  frozen S0 evaluator passes.

## Implementation tranches

1. **Contract tranche:** update schema/validator and fix the five incoherent
   outcomes: all three config oracle/target combinations, `DEV-OOS-002`, and the
   two hard-negative verdict semantics (the two negatives share one schema
   change). Add receipt schemas before any status promotion.
2. **Small authentic tranche (static assets complete):** `DEV-PATH-003`,
   `DEV-NEG-001`, and `DEV-NEG-002` now exercise catalog/build/canary mechanics
   without claiming isolated intervention verification.
3. **OCI tranche:** qualify the Linux backend and implement `DEV-PATH-001..003`
   end to end. PATH has the smallest external toolchain surface and is the best
   first A1/B/A2 vertical slice.
4. **Safe config tranche:** implement `DEV-CONFIG-001` and `003`; then add the
   isolated user-npmrc adapter for `002`.
5. **Runtime tranche:** add target-runtime/package-manager provenance, then build
   the three pinned runtime cases.
6. **Native tranche:** build ABI case first, architecture second, and gate libc
   on its empirical spike. Do not count `DEV-NATIVE-003` in a denominator until
   its harness validity is established under the pre-registered rule.
7. **Native-platform refusal tranche:** implement Windows/macOS cases only on
   their native hosts after the refusal interface exists. Never fill this gap
   with Linux simulation.

## Five highest-risk decisions for the maintainer

1. **Reject all Host fallback for proof.** The Docker client exists but its
   server was unavailable during review, and no backend has qualification
   evidence. Starting a target on the host or in an unqualified container must
   produce a refusal/inconclusive result, never a synthetic A1/B/A2 ledger.
2. **Require real native artifacts and independent metadata.** `DEV-NATIVE-002`
   and `003` cannot be implemented by printing plausible loader errors.
   `DEV-NATIVE-003` remains scaffold unless the pinned musl/glibc spike yields a
   stable genuine failure.
3. **Create a cross-arm structured signature instead of comparing invocation
   HMACs.** Per-invocation keys intentionally make current stream digests
   incomparable. Reusing or persisting those keys would weaken the privacy
   invariant; comparing raw output would create both instability and secret
   risk.
4. **Fix expected-outcome semantics before teaching the classifier.** The
   timeout in `DEV-OOS-002` must be split from platform refusal, and one Host
   Observe cannot justify mandatory `REFUSED_OUT_OF_SCOPE` for both hard
   negatives. Otherwise implementation pressure will reward overconfident
   verdicts.
5. **Make status receipt-derived and close current collector gaps before S0.** A
   timestamp is not verification. The current runtime collector misses a
   different target Node and ordinary Linux pnpm, config covers only two boolean
   keys/three sources, and native covers only ABI prose. Promoting manifests
   before these evidence modules and receipts exist would turn scaffold metadata
   into a false product claim.
