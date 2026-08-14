# rclwebd

Edge gateway for [rclweb](https://github.com/alexzhang1030/rclweb). It
links the [`rclweb`](https://crates.io/crates/rclweb) core, terminates
R2WP over WebSocket (and optional WebTransport), and attaches to ROS 2
through a serialized adapter ABI.

Prebuilt images (six support rows; `jazzy` = J-FT, `humble` = H-FT):

```bash
docker run --rm --network host ghcr.io/alexzhang1030/rclwebd:jazzy
```

Prebuilt binaries for a sourced Jazzy / Humble environment:

```bash
curl -fsSL https://raw.githubusercontent.com/alexzhang1030/rclweb/main/scripts/install-rclwebd.sh | bash
```

Building from source requires `--features ros` and a sourced ROS 2
prefix (`ROS_PREFIX` / `AMENT_PREFIX_PATH`). Default builds stay
ROS-free (library + tests). `RCLWEBD_SUPPORT_ROW` is auto-detected from
the sourced environment when unset.

```bash
cargo install rclwebd --features ros
```

Operator contract: [`docs/gateway/rclwebd.md`](../docs/gateway/rclwebd.md).
License: Apache-2.0 ([LICENSE](./LICENSE), [NOTICE](./NOTICE)).
