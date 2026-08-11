//! M0-03h2 Rust R2WP agreement emitter.
//!
//! Builds agreement outcomes directly from the committed fixture sources and
//! compares them with `protocol/testdata/agreement/expected.json` for golden
//! equality. The expected corpus serves as the final comparison surface.
//!
//! When `MOONSPAN_PROTOCOL_AGREE_EMIT=1`, a successful golden match prints a
//! compact JSON envelope between fixed begin/end markers for later multi-language
//! agreement gates.

use rclwebd::{
    BootstrapRecord, CborValue, DecodedFrame, FRAME_HEADER_LENGTH, FrameOptions, FramePayload,
    ProtocolError, parse_bootstrap, parse_frame,
};
use serde_json::{Map, Value, json};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

const OUTCOMES_TOTAL: usize = 101;
const SUCCESS_TOTAL: usize = 46;
const ERROR_TOTAL: usize = 55;
const VALID_TOTAL: usize = 20;
const SEQUENCES_TOTAL: usize = 26;
const MALFORMED_TOTAL: usize = 55;

const RECIPE_ID: &str = "frame-app-payload-64mib-recipe";
const RECIPE_PAYLOAD_FNV1A64_HEX: &str = "3a07afcfc8222325";
const RECIPE_PAYLOAD_LENGTH: u32 = 67_108_864;
const RECIPE_BYTE_LENGTH: usize = 67_108_896;

const TEXT_INLINE_MAX_BYTES: usize = 64;
const BYTES_INLINE_MAX_BYTES: usize = 32;
const HEAD_TAIL_HEX_BYTES: usize = 8;

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0100_0000_01b3;

const EMIT_ENV: &str = "MOONSPAN_PROTOCOL_AGREE_EMIT";
const EMIT_BEGIN: &str = "MOONSPAN_R2WP_AGREEMENT_RUST_BEGIN";
const EMIT_END: &str = "MOONSPAN_R2WP_AGREEMENT_RUST_END";

const SCHEMA_VERSION: u64 = 1;
const PROTOCOL_ID: &str = "r2wp-v0";
const IMPLEMENTATION: &str = "rust";
const EXPECTED_GENERATED_BY: &str = "scripts/protocol-agree.ts";
const EXPECTED_BATCH: &str = "M0-03h1";

// ---------------------------------------------------------------------------
// Paths and IO
// ---------------------------------------------------------------------------

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("workspace root parent of rclwebd")
        .to_path_buf()
}

fn read_json(path: &Path) -> Value {
    let text = fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("read requires {}: {e}", path.display()));
    serde_json::from_str(&text)
        .unwrap_or_else(|e| panic!("JSON parse requires {}: {e}", path.display()))
}

/// Canonical repository-relative paths use a relative form, forward slashes,
/// and non-empty ordinary segments.
fn assert_canonical_rel(rel: &str, label: &str) {
    assert!(
        !rel.is_empty(),
        "{label} requires a non-empty repository-relative path"
    );
    assert!(
        !Path::new(rel).is_absolute(),
        "{label} requires a repository-relative path: {rel}"
    );
    assert!(
        !rel.contains('\\'),
        "{label} requires forward-slash separators: {rel}"
    );
    assert!(
        !rel.contains("//"),
        "{label} requires exactly one slash between path segments: {rel}"
    );
    for segment in rel.split('/') {
        assert!(
            !segment.is_empty() && segment != "." && segment != "..",
            "{label} requires canonical path segments: {rel}"
        );
    }
}

fn resolve_under(root: &Path, rel: &str, label: &str) -> PathBuf {
    assert_canonical_rel(rel, label);
    let root_canon = root
        .canonicalize()
        .unwrap_or_else(|e| panic!("{label} requires resolvable root {}: {e}", root.display()));
    let mut cur = root_canon.clone();
    for segment in rel.split('/') {
        cur.push(segment);
    }
    assert!(
        cur.starts_with(&root_canon),
        "{label} requires path under {}: {rel}",
        root.display()
    );
    cur
}

fn load_binary_under(root: &Path, rel: &str, expected_len: usize, label: &str) -> Vec<u8> {
    let path = resolve_under(root, rel, label);
    let bytes = fs::read(&path)
        .unwrap_or_else(|e| panic!("{label} requires readable {}: {e}", path.display()));
    assert_eq!(
        bytes.len(),
        expected_len,
        "{label} requires byte_length {expected_len}, got {}",
        bytes.len()
    );
    bytes
}

// ---------------------------------------------------------------------------
// Digests and hex
// ---------------------------------------------------------------------------

fn fnv1a64_hex(bytes: &[u8]) -> String {
    let mut hash = FNV_OFFSET;
    for &b in bytes {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    format!("{hash:016x}")
}

fn to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

fn head_tail_hex(bytes: &[u8]) -> (String, String) {
    if bytes.is_empty() {
        return (String::new(), String::new());
    }
    let n = HEAD_TAIL_HEX_BYTES.min(bytes.len());
    let head = to_hex(&bytes[..n]);
    let tail = if bytes.len() <= HEAD_TAIL_HEX_BYTES {
        to_hex(bytes)
    } else {
        to_hex(&bytes[bytes.len() - n..])
    };
    (head, tail)
}

fn text_digest(text: &str) -> Value {
    let utf8 = text.as_bytes();
    json!({
        "utf8_byte_length": utf8.len(),
        "fnv1a64_hex": fnv1a64_hex(utf8),
    })
}

// ---------------------------------------------------------------------------
// Segment recipe materialization
// ---------------------------------------------------------------------------

fn parse_hex_pattern(hex: &str) -> Vec<u8> {
    assert!(
        !hex.is_empty() && hex.len().is_multiple_of(2),
        "pattern_hex requires nonempty even-length lowercase hex"
    );
    assert!(
        hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')),
        "pattern_hex requires lowercase hex"
    );
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("pattern_hex nibble"))
        .collect()
}

/// Materialize the single 64 MiB `pattern_fill` segment recipe from manifest source fields.
fn materialize_segment_recipe(entry: &Value) -> Vec<u8> {
    assert_eq!(
        entry["representation"].as_str(),
        Some("segment_recipe"),
        "recipe entry requires representation segment_recipe"
    );
    assert!(entry["path"].is_null(), "segment_recipe path requires null");
    let source = &entry["source"];
    assert_eq!(
        source["$type"], "frame",
        "recipe source requires $type frame"
    );
    let opcode = source["opcode"].as_u64().expect("recipe opcode") as u8;
    let channel_id = source["channelId"].as_u64().expect("recipe channelId") as u32;
    let sequence = source["sequence"].as_u64().expect("recipe sequence");
    let priority = source["priority"].as_u64().expect("recipe priority") as u8;
    let clock_id = source["clockId"].as_u64().expect("recipe clockId") as u8;

    let recipe = &source["payload"];
    assert_eq!(
        recipe["$type"], "recipe",
        "recipe payload requires $type recipe"
    );
    assert_eq!(
        recipe["kind"].as_str(),
        Some("pattern_fill"),
        "recipe kind requires pattern_fill"
    );
    let pattern = parse_hex_pattern(recipe["pattern_hex"].as_str().expect("pattern_hex"));
    let payload_len = recipe["length"].as_u64().expect("recipe length") as u32;
    assert_eq!(
        payload_len, RECIPE_PAYLOAD_LENGTH,
        "recipe payload length pin"
    );
    let byte_length = entry["byte_length"].as_u64().expect("recipe byte_length") as usize;
    assert_eq!(byte_length, RECIPE_BYTE_LENGTH, "recipe byte_length pin");
    assert_eq!(
        byte_length,
        FRAME_HEADER_LENGTH + payload_len as usize,
        "recipe total length equals header plus payload"
    );

    let mut bytes = vec![0u8; byte_length];
    bytes[0] = 0; // selected version 0
    bytes[1] = opcode;
    bytes[4..8].copy_from_slice(&channel_id.to_be_bytes());
    bytes[8..16].copy_from_slice(&sequence.to_be_bytes());
    // source_time_ns remains 0 for clock NONE
    bytes[24..28].copy_from_slice(&payload_len.to_be_bytes());
    bytes[30] = priority;
    bytes[31] = clock_id;
    let payload = &mut bytes[FRAME_HEADER_LENGTH..];
    for (i, b) in payload.iter_mut().enumerate() {
        *b = pattern[i % pattern.len()];
    }
    bytes
}

// ---------------------------------------------------------------------------
// Frame options from malformed decoder_context
// ---------------------------------------------------------------------------

fn frame_options_from_context(ctx: &Value) -> FrameOptions {
    let mut opts = FrameOptions::default();
    let obj = ctx
        .as_object()
        .unwrap_or_else(|| panic!("decoder_context requires a JSON object"));
    const ALLOWED: &[&str] = &[
        "selectedVersion",
        "experimentalOpcodesEnabled",
        "availableClockIds",
    ];
    for key in obj.keys() {
        assert!(
            ALLOWED.contains(&key.as_str()),
            "decoder_context requires supported key, got {key}"
        );
    }
    if let Some(v) = obj.get("selectedVersion") {
        let n = v
            .as_u64()
            .unwrap_or_else(|| panic!("decoder_context.selectedVersion requires u8"));
        assert!(n <= 255, "decoder_context.selectedVersion requires u8");
        opts.selected_version = n as u8;
    }
    if let Some(v) = obj.get("experimentalOpcodesEnabled") {
        opts.experimental_opcodes_enabled = v
            .as_bool()
            .unwrap_or_else(|| panic!("decoder_context.experimentalOpcodesEnabled requires bool"));
    }
    if let Some(arr) = obj.get("availableClockIds") {
        let items = arr
            .as_array()
            .unwrap_or_else(|| panic!("decoder_context.availableClockIds requires array"));
        let mut ids = BTreeSet::new();
        let mut prev: Option<u8> = None;
        for (i, item) in items.iter().enumerate() {
            let n = item.as_u64().unwrap_or_else(|| {
                panic!("decoder_context.availableClockIds[{i}] requires integer 0..4")
            });
            assert!(
                n <= 4,
                "decoder_context.availableClockIds[{i}] requires integer 0..4"
            );
            let id = n as u8;
            if let Some(p) = prev {
                assert!(
                    id > p,
                    "decoder_context.availableClockIds requires strictly ascending unique values"
                );
            }
            prev = Some(id);
            ids.insert(id);
        }
        opts.available_clock_ids = ids;
    }
    opts
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

fn project_cbor(value: &CborValue<'_>) -> Value {
    match value {
        CborValue::Null => json!({ "t": "null" }),
        CborValue::Bool(b) => json!({ "t": "bool", "v": b }),
        CborValue::Unsigned(n) => json!({ "t": "uint", "v": n.to_string() }),
        CborValue::Negative(n) => json!({ "t": "nint", "v": n.to_string() }),
        CborValue::Text(t) => {
            let utf8 = t.as_bytes();
            let inline = if utf8.len() <= TEXT_INLINE_MAX_BYTES {
                Value::String(t.as_ref().to_owned())
            } else {
                Value::Null
            };
            json!({
                "t": "text",
                "utf8_byte_length": utf8.len(),
                "fnv1a64_hex": fnv1a64_hex(utf8),
                "inline": inline,
            })
        }
        CborValue::Bytes(b) => {
            let inline_hex = if b.len() <= BYTES_INLINE_MAX_BYTES {
                Value::String(to_hex(b))
            } else {
                Value::Null
            };
            json!({
                "t": "bytes",
                "byte_length": b.len(),
                "fnv1a64_hex": fnv1a64_hex(b),
                "inline_hex": inline_hex,
            })
        }
        CborValue::Array(items) => {
            let projected: Vec<Value> = items.iter().map(project_cbor).collect();
            json!({ "t": "array", "items": projected })
        }
        CborValue::Map(entries) => {
            let projected: Vec<Value> = entries
                .iter()
                .map(|(k, v)| {
                    json!({
                        "key": k.to_string(),
                        "value": project_cbor(v),
                    })
                })
                .collect();
            json!({ "t": "map", "entries": projected })
        }
    }
}

fn project_bootstrap(record: BootstrapRecord) -> Value {
    match record {
        BootstrapRecord::ClientHello(ch) => {
            json!({
                "variant": "client_hello",
                "wire_versions": ch.wire_versions,
                "transport_capabilities": {
                    "webtransport_http3": ch.transport_capabilities.webtransport_http3,
                    "binary_wss": ch.transport_capabilities.binary_wss,
                    "max_datagram_size": ch.transport_capabilities.max_datagram_size,
                },
                "buffer_capabilities": {
                    "transferable_arraybuffer": ch.buffer_capabilities.transferable_arraybuffer,
                    "shared_arraybuffer": ch.buffer_capabilities.shared_arraybuffer,
                },
                "requested_limits": {
                    "max_channels": ch.requested_limits.max_channels,
                    "max_session_bytes": ch.requested_limits.max_session_bytes
                        .map(|n| Value::String(n.to_string()))
                        .unwrap_or(Value::Null),
                    "max_message_bytes": ch.requested_limits.max_message_bytes,
                    "max_control_payload_bytes": ch.requested_limits.max_control_payload_bytes,
                },
                "extension_capabilities": ch.extension_capabilities,
            })
        }
        BootstrapRecord::ServerHello(sh) => {
            json!({
                "variant": "server_hello",
                "selected_wire_version": sh.selected_wire_version,
                "transport_capabilities": {
                    "webtransport_http3": sh.transport_capabilities.webtransport_http3,
                    "binary_wss": sh.transport_capabilities.binary_wss,
                    "max_datagram_size": sh.transport_capabilities.max_datagram_size,
                },
                "buffer_capabilities": {
                    "transferable_arraybuffer": sh.buffer_capabilities.transferable_arraybuffer,
                    "shared_arraybuffer": sh.buffer_capabilities.shared_arraybuffer,
                },
                "effective_limits": {
                    "max_channels": sh.effective_limits.max_channels,
                    "max_session_bytes": sh.effective_limits.max_session_bytes.to_string(),
                    "max_message_bytes": sh.effective_limits.max_message_bytes,
                    "max_control_payload_bytes": sh.effective_limits.max_control_payload_bytes,
                },
                "extension_capabilities": sh.extension_capabilities,
            })
        }
        BootstrapRecord::BootstrapError(be) => {
            json!({
                "variant": "bootstrap_error",
                "code": be.code,
                "message": be.message.as_deref().map(text_digest).unwrap_or(Value::Null),
                "detail": be.detail.as_deref().map(text_digest).unwrap_or(Value::Null),
            })
        }
    }
}

fn project_frame(frame: &DecodedFrame<'_>, raw: &[u8]) -> Value {
    let payload_start = FRAME_HEADER_LENGTH + usize::from(frame.extension_len);
    let payload_end = payload_start + frame.payload_len as usize;
    assert!(
        payload_end <= raw.len(),
        "frame payload range requires bytes within input length"
    );
    let raw_payload = &raw[payload_start..payload_end];

    let extensions: Vec<Value> = frame
        .extensions
        .iter()
        .map(|e| {
            json!({
                "type_id": e.type_id,
                "critical": e.critical,
                "value_len": e.value.len(),
                "value_fnv1a64_hex": fnv1a64_hex(e.value),
            })
        })
        .collect();

    let payload = match &frame.payload {
        FramePayload::Application(body) => {
            let (head, tail) = head_tail_hex(body);
            json!({
                "form": "application",
                "payload_len": body.len(),
                "payload_fnv1a64_hex": fnv1a64_hex(body),
                "payload_head_hex": head,
                "payload_tail_hex": tail,
            })
        }
        FramePayload::Control(msg) => {
            let keys: Vec<u64> = msg.fields.keys().copied().collect();
            let entries: Vec<Value> = msg
                .fields
                .iter()
                .map(|(k, v)| {
                    json!({
                        "key": k.to_string(),
                        "value": project_cbor(v),
                    })
                })
                .collect();
            json!({
                "form": "control",
                "payload_len": raw_payload.len(),
                "payload_fnv1a64_hex": fnv1a64_hex(raw_payload),
                "control_kind": msg.kind,
                "control_field_keys": keys,
                "control_fields": {
                    "t": "map",
                    "entries": entries,
                },
            })
        }
    };

    json!({
        "version": frame.version,
        "opcode": frame.opcode,
        "flags": frame.flags,
        "channel_id": frame.channel_id,
        "sequence": frame.sequence.to_string(),
        "source_time_ns": frame.source_time_ns.to_string(),
        "payload_len": frame.payload_len,
        "extension_len": frame.extension_len,
        "priority": frame.priority,
        "clock_id": frame.clock_id,
        "extensions": extensions,
        "payload": payload,
    })
}

fn project_error(err: &ProtocolError) -> Value {
    json!({
        "code": err.code,
        "name": err.name,
        "reason": err.reason,
        "offset": err.offset,
        "plane": err.plane,
        "step": err.step,
    })
}

struct OutcomeParts<'a> {
    corpus: &'a str,
    source_id: &'a str,
    parser_kind: &'a str,
    representation: &'a str,
    byte_length: usize,
    input_sha256: &'a str,
    status: &'a str,
    record: Option<Value>,
    error: Option<Value>,
}

fn outcome(parts: OutcomeParts<'_>) -> Value {
    json!({
        "id": format!("{}:{}", parts.corpus, parts.source_id),
        "corpus": parts.corpus,
        "source_id": parts.source_id,
        "parser_kind": parts.parser_kind,
        "representation": parts.representation,
        "byte_length": parts.byte_length,
        "input_sha256": parts.input_sha256,
        "status": parts.status,
        "record": parts.record.unwrap_or(Value::Null),
        "error": parts.error.unwrap_or(Value::Null),
    })
}

// ---------------------------------------------------------------------------
// Corpus builders
// ---------------------------------------------------------------------------

fn build_valid_boundary(root: &Path) -> Vec<Value> {
    let testdata = root.join("protocol/testdata");
    let manifest = read_json(&testdata.join("manifest.json"));
    let fixtures = manifest["fixtures"]
        .as_array()
        .expect("valid manifest requires fixtures array");
    assert_eq!(
        fixtures.len(),
        VALID_TOTAL,
        "valid_boundary requires {VALID_TOTAL} fixtures"
    );

    let mut out = Vec::with_capacity(VALID_TOTAL);
    let mut recipe_seen = false;
    for entry in fixtures {
        let id = entry["id"].as_str().expect("valid fixture requires id");
        let kind = entry["kind"].as_str().expect("valid fixture requires kind");
        let representation = entry["representation"]
            .as_str()
            .expect("valid fixture requires representation");
        let byte_length = entry["byte_length"]
            .as_u64()
            .expect("valid fixture requires byte_length") as usize;
        let sha256 = entry["sha256"]
            .as_str()
            .expect("valid fixture requires sha256");

        let bytes = if representation == "segment_recipe" {
            assert_eq!(id, RECIPE_ID, "segment_recipe requires id {RECIPE_ID}");
            assert!(
                !recipe_seen,
                "valid corpus requires exactly one segment_recipe"
            );
            recipe_seen = true;
            let bytes = materialize_segment_recipe(entry);
            assert_eq!(
                bytes.len(),
                byte_length,
                "{id} requires materialized byte_length"
            );
            bytes
        } else {
            assert_eq!(
                representation, "binary",
                "{id} requires representation binary or segment_recipe"
            );
            let rel = entry["path"]
                .as_str()
                .unwrap_or_else(|| panic!("{id} binary fixture requires path"));
            load_binary_under(
                &testdata,
                rel,
                byte_length,
                &format!("valid fixture {id} path"),
            )
        };

        let (parser_kind, record) = match kind {
            "bootstrap" => {
                let rec = parse_bootstrap(&bytes)
                    .unwrap_or_else(|e| panic!("{id} requires successful bootstrap parse: {e}"));
                ("bootstrap", project_bootstrap(rec))
            }
            "frame" => {
                let frame = parse_frame(&bytes, None)
                    .unwrap_or_else(|e| panic!("{id} requires successful frame parse: {e}"));
                let projected = project_frame(&frame, &bytes);
                if id == RECIPE_ID {
                    let payload = &projected["payload"];
                    assert_eq!(
                        payload["form"], "application",
                        "64 MiB recipe requires application payload"
                    );
                    assert_eq!(
                        payload["payload_fnv1a64_hex"], RECIPE_PAYLOAD_FNV1A64_HEX,
                        "64 MiB recipe requires pinned payload FNV"
                    );
                    assert_eq!(
                        payload["payload_len"], RECIPE_PAYLOAD_LENGTH,
                        "64 MiB recipe requires pinned payload_len"
                    );
                }
                ("frame", projected)
            }
            other => panic!("{id} requires kind bootstrap or frame, got {other}"),
        };

        out.push(outcome(OutcomeParts {
            corpus: "valid_boundary",
            source_id: id,
            parser_kind,
            representation,
            byte_length,
            input_sha256: sha256,
            status: "success",
            record: Some(record),
            error: None,
        }));
    }
    assert!(
        recipe_seen,
        "valid corpus requires the 64 MiB segment_recipe"
    );
    out
}

fn build_sequences(root: &Path) -> Vec<Value> {
    let seq_root = root.join("protocol/testdata/sequences");
    let manifest = read_json(&seq_root.join("manifest.json"));
    let events = manifest["events"]
        .as_array()
        .expect("sequences manifest requires events array");
    assert_eq!(
        events.len(),
        SEQUENCES_TOTAL,
        "sequences requires {SEQUENCES_TOTAL} events"
    );

    let mut out = Vec::with_capacity(SEQUENCES_TOTAL);
    for entry in events {
        let id = entry["id"].as_str().expect("sequence event requires id");
        let carrier = entry["carrier"]
            .as_str()
            .expect("sequence event requires carrier");
        let rel = entry["path"]
            .as_str()
            .expect("sequence event requires path");
        let byte_length = entry["byte_length"]
            .as_u64()
            .expect("sequence event requires byte_length") as usize;
        let sha256 = entry["sha256"]
            .as_str()
            .expect("sequence event requires sha256");

        let bytes = load_binary_under(
            &seq_root,
            rel,
            byte_length,
            &format!("sequence event {id} path"),
        );

        let (parser_kind, record) = match carrier {
            "bootstrap" => {
                let rec = parse_bootstrap(&bytes)
                    .unwrap_or_else(|e| panic!("{id} requires successful bootstrap parse: {e}"));
                ("bootstrap", project_bootstrap(rec))
            }
            "control_cbor" | "ros_sample" => {
                let frame = parse_frame(&bytes, None)
                    .unwrap_or_else(|e| panic!("{id} requires successful frame parse: {e}"));
                ("frame", project_frame(&frame, &bytes))
            }
            other => {
                panic!("{id} requires carrier bootstrap, control_cbor, or ros_sample; got {other}")
            }
        };

        out.push(outcome(OutcomeParts {
            corpus: "sequences",
            source_id: id,
            parser_kind,
            representation: "binary",
            byte_length,
            input_sha256: sha256,
            status: "success",
            record: Some(record),
            error: None,
        }));
    }
    out
}

fn build_malformed(root: &Path) -> Vec<Value> {
    let testdata = root.join("protocol/testdata");
    let manifest = read_json(&testdata.join("malformed/manifest.json"));
    let fixtures = manifest["fixtures"]
        .as_array()
        .expect("malformed manifest requires fixtures array");
    assert_eq!(
        fixtures.len(),
        MALFORMED_TOTAL,
        "malformed requires {MALFORMED_TOTAL} fixtures"
    );

    let mut out = Vec::with_capacity(MALFORMED_TOTAL);
    for entry in fixtures {
        let id = entry["id"].as_str().expect("malformed fixture requires id");
        let kind = entry["kind"]
            .as_str()
            .expect("malformed fixture requires kind");
        let rel = entry["path"]
            .as_str()
            .expect("malformed fixture requires path");
        let byte_length = entry["byte_length"]
            .as_u64()
            .expect("malformed fixture requires byte_length") as usize;
        let sha256 = entry["sha256"]
            .as_str()
            .expect("malformed fixture requires sha256");
        let expected = &entry["expected"];
        let oracle_code = expected["registry_code"]
            .as_u64()
            .expect("malformed expected.registry_code") as u32;
        let oracle_name = expected["registry_name"]
            .as_str()
            .expect("malformed expected.registry_name");
        let oracle_reason = expected["reason"]
            .as_str()
            .expect("malformed expected.reason");
        let oracle_offset = expected["offset"]
            .as_u64()
            .expect("malformed expected.offset") as usize;
        let oracle_plane = expected["plane"]
            .as_str()
            .expect("malformed expected.plane");
        let oracle_step = expected["step"].as_u64().expect("malformed expected.step") as u8;

        let bytes = load_binary_under(
            &testdata,
            rel,
            byte_length,
            &format!("malformed fixture {id} path"),
        );

        let err = match kind {
            "bootstrap" => parse_bootstrap(&bytes)
                .expect_err(&format!("{id} requires bootstrap parse failure")),
            "frame" => {
                let ctx = entry
                    .get("decoder_context")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                let opts = frame_options_from_context(&ctx);
                parse_frame(&bytes, Some(&opts))
                    .expect_err(&format!("{id} requires frame parse failure"))
            }
            other => panic!("{id} requires kind bootstrap or frame, got {other}"),
        };

        assert_eq!(err.code, oracle_code, "{id} error.code");
        assert_eq!(err.name, oracle_name, "{id} error.name");
        assert_eq!(err.reason, oracle_reason, "{id} error.reason");
        assert_eq!(err.offset, oracle_offset, "{id} error.offset");
        assert_eq!(err.plane, oracle_plane, "{id} error.plane");
        assert_eq!(err.step, oracle_step, "{id} error.step");

        let parser_kind = match kind {
            "bootstrap" => "bootstrap",
            "frame" => "frame",
            _ => unreachable!(),
        };

        out.push(outcome(OutcomeParts {
            corpus: "malformed",
            source_id: id,
            parser_kind,
            representation: "binary",
            byte_length,
            input_sha256: sha256,
            status: "error",
            record: None,
            error: Some(project_error(&err)),
        }));
    }
    out
}

fn build_rust_outcomes(root: &Path) -> Vec<Value> {
    let mut outcomes = Vec::with_capacity(OUTCOMES_TOTAL);
    outcomes.extend(build_valid_boundary(root));
    outcomes.extend(build_sequences(root));
    outcomes.extend(build_malformed(root));
    outcomes.sort_by(|a, b| {
        let ai = a["id"].as_str().unwrap_or("");
        let bi = b["id"].as_str().unwrap_or("");
        ai.cmp(bi)
    });
    assert_eq!(
        outcomes.len(),
        OUTCOMES_TOTAL,
        "agreement outcomes require total {OUTCOMES_TOTAL}"
    );
    let success = outcomes.iter().filter(|o| o["status"] == "success").count();
    let error = outcomes.iter().filter(|o| o["status"] == "error").count();
    assert_eq!(
        success, SUCCESS_TOTAL,
        "agreement outcomes require {SUCCESS_TOTAL} success"
    );
    assert_eq!(
        error, ERROR_TOTAL,
        "agreement outcomes require {ERROR_TOTAL} error"
    );
    for i in 1..outcomes.len() {
        let prev = outcomes[i - 1]["id"].as_str().unwrap();
        let cur = outcomes[i]["id"].as_str().unwrap();
        assert!(
            prev < cur,
            "outcome ids require strict ascending unique order"
        );
    }
    outcomes
}

fn emit_envelope(outcomes: &[Value]) {
    let mut envelope = Map::new();
    envelope.insert("schema_version".into(), json!(SCHEMA_VERSION));
    envelope.insert("protocol".into(), json!(PROTOCOL_ID));
    envelope.insert("implementation".into(), json!(IMPLEMENTATION));
    envelope.insert("outcomes".into(), Value::Array(outcomes.to_vec()));
    let compact = serde_json::to_string(&Value::Object(envelope))
        .expect("agreement envelope requires serializable JSON");
    // The begin marker starts on its own line after cargo test status text.
    println!();
    println!("{EMIT_BEGIN}");
    println!("{compact}");
    println!("{EMIT_END}");
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

#[test]
fn rust_outcomes_match_expected() {
    let root = repo_root();
    let outcomes = build_rust_outcomes(&root);

    let expected_path = root.join("protocol/testdata/agreement/expected.json");
    let expected_doc = read_json(&expected_path);
    assert_eq!(
        expected_doc["schema_version"], SCHEMA_VERSION,
        "expected.json requires schema_version {SCHEMA_VERSION}"
    );
    assert_eq!(
        expected_doc["protocol"], PROTOCOL_ID,
        "expected.json requires protocol {PROTOCOL_ID}"
    );
    assert_eq!(
        expected_doc["generated_by"], EXPECTED_GENERATED_BY,
        "expected.json requires generated_by {EXPECTED_GENERATED_BY}"
    );
    assert_eq!(
        expected_doc["batch"], EXPECTED_BATCH,
        "expected.json requires batch {EXPECTED_BATCH}"
    );
    let expected_outcomes = expected_doc["outcomes"]
        .as_array()
        .expect("expected.json requires outcomes array");
    assert_eq!(
        expected_outcomes.len(),
        OUTCOMES_TOTAL,
        "expected.json requires {OUTCOMES_TOTAL} outcomes"
    );

    for (got, exp) in outcomes.iter().zip(expected_outcomes.iter()) {
        assert_eq!(
            got, exp,
            "Rust outcome must equal expected for id={}",
            got["id"]
        );
    }

    if std::env::var(EMIT_ENV).ok().as_deref() == Some("1") {
        emit_envelope(&outcomes);
    }
}
