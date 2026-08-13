# R4-03: Support matrix against live gates

Status: In progress. All six Phase 1 rows now carry live delivery gates;
human promotion to **Qualified** remains a follow-up.

Delivery gates are live CI. A row becomes **Qualified** only by a human
edit of the support matrix. There is no evidence-check job and no
committed measurement JSON.

## Outcome (first slice)

| Area | Behavior |
|---|---|
| Matrix | [Support matrix](../support-matrix.md) lists live gates for J-FT and H-FT. |
| Promotion | A row becomes **Qualified** only by a human edit of that matrix. CI does not stamp `accept`. |
| Measurements | `just poll-latency`, `just large-message`, and `just perf-baseline` print to stdout. Do not commit the output. |

## Outcome (this slice — remaining-row live lanes)

Live gateway e2e lanes cover J-CY, J-ZN, H-CY, and H-ZN. Each lane runs a
real talker → `rclwebd` (bound to that row) → SDK subscribe inside the
digest-pinned distro image, with the row's RMW selected by
`RMW_IMPLEMENTATION`.

| Area | Behavior |
|---|---|
| Rows | `rclwebd` parses all six Phase 1 rows from `RCLWEBD_SUPPORT_ROW` (`rclwebd/src/config.rs`). |
| RMW probe | The adapter probe rejects start-up when `RMW_IMPLEMENTATION` does not name the row's RMW — a J-CY process silently running Fast DDS is a mispaired lane, not a working row. |
| Images | The J-FT / H-FT e2e images take `RMW_APT_PACKAGES` to add Cyclone DDS and Zenoh; one image per distro serves both rows ([compose](../../docker/compose.r4-03-remaining-rows-e2e.yml)). |
| Zenoh | Entrypoints start `ros2 run rmw_zenoh_cpp rmw_zenohd` and wait for tcp/7447 before the talker and gateway (router-gossip discovery). |
| Harness | [`examples/e2e-harness`](../../examples/e2e-harness/run.ts) asserts the gateway `/configz` `support_row_id` before subscribing. |
| CI | `e2e-ros-talker-jazzy-rmw` and `e2e-ros-talker-humble-rmw` build one image per distro and run both rows serially (one gateway process per row, ADR 0008). |

## Delivery gates (not Qualified)

| Row | Gate |
|---|---|
| J-FT | `just e2e` (CI `e2e-ros-talker`); `just check` / `just test` / `just build` |
| H-FT | `just e2e-h-ft` (CI `e2e-ros-talker-h-ft`); H-FT protocol tests in `just test` |
| J-CY / J-ZN | `just e2e-row j-cy` / `just e2e-row j-zn` (CI `e2e-ros-talker-jazzy-rmw`) |
| H-CY / H-ZN | `just e2e-row h-cy` / `just e2e-row h-zn` (CI `e2e-ros-talker-humble-rmw`) |

## Acceptance evidence

```bash
just check && just test && just build
just e2e-remaining-rows   # or the per-row CI lanes
```

## Still open in R4-03

- Human promotion of the six rows from delivery-gated to **Qualified**
- D-05 publication/retention
