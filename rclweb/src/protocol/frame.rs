//! R2WP v0 selected-version frame decoder (receiver validation steps 1–16).

use super::control::{
    CONTROL_PAYLOAD_MAX_BYTES, ControlMessage, decode_control_message, map_control_error,
};
use super::error::ProtocolError;
use super::extension::{
    EXTENSION_AREA_MAX_BYTES, R2wpExtension, TRACE_CONTEXT_EXTENSION_TYPE, decode_extension_area,
    map_extension_error,
};
use std::collections::BTreeSet;

/// Fixed v0 contract: selected_version_frame.header_len.
pub const FRAME_HEADER_LENGTH: usize = 32;
/// Fixed v0 contract: absolute_limits.frame_payload_max_bytes.
pub const FRAME_PAYLOAD_MAX_BYTES: u32 = 67_108_864;
/// Fixed v0 contract: absolute_limits.extension_area_max_bytes (shared with extension decoder).
pub const FRAME_EXTENSION_MAX_BYTES: usize = EXTENSION_AREA_MAX_BYTES;
/// Default selected wire version for v0.
pub const DEFAULT_SELECTED_VERSION: u8 = 0;

pub const OPCODE_CONTROL_CBOR: u8 = 1;
pub const OPCODE_ROS_SAMPLE: u8 = 2;
pub const OPCODE_SERVICE_REQUEST: u8 = 3;
pub const OPCODE_SERVICE_RESPONSE: u8 = 4;
pub const OPCODE_ACTION_GOAL: u8 = 5;
pub const OPCODE_ACTION_FEEDBACK: u8 = 6;
pub const OPCODE_ACTION_RESULT: u8 = 7;
pub const OPCODE_ACTION_STATUS: u8 = 8;
pub const OPCODE_ACTION_CANCEL: u8 = 9;
pub const OPCODE_MEDIA_CHUNK: u8 = 10;
pub const OPCODE_RECORDING_CHUNK: u8 = 11;
pub const OPCODE_ASSET_CHUNK: u8 = 12;

pub const FLAG_ROS_RELIABLE: u16 = 0x0001;
pub const FLAG_KEYFRAME: u16 = 0x0002;
pub const FLAG_TRACE_PRESENT: u16 = 0x0004;
pub const FLAG_RETAINED: u16 = 0x0008;
pub const FLAG_FRAGMENT: u16 = 0x0010;
pub const FLAG_ASSIGNED_MASK: u16 = 0x001f;

pub const PRIORITY_CONTROL: u8 = 0;
pub const CLOCK_NONE: u8 = 0;

/// Receiver options for selected-frame validation.
#[derive(Debug, Clone)]
pub struct FrameOptions {
    pub selected_version: u8,
    pub experimental_opcodes_enabled: bool,
    pub available_clock_ids: BTreeSet<u8>,
}

impl Default for FrameOptions {
    fn default() -> Self {
        Self {
            selected_version: DEFAULT_SELECTED_VERSION,
            experimental_opcodes_enabled: false,
            available_clock_ids: [0u8, 1, 2, 3, 4].into_iter().collect(),
        }
    }
}

/// Frame payload: application bytes or validated CONTROL_CBOR.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FramePayload<'a> {
    Application(&'a [u8]),
    Control(ControlMessage<'a>),
}

/// Decoded selected-version frame (steps 1–16).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedFrame<'a> {
    pub version: u8,
    pub opcode: u8,
    pub flags: u16,
    pub channel_id: u32,
    pub sequence: u64,
    pub source_time_ns: i64,
    pub payload_len: u32,
    pub extension_len: u16,
    pub priority: u8,
    pub clock_id: u8,
    pub extensions: Vec<R2wpExtension<'a>>,
    pub payload: FramePayload<'a>,
}

fn read_u16_be(b: &[u8], o: usize) -> u16 {
    u16::from_be_bytes([b[o], b[o + 1]])
}
fn read_u32_be(b: &[u8], o: usize) -> u32 {
    u32::from_be_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}
fn read_u64_be(b: &[u8], o: usize) -> u64 {
    u64::from_be_bytes([
        b[o],
        b[o + 1],
        b[o + 2],
        b[o + 3],
        b[o + 4],
        b[o + 5],
        b[o + 6],
        b[o + 7],
    ])
}
fn read_i64_be(b: &[u8], o: usize) -> i64 {
    read_u64_be(b, o) as i64
}

fn is_assigned_opcode(opcode: u8) -> bool {
    (OPCODE_CONTROL_CBOR..=OPCODE_ASSET_CHUNK).contains(&opcode)
}
fn is_experimental_opcode(opcode: u8) -> bool {
    (128..=255).contains(&opcode)
}

fn opcode_allows_ros_reliable(opcode: u8) -> bool {
    matches!(
        opcode,
        OPCODE_ROS_SAMPLE
            | OPCODE_SERVICE_REQUEST
            | OPCODE_SERVICE_RESPONSE
            | OPCODE_ACTION_GOAL
            | OPCODE_ACTION_FEEDBACK
            | OPCODE_ACTION_RESULT
            | OPCODE_ACTION_STATUS
            | OPCODE_ACTION_CANCEL
    )
}

fn checked_add(a: usize, b: usize, offset: usize) -> Result<usize, ProtocolError> {
    a.checked_add(b)
        .ok_or_else(|| ProtocolError::message_too_large_frame("payload_too_large", offset, 4))
}

/// Parse a complete selected-version frame (receiver steps 1–16).
pub fn parse_frame<'a>(
    bytes: &'a [u8],
    options: Option<&FrameOptions>,
) -> Result<DecodedFrame<'a>, ProtocolError> {
    let default_opts = FrameOptions::default();
    let opts = options.unwrap_or(&default_opts);

    // Step 1
    if bytes.len() < FRAME_HEADER_LENGTH {
        return Err(ProtocolError::malformed_frame("truncated_header", 0, 1));
    }

    let version = bytes[0];
    let opcode = bytes[1];
    let flags = read_u16_be(bytes, 2);
    let channel_id = read_u32_be(bytes, 4);
    let sequence = read_u64_be(bytes, 8);
    let source_time_ns = read_i64_be(bytes, 16);
    let payload_len = read_u32_be(bytes, 24);
    let extension_len = read_u16_be(bytes, 28);
    let priority = bytes[30];
    let clock_id = bytes[31];

    // Step 2
    if version != opts.selected_version {
        return Err(ProtocolError::unsupported_version_frame(
            "unsupported_version",
            0,
            2,
        ));
    }

    // Step 3 — compare header u16 extension_len via lossless usize widen.
    if usize::from(extension_len) > FRAME_EXTENSION_MAX_BYTES {
        return Err(ProtocolError::message_too_large_frame(
            "extension_too_large",
            28,
            3,
        ));
    }
    if payload_len > FRAME_PAYLOAD_MAX_BYTES {
        return Err(ProtocolError::message_too_large_frame(
            "payload_too_large",
            24,
            3,
        ));
    }
    if opcode == OPCODE_CONTROL_CBOR && payload_len as usize > CONTROL_PAYLOAD_MAX_BYTES {
        return Err(ProtocolError::message_too_large_frame(
            "control_payload_too_large",
            24,
            3,
        ));
    }

    // Step 4
    let after_header = checked_add(FRAME_HEADER_LENGTH, extension_len as usize, 0)?;
    let expected_total = checked_add(after_header, payload_len as usize, 0)?;
    if bytes.len() != expected_total {
        return Err(ProtocolError::malformed_frame("exact_total_mismatch", 0, 4));
    }

    // Step 5
    if is_assigned_opcode(opcode) {
        // ok
    } else if is_experimental_opcode(opcode) {
        if !opts.experimental_opcodes_enabled {
            return Err(ProtocolError::unsupported_opcode(
                "unsupported_opcode",
                1,
                5,
            ));
        }
    } else {
        return Err(ProtocolError::unsupported_opcode(
            "unsupported_opcode",
            1,
            5,
        ));
    }

    // Step 6
    if flags & !FLAG_ASSIGNED_MASK != 0 {
        return Err(ProtocolError::unsupported_flags("unknown_flag_bits", 2, 6));
    }

    // Step 7
    if flags & FLAG_FRAGMENT != 0 {
        return Err(ProtocolError::unsupported_flags(
            "fragment_prohibited",
            2,
            7,
        ));
    }
    if flags & FLAG_KEYFRAME != 0 && opcode != OPCODE_MEDIA_CHUNK {
        return Err(ProtocolError::unsupported_flags("keyframe_opcode", 2, 7));
    }
    // RETAINED remains ROS_SAMPLE-only. ROS_RELIABLE is also legal on Service /
    // Action opcodes (R3-01 reliable operation streams).
    if flags & FLAG_RETAINED != 0 && opcode != OPCODE_ROS_SAMPLE {
        return Err(ProtocolError::unsupported_flags("ros_flag_opcode", 2, 7));
    }
    if flags & FLAG_ROS_RELIABLE != 0 && !opcode_allows_ros_reliable(opcode) {
        return Err(ProtocolError::unsupported_flags("ros_flag_opcode", 2, 7));
    }

    // Step 8
    if opcode == OPCODE_CONTROL_CBOR {
        if channel_id != 0 {
            return Err(ProtocolError::protocol_violation("channel_class", 4, 8));
        }
    } else if channel_id == 0 {
        return Err(ProtocolError::protocol_violation("channel_class", 4, 8));
    }

    // Step 9
    if priority > 4 {
        return Err(ProtocolError::protocol_violation(
            "unassigned_priority",
            30,
            9,
        ));
    }
    if opcode == OPCODE_CONTROL_CBOR && priority != PRIORITY_CONTROL {
        return Err(ProtocolError::protocol_violation("control_priority", 30, 9));
    }

    // Step 10
    if clock_id > 4 {
        return Err(ProtocolError::protocol_violation(
            "unassigned_clock",
            31,
            10,
        ));
    }

    // Step 11
    if clock_id == CLOCK_NONE && source_time_ns != 0 {
        return Err(ProtocolError::protocol_violation(
            "none_requires_zero_time",
            16,
            11,
        ));
    }

    // Step 12
    if clock_id != CLOCK_NONE && !opts.available_clock_ids.contains(&clock_id) {
        return Err(ProtocolError::clock_unavailable(
            "clock_unavailable",
            31,
            12,
        ));
    }

    let ext_start = FRAME_HEADER_LENGTH;
    let ext_end = ext_start + extension_len as usize;
    let payload_start = ext_end;
    let payload_end = payload_start + payload_len as usize;

    // Steps 13–14
    let extensions = if extension_len > 0 {
        let area = &bytes[ext_start..ext_end];
        match decode_extension_area(area) {
            Ok(exts) => exts,
            Err(e) => {
                let step = if e.reason == "unknown_critical" {
                    14
                } else {
                    13
                };
                return Err(map_extension_error(e, ext_start, step));
            }
        }
    } else {
        Vec::new()
    };

    // Step 15
    let trace_flag = flags & FLAG_TRACE_PRESENT != 0;
    let has_trace_ctx = extensions
        .iter()
        .any(|e| e.type_id == TRACE_CONTEXT_EXTENSION_TYPE);
    if trace_flag != has_trace_ctx {
        let offset = if trace_flag { 2 } else { ext_start };
        return Err(ProtocolError::protocol_violation(
            "trace_consistency",
            offset,
            15,
        ));
    }

    // Step 16
    let payload = if opcode == OPCODE_CONTROL_CBOR {
        let raw = &bytes[payload_start..payload_end];
        match decode_control_message(raw) {
            Ok(msg) => FramePayload::Control(msg),
            Err(e) => return Err(map_control_error(e, payload_start)),
        }
    } else {
        FramePayload::Application(&bytes[payload_start..payload_end])
    };

    Ok(DecodedFrame {
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

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn multi_invalid_priority_unassigned_before_control() {
        // priority 5 with CONTROL opcode: step 9a unassigned wins over control_priority.
        let mut bytes = vec![0u8; 32];
        bytes[0] = 0; // version
        bytes[1] = OPCODE_CONTROL_CBOR;
        // payload_len 0, extension 0 — exact total 32
        bytes[30] = 5; // unassigned priority
        let err = parse_frame(&bytes, None).unwrap_err();
        assert_eq!(err.reason, "unassigned_priority");
        assert_eq!(err.step, 9);
        assert_eq!(err.code, 25);
    }

    #[test]
    fn header_u64_sequence_and_i64_time_bounds() {
        let mut bytes = vec![0u8; FRAME_HEADER_LENGTH];
        bytes[0] = 0;
        bytes[1] = OPCODE_ROS_SAMPLE;
        bytes[4..8].copy_from_slice(&1u32.to_be_bytes());
        bytes[8..16].copy_from_slice(&u64::MAX.to_be_bytes());
        bytes[16..24].copy_from_slice(&i64::MIN.to_be_bytes());
        bytes[30] = 2;
        bytes[31] = 1; // SYSTEM clock
        let frame = parse_frame(&bytes, None).unwrap();
        assert_eq!(frame.sequence, u64::MAX);
        assert_eq!(frame.source_time_ns, i64::MIN);

        bytes[16..24].copy_from_slice(&i64::MAX.to_be_bytes());
        let frame = parse_frame(&bytes, None).unwrap();
        assert_eq!(frame.source_time_ns, i64::MAX);
    }

    #[test]
    fn experimental_opcode_128_parses_when_enabled() {
        let mut bytes = vec![0u8; FRAME_HEADER_LENGTH];
        bytes[0] = 0;
        bytes[1] = 128; // experimental opcode
        bytes[4..8].copy_from_slice(&1u32.to_be_bytes());
        bytes[30] = 2;
        bytes[31] = 0;
        let opts = FrameOptions {
            experimental_opcodes_enabled: true,
            ..FrameOptions::default()
        };
        let frame = parse_frame(&bytes, Some(&opts)).expect("experimental opcode 128");
        assert_eq!(frame.opcode, 128);
        assert_eq!(frame.channel_id, 1);
        match frame.payload {
            FramePayload::Application(p) => assert!(p.is_empty()),
            _ => panic!("expected application payload"),
        }
    }

    #[test]
    fn application_payload_borrows_input() {
        let mut bytes = vec![0u8; 36];
        bytes[0] = 0;
        bytes[1] = OPCODE_ROS_SAMPLE;
        bytes[4..8].copy_from_slice(&1u32.to_be_bytes());
        bytes[24..28].copy_from_slice(&4u32.to_be_bytes()); // payload_len 4
        bytes[30] = 2;
        bytes[31] = 0;
        bytes[32..36].copy_from_slice(&[0xaa, 0xbb, 0xcc, 0xdd]);
        let frame = parse_frame(&bytes, None).unwrap();
        match frame.payload {
            FramePayload::Application(p) => {
                assert_eq!(p, &[0xaa, 0xbb, 0xcc, 0xdd]);
                assert_eq!(p.as_ptr(), bytes[32..].as_ptr());
            }
            _ => panic!("expected application payload"),
        }
    }

    /// Build a minimal ROS_SAMPLE frame with a fixed extension area and empty app payload.
    fn frame_with_extension_area(area: &[u8]) -> Vec<u8> {
        assert!(area.len().is_multiple_of(4));
        assert!(area.len() <= 4096);
        let mut bytes = vec![0u8; FRAME_HEADER_LENGTH + area.len()];
        bytes[0] = 0;
        bytes[1] = OPCODE_ROS_SAMPLE;
        bytes[4..8].copy_from_slice(&1u32.to_be_bytes());
        bytes[28..30].copy_from_slice(&(area.len() as u16).to_be_bytes());
        bytes[30] = 2;
        bytes[31] = 0;
        bytes[FRAME_HEADER_LENGTH..].copy_from_slice(area);
        bytes
    }

    #[test]
    fn truncated_extension_value_returns_protocol_error() {
        // Extension area declares value_len beyond remaining; parse_frame stays total.
        let area = [128u8, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00, 0x00];
        let bytes = frame_with_extension_area(&area);
        let err = parse_frame(&bytes, None).expect_err("truncated extension value");
        assert_eq!(err.code, 3);
        assert_eq!(err.name, "malformed_frame");
        assert_eq!(err.reason, "extension_structural");
        assert_eq!(err.plane, "selected_frame");
        assert_eq!(err.step, 13);
        assert_eq!(err.offset, FRAME_HEADER_LENGTH + 4);
    }

    #[test]
    fn truncated_extension_huge_value_len_returns_protocol_error() {
        let area = [128u8, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00];
        let bytes = frame_with_extension_area(&area);
        let err = parse_frame(&bytes, None).expect_err("huge value_len");
        assert_eq!(err.code, 3);
        assert_eq!(err.reason, "extension_structural");
        assert_eq!(err.step, 13);
        assert_eq!(err.plane, "selected_frame");
    }
}
