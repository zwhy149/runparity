# ADR-0005: Qualify a real Linux rootless backend and accept only re-derived proof ledgers

- Status: accepted
- Date: 2026-08-22

Implementation status: implemented for one backend and one case on
2026-08-22. The backend is a dedicated QEMU (KVM-accelerated) Ubuntu 24.04.4
VM with its own kernel and systemd, a non-root account (uid/gid 1000), and
rootless Podman 4.9.3. `DEV-PATH-001` is the first fixture whose verified
status derives from a machine-checkable evidence chain: a backend
qualification receipt with all eleven controls demonstrated, plus an
A1/B/A2 ledger that the repository validator re-derives independently.
This ADR supersedes the "no real transport / no evidence verifier" boundary
of ADR-0004; every fail-closed parsing decision of ADR-0004 remains in force.

## Context

ADR-0004 kept OCI preflight deliberately unqualified: an injected transport
could fabricate responses, host-side cleanup could not prove containment,
and no independent verifier could recompute a receipt's claims. Until those
gaps closed, any `verified` status had to be refused on principle. The
missing piece was never parsing logic — it was a real, demonstrable
isolation environment and an evidence chain a second implementation could
check.

## Decision

### 1. The backend transport is a supervised SSH client with an inert remote dialect

`src/backend/ssh-backend-transport.ts` reuses the shared supervised process
lifecycle (one absolute monotonic deadline per command, bounded streams,
explicit cleanup evidence) and a frozen Windows/POSIX controller
environment. On win32, `SystemRoot` and `PROGRAMDATA` are required: ssh.exe
resolves its system configuration path from `PROGRAMDATA` even under
`-F NUL` and exits 255 instantly without it.

Every remote argument must individually match
`/^[A-Za-z0-9_@%+=:,./-]+$/u` (`src/backend/remote-command.ts`): no
whitespace, quotes, dollar signs, globs, braces, or redirection. The
transport never escapes or interpolates — it forwards already-inert tokens
that the remote login shell cannot expand. Anything outside the allowlist
fails closed before a command is built.

Host-side cleanup remains honestly branded (`uncontained_host`,
`best_effort`). No evidence rule derives safety from it: containment is
demonstrated remotely and observationally inside the VM.

### 2. Qualification is a probe battery, not a configuration check

`src/backend/qualification-collector.ts` runs a fixed battery through the
transport; `src/backend/qualification-policy.ts` (pure) judges it. A backend
is qualified only when every control is **demonstrated**:

| Control | Demonstration |
| --- | --- |
| vm_user_non_root | VM account uid/gid non-zero |
| engine_rootless | podman reports rootless with non-empty id mappings |
| image_identity | digest-pinned linux/amd64 image, repo digests pin the exact reference |
| arm_privilege_floor | in-arm probe bundle decodes and classifies without contradiction |
| rootfs_read_only | write attempts to / and read-only mounts refused |
| write_containment | only arm HOME and tmpfs accept writes |
| network_denial | every egress attempt fails immediately (ENETUNREACH et al.) |
| credentials_absent | no credential environment names or paths inside arms |
| resource_limits | cgroup memory.max/pids.max/cpu.max match the frozen policy |
| detached_destroy | detached descendants and containers gone after destroy |
| cross_arm_freshness | one arm's writable marker invisible to the next fresh arm |

### 3. Nested user namespaces are bound by kernel truth, not trusted

Rootless Podman exposes the container `uid_map` in nested-user-namespace
coordinates where the unprivileged VM user appears as 0. The OCI privilege
policy (ADR-0004) correctly flags `parent_root_uid_mapped` instead of
trusting the protocol claim. Qualification closes the loop by collecting a
live bind arm, reading `/proc/<pid>/status` and `/proc/<pid>/uid_map` from
the VM host, and requiring: real uid/gid equal to the VM account, zero
effective capabilities, `NoNewPrivs: 1`, the arm uid mapping to the VM
account, and no real root mapped anywhere. Only then may the
`arm_privilege_floor` control be demonstrated.

### 4. Arms run under one frozen isolation policy

`src/backend/arm-isolation-policy.ts` is the single source of the podman
flag set (`--network none`, `--cap-drop ALL`, `no-new-privileges`,
`--read-only`, `keep-id:uid=10001,gid=10001`, `--user 10001:10001`,
pids/memory/cpu limits, tmpfs, read-only asset mount, per-arm writable
HOME, podman timeout). Its canonical digest binds receipts and ledgers to
the exact policy; any flag change invalidates them by construction.

### 5. The validator verifies evidence, not authors

`fixtures/lib/evidence-verifier.mjs` shares no code with the runner. It
recomputes path-shadowing failure signatures from the ledger's embedded
bounded observations, re-evaluates the frozen oracle, re-derives the
single-intervention diff from normalized argv, and re-checks A1≡A2,
sequence count, and safety flags. A backend receipt is accepted only with
all controls demonstrated and a facts sidecar bound by canonical-JSON
SHA-256.

### 6. Protocol amendment: the ledger binds a manifest evidence projection

A ledger cannot bind the very manifest fields that record its own
promotion. The ledger's `manifest_sha256` is therefore the canonical-JSON
SHA-256 of the manifest with exactly four promotion fields removed
(`fixture_status`, `implementation.verified_at`, the
`backend_qualification` and `verification_ledger` slots). Promoting a case
changes status fields without invalidating the bound evidence; any change
to scenario, oracle, intervention, platform, or safety expectations does.
The build receipt continues to bind full manifest bytes, so the operating
order is fixed: format and finalize the manifest, regenerate the build
receipt, then run the experiment with `--verified-at` pinned to the
manifest's timestamp.

## Consequences

- `VERIFIED_INTERVENTION` is reachable, but only through a chain where
  every claim is recomputed by a second implementation.
- Docker Desktop, WSL2-as-backend, rootful engines, `--user` cosmetics,
  and self-authored JSON still cannot qualify: they fail the battery or
  the digest chain.
- The declared hypervisor chain (Windows → WSL2 KVM → QEMU) is recorded in
  the receipt as a declaration, not proof; the controls that matter are
  demonstrated inside the VM.
- Image acquisition through a content-addressed mirror (docker.io egress
  unavailable at the build site) is recorded in the receipt; digests are
  content-derived and identical to the upstream reference.
- Future backends (native Linux hosts, rootless Docker) must pass the same
  battery through the same transport contract, or extend it explicitly in
  a new ADR.
