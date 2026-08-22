# Node engine drift demo

This fixture is intentionally incompatible with current Node.js releases. Its
`package.json` declares `engines.node: ">=99"`, while `fail.mjs` exits with 23.
It gives RunParity a deterministic, offline observation without installing a
second runtime or touching global configuration.

From the repository root:

```powershell
pnpm build
Set-Location examples/node-engine-drift
node ../../dist/cli.js doctor --report-only -- node fail.mjs
```

The current prototype should report a bounded `RUNTIME_MANAGER_DRIFT` candidate.
That candidate is an observed contract mismatch, not an isolated causal proof.
