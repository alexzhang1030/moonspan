#!/usr/bin/env bash
# Regenerate the vendored serialized-only rcl FFI bindings for rclwebd.
#
# The bindings are committed (rclwebd/src/ros/ffi/bindings.rs) so that plain
# `cargo build`/`clippy` need neither ROS headers nor libclang; only builds
# with `--features ros` link the ROS libraries. Regenerate against the pinned
# support row (J-FT: ROS 2 Jazzy) whenever the allowlist below changes, and
# commit the result. Requires a ROS 2 Jazzy installation and bindgen-cli
# (`cargo install bindgen-cli`).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
prefix="${ROS_PREFIX:-/opt/ros/jazzy}"

if [ ! -d "$prefix/include/rcl" ]; then
  echo "error: ROS prefix $prefix has no rcl headers (set ROS_PREFIX)" >&2
  exit 1
fi

includes=(
  rcl rcutils rmw rosidl_runtime_c rosidl_typesupport_interface
  rcl_yaml_param_parser rosidl_dynamic_typesupport type_description_interfaces
  service_msgs builtin_interfaces rcl_logging_interface
)
include_flags=()
for pkg in "${includes[@]}"; do
  include_flags+=("-I$prefix/include/$pkg")
done

functions=(
  rcl_get_zero_initialized_init_options
  rcl_init_options_init
  rcl_init_options_fini
  rcl_init_options_set_domain_id
  rcl_init
  rcl_shutdown
  rcl_get_zero_initialized_context
  rcl_context_fini
  rcl_get_zero_initialized_node
  rcl_node_get_default_options
  rcl_node_init
  rcl_node_fini
  rcl_node_options_fini
  rcl_get_zero_initialized_publisher
  rcl_publisher_get_default_options
  rcl_publisher_init
  rcl_publisher_fini
  rcl_publish_serialized_message
  rcl_get_zero_initialized_subscription
  rcl_subscription_get_default_options
  rcl_subscription_init
  rcl_subscription_fini
  rcl_take_serialized_message
  rcl_get_zero_initialized_wait_set
  rcl_wait_set_init
  rcl_wait_set_fini
  rcl_wait_set_clear
  rcl_wait_set_add_subscription
  rcl_wait_set_add_guard_condition
  rcl_wait
  rcl_get_zero_initialized_guard_condition
  rcl_guard_condition_get_default_options
  rcl_guard_condition_init
  rcl_guard_condition_fini
  rcl_trigger_guard_condition
  # rcl_get_zero_initialized_names_and_types is a #define alias for this rmw fn.
  rmw_get_zero_initialized_names_and_types
  rcl_get_topic_names_and_types
  rcl_names_and_types_fini
  rcutils_get_default_allocator
  rcutils_get_error_string
  rcutils_reset_error
  rcutils_get_zero_initialized_uint8_array
  rcutils_uint8_array_init
  rcutils_uint8_array_fini
)
allowlist="$(IFS='|'; echo "${functions[*]}")"

bindgen "$root/rclwebd/src/ros/ffi/wrapper.h" \
  --allowlist-function "^(${allowlist})\$" \
  --allowlist-var '^(RCL_RET_[A-Z_]+|RMW_RET_[A-Z_]+|RMW_QOS_DEADLINE_DEFAULT|RMW_QOS_LIFESPAN_DEFAULT|RMW_QOS_LIVELINESS_LEASE_DURATION_DEFAULT)$' \
  --no-doc-comments \
  --no-prepend-enum-name \
  --raw-line '//! Vendored bindgen output for the serialized-only rcl surface (J-FT).' \
  --raw-line '//! Regenerate with scripts/generate-rcl-bindings.sh; do not edit by hand.' \
  --raw-line '#![allow(non_upper_case_globals, non_camel_case_types, non_snake_case)]' \
  --raw-line '#![allow(unsafe_code, dead_code, clippy::all, missing_docs)]' \
  -o "$root/rclwebd/src/ros/ffi/bindings.rs" \
  -- "${include_flags[@]}"

echo "wrote rclwebd/src/ros/ffi/bindings.rs"
