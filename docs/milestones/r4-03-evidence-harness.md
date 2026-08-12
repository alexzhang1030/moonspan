# R4-03: Evidence harness and support-matrix reports

Status: In progress (first slice). Remaining-row live e2e (H-CY, H-ZN,
J-CY, J-ZN) and human `accept` of Qualified rows remain follow-ups.
This slice indexes committed measurements. It does not spin new RMW
lanes and does not recycle the closed pre-restructure report ceremony.

## Outcome (this slice)

| Area | Behavior |
|---|---|
| Index | Reports under [`docs/evidence/reports/`](../evidence/reports/) name a gate, point at raw `docs/evidence/*.json`, and record `review.decision`. |
| Checker | `just evidence-check` verifies parse, known gate, artifact path + sha256, and reviewer rules for non-pending decisions. |
| Review | Committed reports are `pending`. They do not make a support row **Qualified**. |
| Matrix | [Support matrix](../support-matrix.md) records pending reports for J-FT and H-FT and keeps Cyclone/Zenoh rows as Qualification targets. |

The pre-restructure M0-05a contract (sorted maps, generated JSON Schema, synthetic fixtures, media types, invocation bounds) stays parked. The owner rejected bringing those checks back.

## Committed reports (pending review)

| Report | Gate | Artifacts |
|---|---|---|
| [`r1-walking-skeleton.json`](../evidence/reports/r1-walking-skeleton.json) | R1 | wasm size + poll latency |
| [`r2-04-perf-baseline.json`](../evidence/reports/r2-04-perf-baseline.json) | R2 / J-FT | host + protocol-cost baseline |
| [`r3-03-h-ft-live.json`](../evidence/reports/r3-03-h-ft-live.json) | R3 / H-FT | Humble talker e2e + row protocol |

## Acceptance evidence

```bash
just evidence-check
bun test scripts/evidence-check.test.ts
just check && just test && just build
```

## Still open in R4-03

- Human review (`accept` / `reject` / `provisional`) of the pending reports
- Live gateway e2e lanes for H-CY, H-ZN, J-CY, and J-ZN
- D-05 publication/retention beyond repository-committed artifacts
