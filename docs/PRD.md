# RunParity V1 product requirements

> **Document role:** This is the target V1 product contract. It is not a list of
> features already present in prototype `0.0.0`. “Current” below means exercised
> by the checked-in source and tests; “planned” means the public shape is reserved
> but must not yet be advertised as usable.

## Delivery status

| Capability | Prototype `0.0.0` status |
| --- | --- |
| `doctor` Host Observe with human output | Current |
| `runparity --json doctor` envelope and typed usage errors | Current; help/version remain text-oriented CLI paths |
| `runparity --html doctor` direct offline report | Current after a completed in-memory observation; one escaped, script-free, external-asset-free document is written to stdout. Saved-report import/export is not implemented |
| Opaque RunSpec capture | Current; argv and environment are defensively copied/frozen with resolved cwd/workspace identity and one absolute monotonic deadline fixed before pre-launch work; captured values stay in module-private state rather than the inspectable/serializable token |
| Serializable ObservedRun boundary | Current; returns redacted request/launch facts and environment-mutation names without raw LaunchPlan args, literal mutation values, or captured environment values |
| Explicit executable/argv launch without a shell | Current; `--` is mandatory, native launch preserves the requested `argv0`, and platform-specific PATH/PATHEXT resolution is contract-tested |
| Lookup-to-canonical executable provenance | Current; reports the first absolute lookup match, canonical target, and up to 64 unique lookup-to-canonical mappings with explicit truncation. Canonical candidates remain separately de-duplicated for Findings, so aliases to one file do not manufacture PATH shadowing |
| Generic Windows shim environment semantics | Current for an ordered grammar with literal `SET "NAME=value"` set/unset assignments, exactly one Node forwarding line, and an optional trailing exit; dynamic, out-of-order, unknown, and oversized batch shapes are refused |
| Official npm/npx dynamic-prefix shims | Current behavior is typed refusal with `RP_UNVERIFIED_WINDOWS_SHIM`/77 before the prefix helper runs; a bounded, timeout-supervised prefix-selection stage is Planned |
| Bounded stdout/stderr excerpts and full-stream digest | Current with HMAC-SHA-256 under a non-persisted invocation key; digests are intentionally not comparable across invocations |
| VT/C0/C1 and limited Unicode display-control hardening | Current and contract-tested for bidi formatting, line separators, and a selected invisible/default-ignorable denylist; arbitrary confusable detection is not implemented |
| Report-envelope redaction | Current for recognized GitHub/Bearer patterns, compound sensitive argv flags, sensitive environment values, evidence-field replacement, short-value output suppression, multiline/truncated boundary markers, and recursive display-only cleaning; successful-envelope control-plane constants are not subject to learned-secret replacement, and broad secret-format coverage remains planned |
| `package.json` `packageManager` and `engines.node` Contract parsing | Current; provenance SHA-256 binds only each allowlisted `{parser_version, pointer, value}` projection, not the raw manifest |
| Recognized package-manager observation and drift | Current only for a recognized generic Node forwarder whose adjacent local manifest has a valid name/version and a `bin` entry canonically bound to the launched script; output says `local_manifest_claim` and hashes only `{parser_version, name, version, command, bin}`, not the raw manifest. Exact official npm/npx dynamic-prefix shims are refused before observation |
| Narrow npm configuration-source observation | Current for conflicting boolean `fund` and `strict-peer-deps` values on npm/npx-shaped commands. Output uses `observation.config_source_conflicts` with `semantics: "unqualified"`; it identifies no effective source and emits no `RP-CONFIG` Finding. Project `.npmrc` SHA-256 binds only `{parser_version, key, value}` |
| Other configuration keys and sources | Planned; registry/secret-prone keys, dynamic values, global mode, and user/global npmrc are ignored by the current observer |
| Other bounded diagnosis findings | Current for Node outside `engines.node`, multiple PATH candidates, and explicit `NODE_MODULE_VERSION` mismatch output; none is a verified intervention |
| File authenticity/hash/architecture, full shim/shebang graph, and PATH/native intervention rules | Planned; the Current lookup-to-canonical trace is observation only |
| Reference discovery and qualification | Planned; current reports `not_found`/`not_applicable` |
| `--report-only` exit policy | Current |
| Observation timing fields | Current JSON reports `started`, monotonic `duration_ms`, and `timeout_phase` (`null`, `before_launch`, or `execution`) |
| Deadline and process-group/tree handling | Current uses one monotonic deadline from RunSpec capture. Expiration before launch starts no target, records `RP_OBSERVATION_DEADLINE_EXPIRED`, makes no cleanup claim, and exits 124. A started-target execution timeout remains `uncontained_host`; `best_effort` or `failed` cleanup produces `ABORTED_SAFETY`/74. Windows cleanup uses a module-initialized opaque controller capability rather than target or later ambient environment. Post-exit drain is separate. Detached-descendant plus interruption/crash guarantees remain planned |
| Internal Host outcome classifier | Current internal runtime classifier produces a discriminated state before a pure deterministic decision. Impossible evidence combinations and `verified` uncontained Host cleanup fail closed; this does not add a public CLI surface |
| Internal ExperimentCompiler | Current internal pure opaque compiler creates only a `COMPILED_PLAN_ONLY` exact A1/B/A2 plan for one normalized, style-specific absolute `path.prepend` directory. It requires a matching frozen-base digest, qualification/oracle digests, all fixed-input digests, and unique arm freshness; safe inspection omits command, PATH, and directory values. It performs no execution, preview, or ledger/proof work |
| Internal Linux OCI static preflight | Current internal parser/orchestrator with injected asynchronous transport only. It has no default process launcher, binds later probes to the platform-matched endpoint returned by context inspection, requires a digest-pinned `linux/amd64` image, and can return only frozen `unqualified` results. Live isolation probes, a production transport, receipts, arm execution, and qualification remain Planned |
| Private fixed Linux guest privilege probe artifact | Current build emits a private, no-argument `linux/x64` Node artifact outside the package `bin` map. It reads only fixed `/proc/self/status`, self UID/GID map, and kernel overflow-ID paths through cap+1 bounded I/O; only `ENOENT`/`ENOTDIR` become missing, while other I/O, invalid UTF-8, or limits fail the whole probe. Success is one raw bundle JSON line. Its code does not consult environment or cwd, but Node loader/pre-entry state is not bound. The artifact is not mounted or launched by a backend, its identity/session/namespace is not authenticated, and even a Linux Host smoke is not qualification evidence |
| Internal Linux guest privilege bundle decoder | Current pure syntax decoder for one exact, bounded caller-supplied bundle of platform, `/proc/self/status`, UID/GID map, and overflow-ID strings. It returns only invalid input/artifact states or frozen `decoded_unqualified_facts` with `sourceAssurance: "caller_supplied_unverified"`; its target-self-to-parent view remains a protocol claim. It authenticates no collector, file, process, namespace, opener, or capture session and creates no readiness, qualification, receipt, authorization, or proof |
| Internal Linux guest privilege policy | Current pure classifier for six inert, explicitly complete-or-missing fact groups: guest platform, process IDs/groups, separately observed overflow IDs, target-self-to-parent user-namespace maps, five capability masks, and `NoNewPrivs`. It returns only invalid, missing, contradictory, ambiguous, or `no_contradiction_in_privilege_subset`; no collector authenticates these facts and the last state is not backend qualification, authorization, containment, or proof |
| Internal supervised control-plane process prototype | Current refusal-only foundation. It reuses the Host child lifecycle, fixes executable/base argv/canonical cwd behind an opaque adapter, synthesizes a minimal environment, accepts only bounded argv plus the existing absolute deadline, and rejects output overflow, invalid UTF-8, incomplete drain, timeout, termination, post-launch/unclassified supervisor failure, or any started `uncontained_host` result as safety. Only a typed pre-launch failure is `not_started`. Consequently its OCI bridge cannot yet provide a parseable response; contained production transport remains Planned |
| Built controller artifact compatibility | The current built artifact was executed successfully on Node `18.20.8`, `20.19.5`, `22.22.0`, and `24.15.0`; Node 18/20 are EOL compatibility lines with warnings, while full release qualification targets maintained Node 22/24 |
| `--attempt-proof` and isolated A1/B/A2 | Planned |
| Markdown, SARIF, saved-report import/export, report gate, and expert subcommands | Planned |

## Problem

“Works there, fails here” incidents are usually investigated by listing differences and guessing which one matters. Existing snapshot tools are useful, but a difference is correlation. Developers still need to know which executable actually ran, whether one bounded environment change controls the outcome, whether restoring the original condition restores the failure, and whether the suggested next step is reversible.

## Target product promise

For supported JavaScript and TypeScript environment failures, RunParity provides:

1. the executable and environment facts actually used by the command;
2. at most three bounded hypotheses, each tied to observed evidence;
3. a preview of one typed intervention when policy permits;
4. an isolated A1/B/A2 evidence trail when a qualified backend and oracle are available;
5. a manual, reversible next step;
6. an explicit statement of everything the evidence does not establish.

RunParity never claims a unique mathematical root cause and never repairs the host automatically.

## Target users

- A contributor onboarding into an unfamiliar repository.
- A maintainer triaging an environment-specific bug report.
- A CI/platform engineer comparing a local failure with a previous successful run.
- An experienced developer who needs machine-readable evidence rather than generic advice.

## Primary workflow

```text
npx runparity doctor -- <command> [args...]
```

1. **Current:** capture one opaque/frozen RunSpec and perform Host Observe under
   its shared monotonic deadline.
2. **Current, partial:** compile a read-only Contract from supported `package.json` declarations.
3. **Planned:** optionally discover and qualify a ReferenceCandidate.
4. **Current, narrow:** emit observed facts and up to three bounded findings from
   four implemented rule paths: Node runtime range, recognized package-manager
   identity/version, multiple PATH candidates, and explicit native ABI signature.
   Allowlisted npm source conflicts are recorded separately as unqualified
   observation data. The complete V1 rule set is planned.
5. **Current internally, not public:** a pure opaque compiler can validate and
   compile one exact plan-only `path.prepend` A1/B/A2 specification with complete
   fixed-input digests and unique freshness. **Planned:** request or show an
   experiment preview through the public CLI.
6. **Planned:** if policy, oracle, artifacts, and isolation permit, create fresh A1, B, and A2 arms inside the same backend.
7. **Current:** emit human text, the provisional JSON envelope, or a
   self-contained offline HTML rendering, including explicit
   start/timing/timeout-phase facts. **Planned:** Markdown, SARIF, saved-report
   import/export, and report gating.

A QualifiedReference is useful for comparison but is not required for a valid A1/B/A2 intervention result.

## Target V1 functional requirements

### F01 — Actual executable provenance

Record the requested program, all PATH/PATHEXT candidates, resolved path, canonical path, file identity, hash, architecture, and recognized shim/shebang chain where supported.

Current baseline records the first absolute executable lookup match, its
canonical target, canonical candidate identities, and a 64-entry bounded mapping
between lookup paths and canonical targets. Overflow is explicit and does not
stop later canonical-candidate discovery. It does not establish file identity,
content hash, architecture, publisher authenticity, immutability, or a causal
intervention.

### F02 — Bounded observation

Record only facts needed by the four V1 categories. Target output is drained
without deadlock, bounded for display, given a full-stream digest whose treatment
satisfies the secret-derived-data invariant, stripped of unsafe terminal and
Unicode display controls, and redacted before persistence or rendering.

Current baseline: capture one immutable request snapshot and absolute monotonic
deadline before pre-launch work. Report whether the target started, the timeout
phase, and monotonic process duration. Deadline expiration before launch must not
start a target or manufacture a process-cleanup claim.

### F03 — Contract compilation

Parse repository configuration as data without executing it. Preserve each Constraint's source, location, digest, parser version, strength, and platform predicate. Dynamic declarations remain unresolved rather than guessed.

### F04 — Reference qualification

A ReferenceCandidate becomes a QualifiedReference only when its schema, provenance, repository tree, lockfile, command specification, oracle, platform family, architecture, and applicable libc match. Runtime, manager, PATH, config, and artifact facts remain comparison attributes.

### F05 — Typed hypotheses

Every hypothesis names one V1 category, supporting and contradictory observations, missing evidence, one allowed Intervention type, and a refusal reason when no safe experiment is representable.

### F06 — Fresh-arm A1/B/A2

A1, B, and A2 are independently created from the same immutable base inside one qualified backend. Their HOME, cache, temp, output, network policy, resource policy, and oracle are identical. B has exactly one declared Intervention.

### F07 — Business oracle

The oracle is frozen before B. Weakening tests, assertions, input data, or required artifacts invalidates the result. Exit zero is an oracle only when explicitly declared sufficient.

### F08 — Deterministic verdict engine

Structured policy computes experiment progress and the terminal verdict. AI and free-form explanation cannot change either.

Current implementation evidence is narrower: Host process evidence is first
runtime-classified into a discriminated state, then a pure deterministic function
decides report/result status, terminal verdict, reason code, and warnings.
Impossible combinations fail closed, including an uncontained Host cleanup that
claims `verified`. This internal seam does not implement experiment progress or a
public proof interface.

### F09 — Layered report

The default human report shows:

1. **Verdict** — one sentence using the fixed terminal vocabulary.
2. **Why** — decisive facts and missing evidence in plain language.
3. **Trace** — executable resolution, Contract, Reference qualification, and experiment arms.
4. **Next step** — one reversible manual action with risk and rollback.

Novices do not need to understand ABI, shims, or provenance. Experts can inspect exact hashes and stable JSON.

### F10 — Stable machine interface

`--json` writes exactly one schema-versioned JSON document to stdout. `--html`
writes one escaped, responsive, printable, self-contained offline document to
stdout after a completed in-memory observation; it has no script or external
asset, and it does not import arbitrary saved JSON. The modes are mutually
exclusive. Progress uses stderr. Target-command failure is report data, not a
RunParity process failure. A separate report gate remains planned for CI policy.

### F11 — Typed refusal

Unsupported or unsafe work produces a useful observation plus a stable reason code. Required codes include:

- `RP_A1_DID_NOT_REPRODUCE`
- `RP_CONTROL_UNSTABLE`
- `RP_ORACLE_MISSING`
- `RP_MULTI_VARIABLE_CHANGE`
- `RP_UNSUPPORTED_PLATFORM_ISOLATION`
- `RP_UNSUPPORTED_FAILURE_DOMAIN`
- `RP_SANDBOX_UNAVAILABLE`
- `RP_NETWORK_REQUIRED`
- `RP_PRIVILEGE_OR_SECRET_REQUIRED`
- `RP_HOST_MUTATION_REQUIRED`
- `RP_INTERVENTION_NOT_TYPED`
- `RP_SAFETY_GUARD_TRIGGERED`

### F12 — Local-first privacy

Collection, analysis, and report generation are local by default. Nothing is uploaded automatically. Provider access and experiment networking are independent opt-ins.

## Platform boundary

- Linux: Host Observe plus hardened rootless isolated experiments.
- Windows: Host Observe in V1; a Windows Sandbox prototype does not enable a verification claim.
- macOS: Host Observe in V1; VM feasibility work does not enable a verification claim.
- A Windows/macOS host observation is never compared with a Linux container arm.

## Quality requirements

- A no-global-install command works from a repository that does not depend on RunParity.
- Explicit executable and argv are preserved without shell re-parsing by default.
- Timeout, interruption, and crash cleanup terminate the full managed process tree.
- Untrusted output cannot inject terminal, JSON, HTML, or log control content.
- Every terminal verdict and refusal code has public-interface contract tests.
- Core diagnosis works without an AI service or account.
- Package size, startup time, collector overhead, and dependency count are release gates.

## Release policy

S0 permits continued engineering, S1 permits a public preview with corpus-bounded claims, and S2 permits a general-availability claim. Stars and downloads are distribution signals, never substitutes for correctness, safety, or user-confirmed usefulness.

Prototype `0.0.0` is pre-S0. Checked-in unit and integration tests are
implementation evidence, not evidence that S0, S1, or S2 has passed.
