# Validation and delivery gates

rclweb turns design targets into release authority through reproducible conformance, performance, security, and operations evidence. Support rows begin as **Qualification targets** and become **Qualified** through reviewed reports.

## Native evidence levels

| Level | Evidence | Gate |
|---|---|---|
| N1 Wire-native | CDR, schemas, graph, QoS, and ROS time agree for the gated rows | R2 |
| N2 Runtime-native | Browser runtime conformance and real ROS operations pass | R3 |
| N3 Package-native | Selected ROS packages build and run in Wasm with measured limits | X0 |

## Walking skeleton slice (R1)

```text
ROS talker
  -> serialized rcl surface in rclwebd
  -> R2WP over binary WebSocket
  -> browser I/O Worker
  -> rclweb core (wasm) decode with borrowed views
  -> typed SDK event in a demo page
```

R1 gates on this slice running live in CI, with recorded wasm artifact size, poll latency, and copy counters. R2 extends it to the PointCloud2 large-message path, backpressure, and the performance baseline against Foxglove bridge and rosbridge ([R2-04](./milestones/r2-04-perf-baseline.md)).

## Mainline targets

| Dimension | Target |
|---|---:|
| CDR agreement | 100% for the declared corpus |
| Transport efficiency | At least 80% of raw WebTransport for medium and large payloads |
| Small-message bridge latency | Loopback p99 at or below 3 ms for 1 KiB |
| Medium-message bridge latency | LAN p99 at or below 8 ms for 32 KiB |
| PointCloud2 path | 4 MiB at 10 Hz for 30 minutes within accepted budgets |
| Memory | Stable post-warmup envelope |
| Cached SDK startup | At or below 1.5 seconds |
| LAN graph readiness | At or below 500 ms |
| Session resume | At or below 2 seconds after a qualified network change |

These values guide engineering. Reports establish accepted results for their recorded environment.

## U0 targets

Studio qualification measures representative workspace frame pacing, main-thread work, PointCloud2 upload, camera latency, memory, interaction, accessibility, and command safety on its declared browser and graphics profiles.

## Evidence contract

Each accepted claim records:

- code, fixture, package, image, and environment identity;
- support row, gateway, domain, and adapter provenance;
- command, workload, budgets, duration, samples, warm-up, and variance;
- raw machine-readable output and generated report;
- timestamps, queues, resources, errors, and stable dispositions;
- artifact location and integrity;
- reviewer, gate, decision, and known limits.

The machine-readable qualification-report contract from the pre-restructure evidence harness is parked at tag `pre-restructure` and returns in R4, when real gate reports exist to validate ([ADR 0010](./adr/0010-restructure-single-rust-core.md)).

## Foundation CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) installs the pinned toolchains and runs the root check, test, and build commands (`foundation` job), including the `rclweb` wasm32 build. The `e2e-ros-talker` job runs the digest-pinned Jazzy compose lane (`docker/compose.r1-e2e.yml`) against a real ROS 2 talker. The `e2e-ros-talker-h-ft` job runs the digest-pinned Humble H-FT lane (`docker/compose.r3-03-h-ft-e2e.yml`) with in-image FFI regeneration. Both upload [`docs/evidence/`](./evidence/) artifacts. GitHub Releases fetches (foundation `just`, e2e Bun zips) go through [`scripts/github-release-curl.sh`](../scripts/github-release-curl.sh); e2e images must not pipe `bun.sh/install`.

## Delivery gates

| Gate | Required evidence | Decision |
|---|---|---|
| R0 Stop-loss | Shrunk repository green on the root command surface | Restructure baseline |
| R1 Walking skeleton | Live end-to-end subscribe in CI, corpus-passing CDR port, wasm size and poll latency, copy counters | Core architecture approval |
| R2 Data-plane hardening | Publish, QoS subset, budgets, reconnect, adversarial fixtures, fuzzing, performance baseline | Data-plane approval |
| R3 Semantics and breadth | N2 subset, generated types, second row, WebTransport, versioned adapter ABI | Semantic capability approval |
| R4 Productionization | Identity, policy, SROS2, audit, compatibility, deployment, evidence harness, SDK, and release artifacts | Release approval |
| U0 Studio | Released SDK integration, workflows, rendering, media, accessibility, and command safety | Prototype acceptance |

## Qualification scenarios

- sustained load with graph churn;
- latency, loss, reordering, constrained bandwidth, roaming, sleep and wake, and path change;
- gateway restart, Worker fault, identity or policy change, clock jump, and schema change;
- adapter profile mismatch and readiness behavior;
- stable deployment resume and replacement deployment session creation;
- oversized data, rate pressure, command concurrency, cache pressure, and audit outage;
- the gated support rows (J-FT in Phase 1; H-FT from R3; remaining rows in R4) on each declared CPU architecture;
- multi-domain isolation within a row and independent composition across rows;
- browser capability tiers and deployment profiles;
- install, upgrade, rollback, credential rotation, and recovery.

Every injected event maps to visible product state, a stable reason, and correlated traces.

## Review triggers

- CDR disagreement reopens codec and type-system review.
- Timing, copies, allocations, memory growth, or toolchain drift reopen runtime-boundary review.
- Transport, proxy, reconnect, or roaming gaps reopen channel and compatibility review.
- QoS or ROS semantic differences reopen runtime and RMW review.
- Security, deployment, soak, fault, or recovery findings reopen the affected release gate.
- N3 size, startup, memory, API, and maintenance evidence controls experiment continuation.
