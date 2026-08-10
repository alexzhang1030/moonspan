# Technical references

This reference set grounds Moonspan's design baseline and future ADR review in standards, official documentation, source repositories, and first-party package material. Formal project contracts remain in the topic documents listed by [the documentation map](./README.md). Exact first-stage pins live in the [support matrix](./support-matrix.md).

## ROS 2 architecture and serialization

- [REP-2000 ROS distributions](https://raw.githubusercontent.com/ros-infrastructure/rep/master/rep-2000.rst)
- [ROS 2 internal interfaces (Jazzy)](https://docs.ros.org/en/jazzy/Concepts/Advanced/About-Internal-Interfaces.html)
- [ROS middleware interface design](https://design.ros2.org/articles/ros_middleware_interface.html)
- [Creating an RMW implementation](https://docs.ros.org/en/jazzy/Tutorials/Advanced/Creating-An-RMW-Implementation.html)
- [Humble `rclcpp::GenericPublisher`](https://docs.ros.org/en/humble/p/rclcpp/generated/classrclcpp_1_1GenericPublisher.html)
- [Humble `rclcpp::GenericSubscription`](https://docs.ros.org/en/humble/p/rclcpp/generated/classrclcpp_1_1GenericSubscription.html)
- [Humble `rclcpp::get_typesupport_library`](https://docs.ros.org/en/ros2_packages/humble/api/rclcpp/generated/function_namespacerclcpp_1a629c76e9f974bbaed3b82b030f7f1b01.html)
- [Humble `rcl_publish_serialized_message`](https://docs.ros.org/en/humble/p/rcl/generated/function_publisher_8h_1adddb3b0d3e77275b6497e7ff70c0d139.html)
- [Jazzy `rcl_node_type_description_service_handle_request`](https://docs.ros.org/en/ros2_packages/jazzy/api/rcl/generated/function_node_8h_1a44baca8938b0a97a9f0a53ff9264ba36.html)
- [Jazzy `GetTypeDescription` service](https://docs.ros.org/en/jazzy/p/type_description_interfaces/srv/GetTypeDescription.html)
- [Jazzy Jalisco complete changelog](https://docs.ros.org/en/jazzy/Releases/Jazzy-Jalisco-Complete-Changelog.html)
- [ROSIDL type description generator (Jazzy)](https://docs.ros.org/en/ros2_packages/jazzy/api/rosidl_generator_type_description/)
- [ROS 2 access-control policies](https://design.ros2.org/articles/ros2_access_control_policies.html)
- [ROS 2 security enclaves](https://design.ros2.org/articles/ros2_security_enclaves.html)
- [Humble Hawksbill release information](https://docs.ros.org/en/humble/Releases/Release-Humble-Hawksbill.html)
- [Jazzy Jalisco release information](https://docs.ros.org/en/jazzy/Releases/Release-Jazzy-Jalisco.html)

## Official ROS container images

- [Official ROS Docker Hub images](https://hub.docker.com/_/ros)
- [Docker Hub tag API: `humble-ros-base-jammy`](https://hub.docker.com/v2/repositories/library/ros/tags/humble-ros-base-jammy)
- [Docker Hub tag API: `jazzy-ros-base-noble`](https://hub.docker.com/v2/repositories/library/ros/tags/jazzy-ros-base-noble)

## Bridges, middleware, and browser runtimes

- [rosbridge_suite](https://docs.ros.org/en/jazzy/p/rosbridge_suite/)
- [rosbridge protocol](https://github.com/RobotWebTools/rosbridge_suite/blob/ros2/ROSBRIDGE_PROTOCOL.md)
- [Foxglove Bridge](https://github.com/foxglove/foxglove-sdk/blob/main/ros/src/foxglove_bridge/README.md)
- [Foxglove custom schema encodings](https://docs.foxglove.dev/docs/getting-started/custom/custom-schema-encodings)
- [`rclnodejs/web`](https://www.npmjs.com/package/rclnodejs)
- [ROS2WASM paper](https://arxiv.org/abs/2409.09941)
- [`rmw_wasm` implementation notes](https://github.com/ros2wasm/rmw_wasm/blob/main/README.md)

### Later-expansion topology references

- [`rmw_zenoh`](https://github.com/ros2/rmw_zenoh)
- [Zenoh ROS 2/DDS bridge](https://github.com/eclipse-zenoh/zenoh-plugin-ros2dds)

## MoonBit and browser platform

- [MoonBit FFI](https://docs.moonbitlang.com/en/latest/language/ffi.html)
- [MoonBit experimental async runtime](https://docs.moonbitlang.com/en/latest/language/async-experimental.html)
- [MoonBit toolchain commands](https://docs.moonbitlang.com/en/latest/toolchain/moon/commands.html)
- [Playwright release notes](https://playwright.dev/docs/release-notes)
- [Playwright Docker](https://playwright.dev/docs/docker)
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
- [ADR 0007: Humble/Jazzy schema identity](./adr/0007-humble-jazzy-schema-identity.md)
- [Reference support profile](./support-matrix.md)
