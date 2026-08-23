# Changelog

All notable changes to RunParity are documented here. The project follows
[Semantic Versioning](https://semver.org/); releases before 1.0 may change public behavior between
minor versions.

## 0.1.0 - 2026-08-24

First public npm release.

### Added

- Evidence-first `runparity doctor -- <command>` diagnostics with human, stable JSON, and
  self-contained HTML reports.
- Bounded findings for PATH shadowing, runtime-manager drift, npm configuration precedence, and
  native ABI mismatch signals.
- Runtime-validated outcome states and deterministic, fail-closed verdicts.
- Maintainer-side rootless OCI qualification and A1/B/A2 proof-ledger verification for supported
  fixture cases.
- Cross-platform full-suite validation on Windows, macOS, and Linux with Node.js 22 and 24, plus
  packed-CLI compatibility smoke tests on the oldest supported Node.js 18 runtime.

### Safety

- Host execution is reported as `uncontained_host`; it is never presented as sandboxed or
  intervention-verified.
- Captured output is bounded and redacted before its first disk write.
- Unsafe or unsupported execution paths return typed refusals instead of speculative causes.

### Current limits

- Host observation can establish `PARTIAL_EVIDENCE`, not causal proof.
- Isolated proof depends on a separately qualified maintainer backend and is not automatic host
  repair.
- Public behavior remains pre-1.0 and may evolve between minor releases.
