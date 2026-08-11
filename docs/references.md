# Technical references

These sources support Moonspan's architecture and ADRs. Project requirements live in the [documentation map](./README.md), protocol contract, support matrix, and accepted decisions.

## ROS 2

- [REP-2000 ROS distributions](https://raw.githubusercontent.com/ros-infrastructure/rep/master/rep-2000.rst)
- [ROS 2 internal interfaces](https://docs.ros.org/en/jazzy/Concepts/Advanced/About-Internal-Interfaces.html)
- [ROS middleware interface design](https://design.ros2.org/articles/ros_middleware_interface.html)
- [Multiple RMW implementations](https://docs.ros.org/en/humble/How-To-Guides/Working-with-multiple-RMW-implementations.html)
- [Generic publisher](https://docs.ros.org/en/humble/p/rclcpp/generated/classrclcpp_1_1GenericPublisher.html) and [generic subscription](https://docs.ros.org/en/humble/p/rclcpp/generated/classrclcpp_1_1GenericSubscription.html)
- [Serialized publish API](https://docs.ros.org/en/humble/p/rcl/generated/function_publisher_8h_1adddb3b0d3e77275b6497e7ff70c0d139.html)
- [Jazzy GetTypeDescription](https://docs.ros.org/en/jazzy/p/type_description_interfaces/srv/GetTypeDescription.html)
- [ROS 2 access-control policies](https://design.ros2.org/articles/ros2_access_control_policies.html)
- [ROS 2 security enclaves](https://design.ros2.org/articles/ros2_security_enclaves.html)
- [Official ROS container images](https://hub.docker.com/_/ros)

## Bridges and browser runtimes

- [rosbridge_suite](https://docs.ros.org/en/jazzy/p/rosbridge_suite/)
- [rosbridge protocol](https://github.com/RobotWebTools/rosbridge_suite/blob/ros2/ROSBRIDGE_PROTOCOL.md)
- [Foxglove Bridge](https://github.com/foxglove/foxglove-sdk/blob/main/ros/src/foxglove_bridge/README.md)
- [Foxglove custom schema encodings](https://docs.foxglove.dev/docs/getting-started/custom/custom-schema-encodings)
- [`rclnodejs/web`](https://www.npmjs.com/package/rclnodejs)
- [ROS2WASM](https://arxiv.org/abs/2409.09941)
- [`rmw_wasm`](https://github.com/ros2wasm/rmw_wasm/blob/main/README.md)
- [`rmw_zenoh`](https://github.com/ros2/rmw_zenoh)
- [Zenoh ROS 2/DDS bridge](https://github.com/eclipse-zenoh/zenoh-plugin-ros2dds)

## Protocol and transport

- [RFC 2119 requirement keywords](https://www.rfc-editor.org/rfc/rfc2119.html)
- [RFC 8949 CBOR](https://www.rfc-editor.org/rfc/rfc8949.html)
- [RFC 8610 CDDL](https://www.rfc-editor.org/rfc/rfc8610.html)
- [RFC 6455 WebSocket](https://www.rfc-editor.org/rfc/rfc6455.html)
- [W3C WebTransport API](https://www.w3.org/TR/webtransport/)
- [IETF WebTransport over HTTP/3](https://datatracker.ietf.org/doc/draft-ietf-webtrans-http3/)
- [Moonspan R2WP contract](../protocol/r2wp-v0.md)
- [R2WP encoding decision](./adr/0009-r2wp-v0-wire-encoding.md)

## Browser and Wasm platform

- [MoonBit FFI](https://docs.moonbitlang.com/en/latest/language/ffi.html)
- [MoonBit toolchain](https://docs.moonbitlang.com/en/latest/toolchain/moon/commands.html)
- [WebTransport](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API)
- [Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
- [Cross-origin isolation](https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/crossOriginIsolated)
- [WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)
- [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
- [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)
- [Playwright](https://playwright.dev/docs/release-notes)

## Repository tooling

- [Rust releases](https://blog.rust-lang.org/releases/)
- [rustup](https://rust-lang.github.io/rustup/)
- [Cargo workspaces](https://doc.rust-lang.org/cargo/reference/workspaces.html)
- [MoonBit installation](https://www.moonbitlang.com/download/)
- [MoonBit module configuration](https://docs.moonbitlang.com/en/latest/toolchain/moon/module.html)
- [MoonBit package configuration](https://docs.moonbitlang.com/en/latest/toolchain/moon/package.html)
- [Bun installation](https://bun.com/docs/installation)
- [Bun workspaces](https://bun.com/docs/install/workspaces)
- [just manual](https://just.systems/man/en/)
- [GitHub Actions](https://docs.github.com/en/actions)

Exact project pins live in version-controlled toolchain files and [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

## Project records

- [ADR register](./adr/README.md)
- [Reference support profile](./support-matrix.md)
- [Validation gates](./validation.md)
- [R2WP overview](./protocol/r2wp.md)
- [DESIGN.md specification](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md)
