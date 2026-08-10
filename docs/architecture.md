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
  rclwebd
    transport session + bounded channel scheduler
    graph/schema cache + policy + audit + metrics
    narrow rcl/rmw serialized C ABI adapter
          |
          v
ROS 2 domain
  selected DDS or Zenoh mapping
```

After the mainline release, the common Studio prototype adds React workspace state plus render and codec workers through the public TypeScript SDK.

## Ownership boundaries

| Unit | Owns | Stable boundary |
|---|---|---|
| Browser SDK | Session lifecycle, typed APIs, Worker host, telemetry, buffer ownership | Public TypeScript API and versioned events |
| `io.worker` | WebTransport/WSS I/O, R2WP framing, reconnection, inbound and outbound buffers | R2WP frames and bounded event batches |
| `rclmbt` | Context, Node, Executor, Graph, QoS, Clock, Service, Action, Parameter, CDR, type registry | Host `poll` ABI, typed SDK events, R2WP channels |
| `rclwebd` | Sessions, channel scheduler, schema cache, identity, policy, audit, metrics, compatibility routing | R2WP toward browsers; narrow C ABI toward ROS |
| ROS C adapter | Generic serialized operations and distro-specific integration | Versioned adapter ABI over `rcl` and `rmw` |
| ROS domain | Discovery, native endpoints, middleware delivery, ROS clocks and liveliness | Selected DDS or Zenoh mapping |
| Conformance system | Fixtures, workload definitions, environment manifests, reports, release evidence | Machine-readable results and stable report schemas |
| Common Studio prototype | Workspace, panels, rendering, media, accessibility, operator interaction | Released browser SDK and policy capability schema |

## Inbound topic path

1. The ROS adapter receives a serialized sample with graph, type, QoS, and time identity.
2. `rclwebd` applies session policy, queue budgets, and channel scheduling.
3. WebTransport or binary WSS carries the shared R2WP envelope.
4. `io.worker` validates the frame and transfers a bounded batch to `rclmbt.worker`.
5. `rclmbt` resolves the RIHS-keyed schema and decodes generated types or dynamically projects requested fields.
6. The SDK emits a typed sample plus correlated source, network, queue, decode, and delivery telemetry.

## Outbound command path

1. The application creates a typed publish, service, action, or parameter operation through the SDK.
2. `rclmbt` validates the type, deadline, clock, and local state transition.
3. `io.worker` frames the operation and attaches session and trace identity.
4. `rclwebd` evaluates operation ACLs, concurrency, rate, size, bandwidth, and deadline budgets.
5. The C adapter executes the serialized ROS operation and returns status through the correlated channel.
6. Audit records retain identity, target, decision, timing, result, and trace linkage.

## Buffer and execution model

- MoonBit/Wasm owns synchronous state machines, CDR work, graph state, QoS state, and executor dispatch.
- JavaScript owns browser Promises, Worker scheduling, timers, WebTransport, WebSocket, and buffer transfer.
- One host call delivers a bounded ready-event batch to `rclmbt.poll(batch)`; the result carries outbound work and the next deadline.
- Cross-origin-isolated deployments use a bounded `SharedArrayBuffer` ring fast path.
- General deployments use transferable `ArrayBuffer` ownership.
- Both paths share the same behavioral contract and carry separate performance evidence.

## Architecture invariants

- CDR stays on the sample hot path from ROS serialization through browser ingress.
- R2WP framing, control messages, schema identity, QoS negotiation, errors, and queue reasons are versioned shared contracts.
- Every queue declares sample and byte budgets; each eviction or expiry emits a stable reason.
- Browser async work crosses the Wasm boundary in bounded batches.
- The edge is the robot trust boundary for identity, SROS2, ACLs, resource policy, and audit.
- WebTransport and WSS carry the same R2WP envelope and semantic events.
- N1 and N2 define the mainline acceptance surface.
- Each ROS domain selects one DDS or Zenoh mapping; gateway sessions provide fleet aggregation.
- Recording and live transport converge on the same schema, channel identity, and SDK subscription model.

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
| Evidence and gates | [Validation](./validation.md) |
| UI side project | [Common Studio prototype](./prototypes/studio-ui.md) |

## Change rules

- A shared-contract edit includes updated fixtures and review from every consuming owner.
- A queue or buffer edit includes declared budgets and a memory trace.
- A hot-path edit includes latency, throughput, copy, queue, and allocation evidence.
- A security-sensitive edit includes effective permissions, audit identity, resource policy, and failure behavior.
- A new ROS distro, RMW, browser, transport topology, or recording format enters through the compatibility matrix.
