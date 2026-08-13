# Optional libFuzzer targets

The foundation CI lane runs on the pinned **stable** toolchain
(`rust-toolchain.toml`). Continuous decoder hardening therefore lives in:

```bash
cargo test --locked -p rclweb --test decoder_fuzz_smoke
```

That deterministic smoke mutates seeds from `protocol/testdata` and
`conformance/cdr` through `parse_bootstrap`, `parse_frame`, deterministic CBOR,
and CDR readers (no panics).

## Nightly / local libFuzzer (optional)

When you have a nightly toolchain with `cargo-fuzz` installed:

```bash
cargo install cargo-fuzz
cd fuzz
cargo +nightly fuzz run parse_bootstrap -- -max_total_time=30
cargo +nightly fuzz run parse_frame -- -max_total_time=30
cargo +nightly fuzz run decode_cbor -- -max_total_time=30
cargo +nightly fuzz run cdr_reader -- -max_total_time=30
```

Seed corpora under `fuzz/corpus/*` are copied from committed fixtures. The
`fuzz/` crate is **not** a workspace member so `just check` / `just test` stay
on the stable pin.
