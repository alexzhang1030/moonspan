cmake_minimum_required(VERSION 3.8)
project(rclweb_cdr_interfaces)

find_package(ament_cmake REQUIRED)
find_package(builtin_interfaces REQUIRED)
find_package(rosidl_default_generators REQUIRED)

rosidl_generate_interfaces(${PROJECT_NAME}
  "msg/PrimitiveScalars.msg"
  "msg/Collections.msg"
  "msg/NestedSample.msg"
  "srv/EchoNested.srv"
  "action/MeasureSequence.action"
  DEPENDENCIES builtin_interfaces
)

ament_export_dependencies(rosidl_default_runtime)
ament_package()
