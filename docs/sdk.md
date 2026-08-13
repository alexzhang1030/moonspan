# Browser SDK

`@rclweb/sdk` is the application contract for rclweb. If you can write
[rclcpp](https://docs.ros.org/en/humble/p/rclcpp/), you can write this
SDK: `init` → `Node` → `createPublisher` / `createSubscription` with ROS
message types. The SDK does not parse R2WP: the I/O Worker owns transport
bytes and the wasm core owns protocol, CDR, and ROS state
([architecture](./architecture.md), [ADR 0004](./adr/0004-browser-wasm-host-boundary.md)).

The package lives at [`sdk/typescript/`](../sdk/typescript/) and is consumed from this repository's Bun workspace. It stays `"private": true` and `"version": "0.0.0"` until a human release review. This slice does not publish to npm and does not pick [D-06](../tasks/plan.md#kickoff-decision-register) licensing.

## Install (workspace)

Root `package.json` already lists `sdk/*` as a workspace. Examples depend on `"@rclweb/sdk": "workspace:*"`. After `just setup`:

```ts
import { init, Node, std_msgs, sensor_msgs } from "@rclweb/sdk";
```

`just build` stages `sdk/typescript/wasm/rclweb.wasm` and emits `sdk/typescript/dist/` (gitignored). The workspace export map points at TypeScript source so Bun tests and scripts do not need `dist/`. Browser pages should load the built `dist/index.js` (see [subscribe-chatter](../examples/subscribe-chatter/README.md)).

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

`init` currently authenticates as scheme `token` / `anonymous`. The gateway default is Authenticate `off` ([R4-01](./milestones/r4-01-oidc-sros2-audit.md)). Optional `InitOptions` (`inline`, `wasmUrl`, `transport`, WebTransport hashes) are for tests and local-dev TLS — applications leave them unset.

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
```

TypeScript cannot write `create_publisher<std_msgs::msg::String>(topic, qos)`, so the message type is the first argument (`std_msgs.msg.String`, not an all-caps constant). `10` is KeepLast(10) + reliable, same as rclcpp. `new QoS(10).bestEffort()` and `KeepLast(10)` are the object form.

Message field names follow the ROS IDL (`data`, `point_step`, `is_bigendian`, `frame_id`). Callbacks receive an owned message; there is no lease to release. `createWallTimer(periodMs, callback)` matches `create_wall_timer`. Relative names (`"chatter"`) resolve under the node namespace like rclcpp.

Typed samples are `std_msgs/msg/String` and `sensor_msgs/msg/PointCloud2`. Other inbound types are dropped. PointCloud2 encode lives in the wasm core.

## Services

```ts
const client = node.createClient({ typeName: "example_interfaces/srv/AddTwoInts" }, "add_two_ints");
await client.waitForService();
const response = await client.sendRequest(requestCdr);

node.createService({ typeName: "example_interfaces/srv/AddTwoInts" }, "add_two_ints", (request) => {
  return responseCdr;
});
```

`createClient` / `createService` match rclcpp names. Request and response stay CDR bytes until generated TypeScript service types exist.

## Public vs internal

| Import | Stability | Contents |
|---|---|---|
| `@rclweb/sdk` | Candidate application contract | `init`, `Node`, ROS message types, QoS, local-dev TLS helpers |
| `@rclweb/sdk/internal` | Repository only | `connect` / session, `IoHost`, wasm poll ABI, buffer strategies, sample leases. Not a stability promise. |

Do not import the internal submodule from application code. A test asserts the public runtime export list; adding a host or ABI symbol to `@rclweb/sdk` is a contract change.

## Examples

| Path | Role |
|---|---|
| [`examples/subscribe-chatter`](../examples/subscribe-chatter/) | Browser page: `init` → `Node` subscribe and publish `/chatter` |
| [`examples/e2e-harness`](../examples/e2e-harness/) | Headless inline-host subscribe used by `just e2e` / `just e2e-h-ft` |

See [examples/README.md](../examples/README.md).

## Version and release

Independent SDK versioning is [ADR 0003](./adr/0003-monorepo-ownership.md). R2WP wire version is a separate identity ([ADR 0005](./adr/0005-r2wp-wire-versioning.md)). This package does not bump to `1.0.0`, set `"private": false`, or publish. Remaining R4-04 work: npm publish after D-06, typed samples beyond String and PointCloud2, and a human release review.

## Related

- [R4-04 milestone](./milestones/r4-04-sdk.md)
- [R1-04 wasm host](./milestones/r1-04-wasm-host-sdk.md)
- [R2WP](./protocol/r2wp.md)
- [`rclweb` core](./runtime/core.md)
