# Open checklist

Authoritative detail lives in the [open-work list](./plan.md) and the topic documents under [`docs/`](../docs/README.md).

## Ready for a human

- [x] Keep `NOTICE` as `Copyright 2026 Alex`
- [x] Do not stamp support-matrix **Qualified**; continue the work
- [x] Do not name an OIDC tenant or SROS2 keystore (auth stays off)
- [x] Wide ACL reference matrix (`docs/acl-reference.json`)
- [x] Distill qualification environment, owners, and benchmark retention from existing pins
- [x] Configure the npm trusted publisher for `rcl-web` (environment blank) and crates.io trusted publishers
- [x] First crates.io publish of `rclweb` / `rclwebd` `0.0.1` (human `cargo publish`; then OIDC)
- [x] First OIDC automatic publish (`v0.0.3` → `rcl-web@0.0.3`, crates `0.0.2`; [run](https://github.com/alexzhang1030/rclweb/actions/runs/31713576156))

## Engineering follow-ups

- [x] ros-feature compile gate (`just ros-check` / CI `ros-feature-check`)
- [ ] Audit file sink (integrity, retention, export)
- [ ] SROS2 enclave wiring (parked until auth is reopened)
- [x] Intranet / lab WebTransport (`RCLWEBD_OFFER_WEBTRANSPORT`, page on localhost)
- [ ] Production TLS / reverse-proxy profile
- [ ] Remote metrics/trace export
- [ ] Kubernetes / systemd units beyond compose
- [ ] Studio prototype after a release review
