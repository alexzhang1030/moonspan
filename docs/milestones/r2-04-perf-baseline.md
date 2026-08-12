# R2-04: Performance baseline versus Foxglove bridge and rosbridge

Status: Complete (host + protocol-cost evidence committed; live three-way
compose lane shipped and evidence-gated). R1 gate demo review remains `[~]`
and is out of scope for this note. D-05 (benchmark retention/publication)
stays open — evidence is committed under `docs/evidence/` only.

## Outcome

| Area | Behavior |
|---|---|
| Workloads | Fixed identities: PointCloud2 ~1 MB @ 10 Hz; ten image topics; one thousand small topics |
| rclweb host path | Transferable AB + `encodeHostBatch` fan-in for all three; large-frame engine retain probe on PC2 scale |
| Protocol cost models | Same payload bodies framed as R2WP / Foxglove MessageData / rosbridge JSON+base64 / rosbridge CBOR-RAW — wire bytes + encode/decode touch latency |
| Live bridges | Opt-in docker compose (`just perf-baseline-live`): stamped `std_msgs/String` e2e p50/p99 on rclwebd, foxglove_bridge, rosbridge_suite |
| Environment identity | Hostname, arch, CPU/mem, bun/rustc, support row target, docker/ROS gates, git SHA, stated clock-sync method |

Constraints preserved: single Rust core, no third-party rcl binding, no
permessage-deflate claim, inbound controllable copy budget ≤ 2, no invented
D-05 publication policy.

## Delivered scope

| Surface | Location |
|---|---|
| Workload + measure modules | [`scripts/perf-baseline/`](../../scripts/perf-baseline/) |
| Evidence script | [`scripts/measure-perf-baseline.ts`](../../scripts/measure-perf-baseline.ts) (`just perf-baseline`) |
| Host evidence | [`docs/evidence/r2-04-perf-baseline.json`](../evidence/r2-04-perf-baseline.json) |
| Live compose lane | [`docker/compose.r2-04-perf.yml`](../../docker/compose.r2-04-perf.yml) (`just perf-baseline-live`) |
| Live client | [`scripts/perf-baseline/live-measure.ts`](../../scripts/perf-baseline/live-measure.ts) |

## Acceptance evidence

```bash
bun run scripts/build-wasm.ts   # if wasm artifact missing
bun test scripts/perf-baseline.test.ts
bun run scripts/measure-perf-baseline.ts
just check && just test && just build
```

Optional live (Docker + heavy image):

```bash
just perf-baseline-live
```

## Interpretation notes

- Protocol-cost models are structural wire comparisons on identical payload
  bodies. They are not a substitute for live bridge scheduling/RMW cost, but
  they explain the dominant expansion (rosbridge JSON+base64) versus CDR-preserving
  paths (R2WP, Foxglove MessageData, CBOR-RAW).
- Live compose measures loopback String stamp latency. Large PointCloud2 live
  e2e across all three bridges stays on the host/protocol paths until a binary
  subscribe harness lands; the workload identities are already shared.
- D-05 still owns external retention/publication policy.

## Ownership after completion

R3 owns services/actions/parameters/graph and WebTransport. R2 gate still needs
the adversarial suite (R2-03) plus this baseline's committed evidence; PointCloud2
at target rate is covered by R2-02 + this host path.
