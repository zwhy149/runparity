# Security policy

RunParity executes user-supplied commands and handles environment-derived
evidence. Reports may contain sensitive data even after defense-in-depth
redaction.

## Reporting a vulnerability

Do not open a public issue for suspected secret exposure, unintended command
execution, host mutation, path hijacking, process-cleanup bypass, report
injection, or isolation escape.

Use GitHub private vulnerability reporting through the repository's **Security →
Report a vulnerability** flow when it is enabled. Include only synthetic
credentials and the minimum reproduction needed. If private reporting is not
available, contact the repository owner privately before sending details; do not
paste them into an issue, discussion, CI log, or pull request.

Useful reports include:

- affected version or commit;
- operating system, architecture, and Node.js version;
- a minimal reproduction using synthetic canary values;
- the expected safety invariant and the observed violation; and
- whether any process, file, credential, or external service was affected.

## Supported versions

The project is currently a private `0.0.0` source prototype and has no supported
public release line. Security fixes are applied to the current `main` branch.
This policy will gain an explicit supported-version table before the first public
preview.

## Scope boundary

Host Observe is not a sandbox. A command explicitly supplied after `--` runs
with the user's ordinary host permissions and can have its normal side effects.
That documented behavior alone is not a vulnerability. Bypassing an explicit
refusal, corrupting the evidence/verdict boundary, leaking learned secrets, or
claiming verified containment without evidence is in scope.

Read [docs/SECURITY-MODEL.md](./docs/SECURITY-MODEL.md) for the full Current and
Planned threat model.
