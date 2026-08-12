# Technology stack rationale

rclweb keeps the language count at the minimum the platform forces: Rust for everything that computes on both sides of the wire, TypeScript only where the browser demands JavaScript.

## Mainline stack

| Area | Choice | Rationale |
|---|---|---|
| Core (protocol, CDR, ROS state) | Rust, native + `wasm32-unknown-unknown` | One codebase for gateway and browser removes the N-implementation tax ([ADR 0010](../../docs/adr/0010-restructure-single-rust-core.md)); mature fuzzing/benchmark tooling serves R2 hardening; borrow checker enforces the borrowed-view CDR contract |
| Browser host and SDK | TypeScript Workers | Native browser APIs, scheduling, buffer transfer, and public bindings; no protocol parsing |
| Edge gateway | Rust (`rclwebd`, thin over the core) | Concurrent transport, bounded scheduling, policy, telemetry |
| ROS boundary | Serialized-only rcl FFI (versioned C ABI packaging in R3) | Isolates distribution/RMW variation without embedding or depending on a client library (owner constraint) |
| Wire protocol | R2WP v0 with a declared normative subset | One binary semantic contract over WebTransport and binary WebSocket |
| JavaScript tooling | Bun ([ADR 0002](../../docs/adr/0002-use-bun-for-javascript-tooling.md)) | Workspaces, installation, scripts, tests, builds, lockfile |
| Repository commands | just | One root command surface |

MoonBit was the pre-restructure browser runtime language, chosen for Wasm convenience. It was retired because the poll boundary (ADR 0004) is a narrow buffer interface where authoring ergonomics matter least, while the gateway/browser split is where a second language compounds cost. The sole reopen condition is R1 evidence on wasm artifact size or poll latency.

## Toolchain pins

| Tool | Pin source |
|---|---|
| Bun | `.bun-version` and `package.json` |
| Rust | `rust-toolchain.toml` (channel + wasm32 target) and the Cargo workspace |
| just | `.just-version` |

`scripts/toolchain-check.ts` verifies the installed versions. The root command surface is:

```bash
just toolchain-check
just check
just test
just build
```

## Workspace ownership

| Path | Tooling and role |
|---|---|
| `rclweb/` | Cargo crate: the core (native + wasm32) |
| `rclwebd/` | Cargo crate: the gateway |
| `sdk/typescript/` | Bun workspace and browser SDK |
| `protocol/` | Normative contracts, registries, schemas, and frozen fixtures |
| `conformance/` | CDR corpus and qualification workloads |
| `studio/` | U0 workspace added after release |

## ROS profile

Phase 1 gates J-FT (Jazzy + Fast DDS). Corpus data for all six rows (H-FT, H-CY, H-ZN, J-FT, J-CY, J-ZN) stays committed; H-FT returns in R3 and the rest in R4 through the [support matrix](../../docs/support-matrix.md). Humble uses `moonspan-schema-v1` bundle identity and Jazzy uses `rep2011-rihs` (frozen historical identifiers — committed hashes depend on them).

## Decision lifecycle

- Mainline architecture decisions gain authority through ADR review and validation gates.
- Platform changes update the support matrix and conformance evidence.
- Studio technology choices receive their own review at U0 entry.
