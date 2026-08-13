/**
 * @rclweb/sdk — TypeScript host around the `rclweb` wasm core.
 *
 * Public surface follows rclcpp: `init(url)` → `new Node(name)` →
 * `createPublisher` / `createSubscription` with ROS message types
 * (`std_msgs.msg.String`). Wasm, the I/O Worker, and sample leases stay
 * on `@rclweb/sdk/internal`.
 */

export { init, ok, shutdown, spin, type InitOptions } from "./context.ts";
export {
  Node,
  Publisher,
  Subscription,
  Client,
  Service,
  WallTimer,
  type SubscriptionCallback,
} from "./node.ts";
export { QoS, KeepLast, type QoSInput } from "./qos.ts";
export {
  builtin_interfaces,
  std_msgs,
  sensor_msgs,
  Time,
  Header,
  String,
  PointCloud2,
  PointField,
  type MessageType,
} from "./interfaces.ts";

export {
  fetchLocalDevTlsHashes,
  decodeCertificateHashValue,
  httpOriginFromWebTransportUrl,
} from "./local-dev-tls.ts";

export type { ServerCertificateHash } from "./types.ts";
