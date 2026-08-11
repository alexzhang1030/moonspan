# R2WP v0 malformed fixtures

This corpus verifies receiver rejection behavior and validation precedence. [`scripts/protocol-malformed-fixtures.ts`](../../../scripts/protocol-malformed-fixtures.ts) owns generation and checking.

## Layout

| Path | Role |
|---|---|
| `manifest.json` | Fixture source, input identity, expected registry error, location, plane, step, and coverage |
| `*.bin` | Exact failing wire records |

Sources use a closed construction format with literal hex and bounded mutations. Canonical paths and allocation limits are checked before file access or materialization.

Expected outcomes are fixed oracles bound to [`protocol/registry/r2wp-v0.json`](../../registry/r2wp-v0.json). Multi-fault fixtures prove the declared receiver validation order.

## Commands

```bash
bun run protocol-malformed-fixtures:write
bun run protocol-malformed-fixtures:check
bun test scripts/protocol-malformed-fixtures.test.ts
```
