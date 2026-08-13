# Validation

rclweb turns design targets into release authority through reproducible conformance, performance, security, and operations evidence. Support rows begin as **Qualification targets** and become **Qualified** when a human updates the [support matrix](./support-matrix.md).

## What must be true

| Claim | Evidence |
|---|---|
| Wire agreement | CDR, schemas, graph, QoS, and ROS time agree for the gated rows (`just test`, committed corpus) |
| Live path | Talker → `rclwebd` → TypeScript subscribe in CI (`just e2e`, `just e2e-h-ft`, `just e2e-row`) |
| Browser runtime | Wasm core plus real ROS operations (subscribe, publish, service, action, graph, parameters) |
| Release | Identity, policy, deployment, reviewed matrix, and package `rclweb@0.0.1` |

## Live path

```text
ROS talker
  -> serialized rcl surface in rclwebd
  -> R2WP over binary WebSocket
  -> browser I/O Worker
  -> rclweb core (wasm) decode with borrowed views
  -> typed event in a demo page or harness
```

`just e2e` / `just e2e-h-ft` / `just e2e-row` are the live gates. `just poll-latency`, `just large-message`, and `just perf-baseline` print measurements to stdout. Do not commit that output.

## Engineering targets

| Dimension | Target |
|---|---:|
| CDR agreement | 100% for the declared corpus |
| Transport efficiency | At least 80% of raw WebTransport for medium and large payloads |
| Small-message bridge latency | Loopback p99 at or below 3 ms for 1 KiB |
| Medium-message bridge latency | LAN p99 at or below 8 ms for 32 KiB |
| PointCloud2 path | 4 MiB at 10 Hz for 30 minutes within accepted budgets |
| Memory | Stable post-warmup envelope |
| Cached package startup | At or below 1.5 seconds |
| LAN graph readiness | At or below 500 ms |
| Session resume | At or below 2 seconds after a qualified network change |

These values guide engineering. Reports establish accepted results for their recorded environment.

## Evidence contract

Each accepted claim records:

- code, fixture, package, image, and environment identity;
- support row, gateway, domain, and adapter provenance;
- command, workload, budgets, duration, samples, warm-up, and variance;
- stdout from the reproducing command (not committed);
- timestamps, queues, resources, errors, and stable dispositions;
- artifact location and integrity;
- reviewer, gate, decision, and known limits.

A row becomes **Qualified** only when a human updates the [support matrix](./support-matrix.md). There is no `evidence-check` job and no committed measurement JSON under `docs/evidence/`.

## Foundation CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) installs the pinned toolchains with SHA-pinned setup actions (`oven-sh/setup-bun`, `extractions/setup-just` with one retry, `dtolnay/rust-toolchain`) and runs `just check`, `just test`, and `just build` (`foundation` job), including the `rclweb` wasm32 build. Live jobs run the digest-pinned talker lanes (Jazzy, Humble, and the Cyclone/Zenoh rows). Those jobs do not upload or commit measurement JSON. E2e images copy Bun from digest-pinned `oven/bun` (must match `.bun-version`); they must not pipe `bun.sh/install`. Operations tests (`/livez`, `/readyz`, drain, `/metrics`) run in foundation via `just test`; runtime images are Docker artifacts, not foundation jobs.

## Qualification scenarios

- sustained load with graph churn;
- latency, loss, reordering, constrained bandwidth, roaming, sleep and wake, and path change;
- gateway restart, Worker fault, identity or policy change, clock jump, and schema change;
- adapter profile mismatch and readiness behavior;
- stable deployment resume and replacement deployment session creation;
- oversized data, rate pressure, command concurrency, cache pressure, and audit outage;
- the six support rows on each declared CPU architecture;
- multi-domain isolation within a row and independent composition across rows;
- browser capability tiers and deployment profiles;
- install, upgrade, rollback, credential rotation, and recovery.

Every injected event maps to visible product state, a stable reason, and correlated traces.

## Review triggers

- CDR disagreement reopens codec and type-system review.
- Timing, copies, allocations, memory growth, or toolchain drift reopen runtime-boundary review.
- Transport, proxy, reconnect, or roaming gaps reopen channel and compatibility review.
- QoS or ROS semantic differences reopen runtime and RMW review.
- Security, deployment, soak, fault, or recovery findings reopen the affected release review.
