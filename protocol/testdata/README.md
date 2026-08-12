# R2WP v0 fixtures

Frozen byte-level fixtures for the R2WP v0 corpus. They are the single
conformance oracle: the `rclweb` core consumes them directly in its Rust test suite
(`rclweb/src/protocol/tests.rs`).

| Surface | File |
|---|---|
| Valid and boundary cases | [`manifest.json`](./manifest.json) with payloads under `valid/` |
| Malformed receiver cases | [`malformed/manifest.json`](./malformed/manifest.json) with payloads under `malformed/` |

R2-03 reintroduced a single small regenerator targeted at the v0.1 normative
subset: [`scripts/protocol-fixtures`](../../scripts/protocol-fixtures/). It
materializes all malformed (`hex` / `mutate`) recipes and the three valid
bootstrap records via `rclweb` encoders; parked valid frame binaries stay
frozen with sha256 integrity checks. See
[R2-03 milestone](../../docs/milestones/r2-03-fixtures-fuzzing.md).

```bash
just protocol-fixtures-check   # or: cargo run -p protocol-fixtures -- --check
just protocol-fixtures-write   # regenerate materializable bins
cargo test --locked -p rclweb
```
