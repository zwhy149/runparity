# RunParity security model

> **Status (2026-08-15):** This document separates behavior implemented by the
> private source prototype `0.0.0` from controls proposed for V1. A **Current**
> statement is limited to behavior visible in the checked-in source and tests.
> A **Planned V1** statement is a release requirement, not a security property of
> `0.0.0`.

## Executive boundary

RunParity `0.0.0` is a host command observer, not a sandbox. `doctor` executes the
command explicitly supplied after `--` with the current user's host permissions.
The separator is mandatory; target tokens before it are rejected as a usage error.
That target can read or change files, use inherited credentials, access the
network, spawn processes, or cause any other side effect available to the user.
RunParity does not make an otherwise unsafe command safe to run.

The prototype does not automatically apply a repair or Intervention. This limits
what RunParity itself changes, but it does not limit what the requested target
command changes.

## Assets and trust boundaries

The assets at risk are the host filesystem, user credentials and environment,
running processes, target output, and any report copied into logs or issue
trackers. Repository contents, target executables, command output, and command
arguments may all be hostile or sensitive.

The current model assumes that the host operating system and the Node.js runtime
running RunParity are not compromised. It does **not** assume that a recognized
shim, forwarded JavaScript file, repository script, or native target is benign.
There is no `0.0.0` containment boundary intended to protect the host from a
malicious target.

## Current `0.0.0`

### Host Observe execution

The prototype resolves one explicit executable and launches it with
`shell:false`. Standard input is ignored and stdout/stderr are piped to the
observer. The child otherwise runs in the requested working directory with the
normal host process environment and user authority.

On POSIX, slash-containing paths are resolved directly; bare names use
case-sensitive `PATH` order, `/usr/bin:/bin` when `PATH` is absent, and the
working directory for an empty component. Relative PATH components are resolved
against the captured working directory. A candidate must be a regular file
with executable access. On Windows, bare names search the working directory then
the selected case-insensitive `PATH`, and extensionless names expand in
`PATHEXT` order. Canonical Windows candidates are de-duplicated
case-insensitively. These rules select a launch target; they do not authenticate
it. The report separately records the first absolute lookup path and canonical
target plus at most 64 unique lookup-to-canonical mappings. An explicit bit marks
trace truncation, and canonical scanning continues beyond the display cap.
Multiple aliases resolving to one canonical target are not treated as multiple
PATH identities. This trace proves neither content, publisher, ownership,
immutability, nor causal relevance. Native launch preserves the requested program spelling as `argv0` while
executing the canonical resolved path. A recognized generic Node shim instead
launches the resolved `node.exe` directly with its executable path as `argv0`,
the resolved JavaScript entry point as the first argument, and each user argument
as a separate argv element.

Current Host Observe provides no filesystem, credential, network, syscall,
resource, or privilege isolation. It does not create a disposable HOME, mount a
read-only workspace, remove environment variables, drop operating-system
capabilities, or disable networking. `--report-only` changes the CLI exit policy;
it does not change this execution boundary. `--timeout` limits observation time;
it does not create containment.

### RunSpec and ObservedRun boundary

Before Contract compilation and launch resolution, Current `0.0.0` defensively
copies and freezes requested argv and the supplied environment, resolves the cwd
and workspace roots, records the canonical workspace root, and fixes one
absolute deadline using `process.hrtime.bigint()`. The captured values remain in
module-private state; the exported RunSpec is a frozen opaque token whose normal
inspection, reflection, and JSON serialization do not reveal them
(`JSON.stringify` yields `{}`). This opacity is not a credential vault,
capability boundary, or defense against code already running inside the
controller process.

Host Observe returns a separate serializable ObservedRun. Its request argv and
paths are redacted, environment output is limited to
`snapshot:"captured"`/`valuesSerialized:false`, and the launch projection retains
only bounded lookup/canonical mappings and environment-mutation names. It does not return the execution LaunchPlan's
raw target args, literal shim-set values, or captured environment values. This is
a least-data report boundary, not proof that no sensitive value can appear in
other evidence fields.

The CLI's process result adds `started`, monotonic `duration_ms`, and
`timeout_phase`. Duration starts at process-observer entry and ends at target exit
or execution timeout. It may include synchronous launch preparation, but excludes
earlier Contract/resolution work, later cleanup, and pipe-drain grace; a
pre-launch non-start records zero duration.

### Timeout and process cleanup

After the shared deadline expires while a target is running, RunParity attempts
to terminate the process group it created on POSIX or invokes Windows
`taskkill /T /F` for the observed PID. A successful call is recorded as:

```text
cleanup.status = best_effort
cleanup.containment = uncontained_host
cleanup.reason_code = RP_PROCESS_TREE_NOT_CONTAINED
```

This means only that the known group or tree was targeted. A descendant that
detached before cleanup can survive, and the test suite includes such a case.
Signal interruption, controller crashes, power loss, and operating-system failure
do not have a qualified cleanup guarantee. The current implementation never
promotes Host Observe cleanup to `verified`.

Before report policy is applied, an internal runtime classifier accepts only
coherent Host process evidence and maps it to a discriminated state. The pure
decision step then determines the report/result status, verdict, reason code, and
warnings. Contradictory combinations—including a non-started process with an exit
code, or an uncontained Host cleanup marked `verified`—throw a typed internal
invalid-outcome error rather than being normalized into a successful result.
This seam does not create a new public CLI capability or containment property.

A current execution timeout therefore produces `ABORTED_SAFETY` and process exit
74 even when the cleanup attempt returns `best_effort`; a direct cleanup failure
records `RP_PROCESS_TREE_CLEANUP_FAILED`. If a descendant keeps output pipes open beyond
the bounded drain grace, the report marks stream capture `incomplete` with
`RP_STREAM_DRAIN_INCOMPLETE`. After a started-target execution timeout, operators
must assume a process may remain alive until they verify otherwise.

The deadline is absolute and monotonic from RunSpec capture; Contract compilation,
resolution, and other pre-launch observation consume the same budget. If it is
already exhausted at the final pre-spawn check, RunParity does not call `spawn`.
The report records `started:false`, `timed_out:true`,
`timeout_phase:"before_launch"`, `duration_ms:0`, and
`RP_OBSERVATION_DEADLINE_EXPIRED`. Its cleanup record is
`attempted:false`/`status:"not_required"` with no strategy or cleanup reason.
The schema still labels the Host context `containment:"uncontained_host"`; that
label is not evidence that a process existed or that cleanup succeeded.
Because no target existed, this is `INCONCLUSIVE` and exits 124 rather than
claiming `ABORTED_SAFETY` or successful process-tree cleanup. It also overrides
`--report-only`.

Windows tree cleanup does not resolve `taskkill` from the target environment.
The controller path and a separate frozen controller environment are captured at
module initialization behind an opaque capability token, then passed explicitly
to `taskkill`. A target environment without `SystemRoot`, or a later change to
the controller process's ambient `SystemRoot`, therefore does not redirect that
captured cleanup capability. This stabilizes controller selection; it does not
upgrade Host execution or cleanup to containment.

The execution timer ends when the target emits its exit event. Pipe draining then
uses a separate 250 ms grace. If an already detached descendant keeps a pipe
open, RunParity destroys the capture pipes and records incomplete capture, but it
does not reclassify the exited target as timed out, does not attempt timeout
cleanup, and preserves the target result. This distinction prevents output-pipe
lifetime from silently changing execution-timeout semantics.

### Report redaction and display hardening

Before the JSON, HTML, or human report is rendered, the current redaction context:

- replaces recognized GitHub token and Bearer authorization patterns;
- learns values passed through recognized token, secret, password, credential,
  API-key, private-key, and related compound flag names, including supported
  separate-value, `=`, and Windows `:` forms;
- learns values from inherited or literal shim-set environment names ending in a
  recognized token/secret/password/credential/key suffix;
- redacts learned values from recorded argv, captured excerpts, and an explicit
  set of evidence-bearing fields such as paths, Contract selectors, and selected
  provenance;
- suppresses a complete captured excerpt as `[REDACTED_SENSITIVE_OUTPUT]` when
  any learned secret is shorter than 12 UTF-8 bytes. A truncated excerpt that
  could split a learned short or multiline secret becomes
  `[REDACTED_BOUNDARY]`; other truncated excerpts begin with that marker and drop
  the potentially partial first line before contextual replacement;
- removes VT, C0/C1, bidi-formatting, and selected invisible or
  spoofing-oriented controls, while normalizing Unicode line separators; and
- retains a 64 KiB tail budget for each stdout/stderr excerpt and marks longer
  streams as truncated.

Learned-secret replacement is provenance-aware rather than a recursive rewrite
of every string. In a completed observation envelope, schema identifiers, reason
codes, enum values, fixed messages, and other control-plane constants are left
stable. After evidence fields are redacted, recursive structured sanitization
applies display-control removal only. This avoids corrupting the machine contract
when a short learned value happens to equal a control-plane token. Typed error
messages remain an explicitly redacted field because parser errors can contain
target argv.

Current `--html` renders only the completed in-memory Host Observe envelope after
that redaction and display-control pass. The renderer HTML-escapes every dynamic
field and emits one document with an inline stylesheet and restrictive CSP, but
no JavaScript or external asset. It rejects contradictory outcome, Reference,
Experiment, execution-context, and remediation states instead of rendering a
misleading evidence narrative, and it does not parse saved report files. These
output controls reduce markup and network injection risk; they do not expand
secret detection or make a report safe to publish.

These controls are defense in depth for the report surface, not a data-loss
prevention guarantee. In particular:

- the target receives the original arguments, including any secrets;
- unrecognized, encoded, transformed, fragmented, very short, or novel secret
  formats may remain visible;
- a target can write secrets to its own files, child processes, network traffic,
  terminal devices, or external logs outside RunParity's report;
- raw stream chunks and original arguments necessarily exist in process memory
  before report redaction; and
- public stream `bytes` fields count the original captured bytes. Even when a
  short learned value causes the excerpt to be fully suppressed, known fixed
  output prefixes can reveal that value's byte length;
- RunParity does not encrypt reports or control files, shell redirection, CI
  logs, or issue comments created by the caller.

No output should be described as “secret-free,” “safe to publish,” or protected
against every Unicode spoofing technique. Review a report before sharing it and
apply the access controls appropriate for the command and repository.

### Invocation-scoped stream HMAC

For each observation, the source generates a random 32-byte key and initializes
the stdout and stderr HMAC-SHA-256 captures with that same key. The original key
buffer is overwritten after initialization. The report includes only the digest
algorithm, `key_scope: invocation`, digest value, byte count, and excerpt; the key
is neither serialized into the report nor written to disk by RunParity.

This supports equality comparison only between stream captures made with the
same invocation key. Because a new key is generated for every invocation and is
not retained, digest values are intentionally not comparable or independently
recomputable across reports. The digest is not encryption, a publisher
signature, a durable tamper-evident ledger, or proof that an excerpt contains no
secret. Overwriting the JavaScript buffer is also not a claim that every runtime
or cryptographic-library copy has been securely erased from memory.

### Allowlisted provenance projections

Current source-file provenance never serializes a raw-file SHA-256. The Contract
compiler hashes one allowlisted `{parser_version, pointer, value}` projection for
each accepted `package.json` constraint. The project `.npmrc` observer hashes only
`{parser_version, key, value}` for accepted boolean `fund` or `strict-peer-deps`
entries. Package-manager observation hashes only
`{parser_version, name, version, command, bin}` after the manifest's `bin` entry
resolves canonically to the launched script. Unrelated source fields—including ignored
secret-prone `.npmrc` values—do not enter those projections.

These SHA-256 values bind the reported projections, not the complete source
files, publisher identity, or a durable proof ledger. They are separate from the
invocation-keyed stream HMAC above.

### Recognized Windows Node shims

Windows `.cmd` and `.bat` targets are not handed to `cmd.exe` indiscriminately.
The prototype directly accepts only a narrow generic Node-forwarding grammar and
otherwise refuses the batch target with `RP_UNVERIFIED_WINDOWS_SHIM`/77. That
grammar permits an ordered optional preamble, literal `SET "NAME=value"`
assignments, exactly one forwarding line, and an optional trailing
`exit /b %errorlevel%`. A non-empty assignment is applied to the child
environment; an empty assignment removes the case-insensitive variable.
Assignments after forwarding, reordered/duplicate control lines, `%` or `!`
expansion, control characters, unknown commands, and oversized shim files fail
closed. Accepted forwarding is executed directly through the resolved `node.exe`
and JavaScript entry point.

Exact official npm/npx legacy and current shims contain a dynamic
prefix-selection helper. Current `0.0.0` recognizes those exact shapes only to
refuse them before the helper or target script executes. A bounded, timeout- and
cleanup-supervised prefix-selection stage is Planned V1 work; it is not a
Current capability.

The report term `recognized_node_shim` means only that generic text matched the
current forwarding grammar and its referenced files existed during
resolution. It does **not** establish publisher identity, Authenticode status,
package provenance, file ownership, content hash, immutability, or the safety of
the forwarded code. Recognition also does not remove replacement or other
time-of-check/time-of-use risks. Treat the executable and script as target code,
not as trusted RunParity components.

### Configuration-source and manager claims

The current npm observer accepts only literal booleans for `fund` and
`strict-peer-deps` from npm/npx-shaped argv, matching `npm_config_*` environment
names, and the current project's bounded `.npmrc`. It emits only
`observation.config_source_conflicts` entries with `semantics: "unqualified"`
when two or more accepted values disagree. It does not establish npm's effective
source, emit an `RP-CONFIG` Finding, or propose an Intervention. Registry,
authentication, dynamic, global-mode, user, and global npmrc data are outside the
current parser subset.

A package-manager observation requires a recognized generic forwarder, a valid
adjacent npm/pnpm name and semver version, and a manifest `bin` entry canonically
bound to the launched script. `identity_assurance: "local_manifest_claim"`
explicitly means local data binding, not publisher authentication. An official
npm/npx dynamic-prefix shim is refused earlier, so no manager identity or drift
is inferred from that refused launch.

### Evidence and Linux proof

The prototype has no qualified isolation backend and does not implement
`--attempt-proof`, fresh A1/B/A2 arms, a typed Intervention runner, or proof-ledger
verification. Reports identify the execution context as `HOST_OBSERVATION`,
record experiments as `not_attempted`, and cannot emit
`VERIFIED_INTERVENTION`.

The fixture validator also fails closed at this boundary. For `implemented`, it
validates each manifest against the Draft 2020-12 schema, recomputes a bounded
non-empty regular-file inventory, binds the build receipt to the manifest and
inventory digests, syntax-checks a contained Node entrypoint, requires it to
match the manifest's planned Node argv, and records the source as
`unqualified_live_tree`. This establishes local static asset evidence only. A
plausible self-authored backend receipt remains unqualified and is rejected until
an independent backend evidence verifier exists.
`verified` remains unreachable: mutually consistent JSON
cannot substitute for a separate verifier recomputing arm, oracle, single-delta,
safety, cleanup, and isolation facts from raw execution evidence.

There is a separate Current internal ExperimentCompiler, but it is not an
experiment runner or public preview. It accepts inert data for an opaque frozen
base arm, requires the matching base SHA-256 plus qualification/oracle SHA-256
values and the complete fixed-input digest set, and requires unique A1/B/A2
freshness IDs. Its sole supported delta is a normalized `path.prepend` directory
that must be absolute for the captured POSIX or Windows path style. It produces
two equivalent controls and one B arm with exactly that delta. The token is
opaque; safe inspection returns only plan status, digests, arm identities and
freshness, base digest, and delta type. It does not reveal command/PATH/directory
values, execute an arm, select a backend, persist a ledger, or support a proof
verdict.

There is also an internal Linux OCI static preflight orchestrator. It has no
default process launcher and accepts only an injected asynchronous transport
capability for tests and future trusted adapters. Commands expose only frozen
argv plus the existing absolute deadline; response objects are copied through a
shared shallow descriptor-only record boundary before JSON parsing. That
primitive rejects active record shapes but does not recursively certify nested
values; inherited descriptor fields and a Promise-assimilation `then` policy
key are rejected. Preflight continues field-specific validation synchronously.
Context inspection must yield a local endpoint matching the actual controller
platform, later stages use that pinned endpoint, and the cached image must be
digest-addressed `linux/amd64`.
Even syntactically perfect responses produce only a frozen `unqualified` result
with `live_probes_not_implemented`. The preflight creates no qualification
receipt, experiment authorization, arm, ledger, or verdict. See ADR-0004.

An internal process-backed control-plane prototype now exercises the next
fail-closed seam without becoming a production Docker transport. Its opaque
adapter fixes the canonical executable, base argv and canonical working
directory; it synthesizes a minimal child environment instead of accepting
target or later ambient environment values. Each call supplies only bounded argv
and the pre-existing absolute monotonic deadline, then reuses the Host supervised
child lifecycle. Raw stream buffers transfer ownership to the projection and are
zeroed after redaction or validation. Output overflow, invalid UTF-8, incomplete
drain, timeout, termination, and post-launch or unclassified supervision errors
are safety failures. Only a supervisor failure branded as occurring before
launch can enter the `not_started` launch-failure branch. More importantly, a normal
root-process exit still cannot prove that a detached descendant did not survive.
Because Current cleanup is `uncontained_host`, every started control-plane result
fails closed as safety and no stdout reaches the OCI response parser. A contained
Job/cgroup-class controller is still required before this seam can become a
production transport.

Linux execution in `0.0.0` is therefore still Host Observe. The presence of a
Linux host, container engine, `/v1` JSON schema name, or proof-eligible manifest
does not mean isolated Linux proof exists. The current corpus has no metadata
scaffolds, twelve implemented proof-eligible PATH/runtime/config/native target
assets, and four implemented Host Observe
challenge cases. DEV-NATIVE-001 binds two
content-addressed Linux x64/glibc addons compiled from the same source against
Node 22 ABI 127 and Node 24 ABI 137 headers; its Host smoke exercises the real
ABI rejection and matching-layer load, but proves no isolation or intervention.
DEV-NATIVE-002 binds same-source Node 22 ABI 127 Linux x64 and AArch64 layers;
its Host smoke treats the checked ELF machine field as the architecture fact,
records the generic direct-Node cross-architecture load failure separately, and
checks a temporary matching x64 selection. It likewise proves no isolation or
intervention.
DEV-NATIVE-003 binds same-source Node 22 N-API v1 Linux x64/glibc and musl
layers; its Host smoke treats the checked ELF `DT_NEEDED` libc dependency as the
libc fact, records the generic direct-Node glibc-loader failure separately, and
checks a temporary matching glibc selection. It likewise proves no isolation or
intervention.
The PATH
targets' Linux-only tests use
temporary copies with equal executable mode; one also materializes and validates
an inventoried two-hop symlink recipe, and another fails its stale launcher with
a genuine missing-entry Node error. Build receipt v1 binds neither executable
mode nor the runtime link chain, and canonical path provenance is not file or
content identity. The runtime targets' tests
use controlled no-preload invocations (Node 22/24) and adjacent-fixture-identity
launcher chains, and are Host smoke evidence only. The config targets ask a real
`npm config get` for the effective value in gated smokes. All static fixtures
remain marker- or launcher-bound; a future qualified
runner must bind executable and package-manager identity and version externally, launch an
exact argv with an allowlisted environment, and record those inputs in the
ledger. There is no qualified backend, executable A/B/A2 protocol, verification
ledger, or verified fixture.

An internal pure policy module now accepts only an inert, exact-schema snapshot
of six Linux guest privilege fact groups. Process identity and kernel overflow
IDs are separate facts so a missing sysctl observation cannot erase an already
observed root identity. It fail-closes malformed or active
inputs, keeps missing facts distinct from contradictions, and can report only
an explicit ambiguity when process IDs equal their observed overflow values, or
that no contradiction was found in the narrow `linux_rootless_privilege_floor_v1`
subset. Namespace maps are accepted only with a target-self-to-parent view; a
future collector must bind that view to the actual opener and target namespaces.
The module does not collect or authenticate facts and is not connected
to OCI preflight or an experiment runner. It cannot establish daemon authority,
mount/network/credential isolation, resource controls, process containment,
backend qualification, authorization, a receipt, a ledger, a verdict, or proof.
UID/GID maps and overflow UID/GID are currently paired within their respective
fact groups; a future collector must mark the whole group missing if only one
source file is available. This loses partial contradiction detail but cannot
produce `no_contradiction_in_privilege_subset`.

A private fixed probe program now provides a narrow raw-source assembly path
without creating an evidence authority. It accepts no argv and has no
environment/cwd configuration, stdin, subprocess, shell, network, or file-write
surface. Its Node adapter supports only Linux `x64`, reads the five fixed
`/proc/self` and kernel overflow-ID paths incrementally under cap+1 limits, and
maps only `ENOENT`/`ENOTDIR` to missing. Any other I/O failure, invalid UTF-8,
active/malformed adapter response, or limit aborts the whole program without a
partial bundle. The private built artifact is not a public `bin`, is not mounted
or launched by a backend, and emits no helper digest or identity statement. A
Linux Host behavior smoke remains uncontained and cannot bind the artifact,
process, namespace, opener, or capture session. Although the program source does
not consult environment or cwd, Node can process loader/preload state before the
entry module runs. A future contained controller must bind the exact runtime,
artifact, argv, and allowlisted environment before the output can become evidence.

A separate pure decoder provides the source-to-facts boundary for that policy.
It accepts only an exact caller-supplied bundle whose platform,
`/proc/self/status`, UID/GID map, and overflow-ID slots are explicitly observed
or missing. Observed strings are bounded, ASCII-only source grammars; malformed,
duplicate, noncanonical, overlapping, control-bearing, or over-budget content
invalidates the artifact rather than becoming missing. An empty observed map
remains an observed zero-entry map so the policy can report unmapped identities.
Raw strings are discarded after decoding. A successful result is only
`decoded_unqualified_facts` and
carries `sourceAssurance: "caller_supplied_unverified"`; its
target-self-to-parent view remains a protocol claim. This result cannot
authenticate the source files, the code that read them, a common process/session,
or the opener's relationship to the target namespace. The decoder performs no
privilege judgment and is not connected to preflight, a collector, or an
experiment runner.

## Planned V1 — not implemented security properties

V1 plans a separate, qualified Linux rootless isolation backend for experiments.
The release design requires fresh A1/B/A2 arms, non-root execution, dropped
capabilities, no-new-privileges, read-only root and source, isolated writable
HOME/cache/temp/output areas, controlled networking and resources, and qualified
process-tree cleanup. Host credentials, SSH/GPG/cloud configuration, and the
container-engine socket must not be exposed to an experiment.

None of those controls protects Current Host Observe. They become claims only
after the backend exists, platform-specific escape, credential, network,
write-boundary and process-survival tests pass, and the validation gates are met.
Until then, RunParity must refuse a proof verdict rather than silently substitute
host execution.

Windows and macOS are planned to remain Host Observe for V1 unless native
backends independently qualify. A Linux container hosted by either platform can
provide evidence about the Linux guest only; it cannot verify native Windows or
macOS behavior. No planned Intervention is applied to the host.

## Safe-use guidance for `0.0.0`

1. Run only a target command you would be willing to execute directly with the
   same account and environment.
2. Use an external disposable VM, container, or dedicated low-privilege account
   when the target or repository is not trusted; RunParity does not supply that
   boundary today.
3. Avoid passing secrets. Prefer a least-privilege, short-lived environment even
   when a flag name is recognized by the redactor.
4. Treat exit 74, `ABORTED_SAFETY`, `uncontained_host`, or incomplete stream
   capture as a prompt to inspect the host and terminate survivors manually.
   Exit 124 with `timeout_phase:"before_launch"` instead means the target was not
   started; confirm `started:false` rather than assuming cleanup occurred.
5. Review reports before persistence or publication. Report redaction reduces
   common accidental disclosure; it cannot certify a report as public-safe.
6. Do not treat a finding as a root-cause proof. Current findings are bounded
   observations or hypotheses without an isolated intervention experiment.

## Claim calibration

| Statement | Accurate for `0.0.0`? | Required wording |
| --- | --- | --- |
| “The target ran in a sandbox.” | No | “The target ran in uncontained Host Observe.” |
| “Timeout cleanup killed every descendant.” | No | “The known group/tree received best-effort cleanup; detached descendants are unverified.” |
| “Every timeout means a target process started.” | No | “Check `started` and `timeout_phase`; a pre-launch deadline expiration starts no target.” |
| “Pre-launch deadline expiration was cleaned up successfully.” | No | “No target existed, so cleanup is `not_required` and no cleanup claim is made.” |
| “The report is guaranteed to contain no secrets.” | No | “Known patterns and learned sensitive-flag values are redacted as defense in depth.” |
| “The HMAC proves the report later or across runs.” | No | “The keyed digest is invocation-scoped and its key is not retained.” |
| “A recognized shim is authentic or trusted.” | No | “The shim matched a supported forwarding structure.” |
| “Current RunParity executes official npm/npx shims on Windows.” | No | “Exact dynamic-prefix npm/npx shims are refused with exit 77 before their helper runs.” |
| “`config_source_conflicts` identifies npm's effective setting.” | No | “It records an unqualified disagreement among allowlisted source projections.” |
| “RunParity proved the Linux root cause.” | No | “The prototype observed the host and did not attempt an isolated experiment.” |
| “RunParity applied no remediation.” | Yes | This describes RunParity itself, not side effects of the requested target. |

## Source and test anchors

The current claims above are grounded in these checked-in artifacts:

- Host launch, report verdicts, manual-only remediation and exit handling:
  `src/cli.ts`.
- Opaque/frozen RunSpec capture, shared deadline, least-data ObservedRun, and
  pre-launch non-start: `src/host-observe.ts` and `tests/host-observe.test.ts`.
- Shared process spawning, bounded raw capture, invocation HMAC and timeout
  cleanup: `src/supervised-process.ts`; Host redacted projection:
  `src/process-observer.ts`.
- Refusal-only control-plane adapter and OCI bridge:
  `src/control-plane-process.ts`, `tests/control-plane-process.test.ts`, and
  `tests/oci-process-transport.test.ts`.
- Pure, unauthenticated Linux guest privilege-subset classification:
  `src/oci/linux-rootless-privilege-policy.ts` and
  `tests/linux-rootless-privilege-policy.test.ts`.
- Bounded caller-supplied Linux privilege source decoding:
  `src/oci/linux-rootless-privilege-probe-bundle.ts` and
  `tests/linux-rootless-privilege-probe-bundle.test.ts`.
- Fixed, private raw privilege probe program and Node file adapter:
  `src/oci/linux-rootless-privilege-probe-program.ts`,
  `src/oci/linux-rootless-privilege-probe-node-runtime.ts`,
  `src/oci/linux-rootless-privilege-probe-entry.ts`,
  `tests/linux-rootless-privilege-probe-program.test.ts`, and
  `artifact-tests/linux-rootless-privilege-probe.test.mjs`.
- Shared shallow exact-record snapshot boundary: `src/inert-snapshot.ts` and
  `tests/inert-snapshot.test.ts`. It is not a recursive schema validator or a
  qualification boundary.
- Pattern-limited redaction and display sanitization: `src/redaction.ts`.
- Executable and Windows shim resolution: `src/command-resolution.ts`.
- Redaction, HMAC, short/multiline boundary behavior, control-plane preservation,
  and `argv0` regressions: `tests/cli-contract.test.ts` and
  `tests/diagnose.partial-evidence.test.ts`.
- Attached, detached and open-pipe timeout cases:
  `tests/doctor.process-tree.test.ts`.
- Windows recognized/refused shim cases: `tests/doctor.windows-shim.test.ts`.
- POSIX executable search semantics: `tests/command-resolution.posix.test.ts`.
- Allowlisted Contract, npmrc, and manager-manifest projection hashes:
  `tests/contract.test.ts`, `tests/npm-config-precedence.test.ts`, and
  `tests/package-manager-drift.test.ts`.

Tests show the behavior of the exercised fixtures; they are not a proof that
unknown targets cannot escape, leak data, survive cleanup, or bypass redaction.
