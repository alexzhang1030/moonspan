# `rclweb`

TypeScript package for rclweb. If you can write rclcpp, you can write
this package: `init` → `Node` → `createPublisher` / `createSubscription`.

This package stays `"private": true` and `"version": "0.0.0"` until a human release review. Consume it from this repository's Bun workspace (`"rclweb": "workspace:*"`). Do not publish it to npm in this slice. Licensed under Apache License 2.0; see the repository [LICENSE](../LICENSE) and [licensing](../docs/licensing.md).

Application contract: [`rclweb`](../docs/typescript.md). Milestone: [R4-04](../docs/milestones/r4-04-sdk.md).

```ts
import { init, Node, std_msgs } from "rclweb";

await init("ws://127.0.0.1:8794/ws");
const node = new Node("minimal_subscriber");
node.createSubscription(std_msgs.msg.String, "chatter", 10, (msg) => {
  console.log(msg.data);
});
```

Host, wasm poll ABI, session `connect`, and sample leases: `rclweb/internal` (not a stability promise).
