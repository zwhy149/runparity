# Domain documentation

RunParity uses a single domain context.

Before exploring or changing the codebase, read:

1. `CONTEXT.md` for the canonical language and invariants.
2. Relevant records in `docs/adr/` for decisions that constrain the area.

Use the glossary's exact terms in tests, issues, CLI output, schemas, and documentation. Do not collapse carefully separated terms such as `ReferenceCandidate`, `QualifiedReference`, and `VerifiedIntervention` into a generic previous-run label or the absolute phrase “proven root cause.”

If a change contradicts an ADR, call out that conflict and supersede the ADR explicitly rather than silently drifting from it.
