# Performance

rclweb treats copies of sample CDR as a contract, not a tuning knobs pile. This page compares that path with [Foxglove Bridge](https://github.com/foxglove/foxglove-sdk/blob/main/ros/src/foxglove_bridge/README.md) and [rosbridge_suite](https://docs.ros.org/en/jazzy/p/rosbridge_suite/). Landscape context lives in [landscape](./landscape.md). The rclweb-only hop table is in [architecture](./architecture.md#performance-contracts).

Reproduce numbers with `just perf-baseline` (host + wire-cost models) and `just perf-baseline-live` (Docker, small-message loopback). Those recipes print to stdout. Do not commit the output ([gotcha](../.agents/docs/gotchas.md#do-not-commit-measurement-json)).

The TypeScript module [`scripts/perf-baseline/copy-path.ts`](../scripts/perf-baseline/copy-path.ts) is the machine-checkable twin of the copy table below (`bun test scripts/perf-baseline.test.ts`).

## What each system does with a sample

| | rosbridge JSON | Foxglove Bridge | rclweb |
|---|---|---|---|
| Wire body | JSON; opaque blobs as **base64** (common path) | CDR in `MessageData` (13-byte header) | CDR in R2WP `ROS_SAMPLE` (32-byte header) |
| Gateway parses CDR | Yes (`message_conversion`) | No | No |
| Gateway framing extra copy | JSON + base64 materialize | Typical coalesce of header + CDR into one WS buffer | **0** — take writes after a reserved header |
| Browser heap | `JSON.parse` + base64 decode | Subarray of the WebSocket `ArrayBuffer` (no wasm) | **One** memcpy into wasm linear memory |
| Blob-heavy decode | Field objects / decoded bytes | JS CDR decode | O(1) borrowed `data` view in wasm ([CDR](./runtime/cdr.md)) |
| Browser contract | rosbridge ops | Foxglove WS protocol (Studio-shaped) | rclcpp-shaped `Node` (topics, services, actions, graph) |
| Second transport | No | No | WebTransport (streams / datagrams) |

rosbridge also offers CBOR-RAW, which keeps a CDR body behind a thin CBOR byte-string. That path is closer to Foxglove on the wire; it is not the default JSON client path.

## Copy path (structural)

Counts are **controllable copies of the sample body in userspace** after it exists as serialized bytes. Kernel and browser socket buffers are outside the budget. Optional application copies (public `Node`, Worker `postMessage`, GPU upload) are not in the controllable total.

| Stage | rosbridge JSON | Foxglove `MessageData` | rclweb |
|---|---:|---:|---:|
| Take / deserialize | 1 | 1 (serialized) | 1 (serialized, header-prefixed) |
| Gateway framing | 1 (JSON + base64) | 1 (typical header+CDR coalesce) | **0** |
| Browser reconstitutes bytes | 1 (parse + base64 decode) | 0 (subarray of WS buffer) | 1 (Worker → wasm) |
| **Controllable total** | **3** | **2** | **2** |
| Wasm-thread / same-heap view after that | new bytes from decode | view | view (`rcl-web/internal`) |

Foxglove and rclweb land on the **same copy count** for a binary CDR sample. They spend the second copy in different places: Foxglove usually moves the body to prepend a 13-byte header and then the JS client can view the WebSocket buffer; rclweb never moves the body at the gateway and then copies once into wasm because the ROS core cannot alias an external `ArrayBuffer`.

rosbridge JSON is the expensive path: it transcodes the body and expands it.

**Why rclweb is not zero.** The two hops are `rcl_take_serialized_message` and wasm linear memory. Sharing RMW cache memory needs a later ADR ([ADR 0006](./adr/0006-edge-ros-c-abi-boundary.md)). Host-retaining the JS buffer and keeping only headers in wasm would skip the wasm payload copy but would move CDR and leases onto the host ([ADR 0004](./adr/0004-browser-wasm-host-boundary.md)). The sample also crosses the network.

## Wire size (protocol models)

Same CDR body, header and envelope only. Identities match `scripts/perf-baseline/protocol-cost.ts`. For a PointCloud2-scale body of 1_048_572 bytes:

| Protocol | Bytes on the wire | Expansion vs CDR body |
|---|---:|---:|
| rclweb R2WP | 1_048_604 | 1.0000 (32-byte header) |
| Foxglove `MessageData` | 1_048_585 | 1.0000 (13-byte header) |
| rosbridge CBOR-RAW | 1_048_577 | 1.0000 (5-byte bstr head) |
| rosbridge JSON + base64 | ≥ 1.33 × body | ≥ 4/3 for the blob, plus JSON keys |

Foxglove is slightly smaller on the wire (13 vs 32 header bytes). At 1 MiB that difference is noise. rosbridge JSON is not: base64 alone is a 33% tax on every blob, every sample.

`just perf-baseline` re-measures encode/decode-touch times for these envelopes and prints them. Treat those timings as this-machine stdout, not a committed gate.

## Where rclweb is actually ahead

Versus **rosbridge JSON** (the common web client path):

- CDR stays on the sample path; the gateway never builds a JSON object graph of the body.
- Wire expansion stays ~1.0 instead of ≥ 4/3.
- PointCloud2 `data` is an (offset, length) into retained storage, not a decoded array copy in the codec.
- Subscribe / publish / service / action / graph share one session and one copy budget.

Versus **Foxglove Bridge** (also CDR on the wire):

- Gateway framing does not memcpy the CDR body (header-prefixed take). Foxglove `MessageData` is a single blob; implementations typically coalesce header and body.
- The browser runtime is a ROS client: `Node`, typed topics, services, actions, QoS, graph — not only a visualization consumer of advertised channels.
- Copy and drop counters are first-class telemetry (`copies_into_engine`, gateway `/telemetryz`).
- WebTransport is a second transport with the same channel semantics.
- After the wasm hop, blob fields stay borrowed. Foxglove clients that decode CDR in JS still allocate per-field objects unless they special-case bulk fields.

Versus **both**:

- Best-effort channels drop at the edge with stable dispositions; data channels do not use permessage-deflate.
- One Rust core on both sides of the wire ([ADR 0010](./adr/0010-restructure-single-rust-core.md)).

rclweb does **not** claim fewer copies into a JS `ArrayBuffer` than Foxglove. Foxglove never enters wasm. The public `Node` callback copies PointCloud2 `data` so the application never holds a lease; `rcl-web/internal` on the wasm thread does not.

## Benchmarks

| Command | What it measures | Needs |
|---|---|---|
| `just perf-baseline` | Structural copy table, R2WP / Foxglove / rosbridge wire-cost models, rclweb host drain + one engine retain probe | `just build` wasm artifact |
| `just large-message` | PointCloud2-scale host encode + both buffer strategies + engine copy probe | wasm |
| `just poll-latency` | Wasm poll p50/p99 | wasm |
| `just perf-baseline-live` | Loopback subscribe latency on stamped `std_msgs/msg/String` against rclwebd, foxglove_bridge, and rosbridge_suite | Docker |

Live three-way compose is [`docker/compose.r2-04-perf.yml`](../docker/compose.r2-04-perf.yml). It is a small-message lane. Large PointCloud2 comparison on the live bridges stays on the protocol-cost + host probes until that compose grows a cloud publisher.

Engineering latency targets (not accepted evidence) remain in [validation](./validation.md#engineering-targets).
