# ADR-0003: Separate Reference qualification from intervention verdicts

- Status: accepted
- Date: 2026-08-15

Implementation status: Reference discovery/qualification and A1/B/A2 are planned.
Prototype `0.0.0` always records no Reference and cannot emit
`VERIFIED_INTERVENTION`.

## Context

A successful CI job, a declared engine range, an environment difference, and a successful experimental arm have different evidential strength. A workflow signature establishes provenance, not comparability. A previous success may help select a hypothesis, but it cannot replace an intervention experiment.

## Decision

Use ReferenceCandidate, QualifiedReference, Finding, ProofLedger, and the terminal verdicts defined in `CONTEXT.md`.

A QualifiedReference may guide hypothesis selection but never grants verification. Without one, RunParity omits reference comparison; it may still emit `VERIFIED_INTERVENTION` when a fresh A1/B/A2 sequence satisfies every proof invariant. Otherwise its terminal verdict is `PARTIAL_EVIDENCE`, `INCONCLUSIVE`, `REFUSED_OUT_OF_SCOPE`, or `ABORTED_SAFETY` as applicable.

## Consequences

- First-touch observation, Reference discovery, and intervention evidence are measured separately.
- GitHub Actions integration can supply future ReferenceCandidates but is not described as automatic proof.
- UI and JSON schemas display terminal verdict, experiment progress, Reference qualification, and execution context as separate fields.
- Marketing copy is constrained by the same vocabulary as the implementation.
