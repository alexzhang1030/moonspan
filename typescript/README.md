# `rclweb`

TypeScript package for rclweb. If you can write rclcpp, you can write
this package: `init` → `Node` → `createPublisher` / `createSubscription`.

The first published version is `0.0.1`. The package is public. An npm tarball must include the repository [LICENSE](../LICENSE) and [NOTICE](../NOTICE) (copied into this directory at pack time; do not commit those copies). Consume it from npm as `rclweb`, or from this repository's Bun workspace (`"rclweb": "workspace:*"`). Licensed under Apache License 2.0; see [licensing](../docs/licensing.md).

Application contract: [`rclweb`](../docs/typescript.md).

```ts
import { init, Node, std_msgs } from "rclweb";

await init("ws://127.0.0.1:8794/ws");
const node = new Node("minimal_subscriber");
node.createSubscription(std_msgs.msg.String, "chatter", 10, (msg) => {
  console.log(msg.data);
});
```

Host, wasm poll ABI, session `connect`, and sample leases: `rclweb/internal` (not a stability promise).
