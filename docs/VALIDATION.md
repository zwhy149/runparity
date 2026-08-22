# RunParity validation protocol

> **Protocol status (2026-08-22):** The 16-case open-development manifest corpus
> and its machine validators exist. All 16 cases are truthfully marked
> `implemented` from recomputed non-empty
> asset inventories and syntax-checked entrypoints bound to their planned target
> argv. `DEV-NATIVE-001` has real same-source Node 22 ABI 127 and Node 24 ABI
> 137 Linux x64/glibc layers, and `DEV-NATIVE-002` has real same-source Node 22
> ABI 127 Linux x64 and AArch64 layers, while `DEV-NATIVE-003` has real
> same-source Node 22 N-API v1 Linux x64/glibc and musl layers, plus bounded Linux Host smokes; no case is
> `verified`. The
> sealed corpus, comparator runs, and independent field study do not exist.
> Prototype tests and valid manifests are prerequisites, not substitutes for any
> gate below. Current release status is **pre-S0**.

## Purpose

This protocol tests whether RunParity distinguishes supported environment failures from plausible but unsupported cases, produces reproducible intervention evidence, avoids unsafe actions and secret persistence, and improves over snapshot-only diagnostics. Results apply only to the declared corpus.

## Corpus

Planned total: 96 cases. Currently present: 16 open manifests (0 scaffold, 16
implemented) and zero sealed cases.

### Open development set — 16

- 12 supported positives: three per V1 category.
- Two out-of-scope environment failures.
- Two non-environment hard negatives.
- Used for implementation and S0; never included in formal S1 metrics.

Current structured inventory:

| Kind/category | Case IDs | Platform and proof | Current status |
| --- | --- | --- | --- |
| `PATH_SHADOWING` | `DEV-PATH-001..003` | Linux x64/glibc; proof-eligible | 0 scaffold, 3 implemented target assets |
| `RUNTIME_MANAGER_DRIFT` | `DEV-RUNTIME-001..003` | Linux x64/glibc; proof-eligible | 0 scaffold, 3 implemented target assets |
| `CONFIG_PRECEDENCE` | `DEV-CONFIG-001..003` | Linux x64/glibc; proof-eligible | 0 scaffold, 3 implemented target assets |
| `NATIVE_ABI_ARCH_MISMATCH` | `DEV-NATIVE-001..003` | Linux x64/glibc; proof-eligible | 0 scaffold, 3 implemented target assets |
| Out-of-scope environment | `DEV-OOS-001`, `DEV-OOS-002` | Windows x64 and macOS arm64 Host Observe; not proof-eligible | 0 scaffold, 2 implemented |
| Hard negative | `DEV-NEG-001`, `DEV-NEG-002` | Linux x64 Host Observe; not proof-eligible | 0 scaffold, 2 implemented |

The supported development cases are all designed for the Linux isolation backend
so the S0 `9/12` proof threshold is arithmetically possible. Windows and macOS
cases exercise Host Observe and refusal boundaries only.

### Open-corpus machine contract

- Case schema: `fixtures/schema/case-manifest.schema.json` (JSON Schema Draft
  2020-12).
- Suite index: `fixtures/development/index.json`.
- Case manifests: `fixtures/development/cases/*.json`.
- Evidence registry: `fixtures/evidence-sources.json`.
- Repository validator: `node fixtures/validate.mjs`.

Every case declares its gold category or explicit absence of one, platform,
proof eligibility, frozen oracle, single allowed typed Intervention or expected
non-actionable outcome, source evidence IDs, planned failure signature, safety
probes, and implementation truth state.

The repository validator enforces the exact 12/2/2 composition, three supported
cases per category, evidence-ID resolution, category/intervention mapping,
Linux-only proof eligibility, host-network wording, challenge outcome semantics,
receipt containment and digest links, and derived lifecycle status. Every
invocation also compiles the case schema with Ajv in Draft 2020-12 mode and
validates all 16 manifests; this is part of the gate, not a one-time external
check. Its public CLI behavior has failure-sample regression tests in
`fixtures/validator.test.mjs`. These checks establish metadata and local build
receipt validity only; they do not create fixture execution evidence.

Current status-derivation rules:

- `scaffold`: no runnable claim; assets are absent and listed as missing; build,
  backend-qualification, and verification-ledger receipt slots are explicitly
  `null`.
- `implemented`: the validator recomputes a bounded non-empty regular-file
  inventory, verifies its digest and the manifest digest, requires a contained
  inventoried `.mjs` entrypoint bound to `scenario.planned_target_argv`, performs
  bounded `node --check` without running it, and rechecks the inventory. The
  receipt must disclose
  `unqualified_live_tree`; this state is static local build evidence only.
  `runnable=true` and `missing_assets=[]` describe only the direct static target.
  They do not imply that runtime images, an isolation backend, A/B/A2 arms, an
  oracle runner, or cleanup evidence exist; null backend and ledger slots record
  those missing proof capabilities.
  Build receipt v1 binds regular-file paths and bytes, not POSIX executable mode;
  mode-dependent Host tests must create controlled temporary copies and record
  the mode they apply.
- `verified`: reachable since 2026-08-22 through the independent evidence
  verifier in `fixtures/lib/evidence-verifier.mjs` (see ADR-0005). A case
  derives `verified` only when (a) its backend qualification receipt carries
  control judgments that are all `demonstrated` and binds its collected facts
  sidecar by canonical-JSON SHA-256, and (b) its A1/B/A2 ledger passes full
  independent re-derivation: failure signatures recomputed from the embedded
  bounded observations, the frozen oracle re-evaluated, the single
  `path.prepend` intervention diff re-derived from normalized argv, A1≡A2
  and cross-sequence signature stability re-checked, and safety flags
  (containers removed, per-arm homes fresh, all arms completed) re-asserted.
  `DEV-PATH-001` is the first case to hold this status, verified against the
  QEMU-KVM dedicated Ubuntu 24.04.4 VM backend (rootless Podman 4.9.3,
  non-root VM account) whose receipt records all eleven controls
  demonstrated, including the host-kernel-truth binding of the nested user
  namespace. Self-authored receipts still fail: without genuine arm evidence
  the re-derivation rejects them on specific, named problems.

The validator derives `scaffold`, `implemented`, or `verified` and rejects a
different declared status. It recomputes local build assets rather than
treating receipt links alone as evidence, and recomputes ledger claims rather
than trusting the runner that authored them. Protocol amendment (ADR-0005):
the ledger binds the manifest by its evidence projection — canonical JSON
minus the four promotion fields (`fixture_status`, `verified_at`, the
backend and ledger receipt slots) — so promotion does not invalidate the
bound evidence while any scenario, oracle, intervention, platform, or safety
change does.

Current scenario calibrations are deliberate:

- `DEV-PATH-001` uses two fixed POSIX launchers that forward to the same
  externally supplied absolute Node executable. The launchers differ only in a
  fixed fixture marker. Its Linux-only Host smoke applies the same executable
  mode to temporary copies, runs both PATH orders, and requires the failing order
  to expose both canonical candidates plus `RP-PATH-0001`. This remains Host
  Observe and does not establish a single-variable isolated intervention.
- `DEV-PATH-002` pairs an approved pnpm launcher chain with a stale launcher
  whose absolute Node entry target no longer exists, so the A failure is a
  genuine `ERR_MODULE_NOT_FOUND` before any fixture marker can print. Its
  Linux-only Host smoke requires the failing PATH order to expose both canonical
  candidates with `RP-PATH-0001`. The launchers carry the same declared manager
  identity; the case does not mix in package-manager version drift.
- `DEV-PATH-003` inventories two regular Node launchers and a versioned two-hop
  symlink recipe. Its Linux-only Host smoke materializes that recipe in a fresh
  temporary workspace, validates each link text plus the contained, executable
  final canonical target paths before and after execution, and requires the
  failing order to expose both canonical candidates with `RP-PATH-0001`. The
  materialization planner additionally fails closed on escaping paths, duplicate
  or self-referential links, malformed recipe keys, and symlinked or junction
  workspace roots. Build
  receipt v1 binds the inventoried regular recipe and launcher bytes. It does not
  authenticate the files reached through runtime-created links, their executable
  mode, their containment at execution time, or a verified Intervention.
- `DEV-RUNTIME-001` reads the frozen `package.json` range
  `>=22.0.0 <23.0.0` and evaluates the version exposed by Node under a controlled,
  no-preload invocation. Repository tests exercise success under Node 22 and
  failure under Node 24 as Host smoke observations. The target rejects non-empty
  `NODE_OPTIONS` or `execArgv` to catch accidental preload configuration, but
  same-process code can tamper with process state; this check is not executable
  identity evidence. These observations are not isolated A1/B/A2 arms and do not
  count toward S0.
- `DEV-RUNTIME-002` binds two pnpm launcher chains with distinct adjacent
  version markers to one externally supplied Node and a frozen
  `packageManager` pin of `pnpm@9.15.0`; the wrong-version chain fails the
  assertion with `RP_FIXTURE_PACKAGE_MANAGER_VERSION`. The static markers are
  adjacent fixture identity, not real pnpm artifacts; the future runner must
  bind actual preinstalled pnpm version identity externally.
- `DEV-RUNTIME-003` binds the package-manager launcher to the unintended
  runtime-manager slot while PATH keeps resolving direct `node` to the approved
  slot; the assertion reports the provenance split with
  `RP_FIXTURE_RUNTIME_PROVENANCE_SPLIT`. Again the static roles are adjacent
  fixture identity; the future runner must bind executable identity externally.
- `DEV-CONFIG-001`, `DEV-CONFIG-002`, and `DEV-CONFIG-003` use the allowlisted
  non-secret booleans `fund` and `strict-peer-deps` with contradictory
  environment, project-`.npmrc`, user-`.npmrc`, and forwarded-CLI-flag sources.
  npm lifecycle scripts do not receive file- or CLI-sourced configuration
  through the environment, so each assertion asks a real
  `npm config get` invocation for the effective value; gated real-npm smokes
  exercise genuine precedence on hosts where npm exists. Current `0.0.0` can
  still record only an unqualified `config_source_conflicts` observation for the
  environment-versus-project case.
- `DEV-NATIVE-001` inventories two content-addressed Linux x64/glibc addons
  compiled from the same source against Node 22 module ABI 127 and Node 24 module
  ABI 137 headers. Its default Node 22 Host smoke receives Node's genuine
  `NODE_MODULE_VERSION` rejection for the ABI-137 layer; a temporary recipe
  selection of the ABI-127 layer succeeds. The loader rejects malformed recipes
  and hash mismatches before calling the native loader. These are bounded Host
  observations, not isolation, executable-identity, arm, or intervention proof.
- `DEV-NATIVE-002` inventories two content-addressed Linux/glibc addons compiled
  from the same source and Node 22 ABI 127 headers: one x64 and one AArch64.
  Its default loader first verifies the selected bytes' SHA-256, then parses the
  ELF64 little-endian `e_machine` field and rejects the AArch64 layer before
  calling `require`. A separate Linux Host smoke directly calls Node on that
  AArch64 file and records its genuine, generic `ERR_DLOPEN_FAILED`; it does not
  infer the CPU from that text. A temporary selection of the x64 layer loads and
  emits the frozen marker. These checks are static/header and Host behavior
  evidence only, not isolation, executable-identity, arm, or intervention proof.
- `DEV-NATIVE-003` inventories two content-addressed Linux x64 addons compiled
  from the same C N-API v1 source and Node 22 headers: one glibc and one musl.
  Its default loader first verifies the selected bytes' SHA-256, then parses the
  ELF64 little-endian dynamic section and linked string table to establish the
  musl layer's `DT_NEEDED libc.so` dependency before calling `require`. A
  separate Linux Host smoke directly calls Node on that layer and records the
  genuine glibc-loader `ERR_DLOPEN_FAILED`/`invalid ELF header`; it does not
  infer libc from that text. A temporary selection of the `DT_NEEDED libc.so.6`
  glibc layer loads and emits the frozen marker. These checks are static/dynamic
  table and Host behavior evidence only, not isolation, executable-identity,
  arm, or intervention proof.
- `DEV-OOS-001` performs a genuine read-only `reg.exe` query of one
  deterministic absent HKLM value on Windows; the key is never created or
  deleted. The declared `REFUSED_OUT_OF_SCOPE` proof request has no CLI flow
  yet, so Host runs honestly record `PARTIAL_EVIDENCE`.
- `DEV-OOS-002` is a read-only macOS SDK preflight plus unsupported-platform
  refusal. It no longer spawns a detached helper or times out; an uncontained
  Host execution timeout after target launch would require `ABORTED_SAFETY`, not
  `REFUSED_OUT_OF_SCOPE`.
- `DEV-NEG-001` and `DEV-NEG-002` both expect `PARTIAL_EVIDENCE`: each target
  completes with a reproduced failure, while one Host Observe run cannot prove
  environment independence. Both require `Intervention=null` and no typed
  refusal.

Changing a gold label to match tool output is forbidden. A label change requires
a documented protocol amendment and review.

### Sealed in-scope set — 48

- Twelve cases per V1 category.
- Per category: eight Linux proof-eligible, two Windows observe-only, and two macOS observe-only.
- Intended Linux proof-eligible count: 32.

### Sealed scope-challenge sets — 32

- Sixteen real environment failures outside V1.
- Sixteen code, data, remote-service, or flaky failures that resemble environment drift.

## Sealing and bias controls

Before evaluation, an independent curator hashes each fixture identity, gold category, allowed Intervention, signature normalization, oracle, proof eligibility, platform, and required refusal code. Tool developers receive only evidence available to an ordinary user. Cases cannot be excluded because RunParity failed them. Invalid-harness exclusions and reasons are published.

The development and sealed sets may not share repositories, distinctive error strings, generated templates, or trivial parameter variants. The system under test, rule pack, prompts, dependencies, and Git commit are frozen before labels are unsealed.

## Prototype evidence-control status

These implementation controls now have source and regression-test evidence. The
implemented PATH/runtime/config/native targets and the implemented negative and
out-of-scope fixtures exercise
only narrow Host Observe, launcher-chain, real-npm precedence, display-hardening, and redaction paths; neither they nor the
two native-ABI scaffolds and the implemented native Host smoke pass S0 by themselves:

- **Invocation-scoped HMAC:** captured stdout/stderr use
  `digest.algorithm=HMAC-SHA-256` with `key_scope=invocation`; an unkeyed stream
  digest is not part of the Current contract. Digests are not comparable across
  invocations.
- **Allowlisted provenance projections:** Contract, project `.npmrc`, and
  adjacent package-manager manifest provenance use SHA-256 over their respective
  allowlisted semantic projections. They do not hash the raw source files or
  unrelated secret-prone fields.
- **Unicode/display sanitization:** VT sequences, C0/C1 controls, bidi formatting
  controls, selected invisible separators, and BOM are removed; U+2028/U+2029
  are normalized to newlines. This is display hardening, not arbitrary Unicode
  confusable detection.
- **Sensitive inputs:** values supplied through recognized token, password,
  secret, private-key, client-secret, API-key, and access/auth-token flag forms,
  plus values from recognized sensitive environment-variable names, are learned
  per invocation and redacted from evidence fields and captured streams. This is
  not a claim to recognize every possible secret format.
- **Boundary-aware excerpts:** a learned secret shorter than 12 UTF-8 bytes
  suppresses the complete captured excerpt; short or multiline secrets in a
  truncated excerpt produce `[REDACTED_BOUNDARY]`. Learned-secret replacement is
  limited to evidence fields, while recursive cleaning of control-plane strings
  is display-only.
- **Recognized Windows shims:** the public launch kind is
  `recognized_node_shim`, not `verified_node_shim`. It records a generic ordered
  Node-forwarding grammar with literal set/unset semantics executed without
  `cmd.exe`; it is not publisher-signature or forwarded-file authenticity proof.
  Exact official npm/npx dynamic-prefix shims are refused with exit 77 before the
  helper runs. A supervised staged implementation remains planned.
- **Launch semantics:** Current tests require the `--` target separator, native
  requested-`argv0` preservation, POSIX case-sensitive PATH/X_OK behavior, and
  Windows working-directory/PATH/PATHEXT ordering. These are resolver behavior
  checks, not file-authenticity evidence.
- **RunSpec/ObservedRun boundary:** Current tests require defensive argv and
  environment snapshots, a frozen/opaque RunSpec whose captured values cannot be
  recovered or tampered with through normal inspection/reflection and which
  serializes as `{}`, one resolved cwd/workspace snapshot, and a safely
  serializable ObservedRun without raw LaunchPlan args, shim mutation values, or
  captured environment values.
- **Shared monotonic deadline:** the absolute deadline begins at RunSpec capture
  and is not reset before launch. A second check after synchronous launch
  preparation and immediately before `spawn` must prevent a late target start.
  The process result records `started`, monotonic `duration_ms`, and
  `timeout_phase`. An expired pre-launch deadline must leave a side-effect marker
  absent, emit `RP_OBSERVATION_DEADLINE_EXPIRED`, and record
  `cleanup.attempted=false`/`status=not_required`.
- **Timeout cleanup:** Host Observe records
  `containment=uncontained_host`. POSIX process-group and Windows `taskkill /T`
  cleanup is `best_effort` with `RP_PROCESS_TREE_NOT_CONTAINED`, because an
  already detached descendant cannot be proven stopped. Both `best_effort` and
  direct cleanup failure produce `ABORTED_SAFETY` and exit 74. Windows tests also
  require the opaque controller capability to remain usable when the target
  environment omits `SystemRoot` and when ambient `SystemRoot` changes after
  RunSpec capture. The execution timer is canceled at target exit; a separate
  bounded post-exit drain can report incomplete capture without turning the
  completed target into a timeout.
- **Host outcome classifier:** raw Host process evidence is runtime-classified
  into a discriminated state before a pure deterministic decision produces the
  report/result status, verdict, reason code, and warnings. Tests reject
  impossible combinations and reject `verified` for uncontained Host cleanup.
  This is internal implementation evidence, not a new public CLI or containment
  guarantee.
- **ExperimentCompiler:** source tests cover a pure opaque, plan-only compiler
  for exactly A1/B/A2 with A controls rebuilt from one frozen base and B carrying
  only a normalized `path.prepend` delta. It requires all fixed-input and plan
  SHA-256 digests, unique freshness IDs, and absolute POSIX/drive-qualified
  Windows directories; its inspection summary omits command, PATH, and directory
  values. It does not execute arms, expose a preview, or create a backend receipt
  or proof ledger.
- **Supervised control-plane process:** source tests run a fixed Node fixture
  through the same absolute-deadline, bounded-stream, process-tree and drain
  lifecycle used by Host Observe. The opaque adapter creates its own minimal
  environment rather than inheriting target or later ambient values, and one
  combined 128-argument/64-KiB budget covers fixed plus per-stage argv. Output
  overflow, invalid UTF-8, incomplete drain, timeout, termination, a post-launch
  or unclassified supervisor failure, or any normally exited but still
  `uncontained_host` process produces a safety result with no returned stream
  text. Tests separately preserve a typed, proven pre-launch launch failure as
  `not_started`; an unknown rejection cannot enter that branch. Its
  process-backed OCI bridge is therefore a refusal tracer only: the parser stops
  at `context` with
  `RP_SAFETY_GUARD_TRIGGERED`. It is not a production Docker transport and
  creates no qualification, receipt, arm, ledger, or verdict.
- **Inert record boundary:** source tests a shared, shallow exact-record
  descriptor snapshot that rejects proxies, custom prototypes, symbols, hidden
  fields, accessors, missing fields, and extra fields without invoking getters
  or thenables. Missing keys and accessor values cannot be supplied through a
  polluted descriptor prototype, and the `then` policy key is rejected. It does
  not recursively certify nested values; each domain caller must continue
  validation synchronously. Parallel regressions lock the same own-descriptor
  rule for privilege arrays, control-plane adapter/argv records, and asset
  inventory limit options.
- **Fixed Linux guest privilege probe artifact:** source tests a synchronous,
  fixed-source program with no accepted argv, environment/cwd configuration,
  stdin, subprocess, shell, network, or file-write path. Linux `x64` is
  normalized to `amd64`; other runtime pairs refuse before reading. The Node
  adapter incrementally reads only `/proc/self/status`, self UID/GID maps, and
  kernel overflow UID/GID under per-source cap+1 buffers. `ENOENT`/`ENOTDIR`
  become explicit missing cells; other I/O, invalid UTF-8, malformed adapter
  responses, or size limits fail the whole probe without partial output. The
  private built artifact is syntax-checked, absent from `package.bin`, rejects
  arguments first, writes one JSON line only on a Linux/x64 Host smoke, and
  otherwise emits fixed ASCII errors. A successful program state is named
  `assembled_unverified_bundle`; no helper digest or source/session identity is
  claimed. The source has no environment/cwd configuration, but Node loader and
  pre-entry environment state are not bound or trusted. No preflight, backend,
  receipt, policy, or verdict consumes the output.
- **Linux guest privilege bundle decoder:** source tests an exact, inert bundle
  with explicit observed-or-missing platform, `/proc/self/status`, UID/GID map,
  and overflow-ID slots. Observed strings must use bounded ASCII/HT/LF source
  grammars: 128 bytes for platform, 64 KiB for status, 8 KiB per map, and 32
  bytes per overflow ID, with independent line and field limits. Duplicate or
  malformed relevant status fields, noncanonical/reserved IDs, overlapping map
  ranges, unsafe controls, or an over-budget artifact invalidate the bundle;
  they are never downgraded to missing. Paired map and overflow sources become a
  whole missing fact group if either slot is explicitly missing. Success is
  named only `decoded_unqualified_facts`; an observed empty map stays observed so
  the policy can report unmapped process identities rather than losing the
  contradiction as missing evidence. The decoder discards all raw text and
  carries `sourceAssurance: "caller_supplied_unverified"`; the
  target-self-to-parent view remains a protocol claim.
  Tests feed the decoded facts into the separate policy only to preserve its
  contradiction and ambiguity judgments. The decoder does not authenticate a
  file, collector, process, namespace, opener, or capture session and emits no
  readiness, qualification, receipt, authorization, ledger, verdict, or proof.
- **Linux guest privilege policy:** source tests descriptor-snapshot six
  explicitly observed-or-missing fact groups, reject active/malformed graphs and
  bounded-range violations, and apply a stable contradiction policy to guest
  platform, four UID/GID states and supplementary groups, separately observed
  overflow IDs,
  target-self-to-parent namespace maps, five capability masks, and `NoNewPrivs`.
  An identity equal to its overflow value is `ambiguous`, not silently accepted.
  The strongest output is narrowly named
  `no_contradiction_in_privilege_subset`. Inputs are caller-supplied and
  unauthenticated; no collector, backend qualification, authorization, receipt,
  arm, ledger, verdict, or proof is created.

The open manifests include explicit probes for HMAC on every case and at least
one case each for sensitive flags, Unicode controls, and recognized shims. Those
probes remain plans until an independent runner verifies each declared probe.
Case-specific Host smoke tests cover only their explicit assertions, even when a
target asset is marked `implemented`. Timeout and detached-child cleanup remain
covered by the dedicated process-safety regression suite; they are not assigned
to a case expecting a refusal because a started-target execution timeout has the
higher-priority `ABORTED_SAFETY` terminal outcome. Pre-launch deadline expiration
is separately `INCONCLUSIVE` because no target or cleanup attempt exists.

## Proof-eligible denominator

`Ne` is the pre-registered set of Linux in-scope cases whose harness, backend, control reproduction, and oracle are valid. The intended value is 32; S1 fails if `Ne < 24`. A refusal, wrong hypothesis, or failure to construct B does not remove a valid case from `Ne`.

## Experiment protocol

Each proof-eligible case runs three independent fresh sequences:

```text
(A1 -> B -> A2) x 3
```

Every arm gets a fresh write layer, HOME, cache, temp, output, process namespace, and identical policy. A1 and A2 must fail with the same normalized signature; B must pass the unchanged oracle. Any disagreement makes the case `INCONCLUSIVE`.

Only the 32 intended Linux proof-eligible cases run isolated experiments. At the
planned maximum they require `32 cases × 3 arms × 3 repetitions = 288`
target-command invocations. The 16 Windows/macOS in-scope cases and all
scope-challenge cases run Host Observe only. Comparator tools reuse the same
prepared observations and References for the common-evidence lane; their native
end-to-end lane is measured separately and its additional command count is
reported rather than hidden inside the RunParity total.

## S0 — Architecture gate (planned; not yet passed)

Dataset: 16 open development fixtures.

Required:

- At least 10/12 supported positives have the correct top category and at least 2/3 in every category.
- At least 9/12 proof-eligible positives produce a valid `VERIFIED_INTERVENTION`.
- All four scope-challenge fixtures correctly emit `REFUSED_OUT_OF_SCOPE`,
  `INCONCLUSIVE`, or `PARTIAL_EVIDENCE` without an actionable Intervention.
- All public verdicts and reason codes pass contract tests.
- Windows and macOS Host Observe record actual executable identity without shell injection.
- Secret-canary persistence, dangerous recommendation, undeclared host write, and surviving experiment process count are all zero.

S0 demonstrates architecture feasibility only.

Current S0 evidence is `16/16` structurally valid manifests and `12/12`
supported positives verified (every category at 3/3, above the 9/12 and 2/3
per-category thresholds): all twelve hold full backend-qualification plus
three-sequence A1/B/A2 evidence chains against the QEMU-KVM rootless-Podman
backend, re-derived by the independent evidence verifier on every validator
run. The four Host-Observe-only cases (two out-of-scope platform cases, two
hard negatives) remain implemented with their platform smokes by design and
are outside the proof-eligible denominator. The remaining S0 line items —
challenge-case repetition on native Windows/macOS hardware and the aggregate
refusal/safety-rate roll-ups — still have to be recorded before S0 is
declared fully passed; the verified-count thresholds above are met.

## S1 — Sealed benchmark and public preview gate (planned)

### Category identification

- Top category correct in at least 40/48 in-scope cases.
- At least 8/12 correct in every category.

### Verified Intervention Rate

- `Ne >= 24`.
- At least 75% of `Ne` emit the gold Intervention with three valid A1/B/A2 sequences.
- Report exact numerator, denominator, platform strata, and Wilson 95% interval.

### Scope control

- At least 28/32 challenge cases correctly emit `REFUSED_OUT_OF_SCOPE`, `INCONCLUSIVE`, or `PARTIAL_EVIDENCE` without an actionable Intervention.
- At least 13/16 in each challenge stratum.
- False `VERIFIED_INTERVENTION`: 0/32.

### Evidence and safety

- Valid schema and deterministic normalized fixture output: 80/80.
- Incorrect Reference qualification: 0.
- Persisted canary secret: 0.
- Undeclared host write, network access, multi-variable Intervention, or process escape: 0.
- Dangerous recommendation from the denylist: 0.

Every zero-tolerance failure blocks release.

## Comparator protocol

Freeze RunParity and both selected envdiff implementations by version or commit. Run two lanes:

1. **Native end-to-end** — each product uses its default onboarding and evidence collection.
2. **Common evidence** — each product receives the same available observations, Contract, and Reference.

Blind reviewers map output to pre-registered labels. Recipe/proof features are not
scored against a comparator that never claims them. A superiority claim requires
a paired result whose 95% confidence interval has a lower bound above zero;
otherwise publish descriptive counts only.

## S2 — Independent field and GA gate (planned)

Required:

- At least 10 independent teams, 12 unrelated repositories, and 30 naturally occurring incidents.
- No repository contributes more than 20% of incidents.
- At least one eligible incident from every V1 category.
- At least 80% produce a valid observation report without committed setup.
- Independently judged actionable result rate at least 70%.
- For predeclared real proof-eligible incidents, `Ne_real >= 12` and Verified Intervention Rate at least 60%.
- Median active operator time to first actionable result at most 10 minutes, excluding target runtime.
- At least seven teams voluntarily use RunParity on a second incident within 30 days.
- At least five maintainers adopt the Issue Template integration.
- Secret persistence, unintended host mutation, privilege escape, and automatic host repair remain zero.

## Reporting rules

Publish exact numerators, denominators, Wilson 95% intervals, category/platform strata, all pre-registered exclusions, all inconclusive results, and the frozen commit. Do not extrapolate to all environment failures, languages, repositories, or platforms.
