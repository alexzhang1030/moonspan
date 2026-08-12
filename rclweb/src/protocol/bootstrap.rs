//! R2WP v0 bootstrap record parser (receiver validation order steps 1–9).

use super::cbor::{CborError, CborValue, decode_deterministic_cbor};
use super::error::ProtocolError;

/// Fixed v0 contract: bootstrap prefix length.
pub const BOOTSTRAP_PREFIX_LENGTH: usize = 12;
/// Fixed v0 contract: `absolute_limits.bootstrap_payload_max_bytes`.
pub const BOOTSTRAP_PAYLOAD_MAX_BYTES: u32 = 65_535;

const MAGIC: [u8; 4] = [0x52, 0x32, 0x57, 0x50]; // R2WP
const BOOTSTRAP_VERSION: u8 = 0;

const KIND_CLIENT_HELLO: u8 = 1;
const KIND_SERVER_HELLO: u8 = 2;
const KIND_BOOTSTRAP_ERROR: u8 = 3;

const UTF8_TEXT_MAX_BYTES: usize = 4096;
const WIRE_VERSIONS_MAX: usize = 16;
const CAPABILITY_IDS_MAX: usize = 64;
const CAPABILITY_ID_MIN: u16 = 1;
const CAPABILITY_ID_MAX: u16 = 65_535;

const EFFECTIVE_MAX_CHANNELS: u32 = 65_535;
const EFFECTIVE_MAX_SESSION_BYTES: u64 = 4_294_967_296;
const EFFECTIVE_MAX_MESSAGE_BYTES: u32 = 67_108_864;
const EFFECTIVE_MAX_CONTROL_PAYLOAD_BYTES: u32 = 1_048_576;

const BOOTSTRAP_ERROR_CODES: [u8; 6] = [1, 2, 4, 16, 24, 25];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransportCapabilities {
    pub webtransport_http3: bool,
    pub binary_wss: bool,
    pub max_datagram_size: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BufferCapabilities {
    pub transferable_arraybuffer: bool,
    pub shared_arraybuffer: bool,
}

/// ClientHello `requested_limits`: required map; four members each optional.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RequestedLimits {
    pub max_channels: Option<u32>,
    pub max_session_bytes: Option<u64>,
    pub max_message_bytes: Option<u32>,
    pub max_control_payload_bytes: Option<u32>,
}

/// ServerHello `effective_limits`: four required members with registry ceilings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectiveLimits {
    pub max_channels: u32,
    pub max_session_bytes: u64,
    pub max_message_bytes: u32,
    pub max_control_payload_bytes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientHello {
    pub wire_versions: Vec<u8>,
    pub transport_capabilities: TransportCapabilities,
    pub buffer_capabilities: BufferCapabilities,
    pub requested_limits: RequestedLimits,
    pub extension_capabilities: Vec<u16>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerHello {
    pub selected_wire_version: u8,
    pub transport_capabilities: TransportCapabilities,
    pub buffer_capabilities: BufferCapabilities,
    pub effective_limits: EffectiveLimits,
    pub extension_capabilities: Vec<u16>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BootstrapErrorRecord {
    pub code: u8,
    pub message: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BootstrapRecord {
    ClientHello(ClientHello),
    ServerHello(ServerHello),
    BootstrapError(BootstrapErrorRecord),
}

fn read_u16_be(bytes: &[u8], offset: usize) -> u16 {
    u16::from_be_bytes([bytes[offset], bytes[offset + 1]])
}

fn read_u32_be(bytes: &[u8], offset: usize) -> u32 {
    u32::from_be_bytes([bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]])
}

fn map_cbor_error(err: CborError, payload_base: usize) -> ProtocolError {
    ProtocolError::malformed_bootstrap("cbor_profile", payload_base.saturating_add(err.offset), 8)
}

fn as_map<'a>(
    value: CborValue<'a>,
    offset: usize,
) -> Result<Vec<(u64, CborValue<'a>)>, ProtocolError> {
    match value {
        CborValue::Map(m) => Ok(m),
        _ => Err(ProtocolError::malformed_bootstrap("wrong_type", offset, 9)),
    }
}

fn require_exact_keys(
    map: &[(u64, CborValue<'_>)],
    required: &[u64],
    optional: &[u64],
    offset: usize,
) -> Result<(), ProtocolError> {
    for (key, _) in map {
        if !required.contains(key) && !optional.contains(key) {
            return Err(ProtocolError::malformed_bootstrap("unknown_key", offset, 9));
        }
    }
    for key in required {
        if !map.iter().any(|(k, _)| k == key) {
            return Err(ProtocolError::malformed_bootstrap("missing_key", offset, 9));
        }
    }
    Ok(())
}

fn get<'a, 'm>(map: &'m [(u64, CborValue<'a>)], key: u64) -> Option<&'m CborValue<'a>> {
    map.iter().find(|(k, _)| *k == key).map(|(_, v)| v)
}

fn as_bool(value: &CborValue<'_>, offset: usize) -> Result<bool, ProtocolError> {
    match value {
        CborValue::Bool(b) => Ok(*b),
        _ => Err(ProtocolError::malformed_bootstrap("wrong_type", offset, 9)),
    }
}

/// Accept integer CBOR shapes, then enforce `[min, max]`.
///
/// Matches TypeScript `asUint`: unsigned and negative integers enter the range
/// check (`range_violation` when outside bounds); other CBOR types map to
/// `wrong_type`.
fn as_uint_range(
    value: &CborValue<'_>,
    offset: usize,
    min: u64,
    max: u64,
) -> Result<u64, ProtocolError> {
    let n = match value {
        CborValue::Unsigned(v) => i128::from(*v),
        CborValue::Negative(v) => *v,
        _ => {
            return Err(ProtocolError::malformed_bootstrap("wrong_type", offset, 9));
        }
    };
    if n < i128::from(min) || n > i128::from(max) {
        return Err(ProtocolError::malformed_bootstrap("range_violation", offset, 9));
    }
    Ok(n as u64)
}

fn as_uint32(value: &CborValue<'_>, offset: usize) -> Result<u32, ProtocolError> {
    let n = as_uint_range(value, offset, 0, u64::from(u32::MAX))?;
    Ok(n as u32)
}

fn as_uint8(value: &CborValue<'_>, offset: usize) -> Result<u8, ProtocolError> {
    let n = as_uint_range(value, offset, 0, 255)?;
    Ok(n as u8)
}

fn as_text(value: &CborValue<'_>, offset: usize) -> Result<String, ProtocolError> {
    match value {
        CborValue::Text(t) => {
            if t.len() > UTF8_TEXT_MAX_BYTES {
                return Err(ProtocolError::malformed_bootstrap("text_too_long", offset, 9));
            }
            Ok(t.as_ref().to_owned())
        }
        _ => Err(ProtocolError::malformed_bootstrap("wrong_type", offset, 9)),
    }
}

fn as_array<'a, 'b>(
    value: &'b CborValue<'a>,
    offset: usize,
) -> Result<&'b [CborValue<'a>], ProtocolError> {
    match value {
        CborValue::Array(a) => Ok(a.as_slice()),
        _ => Err(ProtocolError::malformed_bootstrap("wrong_type", offset, 9)),
    }
}

fn decode_transport(
    value: CborValue<'_>,
    offset: usize,
) -> Result<TransportCapabilities, ProtocolError> {
    let map = as_map(value, offset)?;
    require_exact_keys(&map, &[1, 2], &[3], offset)?;
    let mut out = TransportCapabilities {
        webtransport_http3: as_bool(get(&map, 1).unwrap(), offset)?,
        binary_wss: as_bool(get(&map, 2).unwrap(), offset)?,
        max_datagram_size: None,
    };
    if let Some(v) = get(&map, 3) {
        out.max_datagram_size = Some(as_uint32(v, offset)?);
    }
    Ok(out)
}

fn decode_buffer(value: CborValue<'_>, offset: usize) -> Result<BufferCapabilities, ProtocolError> {
    let map = as_map(value, offset)?;
    require_exact_keys(&map, &[1, 2], &[], offset)?;
    Ok(BufferCapabilities {
        transferable_arraybuffer: as_bool(get(&map, 1).unwrap(), offset)?,
        shared_arraybuffer: as_bool(get(&map, 2).unwrap(), offset)?,
    })
}

fn decode_wire_versions(value: &CborValue<'_>, offset: usize) -> Result<Vec<u8>, ProtocolError> {
    let arr = as_array(value, offset)?;
    if arr.is_empty() || arr.len() > WIRE_VERSIONS_MAX {
        return Err(ProtocolError::malformed_bootstrap("range_violation", offset, 9));
    }
    let mut out = Vec::with_capacity(arr.len());
    let mut seen = std::collections::BTreeSet::new();
    for el in arr {
        let v = as_uint8(el, offset)?;
        if !seen.insert(v) {
            return Err(ProtocolError::malformed_bootstrap("unique_violation", offset, 9));
        }
        out.push(v);
    }
    Ok(out)
}

fn decode_extension_capabilities(
    value: &CborValue<'_>,
    offset: usize,
) -> Result<Vec<u16>, ProtocolError> {
    let arr = as_array(value, offset)?;
    if arr.len() > CAPABILITY_IDS_MAX {
        return Err(ProtocolError::malformed_bootstrap("range_violation", offset, 9));
    }
    let mut out = Vec::with_capacity(arr.len());
    let mut prev: Option<u16> = None;
    for el in arr {
        let id =
            as_uint_range(el, offset, u64::from(CAPABILITY_ID_MIN), u64::from(CAPABILITY_ID_MAX))?
                as u16;
        if let Some(p) = prev {
            if id == p {
                return Err(ProtocolError::malformed_bootstrap("unique_violation", offset, 9));
            }
            if id < p {
                return Err(ProtocolError::malformed_bootstrap("order_violation", offset, 9));
            }
        }
        prev = Some(id);
        out.push(id);
    }
    Ok(out)
}

fn decode_requested_limits(
    value: CborValue<'_>,
    offset: usize,
) -> Result<RequestedLimits, ProtocolError> {
    let map = as_map(value, offset)?;
    require_exact_keys(&map, &[], &[1, 2, 3, 4], offset)?;
    let mut out = RequestedLimits::default();
    if let Some(v) = get(&map, 1) {
        out.max_channels = Some(as_uint32(v, offset)?);
    }
    if let Some(v) = get(&map, 2) {
        out.max_session_bytes = Some(as_uint_range(v, offset, 0, u64::MAX)?);
    }
    if let Some(v) = get(&map, 3) {
        out.max_message_bytes = Some(as_uint32(v, offset)?);
    }
    if let Some(v) = get(&map, 4) {
        out.max_control_payload_bytes = Some(as_uint32(v, offset)?);
    }
    Ok(out)
}

fn decode_effective_limits(
    value: CborValue<'_>,
    offset: usize,
) -> Result<EffectiveLimits, ProtocolError> {
    let map = as_map(value, offset)?;
    require_exact_keys(&map, &[1, 2, 3, 4], &[], offset)?;
    Ok(EffectiveLimits {
        max_channels: as_uint_range(
            get(&map, 1).unwrap(),
            offset,
            0,
            u64::from(EFFECTIVE_MAX_CHANNELS),
        )? as u32,
        max_session_bytes: as_uint_range(
            get(&map, 2).unwrap(),
            offset,
            0,
            EFFECTIVE_MAX_SESSION_BYTES,
        )?,
        max_message_bytes: as_uint_range(
            get(&map, 3).unwrap(),
            offset,
            0,
            u64::from(EFFECTIVE_MAX_MESSAGE_BYTES),
        )? as u32,
        max_control_payload_bytes: as_uint_range(
            get(&map, 4).unwrap(),
            offset,
            0,
            u64::from(EFFECTIVE_MAX_CONTROL_PAYLOAD_BYTES),
        )? as u32,
    })
}

fn decode_client_hello(value: CborValue<'_>, offset: usize) -> Result<ClientHello, ProtocolError> {
    let map = as_map(value, offset)?;
    require_exact_keys(&map, &[1, 2, 3, 4, 6], &[], offset)?;
    // Move values out of the map by re-taking ownership via into_iter.
    let mut wire = None;
    let mut transport = None;
    let mut buffer = None;
    let mut requested = None;
    let mut caps = None;
    for (k, v) in map {
        match k {
            1 => wire = Some(decode_wire_versions(&v, offset)?),
            2 => transport = Some(decode_transport(v, offset)?),
            3 => buffer = Some(decode_buffer(v, offset)?),
            4 => requested = Some(decode_requested_limits(v, offset)?),
            6 => caps = Some(decode_extension_capabilities(&v, offset)?),
            _ => unreachable!("closed by require_exact_keys"),
        }
    }
    Ok(ClientHello {
        wire_versions: wire.unwrap(),
        transport_capabilities: transport.unwrap(),
        buffer_capabilities: buffer.unwrap(),
        requested_limits: requested.unwrap(),
        extension_capabilities: caps.unwrap(),
    })
}

fn decode_server_hello(value: CborValue<'_>, offset: usize) -> Result<ServerHello, ProtocolError> {
    let map = as_map(value, offset)?;
    require_exact_keys(&map, &[1, 2, 3, 4, 6], &[], offset)?;
    let mut selected = None;
    let mut transport = None;
    let mut buffer = None;
    let mut effective = None;
    let mut caps = None;
    for (k, v) in map {
        match k {
            1 => {
                let s = as_uint8(&v, offset)?;
                if s != 0 {
                    return Err(ProtocolError::malformed_bootstrap("range_violation", offset, 9));
                }
                selected = Some(s);
            }
            2 => transport = Some(decode_transport(v, offset)?),
            3 => buffer = Some(decode_buffer(v, offset)?),
            4 => effective = Some(decode_effective_limits(v, offset)?),
            6 => caps = Some(decode_extension_capabilities(&v, offset)?),
            _ => unreachable!("closed by require_exact_keys"),
        }
    }
    Ok(ServerHello {
        selected_wire_version: selected.unwrap(),
        transport_capabilities: transport.unwrap(),
        buffer_capabilities: buffer.unwrap(),
        effective_limits: effective.unwrap(),
        extension_capabilities: caps.unwrap(),
    })
}

fn decode_bootstrap_error(
    value: CborValue<'_>,
    offset: usize,
) -> Result<BootstrapErrorRecord, ProtocolError> {
    let map = as_map(value, offset)?;
    require_exact_keys(&map, &[1], &[2, 3], offset)?;
    let code_num = as_uint_range(get(&map, 1).unwrap(), offset, 0, 255)? as u8;
    if !BOOTSTRAP_ERROR_CODES.contains(&code_num) {
        return Err(ProtocolError::malformed_bootstrap("range_violation", offset, 9));
    }
    let mut out = BootstrapErrorRecord { code: code_num, message: None, detail: None };
    if let Some(v) = get(&map, 2) {
        out.message = Some(as_text(v, offset)?);
    }
    if let Some(v) = get(&map, 3) {
        out.detail = Some(as_text(v, offset)?);
    }
    Ok(out)
}

fn decode_payload_by_kind(
    kind: u8,
    value: CborValue<'_>,
    offset: usize,
) -> Result<BootstrapRecord, ProtocolError> {
    match kind {
        KIND_CLIENT_HELLO => Ok(BootstrapRecord::ClientHello(decode_client_hello(value, offset)?)),
        KIND_SERVER_HELLO => Ok(BootstrapRecord::ServerHello(decode_server_hello(value, offset)?)),
        KIND_BOOTSTRAP_ERROR => {
            Ok(BootstrapRecord::BootstrapError(decode_bootstrap_error(value, offset)?))
        }
        _ => Err(ProtocolError::malformed_bootstrap("unassigned_kind", 5, 5)),
    }
}

/// Parse a complete bootstrap record. Atomic whole-value return.
///
/// Validation order matches `validation_order.bootstrap` steps 1–9.
pub fn parse_bootstrap(bytes: &[u8]) -> Result<BootstrapRecord, ProtocolError> {
    // 1. minimum length 12
    if bytes.len() < BOOTSTRAP_PREFIX_LENGTH {
        return Err(ProtocolError::malformed_bootstrap("truncated_prefix", 0, 1));
    }

    // 2. magic R2WP
    if bytes[0..4] != MAGIC {
        return Err(ProtocolError::malformed_bootstrap("bad_magic", 0, 2));
    }

    // 3. bootstrap_version 0
    if bytes[4] != BOOTSTRAP_VERSION {
        return Err(ProtocolError::unsupported_version("unsupported_bootstrap_version", 4, 3));
    }

    // 4. flags zero
    let flags = read_u16_be(bytes, 6);
    if flags != 0 {
        return Err(ProtocolError::malformed_bootstrap("nonzero_flags", 6, 4));
    }

    // 5. kind assigned
    let kind = bytes[5];
    if kind != KIND_CLIENT_HELLO && kind != KIND_SERVER_HELLO && kind != KIND_BOOTSTRAP_ERROR {
        return Err(ProtocolError::malformed_bootstrap("unassigned_kind", 5, 5));
    }

    // 6. payload_len absolute limit
    let payload_len = read_u32_be(bytes, 8);
    if payload_len > BOOTSTRAP_PAYLOAD_MAX_BYTES {
        return Err(ProtocolError::message_too_large("payload_too_large", 8, 6));
    }

    // 7. exact total length 12 + payload_len
    let expected_total = BOOTSTRAP_PREFIX_LENGTH
        .checked_add(payload_len as usize)
        .ok_or_else(|| ProtocolError::malformed_bootstrap("exact_total_mismatch", 0, 7))?;
    if bytes.len() != expected_total {
        return Err(ProtocolError::malformed_bootstrap("exact_total_mismatch", 0, 7));
    }

    let payload = &bytes[BOOTSTRAP_PREFIX_LENGTH..expected_total];

    // 8. deterministic CBOR profile
    let cbor_value = match decode_deterministic_cbor(payload) {
        Ok(v) => v,
        Err(e) => return Err(map_cbor_error(e, BOOTSTRAP_PREFIX_LENGTH)),
    };

    // 9. CDDL / kind shape match
    decode_payload_by_kind(kind, cbor_value, BOOTSTRAP_PREFIX_LENGTH)
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn empty_input_returns_step1_error() {
        let err = parse_bootstrap(&[]).unwrap_err();
        assert_eq!(err.reason, "truncated_prefix");
        assert_eq!(err.step, 1);
        assert_eq!(err.code, 1);
        assert_eq!(err.name, "malformed_bootstrap");
        assert_eq!(err.plane, "bootstrap");
    }

    #[test]
    fn step6_before_step7_on_declared_overflow() {
        // Legal 12-byte prefix declares payload_len = 65536 (head-only payload).
        let bytes = [
            0x52, 0x32, 0x57, 0x50, // R2WP
            0x00, // version
            0x01, // ClientHello
            0x00, 0x00, // flags
            0x00, 0x01, 0x00, 0x00, // payload_len 65536
        ];
        let err = parse_bootstrap(&bytes).unwrap_err();
        assert_eq!(err.code, 24);
        assert_eq!(err.name, "message_too_large");
        assert_eq!(err.reason, "payload_too_large");
        assert_eq!(err.offset, 8);
        assert_eq!(err.step, 6);
        assert_eq!(err.plane, "bootstrap");
    }

    #[test]
    fn trailing_total_mismatch_step7() {
        let mut bytes =
            vec![0x52, 0x32, 0x57, 0x50, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01];
        // payload_len=1 but two body bytes
        bytes.extend_from_slice(&[0xf5, 0x00]);
        let err = parse_bootstrap(&bytes).unwrap_err();
        assert_eq!(err.reason, "exact_total_mismatch");
        assert_eq!(err.step, 7);
    }

    #[test]
    fn as_uint_range_negative_is_range_violation() {
        let err = as_uint_range(&CborValue::Negative(-1), 12, 0, 255).unwrap_err();
        assert_eq!(err.reason, "range_violation");
        assert_eq!(err.step, 9);
        assert_eq!(err.offset, 12);
        assert_eq!(err.code, 1);
        assert_eq!(err.name, "malformed_bootstrap");
    }

    #[test]
    fn as_uint_range_non_integer_is_wrong_type() {
        let err = as_uint_range(&CborValue::Bool(true), 12, 0, 255).unwrap_err();
        assert_eq!(err.reason, "wrong_type");
        assert_eq!(err.step, 9);
        let err = as_uint_range(&CborValue::Null, 12, 0, 255).unwrap_err();
        assert_eq!(err.reason, "wrong_type");
        let ok = as_uint_range(&CborValue::Unsigned(42), 12, 0, 255).unwrap();
        assert_eq!(ok, 42);
    }

    #[test]
    fn client_hello_negative_wire_version_is_range_violation() {
        // ClientHello root map: wire_versions=[-1]; other members are minimal legal shapes.
        // CBOR: {1:[-1], 2:{1:true,2:true}, 3:{1:true,2:true}, 4:{}, 6:[]}
        let payload: &[u8] = &[
            0xa5, // map(5)
            0x01, 0x81, 0x20, // 1 => [-1]
            0x02, 0xa2, 0x01, 0xf5, 0x02, 0xf5, // transport
            0x03, 0xa2, 0x01, 0xf5, 0x02, 0xf5, // buffer
            0x04, 0xa0, // requested_limits {}
            0x06, 0x80, // extension_capabilities []
        ];
        let mut bytes = vec![
            0x52,
            0x32,
            0x57,
            0x50, // magic
            0x00, // version
            0x01, // ClientHello
            0x00,
            0x00, // flags
            0x00,
            0x00,
            0x00,
            payload.len() as u8, // payload_len (20)
        ];
        assert_eq!(payload.len(), 20);
        bytes.extend_from_slice(payload);

        let err = parse_bootstrap(&bytes).unwrap_err();
        assert_eq!(err.code, 1);
        assert_eq!(err.name, "malformed_bootstrap");
        assert_eq!(err.reason, "range_violation");
        assert_eq!(err.offset, 12);
        assert_eq!(err.plane, "bootstrap");
        assert_eq!(err.step, 9);
    }

    #[test]
    fn bootstrap_cbor_length_out_of_range_is_step8_cbor_profile() {
        // Legal ClientHello header around a single CBOR byte-string head that
        // declares length MAX_SAFE_INTEGER+1 (head-only payload). Step 8 maps
        // CBOR error at payload-relative offset 0 → absolute offset 12, reason
        // cbor_profile.
        let payload: &[u8] = &[0x5b, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
        let mut bytes = vec![
            0x52,
            0x32,
            0x57,
            0x50, // magic
            0x00, // version
            0x01, // ClientHello
            0x00,
            0x00, // flags
            0x00,
            0x00,
            0x00,
            payload.len() as u8, // payload_len = 9
        ];
        assert_eq!(payload.len(), 9);
        bytes.extend_from_slice(payload);

        let err = parse_bootstrap(&bytes).unwrap_err();
        assert_eq!(err.code, 1);
        assert_eq!(err.name, "malformed_bootstrap");
        assert_eq!(err.reason, "cbor_profile");
        assert_eq!(err.offset, 12);
        assert_eq!(err.plane, "bootstrap");
        assert_eq!(err.step, 8);
    }
}
