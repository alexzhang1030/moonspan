#!/usr/bin/env bash
# Sourced by pixi for local J-FT `just ros-test`. Do not `set -euo pipefail`:
# activation scripts run in the caller's shell.
#
# Pin ROS_PREFIX / AMENT_PREFIX_PATH to this env so cargo --features ros and
# dlopen do not pick up a host /opt/ros/jazzy that happens to be on PATH.
export ROS_PREFIX="${CONDA_PREFIX:?pixi CONDA_PREFIX is unset}"
export AMENT_PREFIX_PATH="${CONDA_PREFIX}"
# Do not append a host /opt/ros LD_LIBRARY_PATH: mixed apt + RoboStack
# prefixes silently load the wrong librcl.
export LD_LIBRARY_PATH="${CONDA_PREFIX}/lib"
export RMW_IMPLEMENTATION="${RMW_IMPLEMENTATION:-rmw_fastrtps_cpp}"
export RCLWEBD_SUPPORT_ROW="${RCLWEBD_SUPPORT_ROW:-J-FT}"
# RoboStack's activate.d defaults this to SUBNET. Loopback tests need
# localhost so the live talker and gateway meet without multicast.
export ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST
