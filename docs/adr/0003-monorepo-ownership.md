# 0003: Use one monorepo with explicit workspace ownership

## Status

Accepted

## Date

2026-08-10

## Context

Moonspan spans Rust, MoonBit, TypeScript, shared protocol contracts, conformance fixtures, deployment assets, and documentation. Multi-language work needs one coordinated delivery surface while keeping language-specific dependency graphs and release units independent.

## Decision

Use one monorepo for Rust, MoonBit, TypeScript, R2WP contracts and fixtures, conformance, deployment, and documentation.

- The repository root owns orchestration, version pins, and shared verification commands.
- Each language workspace owns its dependencies and internal package layout.
- Cross-language sharing uses versioned protocols, schemas, fixtures, generated-artifact manifests, and stable ABIs.
- Release units may version independently.
- Every cross-workspace dependency terminates at a versioned contract, schema, fixture, generated-artifact manifest, or stable ABI.

## Rationale

- One repository keeps M0–M3 contracts, fixtures, and evidence in lockstep with the code that implements them.
- Root-level orchestration provides clean-checkout commands.
- Each language toolchain keeps its own dependency graph.
- Versioned contracts and stable ABIs keep consumers explicit when ownership or release cadence differs.
- Independent release versioning lets SDK, gateway, protocol fixtures, and documentation ship on their own schedules after shared contract gates pass.

## Consequences

- M0-02 bootstraps root commands, workspace layout, and CI against this ownership model.
- Shared-contract changes update fixtures and require review from every consuming owner.
- Generated artifacts publish through versioned manifests with explicit consumer imports.
- Dependency resolution follows each ecosystem's workspace-level lock and pin conventions; M0-02 records the exact owned files.
- Conformance, deployment, and documentation live in-tree with the mainline delivery sequence.

## Revisit triggers

- A language workspace gains release, licensing, or security isolation requirements that favor a separate repository.
- Cross-workspace coupling escapes the declared contract, schema, fixture, manifest, or ABI boundaries.
- Root orchestration or shared verification cost exceeds the coordination benefit for M0–M3 delivery.

## Source

Architecture ownership and dependency order in [architecture](../architecture.md) and [architecture rationale](../../.agents/docs/architecture.md). Stack and repository tooling in [technology stack rationale](../../.agents/docs/technology-stack.md). Delivery sequence in [implementation plan](../../tasks/plan.md).
