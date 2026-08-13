# R4-04: SDK stabilization, docs, and examples

Status: In progress. npm publish, a `1.0.0` version, and
[D-06](../../tasks/plan.md#kickoff-decision-register) licensing remain
follow-ups. This task does not publish the package.

The candidate application contract is [`docs/sdk.md`](../sdk.md). The
package stays `"private": true` and `"version": "0.0.0"`.

## Outcome (first slice — public surface)

| Area | Behavior |
|---|---|
| Public exports | `@rclweb/sdk` is `init`, `Node`, ROS message types, QoS, and local-dev TLS helpers. A test pins the runtime export list. |
| Internal | `@rclweb/sdk/internal` holds `connect`, session/leases, `IoHost`, the wasm poll ABI, buffer strategies, and `connectOfflineForTests`. Not a stability promise. |
| Worker URL | Source loads `io-worker.ts`; the browser bundle loads `io-worker.js`. A hardcoded `.ts` URL broke `dist/`. |
| Docs | [SDK](../sdk.md) is the application contract. Package README points here. |
| Demo | [`examples/subscribe-chatter`](../../examples/subscribe-chatter/) serves `dist/` on the Worker path and can publish `/chatter`. |

## Outcome (second slice — Worker operations)

The default I/O Worker path implements the same session methods as the
inline host: services, actions, graph, and parameter wrappers. Service
and action CDR is copied out of wasm in the Worker; the lease is released
there. Main never sees payload pointers.

| Area | Behavior |
|---|---|
| Messages | [`sdk/typescript/src/worker/messages.ts`](../../sdk/typescript/src/worker/messages.ts) carries open/call/goal/graph events as application values. |
| Worker | [`io-worker.ts`](../../sdk/typescript/src/worker/io-worker.ts) copies payloads and releases leases before `postMessage`. |
| Client | [`WorkerClient`](../../sdk/typescript/src/client.ts) no longer throws `requires inline host` for those methods. |
| Tests | [`sdk/typescript/test/worker-ops.test.ts`](../../sdk/typescript/test/worker-ops.test.ts) drives subscribe, graph, service echo, action echo, and PointCloud2 without `inline: true`. |

## Outcome (this slice — typed PointCloud2 samples)

Subscribe delivers `sensor_msgs/msg/PointCloud2` as metadata plus a `data` TypedArray. The inline host borrows wasm memory (copy-budget 0 wasm→application). The I/O Worker copies only the `data` field and releases the lease before `postMessage`, because wasm memory is not shared with main.

| Area | Behavior |
|---|---|
| Host types | Session `subscribe`/`publish` take `std_msgs.msg.String` / `sensor_msgs.msg.PointCloud2`. The wire PointCloud2 shape (camelCase meta + `data`) stays inside the host. |
| Inline | [`IoHost.decodePointCloud2`](../../sdk/typescript/src/host.ts) returns a view into wasm memory. Tests assert `data.buffer === engineMemory()`. |
| Worker | [`io-worker.ts`](../../sdk/typescript/src/worker/io-worker.ts) copies `data`, releases the lease, and transfers the ArrayBuffer. |
| Fixtures | [`scripts/fixture-gen`](../../scripts/fixture-gen/) emits `pointCloud2Sample` (four XYZ points). |

## Outcome (this slice — PointCloud2 publish)

The host `publish(..., sensor_msgs.msg.PointCloud2)` path sends a typed PointCloud2. The wasm core encodes CDR from the ROS header, PointField list, and `data` (no XYZ synthesis, no dropped `frame_id`). The I/O Worker carries the same `sendPointCloud2` command as the inline host. The public `Node.createPublisher(sensor_msgs.msg.PointCloud2, ...)` wraps that path.

| Area | Behavior |
|---|---|
| Command | Poll ABI `CMD_SEND_POINT_CLOUD2` (17): header, fields, and the `data` field, not full CDR. |
| Engine | [`encode_point_cloud2_from_sdk_meta`](../../rclweb/src/cdr/point_cloud2.rs) then the existing ROS_SAMPLE send path. |
| Client | [`Publisher.publish`](../../sdk/typescript/src/client.ts) accepts `StdMsgsString \| PointCloud2` from the channel type. |
| Tests | Engine outbound decode, inline `samplesSent`, Worker scripted peer captures `OPCODE_ROS_SAMPLE`. |

## Outcome (this slice — rclcpp-shaped Node)

The public package matches rclcpp usage: `init(url)` → `new Node(name)` →
`createPublisher` / `createSubscription` with `std_msgs.msg.String` and
`sensor_msgs.msg.PointCloud2`. Callbacks receive owned messages; applications
do not see sample leases or `connect`. Message types are `std_msgs.msg.String`
and `sensor_msgs.msg.PointCloud2`, not all-caps constants. `connect`
and the session/lease host live on `@rclweb/sdk/internal`.

| Area | Behavior |
|---|---|
| Context | [`init` / `ok` / `spin` / `shutdown`](../../sdk/typescript/src/context.ts). The extra argument versus `rclcpp::init` is the gateway URL. |
| Node | [`Node`](../../sdk/typescript/src/node.ts): `createPublisher`, `createSubscription`, `createClient`, `createService`, `createWallTimer`. `10` is KeepLast(10) + reliable. |
| Messages | [`std_msgs` / `sensor_msgs` / `rclweb_cdr_interfaces`](../../sdk/typescript/src/interfaces.ts) classes with ROS IDL field names. |
| Demo / e2e | subscribe-chatter and the e2e harness use `init` + `Node`. |
| Tests | [`node.test.ts`](../../sdk/typescript/test/node.test.ts) covers subscribe/publish without leases. Host 0-copy tests stay on `internal`. |

## Outcome (this slice — PointCloud2 header and fields)

Subscribe and publish round-trip `sensor_msgs/msg/PointCloud2` header stamp/`frame_id` and the PointField list. Republishing a received cloud keeps those fields; the host no longer synthesizes XYZ from `field_count == 3`.

| Area | Behavior |
|---|---|
| Command | `CMD_SEND_POINT_CLOUD2` carries stamp, `frame_id`, and each PointField before `data`. |
| Inbound meta | `rclweb_point_cloud2_meta` writes stamp/`frame_id`/fields after the numeric prefix. Point `data` stays an offset/len view. |
| Node | `wireToRos` / `rosToWire` copy header and fields. Applications set `cloud.header.frame_id` like rclcpp. |

## Outcome (this slice — typed corpus messages)

Subscribe and publish deliver Phase 1 message roots as ROS classes: `rclweb_cdr_interfaces.msg.PrimitiveScalars`, `Collections`, and `NestedSample`. The host and wasm share a packed little-endian layout (not CDR, not JSON). The engine converts host-value ↔ CDR with the generated codecs. `int64` / `uint64` are `bigint`. Service and action request types stay CDR.

| Area | Behavior |
|---|---|
| Command | Poll ABI `CMD_SEND_GENERATED` (18): channel id, ROS type name, opaque host-value bytes. `LAYOUT_VERSION` stays 1. |
| Wasm | `rclweb_decode_generated` writes host-value bytes (`-4` + needed-size retry, same as PointCloud2 meta). |
| Worker | Tracks `channelId → typeName`. Generated samples are copied as objects and the lease is released before `postMessage`. Unknown non-String types still drop-and-release. |
| Fixtures | [`scripts/fixture-gen`](../../scripts/fixture-gen/) emits `primitiveScalarsSample` and `nestedSample`. |

## Delivered scope

| Surface | Location |
|---|---|
| Public entry | [`sdk/typescript/src/index.ts`](../../sdk/typescript/src/index.ts) (`init` / `Node`) |
| Node API | [`node.ts`](../../sdk/typescript/src/node.ts), [`context.ts`](../../sdk/typescript/src/context.ts), [`interfaces.ts`](../../sdk/typescript/src/interfaces.ts) |
| Internal entry | [`sdk/typescript/src/internal.ts`](../../sdk/typescript/src/internal.ts) (`connect` / leases) |
| Worker URL | [`resolveIoWorkerUrl`](../../sdk/typescript/src/client.ts) |
| Worker ops | [`sdk/typescript/src/worker/`](../../sdk/typescript/src/worker/) |
| Application docs | [`docs/sdk.md`](../sdk.md) |
| Demo | [`examples/subscribe-chatter`](../../examples/subscribe-chatter/) |

## Acceptance evidence

```bash
just check && just test && just build
bun test sdk/typescript/test
```

## Still open in R4-04

- Generated TypeScript service/action request types (createClient still takes CDR)
- npm publish, `"private": false`, and a human-chosen version
- D-06 repository license on the package
