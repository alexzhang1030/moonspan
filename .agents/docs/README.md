# Project context map

PCR records preserve the durable reasoning that contributors need across tasks. Formal requirements live under [`docs/`](../../docs/README.md). These records remain open to evidence-backed updates.

rclweb is one Rust core (`rclweb`) serving the gateway natively and the browser as Wasm, a TypeScript package (`rcl-web` at `typescript/`), and R2WP over WebSocket and WebTransport ([ADR 0010](../../docs/adr/0010-restructure-single-rust-core.md), [ADR 0014](../../docs/adr/0014-typescript-package-rcl-web.md), [architecture](../../docs/architecture.md)).

Documentation describes the product. It is not a delivery-phase ledger. Historical task IDs (M0, R1, U0, and the rest) stay in git and in ADR Decision text.

## Context records

| Topic | Record |
|---|---|
| Product direction | [Intent](./intent.md) |
| System boundaries and the single-core decision | [Architecture](./architecture.md) |
| Sample path versus Foxglove / rosbridge | [Performance](../../docs/performance.md) |
| Languages, platforms, transport, and tooling | [Technology stack](./technology-stack.md) |
| Rust workspace (fmt, clippy, lints, just recipes) | [Technology stack — Rust workspace infrastructure](./technology-stack.md#rust-workspace-infrastructure) |
| Traps already paid for | [Gotchas](./gotchas.md) |
| Evidence and gate authority | [Validation](./validation.md) |
| TypeScript package | [How to](../../docs/typescript.md), [API reference](../../docs/api.md), [ADR 0014](../../docs/adr/0014-typescript-package-rcl-web.md), [ADR 0015](../../docs/adr/0015-tsdown-ship-bundle.md) |
| Publish | [Release](../../docs/release.md), [ADR 0016](../../docs/adr/0016-oidc-trusted-publish.md) |
| License | [Licensing](../../docs/licensing.md) |
| Studio visual system | [DESIGN.md](./DESIGN.md) |

## Project records

| Need | Read |
|---|---|
| Formal documentation | [Documentation index](../../docs/README.md) (customer API first, internals second) |
| Architecture decisions | [ADR register](../../docs/adr/README.md) |
| Humble scheme / corpus / ROS package names | [ADR 0012](../../docs/adr/0012-rclweb-schema-identifiers.md), [gotchas](./gotchas.md#bundle-files-are-named-by-type) |
| Local WebTransport TLS | [ADR 0011](../../docs/adr/0011-local-dev-webtransport-tls.md) |
| Runtime images and operations endpoints | [Deploy](../../docs/deploy.md) |
| Support-matrix status | [Support matrix](../../docs/support-matrix.md) |
| Open work | [Open work](../../tasks/plan.md), [checklist](../../tasks/todo.md) |

## Code routes

| Area | Context |
|---|---|
| `rclweb/src/protocol/frame.rs` | Do not `FrameOptions::default()` before `unwrap_or` ([gotchas](./gotchas.md#parseframe-must-not-build-default-frameoptions-on-the-sample-path)). Prefix ingest is `parse_frame_declared` ([ADR 0017](../../docs/adr/0017-host-retain-inbound-sample-payload.md)) |
| `typescript/src/wasm/abi.ts` `hostRetainPrefixLen` | Peek R2WP opcode/ext only; idle-queue ROS_SAMPLE skips poll ([gotchas](./gotchas.md#hostretainprefixlen-peeks-the-r2wp-header-only)) |
| `typescript/src/cdr-le.ts` | Host-retain String / PointCloud2 decode; `data` is a view of the WS buffer ([ADR 0017](../../docs/adr/0017-host-retain-inbound-sample-payload.md)) |
| `rclweb/**` | [Architecture](./architecture.md), [technology stack](./technology-stack.md), [`rclweb` core](../../docs/runtime/core.md), [CDR](../../docs/runtime/cdr.md), [generated types](../../docs/runtime/generated-types.md). crates.io publish ([release](../../docs/release.md)) |
| `rclweb/generated/metadata/**`, `scripts/generated-types.ts` | [generated types](../../docs/runtime/generated-types.md); sectioned-root join gotcha in [gotchas](./gotchas.md#sectioned-corpus-roots-are-graph-endpoints-without-source-rows) |
| `rclwebd/**` | [Architecture](./architecture.md), [`rclwebd`](../../docs/gateway/rclwebd.md), [security](../../docs/security.md), [deploy](../../docs/deploy.md), [ADR 0011](../../docs/adr/0011-local-dev-webtransport-tls.md). crates.io publish ([release](../../docs/release.md)) |
| `rclwebd/src/local_dev_tls.rs`, `wt.rs` | [ADR 0011](../../docs/adr/0011-local-dev-webtransport-tls.md), [gotchas](./gotchas.md#webtransport-local-certs-are-14-days-by-browser-rule) |
| `rclwebd/src/config.rs` | [ADR 0008](../../docs/adr/0008-one-adapter-row-per-gateway-process.md), [gotchas](./gotchas.md#one-gateway-process-binds-one-support-row) |
| `rclwebd/src/ros/**` | [technology stack](./technology-stack.md), [adapter ABI](../../docs/gateway/rclwebd.md) |
| `rclwebd/src/ros/backend.rs` | Same-thread loopback must pump ([gotchas](./gotchas.md#same-thread-ros-loopback-must-pump)) |
| `rclwebd/src/ros/rcl.rs` | Action wait-set index ([gotchas](./gotchas.md#action-client-wait-set-ready-is-not-the-first-client-slot)) |
| `rclwebd/src/auth.rs` | [security](../../docs/security.md); default `off` is anonymous ([gotchas](./gotchas.md#authenticate-defaults-to-off)) |
| `rclwebd/src/acl.rs` | [security](../../docs/security.md); `enforce` is default-deny ([gotchas](./gotchas.md#acls-default-to-off-enforce-is-default-deny)) |
| `rclwebd/src/ops.rs` | [deploy](../../docs/deploy.md); `/healthz` is liveness ([gotchas](./gotchas.md#healthz-is-liveness-not-readiness)) |
| `docker/**` | [deploy](../../docs/deploy.md), digest-pinned `oven/bun` ([gotchas](./gotchas.md#github-releases-downloads-need-retries)) |
| `typescript/**` | [How to](../../docs/typescript.md), [API](../../docs/api.md), [ADR 0014](../../docs/adr/0014-typescript-package-rcl-web.md). npm blocks unscoped `rclweb` vs `rrweb` ([gotchas](./gotchas.md#unscoped-rclweb-is-blocked-on-npm-as-too-similar-to-rrweb)). Reconnect is a fresh session ([gotchas](./gotchas.md#reconnect-is-a-fresh-session-not-sessionresume)); Worker `telemetry()` is the last poll snapshot ([gotchas](./gotchas.md#worker-telemetry-is-the-last-poll-snapshot)); pack copies LICENSE/NOTICE ([gotchas](./gotchas.md#npm-pack-copies-license-and-notice-do-not-commit-them)) |
| `scripts/license-inventory.ts` | OSI-permissive inventory; workspace npm deps are read from the declaring package first ([gotchas](./gotchas.md#license-inventory-looks-in-the-declaring-workspace-first)) |
| `scripts/npm-pack.ts`, `typescript/tsdown.config.mjs` | tsdown ship bundle + LICENSE/NOTICE; tarball must not include `src/` ([ADR 0015](../../docs/adr/0015-tsdown-ship-bundle.md), [gotchas](./gotchas.md#npm-pack-ships-the-tsdown-dist-not-typescript-source)) |
| `scripts/cargo-publish.ts` | Crate LICENSE/NOTICE copies must match the root ([gotchas](./gotchas.md#crate-licensenotice-copies-are-committed)); fixture crates stay private ([release](../../docs/release.md)); `rclwebd` publish waits for the sparse index ([gotchas](./gotchas.md#publishing-rclwebd-waits-for-the-sparse-index)) |
| `typescript/src/index.ts`, `internal.ts` | Public `init`/`Node` vs host/ABI ([how to](../../docs/typescript.md#public-vs-internal), [API](../../docs/api.md)); graph getters hide GraphSnapshot JSON ([gotchas](./gotchas.md#public-node-graph-hides-graphsnapshot-json)) |
| `examples/**` | [How to](../../docs/typescript.md), [API](../../docs/api.md), [examples README](../../examples/README.md) |
| `.github/workflows/ci.yml` | [Validation](../../docs/validation.md); do not wrap cargo tests in Docker ([gotchas](./gotchas.md#do-not-wrap-cargo-tests-in-a-docker-mock-lane)) |
| `.github/workflows/release.yml` | npm trusted publishing + crates.io ([release](../../docs/release.md), [ADR 0016](../../docs/adr/0016-oidc-trusted-publish.md)). npm identity is the workflow filename, not a GitHub environment ([gotchas](./gotchas.md#npm-oidc-identity-is-the-workflow-file)). Do not set `NODE_AUTH_TOKEN` ([gotchas](./gotchas.md#do-not-put-nodeauthtoken-on-the-npm-oidc-job)). First crates.io publish is manual ([gotchas](./gotchas.md#cratesio-oidc-cannot-create-the-first-crate)) |
| `pixi.toml` | Optional RoboStack J-FT ([technology stack](./technology-stack.md#optional-local-ros-prefix), [gotchas](./gotchas.md#pixi-ros-test-must-pin-rosprefix-over-a-host-optros)) |
| `scripts/build-wasm.ts` | Fat-LTO wasm ship ([gotchas](./gotchas.md#release-wasm-inherits-native-release-settings)) |
| Support matrix | Human matrix edit; no committed measurement JSON ([gotchas](./gotchas.md#do-not-commit-measurement-json)) |
| `scripts/perf-baseline/**`, `scripts/measure-perf-baseline.ts` | [Performance](../../docs/performance.md); primary metrics are latency / CPU / RSS; stdout only, no committed JSON ([gotchas](./gotchas.md#do-not-commit-measurement-json)). Hops must pair by work ([gotchas](./gotchas.md#perf-baseline-hops-must-pair-by-work)). RSS snapshots retry EINTR ([gotchas](./gotchas.md#processmemoryusage-can-return-eintr)) |
| `studio/` (not in the tree) | [Studio](../../docs/prototypes/studio-ui.md), [DESIGN.md](./DESIGN.md) |

## Design record check

```bash
bunx @google/design.md lint .agents/docs/DESIGN.md
```

Studio adds this check to the root command surface when that prototype starts.
