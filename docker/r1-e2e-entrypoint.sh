#!/usr/bin/env bash
# Start a ROS talker, rclwebd, and the SDK e2e harness inside one Jazzy container.
set -euo pipefail

cd /workspace
# shellcheck disable=SC1091
source /opt/ros/jazzy/setup.bash

export ROS_DOMAIN_ID="${ROS_DOMAIN_ID:-0}"
export RCLWEBD_BIND="${RCLWEBD_BIND:-127.0.0.1:8794}"
export RMW_IMPLEMENTATION="${RMW_IMPLEMENTATION:-rmw_fastrtps_cpp}"

echo "r1-e2e: starting talker on domain ${ROS_DOMAIN_ID}"
ros2 topic pub --rate 10 /chatter std_msgs/msg/String "{data: 'rclweb-r1-e2e'}" >/tmp/talker.log 2>&1 &
TALKER_PID=$!

cleanup() {
  kill "${TALKER_PID}" >/dev/null 2>&1 || true
  if [[ -n "${GATEWAY_PID:-}" ]]; then
    kill "${GATEWAY_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "r1-e2e: starting rclwebd on ${RCLWEBD_BIND}"
./target/release/rclwebd >/tmp/rclwebd.log 2>&1 &
GATEWAY_PID=$!

echo "r1-e2e: staging baked evidence"
mkdir -p "${RCLWEB_EVIDENCE_DIR:-/workspace/docs/evidence}"
cp -f /opt/rclweb/evidence/*.json "${RCLWEB_EVIDENCE_DIR:-/workspace/docs/evidence}/" 2>/dev/null || true

echo "r1-e2e: running SDK harness"
bun run --filter @rclweb/e2e-harness start

echo "r1-e2e: complete"
