# Reference support profile

This document is the authoritative first-stage support matrix for Moonspan. Exact support-profile image, browser, and environment pins, schema identity schemes, and promotion rules live here. M0-02 pins Rust, MoonBit, and Bun in repository manifests; qualification reports record those resolved versions. [Compatibility](./compatibility.md) owns strategy and tier language. [ADR 0007](./adr/0007-humble-jazzy-schema-identity.md) owns the Humble/Jazzy schema identity decision.

**Status:** design baseline. Every first-stage row below is a **Qualification target** until a linked qualification report promotes it.

## Claim vocabulary

| Claim | Meaning |
|---|---|
| **Qualification target** | Declared first-stage row with pinned environment identity. Evidence reports are planned or in progress. |
| **Qualified** | A reproducible qualification report passed review for that row and revision. |
| **Experimental** | Scoped opt-in profile with published limits and experimental release status. |
| **Retired** | Former support row withdrawn from active release claims. |

Documentation uses **Qualification target** for every first-stage row until evidence lands. Qualification reports are the sole promotion path to **Qualified**.

## First-stage ROS distro and RMW rows

Each row below qualifies independently on `amd64` and `arm64`. Fast DDS (`rmw_fastrtps_cpp`) is the reference and default row on each distro. Cyclone DDS (`rmw_cyclonedds_cpp`) is the second qualification row.

| Row ID | Distro | RMW | Host OS | Status | Role |
|---|---|---|---|---|---|
| H-FT | Humble Hawksbill | `rmw_fastrtps_cpp` | Ubuntu 22.04 Jammy | Qualification target | Reference / default |
| H-CY | Humble Hawksbill | `rmw_cyclonedds_cpp` | Ubuntu 22.04 Jammy | Qualification target | Second DDS row |
| J-FT | Jazzy Jalisco | `rmw_fastrtps_cpp` | Ubuntu 24.04 Noble | Qualification target | Reference / default |
| J-CY | Jazzy Jalisco | `rmw_cyclonedds_cpp` | Ubuntu 24.04 Noble | Qualification target | Second DDS row |

CPU variants for every row: `amd64`, `arm64`.

### Pinned ROS images

| Distro | Host | Image pin |
|---|---|---|
| Humble | Ubuntu 22.04 Jammy | `docker.io/library/ros:humble-ros-base-jammy@sha256:7bea3d9aa2483d3ca34c8e30d921b79273b0913bd7dc64bebf51d082b5d107e4` |
| Jazzy | Ubuntu 24.04 Noble | `docker.io/library/ros:jazzy-ros-base-noble@sha256:da725acf8b0f9f30c683e33ffbdcd6482d077af96d6fdc7688c5f4f280b7d923` |

These multi-architecture digests were resolved from Docker Hub on **2026-08-10**. Each qualification report records the per-architecture manifest digest for the exercised platform plus the installed ROS and RMW package versions.

### Schema identity by distro

| Distro | Identity scheme | Acquisition | Notes |
|---|---|---|---|
| Humble | `moonspan-schema-v1` | Complete recursive deployment bundle and manifest | Value is SHA-256 of deterministic canonical bundle bytes. Channel open returns `schema_unavailable` when the required bundle is missing. |
| Jazzy | `rep2011-rihs` | Native `GetTypeDescription` with REP-2011 RIHS | Optional `moonspan-schema-v1` bundle-digest mapping records provenance and cross-version lookup. Schemes stay independent. |

Unified schema identity is the pair `(scheme, value)`. R2WP, the C ABI, caches, fixtures, and recording metadata carry `scheme`, `value`, type name, encoding, and schema generation together. Canonical bundle layout freezes in M0-04.

## Browser and runtime reference profile

| Element | First-stage pin | Status |
|---|---|---|
| Browser test runner | `@playwright/test` **1.62.0** | Qualification target |
| Browser image | `mcr.microsoft.com/playwright:v1.62.0-noble` | Qualification target |
| Browser binary | Playwright-managed Chrome for Testing build **151.0.7922.34** | Qualification target |
| MoonBit / Wasm | MoonBit target `wasm` in a Dedicated Worker; synchronous state-machine boundary per [ADR 0004](./adr/0004-browser-wasm-host-boundary.md) | Qualification target |
| Reference buffer path | Transferable `ArrayBuffer` | Qualification target |
| Fast-path buffer row | Bounded `SharedArrayBuffer` under cross-origin isolation | Qualification target (separate row) |
| Reference transport | WebTransport over HTTP/3 | Qualification target |
| Recovery / enterprise transport | Binary WSS | Qualification target (separate path under same R2WP wire version) |
| GPU | CPU-only mainline headless qualification | Qualification target |
| Network reference | Isolated full-duplex 1 GbE LAN | Qualification target |
| Network evidence rows | Loopback and impaired-network profiles | Separate evidence rows |

U0 owns later rendering GPU profiles for the common Studio prototype. M3 assigns broader browser tiers (Edge, Safari, Firefox) from automated and manual evidence while this matrix remains the Playwright/Chrome reference.

## Qualification artifacts and promotion

Every qualification report for a matrix row records:

- release and code revision;
- row ID, ROS distro, multi-arch image digest, per-architecture manifest digest, RMW, and installed package versions;
- OS, CPU architecture, browser runner, browser image, browser binary, Wasm mode, and buffer path;
- gateway transport, proxy, TLS, network profile, and deployment headers;
- graph, type identity (`scheme` + `value`), QoS, publish/subscribe, Service, Action, Parameter, Clock, reconnect, and policy results;
- performance summary, raw artifact location, known limits, and reviewer.

**Promotion rule:** a row moves from **Qualification target** to **Qualified** when its report set passes the evidence gates in [validation](./validation.md) and human review accepts the row for the named release revision.

## Later expansion candidates

These profiles form the post-first-stage expansion set:

- ROS distros: Kilted, Lyrical, Rolling;
- Topology: `rmw_zenoh`, Zenoh router topologies;
- Browser: broader SDK capability tiers beyond the Playwright/Chrome reference;
- Process and buffer experiments covered by later ADRs.

Each candidate enters through adapter build evidence, semantic conformance, fault scenarios, performance qualification, deployment documentation, and an explicit matrix revision.

## Update policy

- Immutable image digests and exact tool or browser versions change through a reviewed revision of this matrix plus fresh qualification evidence for every affected row.
- Schema identity schemes and first-stage distro/RMW membership change through ADR review and matrix revision together.
- Strategy language updates land in [compatibility](./compatibility.md); exact pins update here first.

## Primary sources

- [REP-2000](https://raw.githubusercontent.com/ros-infrastructure/rep/master/rep-2000.rst)
- [Docker Hub tag API: humble-ros-base-jammy](https://hub.docker.com/v2/repositories/library/ros/tags/humble-ros-base-jammy)
- [Docker Hub tag API: jazzy-ros-base-noble](https://hub.docker.com/v2/repositories/library/ros/tags/jazzy-ros-base-noble)
- [Official ROS Docker images](https://hub.docker.com/_/ros)
- [Playwright release notes](https://playwright.dev/docs/release-notes)
- [Playwright Docker](https://playwright.dev/docs/docker)
- [MoonBit toolchain commands](https://docs.moonbitlang.com/en/latest/toolchain/moon/commands.html)
- [ADR 0007: Humble/Jazzy schema identity](./adr/0007-humble-jazzy-schema-identity.md)
