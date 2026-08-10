# Architecture rationale

Moonspan places ROS-facing application semantics in browser Wasm and robot trust at the edge. This split gives application teams a portable typed SDK while concentrating ROS distro adaptation, private credentials, policy, resource control, and audit in `rclwebd`.

Detailed system structure lives in [formal architecture](../../docs/architecture.md). Protocol, runtime, and gateway contracts live in [R2WP](../../docs/protocol/r2wp.md), [`rclmbt`](../../docs/runtime/rclmbt.md), and [`rclwebd`](../../docs/gateway/rclwebd.md). First-stage Humble/Jazzy rows, exact pins, and later topology expansion live in the [support matrix](../../docs/support-matrix.md).

## Mainline shape

```text
Browser application or conformance harness
  TypeScript SDK + io.worker + rclmbt.worker
                 |
                 | R2WP / CDR
                 v
Robot edge: rclwebd + schema/policy + ROS C ABI adapter
                 |
                 v
ROS 2 domain through one selected first-stage DDS mapping
```

The common Studio prototype attaches as an application layer over the released SDK after the mainline release gate.

## Why these boundaries

- CDR stays on the hot path, giving ROS-generated fixtures a direct conformance role and controlling conversion cost.
- MoonBit/Wasm owns deterministic state, codecs, graph, QoS, and executor behavior.
- JavaScript Workers own browser async APIs, scheduling, timers, transport, and buffer ownership transfer.
- Rust owns concurrent transport and scheduling under explicit resource budgets.
- The C ABI concentrates ROS distro and RMW variation in one adapter surface.
- R2WP gives WebTransport and WSS one semantic contract.
- Schema identity `(scheme, value)` keeps Humble bundle digests and Jazzy RIHS values explicit across protocol, runtime, and gateway caches.
- The browser SDK isolates applications from Worker, buffer, transport, and reconnect mechanics.

## Stable ownership

| Unit | Durable ownership |
|---|---|
| R2WP | Frames, control plane, channel semantics, schema identity `(scheme, value)`, QoS mapping, errors, versioning |
| `rclmbt` | N2 state and behavior, CDR, type registry keyed by schema identity, host poll contract |
| Browser SDK | Public typed API, Worker lifecycle, async completion, telemetry |
| `rclwebd` | ROS attachment, schema cache by `(scheme, value)`, sessions, scheduling, policy, audit, operations |
| ROS adapter | Versioned serialized C ABI, distro/RMW integration, and schema acquisition |
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
