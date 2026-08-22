# ADR-0004: Keep OCI preflight separate from backend qualification

- Status: accepted
- Date: 2026-08-15

Implementation status: prototype `0.0.0` contains an internal static preflight
orchestrator only. It has no production Docker transport, does not start an
experiment arm, and can return only `status: "unqualified"`. A process-backed
refusal tracer reuses the shared supervised child lifecycle, but its current
`uncontained_host` result is always safety and never reaches response parsing.
A pure bounded decoder can turn caller-supplied guest source strings into
explicitly unqualified facts, and a separate pure privilege-policy module can
classify them. Neither module is a collector or can create a qualified state or
receipt. A private fixed Linux/x64 probe artifact can assemble the raw bundle,
but no backend mounts, launches, identity-binds, or verifies it.

## Context

The presence of a Docker client, a local-looking endpoint, a rootless daemon
flag, or a digest-pinned image is necessary but not sufficient evidence for a
qualified isolation backend. An injected test transport can fabricate every one
of those responses. A default process launcher in the preflight parser would
also create a second, weaker timeout and environment boundary beside the Host
process controller.

## Decision

Keep static OCI preflight as an internal, fail-closed state machine:

- it accepts only a trusted asynchronous transport capability and never owns a
  default `spawn` path;
- a transport command contains only frozen argv and one absolute monotonic
  deadline—never a caller-supplied executable or ambient environment;
- the context lookup is followed by platform-family validation and all later
  stages use the pinned local endpoint rather than the mutable context name;
- the cached image must be addressed by an exact digest and match
  `linux/amd64`;
- untrusted response objects are copied through a shared shallow exact-record
  descriptor snapshot before parsing, without Promise/thenable assimilation;
  nested values still require synchronous domain validation; and
- every result is frozen and exactly `unqualified`. Passing the static checks
  stops at `live_probes_not_implemented`; it never creates a receipt, verdict,
  proof ledger, or authorization token; and
- the guest privilege source decoder accepts only exact, bounded
  observed-or-missing platform, `/proc/self/status`, map, and overflow-ID slots.
  It labels the whole decoded result
  `sourceAssurance: "caller_supplied_unverified"`, treats the
  target-self-to-parent view as a protocol claim, discards raw text, and cannot authenticate the
  source files, collector, process, namespace, opener, or capture session; and
- the private fixed probe artifact accepts no arguments, reads only the five
  protocol paths under hard byte caps, and emits only a raw bundle. It is outside
  the public `bin` map and cannot claim helper identity, session binding,
  containment, readiness, or qualification. Its source does not consult
  environment or cwd, but the Node runtime, loader, artifact, argv, and
  allowlisted environment remain unbound until a contained controller verifies
  them; and
- the pure guest privilege policy remains a fact-subset judgment only. Even its
  `no_contradiction_in_privilege_subset` result is unauthenticated and cannot be
  consumed as backend qualification. It requires a declared target-self-to-parent
  map view and returns ambiguity when a displayed identity equals the observed
  kernel overflow UID or GID; a future collector must bind those claims.

The real backend transport must later reuse a qualified, supervised controller
with one total deadline and explicit cleanup evidence. Backend qualification
must independently verify the daemon endpoint and rootless authority boundary,
image identity, isolation policy, credential and socket absence, network and
write boundaries, resource controls, per-arm freshness, and post-destroy
liveness.

The Current refusal tracer does not satisfy that requirement. Its internally
generated minimal environment closes ambient credential inheritance, but a
normal root-process exit cannot prove that no detached descendant survived.
Until a Job/cgroup-class controller can establish containment, started process
output is not accepted as a transport response. The shared supervisor brands a
failure as `before_launch` or `after_launch`; only the former can become a
`not_started` transport failure. An after-launch or unclassified rejection is a
safety failure, never daemon unavailability.

## Consequences

- Tests can exercise parsing and ordering without implying that Docker is
  installed, reachable, or safe.
- A missing daemon or future transport failure cannot fall back to Host Observe
  for proof.
- Docker Desktop and remote/rootful engines cannot inherit a Linux rootless
  qualification merely by returning plausible JSON.
- Implementing a real transport is deliberately more work: it must satisfy the
  process-controller and evidence-verification boundaries before this ADR can be
  superseded by a qualification ADR.
