# Open work

The product is one Rust core (`rclweb`) for gateway and browser, `rclwebd` at the edge, and the TypeScript package `rcl-web`. Architecture: [docs/architecture.md](../docs/architecture.md). This file lists what is still open. It is not a phase ledger.

## Settled

| Topic | Ruling |
|---|---|
| Core language | One Rust core, native for `rclwebd`, wasm32 for the browser ([ADR 0010](../docs/adr/0010-restructure-single-rust-core.md)) |
| Names | Core crate `rclweb`, gateway `rclwebd`, TypeScript package `rcl-web` at `typescript/` ([ADR 0014](../docs/adr/0014-typescript-package-rcl-web.md)) |
| Protocol subset | v0.1 normative subset per [r2wp-v0](../protocol/r2wp-v0.md#normative-scope-v01-subset) |
| Support rows | Six rows of corpus data stay committed; live talker e2e covers all six; **Qualified** is a human matrix edit |
| Bun | 1.3.14, workspace manifests, lockfile, root checks |
| License | Apache-2.0; OSI-permissive third-party policy ([licensing](../docs/licensing.md)) |
| Published versions | `0.0.5` across npm and crates (aligned from `v0.0.5` so tag-named images/binaries match the crate version; earlier: `rcl-web@0.0.4`, crates `0.0.3`). First OIDC automatic publish landed from tag `v0.0.3` ([release](../docs/release.md), [ADR 0016](../docs/adr/0016-oidc-trusted-publish.md)). Fixture crates stay `publish = false`. |
| npm registry name | Unscoped `rclweb` is blocked as too similar to `rrweb`. Publish and import name is `rcl-web` ([ADR 0014](../docs/adr/0014-typescript-package-rcl-web.md)) |
| Gateway distribution | Prebuilt GHCR images (six rows) and release binaries; support row auto-detects from the sourced environment ([ADR 0018](../docs/adr/0018-prebuilt-gateway-distribution.md)) |
| ros-feature test gate | CI `ros-feature-check` / `just ros-check-docker` compile `cargo check -p rclwebd --features ros --tests` in digest-pinned Jazzy; they do not run `cargo test` ([gotcha](../.agents/docs/gotchas.md#no-ci-lane-compiles-the-ros-feature-tests)) |
| Copyright line | Keep `Copyright 2026 Alex` in [NOTICE](../NOTICE). No reason given. |
| Authenticate / SROS2 | Do not name an OIDC tenant or SROS2 keystore. Auth stays `off`. No reason given. |
| ACL matrix | Wide reference allow-rules at [acl-reference.json](../docs/acl-reference.json) (`RCLWEBD_ACL_PATH`). Human asked for coverage, no reason given. Default process mode stays `off`. |
| Qualification environment | The digest-pinned compose lanes in the [support matrix](../docs/support-matrix.md). No separate lab or artifact store ([qualification](../.agents/docs/qualification.md)). |
| Owners | Repository owner `alexzhang1030`; NOTICE name Alex. No separate workstream owners. |
| Benchmark retention | Stdout only. Do not commit measurement JSON ([gotcha](../.agents/docs/gotchas.md#do-not-commit-measurement-json)). No retention store. |
| Support-matrix **Qualified** | Do not stamp. Keep **Qualification target** and continue the work. No reason given. |
| Audit sink | Opt-in file JSONL (`RCLWEBD_AUDIT_SINK=file`) with a SHA-256 hash chain, size rotation, and copy/verify export. Default remains stderr. `/configz` reports health, not event bodies. A write failure does not change the channel decision. |

## Open — needs a human ruling

None. The 2026-08-14 replies are in Settled. Reopen a row only if the human names a tenant, stamps **Qualified**, or changes the copyright / ACL / retention pins.

## Open — engineering follow-ups

| Topic | Notes |
|---|---|
| SROS2 enclave | Parked: auth is out of scope until the human names a tenant / keystore |
| Production TLS | Runtime images speak plaintext HTTP/WS; PKI stays a follow-up ([deploy](../docs/deploy.md)) |
| Remote telemetry | `/metrics` is scrape-only; no OTLP export yet |
| Orchestrators | Kubernetes / systemd units beyond compose |
| Soak / upgrade | Rollback, soak, and fault evidence |
| apt / buildfarm | Deferred in [ADR 0018](../docs/adr/0018-prebuilt-gateway-distribution.md); reopens if cargo-in-colcon matures or users ask for apt |
| Studio | Post-release UI prototype ([studio-ui](../docs/prototypes/studio-ui.md)) |

## Definition of done

A change updates the authoritative document with the code, keeps fixtures and the implementation in one review unit, and stays green on `just check`, `just test`, and `just build`.
