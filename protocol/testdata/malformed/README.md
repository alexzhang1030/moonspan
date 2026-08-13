# R2WP v0 malformed fixtures

This corpus verifies receiver rejection behavior and validation precedence. The
`rclweb` core test suite consumes the bins as the single oracle.
[`scripts/protocol-fixtures`](../../../scripts/protocol-fixtures/) regenerates
every entry from its `hex` / `mutate` source recipe (`just protocol-fixtures-check`
/ `just protocol-fixtures-write`).

## Layout

| Path | Role |
|---|---|
| `manifest.json` | Fixture source, input identity, expected registry error, location, plane, step, and coverage |
| `*.bin` | Exact failing wire records |

Sources use a closed construction format with literal hex and bounded mutations.
Expected outcomes are fixed oracles bound to [`protocol/registry/r2wp-v0.json`](../../registry/r2wp-v0.json).
Multi-fault fixtures prove the declared receiver validation order.

## Commands

```bash
just protocol-fixtures-check
cargo test --locked -p rclweb
```
