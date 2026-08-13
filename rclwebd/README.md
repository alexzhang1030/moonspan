# rclwebd

Edge gateway for [rclweb](https://github.com/alexzhang1030/rclweb). It
links the [`rclweb`](https://crates.io/crates/rclweb) core, terminates
R2WP over WebSocket (and optional WebTransport), and attaches to ROS 2
through a serialized adapter ABI.

The `rclwebd` binary requires `--features ros` and a sourced ROS 2
prefix (`ROS_PREFIX` / `AMENT_PREFIX_PATH`) matching
`RCLWEBD_SUPPORT_ROW`. Default builds stay ROS-free (library + tests).

```bash
cargo install rclwebd --features ros
```

Operator contract: [`docs/gateway/rclwebd.md`](../docs/gateway/rclwebd.md).
License: Apache-2.0 ([LICENSE](./LICENSE), [NOTICE](./NOTICE)).
