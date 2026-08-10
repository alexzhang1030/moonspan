# Moonspan documentation

This directory is the authoritative technical documentation for Moonspan. The mainline delivers a browser-native ROS 2 runtime, protocol, edge gateway, SDK, conformance evidence, security controls, and a releasable deployment. The common Studio prototype begins after the mainline release gate and consumes the released contracts.

The scope ordering and Bun choice record human direction from 2026-08-10. Other technical selections remain design baselines until their named validation gates produce evidence and review.

## Delivery order

1. Define contracts, fixtures, support profiles, and repository tooling.
2. Deliver R2WP, `rclmbt`, `rclwebd`, and the browser SDK data path.
3. Complete ROS 2 semantics, type handling, recording, and topology support.
4. Qualify identity, policy, compatibility, operations, and release artifacts.
5. Build the common Studio prototype on the released SDK.

## Document map

| Question | Authoritative document |
|---|---|
| Product purpose, users, mainline, sequencing | [Product scope](./product-scope.md) |
| System shape, ownership, data paths, invariants | [Architecture](./architecture.md) |
| Existing bridges and project roles | [Landscape](./landscape.md) |
| Accepted architecture decisions | [ADR register](./adr/README.md) |
| Technical reference set | [References](./references.md) |
| R2WP overview and design entry | [R2WP](./protocol/r2wp.md) |
| R2WP wire version 0 normative contract | [protocol/r2wp-v0.md](../protocol/r2wp-v0.md), [registry](../protocol/registry/r2wp-v0.json), [control CDDL](../protocol/schema/control-v0.cddl), [ADR 0009](./adr/0009-r2wp-v0-wire-encoding.md) |
| MoonBit/Wasm runtime, schemas, host ABI | [`rclmbt`](./runtime/rclmbt.md) |
| Gateway, ROS adapter, scheduling, operations | [`rclwebd`](./gateway/rclwebd.md) |
| Identity, policy, audit, resource controls | [Security](./security.md) |
| ROS, RMW, transport, browser, recording tiers | [Compatibility](./compatibility.md) |
| Exact first-stage pins, digests, and row status | [Support matrix](./support-matrix.md) |
| Evidence contract, benchmarks, gates, targets | [Validation](./validation.md) |
| Post-mainline UI concept and entry criteria | [Common Studio prototype](./prototypes/studio-ui.md) |
| Visual tokens and interface rules | [Prototype design system](../.agents/docs/DESIGN.md) |
| Delivery dependencies, kickoff decisions, and task acceptance | [Implementation plan](../tasks/plan.md) |
| Current execution state | [Execution checklist](../tasks/todo.md) |

## Workspace routes

| Area | Read first |
|---|---|
| Root pins, `justfile`, lockfiles | [technology stack rationale](../.agents/docs/technology-stack.md), [ADR 0002](./adr/0002-use-bun-for-javascript-tooling.md), [ADR 0003](./adr/0003-monorepo-ownership.md), repository [README](../README.md) |
| `protocol/**` | [R2WP overview](./protocol/r2wp.md), [R2WP v0 normative](../protocol/r2wp-v0.md), [compatibility](./compatibility.md), [validation](./validation.md) |
| `rclmbt/**` | [`rclmbt`](./runtime/rclmbt.md), [architecture](./architecture.md), [validation](./validation.md) |
| `rclwebd/**` | [`rclwebd`](./gateway/rclwebd.md), [security](./security.md), [compatibility](./compatibility.md) |
| `sdk/**` | [architecture](./architecture.md), [R2WP](./protocol/r2wp.md), [`rclmbt`](./runtime/rclmbt.md) |
| `conformance/**`, `benchmarks/**` | [validation](./validation.md), [support matrix](./support-matrix.md), [landscape](./landscape.md) |
| `deploy/**` | [security](./security.md), [support matrix](./support-matrix.md), [compatibility](./compatibility.md), [`rclwebd`](./gateway/rclwebd.md) |
| `studio/**` (U0 after M3) | [common Studio prototype](./prototypes/studio-ui.md), [prototype design system](../.agents/docs/DESIGN.md) |

## Change discipline

- Shared contract changes update their normative document, machine-readable fixtures, and every consuming implementation in one review unit.
- Measured claims link to reproducible evidence carrying environment, commands, raw data, and revision identity.
- Accepted human decisions live in the [ADR register](./adr/README.md); the [kickoff decision register](../tasks/plan.md#13-kickoff-decision-register) owns accountable role, required evidence, and decision deadline for remaining kickoff choices.
- The PCR map under [`.agents/docs/`](../.agents/docs/README.md) records durable rationale and routes contributors to these specifications.
- Run `bun run check` (alias of `docs:check`) to validate local Markdown links and images, heading anchors, AGENTS.md PCR markers, and formal enrollment from this map and the PCR map.
- Run `bun run toolchain-check` to probe installed tool identities against project pins.
- Run `just check`, `just test`, and `just build` for the full polyglot root command surface once pinned Bun, Rust, MoonBit, and just are on `PATH` (see repository [README](../README.md)).
