# R2WP v0 static malformed fixtures

Static malformed wire corpus for receiver validation order (M0-03e1). Generated and
checked by [`scripts/protocol-malformed-fixtures.ts`](../../../scripts/protocol-malformed-fixtures.ts).

## Layout

| Path | Role |
|---|---|
| `manifest.json` | Versioned index: id, kind, path, length, SHA-256, construction source, decoder context, expected registry code/name, TypeScript reason/offset, validation plane/step, coverage |
| `*.bin` | Exact failing wire bytes for binary entries |

## Bootstrap step 6

`payload_len` is u32. `bootstrap-step6-payload-overflow` is a 12-byte legal prefix that
declares `payload_len` 65536 (absolute ceiling 65535). The missing body also violates
step 7 exact-total. Observing the step 6 result (`message_too_large` /
`payload_too_large` at offset 8) establishes `precedence_6_before_7`.

## Construction DSL

Closed sources:

- `{ "$type": "hex", "hex": "..." }` — literal lowercase hex
- `{ "$type": "mutate", "base": { "$type": "hex", "hex": "..." }, "ops": [...] }` — bounded mutations (`truncate`, `set_u8`, `set_u16be`, `set_u32be`, `replace_hex`, `append_hex`) over literal hex

Canonical paths are exactly `malformed/<id>.bin`. Symlink artifacts are rejected. Allocation ceilings apply per fixture and corpus.

## Commands

```bash
bun run protocol-malformed-fixtures:write
bun run protocol-malformed-fixtures:check
bun test scripts/protocol-malformed-fixtures.test.ts
```

Expected outcomes are hard-coded oracles cross-bound to
[`protocol/registry/r2wp-v0.json`](../../registry/r2wp-v0.json) `validation_order` and error tables.
