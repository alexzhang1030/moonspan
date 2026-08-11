#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

#include "fastcdr/Cdr.h"
#include "fastcdr/FastBuffer.h"
#include "fastcdr/config.h"
#include "moonspan_cdr_interfaces/action/measure_sequence.hpp"
#include "moonspan_cdr_interfaces/msg/collections.hpp"
#include "moonspan_cdr_interfaces/msg/detail/primitive_scalars__rosidl_typesupport_fastrtps_cpp.hpp"
#include "moonspan_cdr_interfaces/msg/nested_sample.hpp"
#include "moonspan_cdr_interfaces/msg/primitive_scalars.hpp"
#include "moonspan_cdr_interfaces/srv/echo_nested.hpp"
#include "rclcpp/serialization.hpp"
#include "rclcpp/serialized_message.hpp"
#include "rcutils/allocator.h"
#include "rosidl_runtime_cpp/traits.hpp"
#include "rosidl_typesupport_cpp/message_type_support.hpp"
#include "sensor_msgs/msg/point_cloud2.hpp"
#include "sensor_msgs/msg/point_field.hpp"

#if __has_include("rosidl_runtime_c/type_hash.h")
#define MOONSPAN_HAS_REP2011_TYPE_HASH 1
#include "rosidl_runtime_c/type_hash.h"
#else
#define MOONSPAN_HAS_REP2011_TYPE_HASH 0
#endif

namespace fs = std::filesystem;

namespace
{

constexpr std::size_t kSerializedCapacity = 1024U * 1024U;

struct SummaryRow
{
  std::string fixture_id;
  std::string type_name;
  std::string serializer;
  std::string endianness;
  std::string type_hash;
  std::size_t byte_length;
};

moonspan_cdr_interfaces::msg::PrimitiveScalars make_primitive_scalars()
{
  moonspan_cdr_interfaces::msg::PrimitiveScalars message;
  message.bool_value = true;
  message.byte_value = 0xa5U;
  message.char_value = 0x5aU;
  message.float32_value = -12.5F;
  message.float64_value = 12345.125;
  message.int8_value = -120;
  message.uint8_value = 250U;
  message.int16_value = -32000;
  message.uint16_value = 65000U;
  message.int32_value = -2000000000;
  message.uint32_value = 4000000000U;
  message.int64_value = -9000000000000000000LL;
  message.uint64_value = 18000000000000000000ULL;
  message.string_value = "Moonspan CDR \xe2\x9c\x93";
  message.wstring_value = u"\u6708\u9762CDR";
  return message;
}

moonspan_cdr_interfaces::msg::Collections make_collections()
{
  moonspan_cdr_interfaces::msg::Collections message;
  message.fixed_i32 = {
    std::numeric_limits<std::int32_t>::min(), 0, std::numeric_limits<std::int32_t>::max()};
  message.bounded_f64 = {-1.25, 0.0, 3.5, 1024.125};
  message.bytes_value = {0x00U, 0x01U, 0x7fU, 0x80U, 0xffU};
  message.bounded_string = "0123456789abcdef";
  message.bounded_wstring = u"0123456789abcdef";
  return message;
}

moonspan_cdr_interfaces::msg::NestedSample make_nested_sample()
{
  moonspan_cdr_interfaces::msg::NestedSample message;
  message.stamp.sec = 1700000000;
  message.stamp.nanosec = 123456789U;
  message.scalars = make_primitive_scalars();
  message.collections = make_collections();
  return message;
}

void store_u16_le(std::vector<std::uint8_t> & data, std::size_t offset, std::uint16_t value)
{
  data.at(offset) = static_cast<std::uint8_t>(value & 0xffU);
  data.at(offset + 1U) = static_cast<std::uint8_t>((value >> 8U) & 0xffU);
}

void store_f32_le(std::vector<std::uint8_t> & data, std::size_t offset, float value)
{
  static_assert(sizeof(float) == sizeof(std::uint32_t));
  std::uint32_t bits = 0;
  std::memcpy(&bits, &value, sizeof(bits));
  for (std::size_t i = 0; i < sizeof(bits); ++i) {
    data.at(offset + i) = static_cast<std::uint8_t>((bits >> (8U * i)) & 0xffU);
  }
}

sensor_msgs::msg::PointCloud2 make_point_cloud2()
{
  sensor_msgs::msg::PointCloud2 message;
  message.header.stamp.sec = 1700000001;
  message.header.stamp.nanosec = 987654321U;
  message.header.frame_id = "map";
  message.height = 2U;
  message.width = 3U;
  message.fields = {
    sensor_msgs::msg::PointField().set__name("x").set__offset(0U).set__datatype(
      sensor_msgs::msg::PointField::FLOAT32).set__count(1U),
    sensor_msgs::msg::PointField().set__name("y").set__offset(4U).set__datatype(
      sensor_msgs::msg::PointField::FLOAT32).set__count(1U),
    sensor_msgs::msg::PointField().set__name("z").set__offset(8U).set__datatype(
      sensor_msgs::msg::PointField::FLOAT32).set__count(1U),
    sensor_msgs::msg::PointField().set__name("intensity").set__offset(12U).set__datatype(
      sensor_msgs::msg::PointField::UINT16).set__count(1U),
    sensor_msgs::msg::PointField().set__name("ring").set__offset(14U).set__datatype(
      sensor_msgs::msg::PointField::UINT16).set__count(1U),
  };
  message.is_bigendian = false;
  message.point_step = 16U;
  message.row_step = message.point_step * message.width;
  message.data.assign(message.row_step * message.height, 0U);
  message.is_dense = true;

  constexpr std::array<std::array<float, 3>, 6> coordinates = {{
    {{1.0F, 2.0F, 3.0F}},
    {{-1.0F, -2.0F, -3.0F}},
    {{0.5F, 0.25F, 0.125F}},
    {{10.0F, 20.0F, 30.0F}},
    {{-10.0F, 4.0F, 8.0F}},
    {{1024.0F, -1024.0F, 64.0F}},
  }};
  constexpr std::array<std::uint16_t, 6> intensities = {{10U, 20U, 30U, 40U, 50U, 60U}};
  constexpr std::array<std::uint16_t, 6> rings = {{0U, 1U, 2U, 3U, 4U, 5U}};

  for (std::size_t i = 0; i < coordinates.size(); ++i) {
    const std::size_t base = i * message.point_step;
    store_f32_le(message.data, base, coordinates[i][0]);
    store_f32_le(message.data, base + 4U, coordinates[i][1]);
    store_f32_le(message.data, base + 8U, coordinates[i][2]);
    store_u16_le(message.data, base + 12U, intensities[i]);
    store_u16_le(message.data, base + 14U, rings[i]);
  }
  return message;
}

template<typename MessageT>
std::string rep2011_type_hash()
{
#if MOONSPAN_HAS_REP2011_TYPE_HASH
  const auto * type_support = rosidl_typesupport_cpp::get_message_type_support_handle<MessageT>();
  if (type_support == nullptr || type_support->get_type_hash_func == nullptr) {
    throw std::runtime_error("REP-2011 type hash callback unavailable");
  }
  const rosidl_type_hash_t * type_hash = type_support->get_type_hash_func(type_support);
  if (type_hash == nullptr) {
    throw std::runtime_error("REP-2011 type hash callback returned null");
  }
  rcutils_allocator_t allocator = rcutils_get_default_allocator();
  char * text = nullptr;
  if (rosidl_stringify_type_hash(type_hash, allocator, &text) != RCUTILS_RET_OK || text == nullptr) {
    throw std::runtime_error("REP-2011 type hash string conversion failed");
  }
  std::string result(text);
  allocator.deallocate(text, allocator.state);
  return result;
#else
  return {};
#endif
}

std::string cdr_endianness(const std::vector<std::uint8_t> & bytes)
{
  if (bytes.size() < 4U || bytes[0] != 0U) {
    throw std::runtime_error("serialized payload lacks a DDS CDR encapsulation header");
  }
  if (bytes[1] == 0U) {
    return "big";
  }
  if (bytes[1] == 1U) {
    return "little";
  }
  throw std::runtime_error("serialized payload has an unknown DDS CDR encapsulation kind");
}

template<typename MessageT>
std::vector<std::uint8_t> serialize_native(const MessageT & message)
{
  rclcpp::Serialization<MessageT> serializer;
  rclcpp::SerializedMessage serialized(kSerializedCapacity);
  auto & raw = serialized.get_rcl_serialized_message();
  const std::size_t initial_capacity = raw.buffer_capacity;
  std::memset(raw.buffer, 0, raw.buffer_capacity);
  serializer.serialize_message(&message, &serialized);
  if (raw.buffer_capacity > initial_capacity || raw.buffer_capacity < raw.buffer_length) {
    throw std::runtime_error(
            "serialized message escaped the zero-filled fixed buffer: initial capacity " +
            std::to_string(initial_capacity) + ", final capacity " +
            std::to_string(raw.buffer_capacity) + ", length " +
            std::to_string(raw.buffer_length));
  }

  MessageT decoded;
  serializer.deserialize_message(&serialized, &decoded);
  if (!(decoded == message)) {
    throw std::runtime_error("native ROS serialization roundtrip changed the message");
  }
  return {raw.buffer, raw.buffer + raw.buffer_length};
}

std::vector<std::uint8_t> serialize_primitive_big_endian(
  const moonspan_cdr_interfaces::msg::PrimitiveScalars & message)
{
  std::vector<char> storage(kSerializedCapacity, 0);
  eprosima::fastcdr::FastBuffer buffer(storage.data(), storage.size());
#if FASTCDR_VERSION_MAJOR >= 2
  eprosima::fastcdr::Cdr encoder(
    buffer, eprosima::fastcdr::Cdr::BIG_ENDIANNESS, eprosima::fastcdr::DDS_CDR);
#else
  eprosima::fastcdr::Cdr encoder(
    buffer, eprosima::fastcdr::Cdr::BIG_ENDIANNESS, eprosima::fastcdr::Cdr::DDS_CDR);
#endif
  encoder.serialize_encapsulation();
  if (!moonspan_cdr_interfaces::msg::typesupport_fastrtps_cpp::cdr_serialize(message, encoder)) {
    throw std::runtime_error("Fast-CDR big-endian serialization failed");
  }
#if FASTCDR_VERSION_MAJOR >= 2
  const std::size_t length = encoder.get_serialized_data_length();
#else
  const std::size_t length = encoder.getSerializedDataLength();
#endif

  eprosima::fastcdr::FastBuffer decode_buffer(storage.data(), length);
#if FASTCDR_VERSION_MAJOR >= 2
  eprosima::fastcdr::Cdr decoder(
    decode_buffer, eprosima::fastcdr::Cdr::BIG_ENDIANNESS, eprosima::fastcdr::DDS_CDR);
#else
  eprosima::fastcdr::Cdr decoder(
    decode_buffer, eprosima::fastcdr::Cdr::BIG_ENDIANNESS, eprosima::fastcdr::Cdr::DDS_CDR);
#endif
  decoder.read_encapsulation();
  moonspan_cdr_interfaces::msg::PrimitiveScalars decoded;
  if (!moonspan_cdr_interfaces::msg::typesupport_fastrtps_cpp::cdr_deserialize(decoder, decoded)) {
    throw std::runtime_error("Fast-CDR big-endian deserialization failed");
  }
  if (!(decoded == message)) {
    throw std::runtime_error("big-endian Fast-CDR roundtrip changed the message");
  }
  return {
    reinterpret_cast<const std::uint8_t *>(storage.data()),
    reinterpret_cast<const std::uint8_t *>(storage.data()) + length};
}

void write_bytes(const fs::path & path, const std::vector<std::uint8_t> & bytes)
{
  std::ofstream stream(path, std::ios::binary | std::ios::trunc);
  if (!stream) {
    throw std::runtime_error("failed to open output file: " + path.string());
  }
  stream.write(reinterpret_cast<const char *>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
  if (!stream) {
    throw std::runtime_error("failed to write output file: " + path.string());
  }
}

template<typename MessageT>
SummaryRow write_native_fixture(
  const fs::path & output_dir, const std::string & fixture_id, const MessageT & message)
{
  const auto bytes = serialize_native(message);
  write_bytes(output_dir / (fixture_id + ".bin"), bytes);
  return {
    fixture_id,
    rosidl_generator_traits::name<MessageT>(),
    "rmw_serialize_zero_padding_v1",
    cdr_endianness(bytes),
    rep2011_type_hash<MessageT>(),
    bytes.size(),
  };
}

void write_summary(const fs::path & output_dir, const std::vector<SummaryRow> & rows)
{
  std::ofstream stream(output_dir / "summary.tsv", std::ios::trunc);
  if (!stream) {
    throw std::runtime_error("failed to open summary.tsv");
  }
  stream << "fixture_id\ttype_name\tserializer\tendianness\ttype_hash\tbyte_length\n";
  for (const auto & row : rows) {
    stream << row.fixture_id << '\t' << row.type_name << '\t' << row.serializer << '\t'
           << row.endianness << '\t' << row.type_hash << '\t' << row.byte_length << '\n';
  }
}

}  // namespace

int main(int argc, char ** argv)
{
  try {
    if (argc != 2) {
      std::cerr << "usage: moonspan_cdr_generate OUTPUT_DIR\n";
      return 2;
    }
    const fs::path output_dir(argv[1]);
    fs::create_directories(output_dir);

    const auto primitive = make_primitive_scalars();
    const auto collections = make_collections();
    const auto nested = make_nested_sample();
    std::vector<SummaryRow> rows;
    rows.push_back(write_native_fixture(output_dir, "primitive_scalars", primitive));
    rows.push_back(write_native_fixture(output_dir, "collections", collections));
    rows.push_back(write_native_fixture(output_dir, "nested_sample", nested));
    rows.push_back(write_native_fixture(output_dir, "point_cloud2", make_point_cloud2()));

    moonspan_cdr_interfaces::srv::EchoNested::Request request;
    request.input = nested;
    rows.push_back(write_native_fixture(output_dir, "echo_nested_request", request));

    moonspan_cdr_interfaces::srv::EchoNested::Response response;
    response.output = nested;
    response.accepted = true;
    rows.push_back(write_native_fixture(output_dir, "echo_nested_response", response));

    moonspan_cdr_interfaces::action::MeasureSequence::Goal goal;
    goal.target = collections;
    rows.push_back(write_native_fixture(output_dir, "measure_sequence_goal", goal));

    moonspan_cdr_interfaces::action::MeasureSequence::Result result;
    result.result = nested;
    rows.push_back(write_native_fixture(output_dir, "measure_sequence_result", result));

    moonspan_cdr_interfaces::action::MeasureSequence::Feedback feedback;
    feedback.progress = 0.625F;
    feedback.sample = nested;
    rows.push_back(write_native_fixture(output_dir, "measure_sequence_feedback", feedback));

    const auto big_endian = serialize_primitive_big_endian(primitive);
    write_bytes(output_dir / "primitive_scalars_big_endian.bin", big_endian);
    rows.push_back({
      "primitive_scalars_big_endian",
      rosidl_generator_traits::name<moonspan_cdr_interfaces::msg::PrimitiveScalars>(),
      "rosidl_typesupport_fastrtps_cpp",
      cdr_endianness(big_endian),
      rep2011_type_hash<moonspan_cdr_interfaces::msg::PrimitiveScalars>(),
      big_endian.size(),
    });

    write_summary(output_dir, rows);
    std::cout << "generated " << rows.size() << " fixtures\n";
    return 0;
  } catch (const std::exception & error) {
    std::cerr << "moonspan_cdr_generate: " << error.what() << '\n';
    return 1;
  }
}
