# Open checklist

Authoritative detail lives in the [open-work list](./plan.md) and the topic documents under [`docs/`](../docs/README.md).

## Ready for a human

- [ ] Promote support-matrix rows from live e2e to **Qualified**
- [ ] Configure the npm trusted publisher for `rcl-web` (environment blank) and crates.io trusted publishers after the first cargo publish ([release](../docs/release.md))
- [ ] First crates.io publish of `rclweb` / `rclwebd` `0.0.1` (human `cargo publish`; then OIDC)
- [ ] Name the OIDC tenant and SROS2 reference environment
- [ ] Supply the reviewed ACL policy matrix
- [ ] Confirm or correct the `NOTICE` copyright line
- [ ] Name qualification environment, owners, and benchmark-retention policy

## Engineering follow-ups

- [ ] Audit file sink (integrity, retention, export)
- [ ] SROS2 enclave wiring once the keystore is named
- [ ] Production TLS / reverse-proxy profile
- [ ] Remote metrics/trace export
- [ ] Kubernetes / systemd units beyond compose
- [ ] Studio prototype after a release review
