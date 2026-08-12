# R3-04: Versioned adapter ABI + dynamic typesupport

Status: Complete (implementation + automated evidence). Wire
`SchemaRequest` / `SchemaAdvertise` / `SchemaResponse` exchange stays parked
(local registry from R3-02 remains the schema surface). Live action **server**
(browser-as-server) stays `schema_unavailable` on `RclBackend`; action **client**
call-style goal→result is attached. J-FT and H-FT talker e2e lanes must stay green
([ADR 0008](../adr/0008-one-adapter-row-per-gateway-process.md)).

## Outcome

| Area | Behavior |
|---|---|
| Adapter ABI | Versioned C header + Rust mirror (`serialized-adapter-v1`); opaque handles, stable status codes, explicit buffer ownership, bounded command queue limits, startup `AdapterProbe` vs support row / distro |
| Typesupport | `dlopen` of `lib{pkg}__rosidl_typesupport_c.so` + `lib{pkg}__rosidl_generator_c.so`; R1 static demo links removed from `build.rs` |
| Topics | Unchanged serialized pub/sub path; unknown types still wire code 10 |
| Service | Live `RclBackend` client/server via CDR↔ROS message bridge (`rmw_serialize` / `rmw_deserialize`) |
| Action client | Call-style goal→result (`OPERATION_ID` as goal UUID); returns serialized `GetResult_Response` CDR |
| Action server | Still stubbed on live backend (MockBackend covers wire/SDK) |
| Schema wire | Remains parked |

## Delivered scope

| Surface | Location |
|---|---|
| C ABI header | [`rclwebd/adapter/include/rclweb_adapter_v1.h`](../../rclwebd/adapter/include/rclweb_adapter_v1.h) |
| Rust ABI mirror | [`rclwebd/src/adapter/`](../../rclwebd/src/adapter/) |
| Dynamic typesupport | [`rclwebd/src/ros/typesupport.rs`](../../rclwebd/src/ros/typesupport.rs) |
| Safe rcl wrappers | [`rclwebd/src/ros/rcl.rs`](../../rclwebd/src/ros/rcl.rs) |
| ROS thread / `RosBackend` | [`rclwebd/src/ros/backend.rs`](../../rclwebd/src/ros/backend.rs) |
| Bindgen allowlist | [`scripts/generate-rcl-bindings.sh`](../../scripts/generate-rcl-bindings.sh), [`rclwebd/src/ros/ffi/wrapper.h`](../../rclwebd/src/ros/ffi/wrapper.h) |
| SessionReady ABI string | [`rclwebd/src/config.rs`](../../rclwebd/src/config.rs) → `serialized-adapter-v1` |

## Acceptance evidence

```bash
just check && just test && just build
source /opt/ros/jazzy/setup.bash && just ros-test
just e2e          # J-FT talker (must not regress)
just e2e-h-ft     # H-FT talker (must not regress; regenerates FFI in-image)
```

Notable tests / artifacts:

- `adapter::tests::*` (ABI probe + buffer ownership)
- `ros_rcl`: `serialized_loopback_publish_take_and_graph`, `unknown_type_is_schema_unavailable`, `add_two_ints_typesupport_resolves_via_dlopen`, `live_service_add_two_ints_round_trip`
- MockBackend service/action suite (`ws_gateway`) unchanged
- Evidence: [`r3-04-adapter-abi.json`](../evidence/r3-04-adapter-abi.json)

## Ownership after completion

R4 owns remaining support rows, OIDC/SROS2, deployment packaging, and any
multi-process or buffer-sharing ABI extension (new ADR). Un-parking wire schema
exchange and live action server can land as follow-ups under the same ABI major
when evidence requires them.
