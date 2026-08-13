# Studio prototype

Studio is an optional post-release UI. It demonstrates the released TypeScript package through a reusable browser workspace for ROS operation, diagnosis, visualization, and replay. It is not part of the mainline delivery path.

## Entry

Studio starts after a human release review of the public package, ROS semantics, policy and audit contracts, compatibility tiers, and deployment guidance.

## Scope

Studio includes:

- a desktop workspace with graph, canvas, inspector, and timeline regions;
- graph exploration, search, schema, QoS, telemetry, and capability inspection;
- plot, raw data, diagnostics, log, 3D, TF, map, camera, Service, and Action panels;
- one subscription model for Live and Replay sources;
- versioned workspace layouts and sharing;
- command workflows driven by released policy capabilities;
- browser rendering, media, accessibility, and performance evidence.

Studio owns presentation, interaction, workspace state, panels, and visual behavior. R2WP, the `rclweb` core, `rclwebd`, the TypeScript package, policy schemas, and conformance suites remain product contracts.

## Interaction model

- Topic selection suggests compatible panels from type and schema data.
- A shared broker deduplicates package subscriptions and applies visibility budgets.
- Panels consume typed projections and report queue, decode, render, and media state.
- Live and Replay sources implement the same panel subscription interface.
- Publish, Service, Action, and Parameter operations show target, capability, typed preview, confirmation, audit identity, progress, and result.
- Workspace changes serialize through a versioned document with migration support.

## Browser execution

```text
Main thread
  layout, input, accessibility, workspace, commands
       |
       +-- rclweb package and core Worker
       +-- I/O Worker
       +-- render Worker
       +-- codec Worker
```

The main thread receives compact presentation state. Workers own ROS semantics, transport, rendering, and media processing under explicit resource budgets.

## Design and accessibility

The [prototype design system](../../.agents/docs/DESIGN.md) owns visual tokens, layout geometry, typography, motion, and component rules. Keyboard navigation, visible focus, stable reading order, reduced motion, semantic status, and command safety are part of prototype acceptance.
