# Common Studio prototype

Studio is rclweb's post-mainline UI side project. It demonstrates the released TypeScript SDK through a reusable browser workspace for ROS operation, diagnosis, visualization, and replay.

## Entry gate

U0 begins after M3 approves the public SDK, ROS semantics, policy and audit contracts, compatibility tiers, deployment guidance, and release evidence.

## Prototype scope

Studio includes:

- a desktop workspace with graph, canvas, inspector, and timeline regions;
- graph exploration, search, schema, QoS, telemetry, and capability inspection;
- plot, raw data, diagnostics, log, 3D, TF, map, camera, Service, and Action panels;
- one subscription model for Live and Replay sources;
- versioned workspace layouts and sharing;
- command workflows driven by released policy capabilities;
- browser rendering, media, accessibility, and performance evidence.

Studio owns presentation, interaction, workspace state, panels, and visual behavior. R2WP, the `rclweb` core, `rclwebd`, the SDK, policy schemas, and conformance suites remain mainline contracts.

## Interaction model

- Topic selection suggests compatible panels from type and schema data.
- A shared broker deduplicates SDK subscriptions and applies visibility budgets.
- Panels consume typed SDK projections and report queue, decode, render, and media state.
- Live and Replay sources implement the same panel subscription interface.
- Publish, Service, Action, and Parameter operations show target, capability, typed preview, confirmation, audit identity, progress, and result.
- Workspace changes serialize through a versioned document with migration support.

## Browser execution

```text
Main thread
  layout, input, accessibility, workspace, commands
       |
       +-- SDK and rclweb core Worker
       +-- I/O Worker
       +-- render Worker
       +-- codec Worker
```

The main thread receives compact presentation state. Workers own ROS semantics, transport, rendering, and media processing under explicit resource budgets.

## Design and accessibility

The [prototype design system](../../.agents/docs/DESIGN.md) owns visual tokens, layout geometry, typography, motion, and component rules. Keyboard navigation, visible focus, stable reading order, reduced motion, semantic status, and command safety are part of U0 acceptance.

## U0 sequence

1. Review the released SDK and accept the frontend decisions.
2. Build the shell, workspace state, and subscription broker.
3. Add graph, inspection, scalar, diagnostic, and log workflows.
4. Add rendering and media paths.
5. Add timeline, replay, commands, sharing, and accessibility.
6. Qualify and publish the prototype with its evidence.
