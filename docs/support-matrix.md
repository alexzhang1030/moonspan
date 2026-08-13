# Reference support profile

This document owns the exact Phase 1 support rows and reproducibility pins. [Compatibility](./compatibility.md) owns strategy and tier language. [ADR 0007](./adr/0007-humble-jazzy-schema-identity.md) owns schema identity. [ADR 0008](./adr/0008-one-adapter-row-per-gateway-process.md) owns process topology.

Status: design baseline. Every row remains a **Qualification target** until its report passes review.

## Claim vocabulary

| Claim | Meaning |
|---|---|
| **Qualification target** | Pinned row awaiting accepted evidence |
| **Qualified** | Row and release revision accepted through reviewed evidence |
| **Experimental** | Opt-in row with published limits |
| **Retired** | Former row withdrawn from active support |

## Phase 1 ROS rows

| Row | ROS | RMW | Host | CPU | Status |
|---|---|---|---|---|---|
| H-FT | Humble Hawksbill | `rmw_fastrtps_cpp` | Ubuntu 22.04 | `amd64`, `arm64` | Delivery-gated (protocol + corpus + live Humble talker e2e); Qualification pending review |
| H-CY | Humble Hawksbill | `rmw_cyclonedds_cpp` | Ubuntu 22.04 | `amd64`, `arm64` | Delivery-gated (corpus + live Humble Cyclone talker e2e); Qualification pending review |
| H-ZN | Humble Hawksbill | `rmw_zenoh_cpp` | Ubuntu 22.04 | `amd64`, `arm64` | Delivery-gated (corpus + live Humble Zenoh talker e2e); Qualification pending review |
| J-FT | Jazzy Jalisco | `rmw_fastrtps_cpp` | Ubuntu 24.04 | `amd64`, `arm64` | Delivery-gated (protocol + corpus + live Jazzy talker e2e); Qualification pending review |
| J-CY | Jazzy Jalisco | `rmw_cyclonedds_cpp` | Ubuntu 24.04 | `amd64`, `arm64` | Delivery-gated (corpus + live Jazzy Cyclone talker e2e); Qualification pending review |
| J-ZN | Jazzy Jalisco | `rmw_zenoh_cpp` | Ubuntu 24.04 | `amd64`, `arm64` | Delivery-gated (corpus + live Jazzy Zenoh talker e2e); Qualification pending review |

Fast DDS (`rmw_fastrtps_cpp`) is the reference and default row for each ROS distribution. Cyclone DDS (`rmw_cyclonedds_cpp`) and Zenoh (`rmw_zenoh_cpp`) are peer first-class Phase 1 rows. All three RMW implementations share the same support level.

One gateway process binds one row and may host multiple domain IDs. `support_row_id` is fixed for the running artifact. `gateway_instance_id` identifies the deployment across eligible restart and upgrade paths. Applications use independent sessions across rows.

**H-FT delivery gate (R3-03):** SessionReady / OpenChannel row identity and `rclweb-schema-v1` OpenChannel are proven on the mock gateway in `just test` and the corpus. Live Humble rcl attachment is proven by the digest-pinned compose lane ([compose](../docker/compose.r3-03-h-ft-e2e.yml), CI `e2e-ros-talker-h-ft`, [milestone](./milestones/r3-03-h-ft-webtransport.md)): the image regenerates FFI against Humble headers, links `--features ros` with `ROS_PREFIX=/opt/ros/humble`, sets `RCLWEBD_SUPPORT_ROW=H-FT`, and runs talker → gateway → SDK. Default committed bindings remain Jazzy for host `just ros-test`.

## Qualification

Live gates are the delivery evidence. A row becomes **Qualified** only after a human updates this matrix. There is no evidence-check job and no committed measurement JSON ([R4-03](./milestones/r4-03-support-matrix.md)).

| Row | Delivery evidence | Status |
|---|---|---|
| J-FT | Live Jazzy talker e2e (`just e2e` / CI `e2e-ros-talker`); `just check` / `just test` / `just build` | Delivery-gated; Qualification pending review |
| H-FT | Live Humble talker e2e (`just e2e-h-ft` / CI `e2e-ros-talker-h-ft`); H-FT protocol tests in `just test` | Delivery-gated; Qualification pending review |
| J-CY, J-ZN | Live Jazzy Cyclone/Zenoh talker e2e (`just e2e-row j-cy` / `just e2e-row j-zn`, CI `e2e-ros-talker-jazzy-rmw`) | Delivery-gated; Qualification pending review |
| H-CY, H-ZN | Live Humble Cyclone/Zenoh talker e2e (`just e2e-row h-cy` / `just e2e-row h-zn`, CI `e2e-ros-talker-humble-rmw`) | Delivery-gated; Qualification pending review |

The remaining-row lanes share one image per distro ([compose](../docker/compose.r4-03-remaining-rows-e2e.yml)) and run one gateway process per row (ADR 0008). Zenoh lanes start `rmw_zenohd` before the nodes. Each lane's harness asserts the gateway `/configz` support row, and the gateway adapter probe fails start-up when `RMW_IMPLEMENTATION` does not name the row's RMW. Do not treat a green corpus or a green e2e job as **Qualified**.

## ROS base images

| ROS | Image |
|---|---|
| Humble | `docker.io/library/ros:humble-ros-base-jammy@sha256:7bea3d9aa2483d3ca34c8e30d921b79273b0913bd7dc64bebf51d082b5d107e4` |
| Jazzy | `docker.io/library/ros:jazzy-ros-base-noble@sha256:da725acf8b0f9f30c683e33ffbdcd6482d077af96d6fdc7688c5f4f280b7d923` |

Qualification reports record the exercised architecture digest, installed ROS and RMW packages, adapter ABI, and support-row identity.

### RMW package pins (arm64 corpus evidence)

The CDR generator installs exact official binary package versions for Fast DDS, Cyclone DDS, and Zenoh on both Humble and Jazzy. Per-row installed versions live in `conformance/cdr/fixtures/*/row.json` and the corpus `manifest.json`.

| Distro | Package | Installed version (arm64) |
|---|---|---|
| Humble | `ros-humble-rmw-zenoh-cpp` | `0.1.9-1jammy.20260725.135946` |
| Jazzy | `ros-jazzy-rmw-zenoh-cpp` | `0.2.9-1noble.20260612.051449` |

Zenoh is a Phase 1 first-class RMW through those official binaries ([rmw_zenoh binaries announcement](https://discourse.openrobotics.org/t/rmw-zenoh-binaries-for-rolling-jazzy-and-humble/41395), [ROS index](https://index.ros.org/r/rmw_zenoh/)). Current corpus evidence is **arm64**. **amd64** remains a future qualification evidence lane on the same support rows.

## Schema identity

| ROS | Scheme | Source |
|---|---|---|
| Humble | `rclweb-schema-v1` | Canonical recursive deployment bundle |
| Jazzy | `rep2011-rihs` | Native `GetTypeDescription` and REP-2011 RIHS |

The full schema key includes identity, type name, encoding, and generation. Missing Humble bundle material yields `schema_unavailable` during channel setup.

## Browser and runtime reference

| Element | Pin or profile | Status |
|---|---|---|
| Browser runner | `@playwright/test` 1.62.0 | Qualification target |
| Browser image | `mcr.microsoft.com/playwright:v1.62.0-noble` | Qualification target |
| Browser binary | Chrome for Testing 151.0.7922.34 | Qualification target |
| Wasm runtime | `rclweb` core (`wasm32-unknown-unknown`) in a Dedicated Worker | Qualification target |
| Reference buffer | Transferable `ArrayBuffer` | Qualification target |
| Isolated buffer | Bounded `SharedArrayBuffer` | Separate qualification row |
| Reference transport | WebTransport over HTTP/3 | Qualification target |
| Recovery transport | Binary WebSocket | Separate transport path |
| Mainline graphics | CPU-only headless profile | Qualification target |
| Reference network | Isolated full-duplex 1 GbE LAN | Qualification target |

Studio graphics and media profiles begin at U0.

## Promotion

A report records the release, environment, row and adapter identity, gateway and domain provenance, readiness, browser and buffer path, transport and network, semantic results, resource measurements, raw evidence, known limits, and reviewer. That list is for human review of this matrix, not a CI schema.

A row becomes **Qualified** when its reports pass [validation](./validation.md) and human review accepts the row for a named release revision.

## Later candidates

Jazzy+ expansion includes Kilted, Lyrical, Rolling, broader browser tiers, and separately reviewed process or buffer experiments. Zenoh router topologies beyond the Phase 1 `rmw_zenoh_cpp` support rows remain later topology work.

Changes to images, browsers, schema schemes, or row membership require a matrix revision and fresh evidence for affected rows.

## Sources

- [REP-2000](https://raw.githubusercontent.com/ros-infrastructure/rep/master/rep-2000.rst)
- [Official ROS images](https://hub.docker.com/_/ros)
- [Multiple RMW implementations](https://docs.ros.org/en/humble/How-To-Guides/Working-with-multiple-RMW-implementations.html)
- [rmw_zenoh](https://github.com/ros2/rmw_zenoh)
- [Playwright releases](https://playwright.dev/docs/release-notes)
