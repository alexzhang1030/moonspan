# R2WP v0 fixtures

Frozen byte-level fixtures for the R2WP v0 normative subset. They are the single
conformance oracle: the `rclweb` core consumes them directly in its Rust test suite
(`rclweb/src/protocol/tests.rs`).

| Surface | File |
|---|---|
| Valid and boundary cases | [`manifest.json`](./manifest.json) with payloads under `valid/` |
| Malformed receiver cases | [`malformed/manifest.json`](./malformed/manifest.json) with payloads under `malformed/` |

The fixtures were generated at tag `pre-restructure` and are frozen data until R2,
which reintroduces a single small generator targeted at the v0.1 normative subset
(see the [restructure proposal](../../docs/proposals/architecture-restructure.md)).
The retired multi-implementation fixture categories (state sequences, transport
parity, and the three-language agreement corpus) live in git history at that tag.

```bash
cargo test --locked -p rclweb
```
