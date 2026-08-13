#!/usr/bin/env bash
# Start a ROS talker, rclwebd, and the SDK e2e harness inside one Jazzy container.
set -eo pipefail

cd /workspace
# ROS setup scripts reference optional unset vars; nounset must be off while sourcing.
# shellcheck disable=SC1091
set +u
source /opt/ros/jazzy/setup.bash
set -u

export ROS_DOMAIN_ID="${ROS_DOMAIN_ID:-0}"
export RCLWEBD_BIND="${RCLWEBD_BIND:-127.0.0.1:8794}"
export RMW_IMPLEMENTATION="${RMW_IMPLEMENTATION:-rmw_fastrtps_cpp}"
export RCLWEBD_SUPPORT_ROW="${RCLWEBD_SUPPORT_ROW:-J-FT}"

cleanup() {
  if [[ -n "${TALKER_PID:-}" ]]; then
    kill "${TALKER_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${GATEWAY_PID:-}" ]]; then
    kill "${GATEWAY_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${ZENOHD_PID:-}" ]]; then
    kill "${ZENOHD_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# rmw_zenoh_cpp needs the zenoh router before any session starts.
if [[ "${RMW_IMPLEMENTATION}" == "rmw_zenoh_cpp" ]]; then
  echo "r1-e2e: starting rmw_zenohd router"
  ros2 run rmw_zenoh_cpp rmw_zenohd >/tmp/zenohd.log 2>&1 &
  ZENOHD_PID=$!
  for _ in $(seq 1 120); do
    if (exec 3<>/dev/tcp/127.0.0.1/7447) 2>/dev/null; then
      exec 3>&- 3<&-
      break
    fi
    sleep 0.5
  done
fi

echo "r1-e2e: starting talker on domain ${ROS_DOMAIN_ID} (row ${RCLWEBD_SUPPORT_ROW}, rmw ${RMW_IMPLEMENTATION})"
ros2 topic pub --rate 10 /chatter std_msgs/msg/String "{data: 'rclweb-r1-e2e'}" >/tmp/talker.log 2>&1 &
TALKER_PID=$!

echo "r1-e2e: starting rclwebd on ${RCLWEBD_BIND}"
./target/release/rclwebd >/tmp/rclwebd.log 2>&1 &
GATEWAY_PID=$!

echo "r1-e2e: running SDK harness"
bun run --filter @rclweb/e2e-harness start

echo "r1-e2e: complete"
