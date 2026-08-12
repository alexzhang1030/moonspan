#!/usr/bin/env bash
# Runtime entrypoint: source the image ROS prefix, then exec rclwebd.
set -eo pipefail

prefix="${ROS_PREFIX:-/opt/ros/jazzy}"
# ROS setup scripts reference optional unset vars; nounset must be off while sourcing.
# shellcheck disable=SC1091
set +u
source "${prefix}/setup.bash"
set -u

export ROS_PREFIX="${prefix}"
export RCLWEBD_BIND="${RCLWEBD_BIND:-0.0.0.0:8794}"
export RCLWEBD_SUPPORT_ROW="${RCLWEBD_SUPPORT_ROW:-J-FT}"
export ROS_DOMAIN_ID="${ROS_DOMAIN_ID:-0}"
export RMW_IMPLEMENTATION="${RMW_IMPLEMENTATION:-rmw_fastrtps_cpp}"

exec /usr/local/bin/rclwebd
