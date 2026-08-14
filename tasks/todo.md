# Open checklist

Authoritative detail lives in the [open-work list](./plan.md) and the topic documents under [`docs/`](../docs/README.md).

## Ready for a human

- [ ] Promote support-matrix rows from live e2e to **Qualified**
- [x] Configure the npm trusted publisher for `rcl-web` (environment blank) and crates.io trusted publishers
- [x] First crates.io publish of `rclweb` / `rclwebd` `0.0.1` (human `cargo publish`; then OIDC)
- [x] First OIDC automatic publish (`v0.0.3` → `rcl-web@0.0.3`, crates `0.0.2`; [run](https://github.com/alexzhang1030/rclweb/actions/runs/31713576156))
- [ ] Name the OIDC tenant and SROS2 reference environment
- [ ] Supply the reviewed ACL policy matrix
- [ ] Confirm or correct the `NOTICE` copyright line
- [ ] Name qualification environment, owners, and benchmark-retention policy

## Engineering follow-ups

- [x] ros-feature compile gate (`just ros-check` / CI `ros-feature-check`)
- [ ] Audit file sink (integrity, retention, export)
- [ ] SROS2 enclave wiring once the keystore is named
- [ ] Production TLS / reverse-proxy profile
- [ ] Remote metrics/trace export
- [ ] Kubernetes / systemd units beyond compose
- [ ] Studio prototype after a release review
