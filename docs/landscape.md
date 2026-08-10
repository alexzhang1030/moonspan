# Solution landscape

Moonspan uses existing ROS web and Wasm projects as compatibility targets, implementation references, and benchmark baselines. Measured conformance and performance gates determine each retained design choice.

## Comparative view

| Solution | Data plane | ROS 2 semantics | Strength | Project role |
|---|---|---|---|---|
| [rosbridge_suite](https://docs.ros.org/en/jazzy/p/rosbridge_suite/) | WebSocket; JSON plus CBOR forms | Robot or edge | Broad ecosystem and protocol coverage | Legacy compatibility endpoint and JSON/CBOR benchmark |
| [Foxglove Bridge](https://github.com/foxglove/foxglove-sdk/blob/main/ros/src/foxglove_bridge/README.md) | WebSocket, CDR, schema | Robot or edge | Mature graph, parameter, service, asset, and visualization workflows | Performance baseline and Foxglove compatibility endpoint |
| [Zenoh ROS 2/DDS bridge](https://github.com/eclipse-zenoh/zenoh-plugin-ros2dds) and [`rmw_zenoh`](https://github.com/ros2/rmw_zenoh) | Zenoh binary protocol and routed topologies | Edge, router, or RMW | WAN, fleet routing, low-bandwidth topologies | Selectable fleet and WAN mapping |
| [`rclnodejs/web`](https://www.npmjs.com/package/rclnodejs) | WSS, HTTP, SSE | Server | Typed web API, allow lists, Node.js integration | Enterprise API and SDK design reference |
| [ROS2WASM](https://arxiv.org/abs/2409.09941) | `rmw-wasm` with JavaScript queues and YAML paths | Browser Wasm | Demonstrates upstream ROS 2 runtimes in a Worker | N3 precedent and comparative Wasm benchmark |
| Moonspan | WebTransport and WSS with R2WP/CDR | Browser Wasm | N2 runtime, QoS-aware channels, bounded resources, typed SDK | Mainline product path |

## Design conclusions

- rosbridge establishes the value of broad protocol compatibility; [CBOR-RAW](https://github.com/RobotWebTools/rosbridge_suite/blob/ros2/ROSBRIDGE_PROTOCOL.md) provides a serialized-byte comparison point.
- Foxglove establishes a mature CDR, schema, graph, service, parameter, and visualization bridge baseline; its [custom schema encodings](https://docs.foxglove.dev/docs/getting-started/custom/custom-schema-encodings) inform compatibility tests.
- ROS2WASM demonstrates browser-hosted upstream ROS runtimes and supplies a comparative path for Wasm packaging and dynamic conversion.
- ROS 2's [`rcl`/`rmw` internal interfaces](https://docs.ros.org/en/rolling/Concepts/Advanced/About-Internal-Interfaces.html) and [middleware interface design](https://design.ros2.org/articles/ros_middleware_interface.html) support a narrow serialized adapter and multiple middleware mappings.
- WebTransport supplies reliable streams and datagrams in Worker contexts; [WebTransport API](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API) and [datagram behavior](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport/datagrams) define the browser transport foundation.

## Benchmark roles

The mainline benchmark matrix runs identical fixtures and workloads through:

- rosbridge JSON;
- rosbridge CBOR-RAW;
- Foxglove Bridge WSS/CDR;
- R2WP WSS/CDR;
- R2WP WebTransport/CDR;
- ROS2WASM's dynamic conversion path.

Each report records semantic coverage, latency distribution, throughput, CPU, memory, copies, queue depth, drop reasons, and environment identity. [Validation](./validation.md) owns the workload and artifact contract.

## Compatibility posture

Compatibility endpoints run as explicit capabilities with independent policy and telemetry. R2WP and the browser SDK remain the primary application contract. Zenoh topology selection follows the one-mapping-per-domain rule in [Compatibility](./compatibility.md).
