# R4-03: Support matrix against live gates

Status: In progress (first slice). Remaining-row live e2e (H-CY, H-ZN,
J-CY, J-ZN) and human promotion to **Qualified** remain follow-ups.
This slice drops committed measurement JSON. Delivery gates are live CI.
A row becomes **Qualified** only by a human edit of the support matrix.

## Outcome (this slice)

| Area | Behavior |
|---|---|
| Measurements | Not committed. `just poll-latency`, `just large-message`, and `just perf-baseline` print to stdout. Optional dump: `RCLWEB_EVIDENCE_DIR`. |
| Matrix | [Support matrix](../support-matrix.md) lists live gates for J-FT and H-FT. Cyclone/Zenoh rows stay Qualification targets. |
| Promotion | A row becomes **Qualified** only by a human edit of that matrix. CI does not stamp `accept`. |

The owner rejected a machine report index and then the JSON pile itself: nothing in CI read those files, and `just build` rewrote timestamps on the wasm-size file. Git plus the matrix are enough. Do not add `docs/evidence/*.json` back.

This slice also dropped process that had no independent subject: the `workflow_dispatch`-only H-FT mock Docker lane (it re-ran `cargo test`), the extra foundation cargo invocations already covered by `just test`, CI `upload-artifact` wrappers, optional prek hooks, and the `just fuzz-smoke` alias for a test `just test` already runs.

## Delivery gates (not Qualified)

| Row | Gate |
|---|---|
| J-FT | `just e2e` (CI `e2e-ros-talker`); `just check` / `just test` / `just build` |
| H-FT | `just e2e-h-ft` (CI `e2e-ros-talker-h-ft`); H-FT protocol tests in `just test` |

## Acceptance evidence

```bash
just check && just test && just build
```

## Still open in R4-03

- Human promotion of J-FT / H-FT from delivery-gated to **Qualified**
- Live gateway e2e lanes for H-CY, H-ZN, J-CY, and J-ZN
- D-05 publication/retention beyond repository-committed artifacts
