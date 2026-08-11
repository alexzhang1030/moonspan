# `rclmbt` browser runtime

`rclmbt` is Moonspan's MoonBit/Wasm runtime for deterministic browser-side ROS 2 behavior. The R2WP v0 parser is complete. M1 builds the CDR core, host boundary, and publish/subscribe path; M2 completes the planned N2 semantics. The CDR behavioral contract lives in [CDR core](./cdr.md).

## Responsibilities

- CDR encoding, decoding, validation, and field projection
- Context, Node, Executor, WaitSet, timer, and clock state
- Graph generations, endpoint state, and liveliness
- QoS compatibility, durability, deadlines, and lifespan
- Typed publish/subscribe, Service, Action, and Parameter behavior
- Generated and dynamic types keyed by schema identity
- Structured runtime errors and telemetry events

## Module plan

| Module | Role |
|---|---|
| `rclmbt_core` | Runtime state, executor, clocks, and logging |
| `rmw_web_mbt` | Graph, data, operations, QoS, and liveliness |
| `cdr_mbt` | CDR codecs, alignment, endian handling, and bounded views |
| `rosidl_mbt_runtime` | ROS primitive and container types |
| `rosidl_generator_mbt` | Generated MoonBit and TypeScript bindings |
| `type_registry_mbt` | Schema cache and dynamic field plans |
| `web_host` | Worker FFI, batches, buffers, clocks, and metrics |

## API direction

```moonbit
let ctx = @rcl.Context::connect(session)
let node = ctx.create_node("browser_client", namespace="/web")

node.subscribe[@sensor_msgs.PointCloud2](
  "/lidar/points",
  qos=@qos.sensor_data(depth=2),
  fn(msg) { @app.consume_points(msg.data_view()) },
)

@rcl.spin(node)
```

The TypeScript SDK exposes equivalent typed operations and manages Worker lifecycle, asynchronous completion, and buffer ownership.

## Wasm host boundary

`rclmbt` runs as a synchronous state machine inside a TypeScript Worker host.

| MoonBit/Wasm owns | TypeScript host owns |
|---|---|
| CDR, schemas, ROS state, deadlines, executor work, and structured events | Browser network APIs, Worker scheduling, timers, buffers, SDK Promises, and application delivery |

Each host turn passes a bounded event batch into `poll`. The result contains outbound work, completed operations, application events, released buffers, and the next deadline. Batch size, retained memory, and execution time are observable budgets.

## Types and schemas

The runtime receives normalized schema records from the gateway and remains independent of the ROS distribution.

- Jazzy uses `rep2011-rihs` identity and native type descriptions.
- Humble uses complete recursive bundles identified by `moonspan-schema-v1`.
- Generated codecs serve pinned interfaces and application-owned schemas.
- Dynamic plans validate recursive descriptions and project requested fields.
- Cache identity includes scheme, value, type name, encoding, and schema generation.
- Missing required schema material yields `schema_unavailable` before channel activation.

## CDR and buffers

`cdr_mbt` implements the [CDR core contract](./cdr.md). M1 targets PLAIN_CDR/CDR1 for the authoritative ROS corpus in little and big endian. XCDR2 stream foundations remain a follow-on surface for later schema work. The module returns typed errors for truncation, alignment, bounds, overflow, allocation, encoding, and lease faults.

Every buffer has one owner at each boundary. Large fields use bounded views and parent-buffer leases. Applications retain data through an explicit copy or lease extension. Shared rings and transferable buffers implement the same event lifecycle and expose their costs through telemetry.

## State and recovery

- Graph and channel generations isolate stale events.
- Request and goal identities correlate operation lifecycle.
- Every deadline and timestamp carries clock identity.
- Terminal session transitions complete pending work with structured errors.
- Worker faults release owned buffers and support a clean SDK restart.
- Gateway, support-row, and domain provenance stays attached to SDK events.

## Validation

The runtime is qualified against ROS-generated CDR fixtures, protocol fixtures, graph and QoS scenarios, typed operations, clock behavior, schema identity, multi-domain provenance, reconnect behavior, both buffer paths, Worker restart, batch limits, and memory stability.

```bash
moon test --frozen --target wasm rclmbt/protocol
bun run protocol-agree
```

[Validation](../validation.md) owns phase evidence and release gates. The N3 upstream package sandbox begins after the mainline release.
