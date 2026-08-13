# R1-05: End-to-end CI evidence, demo, poll latency, copy counters

Status: Complete. A docker-compose (single Jazzy container) lane runs a real
ROS 2 talker through `rclwebd` into the `@rclweb/sdk` inline host and exposes
gateway + engine copy counters. Wasm size and poll latency print from
`just build` / `just poll-latency`. The committed demo under
`examples/subscribe-chatter` exercises subscribe and publish from a browser
page on the Worker path (serves `sdk/typescript/dist/` after `just build`;
[R4-04](./r4-04-sdk.md)). CI e2e still uses the inline harness.

## Outcome

Live `/chatter` samples reach a typed SDK handler in CI. Wasm size and poll
latency are R-D1 reopen inputs: `just build` stages `rclweb.wasm` and prints
size; `just poll-latency` prints p50/p99. Neither writes into the repo.

Copy budget (two controllable copies) is evidenced structurally and with
counters: gateway `payload_copies` via `/telemetryz`, browser
`copiesIntoEngine` via engine telemetry. Application delivery uses
`string_data` / leases (zero additional controllable copies).

The live gate is the compose job succeeding (`just e2e` / CI `e2e-ros-talker`).

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

## Behavioral notes

- [`docker/r1-e2e-entrypoint.sh`](../../docker/r1-e2e-entrypoint.sh) must
  disable `nounset` while sourcing `/opt/ros/jazzy/setup.bash`. With
  `set -u`, Jazzy's setup fails on optional unset vars such as
  `AMENT_TRACE_SETUP_FILES`.

## Ownership after completion

R1 gate closes when CI e2e is green and the demo has been human-reviewed.
R2 starts data-plane hardening on this path.
