# Validation and delivery gates

rclweb turns design targets into release authority through reproducible conformance, performance, security, and operations evidence. Support rows begin as **Qualification targets** and become **Qualified** when a human updates the [support matrix](./support-matrix.md).

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
- stdout from the reproducing command (not committed);
- timestamps, queues, resources, errors, and stable dispositions;
- artifact location and integrity;
- reviewer, gate, decision, and known limits.

The live gates (`just e2e`, `just e2e-h-ft`, `just test`) are the delivery evidence. A row becomes **Qualified** only when a human updates the [support matrix](./support-matrix.md). There is no `evidence-check` job and no committed measurement JSON under `docs/evidence/` ([R4-03](./milestones/r4-03-support-matrix.md)).

## Foundation CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) installs the pinned toolchains with SHA-pinned setup actions (`oven-sh/setup-bun`, `extractions/setup-just` with one retry, `dtolnay/rust-toolchain`) and runs the root check, test, and build commands (`foundation` job), including the `rclweb` wasm32 build. The `e2e-ros-talker` job runs the digest-pinned Jazzy compose lane (`docker/compose.r1-e2e.yml`) against a real ROS 2 talker. The `e2e-ros-talker-h-ft` job runs the digest-pinned Humble H-FT lane (`docker/compose.r3-03-h-ft-e2e.yml`) with in-image FFI regeneration. Those jobs are the live gate; they do not upload or commit measurement JSON. E2e images copy Bun from digest-pinned `oven/bun` (must match `.bun-version`); they must not pipe `bun.sh/install`. R4-02 operations tests (`/livez`, `/readyz`, drain, `/metrics`) run in foundation via `just test`; the J-FT runtime image (`just image-rclwebd`) is a Docker artifact, not a foundation job.

## Delivery gates

| Gate | Required evidence | Decision |
|---|---|---|
| R0 Stop-loss | Shrunk repository green on the root command surface | Restructure baseline |
| R1 Walking skeleton | Live end-to-end subscribe in CI, corpus-passing CDR port, wasm size and poll latency, copy counters | Core architecture approval |
| R2 Data-plane hardening | Publish, QoS subset, budgets, reconnect, adversarial fixtures, fuzzing, performance baseline | Data-plane approval |
| R3 Semantics and breadth | N2 subset, generated types, second row, WebTransport, versioned adapter ABI | Semantic capability approval |
| R4 Productionization | Identity, policy, SROS2, audit, compatibility, deployment, reviewed evidence, SDK, and release artifacts | Release approval |
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
