# TypeScript package

`rcl-web` is the application contract. If you can write
[rclcpp](https://docs.ros.org/en/humble/p/rclcpp/), you can write this
package: `init` → `Node` → `createPublisher` / `createSubscription` with ROS
message types. It does not parse R2WP: the I/O Worker owns transport
bytes and the wasm core owns protocol, CDR, and ROS state
([architecture](./architecture.md), [ADR 0004](./adr/0004-browser-wasm-host-boundary.md),
[ADR 0014](./adr/0014-typescript-package-rcl-web.md)).

The package lives at [`typescript/`](../typescript/). The current version is `0.0.2`. `0.0.1` is on npm as TypeScript source. The package is public (`"private": false`). It is Apache-2.0 ([licensing](./licensing.md)). npm rejected unscoped `rclweb` as too similar to `rrweb`; the publish and import name is `rcl-web`.

## Install

From npm, after the package is on the registry:

```bash
npm install rcl-web
# or
bun add rcl-web
```

From this repository's Bun workspace, examples depend on `"rcl-web": "workspace:*"`. After `just setup` and `just build`:

```ts
import { init, Node, std_msgs, sensor_msgs, rclweb_cdr_interfaces } from "rcl-web";
```

`just build` stages `typescript/wasm/rclweb.wasm` and runs tsdown into `typescript/dist/` (gitignored). The npm export map points at that bundle (`dist/index.js` + `.d.ts`). Bun tests import repository source directly. Browser pages load the built `dist/index.js` (see [subscribe-chatter](../examples/subscribe-chatter/README.md)).

## init and Node

The one extra argument versus `rclcpp::init(argc, argv)` is the gateway URL.

```ts
await init("ws://127.0.0.1:8794/ws");
const node = new Node("minimal_publisher");
```

| Call | rclcpp analog |
|---|---|
| `init(url)` | `rclcpp::init` — connect a context to the gateway |
| `new Node(name, namespace?)` | `rclcpp::Node` |
| `ok()` / `shutdown()` / `spin(node)` | `rclcpp::ok` / `shutdown` / `spin` |

`spin` waits until `shutdown()`. The browser event loop already delivers callbacks; you do not need to spin for messages to arrive.

`init` currently authenticates as scheme `token` / `anonymous`. The gateway default is Authenticate `off` ([security](./security.md)). Optional `InitOptions` (`inline`, `wasmUrl`, `transport`, WebTransport hashes) are for tests and local-dev TLS — applications leave them unset.

`InitOptions.reconnect` (default off) is a fresh session: ClientHello → Authenticate → SessionReady, then the package re-opens topics, services, and actions with the same channel IDs so existing `Node` objects keep working. In-flight service calls and action results reject with `"session reconnected"`. SessionResume stays parked. This applies on both the default I/O Worker path and `inline: true`.

## Publisher and subscription

```ts
const publisher = node.createPublisher(std_msgs.msg.String, "chatter", 10);
const message = new std_msgs.msg.String();
message.data = "hello from the browser";
publisher.publish(message);

node.createSubscription(std_msgs.msg.String, "chatter", 10, (msg) => {
  console.log(msg.data);
});

const cloudPub = node.createPublisher(sensor_msgs.msg.PointCloud2, "points", 10);
const cloud = new sensor_msgs.msg.PointCloud2();
cloud.header.frame_id = "map";
cloud.height = 1;
cloud.width = 4;
cloud.point_step = 12;
cloud.row_step = 48;
cloud.is_dense = true;
cloud.fields = [
  Object.assign(new sensor_msgs.msg.PointField(), { name: "x", offset: 0, datatype: sensor_msgs.msg.PointField.FLOAT32, count: 1 }),
  Object.assign(new sensor_msgs.msg.PointField(), { name: "y", offset: 4, datatype: sensor_msgs.msg.PointField.FLOAT32, count: 1 }),
  Object.assign(new sensor_msgs.msg.PointField(), { name: "z", offset: 8, datatype: sensor_msgs.msg.PointField.FLOAT32, count: 1 }),
];
cloud.data = new Uint8Array(48);
cloudPub.publish(cloud);

node.createSubscription(sensor_msgs.msg.PointCloud2, "points", 10, (msg) => {
  console.log(msg.width, msg.point_step, msg.data.byteLength);
});

const scalarsPub = node.createPublisher(rclweb_cdr_interfaces.msg.PrimitiveScalars, "scalars", 10);
const scalars = new rclweb_cdr_interfaces.msg.PrimitiveScalars();
scalars.string_value = "hello-scalars";
scalars.int64_value = -70000n;
scalarsPub.publish(scalars);

node.createSubscription(rclweb_cdr_interfaces.msg.PrimitiveScalars, "scalars", 10, (msg) => {
  console.log(msg.string_value, msg.int64_value);
});
```

TypeScript cannot write `create_publisher<std_msgs::msg::String>(topic, qos)`, so the message type is the first argument (`std_msgs.msg.String`, not an all-caps constant). `10` is KeepLast(10) + reliable, same as rclcpp. `new QoS(10).bestEffort()` and `KeepLast(10)` are the object form.

Message field names follow the ROS IDL (`data`, `point_step`, `is_bigendian`, `frame_id`). Callbacks receive an owned message; there is no lease to release. `createWallTimer(periodMs, callback)` matches `create_wall_timer`. Relative names (`"chatter"`) resolve under the node namespace like rclcpp.

Typed samples are `std_msgs/msg/String`, `sensor_msgs/msg/PointCloud2`, and the generated message roots `rclweb_cdr_interfaces/msg/PrimitiveScalars`, `Collections`, and `NestedSample`. Other inbound topic types are dropped. PointCloud2 encode lives in the wasm core and round-trips header stamp/`frame_id` and the PointField list. Generated messages use a packed host layout; wasm converts to and from CDR. `int64` / `uint64` are `bigint`. Generated service and action roots use the same host layout on `createClient` / `createActionClient`.

## Services

```ts
const echo = node.createClient(rclweb_cdr_interfaces.srv.EchoNested, "echo");
await echo.waitForService();
const req = new rclweb_cdr_interfaces.srv.EchoNested.Request();
req.input.scalars.string_value = "ping";
const res = await echo.sendRequest(req);
console.log(res.accepted, res.output.scalars.string_value);

node.createService(rclweb_cdr_interfaces.srv.EchoNested, "echo", (request) => {
  const response = new rclweb_cdr_interfaces.srv.EchoNested.Response();
  response.output = request.input;
  response.accepted = true;
  return response;
});

const add = node.createClient({ typeName: "example_interfaces/srv/AddTwoInts" }, "add_two_ints");
await add.waitForService();
const responseCdr = await add.sendRequest(requestCdr);
```

`createClient` / `createService` match rclcpp names. Generated roots (`rclweb_cdr_interfaces.srv.EchoNested`) use ROS classes. Other service types stay CDR `Uint8Array`.

## Actions

```ts
const seq = node.createActionClient(rclweb_cdr_interfaces.action.MeasureSequence, "seq");
await seq.waitForAction();
const goal = new rclweb_cdr_interfaces.action.MeasureSequence.Goal();
seq.onFeedback((fb) => {
  console.log(fb.progress);
});
const { result } = seq.sendGoal(goal);
const done = await result;
console.log(done.result.stamp.sec);
```

`createActionClient` / `createActionServer` match rclcpp names. Generated roots (`rclweb_cdr_interfaces.action.MeasureSequence`) use ROS classes (`Goal` / `Result` / `Feedback`). Other action types stay CDR `Uint8Array`. `ACTION_STATUS` stays CDR.

## Graph

```ts
const node = new Node("listener");
node.onGraphChange(() => {
  console.log(node.getNodeNames());
  console.log(node.getTopicNamesAndTypes());
});
console.log(node.countPublishers("chatter"));
```

`getNodeNames`, `getTopicNamesAndTypes`, `getServiceNamesAndTypes`, `getActionNamesAndTypes`, `countPublishers`, and `countSubscribers` match rclcpp (and rclcpp_action for actions). Relative topic names resolve under the node namespace. `onGraphChange` is the event-loop analog of `wait_for_graph_change`: call the getters from the callback. GraphSnapshot, GraphDelta, generation, and endpoint kind numbers stay off this surface.

## Public vs internal

| Import | Stability | Contents |
|---|---|---|
| `rcl-web` | Candidate application contract | `init`, `Node`, ROS message types, QoS, local-dev TLS helpers |
| `rcl-web/internal` | Repository only | `connect` / session, `IoHost`, wasm poll ABI, buffer strategies, sample leases. Not a stability promise. |

Do not import the internal submodule from application code. A test asserts the public runtime export list; adding a host or ABI symbol to `rcl-web` is a contract change.

## Examples

| Path | Role |
|---|---|
| [`examples/subscribe-chatter`](../examples/subscribe-chatter/) | Browser page: `init` → `Node` subscribe and publish `/chatter` |
| [`examples/e2e-harness`](../examples/e2e-harness/) | Headless inline-host subscribe used by `just e2e` / `just e2e-h-ft` |

See [examples/README.md](../examples/README.md).

## Version and release

Independent package versioning is [ADR 0003](./adr/0003-monorepo-ownership.md). R2WP wire version is a separate identity ([ADR 0005](./adr/0005-r2wp-wire-versioning.md)). The current version is `0.0.2`. `0.0.1` on the registry shipped TypeScript source. The package is public. The npm name is `rcl-web` ([ADR 0014](./adr/0014-typescript-package-rcl-web.md)). The tarball is the tsdown bundle, not TypeScript source ([ADR 0015](./adr/0015-tsdown-ship-bundle.md)).

An npm tarball must include the tsdown `dist/` bundle, `wasm/rclweb.wasm`, and the repository `LICENSE` and `NOTICE`. It must not include `src/`. `just npm-pack` / `prepack` copies the license files and runs tsdown. `just npm-pack-check` is part of `just check`.

Publish (human, from a clean tree after `just build`):

```bash
just build
just npm-pack-check
cd typescript
npm publish
```

This repository does not run `npm publish` in CI. Rust crates stay `publish = false` (not crates.io). Unscoped `rclweb` stays blocked vs `rrweb`; do not retry that name.

## Related

- [R2WP](./protocol/r2wp.md)
- [`rclweb` core](./runtime/core.md)
- [Security](./security.md)
