// Serialized-only rcl surface for rclwebd (R3-04 adapter ABI + dynamic typesupport).
//
// Input for scripts/generate-rcl-bindings.sh (bindgen). The allowlist in that
// script — not this include set — decides what lands in bindings.rs.

#include <rcl/rcl.h>
#include <rcl/graph.h>
#include <rcl/client.h>
#include <rcl/service.h>
#include <rcl/error_handling.h>
#include <rcl/time.h>
#include <rcl_action/rcl_action.h>
#include <rcutils/allocator.h>
#include <rcutils/types/uint8_array.h>
#include <rmw/rmw.h>
#include <rmw/serialized_message.h>
#include <rosidl_runtime_c/message_type_support_struct.h>
#include <rosidl_runtime_c/service_type_support_struct.h>
#include <rosidl_runtime_c/action_type_support_struct.h>
