# R4-03: Support matrix against committed evidence

Status: In progress (first slice). Remaining-row live e2e (H-CY, H-ZN,
J-CY, J-ZN) and human promotion to **Qualified** remain follow-ups.
This slice points the support matrix at real committed measurements.
It does not add an evidence-check CI job and does not recycle the
closed pre-restructure report ceremony.

## Outcome (this slice)

| Area | Behavior |
|---|---|
| Measurements | Existing [`docs/evidence/*.json`](../evidence/) stay the run records. |
| Matrix | [Support matrix](../support-matrix.md) lists which files back J-FT and H-FT delivery gates. Cyclone/Zenoh rows stay Qualification targets. |
| Promotion | A row becomes **Qualified** only by a human edit of that matrix. CI does not stamp `accept`. |

The owner rejected a machine report index (`evidence-check`, sha256 wrappers, generated JSON Schema). Git plus the matrix are enough.

This slice also dropped process that had no independent subject: the `workflow_dispatch`-only H-FT mock Docker lane (it re-ran `cargo test`), the extra foundation cargo invocations already covered by `just test`, CI `upload-artifact` wrappers, optional prek hooks, and the `just fuzz-smoke` alias for a test `just test` already runs.

## Delivery evidence (not Qualified)

| Row | Gate | Files |
|---|---|---|
| J-FT | R1 / R2 | [`r1-04-wasm-size.json`](../evidence/r1-04-wasm-size.json), [`r1-05-poll-latency.json`](../evidence/r1-05-poll-latency.json), [`r2-04-perf-baseline.json`](../evidence/r2-04-perf-baseline.json) |
| H-FT | R3 | [`r3-03-h-ft-e2e.json`](../evidence/r3-03-h-ft-e2e.json), [`r3-03-h-ft-row.json`](../evidence/r3-03-h-ft-row.json) |

## Acceptance evidence

```bash
just check && just test && just build
```

## Still open in R4-03

- Human promotion of J-FT / H-FT from delivery-gated to **Qualified**
- Live gateway e2e lanes for H-CY, H-ZN, J-CY, and J-ZN
- D-05 publication/retention beyond repository-committed artifacts
