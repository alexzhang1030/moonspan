# Project intent

Moonspan's mainline is a browser-native ROS 2 connectivity and runtime platform. It delivers R2WP, `rclmbt`, `rclwebd`, a TypeScript browser SDK, conformance evidence, production security, deployment assets, and a release package for robotics application teams.

This unstamped record captures human direction expressed on 2026-08-10: Bun is the JavaScript stack tool, formal documentation owns the complete project direction, and the common Studio UI is a side project that begins after the mainline release. Detailed scope lives in [product scope](../../docs/product-scope.md).

## Mainline direction

The mainline advances through one dependency chain:

1. R2WP and CDR contracts, fixtures, support profiles, and repository tooling.
2. `rclmbt`, `rclwebd`, and browser SDK graph and publish/subscribe paths.
3. Complete N2 ROS semantics, dynamic types, QoS, recording, and topology support.
4. Identity, policy, SROS2, audit, resource controls, compatibility, operations, and release evidence.
5. A stable SDK and signed mainline release.

## People and jobs

- Robotics developers need typed browser access to ROS topics, services, actions, parameters, clocks, schemas, graph state, and QoS.
- Integration engineers need reproducible conformance, transport diagnostics, compatibility endpoints, and traceable failures.
- Robot operators need scoped commands, clear capabilities, audit identity, and predictable recovery.
- Fleet teams need a controlled edge boundary across robot domains and WAN topologies.
- Application teams need a stable SDK for purpose-built operational interfaces.

## Product promise

- Browser Wasm carries N2 ROS runtime semantics through `rclmbt`.
- R2WP carries CDR and control semantics through bounded, observable WebTransport and WSS channels.
- `rclwebd` concentrates ROS attachment, identity, policy, scheduling, schema, audit, and operations at the edge.
- Supported environments carry explicit conformance, performance, security, and deployment evidence.
- Public SDK contracts give applications a reusable typed foundation.

## Post-mainline work

The common Studio prototype is a UI side project scheduled after the mainline release gate. It exercises the released SDK through a generic graph explorer, inspector, panels, rendering, media, commands, and Live/Replay workspace. Its scope lives in [Common Studio prototype](../../docs/prototypes/studio-ui.md), and its visual rules live in [DESIGN.md](./DESIGN.md).

The N3 upstream-package Wasm sandbox is a separate post-release compatibility experiment. Its measured API, size, startup, memory, and package constraints determine later investment.

## Direction test

Mainline work contributes to ROS semantics, bounded data flow, secure edge attachment, compatibility, conformance, SDK quality, operations, or release quality. Prototype work consumes the released contracts to demonstrate a reusable visual application.
