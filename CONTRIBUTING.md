# Contributing to RunParity

RunParity accepts narrow, evidence-backed improvements. A plausible difference
is not a verified cause, and a passing unit test is not fixture qualification.

## Before you start

1. Read [CONTEXT.md](./CONTEXT.md) for the domain vocabulary and release
   invariants.
2. Read [docs/SECURITY-MODEL.md](./docs/SECURITY-MODEL.md) before changing
   command execution, collection, redaction, shims, or reports.
3. Open the matching GitHub Issue form. Security-sensitive reports must follow
   [SECURITY.md](./SECURITY.md), not a public issue.
4. Keep the change inside one falsifiable behavior whenever possible.

## Local setup

Development targets maintained Node.js 22 or 24 and the pnpm version pinned in
`package.json`.

```console
pnpm install --frozen-lockfile
pnpm verify
```

The built controller retains Node 18/20 compatibility evidence for inspecting
legacy environments, but those EOL versions are not recommended contributor
runtimes.

## Change workflow

- Start with a failing test that demonstrates the public behavior or invariant.
- Make the smallest implementation change that turns it green.
- Add adversarial cases for impossible states, unsafe input, platform parity,
  and evidence overclaiming where relevant.
- Run the complete verification command above, not only a focused test.
- Update Current/Planned language in README and contracts when the executable
  boundary changes.

Do not resolve a test failure by weakening a fixture gold label. Fixture status
is derived from checked receipts; timestamps and filenames do not self-certify
implementation or verification.

## Pull request checklist

- The issue states the user problem and acceptance criteria.
- Tests show RED before the implementation and GREEN after it.
- Human and JSON behavior remain consistent.
- New evidence fields declare provenance and sensitivity treatment.
- Commands use explicit executable/argv and do not add implicit shell parsing.
- No claim exceeds the available Host observation or experiment ledger.
- `pnpm verify` and fixture validation pass on the submitted commit.

## Reports and fixtures

Never commit real credentials, private URLs, full environment dumps, user home
paths, or unreviewed RunParity reports. Use synthetic canaries in redaction tests.

A runnable proof fixture must be deterministic, offline, non-privileged, and
bound to its build/backend/ledger receipts. Until those receipts exist, keep it
truthfully marked `scaffold` or `implemented` as defined in
[docs/VALIDATION.md](./docs/VALIDATION.md).
