# Architecture

Moonspan follows a browser-runtime, controlled-edge, ROS-domain architecture. The browser hosts ROS-facing application semantics; the edge owns trust, ROS attachment, scheduling, and network adaptation; the ROS domain retains graph and middleware behavior.

## Mainline system shape

```text
Browser application or conformance harness
  TypeScript SDK
    rclmbt.worker     MoonBit -> Wasm: runtime, graph, QoS, CDR, types
    io.worker         WebTransport/WSS, framing, buffers, telemetry
          |
          | R2WP: fixed binary header + CDR or encoded payload
          v
Robot / Edge
  one rclwebd process
    one selected adapter support row (H-FT | H-CY | J-FT | J-CY)
    transport session + bounded channel scheduler
    graph/schema cache + policy + audit + metrics
    narrow rcl/rmw serialized C ABI adapter
          |
          v
ROS 2 domains under that support row
  multiple domain IDs, one DDS mapping per process
```

After the mainline release, the common Studio prototype adds React workspace state plus render and codec workers through the public TypeScript SDK.

First-stage adapter support rows are Humble/Jazzy with Fast DDS (`rmw_fastrtps_cpp`) and Cyclone DDS (`rmw_cyclonedds_cpp`). Exact row pins and **Qualification target** status live in the [support matrix](./support-matrix.md). Process topology follows [ADR 0008](./adr/0008-one-adapter-row-per-gateway-process.md). Later topology rows enter through support-matrix qualification.

One gateway process may expose multiple ROS domain IDs within its selected support row. Cross-row application and fleet views compose independent SDK sessions and retain `gateway_instance_id`, `support_row_id`, and `domain_id` provenance.

`gateway_instance_id` is a deployment-provided stable identifier for one logical gateway instance. It persists across ordinary process restart and in-place upgrade when resumable state is preserved. A replacement deployment or intentionally fresh instance receives a new identifier. Matching `gateway_instance_id` supports restart resume; a replacement instance drives a clean session. `support_row_id` is immutable for the running artifact and profile.

## Ownership boundaries

| Unit | Owns | Stable boundary |
|---|---|---|
| Browser SDK | Session lifecycle, typed APIs, Worker host, telemetry, buffer ownership | Public TypeScript API and versioned events |
| `io.worker` | WebTransport/WSS I/O, R2WP framing, reconnection, inbound and outbound buffers | R2WP frames and bounded event batches |
| `rclmbt` | Context, Node, Executor, Graph, QoS, Clock, Service, Action, Parameter, CDR, type registry keyed by `(scheme, value)` | Host `poll` ABI, typed SDK events, R2WP channels |
| `rclwebd` | One support-row process, sessions, channel scheduler, schema cache by `(scheme, value)`, identity, policy, audit, metrics, compatibility routing | R2WP toward browsers; narrow C ABI toward ROS |
| ROS C adapter | Generic serialized operations, distro-specific schema acquisition, and ROS integration for the bound support row | Versioned adapter ABI over `rcl` and `rmw` |
| ROS domain | Discovery, native endpoints, middleware delivery, ROS clocks and liveliness | Domain IDs under one selected first-stage support row |
| Conformance system | Fixtures, workload definitions, environment manifests, reports, release evidence | Machine-readable results and stable report schemas |
| Common Studio prototype | Workspace, panels, rendering, media, accessibility, operator interaction | Released browser SDK and policy capability schema |

## Inbound topic path

1. The ROS adapter receives a serialized sample with graph, type name, schema identity `(scheme, value)`, QoS, time identity, and domain identity.
2. `rclwebd` attaches `gateway_instance_id` and `support_row_id`, then applies session policy, queue budgets, and channel scheduling.
3. WebTransport or binary WSS carries the shared R2WP envelope.
4. `io.worker` validates the frame and transfers a bounded batch to `rclmbt.worker`.
5. `rclmbt` resolves the schema by `(scheme, value)` with type name, encoding, and schema generation, then decodes generated types or dynamically projects requested fields.
6. The SDK emits a typed sample plus correlated source, network, queue, decode, delivery, gateway, support-row, and domain telemetry.

## Outbound command path

1. The application creates a typed publish, service, action, or parameter operation through the SDK.
2. `rclmbt` validates the type, schema identity, deadline, clock, and local state transition.
3. `io.worker` frames the operation and attaches session and trace identity.
4. `rclwebd` evaluates operation ACLs, concurrency, rate, size, bandwidth, and deadline budgets under the process support row.
5. The C adapter executes the serialized ROS operation and returns status through the correlated channel.
6. Audit records retain identity, target, schema identity, `gateway_instance_id`, `support_row_id`, `domain_id`, decision, timing, result, and trace linkage.

## Buffer and execution model

- MoonBit/Wasm owns synchronous state machines, CDR work, graph state, QoS state, and executor dispatch.
- JavaScript owns browser Promises, Worker scheduling, timers, WebTransport, WebSocket, and buffer transfer.
- One host call delivers a bounded ready-event batch to `rclmbt.poll(batch)`; the result carries outbound work and the next deadline.
- Cross-origin-isolated deployments use a bounded `SharedArrayBuffer` ring fast path.
- General deployments use transferable `ArrayBuffer` ownership.
- Both paths share the same behavioral contract and carry separate performance evidence.

## Architecture invariants

- CDR stays on the sample hot path from ROS serialization through browser ingress.
- R2WP framing, control messages, schema identity `(scheme, value)`, QoS negotiation, errors, and queue reasons are versioned shared contracts.
- Every queue declares sample and byte budgets; each eviction or expiry emits a stable reason.
- Browser async work crosses the Wasm boundary in bounded batches.
- The edge is the robot trust boundary for identity, SROS2, ACLs, resource policy, and audit.
- WebTransport and WSS carry the same R2WP envelope and semantic events.
- N1 and N2 define the mainline acceptance surface.
- Each gateway process binds one first-stage support row and may host multiple domain IDs under that row; fleet aggregation across rows uses independent SDK sessions.
- Graph, schema, channel, policy, audit, and evidence records carry `gateway_instance_id`, `support_row_id`, and `domain_id` where applicable; `support_row_id` stays fixed for the running profile, while `gateway_instance_id` follows the deployment-provided instance lifecycle.
- Recording and live transport converge on the same schema identity, channel identity, and SDK subscription model.

## Mainline dependency chain

```text
Support profile + versioned fixtures
  -> R2WP + CDR contracts
  -> rclmbt host/runtime core
  -> rclwebd ROS and transport path
  -> graph + publish/subscribe vertical slice
  -> complete N2 semantics and type handling
  -> security + compatibility + operations
  -> browser SDK and release gate
  -> common Studio prototype
```

## Detail ownership

| Topic | Document |
|---|---|
| Product ordering and outcomes | [Product scope](./product-scope.md) |
| Protocol | [R2WP](./protocol/r2wp.md) |
| Browser runtime | [`rclmbt`](./runtime/rclmbt.md) |
| Edge gateway | [`rclwebd`](./gateway/rclwebd.md) |
| Trust and policy | [Security](./security.md) |
| Platform tiers | [Compatibility](./compatibility.md) |
| Exact first-stage pins and row status | [Support matrix](./support-matrix.md) |
| Process and support-row topology | [ADR 0008](./adr/0008-one-adapter-row-per-gateway-process.md) |
| Evidence and gates | [Validation](./validation.md) |
| UI side project | [Common Studio prototype](./prototypes/studio-ui.md) |

## Change rules

- A shared-contract edit includes updated fixtures and review from every consuming owner.
- A queue or buffer edit includes declared budgets and a memory trace.
- A hot-path edit includes latency, throughput, copy, queue, and allocation evidence.
- A security-sensitive edit includes effective permissions, audit identity, resource policy, and failure behavior.
- A new ROS distro, RMW, browser, transport topology, or recording format enters through the support matrix and compatibility strategy.
