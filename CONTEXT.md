# RunParity domain context

> **Contract status (2026-08-15):** This document defines the target V1 domain
> model and release invariants. The source prototype is version `0.0.0`; it
> currently implements Host Observe, partial `package.json` Contract compilation,
> and bounded findings for declared Node/package-manager drift, multiple PATH
> candidates, and explicit Node native-module ABI mismatch output. Host launch
> evidence distinguishes the absolute lookup path that matched from its canonical
> `realpath` target and retains a bounded alias-to-target trace. Package-manager
> identity is currently observed only from a recognized generic npm/pnpm Node
> forwarder's adjacent package manifest after its declared `bin` resolves to the
> launched script; `identity_assurance: "local_manifest_claim"` is not publisher
> authentication. Exact official npm/npx shims with dynamic prefix selection are
> recognized only to fail closed with `RP_UNVERIFIED_WINDOWS_SHIM`/77; their helper
> is never executed. A supervised staged prefix-selection design remains planned.
> Current npm configuration collection records only unqualified conflicts among
> allowlisted boolean `fund` or `strict-peer-deps` sources in
> `observation.config_source_conflicts`; it does not select an effective source and
> does not emit an `RP-CONFIG` Finding. Contract, project `.npmrc`, and manager
> provenance hashes cover only allowlisted projections, never the raw source files.
> Host Observe now captures an opaque, frozen RunSpec snapshot and returns a
> safely serializable ObservedRun projection; raw LaunchPlan args/mutation values
> and captured RunSpec environment values are not returned. One monotonic
> deadline is fixed at capture time and is not reset before process launch.
> Current internal seams also classify Host process evidence into a discriminated
> outcome state before a pure deterministic decision, and compile an opaque,
> plan-only ExperimentSpec for one `path.prepend` delta. A third internal seam
> parses ordered Linux OCI static preflight responses through an injected
> asynchronous transport, but has no default launcher and can return only a
> frozen `unqualified` result. A process-backed control-plane prototype now
> reuses Host Observe's supervised child lifecycle with fixed base argv, a
> canonical working directory, an internally generated minimal environment, and
> the same absolute deadline. It deliberately cannot supply a parseable preflight
> response: current cleanup remains `uncontained_host`, so every started result
> fails closed as safety. A supervisor rejection is `not_started` only when the
> shared lifecycle proves it happened before launch; post-launch and unclassified
> rejections are safety failures. A pure decoder can turn an exact, bounded,
> caller-supplied bundle of Linux platform, `/proc/self/status`, UID/GID map, and
> overflow-ID strings into an inert privilege-fact snapshot. Its result carries
> `sourceAssurance: "caller_supplied_unverified"`; the declared
> target-self-to-parent view remains only an input protocol claim. The
> decoder authenticates neither the files nor the collector, process, namespace,
> opener, or capture session. A private, fixed, no-argument Linux/x64 probe
> program is also built outside the public `bin` map. It incrementally reads only
> the five protocol paths under fixed byte caps and emits one raw bundle; its
> output remains unverified and it is not mounted, launched, or identity-bound by
> any backend. The program does not consult environment or cwd, but its Node
> runtime/loader and pre-entry environment are likewise not bound or trusted. A
> separate pure policy module can classify decoded facts as
> invalid, missing, contradictory, ambiguous, or having no contradiction in that
> narrow subset. None of these modules qualifies a backend. None of these
> seams exposes an experiment CLI,
> preview, qualified execution backend, ProofLedger, or verification claim.
> Reference discovery, qualification, isolated experiments, and proof verdicts
> are planned and must not be presented as currently available. The built CLI has
> been exercised on Node `18.20.8`, `20.19.5`, `22.22.0`, and `24.15.0`; Node
> 18/20 are explicitly EOL
> compatibility lines, not recommended or release-qualified runtimes. See
> `docs/CLI.md` for the executable surface. Since 2026-08-22 the prototype
> additionally contains the first qualified backend and verified case
> (ADR-0005): a supervised SSH transport with an inert remote-argument
> allowlist reaches a dedicated QEMU-KVM Ubuntu 24.04.4 VM (its own kernel
> and systemd, non-root account, rootless Podman 4.9.3); a probe battery
> demonstrates eleven isolation controls (including binding the nested
> user-namespace parent claim with host-kernel /proc truth) before a
> qualification receipt exists; and all twelve supported-positive fixtures
> hold three-sequence A1/B/A2 ledgers (single-token typed interventions
> across four delta kinds: path.prepend, env.value, mount.source,
> argv.token) whose failure signatures, frozen oracle results, intervention
> diffs, and safety flags are independently re-derived by the fixture
> validator before `verified` is accepted. The
> public `runparity` CLI surface is unchanged: no command it exposes can
> emit `VERIFIED_INTERVENTION`, and the maintainer-side fixture driver is
> outside the published `bin` map.

## Purpose

RunParity helps JavaScript and TypeScript developers explain environment-dependent command failures without presenting guesses as proof. It observes the command that actually ran, compiles declared tool constraints, compares only trustworthy references, and—where a qualified isolation backend exists—tests one typed intervention with an A1/B/A2 experiment.

The planned public beginner path is one command:

```text
npx runparity doctor -- <command> [args...]
```

Until the package is published, the equivalent source-prototype invocation is:

```text
pnpm exec tsx src/cli.ts doctor -- <command> [args...]
```

For Current `0.0.0`, `--` is mandatory and every following token is preserved as
target argv. Native launches execute the canonical resolved file with the
requested program spelling as `argv0`; generic Windows Node shims launch the
resolved `node.exe` and script directly without `cmd.exe`. POSIX resolution uses
case-sensitive PATH order and executable access. Windows searches the working
directory then case-insensitive PATH and expands PATHEXT in order. Relative PATH
components are resolved against the captured working directory, never a later
ambient cwd. Reports retain the first executable lookup path as
`selected_search_path`, its canonical target as `resolved_path`, and at most 64
unique lookup-to-canonical mappings. A truncation bit says when more mappings
existed; canonical candidates continue to be scanned and de-duplicated for
diagnosis. Multiple aliases to one canonical file do not by themselves create a
PATH Finding, and this trace authenticates neither file nor publisher. The execution
timer ends at target exit; a separate bounded pipe-drain grace can mark capture
incomplete but cannot turn a completed command into a timeout.

The Current RunSpec defensively copies and freezes requested argv and the
environment snapshot, resolves the working-directory/workspace snapshot, and
stores one absolute monotonic deadline. Pre-launch collection consumes that same
budget. If it expires before `spawn`, the target is not started and the result
records `started:false`, `timeout_phase:"before_launch"`, `duration_ms:0`, and
`RP_OBSERVATION_DEADLINE_EXPIRED`. Cleanup is `not_required` with
`attempted:false`; no process-tree cleanup claim is made. A deadline expiration
after launch instead records `timeout_phase:"execution"` and uses the existing
uncontained Host cleanup path. The Windows cleanup controller uses an opaque,
module-initialized capability with a frozen controller environment; it is not
derived from the target environment or later ambient `SystemRoot` changes.

Current redaction replaces learned secrets only in evidence-bearing fields and
keeps control-plane schema/reason-code constants stable. Recursive final-envelope
cleaning removes display controls only. Short learned secrets suppress captured
output, and truncated short/multiline-secret cases use
`[REDACTED_BOUNDARY]`. These are defense-in-depth behaviors, not a public-safety
guarantee.

Experts can inspect and compose each evidence-producing stage independently.

## Target V1 product boundary

V1 supports four diagnosis families:

1. `PATH_SHADOWING` — PATH ordering, shims, symlinks, or executable resolution selects a different binary.
2. `RUNTIME_MANAGER_DRIFT` — the active Node.js or package-manager version or provenance differs from the intended environment.
3. `CONFIG_PRECEDENCE` — supported configuration sources disagree and a qualified parser can establish the relevant evaluation semantics.
4. `NATIVE_ABI_ARCH_MISMATCH` — a pre-existing native artifact mismatches the active Node ABI, operating system, or CPU architecture.

A package-manager shim belongs to `PATH_SHADOWING`; a Node or package-manager version mismatch belongs to `RUNTIME_MANAGER_DRIFT`; a lockfile is Contract evidence rather than a diagnosis family. Rewriting a lockfile or changing multiple tools is outside the V1 intervention boundary.

V1 must refuse or downgrade network, proxy, TLS, credentials, flaky timing, third-party service, database state, GUI, driver, GPU, kernel, system SDK, privileged, and multi-variable repair cases.

Host observation and isolated experimentation are different capabilities. Running a user-requested command on the host is not a sandbox. A Linux container on Windows or macOS is not evidence about native Windows or macOS behavior.

## Canonical terms

- **RunSpec** — the opaque, frozen capture of executable/argv, working-directory
  and workspace identity, environment snapshot, Host Observe's fixed
  ignored-stdin policy, and one absolute monotonic deadline for a requested run.
  Current `0.0.0` keeps the captured values in module-private state: inspection,
  reflection, and ordinary JSON serialization of the public token do not expose
  them (`JSON.stringify` yields `{}`). Opacity is an API boundary, not a security
  sandbox.
- **ObservedRun** — the safely serializable, bounded, redacted projection produced
  from a RunSpec. It records request metadata, observed launch identity,
  the bounded lookup-path-to-canonical-target trace, environment-mutation names,
  outcome, streams, and timing without returning raw LaunchPlan args or environment
  values.
- **Contract** — the provenance-preserving set of constraints compiled without executing repository code.
- **Constraint** — one declared requirement with subject, selector, strength, platform predicate, source location, digest, and parser version.
- **ReferenceCandidate** — a discovered successful run that has not passed all provenance and comparability checks.
- **QualifiedReference** — a ReferenceCandidate with a supported schema, verified provenance, and matching repository tree, lockfile, command specification, oracle, platform family, architecture, and applicable libc.
- **Drift** — a typed difference between an ObservedRun and a Contract or QualifiedReference.
- **Finding** — a bounded explanation linking observed evidence to one diagnosis family and stating what remains uncertain.
- **Intervention** — one allowlisted, typed experimental delta. It is never an arbitrary shell repair.
- **ExperimentSpec** — an immutable plan containing the base digests, business oracle, backend, and exactly one Intervention. Current `0.0.0` has only an opaque internal, plan-only compiler: it requires a frozen base snapshot, all fixed-input digests, matching plan digests, fresh A1/B/A2 identities, and one style-specific absolute `path.prepend` directory. Its safe inspection projection exposes plan status, digests, arm identities/freshness, and the delta type—not command, PATH, or intervention-directory values. It does not execute arms or create a ProofLedger.
- **Outcome** — the observable result of one experiment arm.
- **ProofLedger** — the auditable A1/B/A2 inputs, outputs, digests, intervention diff, oracle results, and limitations.
- **VerifiedIntervention** — an intervention supported by a valid A1/B/A2 ledger. It is strong causal evidence for that intervention, not proof of a unique root cause.

Runtime, package-manager, PATH, configuration, and native-artifact facts are comparison attributes, not Reference lookup keys. Otherwise the difference being diagnosed could be filtered out before comparison.

## Hypothesis lifecycle

- `candidate` — plausible from observation, not tested.
- `supported` — multiple facts support it, but no qualified A1/B/A2 result exists.
- `rejected` — observed evidence contradicts the hypothesis.

## Experiment progress

- `OBSERVED`
- `A1_REPRODUCED`
- `B_ORACLE_PASSED`
- `A2_REPRODUCED`

## Terminal verdicts

- `VERIFIED_INTERVENTION`
- `PARTIAL_EVIDENCE`
- `INCONCLUSIVE`
- `REFUSED_OUT_OF_SCOPE`
- `ABORTED_SAFETY`

Current Host Observe routes raw process evidence through a runtime classifier
into one of `deadline_expired_before_launch`, `execution_timed_out`, `completed`,
or `terminated`, then a pure deterministic decision function produces the report
status, result status, verdict, reason code, and warnings. Contradictory inputs
fail closed; in particular, an uncontained Host cleanup cannot be represented as
`verified`. This is an internal implementation seam, not a separate public CLI
interface or experiment-verification capability.

Execution location is recorded independently as `HOST_OBSERVATION` or `LINUX_ISOLATED_EXPERIMENT`. `VerifiedIntervention` as a domain object maps only to the `VERIFIED_INTERVENTION` verdict.

## Release invariants

These are normative gates for V1, not a claim that prototype `0.0.0` already
implements every control. Unimplemented controls remain release blockers.

1. Every persisted fact has provenance and a sensitivity classification.
2. Secret-prone values are redacted before their first disk write. When equality comparison is required, values use an invocation-scoped keyed digest rather than plaintext. Its key is not persisted, so the digest is not a cross-invocation identity.
3. Repository configuration is parsed as data and never executed by the Contract compiler.
4. RunParity itself never changes the host shell profile, PATH, runtime, package manifest, lockfile, dependency tree, or global tools. A user-requested Host Observe command is not contained and may mutate the host with the user's normal permissions. Current execution-timeout cleanup remains `uncontained_host` even when its process-group/tree attempt returns `best_effort`; expiration before target launch makes no cleanup claim.
5. V1 has no host `fix --apply` command.
6. Experiments run non-root with dropped capabilities, `no-new-privileges`, read-only root and source, isolated HOME/cache/temp/output, resource/PID/time limits, and full process-tree cleanup. Host credentials, SSH/GPG/cloud configuration, and the Docker socket are not exposed.
7. Target commands use an explicit executable plus argv and do not pass through shell parsing by default. Recognizing a forwarding-shim structure is not publisher or file-authenticity qualification. Experiment networking is disabled unless an explicit local mirror or replay policy is recorded in the ledger.
8. A1, B, and A2 are independently created inside the same qualified backend from the same immutable base and identical input manifest. B differs by exactly one declared typed Intervention. A1 and A2 reproduce the same normalized failure signature; B satisfies the unchanged business oracle, not merely exit zero.
9. VT sequences, C0/C1 controls, bidi formatting, and the specified invisible/display-control denylist are neutralized before terminal, JSON, HTML, or log rendering. This is not a claim to detect arbitrary Unicode confusables. Host escape writes, persisted secret canaries, undeclared intervention deltas, and surviving child processes are release blockers.
10. Missing or incomparable references may produce `PARTIAL_EVIDENCE`; they never create a QualifiedReference implicitly. A QualifiedReference is optional and cannot grant verification by itself.
11. AI may explain a ProofLedger but cannot author executable interventions or promote a verdict to `VERIFIED_INTERVENTION`.
12. Human and JSON output use bounded claims. Never emit “proven root cause,” “completely safe,” or “zero chance of secret leakage.”
