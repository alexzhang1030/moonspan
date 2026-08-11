# Architecture

Moonspan places ROS application semantics in the browser and robot trust at the edge. The ROS domain retains native graph and middleware behavior.

## System shape

```text
Browser application or conformance harness
  TypeScript SDK
  rclmbt Worker for ROS state and CDR
  I/O Worker for transport and buffers
                 |
                 | R2WP / CDR
                 v
Robot edge
  one rclwebd process
  one selected ROS adapter support row
                 |
                 v
ROS 2 domains for that support row
```

Phase 1 support rows are Humble and Jazzy with Fast DDS, Cyclone DDS, and Zenoh: H-FT, H-CY, H-ZN, J-FT, J-CY, and J-ZN. Fast DDS is the reference row per distro. One gateway process binds one row and may expose multiple domain IDs. Applications combine independent SDK sessions across rows.

`gateway_instance_id` identifies a logical gateway deployment. `support_row_id` identifies the immutable ROS distribution and RMW profile of its artifact. `domain_id` identifies a ROS domain within that row. These values remain attached to graph, schema, channel, policy, audit, telemetry, and evidence records.

## Ownership boundaries

| Unit | Responsibility | Boundary |
|---|---|---|
| Browser SDK | Public typed API, sessions, Workers, telemetry, and buffer ownership | Versioned TypeScript API and events |
| I/O Worker | Transport, framing, reconnect, and buffer transfer | R2WP frames and bounded event batches |
| `rclmbt` | CDR, types, graph, QoS, clocks, executor, and ROS operations | Host poll ABI and typed events |
| `rclwebd` | ROS attachment, sessions, schema cache, scheduling, policy, audit, and operations | R2WP and the ROS adapter ABI |
| ROS adapter | Generic serialized operations for one support row | Versioned C ABI |
| Conformance system | Fixtures, workloads, environments, and reports | Machine-readable evidence |
| Studio | Post-release workspace and visual application behavior | Released SDK and capability schema |

## Data paths

Inbound samples follow this path:

1. The ROS adapter receives serialized data and its type, schema, QoS, time, and domain context.
2. `rclwebd` applies policy, budgets, scheduling, and deployment provenance.
3. R2WP carries the sample over WebTransport or binary WebSocket.
4. The I/O Worker validates and transfers a bounded batch to `rclmbt`.
5. `rclmbt` resolves the schema and emits typed SDK events with correlated telemetry.

Outbound operations follow this path:

1. The application creates a typed publish, Service, Action, or Parameter operation.
2. `rclmbt` validates type, schema, deadline, clock, and local state.
3. The I/O Worker frames the request with session and trace identity.
4. `rclwebd` applies authorization and resource policy.
5. The ROS adapter executes the serialized operation and returns its correlated result.

## Execution and buffers

MoonBit/Wasm owns synchronous state machines and CDR work. TypeScript Workers own browser scheduling, timers, network APIs, and buffer transfer. A bounded `poll` call joins those execution models.

Cross-origin-isolated deployments may use a bounded `SharedArrayBuffer` ring. General deployments use transferable `ArrayBuffer` ownership. Both paths implement the same behavior and carry separate performance evidence.

## Invariants

- CDR stays on the main sample path.
- R2WP framing, control messages, schema identity, errors, and queue reasons are versioned contracts.
- Every queue declares sample and byte budgets.
- Browser async work crosses the Wasm boundary in bounded batches.
- The edge owns identity, SROS2, authorization, resource policy, and audit.
- Both transports carry the same semantic events.
- Recording and live transport share schema, channel, and SDK event models.
- Contract changes include fixtures and review from each consumer.
- Performance and security changes include their relevant evidence.

## Detail ownership

| Topic | Document |
|---|---|
| Product sequence | [Product scope](./product-scope.md) |
| Protocol | [R2WP](./protocol/r2wp.md) |
| Runtime | [`rclmbt`](./runtime/rclmbt.md) |
| Gateway | [`rclwebd`](./gateway/rclwebd.md) |
| Security | [Security](./security.md) |
| Platforms | [Compatibility](./compatibility.md), [support matrix](./support-matrix.md) |
| Evidence | [Validation](./validation.md) |
| Studio | [Common Studio prototype](./prototypes/studio-ui.md) |
