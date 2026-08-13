# `rclweb` core

`rclweb` is the Rust core of the project: R2WP protocol codecs, CDR, and deterministic session/channel/ROS state. One codebase serves both sides of the wire — `rclwebd` links it natively, and the browser runtime is the same crate compiled to `wasm32-unknown-unknown` inside a TypeScript Worker host.

The R2WP v0 parsers, CDR core (`rclweb/src/cdr/`), session/channel state machine (`rclweb/src/session/`), sender-side encoders (`rclweb/src/protocol/encode.rs`), client connection engine (`rclweb/src/engine/`), and hand-written host poll ABI (`rclweb/src/host/`, ADR 0004) are complete. The TypeScript SDK wraps the wasm artifact. See the [plan](../../tasks/plan.md) and [ADR 0010](../adr/0010-restructure-single-rust-core.md).

## Responsibilities

- R2WP framing, deterministic CBOR, control parsing, and validation order
- R2WP encoding (bootstrap, control frames, TLVs, data-frame headers) proven by round-trips against the parsers
- CDR encoding, decoding, validation, and field projection ([CDR contract](./cdr.md))
- Session and channel state for the v0.1 normative subset, including graph snapshot/delta and service/action channels
- Client connection engine (`Role::Client`) producing/consuming the control and sample path, including the R2-01 publish/`SendSample` direction
- Host poll ABI: bounded event batches in, outbound work / app events / released buffers / next deadline out
- QoS subset on OpenChannel (reliability + KEEP_LAST depth); remaining QoS and clocks stay later
- Structured errors and telemetry events, including copy counters (R1-05) and outbound `samples_sent` (R2-01)

## Wasm host boundary

The [ADR 0004](../adr/0004-browser-wasm-host-boundary.md) boundary is implemented as a hand-written poll ABI (not `wasm-bindgen`):

| Rust/Wasm owns | TypeScript host owns |
|---|---|
| CDR, schemas, protocol and ROS state, deadlines, structured events | Browser network APIs, Worker scheduling, timers, buffers, SDK Promises, application delivery |

Each host turn passes a bounded event batch into `poll`. The result contains outbound work, completed operations, application events, released buffers, and the next deadline. Sample payloads are offset/len views into retained wasm memory under an explicit lease; the host must release before reclaim. Batch size, retained memory, and execution time are observable budgets. The transferable `ArrayBuffer` path is the general deployment; the `SharedArrayBuffer` ring is implemented on the host for measurement (R2-02) and stays evidence-gated for COOP/COEP production isolation per ADR 0004. See the [R1-04](../milestones/r1-04-wasm-host-sdk.md) and [R2-02](../milestones/r2-02-large-message-path.md) completion notes.

## CDR and buffers

The Rust CDR port implements the frozen [CDR core contract](./cdr.md) and must pass the committed corpus (56 fixtures, 18 comparison groups, tail-slack evidence, adversarial cases) as its R1-01 gate. Decoding blob-heavy types is O(1): metadata reads plus a borrowed (offset, length) view for bulk fields such as PointCloud2 `data` ([`cdr::point_cloud2`](../../rclweb/src/cdr/point_cloud2.rs), R2-02). Codecs never materialize owned copies of bulk payloads; applications receive TypedArray views into wasm memory under the host lease model.

## Types and schemas

The dual-scheme registry contract ([generated types](./generated-types.md)) is
implemented in Rust (`rclweb/src/types/`, R3-02): Bun generator metadata under
`rclweb/generated/metadata/`, production codecs for the nine Phase 1 corpus roots,
and an immutable `SchemaRegistry::phase1()` with representation-aware zero-tail
lookup. Jazzy uses `rep2011-rihs` identity; Humble uses `rclweb-schema-v1`
bundles (historical identifier, frozen on the wire). Wire SchemaRequest/Advertise/Response
exchange remains parked until a gateway schema-cache path lands.

## Validation

```bash
cargo test --locked -p rclweb
bun run scripts/build-wasm.ts
cargo build --locked -p rclweb --target wasm32-unknown-unknown --profile release-wasm
```

R1 records wasm artifact size (`just build` prints the staged byte count) and poll latency (`just poll-latency`) as [ADR 0010](../adr/0010-restructure-single-rust-core.md) reopen inputs. Copy counters live on the client engine (`EngineTelemetry`) and gateway (`/telemetryz`). R2-02 large-message numbers are `just large-message`. [Validation](../validation.md) owns phase evidence and release gates.
