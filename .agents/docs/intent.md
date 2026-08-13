# Project intent

rclweb gives browser applications typed, secure access to ROS 2 through a versioned protocol (R2WP), a single Rust core that runs natively at the edge and as Wasm in the browser, and a TypeScript package (`rcl-web`).

## What this is trying to be

A production edge + browser path: one Rust core ([ADR 0010](../../docs/adr/0010-restructure-single-rust-core.md)), R2WP over WebSocket and WebTransport, `rclwebd` as the trust boundary, and an rclcpp-shaped TypeScript API. Customer-facing docs are that API — [how to](../../docs/typescript.md) (`Node`, topics, services, actions) and the [reference](../../docs/api.md) — not the protocol or delivery ledger.

## Users

| User | Need |
|---|---|
| Robotics developer | Typed topics, operations, clocks, schemas, graph state, and QoS |
| Integration engineer | Reproducible conformance, diagnostics, and traceable failures |
| Robot operator | Scoped commands, clear capabilities, audit identity, and recovery |
| Fleet team | A controlled edge boundary across domains and network topologies |
| Application team | A stable package for purpose-built interfaces |

## Product contracts

- The `rclweb` core owns deterministic ROS state, protocol codecs, and CDR behavior — one codebase for gateway and browser.
- R2WP carries CDR and control data over bounded, observable transports.
- `rclwebd` owns ROS attachment, identity, policy, scheduling, schema, audit, and operations at the edge.
- Supported profiles carry conformance, performance, security, and deployment evidence.
- The TypeScript package `rcl-web` exposes an rclcpp-shaped public application contract (`init` / `Node`).
- The current package version is `0.0.3`. `0.0.1` on npm shipped TypeScript source; `0.0.2` was the first tsdown tarball. The npm tarball must include the repository `LICENSE` and `NOTICE`. `rclweb` and `rclwebd` are `0.0.2` on crates.io. Publish is GitHub OIDC ([release](../../docs/release.md), [ADR 0016](../../docs/adr/0016-oidc-trusted-publish.md)). Unscoped `rclweb` is blocked on npm as too similar to `rrweb`; the publish name is `rcl-web` ([ADR 0014](../../docs/adr/0014-typescript-package-rcl-web.md)).
- The repository is Apache-2.0; third-party crates on the published surface stay OSI-permissive ([licensing](../../docs/licensing.md)).

## Non-goals

- No JSON transcoding on the sample path; CDR stays end to end.
- No client library reinvention: the browser core is an R2WP protocol client with rcl-shaped semantics, and the gateway binds the serialized-only rcl surface (owner constraint in ADR 0010).
- Not a visual IDE. Studio is an optional post-release UI ([studio-ui](../../docs/prototypes/studio-ui.md)).
- Contracts harden after they carry traffic; platform expansion enters through the [support matrix](../../docs/support-matrix.md).
