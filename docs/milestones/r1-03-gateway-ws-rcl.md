# R1-03: Gateway WebSocket endpoint and serialized-only rcl attachment

Status: Complete. `rclwebd` serves the R2WP v0.1 subset over binary WebSocket
(tokio/axum) and attaches to ROS 2 through the serialized-only rcl FFI surface
on row J-FT.

## Outcome

A WebSocket client completes bootstrap → Authenticate → SessionReady, opens
TOPIC_SUBSCRIBE / TOPIC_PUBLISH channels, and exchanges serialized `ROS_SAMPLE`
frames with live rcl entities. The gateway never parses sample bodies; payload
bytes cross the gateway with one controllable copy (rcl take buffer → the
frame buffer whose 32-byte header prefix is filled in place).

Because R1-02 delivered only parsers, this task also added the sender-side
encode surface to the core (`rclweb::protocol::encode`): deterministic CBOR,
bootstrap records, extension TLVs, and selected-version frames. The parsers
are the oracle — every valid committed fixture re-encodes byte-identically
from its parsed form, and the gateway re-parses and records every outbound
control frame through its own session machine before sending it.

## Delivered scope

| Surface | Location |
|---|---|
| Core encoders (CBOR, bootstrap, TLV, frame, in-place header) | [`rclweb/src/protocol/encode.rs`](../../rclweb/src/protocol/encode.rs) |
| Encoder round-trip + fixture byte-identity tests | [`rclweb/src/protocol/encode_tests.rs`](../../rclweb/src/protocol/encode_tests.rs) |
| Connection engine (session SM wiring, sequence domains, steps 23–25) | [`rclwebd/src/connection.rs`](../../rclwebd/src/connection.rs) |
| Server control builders + hello negotiation | [`rclwebd/src/control.rs`](../../rclwebd/src/control.rs) |
| QoS resolution (wire ↔ effective ↔ rmw profile) | [`rclwebd/src/qos.rs`](../../rclwebd/src/qos.rs) |
| WebSocket endpoint (`/ws`, `/healthz`) | [`rclwebd/src/ws.rs`](../../rclwebd/src/ws.rs) |
| ROS attachment trait (engine ↔ rcl seam) | [`rclwebd/src/backend.rs`](../../rclwebd/src/backend.rs) |
| Vendored rcl FFI bindings + static demo typesupport | [`rclwebd/src/ros/ffi/`](../../rclwebd/src/ros/ffi/), [`scripts/generate-rcl-bindings.sh`](../../scripts/generate-rcl-bindings.sh) |
| Safe rcl wrapper (init, node, serialized publish/take, wait set, graph) | [`rclwebd/src/ros/rcl.rs`](../../rclwebd/src/ros/rcl.rs) |
| Single ROS thread behind the trait | [`rclwebd/src/ros/backend.rs`](../../rclwebd/src/ros/backend.rs) |
| Gateway daemon binary | [`rclwebd/src/main.rs`](../../rclwebd/src/main.rs) |

## Behavioral notes

- The rcl FFI honors the owner constraint: no third-party rcl binding, no
  typed message code. Bindings are vendored bindgen output over an explicit
  ~45-function allowlist so default builds need neither ROS nor libclang;
  `--features ros` links `librcl` and the demo types' generated C typesupport
  (`std_msgs/msg/String`, `sensor_msgs/msg/PointCloud2`) at link time. Dynamic
  (dlopen) typesupport resolution replaces this in R3.
- Unsafe code is confined to `rclwebd/src/ros/` (`ffi` + the thin wrapper);
  the crate keeps `deny(unsafe_code)` elsewhere.
- One dedicated ROS thread owns every rcl entity and a wait-set loop with a
  guard-condition wake; async tasks reach it through a command channel.
- v0.1 policy surface: every credential is accepted (identity is R4),
  extension capabilities negotiate empty (resume and SharedArrayBuffer are
  parked), budgets are empty maps (R2), and best-effort queue overflow drops
  before sequencing (dispositions and counters are R2).
- OpenChannel validation: support row must be J-FT, domain must match the
  gateway, payload encoding must be CDR1, type must be statically linked
  (else ChannelReady failure with wire code 10).

## Acceptance evidence

```bash
cargo test --locked -p rclweb                      # includes encoder oracle round-trips
cargo test --locked -p rclwebd                     # WebSocket integration, mock backend
source /opt/ros/jazzy/setup.bash && just ros-test  # rcl loopback, graph, live-talker e2e
just check && just test && just build
```

`ros-test` runs `serialized_loopback_publish_take_and_graph` (serialized
publish → wait set → take round trip plus a graph query through
`rcl_get_topic_names_and_types`) and
`live_talker_reaches_websocket_client_and_publish_crosses_dds` (a live
`ros2 topic pub` talker reaching a WebSocket client through the gateway, and a
WebSocket publish crossing DDS back into a subscribe channel).

## Ownership after completion

- [`rclwebd`](../gateway/rclwebd.md) owns the gateway description and its
  environment contract.
- [`rclweb` core](../runtime/core.md) owns the encode surface.
- Wasm poll ABI / Worker host remain R1-04; docker-compose CI evidence, demo,
  and telemetry counters remain R1-05.
