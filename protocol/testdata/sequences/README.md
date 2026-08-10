# R2WP v0 receiver state-sequence fixtures

State-sequence corpus for session, channel, and sequence receiver behavior (M0-03e2).
Generated and checked by [`scripts/protocol-sequence-fixtures.ts`](../../../scripts/protocol-sequence-fixtures.ts).

## Layout

| Path | Role |
|---|---|
| `manifest.json` | Versioned index of scenarios and reusable events |
| `scenarios/*.json` | Ordered events, expected outcomes, full state projections |
| `events/*.bin` | Exact wire event bytes (bootstrap / CONTROL_CBOR / ROS_SAMPLE) |

## Phase 1 support rows

| Row | ROS distro | RMW |
|---|---|---|
| H-FT | humble | rmw_fastrtps_cpp |
| H-CY | humble | rmw_cyclonedds_cpp |
| J-FT | jazzy | rmw_fastrtps_cpp |
| J-CY | jazzy | rmw_cyclonedds_cpp |

Each gateway process binds one row. Multiple domain ids share that row. Cross-row composition uses independent sessions.

## Commands

```bash
bun run protocol-sequence-fixtures:write
bun run protocol-sequence-fixtures:check
bun test scripts/protocol-sequence-fixtures.test.ts
```

Oracle outcomes are hard-coded from a deterministic state machine and cross-bound to
[`protocol/registry/r2wp-v0.json`](../../registry/r2wp-v0.json) error, disposition, and validation_order tables.
