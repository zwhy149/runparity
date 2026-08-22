# RunParity fixtures

This directory contains validation metadata and disposable fixture assets.

## Truthful status

The open development suite currently contains no **scaffold** manifests and
twelve **implemented** proof-eligible target assets (`DEV-PATH-001`, `DEV-PATH-002`,
`DEV-PATH-003`, `DEV-RUNTIME-001`, `DEV-RUNTIME-002`, `DEV-RUNTIME-003`,
`DEV-CONFIG-001`, `DEV-CONFIG-002`, `DEV-CONFIG-003`, `DEV-NATIVE-001`, and
`DEV-NATIVE-002`, and `DEV-NATIVE-003`), two
**implemented** hard negatives (`DEV-NEG-001` and `DEV-NEG-002`), and two
**implemented** out-of-scope environment cases (`DEV-OOS-001` and
`DEV-OOS-002`). Their non-empty
asset trees and Node entrypoints are recomputed and syntax-checked by the
repository validator. Each checked entrypoint is also bound to the script in its
manifest's planned target argv. `DEV-RUNTIME-001` has case-specific, no-preload
Node 22/24 Host smoke tests. `DEV-NATIVE-001` contains same-source Node 22 ABI
127 and Node 24 ABI 137 Linux x64/glibc addon layers; its Linux-only Host smoke
requires the real Node ABI rejection for the default layer and a successful
matching-layer load in a temporary copy. `DEV-NATIVE-002` similarly contains
same-source Node 22 ABI 127 Linux x64 and AArch64 layers. Its Linux-only smoke
checks each ELF machine header, hash-validates then structurally rejects the
AArch64 selection, records Node's real but generic cross-architecture load
failure separately, and verifies the x64 selection in a temporary copy. The ELF
header, not generic dlopen wording, establishes the artifact architecture.
`DEV-NATIVE-003` contains same-source Node 22 N-API v1 Linux x64/glibc and musl
layers. Its Linux-only smoke checks each ELF `DT_NEEDED` libc dependency,
hash-validates then structurally rejects the musl selection, records Node's real
glibc-loader failure separately, and verifies the glibc selection in a temporary
copy. The dynamic-table dependency, not generic dlopen wording, establishes the
artifact libc target.
These local behavior tests do not show executable identity, isolation, or a
successful intervention. The PATH and
runtime launcher-chain smokes run only on Linux and exercise genuine
resolution; the three CONFIG
cases ask a real `npm config get` invocation for the effective value, because
npm lifecycle scripts do not receive file- or CLI-sourced configuration through
the environment; their gated real-npm smokes exercise genuine precedence on
hosts where npm exists. `DEV-OOS-001` performs a genuine read-only reg.exe
query on Windows. `DEV-OOS-002` is a read-only macOS SDK preflight that
fails closed on non-macOS hosts. Both OOS Host smokes record `PARTIAL_EVIDENCE`
because the CLI has no proof-refusal flow yet. all twelve supported positives are `verified`
against the qualified QEMU-KVM rootless-Podman backend; the two
out-of-scope platform cases and two hard negatives remain implemented
Host-Observe-only by design.

Do not count a case toward S0 until its manifest reaches `verified`.

## Layout

```text
fixtures/
  schema/case-manifest.schema.json
  evidence-sources.json
  validate.mjs
  validator.test.mjs
  receipts/
    build/                   # recomputable local build receipts
    backend/
    ledger/
  development/
    index.json
    cases/*.json
    assets/                 # DEV-PATH-001/003, DEV-RUNTIME-001, and both DEV-NEG cases
```

The case schema uses JSON Schema Draft 2020-12. On every run, `validate.mjs`
compiles it with Ajv and validates every case manifest before applying suite-level
checks that JSON Schema alone does not express, including the exact 16-case
composition, three supported cases per V1 category, evidence-ID resolution,
intervention/category pairing, receipt integrity, status derivation, and truthful
lifecycle state. Schema diagnostics are bounded and do not include manifest data
values.

Run:

```text
node fixtures/validate.mjs
node --test fixtures/validator.test.mjs
```

## Status transitions

- `scaffold`: design metadata exists; `runnable=false`, `asset_root=null`,
  missing assets are listed, `verified_at=null`, and the explicit build,
  backend-qualification, and verification-ledger receipt slots are all `null`.
- `implemented`: a bounded verifier recomputes a non-empty regular-file inventory,
  binds its digest and the manifest digest to the build receipt, checks a contained
  inventoried `.mjs` entrypoint with bounded `node --check`, binds that entrypoint
  to the manifest's planned target argv, and confirms the tree did not change
  during that check. The receipt discloses
  `asset_inventory_stability=unqualified_live_tree`; this is local static build evidence,
  not behavioral or proof evidence. Empty trees and arbitrary digests fail closed.
  Here `runnable=true` and `missing_assets=[]` mean only that the direct target's
  static files are complete. Missing runtime images, isolation, arm execution,
  oracle, and cleanup evidence are represented by null backend and ledger receipt
  slots, not by `missing_assets`.
  The entrypoint/argv binding accepts exactly three deterministic shapes:

  1. `direct_argv_script` — argv is `["node", <entrypoint path>, ...]`;
  2. `launcher_argv_script` — argv starts with `pnpm` or `npm` and the
     entrypoint path appears as exactly one later argv token (for example
     `pnpm exec node <entrypoint path>`);
  3. `launcher_lifecycle_script` — argv is
     `["pnpm" | "npm", ...npm flags, "run", <script name>, ...npm flags]`
     where every token outside the launcher and script-name positions is a
     config flag (`-`-prefixed), the asset tree contains exactly one
     `package.json` at its root, and its `scripts[<script name>]` is either a
     bare relative path or the canonical `node <relative path>` form that
     resolves inside the asset root to the entrypoint. Flag-bearing,
     absolute, or variable-bearing script values fail closed.

  Anything else fails closed: a script value that escapes, carries extra
  arguments, is absolute, or is ambiguous (zero, nested, or multiple
  `package.json` files) cannot satisfy the binding. The binding is static
  receipt-to-argv bookkeeping; it does not prove that a launcher will reach
  the entrypoint at runtime.
  Build receipt v1 binds regular-file paths and bytes but not POSIX executable
  mode. The `DEV-PATH-001` Host smoke therefore copies both launchers into a
  temporary workspace and applies the same mode before comparing PATH order.
  `DEV-PATH-003` inventories only regular launchers and an exact link recipe;
  its Linux-only Host smoke materializes and validates the two-hop symlink chain
  in a temporary workspace. The receipt does not authenticate that runtime link
  chain, executable mode, or the bytes later reached through it.
  Root `.gitattributes` enforces LF checkout for text so raw manifest and asset
  digests do not vary with `core.autocrlf`.
- `verified`: reachable since 2026-08-22 through the independent evidence
  verifier (`fixtures/lib/evidence-verifier.mjs`, protocol amendment in
  ADR-0005). A backend qualification receipt is accepted only when every
  control judgment it carries is `demonstrated` and its collected facts
  sidecar matches the receipt's canonical-JSON SHA-256 binding. A
  verification ledger is accepted only when the verifier independently
  recomputes the failure signatures from the embedded bounded observations,
  re-evaluates the frozen oracle, re-derives the single `path.prepend`
  intervention diff from normalized argv, and re-checks A1≡A2, sequence
  count, and safety flags. all twelve supported positives hold such chains against the QEMU-KVM
  dedicated Ubuntu VM backend running rootless Podman under a non-root
  account (receipt: `receipts/backend/qemu-kvm-ubuntu-noble-rpvm-2026-08-22.json`,
  ledgers: `receipts/ledger/<CASE>.json`). Self-authored receipts still fail
  with named, specific problems.

`validate.mjs` derives `scaffold`, `implemented`, or `verified` and rejects
a different declared `fixture_status`. It recomputes build-asset evidence
rather than trusting receipt strings, and recomputes ledger claims rather
than trusting the runner that authored them. The ledger binds the manifest
by its evidence projection (canonical JSON minus the four promotion fields),
so promotion does not invalidate the bound evidence while any scenario,
oracle, intervention, platform, or safety change does.

Promotion requires a review of the manifest and assets. Never change a gold label
merely to match tool output; amend the protocol and explain the change instead.

## Gold-action rule

A supported case has exactly one allowed typed intervention:

| Gold category | Allowed intervention |
| --- | --- |
| `PATH_SHADOWING` | `path.prepend` |
| `RUNTIME_MANAGER_DRIFT` | `runtime.select` |
| `CONFIG_PRECEDENCE` | `config.set` |
| `NATIVE_ABI_ARCH_MISMATCH` | `nativeArtifact.select` |

Out-of-scope environment cases have no allowed Intervention and carry one typed
refusal. Hard negatives also have no Intervention, but the open cases honestly
expect `INCONCLUSIVE` or `PARTIAL_EVIDENCE`; one Host Observe run does not prove
that a failure is environment-independent.

## Evidence sources

Every case references at least one ID from `evidence-sources.json`. External
sources establish that the problem family occurs in practice; project
specifications justify synthetic negative controls and refusal boundaries.
A source does not prove that a scaffolded fixture is implemented.

## Safety probes

Safety flags identify cross-cutting assertions that the eventual runner must
check. They do not silently turn a host command into a sandbox:

- `network=disabled` is reserved for isolated experiment cases.
- `network=not_used` means the host fixture is designed not to use networking;
  it does not claim enforcement.
- HMAC, Unicode, sensitive-flag, and recognized-shim probes map to the current
  prototype controls documented in `docs/VALIDATION.md`.
- Timeout and detached-child behavior is exercised by the dedicated process
  safety regression suite. It is not attached to an open case whose expected
  verdict is `REFUSED_OUT_OF_SCOPE`, because an uncontained Host timeout must
  instead terminate as `ABORTED_SAFETY`.
