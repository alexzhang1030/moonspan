//! R2WP v0 encoders: deterministic CBOR, bootstrap records, and selected
//! frames.
//!
//! The parsers in this module tree are the frozen oracle; every encoder here
//! is proven by encode → parse round-trips in `super::tests`. Encoders enforce
//! the same absolute bounds the receivers enforce so an encoding peer can
//! never produce wire bytes its own parser would reject.

use super::bootstrap::{
    BOOTSTRAP_PAYLOAD_MAX_BYTES, BOOTSTRAP_PREFIX_LENGTH, BootstrapErrorRecord, BufferCapabilities,
    ClientHello, EffectiveLimits, RequestedLimits, ServerHello, TransportCapabilities,
};
use super::cbor::{CborValue, MAX_MAP_ENTRIES, MAX_NESTING_DEPTH};
use super::control::CONTROL_PAYLOAD_MAX_BYTES;
use super::extension::{EXTENSION_AREA_MAX_BYTES, R2wpExtension};
use super::frame::{
    FRAME_HEADER_LENGTH, FRAME_PAYLOAD_MAX_BYTES, OPCODE_CONTROL_CBOR, PRIORITY_CONTROL,
};
use std::borrow::Cow;

const MAGIC: [u8; 4] = [0x52, 0x32, 0x57, 0x50]; // R2WP
const BOOTSTRAP_VERSION: u8 = 0;
const KIND_CLIENT_HELLO: u8 = 1;
const KIND_SERVER_HELLO: u8 = 2;
const KIND_BOOTSTRAP_ERROR: u8 = 3;

/// Sender-side encoding failure (a bound the peer's receiver would reject).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncodeError {
    pub reason: &'static str,
}

impl EncodeError {
    #[must_use]
    pub const fn new(reason: &'static str) -> Self {
        Self { reason }
    }
}

impl std::fmt::Display for EncodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "encode {}", self.reason)
    }
}

impl std::error::Error for EncodeError {}

// ---------- deterministic CBOR ----------

fn write_head(out: &mut Vec<u8>, major: u8, argument: u64) {
    let mt = major << 5;
    if argument <= 23 {
        out.push(mt | (argument as u8));
    } else if argument <= 0xff {
        out.push(mt | 24);
        out.push(argument as u8);
    } else if argument <= 0xffff {
        out.push(mt | 25);
        out.extend_from_slice(&(argument as u16).to_be_bytes());
    } else if argument <= 0xffff_ffff {
        out.push(mt | 26);
        out.extend_from_slice(&(argument as u32).to_be_bytes());
    } else {
        out.push(mt | 27);
        out.extend_from_slice(&argument.to_be_bytes());
    }
}

fn encode_value(out: &mut Vec<u8>, value: &CborValue<'_>, depth: usize) -> Result<(), EncodeError> {
    match value {
        CborValue::Null => out.push(0xf6),
        CborValue::Bool(false) => out.push(0xf4),
        CborValue::Bool(true) => out.push(0xf5),
        CborValue::Unsigned(v) => write_head(out, 0, *v),
        CborValue::Negative(v) => {
            // value = -1 - argument, valid range [-2^64, -1]
            if *v >= 0 {
                return Err(EncodeError::new("negative_out_of_range"));
            }
            let argument = i128::from(-1) - v;
            if argument > i128::from(u64::MAX) {
                return Err(EncodeError::new("negative_out_of_range"));
            }
            write_head(out, 1, argument as u64);
        }
        CborValue::Bytes(b) => {
            write_head(out, 2, b.len() as u64);
            out.extend_from_slice(b);
        }
        CborValue::Text(t) => {
            write_head(out, 3, t.len() as u64);
            out.extend_from_slice(t.as_bytes());
        }
        CborValue::Array(items) => {
            let next = depth + 1;
            if next > MAX_NESTING_DEPTH {
                return Err(EncodeError::new("nesting_depth_exceeded"));
            }
            write_head(out, 4, items.len() as u64);
            for item in items {
                encode_value(out, item, next)?;
            }
        }
        CborValue::Map(entries) => {
            let next = depth + 1;
            if next > MAX_NESTING_DEPTH {
                return Err(EncodeError::new("nesting_depth_exceeded"));
            }
            if entries.len() > MAX_MAP_ENTRIES {
                return Err(EncodeError::new("map_entries_exceeded"));
            }
            let mut sorted: Vec<&(u64, CborValue<'_>)> = entries.iter().collect();
            sorted.sort_by_key(|(k, _)| *k);
            for pair in sorted.windows(2) {
                if pair[0].0 == pair[1].0 {
                    return Err(EncodeError::new("duplicate_map_key"));
                }
            }
            write_head(out, 5, sorted.len() as u64);
            for (key, val) in sorted {
                write_head(out, 0, *key);
                encode_value(out, val, next)?;
            }
        }
    }
    Ok(())
}

/// Encode one value under the R2WP v0 deterministic CBOR profile
/// (shortest-form heads, ascending unique unsigned map keys, bounded depth).
pub fn encode_deterministic_cbor(value: &CborValue<'_>) -> Result<Vec<u8>, EncodeError> {
    let mut out = Vec::new();
    encode_value(&mut out, value, 0)?;
    Ok(out)
}

// ---------- bootstrap ----------

fn owned_map(entries: Vec<(u64, CborValue<'static>)>) -> CborValue<'static> {
    CborValue::Map(entries)
}

fn transport_value(caps: &TransportCapabilities) -> CborValue<'static> {
    let mut entries =
        vec![(1, CborValue::Bool(caps.webtransport_http3)), (2, CborValue::Bool(caps.binary_wss))];
    if let Some(size) = caps.max_datagram_size {
        entries.push((3, CborValue::Unsigned(u64::from(size))));
    }
    owned_map(entries)
}

fn buffer_value(caps: &BufferCapabilities) -> CborValue<'static> {
    owned_map(vec![
        (1, CborValue::Bool(caps.transferable_arraybuffer)),
        (2, CborValue::Bool(caps.shared_arraybuffer)),
    ])
}

fn capability_list_value(ids: &[u16]) -> CborValue<'static> {
    CborValue::Array(ids.iter().map(|id| CborValue::Unsigned(u64::from(*id))).collect())
}

fn requested_limits_value(limits: &RequestedLimits) -> CborValue<'static> {
    let mut entries = Vec::new();
    if let Some(v) = limits.max_channels {
        entries.push((1, CborValue::Unsigned(u64::from(v))));
    }
    if let Some(v) = limits.max_session_bytes {
        entries.push((2, CborValue::Unsigned(v)));
    }
    if let Some(v) = limits.max_message_bytes {
        entries.push((3, CborValue::Unsigned(u64::from(v))));
    }
    if let Some(v) = limits.max_control_payload_bytes {
        entries.push((4, CborValue::Unsigned(u64::from(v))));
    }
    owned_map(entries)
}

fn effective_limits_value(limits: &EffectiveLimits) -> CborValue<'static> {
    owned_map(vec![
        (1, CborValue::Unsigned(u64::from(limits.max_channels))),
        (2, CborValue::Unsigned(limits.max_session_bytes)),
        (3, CborValue::Unsigned(u64::from(limits.max_message_bytes))),
        (4, CborValue::Unsigned(u64::from(limits.max_control_payload_bytes))),
    ])
}

fn bootstrap_record(kind: u8, payload: &CborValue<'_>) -> Result<Vec<u8>, EncodeError> {
    let body = encode_deterministic_cbor(payload)?;
    if body.len() > BOOTSTRAP_PAYLOAD_MAX_BYTES as usize {
        return Err(EncodeError::new("bootstrap_payload_too_large"));
    }
    let mut out = Vec::with_capacity(BOOTSTRAP_PREFIX_LENGTH + body.len());
    out.extend_from_slice(&MAGIC);
    out.push(BOOTSTRAP_VERSION);
    out.push(kind);
    out.extend_from_slice(&0u16.to_be_bytes());
    out.extend_from_slice(&(body.len() as u32).to_be_bytes());
    out.extend_from_slice(&body);
    Ok(out)
}

/// Encode a complete ClientHello bootstrap record (prefix + payload).
pub fn encode_client_hello(hello: &ClientHello) -> Result<Vec<u8>, EncodeError> {
    let payload = owned_map(vec![
        (
            1,
            CborValue::Array(
                hello.wire_versions.iter().map(|v| CborValue::Unsigned(u64::from(*v))).collect(),
            ),
        ),
        (2, transport_value(&hello.transport_capabilities)),
        (3, buffer_value(&hello.buffer_capabilities)),
        (4, requested_limits_value(&hello.requested_limits)),
        (6, capability_list_value(&hello.extension_capabilities)),
    ]);
    bootstrap_record(KIND_CLIENT_HELLO, &payload)
}

/// Encode a complete ServerHello bootstrap record (prefix + payload).
pub fn encode_server_hello(hello: &ServerHello) -> Result<Vec<u8>, EncodeError> {
    let payload = owned_map(vec![
        (1, CborValue::Unsigned(u64::from(hello.selected_wire_version))),
        (2, transport_value(&hello.transport_capabilities)),
        (3, buffer_value(&hello.buffer_capabilities)),
        (4, effective_limits_value(&hello.effective_limits)),
        (6, capability_list_value(&hello.extension_capabilities)),
    ]);
    bootstrap_record(KIND_SERVER_HELLO, &payload)
}

/// Encode a complete BootstrapError record (prefix + payload).
pub fn encode_bootstrap_error(record: &BootstrapErrorRecord) -> Result<Vec<u8>, EncodeError> {
    let mut entries = vec![(1, CborValue::Unsigned(u64::from(record.code)))];
    if let Some(message) = &record.message {
        entries.push((2, CborValue::Text(Cow::Owned(message.clone()))));
    }
    if let Some(detail) = &record.detail {
        entries.push((3, CborValue::Text(Cow::Owned(detail.clone()))));
    }
    bootstrap_record(KIND_BOOTSTRAP_ERROR, &owned_map(entries))
}

// ---------- extension TLVs ----------

/// Encode an extension area from strictly ascending assigned/known TLVs
/// (individual zero padding to 4-byte alignment).
pub fn encode_extension_area(extensions: &[R2wpExtension<'_>]) -> Result<Vec<u8>, EncodeError> {
    let mut out = Vec::new();
    let mut prev: Option<u8> = None;
    for ext in extensions {
        if let Some(p) = prev
            && ext.type_id <= p
        {
            return Err(EncodeError::new("extension_order"));
        }
        prev = Some(ext.type_id);
        if ext.value.len() > usize::from(u16::MAX) {
            return Err(EncodeError::new("extension_value_too_large"));
        }
        out.push(ext.type_id);
        out.push(if ext.critical { 0x01 } else { 0x00 });
        out.extend_from_slice(&(ext.value.len() as u16).to_be_bytes());
        out.extend_from_slice(ext.value);
        while !out.len().is_multiple_of(4) {
            out.push(0);
        }
    }
    if out.len() > EXTENSION_AREA_MAX_BYTES {
        return Err(EncodeError::new("extension_area_too_large"));
    }
    Ok(out)
}

// ---------- selected-version frames ----------

/// Sender-side frame header fields (lengths are derived from the buffers).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrameHeader {
    pub version: u8,
    pub opcode: u8,
    pub flags: u16,
    pub channel_id: u32,
    pub sequence: u64,
    pub source_time_ns: i64,
    pub priority: u8,
    pub clock_id: u8,
}

/// Write the 32-byte frame header in place over `out[..FRAME_HEADER_LENGTH]`.
///
/// Supports the one-copy sample path: producers reserve a 32-byte prefix in
/// front of the payload and the sender fills the header without moving the
/// payload bytes.
pub fn write_frame_header(
    header: &FrameHeader,
    payload_len: u32,
    extension_len: u16,
    out: &mut [u8],
) -> Result<(), EncodeError> {
    if out.len() < FRAME_HEADER_LENGTH {
        return Err(EncodeError::new("header_buffer_too_small"));
    }
    if payload_len > FRAME_PAYLOAD_MAX_BYTES {
        return Err(EncodeError::new("payload_too_large"));
    }
    if header.opcode == OPCODE_CONTROL_CBOR && payload_len as usize > CONTROL_PAYLOAD_MAX_BYTES {
        return Err(EncodeError::new("control_payload_too_large"));
    }
    out[0] = header.version;
    out[1] = header.opcode;
    out[2..4].copy_from_slice(&header.flags.to_be_bytes());
    out[4..8].copy_from_slice(&header.channel_id.to_be_bytes());
    out[8..16].copy_from_slice(&header.sequence.to_be_bytes());
    out[16..24].copy_from_slice(&header.source_time_ns.to_be_bytes());
    out[24..28].copy_from_slice(&payload_len.to_be_bytes());
    out[28..30].copy_from_slice(&extension_len.to_be_bytes());
    out[30] = header.priority;
    out[31] = header.clock_id;
    Ok(())
}

/// Encode one complete selected-version frame (header + extension + payload).
pub fn encode_frame(
    header: &FrameHeader,
    extension_area: &[u8],
    payload: &[u8],
) -> Result<Vec<u8>, EncodeError> {
    if !extension_area.len().is_multiple_of(4) || extension_area.len() > EXTENSION_AREA_MAX_BYTES {
        return Err(EncodeError::new("extension_area_bounds"));
    }
    if payload.len() > FRAME_PAYLOAD_MAX_BYTES as usize {
        return Err(EncodeError::new("payload_too_large"));
    }
    let mut out = vec![0u8; FRAME_HEADER_LENGTH + extension_area.len() + payload.len()];
    write_frame_header(header, payload.len() as u32, extension_area.len() as u16, &mut out)?;
    out[FRAME_HEADER_LENGTH..FRAME_HEADER_LENGTH + extension_area.len()]
        .copy_from_slice(extension_area);
    out[FRAME_HEADER_LENGTH + extension_area.len()..].copy_from_slice(payload);
    Ok(out)
}

/// Encode a CONTROL_CBOR frame from a control-message CBOR map
/// (channel 0, priority CONTROL, clock NONE).
pub fn encode_control_frame(
    version: u8,
    sequence: u64,
    message: &CborValue<'_>,
) -> Result<Vec<u8>, EncodeError> {
    let payload = encode_deterministic_cbor(message)?;
    encode_frame(
        &FrameHeader {
            version,
            opcode: OPCODE_CONTROL_CBOR,
            flags: 0,
            channel_id: 0,
            sequence,
            source_time_ns: 0,
            priority: PRIORITY_CONTROL,
            clock_id: 0,
        },
        &[],
        &payload,
    )
}
