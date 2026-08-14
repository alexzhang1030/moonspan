# rclweb

Browser access to ROS 2. Install [`rcl-web`](https://www.npmjs.com/package/rcl-web),
point it at an [`rclwebd`](https://crates.io/crates/rclwebd) gateway, then use
`Node` the way you use rclcpp.

```ts
import { init, Node, std_msgs } from "rcl-web";

await init("ws://127.0.0.1:8794/ws");
const node = new Node("talker");

const pub = node.createPublisher(std_msgs.msg.String, "chatter", 10);
const msg = new std_msgs.msg.String();
msg.data = "hello";
pub.publish(msg);

node.createSubscription(std_msgs.msg.String, "chatter", 10, (incoming) => {
  console.log(incoming.data);
});
```

- [How to: node, topics, services, actions](./docs/typescript.md)
- [API reference](./docs/api.md)

## Install

```bash
npm install rcl-web
```

The page talks to ROS through a gateway on the robot (or on your laptop).
Run the prebuilt image — no clone, no toolchain (`:humble` for Humble):

```bash
docker run --rm --network host ghcr.io/alexzhang1030/rclwebd:jazzy
```

Or install a prebuilt binary into a sourced ROS 2 environment (Jazzy or
Humble; the support row is auto-detected from that environment):

```bash
curl -fsSL https://raw.githubusercontent.com/alexzhang1030/rclweb/main/scripts/install-rclwebd.sh | bash
rclwebd
```

Or build from source (needs Rust plus the ROS 2 development libraries):

```bash
cargo install rclwebd --features ros
rclwebd
```

Default WebSocket URL is `ws://127.0.0.1:8794/ws`. Rows, images, and
operations: [deploy](./docs/deploy.md).

## License

Apache-2.0. [LICENSE](./LICENSE), [NOTICE](./NOTICE).

Contributing and the `just` command surface: [CONTRIBUTING.md](./CONTRIBUTING.md).
