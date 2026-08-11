# Validation and delivery gates

Moonspan turns design targets into release authority through reproducible conformance, performance, security, and operations evidence. Support rows begin as **Qualification targets** and become **Qualified** through reviewed reports.

## Native evidence levels

| Level | Evidence | Gate |
|---|---|---|
| N1 Wire-native | CDR, schemas, graph, QoS, and ROS time agree across Phase 1 rows | M1 |
| N2 Runtime-native | Browser runtime conformance and real ROS operations pass | M2 |
| N3 Package-native | Selected ROS packages build and run in Wasm with measured limits | X0 |

## First mainline slice

```text
ROS PointCloud2 publisher
  -> serialized ROS adapter
  -> rclwebd scheduler
  -> R2WP transport
  -> browser Workers
  -> rclmbt field projection
  -> headless SDK checksum and report
```

This slice tests CDR, the Wasm host boundary, both transports, backpressure, schema identity, large-message memory, and typed SDK delivery.

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

Checked-in scripts derive reports from raw artifacts. The closed machine-readable report contract is [evidence/README.md](../evidence/README.md) with schema [qualification-report-v1.json](../evidence/schema/qualification-report-v1.json) and checker `bun run evidence:check`.

## Foundation CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) installs the pinned toolchains and runs the root check, test, and build commands. M0-02 closes after a hosted run and its uploaded artifacts receive review. ROS support-row qualification and U0 Studio use later evidence lanes.

## Delivery gates

| Gate | Required evidence | Decision |
|---|---|---|
| M0 Foundation | Decisions, profiles, toolchains, CI, R2WP, CDR corpus, and evidence schema | Contract baseline approval |
| M1 Core data path | N1 agreement, graph, publish/subscribe, transports, buffers, and headless PointCloud2 | Core architecture approval |
| M2 ROS semantics | N2 semantics, dynamic types, QoS, recording, and multi-domain behavior | Semantic capability approval |
| M3 Production release | Identity, policy, SROS2, audit, compatibility, deployment, soak, faults, SDK, and release artifacts | Mainline release approval |
| U0 Studio | Released SDK integration, workflows, rendering, media, accessibility, and command safety | Prototype acceptance |

## Qualification scenarios

- sustained load with graph churn;
- latency, loss, reordering, constrained bandwidth, roaming, sleep and wake, and path change;
- gateway restart, Worker fault, identity or policy change, clock jump, and schema change;
- adapter profile mismatch and readiness behavior;
- stable deployment resume and replacement deployment session creation;
- oversized data, rate pressure, command concurrency, cache pressure, and audit outage;
- Humble and Jazzy with Fast DDS, Cyclone DDS, and Zenoh (H-FT, H-CY, H-ZN, J-FT, J-CY, J-ZN) on each declared CPU architecture;
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
