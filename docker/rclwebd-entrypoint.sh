#!/usr/bin/env bash
# Production-shaped J-FT entrypoint: source ROS, then exec rclwebd.
set -eo pipefail

# ROS setup scripts reference optional unset vars; nounset must be off while sourcing.
# shellcheck disable=SC1091
set +u
source /opt/ros/jazzy/setup.bash
set -u

export RCLWEBD_BIND="${RCLWEBD_BIND:-0.0.0.0:8794}"
export RCLWEBD_SUPPORT_ROW="${RCLWEBD_SUPPORT_ROW:-J-FT}"
export ROS_DOMAIN_ID="${ROS_DOMAIN_ID:-0}"
export RMW_IMPLEMENTATION="${RMW_IMPLEMENTATION:-rmw_fastrtps_cpp}"

exec /usr/local/bin/rclwebd
