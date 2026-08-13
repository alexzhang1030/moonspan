#!/usr/bin/env bash
# Start a Humble talker, H-FT rclwebd, and the SDK e2e harness in one container.
set -eo pipefail

cd /workspace
# ROS setup scripts reference optional unset vars; nounset must be off while sourcing.
# shellcheck disable=SC1091
set +u
source /opt/ros/humble/setup.bash
set -u

export ROS_DOMAIN_ID="${ROS_DOMAIN_ID:-0}"
export RCLWEBD_BIND="${RCLWEBD_BIND:-127.0.0.1:8794}"
export RMW_IMPLEMENTATION="${RMW_IMPLEMENTATION:-rmw_fastrtps_cpp}"
export RCLWEBD_SUPPORT_ROW="${RCLWEBD_SUPPORT_ROW:-H-FT}"
export ROS_PREFIX="${ROS_PREFIX:-/opt/ros/humble}"
export RCLWEB_SUPPORT_ROW="${RCLWEB_SUPPORT_ROW:-H-FT}"

echo "r3-03-h-ft-e2e: starting talker on domain ${ROS_DOMAIN_ID} (row ${RCLWEBD_SUPPORT_ROW})"
ros2 topic pub --rate 10 /chatter std_msgs/msg/String "{data: 'rclweb-r3-03-h-ft-e2e'}" >/tmp/talker.log 2>&1 &
TALKER_PID=$!

cleanup() {
  kill "${TALKER_PID}" >/dev/null 2>&1 || true
  if [[ -n "${GATEWAY_PID:-}" ]]; then
    kill "${GATEWAY_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "r3-03-h-ft-e2e: starting rclwebd on ${RCLWEBD_BIND}"
./target/release/rclwebd >/tmp/rclwebd.log 2>&1 &
GATEWAY_PID=$!

echo "r3-03-h-ft-e2e: running SDK harness"
bun run --filter @rclweb/e2e-harness start

echo "r3-03-h-ft-e2e: complete"
