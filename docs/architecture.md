# Architecture

rclweb places ROS application semantics in the browser and robot trust at the edge. The ROS domain retains native graph and middleware behavior. One Rust core serves both sides of the wire ([ADR 0010](./adr/0010-restructure-single-rust-core.md)).

## System shape

```text
Browser application or conformance harness
  TypeScript SDK
  rclweb core (Rust -> wasm32) in a Worker for protocol, CDR, and ROS state
  I/O Worker for transport and buffers
                 |
                 | R2WP / CDR
                 v
Robot edge
  one rclwebd process (links the same rclweb core natively)
  one selected ROS adapter support row
                 |
                 v
ROS 2 domains for that support row
```

J-FT and H-FT are delivery-gated. Corpus data for all six rows (H-FT, H-CY, H-ZN, J-FT, J-CY, J-ZN) stays committed; remaining rows enter through the [support matrix](./support-matrix.md). One gateway process binds one row and may expose multiple domain IDs. Applications combine independent SDK sessions across rows.

`gateway_instance_id` identifies a logical gateway deployment. `support_row_id` identifies the immutable ROS distribution and RMW profile of its artifact. `domain_id` identifies a ROS domain within that row. These values remain attached to graph, schema, channel, policy, audit, telemetry, and evidence records.

## Ownership boundaries

| Unit | Responsibility | Boundary |
|---|---|---|
| Browser SDK | Public typed API, sessions, Workers, telemetry, and buffer ownership | Versioned TypeScript API and events |
| I/O Worker | Transport, reconnect, and buffer transfer | Byte batches to and from the core |
| `rclweb` core | R2WP codecs, CDR, session/channel state, graph, QoS, clocks, and ROS operations | Host poll ABI (wasm) and Rust API (native) |
| `rclwebd` | ROS attachment, sessions, schema cache, scheduling, policy, audit, and operations | R2WP and the serialized rcl surface |
| ROS adapter | Versioned serialized C ABI (`serialized-adapter-v1`) + dlopen typesupport for one support row | Narrow serialized C surface ([R3-04](./milestones/r3-04-adapter-abi-typesupport.md)) |
| Conformance system | Fixtures, corpus, workloads, and the support matrix | Live gates and human qualification |
| Studio | Post-release workspace and visual application behavior | Released SDK and capability schema |

## Data paths

Inbound samples follow this path:

1. The serialized rcl surface receives CDR bytes with type, schema, QoS, time, and domain context.
2. `rclwebd` applies policy, budgets, scheduling, and deployment provenance on headers only; it never parses or copies the CDR body (`Bytes` fan-out, vectored writes).
3. R2WP carries the sample over binary WebSocket or WebTransport.
4. The I/O Worker transfers a bounded batch to the core Worker; one copy into wasm linear memory.
5. The core resolves the schema and emits typed SDK events whose bulk fields are borrowed views under the lease model.

Outbound operations follow the reverse path after validation in the core and policy at the gateway.

## Performance contracts

The sample path is copy discipline and drop discipline, with counters in telemetry.

**Copy budget.** Two controllable payload copies end-to-end for an inbound sample; anything beyond is a regression:

| Stage | Copies | Mechanism |
|---|---|---|
| rmw → serialized buffer | 1 (inherent) | `rcl_take_serialized_message` with pooled buffers |
| Gateway framing | 0 | Header and payload as separate chunks; `bytes::Bytes` + vectored writes; the gateway never parses or moves the CDR body |
| Gateway fan-out | 0 | Per-client policy on headers; one framed payload shared via `Bytes::clone` |
| Worker → wasm linear memory | 1 (inherent) | One whole-payload copy in; Wasm cannot view external `ArrayBuffer`s |
| Wasm → application | 0 | TypedArray views into wasm memory under the lease model |

The 0-copy view holds on the thread that owns wasm (the I/O Worker, or the calling thread when `options.inline: true`). Bulk fields that cross to the main thread are copied at that boundary: PointCloud2 `data` and service/action CDR. Shared wasm memory remains the parked path to 0-copy on the Worker ([ADR 0004](./adr/0004-browser-wasm-host-boundary.md)).

**CDR is O(1) for blob-heavy types.** Decoding PointCloud2 is metadata reads plus an (offset, length) for `data`. Codecs keep the borrowed-view contract; they do not materialize `Vec<u8>` for bulk payloads.

**Drop at the edge.** Best-effort channels enforce latest-wins admission and byte budgets at the gateway with stable dispositions. Data channels never use permessage-deflate.

**Transports.** Binary WebSocket is one TCP stream: a stalled reliable channel head-of-line blocks the connection. WebTransport (independent streams and datagrams) is the second transport ([R3-03](./milestones/r3-03-h-ft-webtransport.md)). Channel semantics are transport-neutral.

**Wasm.** Fat LTO, `codegen-units = 1`, `panic = abort`. Transferable `ArrayBuffer` is the general path; the `SharedArrayBuffer` ring is measured and stays COOP/COEP-gated ([ADR 0004](./adr/0004-browser-wasm-host-boundary.md)). `just build` prints staged wasm size; `just poll-latency` prints p50/p99 — the [ADR 0010](./adr/0010-restructure-single-rust-core.md) reopen inputs.

## Execution and buffers

The Rust/Wasm core owns synchronous state machines and CDR work. TypeScript Workers own browser scheduling, timers, network APIs, and buffer transfer. A bounded `poll` call joins those execution models ([ADR 0004](./adr/0004-browser-wasm-host-boundary.md)).

Cross-origin-isolated deployments may use a bounded `SharedArrayBuffer` ring. General deployments use transferable `ArrayBuffer` ownership. Both paths implement the same behavior and carry separate performance evidence.

## Invariants

- CDR stays on the main sample path; the gateway never parses sample bodies.
- R2WP framing, control messages, schema identity, errors, and queue reasons are versioned contracts; the current normative subset is the [v0.1 declaration](../protocol/r2wp-v0.md#normative-scope-v01-subset).
- Every queue declares sample and byte budgets.
- Browser async work crosses the Wasm boundary in bounded batches.
- The edge owns identity, SROS2, authorization, resource policy, and audit.
- Contract changes include fixtures; fixtures are the single conformance oracle.
- Performance and security changes include their relevant evidence.

## Detail ownership

| Topic | Document |
|---|---|
| Product sequence | [Product scope](./product-scope.md) |
| Single-core decision | [ADR 0010](./adr/0010-restructure-single-rust-core.md) |
| Protocol | [R2WP](./protocol/r2wp.md) |
| Core | [`rclweb` core](./runtime/core.md), [CDR contract](./runtime/cdr.md), [generated types](./runtime/generated-types.md) |
| Gateway | [`rclwebd`](./gateway/rclwebd.md) |
| Browser SDK | [SDK](./sdk.md) |
| Security | [Security](./security.md) |
| Platforms | [Compatibility](./compatibility.md), [support matrix](./support-matrix.md) |
| Evidence | [Validation](./validation.md) |
| Studio | [Common Studio prototype](./prototypes/studio-ui.md) |
