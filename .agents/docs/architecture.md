# Architecture rationale

Moonspan places deterministic ROS application state in browser Wasm and robot trust at the edge. This gives applications a portable typed SDK and keeps ROS distribution adaptation, credentials, policy, resource control, and audit inside `rclwebd`.

Detailed contracts live in [architecture](../../docs/architecture.md), [R2WP](../../docs/protocol/r2wp.md), [`rclmbt`](../../docs/runtime/rclmbt.md), and [`rclwebd`](../../docs/gateway/rclwebd.md).

## System shape

```text
Browser application
  TypeScript SDK + Workers + rclmbt
                 |
                 | R2WP / CDR
                 v
Robot edge
  one rclwebd process and one adapter support row
                 |
                 v
ROS 2 domains for that row
```

One gateway process may expose multiple domain IDs within its support row. Fleet views combine independent SDK sessions across rows. Every event keeps gateway, support-row, and domain provenance.

`gateway_instance_id` identifies a logical gateway deployment. It survives ordinary restart and in-place upgrade when resumable state is preserved. `support_row_id` identifies the immutable ROS distribution and RMW profile of the running gateway artifact.

## Ownership

| Unit | Responsibility |
|---|---|
| R2WP | Frames, control messages, channels, schema identity, errors, versioning, and provenance |
| `rclmbt` | CDR ([core contract](../../docs/runtime/cdr.md)), type registry, ROS state, QoS, and host poll contract |
| Browser SDK | Public API, Worker lifecycle, buffer transfer, telemetry, and reconnect behavior |
| `rclwebd` | ROS attachment, sessions, schema cache, scheduling, policy, audit, and operations |
| ROS adapter | Versioned serialized C ABI for one support row |
| Conformance system | Fixtures, workloads, environment identity, evidence, and reports |
| Studio | Post-release workspace, panels, rendering, media, and command presentation |

## Design rules

- CDR stays on the binary data path.
- Browser APIs remain in JavaScript Workers.
- Queue, buffer, timeout, retry, and memory budgets are explicit.
- Shared contracts move with fixtures and multi-owner review.
- Security-sensitive work records effective policy, audit identity, and failure behavior.
- Performance-sensitive work records latency, throughput, copies, allocations, queues, and memory.
- Platform expansion enters through the [support matrix](../../docs/support-matrix.md) and [validation gates](../../docs/validation.md).

The mainline establishes the application contract. Studio begins after release and validates that contract through a broad integration example.
