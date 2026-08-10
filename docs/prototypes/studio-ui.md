# Common Studio prototype

The common Studio prototype is Moonspan's post-mainline UI side project. It demonstrates a reusable browser workspace for ROS 2 operation, diagnosis, visualization, development, and replay through the released TypeScript SDK.

**Working name:** R2 Studio. The working name carries prototype identity and leaves final product naming open.

## Entry gate

Prototype implementation starts after the M3 mainline release gate has approved:

- R2WP and public browser SDK versions;
- N1 and N2 conformance;
- session, graph, schema, QoS, command, telemetry, and recording APIs;
- identity, effective capability, audit, and resource-policy contracts;
- compatibility tiers, deployment guidance, and release artifacts;
- baseline latency, throughput, memory, reconnect, and fault evidence.

U0 owns prototype design execution, the integrated workspace, and product-style UI implementation after M3-08.

## Prototype outcome

The prototype delivers:

- a reusable desktop workspace shell;
- graph exploration and contextual inspection;
- dockable 3D, camera, plot, map, raw, TF, diagnostics, log, Service, and Action panels;
- a shared Live/Replay timeline over the SDK subscription model;
- safe command workflows using released policy capabilities;
- Worker-based rendering and media paths;
- accessibility, performance, and compatibility evidence;
- documented examples for application teams evaluating the SDK.

## Five-region workspace

1. **Top command bar, 56 px:** robot and domain identity, Live/Replay state, RTT, loss, clock skew, bandwidth, recording, and command palette.
2. **Graph Explorer, 248 px:** Robot → Namespace → Node → Topic/Service/Action hierarchy, search, type filters, QoS filters, rates, and selection state.
3. **Dockable canvas:** 3D, Camera, Map, Plot, Raw Inspector, TF, Diagnostics, Log, Service Console, and Action Console.
4. **Context Inspector, 292 px:** schema, RIHS hash, QoS, rate, latency, drops, queue, permissions, transport, decode, GPU, and rendering budgets.
5. **Timeline, 104 px:** live rolling buffer, MCAP replay, event markers, clock state, skew, playhead, loop, session comparison, and replay speed.

An 8 px base rhythm governs panel spacing, with 4 px increments for compact internal alignment. Desktop qualification starts at a 1208 × 748 px content frame and expands through the declared browser tier matrix.

## Core interactions

- Dragging a topic to the canvas recommends panels from its type and schema.
- The command palette handles navigation, subscription, panel creation, Service calls, Action goals, Parameter changes, and layout changes.
- Layouts serialize to a versioned workspace document and support URL or share-token exchange under policy.
- A global subscription broker deduplicates equivalent SDK subscriptions and fans out typed views.
- Visibility assigns representative 60, 30, or 10 Hz presentation budgets; background panels move to low-frequency sampling.
- Live and Replay sources implement one panel subscription interface.
- Publish, Service, Action, and Parameter mutations enter explicit command mode with capability, typed preview, confirmation behavior, audit identity, and terminal result.

## Panels

| Family | Inputs | Primary evidence |
|---|---|---|
| Graph Explorer | graph snapshots/deltas, types, QoS, liveliness | churn, search, keyboard tree behavior |
| Context Inspector | schema, policy, queue, telemetry | correctness, stable layout, effective capability |
| Plot and raw data | typed scalar/array projections | rate, sampling, retained-window memory |
| 3D, TF, map | PointCloud2, transforms, occupancy, markers | GPU upload, frame pacing, coordinate correctness |
| Camera | encoded H.264/AV1 chunks and metadata | keyframe recovery, decode latency, display timing |
| Diagnostics and log | diagnostic arrays, logs, trace identity | filtering, burst pressure, correlation |
| Service and Action consoles | typed request, goal, feedback, result | command safety, cancellation, audit |
| Timeline | live buffer and MCAP channels | source switching, clock mapping, seek, loop |

## Browser execution model

```text
React main thread
  layout, input, accessibility, workspace and command state
       |
       +-- SDK/rclmbt worker: ROS semantics, CDR, schemas, typed events
       +-- I/O worker: inherited SDK transport and buffer lifecycle
       +-- render worker: OffscreenCanvas + WebGPU/WebGL2
       +-- codec worker: WebCodecs and media preparation
```

The main thread receives compact presentation state. PointCloud2 views enter GPU staging; encoded camera chunks enter WebCodecs; scalar and control samples enter typed panel models. Buffer leases and presentation throttles remain visible in telemetry.

## Visual direction

The interface uses warm paper surfaces for workspace structure, near-black visualization canvases, restrained olive for live state and interaction, crisp separators, compact technical typography, and restrained depth. Semantic state pairs color with text, icons, metrics, or stable reasons.

The machine-readable tokens, component vocabulary, layout geometry, motion range, and accessibility rules live in the [prototype design system](../../.agents/docs/DESIGN.md).

## Accessibility and command behavior

- All workspace and tree operations support keyboard navigation and visible focus.
- Status meaning appears through text or icon alongside color.
- Reduced-motion preference produces immediate or shortened state transitions.
- Live updates preserve focus, selection, reading order, and stable geometry.
- Consequential commands display target, type, parameters, permission, confirmation behavior, audit identity, progress, and result.
- Screen-reader names cover panels, metrics, scene tools, tabs, timeline controls, and command actions.

## Prototype acceptance

- Graph, inspector, plot/raw, 3D/TF/map, camera, diagnostics/log, command, and timeline workflows pass end-to-end tests.
- A representative 12-panel workspace sustains at least 55 FPS with main-thread task p95 below 4 ms on the reference profile.
- PointCloud2 4 MiB at 10 Hz stays within browser and GPU budgets.
- Encoded 1080p60 video reaches glass-to-glass p95 at or below 150 ms on the qualified media profile.
- Startup, reconnect, Live/Replay switching, workspace sharing, and memory reports pass.
- Keyboard, focus, reduced-motion, contrast, and command-safety reviews pass.
- Browser rendering and media capability tiers are published with the prototype report.

## U0 implementation order

1. Freeze the prototype contract against the released SDK and enroll the design system.
2. Build the shell, five-region layout, subscription broker, and workspace document.
3. Add graph exploration, contextual inspection, scalar panels, diagnostics, and logs.
4. Add WebGPU/WebGL2 3D, TF, map, and PointCloud2 rendering.
5. Add WebCodecs camera behavior and keyframe recovery.
6. Add timeline, Live/Replay switching, command workflows, sharing, and accessibility.
7. Run performance, compatibility, accessibility, and safety qualification.
