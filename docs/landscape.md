# Solution landscape

rclweb uses established ROS web and Wasm projects as compatibility targets and benchmark references.

## Comparative view

| Solution | Data path | Main strength | rclweb role |
|---|---|---|---|
| [rosbridge_suite](https://docs.ros.org/en/jazzy/p/rosbridge_suite/) | WebSocket with JSON and CBOR forms | Broad ecosystem support | Compatibility endpoint and benchmark |
| [Foxglove Bridge](https://github.com/foxglove/foxglove-sdk/blob/main/ros/src/foxglove_bridge/README.md) | WebSocket with CDR and schemas | Mature graph and visualization workflow | Compatibility endpoint and performance baseline |
| [Zenoh ROS 2/DDS bridge](https://github.com/eclipse-zenoh/zenoh-plugin-ros2dds) | Routed Zenoh topology | WAN and fleet routing | Later topology reference |
| [`rclnodejs/web`](https://www.npmjs.com/package/rclnodejs) | WSS, HTTP, and SSE | Typed server-side web API | SDK and policy reference |
| [ROS2WASM](https://arxiv.org/abs/2409.09941) | Browser Wasm runtime | Upstream ROS runtime precedent | Later experiment reference |
| rclweb | R2WP over WebTransport and binary WebSocket | Browser runtime and bounded typed package | Mainline product path |

## Design conclusions

- rosbridge supplies a legacy compatibility surface and serialized-byte comparison path.
- Foxglove supplies a mature CDR, schema, graph, Service, Parameter, and visualization baseline.
- ROS2WASM supplies a reference for upstream ROS package execution in browser Wasm.
- ROS `rcl` and `rmw` interfaces support a narrow serialized adapter with multiple middleware profiles.
- WebTransport supplies streams and datagrams in Worker contexts.

R2WP and the TypeScript package remain the primary application contract. Compatibility endpoints have independent capability, policy, and telemetry controls. The Humble and Jazzy rows live in the [support matrix](./support-matrix.md); later topology work enters through [compatibility qualification](./compatibility.md).

Copy counts, wire expansion, and the reproducing baseline versus Foxglove and rosbridge are in [performance](./performance.md). [Validation](./validation.md) owns comparative workloads, metrics, and evidence.
