# Technical references

This reference set grounds Moonspan's design baseline and future ADR review in standards, official documentation, source repositories, and first-party package material. Formal project contracts remain in the topic documents listed by [the documentation map](./README.md). Exact first-stage pins live in the [support matrix](./support-matrix.md).

## ROS 2 architecture and serialization

- [REP-2000 ROS distributions](https://raw.githubusercontent.com/ros-infrastructure/rep/master/rep-2000.rst)
- [ROS 2 internal interfaces (Jazzy)](https://docs.ros.org/en/jazzy/Concepts/Advanced/About-Internal-Interfaces.html)
- [ROS middleware interface design](https://design.ros2.org/articles/ros_middleware_interface.html)
- [Working with multiple RMW implementations (Humble)](https://docs.ros.org/en/humble/How-To-Guides/Working-with-multiple-RMW-implementations.html)
- [Creating an RMW implementation (Jazzy)](https://docs.ros.org/en/jazzy/Tutorials/Advanced/Creating-An-RMW-Implementation.html)
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

### Rust

- [Rust releases index](https://blog.rust-lang.org/releases/)
- [Announcing Rust 1.97.1](https://blog.rust-lang.org/2026/07/16/Rust-1.97.1/)
- [rustup book](https://rust-lang.github.io/rustup/)
- [Cargo workspaces](https://doc.rust-lang.org/cargo/reference/workspaces.html)
- [The Rust Edition Guide (2024)](https://doc.rust-lang.org/edition-guide/rust-2024/index.html)

### MoonBit

- [MoonBit download and install](https://www.moonbitlang.com/download/)
- [MoonBit v0.10.4 release notes](https://www.moonbitlang.com/updates/2026/07/13/moonbit-0-10-4-release)
- [MoonBit module configuration (`moon.mod`)](https://docs.moonbitlang.com/en/latest/toolchain/moon/module.html)
- [MoonBit package configuration (`moon.pkg`)](https://docs.moonbitlang.com/en/latest/toolchain/moon/package.html)
- [MoonBit toolchain commands](https://docs.moonbitlang.com/en/latest/toolchain/moon/commands.html)
- [Official unix installer script](https://cli.moonbitlang.com/install/unix.sh) (pass the full build ID as the version argument, or set `MOONBIT_INSTALL_VERSION`; isolate installs with `MOON_HOME`)
- Official installer SHA256 (recompute when the script changes; platform/release owner updates workflow + this table): `46495f8cdc0050f79b6cb195d66478d101cb3601d68506568fbe377fcdf2a9fe`
- Project pin install argument: `0.10.6+80dc50f24` (the full build ID installs successfully; a probe of the short ID `0.10.4` returned HTTP 403 on the current CDN)
- [darwin-aarch64 full-build archive `0.10.6+80dc50f24`](https://cli.moonbitlang.com/binaries/0.10.6%2B80dc50f24/moonbit-darwin-aarch64.tar.gz)
- [darwin-aarch64 full-build archive sha256](https://cli.moonbitlang.com/binaries/0.10.6%2B80dc50f24/moonbit-darwin-aarch64.tar.gz.sha256) (`a70bd7a92c97b29125c4cb9a647a390bd850b10161191b61e9b7c9b2dd482ddb`)
- [darwin-aarch64 full-build core archive](https://cli.moonbitlang.com/cores/core-0.10.6%2B80dc50f24.tar.gz)
- Matching binary/core URI pattern for other hosts: `https://cli.moonbitlang.com/binaries/<url-encoded-version>/moonbit-<target>.tar.gz` and `https://cli.moonbitlang.com/cores/core-<url-encoded-version>.tar.gz`

### just

- [just 1.50.0 release](https://github.com/casey/just/releases/tag/1.50.0)
- [just 1.50.0 darwin-aarch64 archive](https://github.com/casey/just/releases/download/1.50.0/just-1.50.0-aarch64-apple-darwin.tar.gz)
- [just manual](https://just.systems/man/en/)
- [just repository](https://github.com/casey/just)

### Bun

- [Bun v1.3.14 release](https://bun.com/blog/bun-v1.3.14)
- [Bun installation](https://bun.com/docs/installation)
- [Bun workspaces](https://bun.com/docs/install/workspaces)
- [Bun install and linker](https://bun.com/docs/install)
- [Bun runtime and CLI](https://bun.com/docs/runtime)

### GitHub Actions (foundation CI pins)

Workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) references actions by full commit SHA. Tags are documentation labels only.

| Action | Tag | Commit SHA |
|---|---|---|
| [actions/checkout](https://github.com/actions/checkout) | v7 | [`3d3c42e5aac5ba805825da76410c181273ba90b1`](https://github.com/actions/checkout/commit/3d3c42e5aac5ba805825da76410c181273ba90b1) |
| [actions/cache](https://github.com/actions/cache) | v6 | [`55cc8345863c7cc4c66a329aec7e433d2d1c52a9`](https://github.com/actions/cache/commit/55cc8345863c7cc4c66a329aec7e433d2d1c52a9) |
| [actions/upload-artifact](https://github.com/actions/upload-artifact) | v7 | [`043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`](https://github.com/actions/upload-artifact/commit/043fb46d1a93c77aae656e7c1c64a875d1fc6a0a) |
| [oven-sh/setup-bun](https://github.com/oven-sh/setup-bun) | v2.2.0 | [`0c5077e51419868618aeaa5fe8019c62421857d6`](https://github.com/oven-sh/setup-bun/commit/0c5077e51419868618aeaa5fe8019c62421857d6) |

- [just 1.50.0 release assets](https://github.com/casey/just/releases/tag/1.50.0) including [SHA256SUMS](https://github.com/casey/just/releases/download/1.50.0/SHA256SUMS) and [x86_64-unknown-linux-musl archive](https://github.com/casey/just/releases/download/1.50.0/just-1.50.0-x86_64-unknown-linux-musl.tar.gz) (`27e011cd6328fadd632e59233d2cf5f18460b8a8c4269acd324c1a8669f34db0`)
- [rhysd/actionlint releases](https://github.com/rhysd/actionlint/releases) (local workflow lint)

### Design records

- [DESIGN.md specification](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md)
- [ADR 0002: Bun for JavaScript tooling](./adr/0002-use-bun-for-javascript-tooling.md)
- [ADR 0003: monorepo ownership](./adr/0003-monorepo-ownership.md)
- [ADR 0007: Humble/Jazzy schema identity](./adr/0007-humble-jazzy-schema-identity.md)
- [ADR 0008: one adapter row per gateway process](./adr/0008-one-adapter-row-per-gateway-process.md)
- [Reference support profile](./support-matrix.md)
- [Validation and delivery gates](./validation.md)
