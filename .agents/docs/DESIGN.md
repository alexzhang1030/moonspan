---
version: alpha
name: R2 Studio Common Prototype
description: Post-mainline common robotics prototype with warm paper surfaces, dark visualization canvases, and restrained olive interaction color.
colors:
  primary: "#7E9028"
  primary-bright: "#B7CA4B"
  primary-container: "#EDF0D8"
  page: "#DFDDD5"
  shell: "#F3F1EA"
  surface: "#FBFAF5"
  surface-raised: "#FFFEFA"
  ink: "#1B1C18"
  muted: "#77746B"
  soft: "#9B978D"
  line: "#D5D2C7"
  line-strong: "#B7B2A7"
  canvas: "#1D201C"
  canvas-raised: "#252923"
  canvas-strong: "#30352D"
  canvas-line: "#3B4038"
  canvas-copy: "#C9CEC2"
  info: "#66AABD"
  warning: "#D29B46"
  danger: "#BC6658"
typography:
  app-body:
    fontFamily: "PingFang SC, Inter, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
  section-title:
    fontFamily: "PingFang SC, Inter, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: -0.01em
  panel-title:
    fontFamily: "PingFang SC, Inter, Noto Sans CJK SC, system-ui, sans-serif"
    fontSize: 10px
    fontWeight: 650
    lineHeight: 1.3
  technical-label:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: 8px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: 0.05em
  metric:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: 9px
    fontWeight: 650
    lineHeight: 1.4
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
components:
  app-page:
    backgroundColor: "{colors.page}"
    textColor: "{colors.ink}"
  app-shell:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "{spacing.lg}"
  primary-button:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface-raised}"
    rounded: "{rounded.md}"
    height: 32px
    padding: 12px
  selected-row:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: 31px
    padding: 8px
  metric-chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.metric}"
    rounded: "{rounded.full}"
    height: 28px
    padding: 9px
  secondary-copy:
    textColor: "{colors.muted}"
    typography: "{typography.technical-label}"
  soft-indicator:
    backgroundColor: "{colors.soft}"
    size: 6px
  divider:
    backgroundColor: "{colors.line}"
    height: 1px
  divider-strong:
    backgroundColor: "{colors.line-strong}"
    height: 1px
  visualization-panel:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.canvas-copy}"
    rounded: "{rounded.lg}"
    padding: 8px
  visualization-header:
    backgroundColor: "{colors.canvas-raised}"
    textColor: "{colors.canvas-copy}"
    height: 36px
  visualization-toolbar:
    backgroundColor: "{colors.canvas-strong}"
    textColor: "{colors.primary-bright}"
    rounded: "{rounded.md}"
  visualization-divider:
    backgroundColor: "{colors.canvas-line}"
    height: 1px
  info-indicator:
    backgroundColor: "{colors.info}"
    size: 6px
  warning-indicator:
    backgroundColor: "{colors.warning}"
    size: 6px
  danger-indicator:
    backgroundColor: "{colors.danger}"
    size: 6px
---
# Common Studio prototype design system

## Overview

The common Studio prototype should feel like a precise robotics instrument housed in a calm industrial workspace. Warm paper surfaces support long sessions and dense inspection; near-black canvases concentrate attention on spatial, camera, and plot data; restrained olive marks live state, selection, and interaction.

This visual system belongs to the post-mainline UI side project. The prototype begins after the M3 release gate and consumes the released browser SDK, policy capability schema, telemetry, and recording contracts. Its [formal prototype scope](../../docs/prototypes/studio-ui.md) defines features, entry criteria, execution order, and acceptance.

The interface serves operators and engineers who scan telemetry, compare state, and issue consequential commands. Its visual hierarchy favors clarity, compactness, stable geometry, and visible system status. This unstamped record owns the reusable visual tokens and rationale.

## Colors

- **Warm foundation:** `page`, `shell`, `surface`, and `surface-raised` build quiet tonal layers around controls and metadata.
- **Ink hierarchy:** `ink`, `muted`, and `soft` distinguish primary content, supporting labels, and tertiary metadata.
- **Visualization field:** `canvas`, `canvas-raised`, `canvas-strong`, `canvas-line`, and `canvas-copy` create a focused technical stage.
- **Olive interaction:** `primary`, `primary-bright`, and `primary-container` carry selection, focus, live state, and active visualization layers.
- **Semantic state:** `info`, `warning`, and `danger` communicate category alongside text, icons, or metrics.
- **Structure:** `line` and `line-strong` separate dense regions through crisp geometry.

## Typography

The application uses a compact system sans stack for navigation, controls, panel headings, and explanatory copy. Chinese and Latin content share one stable hierarchy through PingFang SC, Inter, Noto Sans CJK SC, and system fallbacks.

Monospace typography carries ROS names, types, hashes, timestamps, rates, latency, QoS, queue values, and other machine data. Technical labels use small sizes, deliberate tracking, and short line lengths. Panel titles stay compact and visually close to their live metrics.

## Layout

The desktop workspace has five stable regions:

1. A 56px command bar for robot identity, domain, Live/Replay state, network metrics, and recording.
2. A 248px graph explorer for the ROS hierarchy and search.
3. A flexible dockable canvas for 3D, camera, plot, diagnostics, and command panels.
4. A 292px context inspector for schema, QoS, performance, permissions, and rendering budgets.
5. A 104px timeline shared by live buffering and replay.

An 8px base rhythm governs panel gaps and common spacing. Four-pixel steps handle compact internal alignment. Dense surfaces use borders and tonal contrast to group information. Workspace content scales within a desktop frame while sidebars and the timeline preserve stable operational landmarks.

## Elevation & Depth

Hierarchy comes primarily from tonal layers, borders, and dark visualization fields. The outer application shell carries the strongest shadow because it represents the desktop object. Inner panels use crisp borders and a minimal local shadow. Visualization panels read as recessed instruments through dark surfaces and subtle header contrast.

## Shapes

The shape language is compact and engineered with restrained softness:

- 4px radius for HUD labels and small technical surfaces.
- 6px radius for controls, inputs, and compact buttons.
- 8px radius for panels and larger grouped surfaces.
- 12px radius for the outer application shell.
- Full-radius pills for status, metrics, QoS, and live badges.

Interactive state uses 120–180 ms transitions. Pressed controls use a small scale response. Reduced-motion preference shortens transitions to an effectively immediate state change.

## Components

- **Graph rows:** compact hierarchy, clear indentation, kind markers, trailing rate, and one olive-tinted selected state.
- **Visualization panels:** dark canvas, compact header, topic/frame context, live rate or FPS, and colocated scene tools.
- **Inspector sections:** selected entity summary, three-column key metrics, property rows, and visible time/resource budgets.
- **Command controls:** explicit action label, permission context, parameter preview, and audit identity for consequential operations.
- **Status chips:** concise metric label plus value; state meaning also appears in text or icon form.
- **Timeline:** stable time source, skew, rolling-buffer state, event markers, playhead, and replay speed.
- **Focus:** a 2px olive focus ring with a 2px offset remains visible across light and dark surfaces.

## Do's and Don'ts

- Use warm surfaces for application structure and dark canvases for sensor visualization.
- Reserve olive for focus, selection, live state, and the most relevant plotted or spatial layer.
- Pair semantic color with a label, icon, metric, or reason.
- Keep ROS identifiers, timestamps, rates, hashes, and QoS values in monospace typography.
- Keep layouts dense, aligned, and stable during live updates.
- Preserve keyboard navigation, visible focus, reduced motion, and readable contrast in every component state.
- Give command actions explicit intent, permission, preview, and audit context.
- Use motion to confirm state transitions within the 120–180 ms interaction window.
