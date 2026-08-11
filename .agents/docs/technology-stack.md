# Technology stack rationale

Moonspan uses a polyglot stack because browser execution, ROS integration, protocol handling, and release tooling have different ownership and runtime constraints.

## Mainline stack

| Area | Choice | Rationale |
|---|---|---|
| Browser runtime | MoonBit compiled to Wasm | Deterministic CDR, type, graph, QoS, and executor state |
| Browser host and SDK | TypeScript Workers | Native browser APIs, scheduling, buffer transfer, and public bindings |
| Edge gateway | Rust | Concurrent transport, bounded scheduling, policy, telemetry, and operations |
| ROS boundary | Versioned serialized C ABI | Isolates ROS distribution and RMW variation behind one adapter profile |
| Wire protocol | R2WP v0 | One binary semantic contract over WebTransport and binary WebSocket |
| JavaScript tooling | Bun | Workspaces, installation, scripts, tests, builds, and lockfile ownership |
| Repository commands | just | One root command surface for the polyglot workspace |

`rclmbt` is a synchronous Wasm state machine hosted by an asynchronous TypeScript Worker. Batched polling keeps browser scheduling outside Wasm and makes ownership, deadlines, and resource budgets visible.

`rclwebd` connects R2WP sessions to one ROS adapter support row per process. The adapter uses generic serialized operations so CDR stays on the main data path.

The [normative R2WP contract](../../protocol/r2wp-v0.md) owns byte-level behavior. [ADR 0009](../../docs/adr/0009-r2wp-v0-wire-encoding.md) records the encoding decision. Committed fixtures and the [agreement runner](../../protocol/testdata/agreement/README.md) keep TypeScript, Rust, and MoonBit aligned.

## Toolchain pins

| Tool | Pin source |
|---|---|
| Bun | `.bun-version` and `package.json` |
| Rust | `rust-toolchain.toml` and the Cargo workspace |
| MoonBit | `.moon-version` |
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
| `rclmbt/` | MoonBit workspace and Wasm runtime |
| `rclwebd/` | Cargo workspace and Rust gateway |
| `sdk/typescript/` | Bun workspace and browser SDK |
| `protocol/` | Normative contracts, registries, schemas, and fixtures |
| `conformance/`, `benchmarks/` | Qualification workloads and evidence |
| `deploy/` | Edge packaging and operations |
| `studio/` | U0 workspace added after M3 |

## ROS profile

Phase 1 qualifies Humble and Jazzy with Fast DDS, Cyclone DDS, and Zenoh (`rmw_zenoh_cpp`) as first-class RMW rows (H-FT, H-CY, H-ZN, J-FT, J-CY, J-ZN). Fast DDS remains the reference row per distro. Humble uses `moonspan-schema-v1` bundle identity. Jazzy uses `rep2011-rihs` type identity. Exact images, architectures, browser references, and qualification state live in the [support matrix](../../docs/support-matrix.md).

## Decision lifecycle

- Bun is a project constraint recorded by [ADR 0002](../../docs/adr/0002-use-bun-for-javascript-tooling.md).
- Mainline architecture decisions gain authority through ADR review and validation gates.
- Platform changes update the support matrix and conformance evidence.
- Studio technology choices receive their own review at U0 entry.

The Studio prototype is expected to use TypeScript, React, Workers, browser graphics, and WebCodecs. U0 reviews those choices against the released SDK before implementation.
