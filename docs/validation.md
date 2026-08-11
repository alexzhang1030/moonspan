# Validation and delivery gates

Moonspan converts architecture targets into release authority through reproducible conformance, benchmark, security, and operations evidence. Every claim moves from a documented target to raw measurement, reviewed report, and named gate decision.

First-stage environment rows and status vocabulary live in the [support matrix](./support-matrix.md). Rows start as **Qualification targets** and become **Qualified** only through reviewed evidence reports.

## Native evidence levels

| Level | Required evidence | Delivery point |
|---|---|---|
| N1 Wire-native | CDR golden bytes, schema identity `(scheme, value)`, graph, QoS, and ROS time interoperability across declared first-stage RMWs | M1 core data-path gate |
| N2 Runtime-native | `rclmbt` conformance for Context, Node, Executor, graph, publish/subscribe, Service, Action, Parameter, QoS, and Clock plus real ROS operation | M2 semantic gate |
| N3 Package-native | Reproducible selected-package Wasm builds, custom-message operation, size, startup, memory, and supported-API report | Post-release experiment |

## First mainline evidence slice

```text
ROS 2 PointCloud2 publisher
  -> serialized ROS adapter
  -> rclwebd scheduler
  -> R2WP WebTransport or WSS
  -> browser I/O Worker
  -> rclmbt CDR field projection
  -> headless SDK consumer and checksum
  -> latency, queue, copy, allocation, and memory report
```

This slice tests CDR correctness, the MoonBit/Wasm host boundary, WebTransport and WSS behavior, backpressure, schema identity, large-message memory, and typed SDK delivery. The post-mainline Studio prototype adds GPU upload, media decode, and frame-pacing evidence.

## Mainline engineering targets

These values guide implementation and test design. Benchmark reports carry measured results and environment scope.

| Dimension | Target | Measurement |
|---|---:|---|
| CDR agreement | 100% across the declared corpus | Primitive, nested, bounded, unbounded, string, wide string, Service, Action, PointCloud2 |
| Transport efficiency | At least 80% of raw WebTransport | 64 KiB to 4 MiB payload A/B |
| Small-message bridge latency | p99 at or below 3 ms on loopback for 1 KiB | Monotonic source and receive traces |
| Medium-message bridge latency | p99 at or below 8 ms on LAN for 32 KiB | 1%, 10%, 40%, and 80% link-load runs |
| Point cloud data path | 4 MiB at 10 Hz for 30 minutes | RSS, Wasm, queues, drops, copies, allocations, consumer checksum |
| Memory | Stable post-warmup envelope | Gateway RSS, JS heap, Wasm memory, buffers, queues |
| Cached SDK startup | Ready at or below 1.5 seconds | 30 warm runs on the reference browser profile |
| LAN graph readiness | At or below 500 ms | 30 session starts |
| Session resume | At or below 2 seconds after a qualified network change | Wi-Fi roam, sleep/wake, and path-change scenarios |

## Common prototype targets

| Dimension | Target | Measurement |
|---|---:|---|
| Point cloud workspace | 4 MiB at 10 Hz with stable GPU and frame budgets | GPU upload, frame trace, memory, drops |
| Camera | 1080p60 decode; glass-to-glass p95 at or below 150 ms | Encoded and display timestamps |
| Representative workspace | At least 55 FPS with 12 panels | Frame trace and Worker telemetry |
| Main thread | Task p95 below 4 ms | `PerformanceObserver` trace |
| Interaction | Stable focus, keyboard, reduced-motion, and command flows | Automated accessibility plus manual review |

## Comparative benchmark matrix

Each transport report runs the same workload through:

- rosbridge JSON;
- rosbridge CBOR-RAW;
- Foxglove Bridge WSS/CDR;
- R2WP WSS/CDR;
- R2WP WebTransport/CDR;
- ROS2WASM's dynamic conversion path.

The workload set includes 64 B at 1 kHz, LaserScan 32 KiB at 40 Hz, PointCloud2 4 MiB at 10 Hz, encoded 1080p60 video for prototype media qualification, and 1000-endpoint graph churn. Reports capture p50, p95, p99, throughput, CPU, RSS, copies, allocations, queue depth, stable disposition reason, Wasm time, and delivery time. Prototype reports add GPU upload, decode, display, and FPS.

## Evidence artifact contract

Every conformance, benchmark, security, or operations claim carries:

- environment identity and pinned toolchain versions;
- code revision, package or image digest, and fixture manifest hash;
- `gateway_instance_id`, `support_row_id`, exercised `domain_id` values, and adapter ABI/artifact profile identity where a gateway process is under test;
- readiness and profile-validation results; a deliberately mismatched configuration or profile produces readiness status `adapter_profile_mismatch`;
- exact invocation and workload configuration;
- raw machine-readable results;
- generated human-readable tables;
- source, gateway, browser, decode, delivery, and display timestamps where applicable;
- queue and resource budgets plus stable disposition reasons;
- sample count, run duration, warm-up policy, and variance;
- reviewer, gate, and decision date.

Generated reports derive from raw artifacts through checked-in scripts. Release reports retain the raw artifact location and integrity hash.

## Foundation CI evidence lane

The workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) is the M0 **foundation tooling** evidence lane. It is separate from ROS support-row qualification and from U0 Studio.

| Item | Contract |
|---|---|
| Triggers | `push` to `main`, `pull_request`, `workflow_dispatch` |
| Runner | `ubuntu-24.04`, 20-minute timeout, `contents: read`, concurrency cancel-in-progress |
| Tool pins | Bun from `.bun-version`; Rust via `rust-toolchain.toml` (`1.97.1` + rustfmt/clippy); MoonBit full build ID from `.moon-version` into runner-temp `MOON_HOME` after SHA256-verified official installer; just `1.50.0` linux musl asset with official SHA256 into `RUNNER_TEMP/moonspan-bin` |
| Action pins | Full 40-character commit SHAs for `actions/checkout` (v7), `actions/cache` (v6), `actions/upload-artifact` (v7), `oven-sh/setup-bun` (v2.2.0) |
| Cache (dependency material only) | `~/.bun/install/cache`; Cargo `registry/index`, `registry/cache`, `git/db`; workspace `.mooncakes/`; key includes runner OS/arch, pin files, and lockfiles |
| Evidence init | After checkout: create `artifacts/ci/environment.txt` and recipe logs with `status=not-started` plus revision/lane metadata |
| Commands | `bun install --frozen-lockfile`, then `just toolchain-check`, `just check`, `just test`, `just build` with `pipefail` + `tee` overwriting the corresponding logs |
| Artifacts (available after checkout, `if: always()`, 14-day retention) | `moonspan-documentation-evidence-<run_id>-<attempt>` (docs, PCR docs, tasks, workflow, pins/locks, check/environment logs; hidden paths included) and `moonspan-test-build-evidence-<run_id>-<attempt>` (environment, toolchain-check, test, build logs) |
| Current evidence | Local `actionlint` and pinned root commands; first hosted run will record artifact URLs for review |
| R2WP v0 foundation (M0-03) | The frozen contract, TypeScript codecs, Rust and MoonBit reference parsers, four fixture corpora, and three-language agreement gate are complete. The [M0-03 completion record](./milestones/m0-03-r2wp-foundation.md) owns delivery revisions and accepted local results. The [fixture reference](../protocol/testdata/README.md) owns corpus structure and commands; the [agreement reference](../protocol/testdata/agreement/README.md) owns report digests and emitter details. M0-02 will attach hosted workflow URLs and artifacts. |

Phase 1 Humble/Jazzy rows **H-FT**, **H-CY**, **J-FT**, and **J-CY** remain **Qualification targets** for later ROS container workflows. Studio is a U0 side project after M3. Jazzy+ expansion remains later matrix work.

## Delivery gates

| Gate | Product evidence | Human decision |
|---|---|---|
| M0 Foundation | Accepted support profile, ADRs, pinned toolchains, foundation CI tooling evidence, accepted R2WP v0 contract and reproducible cross-language R2WP fixtures, CDR corpus, evidence schema | Contract baseline approval |
| M1 Core data path | N1 agreement, graph and publish/subscribe, both transports, both browser buffer paths, PointCloud2 headless run | Core architecture approval |
| M2 ROS semantics | Complete planned N2 surface, dynamic types, QoS matrix, recording, multi-domain DDS evidence | Semantic capability approval |
| M3 Production release | Identity, ACL, SROS2, audit, budgets, compatibility with **Qualified** release support rows, deployment, soak, fault, SDK, signed artifacts | Mainline release approval |
| U0 Common prototype | Released SDK integration, planned panels and workflows, rendering/media budgets, accessibility, command safety | Prototype acceptance |

## M1 core gate

- CDR corpus agreement reaches 100% for the declared M1 set.
- Real ROS graph and publish/subscribe operate bidirectionally.
- Sensor-data and reliable QoS profiles interoperate across the declared first-stage RMW rows.
- PointCloud2 4 MiB at 10 Hz runs for 30 minutes within queue, memory, copy, and allocation budgets.
- R2WP reaches the transport-efficiency target on the reference profiles.
- Reconnect, malformed input, stalled consumer, and Worker restart produce bounded recovery and stable reasons.

## Qualification scenarios

- Eight-hour representative load with graph churn.
- Wi-Fi roam, sleep/wake, proxy path, latency, packet loss, reordering, and constrained bandwidth.
- Gateway restart, Worker crash, session expiry, policy revision, clock jump, and schema change.
- Startup profile validation and readiness status `adapter_profile_mismatch` when configuration and artifact identity diverge.
- Stable-ID restart resume with preserved resumable state, and replacement-ID clean session behavior.
- Oversized samples, rate pressure, command concurrency, cache pressure, and audit sink failure.
- Humble and Jazzy across Fast DDS and Cyclone DDS. Same-row multi-domain DDS isolation runs one adapter support row at a time (H-FT, H-CY, J-FT, or J-CY) with multiple ROS domain IDs; the matrix runner repeats per row and CPU variant and compares results.
- Cross-row composition through independent SDK sessions that retain gateway, support-row, and domain provenance.
- Declared Chrome, Edge, Safari, and Firefox SDK capability tiers, with the Playwright-managed Chrome for Testing reference from the support matrix as the first-stage browser pin.
- Install, upgrade, rollback, certificate rotation, SROS2 rotation, and disaster recovery.
- Release support claims require every included matrix row to reach **Qualified** through a reviewed report; rows that retain **Qualification target** status stay in the future qualification set.

Post-first-stage expansion candidates (Kilted, Lyrical, Rolling, `rmw_zenoh`, Zenoh router topologies) follow independent qualification through the [support matrix](./support-matrix.md) after M0–M3 mainline gates.

Every injected event maps to observable product state, a stable metric or error reason, and correlated browser, gateway, and ROS trace identity.

## Architecture review triggers

- Any CDR corpus disagreement reopens codec or type-system design.
- MoonBit/Wasm jitter, allocation, copy, or toolchain reproducibility outside the accepted envelope reopens the runtime boundary.
- Transport efficiency, proxy coverage, or roaming outside gate criteria reopens transport priority and channel mapping.
- Large-message memory growth or delivery instability reopens buffer ownership, projection, queue, and scheduler design.
- QoS gaps across supported RMWs reopen channel mapping and support tiers.
- Security, compatibility, or eight-hour qualification findings outside release criteria return the affected gate to active work.
- N3 size, startup, memory, and API evidence determine the continuation scope of the package experiment.
