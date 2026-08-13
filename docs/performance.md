# Performance

`just perf-baseline` times **bytes already in JS → usable ROS message** (latency / CPU / RSS). That is not a 13-byte Foxglove header `subarray`. Stdout only; do not commit it.

| | rosbridge JSON | Foxglove | rclweb |
|---|---|---|---|
| Wire | JSON; blobs as base64 | CDR + 13 B | CDR + 32 B |
| Gateway extra copy of CDR | 1 | 1 | **0** |
| Browser, usable message | `JSON.parse` (+ base64) | JS CDR decode | JS CDR decode (data is a view) |
| Controllable copies | 3 | 2 | **1** |

Foxglove views PointCloud2 `data` on the WS buffer. rclweb does the same: ROS_SAMPLE stays in JS, and PointCloud2 `data` is a view of those bytes ([ADR 0017](./adr/0017-host-retain-inbound-sample-payload.md)). Engineering p99 targets are e2e, in [validation](./validation.md#engineering-targets), and are not CI fails.

**Ceiling on this hop.** ROS_SAMPLE never enters wasm ([ADR 0017](./adr/0017-host-retain-inbound-sample-payload.md)). Remaining work versus Foxglove is the 32-byte R2WP header peek versus a 13-byte MessageData skip, plus session setup outside this hop. Wasm linear memory still cannot alias a WebSocket `ArrayBuffer` ([Wasm design #1162](https://github.com/WebAssembly/design/issues/1162)). RMW loans stay under [ADR 0006](./adr/0006-edge-ros-c-abi-boundary.md). `opt-level = 3` would reopen [ADR 0010](./adr/0010-restructure-single-rust-core.md) (`just build` size vs `just poll-latency`).

| Command | Measures |
|---|---|
| `just perf-baseline` | p50/p99/mean, CPU µs/sample, RSS at 1 KiB, 32 KiB, PointCloud2 ~1 MiB |
| `just perf-baseline-live` | Docker stamp latency + CPU/RSS vs foxglove_bridge and rosbridge |
| `just poll-latency` | Empty timer-poll (wasm size reopen input) |
