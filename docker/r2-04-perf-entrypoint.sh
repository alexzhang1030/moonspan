#!/usr/bin/env bash
# R2-04 live lane: ROS stamped String talker + rclwebd + foxglove_bridge + rosbridge.
set -eo pipefail

cd /workspace
# shellcheck disable=SC1091
set +u
source /opt/ros/jazzy/setup.bash
set -u

export ROS_DOMAIN_ID="${ROS_DOMAIN_ID:-0}"
export RCLWEBD_BIND="${RCLWEBD_BIND:-127.0.0.1:8794}"
export RMW_IMPLEMENTATION="${RMW_IMPLEMENTATION:-rmw_fastrtps_cpp}"
export RCLWEB_EVIDENCE_DIR="${RCLWEB_EVIDENCE_DIR:-/workspace/docs/evidence}"

cleanup() {
  for pid in ${PIDS:-}; do
    kill "${pid}" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT
PIDS=""

echo "r2-04-perf: stamped String talker on ${ROS_DOMAIN_ID}"
# Embed wall-clock millis so browser/host clients can compute e2e latency on loopback.
python3 - <<'PY' >/tmp/talker.log 2>&1 &
import time
import rclpy
from rclpy.node import Node
from std_msgs.msg import String

class Talker(Node):
    def __init__(self):
        super().__init__("r2_04_stamp_talker")
        self.pub = self.create_publisher(String, "/bench/stamp", 10)
        self.create_timer(0.1, self.tick)
    def tick(self):
        msg = String()
        msg.data = str(int(time.time() * 1000))
        self.pub.publish(msg)

rclpy.init()
node = Talker()
try:
    rclpy.spin(node)
finally:
    node.destroy_node()
    rclpy.shutdown()
PY
PIDS="$PIDS $!"

echo "r2-04-perf: rclwebd on ${RCLWEBD_BIND}"
./target/release/rclwebd >/tmp/rclwebd.log 2>&1 &
PIDS="$PIDS $!"

echo "r2-04-perf: foxglove_bridge"
ros2 launch foxglove_bridge foxglove_bridge_launch.xml port:=8765 >/tmp/foxglove.log 2>&1 &
PIDS="$PIDS $!"

echo "r2-04-perf: rosbridge"
ros2 launch rosbridge_server rosbridge_websocket_launch.xml port:=9090 >/tmp/rosbridge.log 2>&1 &
PIDS="$PIDS $!"

sleep 3

echo "r2-04-perf: live measure"
export RCLWEB_GATEWAY_URL="ws://127.0.0.1:8794/ws"
export FOXGLOVE_URL="ws://127.0.0.1:8765"
export ROSBRIDGE_URL="ws://127.0.0.1:9090"
bun run scripts/perf-baseline/live-measure.ts

echo "r2-04-perf: complete"
