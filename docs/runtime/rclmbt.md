# `rclmbt` browser runtime

`rclmbt` is Moonspan's MoonBit-to-Wasm implementation of browser-native ROS 2 runtime semantics. It owns deterministic state, CDR processing, type identity, graph state, QoS compatibility, executor dispatch, and typed operations exposed through the browser SDK.

**Status:** design baseline. M1 establishes the host boundary and publish/subscribe core; M2 completes the N2 semantic surface.

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
- generated and dynamic type handling keyed by RIHS hash.

## Planned package structure

```text
rclmbt/
  rclmbt_core/           Context, Node, Executor, WaitSet, Clock, Logger
  rmw_web_mbt/           discovery, pub/sub, request/reply, QoS, liveliness
  cdr_mbt/               CDR1/XCDR2 codec, alignment, endian, bounded sequences
  rosidl_mbt_runtime/     primitives, arrays, strings, nested types, type hash
  rosidl_generator_mbt/   .msg/.srv/.action and type description -> MoonBit
  type_registry_mbt/      RIHS hash, dynamic schema, lazy field projection
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

1. `rclwebd` discovers a ROS type name and type hash from the graph.
2. The gateway obtains the recursive type description through [`GetTypeDescription`](https://docs.ros.org/en/lyrical/p/type_description_interfaces/srv/GetTypeDescription.html) or a pinned compatibility source.
3. R2WP advertises the type name, RIHS hash, encoding, and schema generation.
4. The browser registry keys cached descriptions and codecs by RIHS hash.
5. `rclmbt` selects a generated codec or compiles a dynamic field plan.
6. Samples carry CDR bytes plus channel identity; the channel supplies the schema association.

ROS 2's [type description generator](https://docs.ros.org/en/ros2_packages/jazzy/api/rosidl_generator_type_description/) supplies recursive descriptions and RIHS identity for the generated corpus.

### Generated path

`rosidl_generator_mbt` converts `.msg`, `.srv`, `.action`, and type descriptions into MoonBit types and specialized codecs. This path serves pinned common interfaces and application-owned schemas, with compile-time field shape and fast CDR access.

### Dynamic path

Custom types load a recursive description at runtime. The registry validates the RIHS hash, builds an alignment-aware field plan, and projects only requested fields. Repeated samples reuse the cached plan.

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
- both browser buffer paths, Worker restart, batch limits, and memory stability.

[Validation](../validation.md) defines evidence artifacts and release gates.

## N3 package experiment

The N3 track packages selected upstream `rcl` or `rclcpp` code through Emscripten in a post-release sandbox. It shares R2WP, schema caches, and browser host infrastructure with N2. Its report records supported APIs, package patches, custom-message behavior, Wasm size, startup, steady memory, and runtime constraints.
