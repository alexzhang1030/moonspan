//! R2WP v0 CONTROL_CBOR decoder + static CDDL shape validation (selected-frame step 16).

use super::cbor::{CborError, CborValue, decode_deterministic_cbor};
use super::error::ProtocolError;
use std::collections::BTreeMap;

/// Fixed v0 contract: `absolute_limits.control_payload_max_bytes`.
pub const CONTROL_PAYLOAD_MAX_BYTES: usize = 1_048_576;

pub const CONTROL_KIND_AUTHENTICATE: u8 = 1;
pub const CONTROL_KIND_SESSION_READY: u8 = 2;
pub const CONTROL_KIND_GRAPH_SNAPSHOT: u8 = 3;
pub const CONTROL_KIND_GRAPH_DELTA: u8 = 4;
pub const CONTROL_KIND_SCHEMA_REQUEST: u8 = 5;
pub const CONTROL_KIND_SCHEMA_ADVERTISE: u8 = 6;
pub const CONTROL_KIND_SCHEMA_RESPONSE: u8 = 7;
pub const CONTROL_KIND_OPEN_CHANNEL: u8 = 8;
pub const CONTROL_KIND_CHANNEL_READY: u8 = 9;
pub const CONTROL_KIND_CLOSE_CHANNEL: u8 = 10;
pub const CONTROL_KIND_CLOCK_SYNC: u8 = 11;
pub const CONTROL_KIND_HEARTBEAT: u8 = 12;
pub const CONTROL_KIND_SESSION_RESUME: u8 = 13;
pub const CONTROL_KIND_SESSION_RESUME_RESULT: u8 = 14;
pub const CONTROL_KIND_ERROR: u8 = 15;

/// Fifteen assigned control-kind names for coverage tests.
pub const CONTROL_KIND_NAMES: [&str; 15] = [
    "Authenticate",
    "SessionReady",
    "GraphSnapshot",
    "GraphDelta",
    "SchemaRequest",
    "SchemaAdvertise",
    "SchemaResponse",
    "OpenChannel",
    "ChannelReady",
    "CloseChannel",
    "ClockSync",
    "Heartbeat",
    "SessionResume",
    "SessionResumeResult",
    "Error",
];

/// Validated control message: kind plus closed CBOR field map (borrows input).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ControlMessage<'a> {
    pub kind: u8,
    pub fields: BTreeMap<u64, CborValue<'a>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ControlError {
    pub reason: &'static str,
    /// Payload-relative byte offset.
    pub offset: usize,
}

impl ControlError {
    fn new(reason: &'static str, offset: usize) -> Self {
        Self { reason, offset }
    }
}

const UINT32_MAX: u64 = 0xffff_ffff;
const UINT64_MAX: u64 = u64::MAX;
const INT64_MIN: i128 = -0x8000_0000_0000_0000;
const INT64_MAX: i128 = 0x7fff_ffff_ffff_ffff;
const UTF8_TEXT_MAX: usize = 4096;
const DOMAIN_ID_MAX: u64 = 232;
const DOMAIN_IDS_MAX: usize = 233;
const CAP_ID_MAX: u64 = 65535;
const CAP_IDS_MAX: usize = 64;
const GRAPH_NODES_MAX: usize = 65535;
const GRAPH_ENDPOINTS_MAX: usize = 65535;
const GRAPH_DELTA_OPS_MAX: usize = 1024;
const SOURCE_BUNDLE_MAX: usize = 4096;
const ALIVE_CHANNELS_MAX: usize = 65535;
const CHANNEL_ACKS_MAX: usize = 65535;
const CHANNEL_RESULTS_MAX: usize = 65535;
const CRED_MAX: usize = 65535;
const DESC_MAX: usize = 1_048_576;
const CONTENT_MAX: usize = 1_048_576;

// ---------- schema engine ----------

#[derive(Clone, Copy)]
enum ArrayRule {
    UniqueAscendingUint,
    UniqueAscendingChannelId,
    GraphNodesSorted,
    GraphEndpointsSorted,
}

#[derive(Clone)]
enum Schema {
    Bool,
    Uint { min: u64, max: u64 },
    Int64,
    Text { min_bytes: usize, max_bytes: usize, one_of: Option<&'static [&'static str]> },
    Bytes { min: usize, max: usize },
    ConstU64(u64),
    ConstBool(bool),
    Array { min: usize, max: usize, items: Box<Schema>, rule: Option<ArrayRule> },
    MapDyn(Vec<(u64, bool, Schema)>),
    Union(Vec<Schema>),
    Identity,
    Qos,
    EffectiveQos,
    EffectiveServiceQos,
    ActionQos,
    EffectiveActionQos,
}

fn fail(reason: &'static str) -> ControlError {
    ControlError::new(reason, 0)
}

fn as_uint(value: &CborValue<'_>, min: u64, max: u64) -> Result<u64, ControlError> {
    let n = match value {
        CborValue::Unsigned(v) => i128::from(*v),
        CborValue::Negative(v) => *v,
        _ => return Err(fail("wrong_type")),
    };
    if n < i128::from(min) || n > i128::from(max) {
        return Err(fail("range_violation"));
    }
    Ok(n as u64)
}

fn as_int64(value: &CborValue<'_>) -> Result<i128, ControlError> {
    let n = match value {
        CborValue::Unsigned(v) => i128::from(*v),
        CborValue::Negative(v) => *v,
        _ => return Err(fail("wrong_type")),
    };
    if !(INT64_MIN..=INT64_MAX).contains(&n) {
        return Err(fail("range_violation"));
    }
    Ok(n)
}

fn text_len(s: &str) -> usize {
    s.len() // UTF-8 byte length for validated UTF-8 strings
}

fn map_from_value<'a>(value: &CborValue<'a>) -> Result<BTreeMap<u64, CborValue<'a>>, ControlError> {
    match value {
        CborValue::Map(entries) => {
            let mut out = BTreeMap::new();
            for (k, v) in entries {
                if out.insert(*k, v.clone()).is_some() {
                    return Err(fail("unique_violation"));
                }
            }
            Ok(out)
        }
        _ => Err(fail("wrong_type")),
    }
}

fn validate_schema<'a>(
    value: &CborValue<'a>,
    schema: &Schema,
) -> Result<CborValue<'a>, ControlError> {
    match schema {
        Schema::Bool => match value {
            CborValue::Bool(b) => Ok(CborValue::Bool(*b)),
            _ => Err(fail("wrong_type")),
        },
        Schema::ConstU64(c) => {
            let n = as_uint(value, 0, u64::MAX)?;
            if n != *c {
                return Err(fail("enum_violation"));
            }
            Ok(CborValue::Unsigned(n))
        }
        Schema::ConstBool(c) => match value {
            CborValue::Bool(b) if b == c => Ok(CborValue::Bool(*b)),
            CborValue::Bool(_) => Err(fail("enum_violation")),
            _ => Err(fail("wrong_type")),
        },
        Schema::Uint { min, max } => {
            let n = as_uint(value, *min, *max)?;
            // wire-error-code excludes 20
            if *min == 1 && *max == 28 && n == 20 {
                return Err(fail("enum_violation"));
            }
            Ok(CborValue::Unsigned(n))
        }
        Schema::Int64 => {
            let n = as_int64(value)?;
            if n >= 0 { Ok(CborValue::Unsigned(n as u64)) } else { Ok(CborValue::Negative(n)) }
        }
        Schema::Text { min_bytes, max_bytes, one_of } => match value {
            CborValue::Text(t) => {
                let len = text_len(t);
                if len < *min_bytes || len > *max_bytes {
                    return Err(fail("text_length"));
                }
                if let Some(set) = one_of
                    && !set.iter().any(|s| *s == t.as_ref())
                {
                    return Err(fail("enum_violation"));
                }
                Ok(value.clone())
            }
            _ => Err(fail("wrong_type")),
        },
        Schema::Bytes { min, max } => match value {
            CborValue::Bytes(b) => {
                if b.len() < *min || b.len() > *max {
                    return Err(fail("bytes_length"));
                }
                Ok(value.clone())
            }
            _ => Err(fail("wrong_type")),
        },
        Schema::Array { min, max, items, rule } => match value {
            CborValue::Array(arr) => {
                if arr.len() < *min || arr.len() > *max {
                    return Err(fail("array_bound"));
                }
                let mut out = Vec::with_capacity(arr.len());
                for el in arr {
                    out.push(validate_schema(el, items)?);
                }
                apply_array_rule(&out, *rule)?;
                Ok(CborValue::Array(out))
            }
            _ => Err(fail("wrong_type")),
        },
        Schema::MapDyn(fields) => validate_map(value, fields),
        Schema::Union(variants) => {
            let mut last = None;
            for v in variants {
                match validate_schema(value, v) {
                    Ok(ok) => return Ok(ok),
                    Err(e) => last = Some(e),
                }
            }
            Err(last.unwrap_or_else(|| fail("union_mismatch")))
        }
        Schema::Identity => validate_schema_identity(value),
        Schema::Qos => validate_qos(value),
        Schema::EffectiveQos => validate_effective_qos(value),
        Schema::EffectiveServiceQos => validate_effective_service_qos(value),
        Schema::ActionQos => validate_schema(
            value,
            &Schema::MapDyn(vec![
                (1, true, Schema::Qos),
                (2, true, Schema::Qos),
                (3, true, Schema::Qos),
                (4, true, Schema::Qos),
                (5, true, Schema::Qos),
            ]),
        ),
        Schema::EffectiveActionQos => validate_schema(
            value,
            &Schema::MapDyn(vec![
                (1, true, Schema::EffectiveServiceQos),
                (2, true, Schema::EffectiveServiceQos),
                (3, true, Schema::EffectiveServiceQos),
                (4, true, Schema::EffectiveQos),
                (5, true, Schema::EffectiveQos),
            ]),
        ),
    }
}

fn validate_map<'a>(
    value: &CborValue<'a>,
    fields: &[(u64, bool, Schema)],
) -> Result<CborValue<'a>, ControlError> {
    let raw = map_from_value(value)?;
    for k in raw.keys() {
        if !fields.iter().any(|(fk, _, _)| fk == k) {
            return Err(fail("unknown_key"));
        }
    }
    let mut out_entries = Vec::new();
    for (key, required, schema) in fields {
        match raw.get(key) {
            None if *required => return Err(fail("missing_key")),
            None => {}
            Some(v) => {
                let validated = validate_schema(v, schema)?;
                out_entries.push((*key, validated));
            }
        }
    }
    out_entries.sort_by_key(|(k, _)| *k);
    Ok(CborValue::Map(out_entries))
}

fn history_kind(value: &CborValue<'_>) -> Result<u64, ControlError> {
    let raw = map_from_value(value)?;
    let h = raw.get(&3).ok_or_else(|| fail("missing_key"))?;
    as_uint(h, 0, 2)
}

fn validate_qos<'a>(value: &CborValue<'a>) -> Result<CborValue<'a>, ControlError> {
    let h = history_kind(value)?;
    if h == 1 {
        validate_schema(value, &qos_keep_last())
    } else if h == 0 || h == 2 {
        validate_schema(value, &qos_no_depth())
    } else {
        Err(fail("enum_violation"))
    }
}

fn validate_effective_qos<'a>(value: &CborValue<'a>) -> Result<CborValue<'a>, ControlError> {
    let h = history_kind(value)?;
    if h == 1 {
        validate_schema(value, &effective_qos_keep_last())
    } else if h == 2 {
        validate_schema(value, &effective_qos_keep_all())
    } else {
        Err(fail("enum_violation"))
    }
}

fn validate_effective_service_qos<'a>(
    value: &CborValue<'a>,
) -> Result<CborValue<'a>, ControlError> {
    let h = history_kind(value)?;
    if h == 1 {
        validate_schema(value, &effective_service_qos_keep_last())
    } else if h == 2 {
        validate_schema(value, &effective_service_qos_keep_all())
    } else {
        Err(fail("enum_violation"))
    }
}

fn validate_schema_identity<'a>(value: &CborValue<'a>) -> Result<CborValue<'a>, ControlError> {
    let m = map_from_value(value)?;
    for k in m.keys() {
        if *k != 1 && *k != 2 {
            return Err(fail("unknown_key"));
        }
    }
    let scheme = m.get(&1).ok_or_else(|| fail("missing_key"))?;
    let val = m.get(&2).ok_or_else(|| fail("missing_key"))?;
    let (scheme_s, val_s) = match (scheme, val) {
        (CborValue::Text(a), CborValue::Text(b)) => (a.as_ref(), b.as_ref()),
        _ => return Err(fail("wrong_type")),
    };
    if scheme_s == "rep2011-rihs" {
        if text_len(val_s) != 71 || !val_s.starts_with("RIHS01_") {
            return Err(fail("schema_identity"));
        }
        let hex = &val_s[7..];
        if hex.len() != 64 || !hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
            return Err(fail("schema_identity"));
        }
    } else if scheme_s == "moonspan-schema-v1" {
        if text_len(val_s) != 64
            || val_s.len() != 64
            || !val_s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
        {
            return Err(fail("schema_identity"));
        }
    } else {
        return Err(fail("schema_identity"));
    }
    Ok(CborValue::Map(vec![(1, scheme.clone()), (2, val.clone())]))
}

fn apply_array_rule(items: &[CborValue<'_>], rule: Option<ArrayRule>) -> Result<(), ControlError> {
    let Some(rule) = rule else {
        return Ok(());
    };
    if items.is_empty() {
        return Ok(());
    }
    match rule {
        ArrayRule::UniqueAscendingUint => {
            let mut prev: Option<u64> = None;
            for el in items {
                let n = as_uint(el, 0, u64::MAX)?;
                if let Some(p) = prev {
                    if n == p {
                        return Err(fail("unique_violation"));
                    }
                    if n < p {
                        return Err(fail("order_violation"));
                    }
                }
                prev = Some(n);
            }
        }
        ArrayRule::UniqueAscendingChannelId => {
            let mut prev: Option<u64> = None;
            for el in items {
                let m = map_from_value(el)?;
                let id = m.get(&1).ok_or_else(|| fail("wrong_type"))?;
                let n = as_uint(id, 1, UINT32_MAX)?;
                if let Some(p) = prev {
                    if n == p {
                        return Err(fail("unique_violation"));
                    }
                    if n < p {
                        return Err(fail("order_violation"));
                    }
                }
                prev = Some(n);
            }
        }
        ArrayRule::GraphNodesSorted => {
            let mut prev: Option<Vec<u8>> = None;
            for el in items {
                let m = map_from_value(el)?;
                let id = m.get(&55).ok_or_else(|| fail("wrong_type"))?;
                let CborValue::Bytes(b) = id else {
                    return Err(fail("wrong_type"));
                };
                if let Some(p) = &prev {
                    match p.as_slice().cmp(b.as_ref()) {
                        std::cmp::Ordering::Equal => return Err(fail("unique_violation")),
                        std::cmp::Ordering::Greater => return Err(fail("order_violation")),
                        std::cmp::Ordering::Less => {}
                    }
                }
                prev = Some(b.as_ref().to_vec());
            }
        }
        ArrayRule::GraphEndpointsSorted => {
            let mut prev: Option<Vec<u8>> = None;
            for el in items {
                let m = map_from_value(el)?;
                let id = m.get(&56).ok_or_else(|| fail("wrong_type"))?;
                let CborValue::Bytes(b) = id else {
                    return Err(fail("wrong_type"));
                };
                if let Some(p) = &prev {
                    match p.as_slice().cmp(b.as_ref()) {
                        std::cmp::Ordering::Equal => return Err(fail("unique_violation")),
                        std::cmp::Ordering::Greater => return Err(fail("order_violation")),
                        std::cmp::Ordering::Less => {}
                    }
                }
                prev = Some(b.as_ref().to_vec());
            }
        }
    }
    Ok(())
}

// ---------- schema constructors ----------

fn u(min: u64, max: u64) -> Schema {
    Schema::Uint { min, max }
}
fn text(min_b: usize, max_b: usize) -> Schema {
    Schema::Text { min_bytes: min_b, max_bytes: max_b, one_of: None }
}
fn text_one_of(opts: &'static [&'static str]) -> Schema {
    Schema::Text { min_bytes: 1, max_bytes: UTF8_TEXT_MAX, one_of: Some(opts) }
}
fn bytes(min: usize, max: usize) -> Schema {
    Schema::Bytes { min, max }
}
fn arr(min: usize, max: usize, items: Schema, rule: Option<ArrayRule>) -> Schema {
    Schema::Array { min, max, items: Box::new(items), rule }
}
fn map(fields: Vec<(u64, bool, Schema)>) -> Schema {
    Schema::MapDyn(fields)
}
fn req(s: Schema) -> (bool, Schema) {
    (true, s)
}
fn opt(s: Schema) -> (bool, Schema) {
    (false, s)
}
fn fmap(entries: Vec<(u64, (bool, Schema))>) -> Schema {
    map(entries.into_iter().map(|(k, (r, s))| (k, r, s)).collect())
}

fn uint32() -> Schema {
    u(0, UINT32_MAX)
}
fn uint64() -> Schema {
    u(0, UINT64_MAX)
}
fn app_channel_id() -> Schema {
    u(1, UINT32_MAX)
}
fn domain_id() -> Schema {
    u(0, DOMAIN_ID_MAX)
}
fn capability_id() -> Schema {
    u(1, CAP_ID_MAX)
}
fn text4k() -> Schema {
    text(0, UTF8_TEXT_MAX)
}
fn text_nonempty() -> Schema {
    text(1, UTF8_TEXT_MAX)
}
fn bytes16() -> Schema {
    bytes(16, 16)
}
fn bytes32() -> Schema {
    bytes(32, 32)
}
fn bytes_cred() -> Schema {
    bytes(1, CRED_MAX)
}
fn bytes_desc() -> Schema {
    bytes(1, DESC_MAX)
}
fn bytes_content() -> Schema {
    bytes(0, CONTENT_MAX)
}
fn wire_error_code() -> Schema {
    u(1, 28)
}
fn retry_class() -> Schema {
    u(0, 3)
}
fn close_reason() -> Schema {
    u(1, 6)
}
fn priority_id() -> Schema {
    u(0, 4)
}
fn clock_id() -> Schema {
    u(0, 4)
}
fn positive_depth() -> Schema {
    u(1, UINT32_MAX)
}
fn support_row_id() -> Schema {
    text_one_of(&["H-FT", "H-CY", "H-ZN", "J-FT", "J-CY", "J-ZN"])
}
fn ros_distro() -> Schema {
    text_one_of(&["humble", "jazzy"])
}
fn rmw_identifier() -> Schema {
    text_one_of(&["rmw_fastrtps_cpp", "rmw_cyclonedds_cpp", "rmw_zenoh_cpp"])
}
fn payload_encoding_cdr() -> Schema {
    u(1, 2)
}
fn source_entry_encoding() -> Schema {
    u(1, 5)
}
fn reliability() -> Schema {
    u(0, 2)
}
fn durability() -> Schema {
    u(0, 2)
}
fn liveliness() -> Schema {
    u(0, 2)
}

fn qos_keep_last() -> Schema {
    fmap(vec![
        (1, req(reliability())),
        (2, req(durability())),
        (3, req(Schema::ConstU64(1))),
        (4, req(positive_depth())),
        (5, opt(uint64())),
        (6, opt(uint64())),
        (7, opt(liveliness())),
        (8, opt(uint64())),
    ])
}
fn qos_no_depth() -> Schema {
    fmap(vec![
        (1, req(reliability())),
        (2, req(durability())),
        (3, req(Schema::Union(vec![Schema::ConstU64(0), Schema::ConstU64(2)]))),
        (5, opt(uint64())),
        (6, opt(uint64())),
        (7, opt(liveliness())),
        (8, opt(uint64())),
    ])
}
fn effective_qos_keep_last() -> Schema {
    fmap(vec![
        (1, req(Schema::Union(vec![Schema::ConstU64(1), Schema::ConstU64(2)]))),
        (2, req(Schema::Union(vec![Schema::ConstU64(1), Schema::ConstU64(2)]))),
        (3, req(Schema::ConstU64(1))),
        (4, req(positive_depth())),
        (5, opt(uint64())),
        (6, opt(uint64())),
        (7, req(Schema::Union(vec![Schema::ConstU64(1), Schema::ConstU64(2)]))),
        (8, opt(uint64())),
    ])
}
fn effective_qos_keep_all() -> Schema {
    fmap(vec![
        (1, req(Schema::Union(vec![Schema::ConstU64(1), Schema::ConstU64(2)]))),
        (2, req(Schema::Union(vec![Schema::ConstU64(1), Schema::ConstU64(2)]))),
        (3, req(Schema::ConstU64(2))),
        (5, opt(uint64())),
        (6, opt(uint64())),
        (7, req(Schema::Union(vec![Schema::ConstU64(1), Schema::ConstU64(2)]))),
        (8, opt(uint64())),
    ])
}
fn effective_service_qos_keep_last() -> Schema {
    fmap(vec![
        (1, req(Schema::ConstU64(1))),
        (2, req(Schema::ConstU64(2))),
        (3, req(Schema::ConstU64(1))),
        (4, req(positive_depth())),
        (5, opt(uint64())),
        (6, opt(uint64())),
        (7, req(Schema::Union(vec![Schema::ConstU64(1), Schema::ConstU64(2)]))),
        (8, opt(uint64())),
    ])
}
fn effective_service_qos_keep_all() -> Schema {
    fmap(vec![
        (1, req(Schema::ConstU64(1))),
        (2, req(Schema::ConstU64(2))),
        (3, req(Schema::ConstU64(2))),
        (5, opt(uint64())),
        (6, opt(uint64())),
        (7, req(Schema::Union(vec![Schema::ConstU64(1), Schema::ConstU64(2)]))),
        (8, opt(uint64())),
    ])
}

fn budgets() -> Schema {
    fmap(vec![
        (1, opt(uint32())),
        (2, opt(uint64())),
        (3, opt(uint32())),
        (4, opt(uint64())),
        (5, opt(uint32())),
        (6, opt(uint64())),
    ])
}
fn error_body_session() -> Schema {
    fmap(vec![
        (48, req(wire_error_code())),
        (49, req(Schema::ConstU64(0))),
        (50, opt(retry_class())),
        (51, opt(text4k())),
        (52, opt(text4k())),
    ])
}
fn error_body_channel() -> Schema {
    fmap(vec![
        (48, req(wire_error_code())),
        (49, req(Schema::ConstU64(1))),
        (50, opt(retry_class())),
        (51, opt(text4k())),
        (52, opt(text4k())),
    ])
}
fn transport_caps() -> Schema {
    fmap(vec![(1, req(Schema::Bool)), (2, req(Schema::Bool)), (3, opt(uint32()))])
}
fn buffer_caps() -> Schema {
    fmap(vec![(1, req(Schema::Bool)), (2, req(Schema::Bool))])
}
fn capability_id_list() -> Schema {
    arr(0, CAP_IDS_MAX, capability_id(), Some(ArrayRule::UniqueAscendingUint))
}
fn negotiated_caps() -> Schema {
    fmap(vec![(1, req(transport_caps())), (2, req(buffer_caps())), (3, req(capability_id_list()))])
}
fn source_bundle_entry() -> Schema {
    fmap(vec![
        (1, req(text_nonempty())),
        (2, req(source_entry_encoding())),
        (3, req(bytes_content())),
    ])
}
fn graph_node() -> Schema {
    fmap(vec![
        (55, req(bytes16())),
        (1, req(text_nonempty())),
        (2, opt(text4k())),
        (9, req(domain_id())),
    ])
}
fn graph_endpoint() -> Schema {
    Schema::Union(vec![
        fmap(vec![
            (56, req(bytes16())),
            (55, req(bytes16())),
            (1, req(text_nonempty())),
            (2, req(u(0, 3))),
            (3, req(text_nonempty())),
            (4, req(Schema::Identity)),
            (5, req(payload_encoding_cdr())),
            (6, req(uint64())),
            (7, req(Schema::Qos)),
            (9, req(domain_id())),
            (8, opt(support_row_id())),
        ]),
        fmap(vec![
            (56, req(bytes16())),
            (55, req(bytes16())),
            (1, req(text_nonempty())),
            (2, req(Schema::Union(vec![Schema::ConstU64(4), Schema::ConstU64(5)]))),
            (3, req(text_nonempty())),
            (4, req(Schema::Identity)),
            (5, req(payload_encoding_cdr())),
            (6, req(uint64())),
            (58, req(Schema::ActionQos)),
            (9, req(domain_id())),
            (8, opt(support_row_id())),
        ]),
    ])
}
fn graph_delta_op() -> Schema {
    Schema::Union(vec![
        fmap(vec![(1, req(Schema::ConstU64(0))), (2, req(graph_node()))]),
        fmap(vec![(1, req(Schema::ConstU64(1))), (55, req(bytes16()))]),
        fmap(vec![(1, req(Schema::ConstU64(2))), (3, req(graph_endpoint()))]),
        fmap(vec![(1, req(Schema::ConstU64(3))), (56, req(bytes16()))]),
    ])
}
fn channel_ack() -> Schema {
    fmap(vec![(1, req(app_channel_id())), (2, req(uint64()))])
}
fn channel_resume_result() -> Schema {
    Schema::Union(vec![
        fmap(vec![(1, req(app_channel_id())), (2, req(Schema::ConstU64(0))), (3, req(uint64()))]),
        fmap(vec![
            (1, req(app_channel_id())),
            (2, req(Schema::ConstU64(1))),
            (3, req(Schema::ConstU64(0))),
        ]),
        fmap(vec![(1, req(app_channel_id())), (2, req(Schema::ConstU64(1)))]),
        fmap(vec![(1, req(app_channel_id())), (2, req(Schema::ConstU64(2)))]),
        fmap(vec![
            (1, req(app_channel_id())),
            (2, req(Schema::ConstU64(3))),
            (15, req(error_body_channel())),
        ]),
    ])
}

fn kind_schema(kind: u8) -> Option<Schema> {
    Some(match kind {
        CONTROL_KIND_AUTHENTICATE => fmap(vec![
            (1, req(Schema::ConstU64(1))),
            (2, req(bytes16())),
            (16, req(text_nonempty())),
            (17, req(bytes_cred())),
        ]),
        CONTROL_KIND_SESSION_READY => fmap(vec![
            (1, req(Schema::ConstU64(2))),
            (2, req(bytes16())),
            (7, req(text_nonempty())),
            (8, req(support_row_id())),
            (10, req(arr(1, DOMAIN_IDS_MAX, domain_id(), Some(ArrayRule::UniqueAscendingUint)))),
            (13, req(text_nonempty())),
            (12, req(budgets())),
            (18, req(ros_distro())),
            (19, req(rmw_identifier())),
            (20, req(text_nonempty())),
            (21, req(text_nonempty())),
            (53, req(bytes32())),
            (54, req(negotiated_caps())),
        ]),
        CONTROL_KIND_GRAPH_SNAPSHOT => fmap(vec![
            (1, req(Schema::ConstU64(3))),
            (2, req(bytes16())),
            (14, req(uint64())),
            (7, req(text_nonempty())),
            (8, req(support_row_id())),
            (22, req(arr(0, GRAPH_NODES_MAX, graph_node(), Some(ArrayRule::GraphNodesSorted)))),
            (
                23,
                req(arr(
                    0,
                    GRAPH_ENDPOINTS_MAX,
                    graph_endpoint(),
                    Some(ArrayRule::GraphEndpointsSorted),
                )),
            ),
        ]),
        CONTROL_KIND_GRAPH_DELTA => fmap(vec![
            (1, req(Schema::ConstU64(4))),
            (2, req(bytes16())),
            (14, req(uint64())),
            (24, req(uint64())),
            (7, req(text_nonempty())),
            (8, req(support_row_id())),
            (25, req(arr(1, GRAPH_DELTA_OPS_MAX, graph_delta_op(), None))),
        ]),
        CONTROL_KIND_SCHEMA_REQUEST => fmap(vec![
            (1, req(Schema::ConstU64(5))),
            (2, req(bytes16())),
            (4, req(text_nonempty())),
            (3, req(Schema::Identity)),
        ]),
        CONTROL_KIND_SCHEMA_ADVERTISE => fmap(vec![
            (1, req(Schema::ConstU64(6))),
            (2, req(bytes16())),
            (4, req(text_nonempty())),
            (3, req(Schema::Identity)),
            (5, req(payload_encoding_cdr())),
            (6, req(uint64())),
            (26, req(bytes_desc())),
            (27, opt(arr(0, SOURCE_BUNDLE_MAX, source_bundle_entry(), None))),
            (28, opt(uint64())),
            (8, opt(support_row_id())),
        ]),
        CONTROL_KIND_SCHEMA_RESPONSE => Schema::Union(vec![
            fmap(vec![
                (1, req(Schema::ConstU64(7))),
                (2, req(bytes16())),
                (4, req(text_nonempty())),
                (3, req(Schema::Identity)),
                (5, req(payload_encoding_cdr())),
                (6, req(uint64())),
                (26, req(bytes_desc())),
                (27, opt(arr(0, SOURCE_BUNDLE_MAX, source_bundle_entry(), None))),
                (28, opt(uint64())),
                (8, opt(support_row_id())),
            ]),
            fmap(vec![
                (1, req(Schema::ConstU64(7))),
                (2, req(bytes16())),
                (4, req(text_nonempty())),
                (3, req(Schema::Identity)),
                (15, req(error_body_session())),
            ]),
        ]),
        CONTROL_KIND_OPEN_CHANNEL => Schema::Union(vec![
            // topic 0/1
            fmap(vec![
                (1, req(Schema::ConstU64(8))),
                (2, req(bytes16())),
                (29, req(app_channel_id())),
                (30, req(Schema::Union(vec![Schema::ConstU64(0), Schema::ConstU64(1)]))),
                (31, req(text_nonempty())),
                (4, req(text_nonempty())),
                (3, req(Schema::Identity)),
                (5, req(payload_encoding_cdr())),
                (6, req(uint64())),
                (11, req(Schema::Qos)),
                (32, req(priority_id())),
                (12, req(budgets())),
                (9, req(domain_id())),
                (8, req(support_row_id())),
            ]),
            // service 2/3
            fmap(vec![
                (1, req(Schema::ConstU64(8))),
                (2, req(bytes16())),
                (29, req(app_channel_id())),
                (30, req(Schema::Union(vec![Schema::ConstU64(2), Schema::ConstU64(3)]))),
                (31, req(text_nonempty())),
                (4, req(text_nonempty())),
                (3, req(Schema::Identity)),
                (5, req(payload_encoding_cdr())),
                (6, req(uint64())),
                (11, req(Schema::Qos)),
                (32, req(priority_id())),
                (12, req(budgets())),
                (9, req(domain_id())),
                (8, req(support_row_id())),
            ]),
            // action 4/5
            fmap(vec![
                (1, req(Schema::ConstU64(8))),
                (2, req(bytes16())),
                (29, req(app_channel_id())),
                (30, req(Schema::Union(vec![Schema::ConstU64(4), Schema::ConstU64(5)]))),
                (31, req(text_nonempty())),
                (4, req(text_nonempty())),
                (3, req(Schema::Identity)),
                (5, req(payload_encoding_cdr())),
                (6, req(uint64())),
                (58, req(Schema::ActionQos)),
                (32, req(priority_id())),
                (12, req(budgets())),
                (9, req(domain_id())),
                (8, req(support_row_id())),
            ]),
            // media 6
            fmap(vec![
                (1, req(Schema::ConstU64(8))),
                (2, req(bytes16())),
                (29, req(app_channel_id())),
                (30, req(Schema::ConstU64(6))),
                (31, req(text_nonempty())),
                (5, req(Schema::Union(vec![Schema::ConstU64(3), Schema::ConstU64(4)]))),
                (32, req(priority_id())),
                (12, req(budgets())),
                (9, opt(domain_id())),
                (8, opt(support_row_id())),
            ]),
            // recording 7
            fmap(vec![
                (1, req(Schema::ConstU64(8))),
                (2, req(bytes16())),
                (29, req(app_channel_id())),
                (30, req(Schema::ConstU64(7))),
                (31, req(text_nonempty())),
                (5, req(Schema::Union(vec![Schema::ConstU64(5), Schema::ConstU64(6)]))),
                (32, req(priority_id())),
                (12, req(budgets())),
            ]),
            // asset 8
            fmap(vec![
                (1, req(Schema::ConstU64(8))),
                (2, req(bytes16())),
                (29, req(app_channel_id())),
                (30, req(Schema::ConstU64(8))),
                (31, req(text_nonempty())),
                (5, req(Schema::ConstU64(6))),
                (32, req(priority_id())),
                (12, req(budgets())),
            ]),
        ]),
        CONTROL_KIND_CHANNEL_READY => Schema::Union(vec![
            fmap(vec![
                (1, req(Schema::ConstU64(9))),
                (2, req(bytes16())),
                (29, req(app_channel_id())),
                (33, req(Schema::Union(vec![Schema::ConstU64(0), Schema::ConstU64(2)]))),
                (12, req(budgets())),
                (59, req(priority_id())),
                (57, req(Schema::EffectiveQos)),
                (6, opt(uint64())),
                (14, opt(uint64())),
                (9, opt(domain_id())),
                (8, opt(support_row_id())),
            ]),
            fmap(vec![
                (1, req(Schema::ConstU64(9))),
                (2, req(bytes16())),
                (29, req(app_channel_id())),
                (33, req(Schema::Union(vec![Schema::ConstU64(0), Schema::ConstU64(2)]))),
                (12, req(budgets())),
                (59, req(priority_id())),
                (60, req(Schema::EffectiveServiceQos)),
                (6, opt(uint64())),
                (14, opt(uint64())),
                (9, opt(domain_id())),
                (8, opt(support_row_id())),
            ]),
            fmap(vec![
                (1, req(Schema::ConstU64(9))),
                (2, req(bytes16())),
                (29, req(app_channel_id())),
                (33, req(Schema::Union(vec![Schema::ConstU64(0), Schema::ConstU64(2)]))),
                (12, req(budgets())),
                (59, req(priority_id())),
                (58, req(Schema::EffectiveActionQos)),
                (6, opt(uint64())),
                (14, opt(uint64())),
                (9, opt(domain_id())),
                (8, opt(support_row_id())),
            ]),
            fmap(vec![
                (1, req(Schema::ConstU64(9))),
                (2, req(bytes16())),
                (29, req(app_channel_id())),
                (33, req(Schema::Union(vec![Schema::ConstU64(0), Schema::ConstU64(2)]))),
                (12, req(budgets())),
                (59, req(priority_id())),
                (6, opt(uint64())),
                (14, opt(uint64())),
                (9, opt(domain_id())),
                (8, opt(support_row_id())),
            ]),
            fmap(vec![
                (1, req(Schema::ConstU64(9))),
                (2, req(bytes16())),
                (29, req(app_channel_id())),
                (33, req(Schema::Union(vec![Schema::ConstU64(1), Schema::ConstU64(3)]))),
                (15, req(error_body_channel())),
            ]),
        ]),
        CONTROL_KIND_CLOSE_CHANNEL => fmap(vec![
            (1, req(Schema::ConstU64(10))),
            (2, req(bytes16())),
            (29, req(app_channel_id())),
            (34, req(close_reason())),
            (35, opt(uint64())),
        ]),
        CONTROL_KIND_CLOCK_SYNC => fmap(vec![
            (1, req(Schema::ConstU64(11))),
            (2, req(bytes16())),
            (36, req(clock_id())),
            (37, req(Schema::Int64)),
            (38, opt(uint64())),
            (39, opt(Schema::Int64)),
        ]),
        CONTROL_KIND_HEARTBEAT => fmap(vec![
            (1, req(Schema::ConstU64(12))),
            (2, req(bytes16())),
            (40, req(uint64())),
            (
                41,
                opt(arr(
                    0,
                    ALIVE_CHANNELS_MAX,
                    app_channel_id(),
                    Some(ArrayRule::UniqueAscendingUint),
                )),
            ),
        ]),
        CONTROL_KIND_SESSION_RESUME => fmap(vec![
            (1, req(Schema::ConstU64(13))),
            (2, req(bytes16())),
            (42, req(bytes32())),
            (43, req(Schema::ConstU64(0))),
            (44, req(negotiated_caps())),
            (7, req(text_nonempty())),
            (8, req(support_row_id())),
            (14, req(uint64())),
            (6, req(uint64())),
            (13, req(text_nonempty())),
            (
                45,
                req(arr(
                    0,
                    CHANNEL_ACKS_MAX,
                    channel_ack(),
                    Some(ArrayRule::UniqueAscendingChannelId),
                )),
            ),
            (16, req(text_nonempty())),
            (17, req(bytes_cred())),
        ]),
        CONTROL_KIND_SESSION_RESUME_RESULT => Schema::Union(vec![
            fmap(vec![
                (1, req(Schema::ConstU64(14))),
                (2, req(bytes16())),
                (46, req(Schema::ConstBool(true))),
                (
                    47,
                    req(arr(
                        0,
                        CHANNEL_RESULTS_MAX,
                        channel_resume_result(),
                        Some(ArrayRule::UniqueAscendingChannelId),
                    )),
                ),
            ]),
            fmap(vec![
                (1, req(Schema::ConstU64(14))),
                (2, req(bytes16())),
                (46, req(Schema::ConstBool(false))),
                (15, req(error_body_session())),
            ]),
        ]),
        CONTROL_KIND_ERROR => Schema::Union(vec![
            fmap(vec![
                (1, req(Schema::ConstU64(15))),
                (2, req(bytes16())),
                (48, req(wire_error_code())),
                (49, req(Schema::ConstU64(0))),
                (50, opt(retry_class())),
                (51, opt(text4k())),
                (52, opt(text4k())),
            ]),
            fmap(vec![
                (1, req(Schema::ConstU64(15))),
                (2, req(bytes16())),
                (48, req(wire_error_code())),
                (49, req(Schema::ConstU64(1))),
                (29, req(app_channel_id())),
                (50, opt(retry_class())),
                (51, opt(text4k())),
                (52, opt(text4k())),
            ]),
            fmap(vec![
                (1, req(Schema::ConstU64(15))),
                (2, req(bytes16())),
                (48, req(wire_error_code())),
                (49, req(Schema::ConstU64(2))),
                (29, req(app_channel_id())),
                (50, opt(retry_class())),
                (51, opt(text4k())),
                (52, opt(text4k())),
            ]),
            fmap(vec![
                (1, req(Schema::ConstU64(15))),
                (2, req(bytes16())),
                (48, req(wire_error_code())),
                (49, req(Schema::ConstU64(3))),
                (50, opt(retry_class())),
                (51, opt(text4k())),
                (52, opt(text4k())),
            ]),
        ]),
        _ => return None,
    })
}

fn assert_session_ready_triple(map: &BTreeMap<u64, CborValue<'_>>) -> Result<(), ControlError> {
    let row = match map.get(&8) {
        Some(CborValue::Text(t)) => t.as_ref(),
        _ => return Err(fail("wrong_type")),
    };
    let distro = match map.get(&18) {
        Some(CborValue::Text(t)) => t.as_ref(),
        _ => return Err(fail("wrong_type")),
    };
    let rmw = match map.get(&19) {
        Some(CborValue::Text(t)) => t.as_ref(),
        _ => return Err(fail("wrong_type")),
    };
    let (exp_distro, exp_rmw) = match row {
        "H-FT" => ("humble", "rmw_fastrtps_cpp"),
        "H-CY" => ("humble", "rmw_cyclonedds_cpp"),
        "H-ZN" => ("humble", "rmw_zenoh_cpp"),
        "J-FT" => ("jazzy", "rmw_fastrtps_cpp"),
        "J-CY" => ("jazzy", "rmw_cyclonedds_cpp"),
        "J-ZN" => ("jazzy", "rmw_zenoh_cpp"),
        _ => return Err(fail("enum_violation")),
    };
    if distro != exp_distro || rmw != exp_rmw {
        return Err(fail("support_row_mismatch"));
    }
    Ok(())
}

fn validate_open_channel<'a>(value: &CborValue<'a>) -> Result<CborValue<'a>, ControlError> {
    let raw = map_from_value(value)?;
    let cls_v = raw.get(&30).ok_or_else(|| fail("missing_key"))?;
    let cls = as_uint(cls_v, 0, 8)?;
    let schema = match cls {
        0 | 1 => kind_schema(CONTROL_KIND_OPEN_CHANNEL)
            .and_then(|s| match s {
                Schema::Union(v) => v.into_iter().next(),
                _ => None,
            })
            .unwrap(),
        2 | 3 => match kind_schema(CONTROL_KIND_OPEN_CHANNEL).unwrap() {
            Schema::Union(mut v) => v.remove(1),
            _ => unreachable!(),
        },
        4 | 5 => match kind_schema(CONTROL_KIND_OPEN_CHANNEL).unwrap() {
            Schema::Union(mut v) => v.remove(2),
            _ => unreachable!(),
        },
        6 => match kind_schema(CONTROL_KIND_OPEN_CHANNEL).unwrap() {
            Schema::Union(mut v) => v.remove(3),
            _ => unreachable!(),
        },
        7 => match kind_schema(CONTROL_KIND_OPEN_CHANNEL).unwrap() {
            Schema::Union(mut v) => v.remove(4),
            _ => unreachable!(),
        },
        8 => match kind_schema(CONTROL_KIND_OPEN_CHANNEL).unwrap() {
            Schema::Union(mut v) => v.remove(5),
            _ => unreachable!(),
        },
        _ => return Err(fail("enum_violation")),
    };
    validate_schema(value, &schema)
}

/// Validate a decoded CBOR map as a control-message.
pub fn validate_control_message<'a>(
    value: &CborValue<'a>,
) -> Result<ControlMessage<'a>, ControlError> {
    let raw = map_from_value(value)?;
    let kind_v = raw.get(&1).ok_or_else(|| fail("missing_key"))?;
    let kind = as_uint(kind_v, 0, 255)? as u8;
    let schema = kind_schema(kind).ok_or_else(|| fail("unassigned_kind"))?;
    let validated = if kind == CONTROL_KIND_OPEN_CHANNEL {
        validate_open_channel(value)?
    } else {
        validate_schema(value, &schema)?
    };
    let CborValue::Map(entries) = validated else {
        return Err(fail("wrong_type"));
    };
    let fields: BTreeMap<u64, CborValue<'a>> = entries.into_iter().collect();
    if kind == CONTROL_KIND_SESSION_READY {
        assert_session_ready_triple(&fields)?;
    }
    Ok(ControlMessage { kind, fields })
}

/// Decode and fully shape-validate a CONTROL_CBOR payload.
pub fn decode_control_message(bytes: &[u8]) -> Result<ControlMessage<'_>, ControlError> {
    if bytes.len() > CONTROL_PAYLOAD_MAX_BYTES {
        return Err(ControlError::new("payload_too_large", 0));
    }
    let decoded = match decode_deterministic_cbor(bytes) {
        Ok(v) => v,
        Err(CborError { reason: _, offset }) => {
            return Err(ControlError::new("cbor_profile", offset));
        }
    };
    validate_control_message(&decoded)
}

/// Map control errors onto the selected-frame surface.
pub(crate) fn map_control_error(err: ControlError, payload_base: usize) -> ProtocolError {
    if err.reason == "payload_too_large" {
        return ProtocolError::message_too_large_frame("control_payload_too_large", 24, 3);
    }
    ProtocolError::invalid_control("invalid_control", payload_base.saturating_add(err.offset), 16)
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    fn hex(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    /// Minimal valid CONTROL_CBOR payloads for kinds 1–15 (TypeScript encodeControlMessage).
    const VALID_KIND_HEX: [&str; 15] = [
        // 1 Authenticate
        "a401010250010101010101010101010101010101011065746f6b656e1142aabb",
        // 2 SessionReady H-FT
        "ad0102025001010101010101010101010101010101076267770864482d46540a81000ca101010d6761646170746572126668756d626c651370726d775f66617374727470735f6370701463312e301563312e301835582002020202020202020202020202020202020202020202020202020202020202021836a301a201f502f502a201f502f403820102",
        // 3 GraphSnapshot
        "a70103025001010101010101010101010101010101076267770864482d46540e0016801780",
        // 4 GraphDelta
        "a70104025001010101010101010101010101010101076267770864482d46540e01181800181981a2010002a301622f6e090018375003030303030303030303030303030303",
        // 5 SchemaRequest
        "a4010502500101010101010101010101010101010103a2016c726570323031312d726968730278475249485330315f6161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616104737374645f6d7367732f6d73672f537472696e67",
        // 6 SchemaAdvertise
        "a7010602500101010101010101010101010101010103a2016c726570323031312d726968730278475249485330315f6161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616104737374645f6d7367732f6d73672f537472696e6705010600181a4101",
        // 7 SchemaResponse success
        "a7010702500101010101010101010101010101010103a2016c726570323031312d726968730278475249485330315f6161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616104737374645f6d7367732f6d73672f537472696e6705010600181a4101",
        // 8 OpenChannel topic
        "ae010802500101010101010101010101010101010103a2016c726570323031312d726968730278475249485330315f6161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616104737374645f6d7367732f6d73672f537472696e67050106000864482d465409000ba401010201030104010ca10101181d01181e00181f682f63686174746572182002",
        // 9 ChannelReady topic
        "a701090250010101010101010101010101010101010ca10101181d011821001839a501010201030104010701183b02",
        // 10 CloseChannel
        "a4010a025001010101010101010101010101010101181d01182201",
        // 11 ClockSync
        "a4010b025001010101010101010101010101010101182401182500",
        // 12 Heartbeat
        "a3010c025001010101010101010101010101010101182800",
        // 13 SessionResume
        "ad010d0250010101010101010101010101010101010600076267770864482d46540d67616461707465720e001065746f6b656e1142aabb182a58200202020202020202020202020202020202020202020202020202020202020202182b00182ca301a201f502f502a201f502f403820102182d80",
        // 14 SessionResumeResult accept
        "a4010e025001010101010101010101010101010101182ef5182f80",
        // 15 Error session scope
        "a4010f025001010101010101010101010101010101183001183100",
    ];

    #[test]
    fn fifteen_control_kinds_decode_valid_payloads() {
        assert_eq!(CONTROL_KIND_NAMES.len(), 15);
        assert_eq!(VALID_KIND_HEX.len(), 15);
        for k in 1u8..=15 {
            assert!(
                kind_schema(k).is_some(),
                "missing schema for kind {k} ({})",
                CONTROL_KIND_NAMES[(k - 1) as usize]
            );
            let bytes = hex(VALID_KIND_HEX[(k - 1) as usize]);
            let msg = decode_control_message(&bytes).unwrap_or_else(|e| {
                panic!(
                    "kind {k} ({}) decode failed: {:?}",
                    CONTROL_KIND_NAMES[(k - 1) as usize],
                    e
                );
            });
            assert_eq!(msg.kind, k, "kind field for {}", CONTROL_KIND_NAMES[(k - 1) as usize]);
            assert_eq!(
                msg.fields.get(&1),
                Some(&CborValue::Unsigned(u64::from(k))),
                "key 1 kind constant"
            );
        }
    }

    fn reject(hex_str: &str) -> ControlError {
        let bytes = hex(hex_str);
        decode_control_message(&bytes).expect_err("expected control rejection")
    }

    #[test]
    fn nested_schema_identity_rejection() {
        // scheme "bad" / value "x"
        let err = reject("a4010502500101010101010101010101010101010103a20163626164026178046174");
        assert_eq!(err.reason, "schema_identity");
        assert_eq!(err.offset, 0);
        // moonspan-schema-v1 value too short
        let err = reject(
            "a4010502500101010101010101010101010101010103a201726d6f6f6e7370616e2d736368656d612d763102626161046174",
        );
        assert_eq!(err.reason, "schema_identity");
    }

    #[test]
    fn nested_qos_missing_depth_rejection() {
        // KEEP_LAST history with omitted required depth key 4
        let err = reject(
            "ae010802500101010101010101010101010101010103a201726d6f6f6e7370616e2d736368656d612d763102784062626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262046174050106000864482d465409000ba30101020103010ca0181d01181e00181f622f63182002",
        );
        assert_eq!(err.reason, "missing_key");
        assert_eq!(err.offset, 0);
    }

    #[test]
    fn nested_array_order_and_unique_rejection() {
        // domain_ids [2,1] order_violation
        let err = reject(
            "ad0102025001010101010101010101010101010101076267770864482d46540a8202010ca00d6161126668756d626c651370726d775f66617374727470735f6370701461311561311835582000000000000000000000000000000000000000000000000000000000000000001836a301a201f502f502a201f502f40380",
        );
        assert_eq!(err.reason, "order_violation");
        // domain_ids [1,1] unique_violation
        let err = reject(
            "ad0102025001010101010101010101010101010101076267770864482d46540a8201010ca00d6161126668756d626c651370726d775f66617374727470735f6370701461311561311835582000000000000000000000000000000000000000000000000000000000000000001836a301a201f502f502a201f502f40380",
        );
        assert_eq!(err.reason, "unique_violation");
    }

    #[test]
    fn nested_closed_map_unknown_key_rejection() {
        // Authenticate with extra key 99
        let err = reject("a501010250010101010101010101010101010101011061741141011863f5");
        assert_eq!(err.reason, "unknown_key");
        assert_eq!(err.offset, 0);
    }

    #[test]
    fn nested_support_row_triple_rejection() {
        // H-FT with ros_distro jazzy
        let err = reject(
            "ad0102025001010101010101010101010101010101076267770864482d46540a81000ca00d616112656a617a7a791370726d775f66617374727470735f6370701461311561311835582000000000000000000000000000000000000000000000000000000000000000001836a301a201f502f502a201f502f40380",
        );
        assert_eq!(err.reason, "support_row_mismatch");
        assert_eq!(err.offset, 0);
    }

    #[test]
    fn nested_union_discriminator_rejection() {
        // SessionResumeResult accepted=false with omitted required error body key 15
        let err = reject("a3010e025001010101010101010101010101010101182ef4");
        assert_eq!(err.reason, "missing_key");
        // Error scope=operation (2) with omitted required channel_id: exact TS oracle enum_violation
        // (union exhaust ends on a const/scope mismatch path).
        let err = reject("a4010f025001010101010101010101010101010101183001183102");
        assert_eq!(err.reason, "enum_violation");
        assert_eq!(err.offset, 0);
    }

    #[test]
    fn nested_effective_qos_rejection() {
        // ChannelReady + effective_qos with reliability SYSTEM_DEFAULT (0).
        // TypeScript CHANNEL_READY is a multi-variant union; after the topic variant
        // rejects non-concrete effective reliability, later variants reject success-only
        // keys. Exact TS oracle for this payload: unknown_key (path /12).
        let err = reject(
            "a701090250010101010101010101010101010101010ca10101181d011821001839a501000201030104010701183b02",
        );
        assert_eq!(err.reason, "unknown_key");
        assert_eq!(err.offset, 0);

        // Effective KEEP_LAST with omitted required concrete liveliness (key 7).
        // Exact TS oracle for this payload: unknown_key (path /12).
        let err = reject(
            "a701090250010101010101010101010101010101010ca10101181d011821001839a40101020103010401183b02",
        );
        assert_eq!(err.reason, "unknown_key");
        assert_eq!(err.offset, 0);
    }

    #[test]
    fn nested_wire_error_code_20_rejection() {
        // CONTROL Error with code 20 (out-of-band only)
        let err = reject("a4010f025001010101010101010101010101010101183014183100");
        assert_eq!(err.reason, "enum_violation");
        assert_eq!(err.offset, 0);
    }

    #[test]
    fn nested_missing_kind_rejection() {
        let err = reject("a1025001010101010101010101010101010101");
        assert_eq!(err.reason, "missing_key");
    }
}
