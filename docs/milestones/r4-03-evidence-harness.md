# R4-03: Evidence harness and support-matrix reports

Status: In progress (first slice). Remaining-row live e2e (H-CY, H-ZN,
J-CY, J-ZN) and human `accept` of Qualified rows remain follow-ups.
This slice returns the parked qualification-report contract against
real committed measurements. It does not spin new RMW lanes.

## Outcome (this slice)

| Area | Behavior |
|---|---|
| Contract | `rclweb-qualification-report-v1` recycles the pre-restructure M0-05a shape with R0–R4 / U0 / X0 gates. |
| Schema | Generated JSON Schema 2020-12 at [`docs/evidence/schema/qualification-report-v1.json`](../evidence/schema/qualification-report-v1.json). |
| Checker | `just evidence-check` validates schema identity, closed fixtures, gate reports, path confinement, and artifact SHA-256 / byte length. |
| Raw vs report | Existing [`docs/evidence/*.json`](../evidence/) stay raw measurements. Reports under [`docs/evidence/reports/`](../evidence/reports/) wrap them. |
| Review | Committed reports are `pending`. They do not make a support row **Qualified**. |
| Matrix | [Support matrix](../support-matrix.md) records pending reports for J-FT and H-FT and keeps Cyclone/Zenoh rows as Qualification targets. |

## Gate → evidence level

| Gate | Allowed levels |
|---|---|
| R0 | foundation |
| R1 | foundation, N1 |
| R2 | N1 |
| R3 | N1, N2 |
| R4 | operations, security |
| U0 | prototype |
| X0 | N3 |

N1/N2 reports must name `provenance.support_row_id`.

## Committed reports (pending review)

| Report | Gate | Level | Artifacts |
|---|---|---|---|
| [`r1-walking-skeleton.json`](../evidence/reports/r1-walking-skeleton.json) | R1 | foundation | wasm size + poll latency |
| [`r2-04-perf-baseline.json`](../evidence/reports/r2-04-perf-baseline.json) | R2 | N1 / J-FT | host + protocol-cost baseline |
| [`r3-03-h-ft-live.json`](../evidence/reports/r3-03-h-ft-live.json) | R3 | N1 / H-FT | Humble talker e2e + row protocol |

## Delivered scope

| Surface | Location |
|---|---|
| Model / contract / schema / CLI | [`scripts/evidence-model.ts`](../../scripts/evidence-model.ts), [`evidence-contract.ts`](../../scripts/evidence-contract.ts), [`evidence-schema.ts`](../../scripts/evidence-schema.ts), [`evidence-check.ts`](../../scripts/evidence-check.ts) |
| Layout | [`docs/evidence/README.md`](../evidence/README.md) |

## Acceptance evidence

```bash
just evidence-check
bun test scripts/evidence-check.test.ts
just check && just test && just build
```

## Still open in R4-03

- Human review (`accept` / `reject` / `provisional`) of the pending reports
- Live gateway e2e lanes for H-CY, H-ZN, J-CY, and J-ZN
- Wrapping remaining raw files (R2-02, R3-03 TLS, R3-04 ABI, R4-02 ops) as reports
- D-05 publication/retention beyond repository-committed artifacts
