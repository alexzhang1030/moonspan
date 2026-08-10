# Technical references

This reference set grounds Moonspan's design baseline and future ADR review in standards, official documentation, source repositories, and first-party package material. Formal project contracts remain in the topic documents listed by [the documentation map](./README.md).

## ROS 2 architecture and serialization

- [ROS 2 internal interfaces](https://docs.ros.org/en/rolling/Concepts/Advanced/About-Internal-Interfaces.html)
- [ROS middleware interface design](https://design.ros2.org/articles/ros_middleware_interface.html)
- [Creating an RMW implementation](https://docs.ros.org/en/jazzy/Tutorials/Advanced/Creating-An-RMW-Implementation.html)
- [`rcl_publish_serialized_message`](https://docs.ros.org/en/rolling/p/rcl/generated/function_publisher_8h_1adddb3b0d3e77275b6497e7ff70c0d139.html)
- [`GetTypeDescription`](https://docs.ros.org/en/lyrical/p/type_description_interfaces/srv/GetTypeDescription.html)
- [ROSIDL type description generator](https://docs.ros.org/en/ros2_packages/jazzy/api/rosidl_generator_type_description/)
- [ROS 2 access-control policies](https://design.ros2.org/articles/ros2_access_control_policies.html)
- [ROS 2 security enclaves](https://design.ros2.org/articles/ros2_security_enclaves.html)
- [ROS 2 Lyrical Luth release information](https://docs.ros.org/en/lyrical/Releases/Release-Lyrical-Luth.html)

## Bridges, middleware, and browser runtimes

- [rosbridge_suite](https://docs.ros.org/en/jazzy/p/rosbridge_suite/)
- [rosbridge protocol](https://github.com/RobotWebTools/rosbridge_suite/blob/ros2/ROSBRIDGE_PROTOCOL.md)
- [Foxglove Bridge](https://github.com/foxglove/foxglove-sdk/blob/main/ros/src/foxglove_bridge/README.md)
- [Foxglove custom schema encodings](https://docs.foxglove.dev/docs/getting-started/custom/custom-schema-encodings)
- [`rmw_zenoh`](https://github.com/ros2/rmw_zenoh)
- [Zenoh ROS 2/DDS bridge](https://github.com/eclipse-zenoh/zenoh-plugin-ros2dds)
- [`rclnodejs/web`](https://www.npmjs.com/package/rclnodejs)
- [ROS2WASM paper](https://arxiv.org/abs/2409.09941)
- [`rmw_wasm` implementation notes](https://github.com/ros2wasm/rmw_wasm/blob/main/README.md)

## MoonBit and browser platform

- [MoonBit FFI](https://docs.moonbitlang.com/en/latest/language/ffi.html)
- [MoonBit experimental async runtime](https://docs.moonbitlang.com/en/latest/language/async-experimental.html)
- [WebTransport API](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API)
- [WebTransport datagrams](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport/datagrams)
- [WebTransport W3C Editor's Draft](https://w3c.github.io/webtransport/)
- [Cross-origin isolation](https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/crossOriginIsolated)
- [Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
- [WebGPU API](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)
- [WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
- [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)

## Repository tooling and design records

- [Bun workspaces](https://bun.sh/docs/pm/workspaces)
- [Bun runtime and CLI](https://bun.sh/docs/runtime)
- [DESIGN.md specification](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md)
