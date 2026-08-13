# Architecture decision records

ADRs capture accepted decisions that carry significant reversal cost. Technical proposals remain design baselines until an ADR and its named evidence gate accept them.

## Register

| ADR | Status | Decision |
|---|---|---|
| [0001](./0001-mainline-before-common-prototype.md) | Accepted | Complete the platform mainline before starting the common Studio prototype. |
| [0002](./0002-use-bun-for-javascript-tooling.md) | Accepted | Use Bun for JavaScript workspaces, dependencies, lockfile, scripts, tests, and builds. |
| [0003](./0003-monorepo-ownership.md) | Accepted | Use one monorepo with root orchestration and explicit per-language workspace ownership. |
| [0004](./0004-browser-wasm-host-boundary.md) | Accepted | Keep a synchronous Wasm state machine behind an async TypeScript Worker host. |
| [0005](./0005-r2wp-wire-versioning.md) | Accepted | Version R2WP as complete negotiated wire contracts with server-selected versions. |
| [0006](./0006-edge-ros-c-abi-boundary.md) | Accepted | Isolate ROS integration behind a versioned serialized C ABI at the edge. |
| [0007](./0007-humble-jazzy-schema-identity.md) | Accepted | Lock phase-one Humble/Jazzy schema identity with `rep2011-rihs` and `rclweb-schema-v1`. |
| [0008](./0008-one-adapter-row-per-gateway-process.md) | Accepted | Bind each gateway process to one ROS adapter support row with multi-domain contexts inside that row. |
| [0009](./0009-r2wp-v0-wire-encoding.md) | Accepted | Freeze R2WP wire version 0 encoding, registries, deterministic CBOR control maps, and transport length rules. |
| [0010](./0010-restructure-single-rust-core.md) | Accepted | One Rust core (`rclweb`) for gateway and browser; fixtures are the single conformance oracle; project name rclweb. |
| [0011](./0011-local-dev-webtransport-tls.md) | Accepted | Local-dev WebTransport uses auto-minted short-lived ECDSA certs + `serverCertificateHashes`; rotate before the browser's 14-day ceiling; production stays on PKI. |
| [0012](./0012-rclweb-schema-identifiers.md) | Accepted | Humble scheme, corpus id, and conformance package names follow rclweb (`rclweb-schema-v1`, `rclweb-ros-cdr-v1`, `rclweb_cdr_interfaces`). |
| [0013](./0013-typescript-package-rclweb.md) | Accepted | TypeScript package is unscoped `rclweb` at `typescript/`; no `@rclweb/sdk` and no `sdk/` tree. |

## Convention

- Files use four-digit sequence numbers and lowercase hyphenated names.
- Each record states status, date, context, decision, rationale, consequences, revisit triggers, and source.
- A changed decision receives a new ADR that names the superseded record.
- ADR 0010 supersedes the language choice inside ADR 0004 (the host boundary itself stands).
- ADR 0012 withdraws ADR 0010's freeze of pre-rename identifier strings; ADR 0007's Humble/Jazzy strategy stands.
- ADR 0013 supersedes the `@rclweb/sdk` / `sdk/typescript/` naming in ADR 0010 and ADR 0003.
