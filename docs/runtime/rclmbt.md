# `rclmbt` browser runtime

`rclmbt` is Moonspan's MoonBit-to-Wasm implementation of browser-native ROS 2 runtime semantics. It owns deterministic state, CDR processing, type identity, graph state, QoS compatibility, executor dispatch, and typed operations exposed through the browser SDK.

**Status:** design baseline. M0-03g lands the R2WP wire version 0 reference parser under [`rclmbt/protocol/`](../../rclmbt/protocol/) (review Accept). M0-03h3 adds the agreement outcome emitter as the executable package [`rclmbt/cmd/agree/`](../../rclmbt/cmd/agree/) (commit `9fa91a4f9f956670368b0d36783991312f0e6900`); after h4 review Accept the package participates in the three-language agreement gate. M1 establishes the host boundary and publish/subscribe core; M2 completes the N2 semantic surface.

Schema identity follows [ADR 0007](../adr/0007-humble-jazzy-schema-identity.md). Gateway process and support-row topology follows [ADR 0008](../adr/0008-one-adapter-row-per-gateway-process.md). First-stage environment pins live in the [support matrix](../support-matrix.md).

## R2WP reference parser (M0-03g)

The MoonBit package [`rclmbt/protocol/`](../../rclmbt/protocol/) implements the wire version 0 receiver for bootstrap steps 1–9 and selected-frame steps 1–16. It shares the committed fixture corpora under [protocol/testdata/](../../protocol/testdata/README.md) through a white-box fixture bridge (`fixture_data_wbtest.mbt`).

Coverage (review Accept; commits `2f7352f`, `1157138`, `0c5e4d2`, `133fd9f`):

- deterministic CBOR; extension TLVs; all 15 CONTROL kinds with nested CDDL shapes;
- all 20 valid entries: 3 bootstrap binaries, 16 frame binaries, and the fully materialized 64 MiB segment recipe;
- all 55 malformed binaries (14 bootstrap / 41 frame) with exact code, name, reason, absolute offset, plane, and step;
- four exact Phase 1 SessionReady rows H-FT, H-CY, J-FT, and J-CY; u32 / u64 / i64 header bounds;
- borrowed extension and application `BytesView` backing shared with the input storage.

Focused verification: `moon test --frozen --target wasm rclmbt/protocol` (69 of 69). After M0-03h review Accept the executable package [`rclmbt/cmd/agree/`](../../rclmbt/cmd/agree/) emits agreement outcomes for `bun run protocol-agree` via `moon run --frozen --release --target wasm rclmbt/cmd/agree`; full Bun suite 675 of 675 (5228 assertions); pinned `just check` status=ok under Bun 1.3.14 / Rust 1.97.1 / moonc 0.10.6+80dc50f24 / just 1.50.0. Agreement layout and digests: [protocol/testdata/agreement/README.md](../../protocol/testdata/agreement/README.md). Hosted CI run evidence remains pending.

## Runtime scope

The mainline runtime implements:

- Context and session attachment;
- Node identity, namespaces, remapping inputs, and logging context;
- Executor, WaitSet, timers, deadlines, and batched dispatch;
- graph snapshots, ordered deltas, endpoint state, and liveliness;
- typed publish and subscribe;
- QoS profiles, compatibility, durability state, and deadline state;
- Service clients and servers;
- Action clients and servers, goal state, feedback, result, and cancellation;
- Parameter list, get, set, describe, events, and atomic update semantics;
- ROS, system, steady, and simulation clocks;
- generated and dynamic type handling keyed by schema identity `(scheme, value)` with type name, encoding, and schema generation.

## Planned package structure

```text
rclmbt/
  rclmbt_core/           Context, Node, Executor, WaitSet, Clock, Logger
  rmw_web_mbt/           discovery, pub/sub, request/reply, QoS, liveliness
  cdr_mbt/               CDR1/XCDR2 codec, alignment, endian, bounded sequences
  rosidl_mbt_runtime/     primitives, arrays, strings, nested types, schema identity
  rosidl_generator_mbt/   .msg/.srv/.action and type description -> MoonBit
  type_registry_mbt/      (scheme, value) cache, dynamic schema, lazy field projection
  web_host/               JS FFI, Worker scheduling, buffers, clocks, metrics
  conformance/            CDR, graph, QoS, service, action, parameter tests
```

## Intended API shape

```moonbit
let ctx = @rcl.Context::connect(session)
let node = ctx.create_node("browser_client", namespace="/web")

node.subscribe[@sensor_msgs.PointCloud2](
  "/lidar/points",
  qos=@qos.sensor_data(depth=2),
  fn(msg) { @app.consume_points(msg.data_view()) },
)

let goal = node.action_client[@nav2_msgs.NavigateToPose]("/navigate_to_pose")
goal.send(target_pose, on_feedback=fn(feedback) { @app.update(feedback) })

@rcl.spin(node)
```

The public TypeScript SDK presents equivalent typed operations and manages Worker lifecycle, buffers, and asynchronous completion.

## MoonBit/Wasm host boundary

[MoonBit FFI](https://docs.moonbitlang.com/en/latest/language/ffi.html) connects the runtime to the browser host. The design uses a synchronous Wasm state machine with an asynchronous JavaScript host, providing a stable boundary while MoonBit's [Wasm async runtime](https://docs.moonbitlang.com/en/latest/language/async-experimental.html) evolves.

MoonBit/Wasm owns:

- CDR encode, decode, validation, and field projection;
- graph, QoS, request, goal, parameter, clock, and executor state;
- deterministic deadlines and next-work calculation;
- type registry and generated codec dispatch;
- structured runtime errors and telemetry events.

The JavaScript host owns:

- WebTransport and WebSocket Promises;
- Dedicated Worker event loops and timers;
- `SharedArrayBuffer` and transferable `ArrayBuffer` lifecycle;
- browser monotonic clock capture;
- SDK Promise resolution and application event delivery.

Each host turn passes a bounded ready-event batch into `rclmbt.poll(batch)`. The result contains outbound frames, completed operations, application events, released buffers, and the next deadline. Batch size and execution time are measured and capped.

## Type and schema flow

The browser runtime is distro-independent. It consumes normalized schema records and session, graph, schema, and channel events from R2WP and the gateway. Those events carry `gateway_instance_id`, `support_row_id`, and `domain_id` provenance; the runtime preserves that provenance through SDK events and telemetry. Applications compose multiple independent contexts and sessions for cross-row fleet views. Adapters produce schema records through two first-stage paths:

### Jazzy path

1. The Jazzy adapter discovers a ROS type name and acts as a client of a node's native `~/get_type_description` endpoint using the [`GetTypeDescription`](https://docs.ros.org/en/jazzy/p/type_description_interfaces/srv/GetTypeDescription.html) service.
2. Schema identity uses scheme `rep2011-rihs` with the REP-2011 RIHS value.
3. Optional provenance may also record a `moonspan-schema-v1` bundle digest for cross-version lookup.

### Humble path

1. The Humble adapter uses [`GenericPublisher`](https://docs.ros.org/en/humble/p/rclcpp/generated/classrclcpp_1_1GenericPublisher.html), [`GenericSubscription`](https://docs.ros.org/en/humble/p/rclcpp/generated/classrclcpp_1_1GenericSubscription.html), and [`get_typesupport_library`](https://docs.ros.org/en/ros2_packages/humble/api/rclcpp/generated/function_namespacerclcpp_1a629c76e9f974bbaed3b82b030f7f1b01.html) for generic serialized operations.
2. Custom types ship a complete recursive deployment bundle and manifest.
3. Schema identity uses scheme `moonspan-schema-v1` with the SHA-256 of deterministic canonical bundle bytes.
4. When the required bundle is missing, channel open surfaces stable `schema_unavailable` before channel activation.

### Shared browser steps

1. R2WP advertises type name, schema identity `(scheme, value)`, encoding, and schema generation.
2. The browser registry keys cached descriptions and codecs by the cache key `(scheme, value, type name, encoding, schema generation)`. Schema identity remains exactly `(scheme, value)`.
3. `rclmbt` selects a generated codec or compiles a dynamic field plan.
4. Samples carry CDR bytes plus channel identity; the channel supplies the schema association.

ROS 2's [type description generator](https://docs.ros.org/en/ros2_packages/jazzy/api/rosidl_generator_type_description/) supplies recursive descriptions for the generated corpus on platforms that expose native type description.

### Generated path

`rosidl_generator_mbt` converts `.msg`, `.srv`, `.action`, and type descriptions into MoonBit types and specialized codecs. Generated codecs register and validate the schema identity scheme and value at load time. This path serves pinned common interfaces and application-owned schemas, with compile-time field shape and fast CDR access.

### Dynamic path

Custom types load a recursive description at runtime. The registry validates the schema identity `(scheme, value)`, builds an alignment-aware field plan, and projects only requested fields. Dynamic field plans cache by the cache key `(scheme, value, type name, encoding, schema generation)`. Repeated samples reuse the cached plan.

## CDR requirements

`cdr_mbt` covers CDR1 and the declared XCDR2 subset, including:

- primitive values and endian handling;
- fixed and variable arrays;
- bounded and unbounded sequences;
- strings and wide strings;
- nested types and alignment;
- service request/response and action component types;
- direct bounded views for large byte and numeric fields;
- typed failures for truncation, overflow, alignment, bounds, and schema mismatch.

Authoritative bytes come from the pinned ROS-generated corpus. Mainline acceptance requires complete agreement with every declared fixture.

## Memory and buffer ownership

- Every inbound event has one explicit owner at each boundary.
- Buffer pools publish byte, item, and age budgets.
- Large-field views retain a bounded parent buffer lease and release it through the host result.
- Application retention uses an explicit copy or lease extension API with observable cost.
- `SharedArrayBuffer` rings and transferable buffers implement the same event lifecycle.
- Queue saturation and lease pressure emit stable reasons and metrics.

## Runtime state and failure behavior

- Graph generations order snapshots and deltas across reconnects.
- Channel generations isolate reopened channels from stale samples.
- Request and goal identities correlate replies, feedback, results, cancellation, and timeout.
- Clock identity accompanies every deadline and timestamp conversion.
- Terminal session transitions complete pending operations with structured errors.
- Missing required Humble bundle produces `schema_unavailable` before channel activation.
- Panic boundaries convert runtime failures into a Worker fault event, release owned buffers, and support a clean SDK restart.

## Conformance surface

The runtime suite covers:

- CDR golden vectors across declared interfaces and edge cases;
- graph creation, removal, updates, liveliness, and reconnect generations;
- publish/subscribe across supported QoS combinations and RMWs;
- Service deadlines, cancellation, concurrency, and server behavior;
- Action goal acceptance, rejection state, feedback, result, cancellation, and restart handling;
- Parameter descriptors, atomic updates, events, permissions, and type errors;
- ROS time, simulation time, steady deadlines, clock jumps, and skew mapping;
- schema identity for `rep2011-rihs` and `moonspan-schema-v1`;
- Jazzy provenance mapping between `rep2011-rihs` and `moonspan-schema-v1`;
- missing required Humble bundle (`schema_unavailable`);
- same-row multi-domain provenance for `gateway_instance_id`, `support_row_id`, and `domain_id`;
- stable-ID resume and replacement-ID clean-session transitions with gateway instance and support-row identity;
- both browser buffer paths, Worker restart, batch limits, and memory stability.

[Validation](../validation.md) defines evidence artifacts and release gates.

## N3 package experiment

The N3 track packages selected upstream `rcl` or `rclcpp` code through Emscripten in a post-release sandbox. It shares R2WP, schema caches, and browser host infrastructure with N2. Its report records supported APIs, package patches, custom-message behavior, Wasm size, startup, steady memory, and runtime constraints.
