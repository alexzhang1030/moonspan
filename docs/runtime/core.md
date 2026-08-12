# `rclweb` core

`rclweb` is the Rust core of the project: R2WP protocol codecs, CDR, and deterministic session/channel/ROS state. One codebase serves both sides of the wire — `rclwebd` links it natively, and the browser runtime is the same crate compiled to `wasm32-unknown-unknown` inside a TypeScript Worker host.

The R2WP v0 parsers are complete (moved from the pre-restructure gateway). The CDR core (`rclweb/src/cdr/`, R1-01) is complete against the frozen [CDR contract](./cdr.md). The walking-skeleton session/channel state machine (`rclweb/src/session/`, R1-02) is complete for the v0.1 subset (bootstrap, fresh authenticate/ready, channel open/ready/close, topic data direction, heartbeat/error). The sender-side encoders (`rclweb/src/protocol/encode.rs`, R1-03) cover deterministic CBOR, bootstrap records, extension TLVs, and selected frames — including an in-place frame-header writer for the one-copy sample path; the parsers are the oracle and every valid committed fixture re-encodes byte-identically. Host poll ABI remains R1-04. See the [plan](../../tasks/plan.md) and [ADR 0010](../adr/0010-restructure-single-rust-core.md).

## Responsibilities

- R2WP framing, deterministic CBOR, control parsing, and validation order
- R2WP encoding (bootstrap, control frames, TLVs, data-frame headers) proven by round-trips against the parsers
- CDR encoding, decoding, validation, and field projection (R1 port of the frozen [CDR contract](./cdr.md))
- Session and channel state for the v0.1 normative subset
- Graph, QoS, clocks, and operation state (later phases)
- Structured errors and telemetry events, including copy counters

## Wasm host boundary

The [ADR 0004](../adr/0004-browser-wasm-host-boundary.md) boundary is unchanged by the restructure: the core runs as a synchronous state machine inside a TypeScript Worker.

| Rust/Wasm owns | TypeScript host owns |
|---|---|
| CDR, schemas, protocol and ROS state, deadlines, structured events | Browser network APIs, Worker scheduling, timers, buffers, SDK Promises, application delivery |

Each host turn passes a bounded event batch into `poll`. The result contains outbound work, completed operations, application events, released buffers, and the next deadline. Batch size, retained memory, and execution time are observable budgets. The transferable `ArrayBuffer` path comes first; the `SharedArrayBuffer` ring stays evidence-gated.

## CDR and buffers

The Rust CDR port implements the frozen [CDR core contract](./cdr.md) and must pass the committed corpus (56 fixtures, 18 comparison groups, tail-slack evidence, adversarial cases) as its R1-01 gate. Decoding blob-heavy types is O(1): metadata reads plus a borrowed (offset, length) view for bulk fields such as PointCloud2 `data`. Codecs never materialize owned copies of bulk payloads; applications receive TypedArray views into wasm memory under the host lease model.

## Types and schemas

The dual-scheme registry contract ([generated types](./generated-types.md)) is frozen and retargets to Rust code generation in R3. Jazzy uses `rep2011-rihs` identity; Humble uses `moonspan-schema-v1` bundles (historical identifier, frozen on the wire).

## Validation

```bash
cargo test --locked -p rclweb
cargo build --locked -p rclweb --target wasm32-unknown-unknown
```

R1 adds the corpus gate for the CDR port and records wasm artifact size and poll latency — the [R-D1 reopen inputs](../proposals/architecture-restructure.md#rulings). [Validation](../validation.md) owns phase evidence and release gates.
