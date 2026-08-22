## User problem

<!-- Link the issue and summarize the observable problem. -->

## Evidence and change

<!-- State the failing behavior, the smallest implementation change, and what remains unknown. -->

## Verification

- [ ] I observed a relevant test fail before the implementation and pass after it.
- [ ] `pnpm verify` passes.
- [ ] I tested human and JSON output when the public CLI contract changed.

## Safety and claim calibration

- [ ] No raw secret, private URL, full environment dump, or unreviewed report is included.
- [ ] New evidence has explicit provenance and sensitivity handling.
- [ ] The change adds no implicit shell parsing or automatic host repair.
- [ ] Host observation is not described as isolation or causal proof.
- [ ] Any `VERIFIED_INTERVENTION` claim is derived only from a qualified, receipt-bound A1/B/A2 ledger.

## Documentation

- [ ] Current/Planned wording remains accurate in README and contract documents.
- [ ] Any fixture status is derived from valid receipts rather than manually asserted.
