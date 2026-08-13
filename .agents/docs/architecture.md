# Architecture rationale

rclweb places deterministic ROS application state in browser Wasm and robot trust at the edge, with **one Rust core serving both sides of the wire**. This is the load-bearing decision ([ADR 0010](../../docs/adr/0010-restructure-single-rust-core.md)): the gateway must be native (it binds the rcl C surface), the browser must be Wasm, and a second language for the browser runtime would force every shared contract to exist twice plus permanent cross-implementation verification.

Detailed contracts live in [architecture](../../docs/architecture.md), [R2WP](../../docs/protocol/r2wp.md), [`rclweb` core](../../docs/runtime/core.md), and [`rclwebd`](../../docs/gateway/rclwebd.md).

## System shape

```text
Browser application
  TypeScript SDK + Workers + rclweb core (wasm32)
                 |
                 | R2WP / CDR
                 v
Robot edge
  one rclwebd process (same core, native) and one adapter support row
                 |
                 v
ROS 2 domains for that row
```

One gateway process may expose multiple domain IDs within its support row. Fleet views combine independent SDK sessions across rows. Every event keeps gateway, support-row, and domain provenance.

`gateway_instance_id` identifies a logical gateway deployment. It survives ordinary restart and in-place upgrade when resumable state is preserved. `support_row_id` identifies the immutable ROS distribution and RMW profile of the running gateway artifact.

## Ownership

| Unit | Responsibility |
|---|---|
| R2WP | Frames, control messages, channels, schema identity, errors, versioning, and provenance — normative subset declared per phase |
| `rclweb` core | Protocol codecs, CDR ([core contract](../../docs/runtime/cdr.md)), session/channel state (R1-02), type registry, ROS state, QoS, and host poll contract |
| Browser SDK | Public API (`@rclweb/sdk`), Worker lifecycle, buffer transfer, telemetry, and reconnect — no protocol parsing. Host and wasm ABI stay on `@rclweb/sdk/internal` ([SDK](../../docs/sdk.md)) |
| `rclwebd` | ROS attachment (versioned serialized adapter ABI + dlopen typesupport), sessions, schema cache, scheduling, policy, audit, and operations |
| Conformance system | Fixtures (single oracle), corpus, workloads, environment identity, and the support matrix |
| Studio | Post-release workspace, panels, rendering, media, and command presentation |

## Design rules

- CDR stays on the binary data path; the gateway never parses sample bodies.
- Browser APIs remain in JavaScript Workers; the core crosses the boundary through bounded poll batches (ADR 0004; R1-04 hand-written ABI + I/O Worker).
- The copy budget is two controllable payload copies end to end, with telemetry counters ([performance contracts](../../docs/architecture.md#performance-contracts)). Wasm→application is 0 copies on the thread that owns wasm; the I/O Worker copies bulk sample fields (PointCloud2 `data`) and service/action CDR before `postMessage` because wasm memory is not shared with main.
- Queue, buffer, timeout, retry, and memory budgets are explicit; best-effort channels drop at the edge with stable dispositions ([R2-01](../../docs/milestones/r2-01-data-plane-hardening.md)).
- Large-message / PointCloud2 delivery keeps O(1) borrowed CDR views and measures both host buffer strategies ([R2-02](../../docs/milestones/r2-02-large-message-path.md)).
- Service/action channels use `OPERATION_ID` streams; graph state arrives as GraphSnapshot/Delta after SessionReady ([R3-01](../../docs/milestones/r3-01-services-actions-graph.md)).
- Fixtures are the single conformance oracle; there is no cross-implementation agreement apparatus.
- Security-sensitive work records effective policy, audit identity, and failure behavior.
- Process operations (`/livez`, `/readyz`, `/configz`, `/metrics`, `POST /drain`) and the J-FT runtime image are the R4-02 deploy surface ([deploy](../../docs/deploy.md)); `/healthz` stays liveness.
- Platform expansion enters through the [support matrix](../../docs/support-matrix.md) and [validation gates](../../docs/validation.md) after the walking skeleton proves the path.

The walking skeleton (R1) establishes the application contract under live traffic. Studio begins after release and validates that contract through a broad integration example.
