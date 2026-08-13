# R4-03: Support matrix against live gates

Status: In progress (first slice). Remaining-row live e2e (H-CY, H-ZN,
J-CY, J-ZN) and human promotion to **Qualified** remain follow-ups.

Delivery gates are live CI. A row becomes **Qualified** only by a human
edit of the support matrix. There is no evidence-check job and no
committed measurement JSON.

## Outcome (this slice)

| Area | Behavior |
|---|---|
| Matrix | [Support matrix](../support-matrix.md) lists live gates for J-FT and H-FT. Cyclone/Zenoh rows stay Qualification targets. |
| Promotion | A row becomes **Qualified** only by a human edit of that matrix. CI does not stamp `accept`. |
| Measurements | `just poll-latency`, `just large-message`, and `just perf-baseline` print to stdout. Do not commit the output. |

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
- D-05 publication/retention
