# 0010: Restructure on a single Rust core

## Status

Accepted

## Date

2026-08-12

## Context

At baseline commit `d6dd478` (tag `pre-restructure`) the project carried three R2WP implementations (TypeScript, Rust, MoonBit), a three-language agreement apparatus, fixture generators larger than the implementations they exercised, six first-class support rows, and an evidence harness with no real reports — while no end-to-end data path existed. An architecture audit found the cost structural: the MoonBit browser runtime could not share code with the mandatory-native Rust gateway, so every shared contract required multiple implementations plus permanent cross-implementation verification.

MoonBit had been chosen for Wasm convenience. The accepted counter-argument: the ADR 0004 poll boundary is a narrow buffer interface where Wasm authoring ergonomics matter least, while the gateway/browser split is where duplication costs compound.

## Decision

- One Rust crate (`rclweb`) owns R2WP parsing, CDR codecs, and session/channel state. It compiles natively into the gateway (`rclwebd`) and to `wasm32-unknown-unknown` for the browser.
- The MoonBit stack, the TypeScript protocol implementation, the three-language agreement apparatus, and the oversized fixture generators are removed. Fixtures are the single conformance oracle, consumed directly by the core's test suite.
- Wire version 0 keeps a declared normative subset (v0.1) covering what the walking skeleton exercises; the remaining sections are parked until their phases re-freeze them.
- Phase 1 gates one support row (J-FT); all six rows of corpus data stay committed.
- The project is renamed rclweb (`rcl<target>` convention, target = the web platform). The gateway keeps `rclwebd`; the SDK publishes as `@rclweb/sdk`.
- Owner constraint: the project neither reinvents an rclrs nor depends on a third-party rcl binding. The browser core is an R2WP protocol client, not an rcl binding; the gateway attaches through a narrow serialized-only rcl FFI surface (ADR 0006 direction).
- Frozen wire and corpus identifiers (`moonspan-schema-v1`, `moonspan-ros-cdr-v1`, conformance ROS package names) keep their historical names; committed hashes depend on them.

## Rationale

- One codebase for both sides of the wire removes the N-implementation tax and the agreement apparatus by construction.
- The ADR 0004 host boundary is unchanged; Rust/wasm-bindgen implements the same synchronous state machine behind an async TypeScript Worker host.
- R2-phase hardening (fuzzing, performance evidence, zero-copy borrowed views) lands on mature Rust tooling.
- A walking skeleton before breadth ensures contracts harden against carried traffic, not speculation.

## Consequences

- The R-phase plan in [tasks/plan.md](../../tasks/plan.md) replaces the M-phase plan.
- The CDR contract, the ROS CDR corpus, tail-slack evidence, and the frozen generated-types contract survive as the oracle the Rust port must pass (R1).
- The evidence harness does not return as a CI job in R4. Do not commit measurement JSON; promotion to Qualified is a human edit of the support matrix.
- ADRs 0001–0009 remain historical records; where they name MoonBit as the runtime language, this ADR supersedes that choice while preserving their boundaries (0004 host boundary, 0006 C ABI direction, 0007 schema identity).

## Revisit triggers

- R1 evidence shows the Rust wasm artifact size or poll latency is unacceptable for a required deployment profile (the sole R-D1 reopen condition).
- The serialized-only rcl FFI surface proves insufficient for gateway semantics that a support row requires.

## Source

Owner rulings R-D1 and R-D4 (2026-08-12) and standing recommendations R-D2/R-D3.
