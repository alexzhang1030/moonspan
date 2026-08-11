cmake_minimum_required(VERSION 3.8)
project(moonspan_cdr_generator)

if(NOT CMAKE_CXX_STANDARD)
  set(CMAKE_CXX_STANDARD 17)
endif()

find_package(ament_cmake REQUIRED)
find_package(moonspan_cdr_interfaces REQUIRED)
find_package(rclcpp REQUIRED)
find_package(rcutils REQUIRED)
find_package(rosidl_runtime_c REQUIRED)
find_package(rosidl_typesupport_cpp REQUIRED)
find_package(rosidl_typesupport_fastrtps_cpp REQUIRED)
find_package(sensor_msgs REQUIRED)

add_executable(moonspan_cdr_generate src/generate.cpp)
ament_target_dependencies(moonspan_cdr_generate
  moonspan_cdr_interfaces
  rclcpp
  rcutils
  rosidl_runtime_c
  rosidl_typesupport_cpp
  rosidl_typesupport_fastrtps_cpp
  sensor_msgs
)
target_link_libraries(moonspan_cdr_generate
  moonspan_cdr_interfaces::moonspan_cdr_interfaces__rosidl_typesupport_fastrtps_cpp
)

install(TARGETS moonspan_cdr_generate
  DESTINATION lib/${PROJECT_NAME}
)

ament_package()
