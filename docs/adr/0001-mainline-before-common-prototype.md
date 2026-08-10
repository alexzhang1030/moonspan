# 0001: Complete the mainline before the common prototype

## Status

Accepted

## Date

2026-08-10

## Context

The initial prototype combined protocol, runtime, gateway, visualization, and workspace milestones. The project needs a reusable browser SDK and production edge boundary that application teams can consume independently.

The human owner classified UI design as a side project and placed the common prototype after mainline completion.

## Decision

Deliver R2WP, `rclmbt`, `rclwebd`, the browser SDK, N1/N2 conformance, security, compatibility, deployment, and release evidence through M0–M3. Start the common Studio prototype in U0 after M3-08 approves the mainline release.

## Rationale

- Protocol and SDK contracts derive from ROS semantics, compatibility, security, and measured data-path behavior.
- A released SDK gives the prototype stable application boundaries.
- A common prototype demonstrates reuse across robotics workflows after the platform release.

## Consequences

- M0–M3 implementation tasks use headless clients and conformance harnesses for browser validation.
- Every U0 task depends directly or transitively on M3-08.
- UI layout, panels, rendering, media, interaction, and accessibility belong to U0.
- The N3 package sandbox remains an independent post-release experiment.

## Revisit triggers

- The human owner changes the delivery sequence.
- Mainline qualification requires a narrowly scoped visual diagnostic that lacks a headless equivalent.
- Released SDK evidence exposes an application contract gap that requires a versioned mainline change.

## Source

Human direction recorded in the project conversation on 2026-08-10 and distilled into [product scope](../product-scope.md) and [project intent](../../.agents/docs/intent.md).
