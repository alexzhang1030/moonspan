# Technology stack rationale

Moonspan's stack supports browser-native ROS semantics, a binary hot path, bounded resource use, a controlled edge boundary, and reproducible release evidence. Detailed component behavior lives in the [formal documentation map](../../docs/README.md).

## Mainline stack

### MoonBit and WebAssembly

`rclmbt` uses MoonBit compiled to Wasm for CDR, generated and dynamic types, graph state, QoS, executor state, Service, Action, Parameter, and Clock semantics.

The initial boundary uses a synchronous Wasm state machine and an asynchronous JavaScript Worker host. Batched `poll` calls reduce boundary overhead and keep browser APIs in their native execution model. [Runtime documentation](../../docs/runtime/rclmbt.md) owns the contract and evidence requirements.

### Rust and a narrow ROS C ABI

`rclwebd` uses Rust for WebTransport, WSS, sessions, scheduling, schemas, metrics, policy, and audit. A versioned C ABI adapter uses generic serialized `rcl` and `rmw` operations and concentrates ROS distro variation.

The first measured path uses explicit one-copy ownership through bounded rings. Later buffer-sharing work follows allocator and lifetime evidence. [Gateway documentation](../../docs/gateway/rclwebd.md) owns this boundary.

### R2WP, WebTransport, and WSS

R2WP uses a fixed 32-byte frame header plus CDR, encoded media, graph, schema, control, or recording payloads. WebTransport supplies independent streams and datagrams. Binary WSS supplies a broad proxy-compatible path through the same semantic envelope.

[R2WP](../../docs/protocol/r2wp.md) owns framing, channels, QoS, versioning, errors, and fixtures.

### TypeScript SDK and Bun

TypeScript defines the public browser SDK, Worker host, generated bindings, session lifecycle, typed operations, telemetry, and headless examples.

Bun is the human-selected JavaScript stack tool recorded on 2026-08-10. Bun owns package installation, workspaces, the root `package.json`, `bun.lock`, script execution, tests, builds, and repository-scoped one-shot tools. Exact Bun version and root workspace/lockfile convention resolve under [D-03](../../tasks/plan.md#13-kickoff-decision-register); the human-provided rationale remains open.

Vitest covers SDK units and contracts through Bun scripts. Playwright covers browser behavior, Worker integration, transport sessions, and later prototype accessibility. `bunx` runs tools such as the DESIGN.md linter.

### ROS platform

First-stage ROS platforms are Humble Hawksbill and Jazzy Jalisco. Fast DDS (`rmw_fastrtps_cpp`) is the reference and default row on each distro; Cyclone DDS (`rmw_cyclonedds_cpp`) is the second qualification row. Humble uses the `moonspan-schema-v1` recursive deployment-bundle identity; Jazzy uses `rep2011-rihs` with native `GetTypeDescription`. Kilted, Lyrical, Rolling, `rmw_zenoh`, and Zenoh router topologies are later expansion candidates.

Exact image digests, CPU variants, browser pins, and row status live in the [reference support profile](../../docs/support-matrix.md). [Compatibility](../../docs/compatibility.md) owns strategy and tier language. [ADR 0007](../../docs/adr/0007-humble-jazzy-schema-identity.md) owns schema identity.

### Repository and evidence tooling

- `just` provides root `check`, `test`, `build`, conformance, benchmark, documentation, and release commands.
- Cargo builds and tests the Rust workspace.
- MoonBit tooling builds Wasm modules and runs codec/runtime suites.
- Bun manages TypeScript workspaces and scripts.
- Versioned fixtures and machine-readable artifacts travel with the repository.
- CI publishes conformance, benchmark, security, compatibility, and release evidence.

## Post-mainline prototype stack

The common Studio prototype uses TypeScript, React, Vite, Workers, OffscreenCanvas, WebGPU with a WebGL2 compatibility tier, and WebCodecs. It consumes the released SDK and begins after the M3 mainline release gate. [Prototype scope](../../docs/prototypes/studio-ui.md) and [DESIGN.md](./DESIGN.md) own the UI choices.

React and Vite receive a U0 entry review against the released SDK and prototype goals. Their accepted rationale belongs in a prototype ADR.

## Decision lifecycle

- Bun is a human-selected stack constraint.
- Remaining kickoff choices route through the [kickoff decision register](../../tasks/plan.md#13-kickoff-decision-register) with accountable role, required evidence, decision deadline, and current state.
- Mainline architecture bets gain authority through M0 ADR review and the evidence gates in [validation](../../docs/validation.md).
- Prototype technology choices gain authority at U0 entry and through prototype qualification.
- Findings outside accepted envelopes reopen the affected choice through an ADR update and new evidence.
