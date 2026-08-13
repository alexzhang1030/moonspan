# Performance

`just perf-baseline` times **bytes already in JS → usable ROS message** (latency / CPU / RSS). That is not a 13-byte Foxglove header `subarray`. Stdout only; do not commit it.

| | rosbridge JSON | Foxglove | rclweb |
|---|---|---|---|
| Wire | JSON; blobs as base64 | CDR + 13 B | CDR + 32 B |
| Gateway extra copy of CDR | 1 | 1 | **0** |
| Browser, usable message | `JSON.parse` (+ base64) | JS CDR decode | wasm memcpy + typed decode |
| Controllable copies | 3 | 2 | 2 |

Foxglove can view PointCloud2 `data` on the WS buffer. rclweb copies the frame into wasm (copy-budget slot 2, [ADR 0004](./adr/0004-browser-wasm-host-boundary.md)). Engineering p99 targets are e2e, in [validation](./validation.md#engineering-targets), and are not CI fails.

| Command | Measures |
|---|---|
| `just perf-baseline` | p50/p99/mean, CPU µs/sample, RSS at 1 KiB, 32 KiB, PointCloud2 ~1 MiB |
| `just perf-baseline-live` | Docker stamp latency + CPU/RSS vs foxglove_bridge and rosbridge |
| `just poll-latency` | Empty timer-poll (wasm size reopen input) |
