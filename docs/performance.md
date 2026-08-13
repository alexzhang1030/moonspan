# Performance

`just perf-baseline` times **bytes already in JS → usable ROS message** (latency / CPU / RSS). That is not a 13-byte Foxglove header `subarray`. Stdout only; do not commit it.

| | rosbridge JSON | Foxglove | rclweb |
|---|---|---|---|
| Wire | JSON; blobs as base64 | CDR + 13 B | CDR + 32 B |
| Gateway extra copy of CDR | 1 | 1 | **0** |
| Browser, usable message | `JSON.parse` (+ base64) | JS CDR decode | wasm memcpy + typed decode |
| Controllable copies | 3 | 2 | 2 |

Foxglove can view PointCloud2 `data` on the WS buffer. rclweb copies the frame into wasm (copy-budget slot 2, [ADR 0004](./adr/0004-browser-wasm-host-boundary.md)). Engineering p99 targets are e2e, in [validation](./validation.md#engineering-targets), and are not CI fails.

**Ceiling on this hop.** Wasm linear memory cannot alias a WebSocket `ArrayBuffer` ([Wasm design #1162](https://github.com/WebAssembly/design/issues/1162); engines keep guard pages). BYOB stream reads *transfer* the buffer; `WebAssembly.Memory.buffer` is not transferable ([WHATWG streams #1109](https://github.com/whatwg/streams/issues/1109)). Foxglove `@foxglove/cdr` returns an aligned typed-array **view** of that buffer ([CdrReader.typedArray](https://github.com/foxglove/cdr/blob/main/src/CdrReader.ts)). Remaining ingest work is allocator + poll ABI (Talc, `rclweb_poll_ws`), not skipping the memcpy. RMW loans stay under [ADR 0006](./adr/0006-edge-ros-c-abi-boundary.md). `opt-level = 3` would reopen [ADR 0010](./adr/0010-restructure-single-rust-core.md) (`just build` size vs `just poll-latency`).

| Command | Measures |
|---|---|
| `just perf-baseline` | p50/p99/mean, CPU µs/sample, RSS at 1 KiB, 32 KiB, PointCloud2 ~1 MiB |
| `just perf-baseline-live` | Docker stamp latency + CPU/RSS vs foxglove_bridge and rosbridge |
| `just poll-latency` | Empty timer-poll (wasm size reopen input) |
