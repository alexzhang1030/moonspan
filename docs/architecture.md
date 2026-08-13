# Architecture

rclweb places ROS application semantics in the browser and robot trust at the edge. The ROS domain retains native graph and middleware behavior. One Rust core serves both sides of the wire ([ADR 0010](./adr/0010-restructure-single-rust-core.md)).

## System shape

```text
Browser application or conformance harness
  TypeScript package
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

All six support rows (H-FT, H-CY, H-ZN, J-FT, J-CY, J-ZN) have live talker e2e lanes and committed corpus data; promotion to **Qualified** is a human edit of the [support matrix](./support-matrix.md). One gateway process binds one row and may expose multiple domain IDs. Applications combine independent sessions across rows.

`gateway_instance_id` identifies a logical gateway deployment. `support_row_id` identifies the immutable ROS distribution and RMW profile of its artifact. `domain_id` identifies a ROS domain within that row. These values remain attached to graph, schema, channel, policy, audit, telemetry, and evidence records.

## Ownership boundaries

| Unit | Responsibility | Boundary |
|---|---|---|
| TypeScript package | Public API (`init` / `Node` / pub / sub / service / action). [How to](./typescript.md), [reference](./api.md) | Versioned TypeScript API |
| I/O Worker | Transport, reconnect, and buffer transfer | Byte batches to and from the core |
| `rclweb` core | R2WP codecs, CDR, session/channel state, graph, QoS, clocks, and ROS operations | Host poll ABI (wasm) and Rust API (native) |
| `rclwebd` | ROS attachment, sessions, schema cache, scheduling, policy, audit, and operations | R2WP and the serialized rcl surface |
| ROS adapter | Versioned serialized C ABI (`serialized-adapter-v1`) + dlopen typesupport for one support row | Narrow serialized C surface ([ADR 0006](./adr/0006-edge-ros-c-abi-boundary.md)) |
| Conformance system | Fixtures, corpus, workloads, and the support matrix | Live gates and human qualification |
| Studio | Post-release workspace and visual application behavior | Released TypeScript package and capability schema |

## Data paths

Inbound samples follow this path:

1. The serialized rcl surface receives CDR bytes with type, schema, QoS, time, and domain context.
2. `rclwebd` applies policy, budgets, scheduling, and deployment provenance on headers only; it never parses or copies the CDR body (header-prefixed take buffer, in-place header fill, `Bytes` fan-out).
3. R2WP carries the sample over binary WebSocket or WebTransport.
4. The I/O Worker delivers ROS_SAMPLE from the host WebSocket buffer ([ADR 0017](./adr/0017-host-retain-inbound-sample-payload.md)). When the host queue is idle, that frame is pinned and emitted without a poll batch. A sample that arrives while control is already queued stays ordered behind that flush. Other application frames copy the R2WP header+extension prefix into wasm. Control and bootstrap still copy the full frame.
5. The host emits typed sample events from the retained WebSocket buffer (String / PointCloud2 JS CDR). The core still owns control, channels, service/action, and generated codecs. Bulk fields are borrowed views of that buffer (or of wasm memory for the full-copy control path) under the lease model. The public `Node` API copies those fields into an owned ROS message and releases the lease after the callback.

Outbound operations follow the reverse path after validation in the core and policy at the gateway.

## Performance contracts

The sample path is copy discipline and drop discipline, with counters in telemetry. Live subscribe take writes CDR after a reserved R2WP header prefix so framing does not copy the body. Inbound publish/ops keep the CDR as a `Bytes` subslice of the WebSocket frame.

**Copy budget.** One controllable payload copy end-to-end for an inbound sample; anything beyond is a regression:

| Stage | Copies | Mechanism |
|---|---|---|
| rmw → serialized buffer | 1 (inherent) | `rcl_take_serialized_message` into a header-prefixed take buffer |
| Gateway framing | 0 | Fill the reserved R2WP header in place; the gateway never parses or moves the CDR body |
| Gateway fan-out | 0 | Per-client policy on headers; one framed payload shared via `Bytes::clone` |
| Worker → wasm linear memory | 0 (sample body) | ROS_SAMPLE stays in the JS buffer; other application frames copy the R2WP prefix only ([ADR 0017](./adr/0017-host-retain-inbound-sample-payload.md)) |
| Wasm → application | 0 | TypedArray view of the host-retained WebSocket buffer (`rcl-web/internal`) |

The 0-copy view holds on the thread that owns the WebSocket buffer (the I/O Worker, or the calling thread when `options.inline: true`). The public `Node` callback copies PointCloud2 `data` so the application never holds a lease (rclcpp-owned message). Bulk fields that cross to the main thread on the Worker path are copied at that boundary: PointCloud2 `data` and service/action CDR. Shared wasm memory remains the parked path to 0-copy on the Worker ([ADR 0004](./adr/0004-browser-wasm-host-boundary.md)).

**Why not zero.** The remaining controllable copy is the RMW take, not slack. `rcl_take_serialized_message` is the serialized adapter ABI; sharing RMW cache memory needs a later ADR ([ADR 0006](./adr/0006-edge-ros-c-abi-boundary.md)). Wasm linear memory still cannot alias a WebSocket `ArrayBuffer`; ROS_SAMPLE therefore never enters wasm. The sample also crosses the network — kernel and browser RX buffers sit outside this budget. Host-retain is allowed by [ADR 0004](./adr/0004-browser-wasm-host-boundary.md) (JavaScript owns buffer lifetimes) and recorded in [ADR 0017](./adr/0017-host-retain-inbound-sample-payload.md). Comparison with Foxglove Bridge and rosbridge is in [performance](./performance.md).

**CDR is O(1) for blob-heavy types.** Decoding PointCloud2 is metadata reads plus an (offset, length) for `data`. Codecs keep the borrowed-view contract; they do not materialize `Vec<u8>` for bulk payloads.

**Drop at the edge.** Best-effort channels enforce latest-wins admission and byte budgets at the gateway with stable dispositions. Data channels never use permessage-deflate.

**Transports.** Binary WebSocket is one TCP stream: a stalled reliable channel head-of-line blocks the connection. WebTransport (independent streams and datagrams) is the second transport. Channel semantics are transport-neutral.

**Wasm.** Fat LTO, `codegen-units = 1`, `panic = abort`. Transferable `ArrayBuffer` is the general path; the `SharedArrayBuffer` ring is measured and stays COOP/COEP-gated ([ADR 0004](./adr/0004-browser-wasm-host-boundary.md)). `just build` prints staged wasm size; `just poll-latency` prints p50/p99 — the [ADR 0010](./adr/0010-restructure-single-rust-core.md) reopen inputs.

## Execution and buffers

The Rust/Wasm core owns synchronous state machines and CDR work. TypeScript Workers own browser scheduling, timers, network APIs, and buffer transfer. A bounded `poll` call joins those execution models for control, codecs, and service/action ([ADR 0004](./adr/0004-browser-wasm-host-boundary.md)). No-extension ROS_SAMPLE on an idle host queue does not enter that poll batch ([ADR 0017](./adr/0017-host-retain-inbound-sample-payload.md)).

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
| TypeScript package | [`rcl-web`](./typescript.md) |
| Security | [Security](./security.md) |
| Platforms | [Compatibility](./compatibility.md), [support matrix](./support-matrix.md) |
| Evidence | [Validation](./validation.md) |
| Performance | [Performance](./performance.md) |
| Studio | [Common Studio prototype](./prototypes/studio-ui.md) |
