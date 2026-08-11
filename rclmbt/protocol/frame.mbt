///|
/// R2WP v0 selected-version frame decoder (receiver validation steps 1–16).

///|
pub const FRAME_HEADER_LENGTH : Int = 32

///|
pub const FRAME_PAYLOAD_MAX_BYTES : UInt = 67108864U

///|
pub const FRAME_EXTENSION_MAX_BYTES : Int = EXTENSION_AREA_MAX_BYTES

///|
pub const DEFAULT_SELECTED_VERSION : Int = 0

///|
pub const OPCODE_CONTROL_CBOR : Int = 1

///|
pub const OPCODE_ROS_SAMPLE : Int = 2

///|
pub const OPCODE_SERVICE_REQUEST : Int = 3

///|
pub const OPCODE_SERVICE_RESPONSE : Int = 4

///|
pub const OPCODE_ACTION_GOAL : Int = 5

///|
pub const OPCODE_ACTION_FEEDBACK : Int = 6

///|
pub const OPCODE_ACTION_RESULT : Int = 7

///|
pub const OPCODE_ACTION_STATUS : Int = 8

///|
pub const OPCODE_ACTION_CANCEL : Int = 9

///|
pub const OPCODE_MEDIA_CHUNK : Int = 10

///|
pub const OPCODE_RECORDING_CHUNK : Int = 11

///|
pub const OPCODE_ASSET_CHUNK : Int = 12

///|
pub const FLAG_ROS_RELIABLE : Int = 0x0001

///|
pub const FLAG_KEYFRAME : Int = 0x0002

///|
pub const FLAG_TRACE_PRESENT : Int = 0x0004

///|
pub const FLAG_RETAINED : Int = 0x0008

///|
pub const FLAG_FRAGMENT : Int = 0x0010

///|
pub const FLAG_ASSIGNED_MASK : Int = 0x001f

///|
pub const PRIORITY_CONTROL : Int = 0

///|
pub const CLOCK_NONE : Int = 0

///|
/// Receiver options for selected-frame validation.
pub struct FrameOptions {
  selected_version : Int
  experimental_opcodes_enabled : Bool
  available_clock_ids : Array[Int]
}

///|
pub fn FrameOptions::default() -> FrameOptions {
  {
    selected_version: DEFAULT_SELECTED_VERSION,
    experimental_opcodes_enabled: false,
    available_clock_ids: [0, 1, 2, 3, 4],
  }
}

///|
/// Construct selected-frame receiver configuration from version, experimental
/// opcode policy, and available clock identifiers.
pub fn FrameOptions::new(
  selected_version : Int,
  experimental_opcodes_enabled : Bool,
  available_clock_ids : Array[Int],
) -> FrameOptions {
  { selected_version, experimental_opcodes_enabled, available_clock_ids }
}

///|
/// Frame payload: borrowed application bytes or validated CONTROL_CBOR.
pub enum FramePayload {
  Application(BytesView)
  Control(ControlMessage)
}

///|
/// Decoded selected-version frame (steps 1–16).
pub struct DecodedFrame {
  version : Int
  opcode : Int
  flags : Int
  channel_id : UInt
  sequence : UInt64
  source_time_ns : Int64
  payload_len : UInt
  extension_len : Int
  priority : Int
  clock_id : Int
  extensions : Array[R2wpExtension]
  payload : FramePayload
}

///|
fn frame_read_u16_be(bytes : BytesView, offset : Int) -> Int {
  let hi = bytes[offset].to_int()
  let lo = bytes[offset + 1].to_int()
  (hi << 8) | lo
}

///|
fn frame_read_u32_be(bytes : BytesView, offset : Int) -> UInt {
  let b0 = bytes[offset].to_int().reinterpret_as_uint()
  let b1 = bytes[offset + 1].to_int().reinterpret_as_uint()
  let b2 = bytes[offset + 2].to_int().reinterpret_as_uint()
  let b3 = bytes[offset + 3].to_int().reinterpret_as_uint()
  (b0 << 24) | (b1 << 16) | (b2 << 8) | b3
}

///|
fn frame_read_u64_be(bytes : BytesView, offset : Int) -> UInt64 {
  let mut n : UInt64 = 0UL
  let mut i = 0
  while i < 8 {
    n = (n << 8) | bytes[offset + i].to_int().to_uint64()
    i = i + 1
  }
  n
}

///|
fn frame_read_i64_be(bytes : BytesView, offset : Int) -> Int64 {
  frame_read_u64_be(bytes, offset).reinterpret_as_int64()
}

///|
fn is_assigned_opcode(opcode : Int) -> Bool {
  opcode >= OPCODE_CONTROL_CBOR && opcode <= OPCODE_ASSET_CHUNK
}

///|
fn is_experimental_opcode(opcode : Int) -> Bool {
  opcode >= 128 && opcode <= 255
}

///|
fn checked_add(a : Int, b : Int, offset : Int) -> Result[Int, ProtocolError] {
  let int_max = 2147483647
  if a < 0 || b < 0 || b > int_max - a {
    Err(ProtocolError::message_too_large_frame("payload_too_large", offset, 4))
  } else {
    Ok(a + b)
  }
}

///|
fn clock_is_available(opts : FrameOptions, clock_id : Int) -> Bool {
  for id in opts.available_clock_ids {
    if id == clock_id {
      return true
    }
  }
  false
}

///|
/// Parse a complete selected-version frame (receiver steps 1–16).
pub fn parse_frame(
  bytes : BytesView,
  options : FrameOptions?,
) -> Result[DecodedFrame, ProtocolError] {
  let opts = match options {
    Some(o) => o
    None => FrameOptions::default()
  }

  // Step 1: minimum length 32
  if bytes.length() < FRAME_HEADER_LENGTH {
    return Err(ProtocolError::malformed_frame("truncated_header", 0, 1))
  }

  let version = bytes[0].to_int()
  let opcode = bytes[1].to_int()
  let flags = frame_read_u16_be(bytes, 2)
  let channel_id = frame_read_u32_be(bytes, 4)
  let sequence = frame_read_u64_be(bytes, 8)
  let source_time_ns = frame_read_i64_be(bytes, 16)
  let payload_len = frame_read_u32_be(bytes, 24)
  let extension_len = frame_read_u16_be(bytes, 28)
  let priority = bytes[30].to_int()
  let clock_id = bytes[31].to_int()

  // Step 2: version equals selected
  if version != opts.selected_version {
    return Err(
      ProtocolError::unsupported_version_frame("unsupported_version", 0, 2),
    )
  }

  // Step 3: declared bounds vs absolute limits
  if extension_len > FRAME_EXTENSION_MAX_BYTES {
    return Err(
      ProtocolError::message_too_large_frame("extension_too_large", 28, 3),
    )
  }
  if payload_len > FRAME_PAYLOAD_MAX_BYTES {
    return Err(
      ProtocolError::message_too_large_frame("payload_too_large", 24, 3),
    )
  }
  // payload_len is at most the frame payload ceiling, so Int widen is exact.
  let payload_len_i = payload_len.reinterpret_as_int()
  if opcode == OPCODE_CONTROL_CBOR && payload_len_i > CONTROL_PAYLOAD_MAX_BYTES {
    return Err(
      ProtocolError::message_too_large_frame("control_payload_too_large", 24, 3),
    )
  }

  // Step 4: exact total length 32 + extension_len + payload_len
  let after_header = match checked_add(FRAME_HEADER_LENGTH, extension_len, 0) {
    Ok(n) => n
    Err(e) => return Err(e)
  }
  let expected_total = match checked_add(after_header, payload_len_i, 0) {
    Ok(n) => n
    Err(e) => return Err(e)
  }
  if bytes.length() != expected_total {
    return Err(ProtocolError::malformed_frame("exact_total_mismatch", 0, 4))
  }

  // Step 5: opcode assigned or capability-gated
  if is_assigned_opcode(opcode) {
    // ok
  } else if is_experimental_opcode(opcode) {
    if !opts.experimental_opcodes_enabled {
      return Err(ProtocolError::unsupported_opcode("unsupported_opcode", 1, 5))
    }
  } else {
    return Err(ProtocolError::unsupported_opcode("unsupported_opcode", 1, 5))
  }

  // Step 6: unknown flag bits
  if (flags & FLAG_ASSIGNED_MASK) != flags {
    return Err(ProtocolError::unsupported_flags("unknown_flag_bits", 2, 6))
  }

  // Step 7: early static flag/opcode constraints
  if (flags & FLAG_FRAGMENT) != 0 {
    return Err(ProtocolError::unsupported_flags("fragment_prohibited", 2, 7))
  }
  if (flags & FLAG_KEYFRAME) != 0 && opcode != OPCODE_MEDIA_CHUNK {
    return Err(ProtocolError::unsupported_flags("keyframe_opcode", 2, 7))
  }
  if ((flags & FLAG_ROS_RELIABLE) != 0 || (flags & FLAG_RETAINED) != 0) &&
    opcode != OPCODE_ROS_SAMPLE {
    return Err(ProtocolError::unsupported_flags("ros_flag_opcode", 2, 7))
  }

  // Step 8: channel 0 control / nonzero application (incl. experimental)
  if opcode == OPCODE_CONTROL_CBOR {
    if channel_id != 0U {
      return Err(ProtocolError::protocol_violation("channel_class", 4, 8))
    }
  } else if channel_id == 0U {
    return Err(ProtocolError::protocol_violation("channel_class", 4, 8))
  }

  // Step 9: numeric priority assigned 0..4, then CONTROL priority
  if priority > 4 {
    return Err(ProtocolError::protocol_violation("unassigned_priority", 30, 9))
  }
  if opcode == OPCODE_CONTROL_CBOR && priority != PRIORITY_CONTROL {
    return Err(ProtocolError::protocol_violation("control_priority", 30, 9))
  }

  // Step 10: numeric clock assigned 0..4
  if clock_id > 4 {
    return Err(ProtocolError::protocol_violation("unassigned_clock", 31, 10))
  }

  // Step 11: clock NONE requires source_time_ns 0
  if clock_id == CLOCK_NONE && source_time_ns != 0L {
    return Err(
      ProtocolError::protocol_violation("none_requires_zero_time", 16, 11),
    )
  }

  // Step 12: assigned clock availability (NONE is always available)
  if clock_id != CLOCK_NONE && !clock_is_available(opts, clock_id) {
    return Err(ProtocolError::clock_unavailable("clock_unavailable", 31, 12))
  }

  let ext_start = FRAME_HEADER_LENGTH
  let ext_end = ext_start + extension_len
  let payload_start = ext_end
  let payload_end = payload_start + payload_len_i

  // Steps 13–14: extension structural + unknown critical
  let extensions = if extension_len > 0 {
    let area = bytes[ext_start:ext_end]
    match decode_extension_area(area) {
      Ok(exts) => exts
      Err(e) => {
        let step = if e.reason == "unknown_critical" { 14 } else { 13 }
        return Err(map_extension_error(e, ext_start, step))
      }
    }
  } else {
    []
  }

  // Step 15: TRACE_PRESENT / TRACE_CONTEXT bidirectional consistency
  let trace_flag = (flags & FLAG_TRACE_PRESENT) != 0
  let mut has_trace_ctx = false
  for e in extensions {
    if e.type_id == TRACE_CONTEXT_EXTENSION_TYPE {
      has_trace_ctx = true
    }
  }
  if trace_flag != has_trace_ctx {
    let offset = if trace_flag { 2 } else { ext_start }
    return Err(
      ProtocolError::protocol_violation("trace_consistency", offset, 15),
    )
  }

  // Step 16: CONTROL_CBOR decode and CDDL shape
  let payload = if opcode == OPCODE_CONTROL_CBOR {
    let raw = bytes[payload_start:payload_end]
    match decode_control_message(raw) {
      Ok(msg) => FramePayload::Control(msg)
      Err(e) => return Err(map_control_error(e, payload_start))
    }
  } else {
    FramePayload::Application(bytes[payload_start:payload_end])
  }

  Ok({
    version,
    opcode,
    flags,
    channel_id,
    sequence,
    source_time_ns,
    payload_len,
    extension_len,
    priority,
    clock_id,
    extensions,
    payload,
  })
}
