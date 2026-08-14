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
| Published versions | `rcl-web@0.0.4` (tsdown) is the current npm cut (`0.0.1` source, `0.0.2` first tsdown). `rclweb` / `rclwebd` are `0.0.3` on crates.io. First OIDC automatic publish landed from tag `v0.0.3` ([release](../docs/release.md), [ADR 0016](../docs/adr/0016-oidc-trusted-publish.md)). Fixture crates stay `publish = false`. |
| npm registry name | Unscoped `rclweb` is blocked as too similar to `rrweb`. Publish and import name is `rcl-web` ([ADR 0014](../docs/adr/0014-typescript-package-rcl-web.md)) |

## Open — needs a human ruling

| Topic | What would close it |
|---|---|
| Qualification environment | Reviewed environment manifest and artifact storage |
| Owners | Named workstream, integration, and review owners |
| OIDC tenant and SROS2 | Issuer/audience/JWKS tenant record and SROS2 keystore; the gateway only consumes env |
| ACL matrix content | Reviewed allow-rule set for `RCLWEBD_ACL_MODE=enforce` |
| Benchmark retention | Storage, retention, access, and integrity policy for perf output |
| Support-matrix **Qualified** | Human edit of [support-matrix.md](../docs/support-matrix.md) |
| Copyright line | `NOTICE` currently says `Copyright 2026 Alex` |

## Open — engineering follow-ups

| Topic | Notes |
|---|---|
| Audit sink | Integrity, retention, and export beyond stderr JSON lines ([security](../docs/security.md)) |
| SROS2 enclave | Enclave identity, keystore provenance, browser-to-ROS mapping |
| Production TLS | Runtime images speak plaintext HTTP/WS; PKI stays a follow-up ([deploy](../docs/deploy.md)) |
| Remote telemetry | `/metrics` is scrape-only; no OTLP export yet |
| Orchestrators | Kubernetes / systemd units beyond compose |
| Soak / upgrade | Rollback, soak, and fault evidence |
| Studio | Post-release UI prototype ([studio-ui](../docs/prototypes/studio-ui.md)) |

## Definition of done

A change updates the authoritative document with the code, keeps fixtures and the implementation in one review unit, and stays green on `just check`, `just test`, and `just build`.
