# Open work

The product is one Rust core (`rclweb`) for gateway and browser, `rclwebd` at the edge, and the TypeScript package `rclweb`. Architecture: [docs/architecture.md](../docs/architecture.md). This file lists what is still open. It is not a phase ledger.

## Settled

| Topic | Ruling |
|---|---|
| Core language | One Rust core, native for `rclwebd`, wasm32 for the browser ([ADR 0010](../docs/adr/0010-restructure-single-rust-core.md)) |
| Names | Core crate `rclweb`, gateway `rclwebd`, TypeScript package `rclweb` at `typescript/` ([ADR 0013](../docs/adr/0013-typescript-package-rclweb.md)) |
| Protocol subset | v0.1 normative subset per [r2wp-v0](../protocol/r2wp-v0.md#normative-scope-v01-subset) |
| Support rows | Six rows of corpus data stay committed; live talker e2e covers all six; **Qualified** is a human matrix edit |
| Bun | 1.3.14, workspace manifests, lockfile, root checks |
| License | Apache-2.0; OSI-permissive third-party policy ([licensing](../docs/licensing.md)) |
| First published version | TypeScript package `rclweb@0.0.1` is public; the npm tarball must include `LICENSE` and `NOTICE`. Crates stay `publish = false`. A human still runs `npm publish` from `typescript/` |

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
