# Project context map

PCR records preserve the durable reasoning that contributors need across tasks. Formal requirements live under [`docs/`](../../docs/README.md). These records remain open to evidence-backed updates.

rclweb is one Rust core (`rclweb`) serving the gateway natively and the browser as Wasm, a TypeScript SDK, and R2WP over WebSocket and WebTransport ([ADR 0010](../../docs/adr/0010-restructure-single-rust-core.md), [architecture](../../docs/architecture.md)).

## Context records

| Topic | Record |
|---|---|
| Product direction and phase boundary | [Intent](./intent.md) |
| System boundaries and the single-core decision | [Architecture](./architecture.md) |
| Languages, platforms, transport, and tooling | [Technology stack](./technology-stack.md) |
| Rust workspace (fmt, clippy, lints, just recipes) | [Technology stack — Rust workspace infrastructure](./technology-stack.md#rust-workspace-infrastructure) |
| Traps already paid for | [Gotchas](./gotchas.md) |
| Evidence, single oracle, and gate authority | [Validation](./validation.md) |
| Support matrix vs live gates | [Validation](./validation.md#evidence-contract), [R4-03](../../docs/milestones/r4-03-support-matrix.md) |
| Browser SDK public surface | [SDK](../../docs/sdk.md), [R4-04](../../docs/milestones/r4-04-sdk.md) |
| Studio visual system | [DESIGN.md](./DESIGN.md) |

## Project records

| Need | Read |
|---|---|
| Formal documentation | [Documentation index](../../docs/README.md) |
| Architecture decisions | [ADR register](../../docs/adr/README.md) |
| Humble scheme / corpus / ROS package names | [ADR 0012](../../docs/adr/0012-rclweb-schema-identifiers.md), [gotchas](./gotchas.md#bundle-files-are-named-by-type) |
| Local WebTransport TLS (cert-hash, 14-day rotate) | [ADR 0011](../../docs/adr/0011-local-dev-webtransport-tls.md) |
| J-FT runtime image and operations endpoints | [Deploy](../../docs/deploy.md), [R4-02](../../docs/milestones/r4-02-deployment-observability.md) |
| Support-matrix status | [R4-03](../../docs/milestones/r4-03-support-matrix.md) |
| SDK public surface | [SDK](../../docs/sdk.md), [R4-04](../../docs/milestones/r4-04-sdk.md) |
| Delivery sequence | [Implementation plan](../../tasks/plan.md) |
| Current execution state | [Execution checklist](../../tasks/todo.md) |

## Code routes

| Area | Context |
|---|---|
| `protocol/**` | [Architecture](./architecture.md), [R2WP](../../docs/protocol/r2wp.md), [normative subset](../../protocol/r2wp-v0.md#normative-scope-v01-subset), [R2-03 fixtures + fuzz](../../docs/milestones/r2-03-fixtures-fuzzing.md), [R3-01 re-freeze](../../docs/milestones/r3-01-services-actions-graph.md) |
| `rclweb/**` | [Architecture](./architecture.md), [technology stack](./technology-stack.md), [`rclweb` core](../../docs/runtime/core.md), [CDR contract](../../docs/runtime/cdr.md), [R1-02 session SM](../../docs/milestones/r1-02-session-channel-state.md), [R1-04 poll ABI](../../docs/milestones/r1-04-wasm-host-sdk.md), [R2-01 publish/QoS](../../docs/milestones/r2-01-data-plane-hardening.md), [R2-02 large-message / PointCloud2](../../docs/milestones/r2-02-large-message-path.md), [R2-03 fixtures + fuzz smoke](../../docs/milestones/r2-03-fixtures-fuzzing.md), [R3-01 services/actions/graph](../../docs/milestones/r3-01-services-actions-graph.md), [R3-02 generated types + registry](../../docs/milestones/r3-02-generated-types.md), [R3-03 H-FT OpenChannel](../../docs/milestones/r3-03-h-ft-webtransport.md), [generated-types contract](../../docs/runtime/generated-types.md) (`rclweb/src/types/`, embedded `rclweb/generated/metadata/`) |
| `rclweb/generated/metadata/**`, `scripts/generated-types.ts` | [R3-02](../../docs/milestones/r3-02-generated-types.md); Bun generator + committed descriptors/identities/wire-profiles/provenance; sectioned-root join gotcha in [gotchas](./gotchas.md#sectioned-corpus-roots-are-graph-endpoints-without-source-rows) |
| `rclwebd/**` | [Architecture](./architecture.md), [`rclwebd`](../../docs/gateway/rclwebd.md), [R1-03 WS + rcl](../../docs/milestones/r1-03-gateway-ws-rcl.md), [R2-01 budgets/dispositions](../../docs/milestones/r2-01-data-plane-hardening.md), [R3-01 graph/service/action](../../docs/milestones/r3-01-services-actions-graph.md), [R3-03 H-FT + WebTransport](../../docs/milestones/r3-03-h-ft-webtransport.md), [R3-04 adapter ABI + dlopen typesupport](../../docs/milestones/r3-04-adapter-abi-typesupport.md), [R4-01 auth](../../docs/milestones/r4-01-oidc-sros2-audit.md), [R4-02 ops + image](../../docs/milestones/r4-02-deployment-observability.md), [ADR 0011](../../docs/adr/0011-local-dev-webtransport-tls.md), [security](../../docs/security.md), [deploy](../../docs/deploy.md) |
| `rclwebd/src/local_dev_tls.rs`, `wt.rs` | [ADR 0011](../../docs/adr/0011-local-dev-webtransport-tls.md), [R3-03 WT](../../docs/milestones/r3-03-h-ft-webtransport.md#outcome-webtransport), [gotchas](./gotchas.md#webtransport-local-certs-are-14-days-by-browser-rule) |
| `rclwebd/src/config.rs` (`SupportRow`) | [ADR 0008](../../docs/adr/0008-one-adapter-row-per-gateway-process.md), [R3-03 H-FT](../../docs/milestones/r3-03-h-ft-webtransport.md), [gotchas](./gotchas.md#one-gateway-process-binds-one-support-row) |
| `docker/compose.r3-03-h-ft-e2e.yml` | [R3-03 H-FT live Humble talker e2e](../../docs/milestones/r3-03-h-ft-webtransport.md) (CI `e2e-ros-talker-h-ft`; regenerates FFI in-image) |
| `rclwebd/src/ros/**` | Vendored bindings + `ros` feature gating + dlopen typesupport: [technology stack](./technology-stack.md), [R1-03 notes](../../docs/milestones/r1-03-gateway-ws-rcl.md#behavioral-notes), [R3-04](../../docs/milestones/r3-04-adapter-abi-typesupport.md) |
| `rclwebd/src/ros/backend.rs` (`call_with_pump` / `send_goal_result_with_pump`) | Same-thread client+server loopback must pump the matching server or the call hangs ([gotchas](./gotchas.md#same-thread-ros-loopback-must-pump)) |
| `rclwebd/src/ros/rcl.rs` (`wait_and_take_*_response`) | Action wait-set `client_index` is the start of three clients; take the specific response ([gotchas](./gotchas.md#action-client-wait-set-ready-is-not-the-first-client-slot)) |
| `rclwebd/src/auth.rs`, Authenticate in `connection.rs` | [R4-01](../../docs/milestones/r4-01-oidc-sros2-audit.md); default `off` leaves SessionReady `anonymous` ([gotchas](./gotchas.md#authenticate-defaults-to-off)) |
| `rclwebd/src/ops.rs`, `/livez` `/readyz` `/drain` `/metrics` | [R4-02](../../docs/milestones/r4-02-deployment-observability.md); `/healthz` is liveness ([gotchas](./gotchas.md#healthz-is-liveness-not-readiness)); tests use `serve` without ctrl_c ([gotchas](./gotchas.md#gateway-tests-must-not-install-ctrlc-on-serve)) |
| `docker/Dockerfile.rclwebd`, `docker/compose.r4-02-gateway.yml` | J-FT runtime image + host-network compose ([deploy](../../docs/deploy.md)) |
| `docker/Dockerfile.rclwebd-h-ft`, `docker/compose.r4-02-gateway-h-ft.yml` | H-FT runtime image (regenerates FFI) + host-network compose ([deploy](../../docs/deploy.md)) |
| `rclwebd/src/adapter/**`, `rclwebd/adapter/include/**` | Versioned serialized adapter ABI v1 ([ADR 0006](../../docs/adr/0006-edge-ros-c-abi-boundary.md), [R3-04](../../docs/milestones/r3-04-adapter-abi-typesupport.md)) |
| `sdk/**` | [SDK](../../docs/sdk.md), [intent](./intent.md), [architecture](../../docs/architecture.md), [R1-04 SDK host](../../docs/milestones/r1-04-wasm-host-sdk.md), [R1-05 e2e](../../docs/milestones/r1-05-e2e-evidence.md), [R2-01 publish/reconnect](../../docs/milestones/r2-01-data-plane-hardening.md), [R2-02 buffer strategies + large batch](../../docs/milestones/r2-02-large-message-path.md), [R2-04 perf baseline](../../docs/milestones/r2-04-perf-baseline.md), [R3-01 service/action/graph/parameters](../../docs/milestones/r3-01-services-actions-graph.md), [R3-03 WT ConnectOptions](../../docs/milestones/r3-03-h-ft-webtransport.md#outcome-webtransport), [R4-04 public vs internal](../../docs/milestones/r4-04-sdk.md) |
| `sdk/typescript/src/index.ts`, `internal.ts` | Public application contract vs host/ABI/test helpers ([SDK](../../docs/sdk.md#public-vs-internal)) |
| `examples/**` | [SDK](../../docs/sdk.md), [examples README](../../examples/README.md), [R1-05 e2e + demo](../../docs/milestones/r1-05-e2e-evidence.md), [R4-04](../../docs/milestones/r4-04-sdk.md) |
| `docker/**` | [R1-05 compose lane](../../docs/milestones/r1-05-e2e-evidence.md), [R2-04 live perf compose](../../docs/milestones/r2-04-perf-baseline.md), [R3-03 H-FT live Humble](../../docs/milestones/r3-03-h-ft-webtransport.md), [R4-02 J-FT / H-FT runtime images](../../docs/milestones/r4-02-deployment-observability.md), digest-pinned `oven/bun` ([gotchas](./gotchas.md#github-releases-downloads-need-retries)) |
| `.github/workflows/ci.yml` | Foundation: `setup-bun` / `setup-just` (one retry) / `rust-toolchain`; e2e images copy Bun from `oven/bun` ([gotchas](./gotchas.md#github-releases-downloads-need-retries)); do not wrap cargo tests in Docker ([gotchas](./gotchas.md#do-not-wrap-cargo-tests-in-a-docker-mock-lane)) |
| `scripts/cloud-agent-install.sh`, `scripts/install-pinned-bun.sh`, `scripts/github-release-curl.sh` | Non-Actions toolchain install (cloud-agent VM) ([gotchas](./gotchas.md#github-releases-downloads-need-retries)) |
| `pixi.toml`, `just ros-test-pixi` | Optional RoboStack J-FT for local `ros-test`; not a pin and not CI evidence ([technology stack](./technology-stack.md#optional-local-ros-prefix), [gotchas](./gotchas.md#pixi-ros-test-must-pin-rosprefix-over-a-host-optros)) |
| `rustfmt.toml`, `clippy.toml`, root `Cargo.toml` `[workspace.lints]` / `[workspace.dependencies]` | [Rust workspace infrastructure](./technology-stack.md#rust-workspace-infrastructure) |
| `justfile` (`fmt`, `clippy`, `lint-rust`, `doctor`, `setup`) | Same; `just check` remains the foundation gate. No git-hook installer |
| `scripts/build-wasm.ts`, `sdk/typescript/wasm/rclweb.wasm` | Fat-LTO wasm ship; `release-wasm` inherits native release ([gotchas](./gotchas.md#release-wasm-inherits-native-release-settings)) |
| SDK I/O Worker URL | Source `.ts` vs bundle `.js` ([gotchas](./gotchas.md#sdk-worker-url-follows-the-script-extension)) |
| `scripts/perf-baseline/**`, `scripts/measure-perf-baseline.ts` | [R2-04 Foxglove/rosbridge baseline](../../docs/milestones/r2-04-perf-baseline.md) |
| Support matrix / qualification | Human matrix edit; no committed measurement JSON ([R4-03](../../docs/milestones/r4-03-support-matrix.md), [gotchas](./gotchas.md#do-not-commit-measurement-json)) |
| `conformance/**` | [Validation](./validation.md), [corpus README](../../conformance/cdr/README.md), [support matrix](../../docs/support-matrix.md) |
| `studio/` (reserved until U0; not in the tree) | [Prototype scope](../../docs/prototypes/studio-ui.md), [DESIGN.md](./DESIGN.md), [ADR 0003](../../docs/adr/0003-monorepo-ownership.md) |

## Design record check

```bash
bunx @google/design.md lint .agents/docs/DESIGN.md
```

Studio adds this check to the root command surface at U0.
