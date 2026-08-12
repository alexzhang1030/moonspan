// Serialized-only rcl surface for rclwebd (R1, row J-FT).
//
// Input for scripts/generate-rcl-bindings.sh (bindgen). The allowlist in that
// script — not this include set — decides what lands in bindings.rs.

#include <rcl/rcl.h>
#include <rcl/graph.h>
#include <rcl/error_handling.h>
#include <rcutils/allocator.h>
#include <rcutils/types/uint8_array.h>
