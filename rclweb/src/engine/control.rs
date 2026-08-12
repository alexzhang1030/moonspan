//! Client-side control-message builders for the v0.1 walking skeleton.
//!
//! Maps mirror the shapes exercised by the R1-03 gateway test client so the
//! client engine and gateway stay on one contract. Every outbound control frame
//! is self-parsed and recorded through [`crate::Session`] before it leaves the
//! engine.
//!
//! Schema identity: Phase 1 corpus roots resolve through
//! [`crate::types::schema_identity_for_type`]. Jazzy rows (`J-*`) use
//! `rep2011-rihs`; Humble rows (`H-*`) use `moonspan-schema-v1`. Non-roots keep
//! a demo identity until a broader registry lands. Schema *exchange*
//! (SchemaRequest/Response) stays lightly parked; the registry is for local
//! lookup before channel activation.

use crate::protocol::cbor::CborValue;
use crate::types::{SCHEME_MOONSPAN_SCHEMA_V1, SCHEME_REP2011_RIHS, schema_identity_for_type};
use std::borrow::Cow;

/// Demo schema hash for non-corpus types on Jazzy rows (e.g. `std_msgs/msg/String`).
///
/// Corpus Phase 1 roots use real RIHS / moonspan identities from the embedded
/// registry instead — see [`resolve_open_schema_identity`].
pub const DEMO_SCHEMA_HASH: &str =
    "RIHS01_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/// Demo moonspan-schema-v1 value for non-corpus types on Humble rows.
pub const DEMO_MOONSPAN_HASH: &str =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

pub const ZERO_CORRELATION: [u8; 16] = [0u8; 16];

fn bytes_val(bytes: &[u8]) -> CborValue<'static> {
    CborValue::Bytes(Cow::Owned(bytes.to_vec()))
}

fn text_val(text: &str) -> CborValue<'static> {
    CborValue::Text(Cow::Owned(text.to_owned()))
}

/// OpenChannel schema scheme for a support row (`H-*` → moonspan, else RIHS).
#[must_use]
pub fn schema_scheme_for_support_row(support_row_id: &str) -> &'static str {
    if support_row_id.starts_with('H') {
        SCHEME_MOONSPAN_SCHEMA_V1
    } else {
        SCHEME_REP2011_RIHS
    }
}

/// Scheme + value for OpenChannel on the given support row.
///
/// Phase 1 roots → identity from the frozen registry for the row's scheme.
/// Everything else (including `std_msgs/msg/String`) → demo identity.
#[must_use]
pub fn resolve_open_schema_identity(type_name: &str, support_row_id: &str) -> (String, String) {
    let scheme = schema_scheme_for_support_row(support_row_id);
    match schema_identity_for_type(type_name, scheme) {
        Ok(Some((scheme, value))) => (scheme, value),
        _ if support_row_id.starts_with('H') => (
            SCHEME_MOONSPAN_SCHEMA_V1.to_owned(),
            DEMO_MOONSPAN_HASH.to_owned(),
        ),
        _ => (SCHEME_REP2011_RIHS.to_owned(), DEMO_SCHEMA_HASH.to_owned()),
    }
}

/// Authenticate (kind 1). v0.1 accepts every credential.
#[must_use]
pub fn authenticate(correlation: &[u8; 16], scheme: &str, token: &[u8]) -> CborValue<'static> {
    CborValue::Map(vec![
        (1, CborValue::Unsigned(1)),
        (2, bytes_val(correlation)),
        (16, text_val(scheme)),
        (17, bytes_val(token)),
    ])
}

/// Default KEEP_LAST depth when the SDK omits an explicit depth (R2-01 subset).
pub const DEFAULT_QOS_DEPTH: u32 = 5;

/// OpenChannel (kind 8) for a topic subscribe or publish.
///
/// QoS subset for R2-01: `qos_reliability` (1 RELIABLE / 2 BEST_EFFORT) and
/// `qos_depth` (KEEP_LAST depth). Other QoS members stay SYSTEM_DEFAULT.
///
/// Schema identity follows `support_row_id` (RIHS on `J-*`, moonspan on `H-*`).
#[must_use]
#[allow(clippy::too_many_arguments)]
pub fn open_topic(
    correlation: &[u8; 16],
    channel_id: u32,
    operation_kind: u64,
    topic: &str,
    type_name: &str,
    qos_reliability: u64,
    qos_depth: u32,
    domain_id: u8,
    support_row_id: &str,
) -> CborValue<'static> {
    let depth = u64::from(qos_depth.max(1));
    let (scheme, value) = resolve_open_schema_identity(type_name, support_row_id);
    CborValue::Map(vec![
        (1, CborValue::Unsigned(8)),
        (2, bytes_val(correlation)),
        (29, CborValue::Unsigned(u64::from(channel_id))),
        (30, CborValue::Unsigned(operation_kind)),
        (31, text_val(topic)),
        (4, text_val(type_name)),
        (
            3,
            CborValue::Map(vec![(1, text_val(&scheme)), (2, text_val(&value))]),
        ),
        (5, CborValue::Unsigned(1)),
        (6, CborValue::Unsigned(0)),
        (
            11,
            CborValue::Map(vec![
                (1, CborValue::Unsigned(qos_reliability)),
                (2, CborValue::Unsigned(0)),
                (3, CborValue::Unsigned(1)),
                (4, CborValue::Unsigned(depth)),
            ]),
        ),
        (32, CborValue::Unsigned(2)),
        (12, CborValue::Map(Vec::new())),
        (9, CborValue::Unsigned(u64::from(domain_id))),
        (8, text_val(support_row_id)),
    ])
}

/// OpenChannel (kind 8) for a service client (`operation_kind` 2) or server (3).
///
/// Same map shape as [`open_topic`]; service name lives in key 31.
#[must_use]
#[allow(clippy::too_many_arguments)]
pub fn open_service(
    correlation: &[u8; 16],
    channel_id: u32,
    client: bool,
    name: &str,
    type_name: &str,
    domain_id: u8,
    support_row_id: &str,
) -> CborValue<'static> {
    let operation_kind = if client { 2 } else { 3 };
    open_topic(
        correlation,
        channel_id,
        operation_kind,
        name,
        type_name,
        1, // RELIABLE
        DEFAULT_QOS_DEPTH,
        domain_id,
        support_row_id,
    )
}

fn reliable_keep_last_qos(depth: u64) -> CborValue<'static> {
    CborValue::Map(vec![
        (1, CborValue::Unsigned(1)), // RELIABLE
        (2, CborValue::Unsigned(0)), // durability SYSTEM_DEFAULT
        (3, CborValue::Unsigned(1)), // KEEP_LAST
        (4, CborValue::Unsigned(depth)),
    ])
}

/// OpenChannel (kind 8) for an action client (`operation_kind` 4) or server (5).
///
/// Carries `action_qos` key 58: five QoS maps (goal/result/cancel/feedback/status),
/// each RELIABLE + KEEP_LAST depth 5.
#[must_use]
#[allow(clippy::too_many_arguments)]
pub fn open_action(
    correlation: &[u8; 16],
    channel_id: u32,
    client: bool,
    name: &str,
    type_name: &str,
    domain_id: u8,
    support_row_id: &str,
) -> CborValue<'static> {
    let operation_kind = if client { 4 } else { 5 };
    let depth = u64::from(DEFAULT_QOS_DEPTH);
    let qos = reliable_keep_last_qos(depth);
    let (scheme, value) = resolve_open_schema_identity(type_name, support_row_id);
    CborValue::Map(vec![
        (1, CborValue::Unsigned(8)),
        (2, bytes_val(correlation)),
        (29, CborValue::Unsigned(u64::from(channel_id))),
        (30, CborValue::Unsigned(operation_kind)),
        (31, text_val(name)),
        (4, text_val(type_name)),
        (
            3,
            CborValue::Map(vec![(1, text_val(&scheme)), (2, text_val(&value))]),
        ),
        (5, CborValue::Unsigned(1)),
        (6, CborValue::Unsigned(0)),
        (
            58,
            CborValue::Map(vec![
                (1, qos.clone()),
                (2, qos.clone()),
                (3, qos.clone()),
                (4, qos.clone()),
                (5, qos),
            ]),
        ),
        (32, CborValue::Unsigned(2)),
        (12, CborValue::Map(Vec::new())),
        (9, CborValue::Unsigned(u64::from(domain_id))),
        (8, text_val(support_row_id)),
    ])
}

/// CloseChannel (kind 10).
#[must_use]
pub fn close_channel(correlation: &[u8; 16], channel_id: u32) -> CborValue<'static> {
    CborValue::Map(vec![
        (1, CborValue::Unsigned(10)),
        (2, bytes_val(correlation)),
        (29, CborValue::Unsigned(u64::from(channel_id))),
        (34, CborValue::Unsigned(1)),
    ])
}

/// Heartbeat (kind 12).
#[must_use]
pub fn heartbeat(counter: u64) -> CborValue<'static> {
    CborValue::Map(vec![
        (1, CborValue::Unsigned(12)),
        (2, bytes_val(&ZERO_CORRELATION)),
        (40, CborValue::Unsigned(counter)),
    ])
}
