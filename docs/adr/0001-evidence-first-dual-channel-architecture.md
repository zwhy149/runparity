# ADR-0001: Separate host observation from isolated experimentation

- Status: accepted
- Date: 2026-08-15

Implementation status: Host Observe is partial in prototype `0.0.0`. Isolated
Experiment and backend qualification are planned; no current command can emit
`VERIFIED_INTERVENTION`.

## Context

Environment diagnosis needs facts from the failing host, while causal experiments may execute untrusted repository scripts. Treating process supervision or Docker Desktop as universal sandboxing would create unsafe execution and misleading cross-platform claims.

## Decision

RunParity has two explicit channels:

- **Host Observe** runs only the command the user requested and records bounded, redacted facts. It does not claim containment.
- **Isolated Experiment** creates A1/B/A2 arms only on a backend that has passed platform-specific qualification.

Facts, judgments, execution, and proof ledgers remain separate modules. Unsupported backends may diagnose but cannot emit a VerifiedIntervention.

The user-requested Host Observe command is not contained and may mutate the host with the user's normal permissions; RunParity introduces no additional host repair or mutation. Host A is never compared with container B. Every A1, B, and A2 arm is rebuilt inside the same qualified backend from the same immutable base. B differs by exactly one typed Intervention; HOME, cache, temp, output, network policy, resource policy, and oracle remain identical.

## Consequences

- Linux rootless isolation is the planned first complete experiment backend.
- Windows and macOS remain observe/diagnose-only until native backends pass escape, credential, network, process-tree, and writable-boundary tests.
- Containers hosted by Windows or macOS can establish Linux guest experiment evidence only.
- The product refuses work rather than silently weakening its evidence standard.
