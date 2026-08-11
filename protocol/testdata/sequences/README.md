# R2WP v0 receiver sequence fixtures

This corpus verifies session, channel, resume, and sequence state across ordered wire events. [`scripts/protocol-sequence-fixtures.ts`](../../../scripts/protocol-sequence-fixtures.ts) owns generation and checking.

## Layout

| Path | Role |
|---|---|
| `manifest.json` | Scenario and reusable event index |
| `scenarios/*.json` | Ordered events, expected outcomes, and state projections |
| `events/*.bin` | Bootstrap, control, and application wire records |

Scenarios cover Phase 1 rows H-FT, H-CY, J-FT, and J-CY. One gateway process binds one row and may expose multiple domain IDs. Cross-row composition uses independent sessions.

Expected outcomes come from a deterministic receiver state machine and bind to the registry's errors, dispositions, and validation order.

## Commands

```bash
bun run protocol-sequence-fixtures:write
bun run protocol-sequence-fixtures:check
bun test scripts/protocol-sequence-fixtures.test.ts
```
