# R1-05: End-to-end CI evidence, demo, poll latency, copy counters

Status: Complete. A docker-compose (single Jazzy container) lane runs a real
ROS 2 talker through `rclwebd` into the `@rclweb/sdk` inline host, records
wasm poll latency and size, and exposes gateway + engine copy counters. The
committed demo under `examples/subscribe-chatter` exercises the same subscribe
path from a browser page.

## Outcome

Live `/chatter` samples reach a typed SDK handler in CI. Evidence files under
[`docs/evidence/`](../evidence/) capture:

| File | Content |
|---|---|
| `r1-04-wasm-size.json` | Fat-LTO wasm artifact size (R-D1) |
| `r1-05-poll-latency.json` | Wasm `poll` p50/p95/p99 (R-D1) |
| `r1-05-e2e.json` | Live subscribe run identity, samples, telemetry |

Copy budget (two controllable copies) is evidenced structurally and with
counters: gateway `payload_copies` via `/telemetryz`, browser
`copiesIntoEngine` via engine telemetry. Application delivery uses
`string_data` / leases (zero additional controllable copies).

## Delivered scope

| Surface | Location |
|---|---|
| Engine telemetry | [`rclweb/src/engine/types.rs`](../../rclweb/src/engine/types.rs) (`EngineTelemetry`) |
| Wasm `rclweb_telemetry` | [`rclweb/src/host/abi.rs`](../../rclweb/src/host/abi.rs) |
| Gateway `/telemetryz` | [`rclwebd/src/telemetry.rs`](../../rclwebd/src/telemetry.rs), [`ws.rs`](../../rclwebd/src/ws.rs) |
| Poll latency script | [`scripts/measure-poll-latency.ts`](../../scripts/measure-poll-latency.ts) |
| E2E harness | [`examples/e2e-harness/`](../../examples/e2e-harness/) |
| Browser demo | [`examples/subscribe-chatter/`](../../examples/subscribe-chatter/) |
| Compose + image | [`docker/compose.r1-e2e.yml`](../../docker/compose.r1-e2e.yml), [`docker/Dockerfile.r1-e2e`](../../docker/Dockerfile.r1-e2e) |
| CI job | `e2e-ros-talker` in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) |

## Acceptance evidence

```bash
just poll-latency
just e2e                          # requires Docker
just check && just test && just build
```

## Ownership after completion

R1 gate closes when CI e2e is green and the demo has been human-reviewed.
R2 starts data-plane hardening on this path.
