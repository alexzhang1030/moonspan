#!/usr/bin/env bash
# Regenerate the vendored serialized-only rcl FFI bindings for rclwebd.
#
# The bindings are committed (rclwebd/src/ros/ffi/bindings.rs) so that plain
# `cargo build`/`clippy` need neither ROS headers nor libclang; only builds
# with `--features ros` link the ROS libraries. Default committed file is
# regenerated against J-FT (ROS 2 Jazzy). The H-FT live e2e image regenerates
# against Humble (`ROS_PREFIX=/opt/ros/humble`) before linking so the artifact
# matches that support row. Requires a ROS 2 installation and bindgen-cli
# (`cargo install bindgen-cli`).
#
# R3-04 extends the allowlist with client/service, wait-set client/service
# slots, graph service names, and rmw serialize/deserialize for the CDR↔ROS
# message bridge used by live service/action.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
prefix="${ROS_PREFIX:-/opt/ros/jazzy}"
row_label="J-FT"
case "${prefix}" in
  */humble*) row_label="H-FT" ;;
  */jazzy*) row_label="J-FT" ;;
esac

if [ ! -d "$prefix/include/rcl" ]; then
  echo "error: ROS prefix $prefix has no rcl headers (set ROS_PREFIX)" >&2
  exit 1
fi

includes=(
  rcl rcutils rmw rosidl_runtime_c rosidl_typesupport_interface
  rcl_yaml_param_parser rosidl_dynamic_typesupport type_description_interfaces
  service_msgs builtin_interfaces rcl_logging_interface
  rcl_action action_msgs unique_identifier_msgs
)
include_flags=()
for pkg in "${includes[@]}"; do
  if [ -d "$prefix/include/$pkg" ]; then
    include_flags+=("-I$prefix/include/$pkg")
  fi
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
  rcl_get_zero_initialized_client
  rcl_client_get_default_options
  rcl_client_init
  rcl_client_fini
  rcl_send_request
  rcl_take_response
  rcl_take_response_with_info
  rcl_get_zero_initialized_service
  rcl_service_get_default_options
  rcl_service_init
  rcl_service_fini
  rcl_take_request
  rcl_take_request_with_info
  rcl_send_response
  rcl_get_zero_initialized_wait_set
  rcl_wait_set_init
  rcl_wait_set_fini
  rcl_wait_set_clear
  rcl_wait_set_add_subscription
  rcl_wait_set_add_guard_condition
  rcl_wait_set_add_client
  rcl_wait_set_add_service
  rcl_wait
  rcl_get_zero_initialized_guard_condition
  rcl_guard_condition_get_default_options
  rcl_guard_condition_init
  rcl_guard_condition_fini
  rcl_trigger_guard_condition
  # rcl_get_zero_initialized_names_and_types is a #define alias for this rmw fn.
  rmw_get_zero_initialized_names_and_types
  rcl_get_topic_names_and_types
  rcl_get_service_names_and_types
  rcl_names_and_types_fini
  rcutils_get_default_allocator
  rcutils_get_error_string
  rcutils_reset_error
  rcutils_get_zero_initialized_uint8_array
  rcutils_uint8_array_init
  rcutils_uint8_array_fini
  rmw_serialize
  rmw_deserialize
  # Action client (call-style goal→result).
  rcl_action_get_zero_initialized_client
  rcl_action_client_get_default_options
  rcl_action_client_init
  rcl_action_client_fini
  rcl_action_server_is_available
  rcl_action_send_goal_request
  rcl_action_take_goal_response
  rcl_action_send_result_request
  rcl_action_take_result_response
  rcl_action_send_cancel_request
  rcl_action_take_cancel_response
  rcl_action_client_wait_set_get_num_entities
  rcl_action_wait_set_add_action_client
  # Action server (browser-as-server) + clock for server init.
  rcl_clock_init
  rcl_clock_fini
  rcl_action_get_zero_initialized_server
  rcl_action_server_get_default_options
  rcl_action_server_init
  rcl_action_server_fini
  rcl_action_take_goal_request
  rcl_action_send_goal_response
  rcl_action_accept_new_goal
  rcl_action_publish_feedback
  rcl_action_get_goal_status_array
  rcl_action_publish_status
  rcl_action_take_result_request
  rcl_action_send_result_response
  rcl_action_notify_goal_done
  rcl_action_take_cancel_request
  rcl_action_process_cancel_request
  rcl_action_send_cancel_response
  rcl_action_update_goal_state
  rcl_action_get_zero_initialized_goal_info
  rcl_action_get_zero_initialized_goal_status_array
  rcl_action_get_zero_initialized_cancel_request
  rcl_action_get_zero_initialized_cancel_response
  rcl_action_goal_status_array_fini
  rcl_action_cancel_response_fini
  rcl_action_wait_set_add_action_server
  rcl_action_server_wait_set_get_num_entities
)
allowlist="$(IFS='|'; echo "${functions[*]}")"

bindgen "$root/rclwebd/src/ros/ffi/wrapper.h" \
  --allowlist-function "^(${allowlist})\$" \
  --allowlist-var '^(RCL_RET_[A-Z_]+|RMW_RET_[A-Z_]+|RCL_ACTION_RET_[A-Z_]+|RMW_QOS_DEADLINE_DEFAULT|RMW_QOS_LIFESPAN_DEFAULT|RMW_QOS_LIVELINESS_LEASE_DURATION_DEFAULT)$' \
  --allowlist-type '^(rmw_request_id_t|rmw_service_info_t|rosidl_service_type_support_t|rosidl_action_type_support_t|rcl_clock_t|rcl_clock_type_t|rcl_action_goal_info_t|rcl_action_goal_handle_t|rcl_action_goal_event_t|rcl_action_cancel_request_t|rcl_action_cancel_response_t|rcl_action_goal_status_array_t|rcl_action_server_t)$' \
  --no-doc-comments \
  --no-prepend-enum-name \
  --raw-line "//! Vendored bindgen output for the serialized-only rcl surface (${row_label})." \
  --raw-line '//! Regenerate with scripts/generate-rcl-bindings.sh; do not edit by hand.' \
  --raw-line '#![allow(non_upper_case_globals, non_camel_case_types, non_snake_case)]' \
  --raw-line '#![allow(unsafe_code, dead_code, clippy::all, missing_docs)]' \
  -o "$root/rclwebd/src/ros/ffi/bindings.rs" \
  -- "${include_flags[@]}"

echo "wrote rclwebd/src/ros/ffi/bindings.rs"
