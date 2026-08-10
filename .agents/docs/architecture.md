# Architecture rationale

Moonspan places ROS-facing application semantics in browser Wasm and robot trust at the edge. This split gives application teams a portable typed SDK while concentrating ROS distro adaptation, private credentials, policy, resource control, and audit in `rclwebd`.

Detailed system structure lives in [formal architecture](../../docs/architecture.md). Protocol, runtime, and gateway contracts live in [R2WP](../../docs/protocol/r2wp.md), [`rclmbt`](../../docs/runtime/rclmbt.md), and [`rclwebd`](../../docs/gateway/rclwebd.md). First-stage Humble/Jazzy rows, exact pins, and later topology expansion live in the [support matrix](../../docs/support-matrix.md). Process topology follows [ADR 0008](../../docs/adr/0008-one-adapter-row-per-gateway-process.md).

## Mainline shape

```text
Browser application or conformance harness
  TypeScript SDK + io.worker + rclmbt.worker
                 |
                 | R2WP / CDR
                 v
Robot edge: one rclwebd process
  one selected adapter support row
  schema/policy + ROS C ABI adapter
                 |
                 v
ROS 2 domains under that support row
  multiple domain IDs, one DDS mapping per process
```

The common Studio prototype attaches as an application layer over the released SDK after the mainline release gate.

One process may expose multiple domains within its support row. Cross-row fleet views compose independent SDK sessions and retain gateway, support-row, and domain provenance.

`gateway_instance_id` is a deployment-provided stable identifier for one logical gateway instance. It persists across ordinary process restart and in-place upgrade when resumable state is preserved. A replacement deployment or intentionally fresh instance receives a new identifier. Matching `gateway_instance_id` supports restart resume; a replacement instance drives a clean session. `support_row_id` is immutable for the running artifact and profile.

## Why these boundaries

- CDR stays on the hot path, giving ROS-generated fixtures a direct conformance role and controlling conversion cost.
- MoonBit/Wasm owns deterministic state, codecs, graph, QoS, and executor behavior.
- JavaScript Workers own browser async APIs, scheduling, timers, transport, and buffer ownership transfer.
- Rust owns concurrent transport and scheduling under explicit resource budgets.
- The C ABI concentrates ROS distro and RMW variation in one adapter surface per process support row.
- R2WP gives WebTransport and WSS one semantic contract.
- Schema identity `(scheme, value)` keeps Humble bundle digests and Jazzy RIHS values explicit across protocol, runtime, and gateway caches.
- One support row per process is a Moonspan deployment policy grounded in ROS runtime selection through `RMW_IMPLEMENTATION` and the usual process-local graph-cache model; Moonspan holds the selected support-row profile constant for the gateway process lifetime.
- The browser SDK isolates applications from Worker, buffer, transport, and reconnect mechanics.

## Stable ownership

| Unit | Durable ownership |
|---|---|
| R2WP | Frames, control plane, channel semantics, schema identity `(scheme, value)`, gateway/support-row provenance, QoS mapping, errors, versioning |
| `rclmbt` | N2 state and behavior, CDR, type registry keyed by schema identity, host poll contract |
| Browser SDK | Public typed API, Worker lifecycle, async completion, telemetry |
| `rclwebd` | One support-row process, ROS attachment, schema cache by `(scheme, value)`, sessions, scheduling, policy, audit, operations |
| ROS adapter | Versioned serialized C ABI, distro/RMW integration, and schema acquisition for the bound row |
| Conformance system | Fixtures, workloads, environment identity, raw evidence and reports |
| Common Studio prototype | Workspace, panels, rendering, media, accessibility and command presentation |

## Dependency judgment

The mainline release establishes the contracts consumed by the common UI prototype. This order keeps protocol and SDK decisions driven by ROS semantics, compatibility, security, and measured data-path behavior. UI work then validates the released application surface through a broad integration example.

## Change rules

- Shared contracts move with versioned fixtures and multi-owner review.
- Resource-sensitive work carries queue, buffer, timeout, retry, and memory budgets.
- Hot-path work carries latency, throughput, copies, allocations, and queue evidence.
- Security-sensitive work carries effective policy, audit identity, and failure behavior.
- Platform expansion enters through the [support matrix](../../docs/support-matrix.md), [compatibility](../../docs/compatibility.md), and [validation](../../docs/validation.md).
