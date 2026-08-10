# Product scope

Moonspan builds a browser-native ROS 2 connectivity and runtime platform for robotics developers, integration engineers, robot operators, and fleet teams. Its mainline gives browser applications typed ROS 2 semantics, high-rate binary data, controlled robot access, and measurable compatibility through a stable SDK.

## Mainline outcome

The mainline produces these release artifacts:

- **R2WP:** a versioned binary protocol carrying CDR, graph, schema, QoS, request/reply, action, time, media, and recording channels over WebTransport and binary WebSocket.
- **`rclmbt`:** a MoonBit-to-Wasm runtime implementing Context, Node, Executor, Graph, publish/subscribe, QoS, Service, Action, Parameter, and Clock behavior.
- **`rclwebd`:** a Rust edge gateway with a narrow ROS C ABI adapter, bounded scheduling, schema services, identity, policy, audit, and compatibility endpoints.
- **Browser SDK:** TypeScript APIs, Worker hosts, generated and dynamic types, session lifecycle, telemetry, and headless examples.
- **Conformance and operations:** golden fixtures, cross-RMW matrices, benchmarks, security evidence, deployment artifacts, runbooks, and signed release outputs.

The release path advances in dependency order: contracts and fixtures, core data path, complete ROS semantics, production qualification, release.

## People and jobs

- Robotics developers need typed browser access to topics, services, actions, parameters, clocks, schemas, graph state, and QoS.
- Integration engineers need reproducible interoperability tests, transport diagnostics, compatibility endpoints, and traceable failures.
- Robot operators need scoped commands, clear permissions, audit identity, connection health, and predictable recovery.
- Fleet teams need a controlled edge boundary across LAN and WAN robot domains.
- Application teams need a stable browser SDK that supports custom operational interfaces.

## Mainline promises

- **ROS 2 semantics in browser Wasm:** N2 behavior covers Node, Executor, Graph, QoS, Clock, Service, Action, and Parameter workflows.
- **Binary data with visible budgets:** CDR remains on the hot path; every queue carries sample and byte limits; telemetry correlates source, network, queue, decode, and delivery stages.
- **Controlled robot attachment:** identity, SROS2 policy, operation ACLs, resource budgets, and audit converge at `rclwebd`.
- **Portable application contract:** WebTransport and WSS share R2WP; generated and dynamic schemas share one type registry; SDK behavior remains stable across declared browser tiers.
- **Evidence-backed support:** each supported ROS distro, RMW, browser, and topology has an explicit matrix row and reproducible qualification report.

## Native levels

| Level | Definition | Evidence | Project role |
|---|---|---|---|
| N1 Wire-native | CDR, type hash, graph, QoS, and ROS time agree across the wire | Golden bytes plus Fast DDS, Cyclone DDS, and selected Zenoh interoperability | Mainline foundation |
| N2 Runtime-native | Browser Wasm provides the planned ROS runtime semantics | `rclmbt` conformance plus bidirectional operation in a real ROS graph | Mainline runtime |
| N3 Package-native | Selected upstream `rcl` or `rclcpp` packages run in Wasm | Reproducible package builds, custom-message demo, size, startup, and runtime limits | Post-release compatibility experiment |

## Common Studio prototype

The common Studio prototype is a side project scheduled after the mainline release gate. It demonstrates how a generic robotics workspace can consume the released browser SDK through Graph Explorer, inspectors, plots, 3D, camera, diagnostics, command workflows, and Live/Replay surfaces.

The prototype owns presentation, interaction, visual tokens, workspace layout, and panel behavior. R2WP, `rclmbt`, `rclwebd`, the browser SDK, policy schemas, and conformance suites own its technical contracts. Its full scope and entry criteria live in [Common Studio prototype](./prototypes/studio-ui.md).

## Scope tests

Mainline work strengthens one or more of these outcomes:

- ROS 2 wire or runtime semantics in the browser;
- bounded and observable data flow between browser and ROS domain;
- secure and operable edge attachment;
- compatibility, conformance, SDK usability, or release quality.

Prototype work exercises the released contracts through a reusable visual workspace. Product-specific workflows remain application-layer extensions over the SDK.
