# Architecture decision records

ADRs capture accepted decisions that carry significant reversal cost. Technical proposals remain design baselines until an ADR and its named evidence gate accept them.

## Register

| ADR | Status | Decision |
|---|---|---|
| [0001](./0001-mainline-before-common-prototype.md) | Accepted | Complete the platform mainline before starting the common Studio prototype. |
| [0002](./0002-use-bun-for-javascript-tooling.md) | Accepted | Use Bun for JavaScript workspaces, dependencies, lockfile, scripts, tests, and builds. |
| [0003](./0003-monorepo-ownership.md) | Accepted | Use one monorepo with root orchestration and explicit per-language workspace ownership. |
| [0004](./0004-browser-wasm-host-boundary.md) | Accepted | Keep a synchronous MoonBit/Wasm state machine behind an async TypeScript Worker host. |
| [0005](./0005-r2wp-wire-versioning.md) | Accepted | Version R2WP as complete negotiated wire contracts with server-selected versions. |
| [0006](./0006-edge-ros-c-abi-boundary.md) | Accepted | Isolate ROS integration behind a versioned serialized C ABI at the edge. |
| [0007](./0007-humble-jazzy-schema-identity.md) | Accepted | Lock phase-one Humble/Jazzy schema identity with `rep2011-rihs` and `moonspan-schema-v1`. |
| [0008](./0008-one-adapter-row-per-gateway-process.md) | Accepted | Bind each gateway process to one ROS adapter support row with multi-domain contexts inside that row. |
| [0009](./0009-r2wp-v0-wire-encoding.md) | Accepted | Freeze R2WP wire version 0 encoding, registries, deterministic CBOR control maps, and transport length rules. |
| [0010](./0010-restructure-single-rust-core.md) | Accepted | Restructure on a single Rust core (`rclweb`) for gateway and browser; retire MoonBit, the TypeScript protocol implementation, and the agreement apparatus; rename the project rclweb. |

## Convention

- Files use four-digit sequence numbers and lowercase hyphenated names.
- Each record states status, date, context, decision, rationale, consequences, revisit triggers, and source.
- A changed decision receives a new ADR that names the superseded record.
- ADR 0010 supersedes the language choice inside ADR 0004 (the host boundary itself stands) and retires the multi-implementation delivery model that M0-03 built; the [M0-03 completion record](../milestones/m0-03-r2wp-foundation.md) remains the historical evidence of that milestone.
