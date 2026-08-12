//! Manifest-driven bootstrap + frame fixture tests.

use super::{
    BOOTSTRAP_PREFIX_LENGTH, BootstrapRecord, FRAME_HEADER_LENGTH, FRAME_PAYLOAD_MAX_BYTES,
    FrameOptions, FramePayload, OPCODE_CONTROL_CBOR, OPCODE_MEDIA_CHUNK, OPCODE_ROS_SAMPLE,
    ProtocolError, parse_bootstrap, parse_frame,
};
use serde_json::Value;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("workspace root")
        .to_path_buf()
}

fn read_json(path: &Path) -> Value {
    let text = fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()))
}

fn load_bin(root: &Path, rel: &str) -> Vec<u8> {
    let path = root.join("protocol/testdata").join(rel);
    fs::read(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
}

fn frame_options_from_context(ctx: &Value) -> FrameOptions {
    let mut opts = FrameOptions::default();
    if let Some(v) = ctx.get("selectedVersion").and_then(|x| x.as_u64()) {
        opts.selected_version = v as u8;
    }
    if let Some(v) = ctx
        .get("experimentalOpcodesEnabled")
        .and_then(|x| x.as_bool())
    {
        opts.experimental_opcodes_enabled = v;
    }
    if let Some(arr) = ctx.get("availableClockIds").and_then(|x| x.as_array()) {
        opts.available_clock_ids = arr
            .iter()
            .filter_map(|x| x.as_u64().map(|n| n as u8))
            .collect::<BTreeSet<_>>();
    }
    opts
}

/// Parse a manifest integer that may be a JSON number or `{ "$type": "bigint", "value": "..." }`.
fn parse_manifest_i64(v: &Value, label: &str) -> i64 {
    if let Some(n) = v.as_i64() {
        return n;
    }
    if let Some(n) = v.as_u64() {
        return i64::try_from(n).unwrap_or_else(|_| panic!("{label}: u64 out of i64 range"));
    }
    if v.get("$type").and_then(|t| t.as_str()) == Some("bigint") {
        let s = v["value"]
            .as_str()
            .unwrap_or_else(|| panic!("{label}: bigint value must be string"));
        return s
            .parse::<i64>()
            .unwrap_or_else(|e| panic!("{label}: parse bigint {s}: {e}"));
    }
    panic!("{label}: expected number or bigint wrapper, got {v}");
}

fn parse_hex_pattern(hex: &str) -> Vec<u8> {
    assert!(
        hex.len().is_multiple_of(2) && !hex.is_empty(),
        "pattern_hex must be nonempty even-length"
    );
    assert!(
        hex.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')),
        "pattern_hex must be lowercase hex"
    );
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
        .collect()
}

/// Materialize one segment_recipe frame from a valid/boundary manifest entry.
fn materialize_segment_recipe_frame(entry: &Value) -> (Vec<u8>, u8, u32, u64, u8, u8, u32) {
    assert_eq!(entry["kind"], "frame");
    assert_eq!(entry["representation"], "segment_recipe");
    assert!(entry["path"].is_null(), "segment_recipe path must be null");

    let source = &entry["source"];
    assert_eq!(source["$type"], "frame");
    let opcode = source["opcode"].as_u64().expect("opcode") as u8;
    let channel_id = source["channelId"].as_u64().expect("channelId") as u32;
    let sequence = source["sequence"].as_u64().expect("sequence");
    let priority = source["priority"].as_u64().expect("priority") as u8;
    let clock_id = source["clockId"].as_u64().expect("clockId") as u8;

    let recipe = &source["payload"];
    assert_eq!(recipe["$type"], "recipe");
    assert_eq!(recipe["kind"], "pattern_fill");
    let pattern_hex = recipe["pattern_hex"].as_str().expect("pattern_hex");
    let pattern = parse_hex_pattern(pattern_hex);
    let payload_len = recipe["length"].as_u64().expect("recipe length") as u32;
    assert_eq!(
        entry["payload_length"].as_u64().expect("payload_length") as u32,
        payload_len
    );
    let byte_length = entry["byte_length"].as_u64().expect("byte_length") as usize;
    assert_eq!(byte_length, FRAME_HEADER_LENGTH + payload_len as usize);

    let mut bytes = vec![0u8; byte_length];
    bytes[0] = 0; // selected version 0
    bytes[1] = opcode;
    bytes[4..8].copy_from_slice(&channel_id.to_be_bytes());
    bytes[8..16].copy_from_slice(&sequence.to_be_bytes());
    // source_time_ns 0 for clock NONE (and default when absent)
    bytes[24..28].copy_from_slice(&payload_len.to_be_bytes());
    // extension_len 0
    bytes[30] = priority;
    bytes[31] = clock_id;
    let payload = &mut bytes[FRAME_HEADER_LENGTH..];
    for (i, b) in payload.iter_mut().enumerate() {
        *b = pattern[i % pattern.len()];
    }
    (
        bytes,
        opcode,
        channel_id,
        sequence,
        priority,
        clock_id,
        payload_len,
    )
}

#[test]
fn valid_bootstrap_fixtures_parse_key_fields() {
    let root = repo_root();
    let manifest = read_json(&root.join("protocol/testdata/manifest.json"));
    let fixtures = manifest["fixtures"].as_array().expect("fixtures array");

    let mut seen = 0usize;
    for entry in fixtures {
        if entry["kind"].as_str() != Some("bootstrap") {
            continue;
        }
        if entry["representation"].as_str() != Some("binary") {
            continue;
        }
        let id = entry["id"].as_str().unwrap();
        let path = entry["path"].as_str().expect("binary bootstrap path");
        let bytes = load_bin(&root, path);
        assert_eq!(
            bytes.len(),
            entry["byte_length"].as_u64().unwrap() as usize,
            "{id} length"
        );

        let record = parse_bootstrap(&bytes).unwrap_or_else(|e| {
            panic!("{id}: expected success, got {e:?}");
        });
        let source = &entry["source"];
        match (source["kind"].as_str().unwrap(), record) {
            ("client_hello", BootstrapRecord::ClientHello(ch)) => {
                assert_eq!(ch.wire_versions.len(), 16);
                assert_eq!(ch.wire_versions.first().copied(), Some(0));
                assert_eq!(ch.wire_versions.last().copied(), Some(15));
                assert!(ch.transport_capabilities.webtransport_http3);
                assert!(ch.transport_capabilities.binary_wss);
                assert_eq!(ch.transport_capabilities.max_datagram_size, Some(u32::MAX));
                assert!(ch.buffer_capabilities.transferable_arraybuffer);
                assert!(ch.buffer_capabilities.shared_arraybuffer);
                assert_eq!(ch.requested_limits.max_channels, Some(u32::MAX));
                assert_eq!(ch.requested_limits.max_session_bytes, Some(u64::MAX));
                assert_eq!(ch.requested_limits.max_message_bytes, Some(u32::MAX));
                assert_eq!(
                    ch.requested_limits.max_control_payload_bytes,
                    Some(u32::MAX)
                );
                assert_eq!(ch.extension_capabilities.len(), 64);
                assert_eq!(ch.extension_capabilities.first().copied(), Some(1));
                assert_eq!(ch.extension_capabilities.last().copied(), Some(64));
            }
            ("server_hello", BootstrapRecord::ServerHello(sh)) => {
                assert_eq!(sh.selected_wire_version, 0);
                assert!(sh.transport_capabilities.webtransport_http3);
                assert!(sh.transport_capabilities.binary_wss);
                assert_eq!(sh.transport_capabilities.max_datagram_size, Some(65_535));
                assert!(sh.buffer_capabilities.transferable_arraybuffer);
                assert!(!sh.buffer_capabilities.shared_arraybuffer);
                assert_eq!(sh.effective_limits.max_channels, 65_535);
                assert_eq!(sh.effective_limits.max_session_bytes, 4_294_967_296);
                assert_eq!(sh.effective_limits.max_message_bytes, 67_108_864);
                assert_eq!(sh.effective_limits.max_control_payload_bytes, 1_048_576);
                assert_eq!(sh.extension_capabilities, vec![1, 2, 3]);
            }
            ("bootstrap_error", BootstrapRecord::BootstrapError(be)) => {
                assert_eq!(be.code, 1);
                let msg = be.message.as_ref().expect("message");
                let detail = be.detail.as_ref().expect("detail");
                assert_eq!(msg.len(), 4096);
                assert_eq!(detail.len(), 4096);
                assert!(msg.bytes().all(|b| b == b'a'));
                assert!(detail.bytes().all(|b| b == b'b'));
            }
            (kind, other) => panic!("{id}: kind {kind} got {other:?}"),
        }
        seen += 1;
    }
    assert_eq!(
        seen, 3,
        "expected exactly 3 materialized valid bootstrap bins"
    );
}

#[test]
fn valid_frame_fixtures_parse_key_fields() {
    let root = repo_root();
    let manifest = read_json(&root.join("protocol/testdata/manifest.json"));
    let fixtures = manifest["fixtures"].as_array().expect("fixtures array");

    let mut seen = 0usize;
    for entry in fixtures {
        if entry["kind"].as_str() != Some("frame") {
            continue;
        }
        if entry["representation"].as_str() != Some("binary") {
            continue;
        }
        let id = entry["id"].as_str().unwrap();
        let path = entry["path"].as_str().expect("binary frame path");
        let bytes = load_bin(&root, path);
        assert_eq!(
            bytes.len(),
            entry["byte_length"].as_u64().unwrap() as usize,
            "{id} length"
        );
        let frame = parse_frame(&bytes, None).unwrap_or_else(|e| {
            panic!("{id}: expected success, got {e:?}");
        });
        let source = &entry["source"];
        let opcode = source["opcode"].as_u64().unwrap() as u8;
        assert_eq!(frame.opcode, opcode, "{id} opcode");
        assert_eq!(frame.version, 0, "{id} version");
        if let Some(ch) = source.get("channelId").and_then(|x| x.as_u64()) {
            assert_eq!(frame.channel_id, ch as u32, "{id} channel");
        }
        if let Some(seq) = source.get("sequence") {
            if let Some(n) = seq.as_u64() {
                assert_eq!(frame.sequence, n, "{id} sequence");
            } else if seq.get("$type").and_then(|t| t.as_str()) == Some("bigint") {
                let v = seq["value"].as_str().unwrap();
                assert_eq!(frame.sequence, v.parse::<u64>().unwrap(), "{id} sequence");
            }
        }
        if let Some(pri) = source.get("priority").and_then(|x| x.as_u64()) {
            assert_eq!(frame.priority, pri as u8, "{id} priority");
        }
        if let Some(clk) = source.get("clockId").and_then(|x| x.as_u64()) {
            assert_eq!(frame.clock_id, clk as u8, "{id} clock");
        }
        if let Some(flags) = source.get("flags").and_then(|x| x.as_u64()) {
            assert_eq!(frame.flags, flags as u16, "{id} flags");
        }
        if let Some(st) = source.get("sourceTimeNs") {
            let expected = parse_manifest_i64(st, &format!("{id} sourceTimeNs"));
            assert_eq!(frame.source_time_ns, expected, "{id} sourceTimeNs");
        }
        match &frame.payload {
            FramePayload::Control(msg) => {
                assert_eq!(frame.opcode, OPCODE_CONTROL_CBOR, "{id}");
                assert!(msg.kind >= 1 && msg.kind <= 15, "{id} control kind");
                if id.contains("session-ready") {
                    assert_eq!(msg.kind, 2, "{id} SessionReady kind");
                }
                if id.contains("schema-request") {
                    assert_eq!(msg.kind, 5, "{id} SchemaRequest kind");
                }
            }
            FramePayload::Application(p) => {
                assert_eq!(p.len(), frame.payload_len as usize, "{id} payload len");
                if id.contains("media-chunk") {
                    assert_eq!(frame.opcode, OPCODE_MEDIA_CHUNK);
                }
                if id.contains("ros-sample") {
                    assert_eq!(frame.opcode, OPCODE_ROS_SAMPLE);
                }
            }
        }
        if id.contains("service-request-trace") {
            assert!(
                frame.extensions.iter().any(|e| e.type_id == 1),
                "{id} TRACE"
            );
            assert!(frame.extensions.iter().any(|e| e.type_id == 2), "{id} OPID");
        }
        seen += 1;
    }
    assert_eq!(
        seen, 18,
        "expected exactly 18 materialized valid frame bins"
    );
}

#[test]
fn valid_segment_recipe_64mib_frame_parses_with_borrowed_payload() {
    let root = repo_root();
    let manifest = read_json(&root.join("protocol/testdata/manifest.json"));
    let fixtures = manifest["fixtures"].as_array().expect("fixtures array");
    let recipes: Vec<&Value> = fixtures
        .iter()
        .filter(|f| f["representation"] == "segment_recipe")
        .collect();
    assert_eq!(
        recipes.len(),
        1,
        "expected exactly one segment_recipe entry"
    );
    let entry = recipes[0];
    assert_eq!(entry["id"], "frame-app-payload-64mib-recipe");

    let (bytes, opcode, channel_id, sequence, priority, clock_id, payload_len) =
        materialize_segment_recipe_frame(entry);
    assert_eq!(opcode, OPCODE_ROS_SAMPLE);
    assert_eq!(channel_id, 13);
    assert_eq!(sequence, 0);
    assert_eq!(priority, 2);
    assert_eq!(clock_id, 0);
    assert_eq!(payload_len, FRAME_PAYLOAD_MAX_BYTES);
    assert_eq!(bytes.len(), FRAME_HEADER_LENGTH + payload_len as usize);

    let frame = parse_frame(&bytes, None).expect("segment_recipe frame parses");
    assert_eq!(frame.opcode, opcode);
    assert_eq!(frame.channel_id, 13);
    assert_eq!(frame.sequence, sequence);
    assert_eq!(frame.priority, priority);
    assert_eq!(frame.clock_id, clock_id);
    assert_eq!(frame.payload_len, payload_len);
    match frame.payload {
        FramePayload::Application(p) => {
            assert_eq!(p.len(), payload_len as usize);
            assert_eq!(p.as_ptr(), bytes[FRAME_HEADER_LENGTH..].as_ptr());
            // pattern_hex a55a from manifest
            assert_eq!(p[0], 0xa5);
            assert_eq!(p[1], 0x5a);
            assert_eq!(p[p.len() - 2], 0xa5);
            assert_eq!(p[p.len() - 1], 0x5a);
        }
        _ => panic!("expected application payload"),
    }
}

#[test]
fn corpus_totals_22_valid_and_55_malformed() {
    let root = repo_root();
    let valid = read_json(&root.join("protocol/testdata/manifest.json"));
    let malformed = read_json(&root.join("protocol/testdata/malformed/manifest.json"));
    let vf = valid["fixtures"].as_array().unwrap();
    let mf = malformed["fixtures"].as_array().unwrap();
    assert_eq!(vf.len(), 22, "valid fixtures total");
    assert_eq!(mf.len(), 55, "malformed fixtures total");
    let vb = vf.iter().filter(|f| f["kind"] == "bootstrap").count();
    let vf_frames = vf.iter().filter(|f| f["kind"] == "frame").count();
    let mb = mf.iter().filter(|f| f["kind"] == "bootstrap").count();
    let mf_frames = mf.iter().filter(|f| f["kind"] == "frame").count();
    assert_eq!(vb + vf_frames, 22);
    assert_eq!(mb, 14);
    assert_eq!(mf_frames, 41);
    assert_eq!(mb + mf_frames, 55);
}

#[test]
fn malformed_bootstrap_fixtures_match_expected_oracle() {
    let root = repo_root();
    let manifest = read_json(&root.join("protocol/testdata/malformed/manifest.json"));
    let fixtures = manifest["fixtures"].as_array().expect("fixtures array");

    let mut seen = 0usize;
    for entry in fixtures {
        if entry["kind"].as_str() != Some("bootstrap") {
            continue;
        }
        let path = entry["path"]
            .as_str()
            .unwrap_or_else(|| panic!("{}: missing path", entry["id"]));
        let id = entry["id"].as_str().unwrap();
        let bytes = load_bin(&root, path);
        let expected = &entry["expected"];
        let err = parse_bootstrap(&bytes).expect_err(&format!("{id} should fail"));

        assert_eq!(
            err.code,
            expected["registry_code"].as_u64().unwrap() as u32,
            "{id} code"
        );
        assert_eq!(
            err.name,
            expected["registry_name"].as_str().unwrap(),
            "{id} name"
        );
        assert_eq!(
            err.reason,
            expected["reason"].as_str().unwrap(),
            "{id} reason"
        );
        assert_eq!(
            err.offset,
            expected["offset"].as_u64().unwrap() as usize,
            "{id} offset"
        );
        assert_eq!(err.plane, expected["plane"].as_str().unwrap(), "{id} plane");
        assert_eq!(
            err.step,
            expected["step"].as_u64().unwrap() as u8,
            "{id} step"
        );
        seen += 1;
    }
    assert_eq!(
        seen, 14,
        "expected exactly 14 executable malformed bootstrap bins"
    );
}

#[test]
fn malformed_frame_fixtures_match_expected_oracle() {
    let root = repo_root();
    let manifest = read_json(&root.join("protocol/testdata/malformed/manifest.json"));
    let fixtures = manifest["fixtures"].as_array().expect("fixtures array");

    let mut seen = 0usize;
    for entry in fixtures {
        if entry["kind"].as_str() != Some("frame") {
            continue;
        }
        let path = entry["path"]
            .as_str()
            .unwrap_or_else(|| panic!("{}: missing path", entry["id"]));
        let id = entry["id"].as_str().unwrap();
        let bytes = load_bin(&root, path);
        let expected = &entry["expected"];
        let ctx = entry
            .get("decoder_context")
            .cloned()
            .unwrap_or(Value::Object(Default::default()));
        let opts = frame_options_from_context(&ctx);
        let err = parse_frame(&bytes, Some(&opts)).expect_err(&format!("{id} should fail"));

        assert_eq!(
            err.code,
            expected["registry_code"].as_u64().unwrap() as u32,
            "{id} code"
        );
        assert_eq!(
            err.name,
            expected["registry_name"].as_str().unwrap(),
            "{id} name"
        );
        assert_eq!(
            err.reason,
            expected["reason"].as_str().unwrap(),
            "{id} reason got={} expected={}",
            err.reason,
            expected["reason"]
        );
        assert_eq!(
            err.offset,
            expected["offset"].as_u64().unwrap() as usize,
            "{id} offset got={} expected={}",
            err.offset,
            expected["offset"]
        );
        assert_eq!(err.plane, expected["plane"].as_str().unwrap(), "{id} plane");
        assert_eq!(
            err.step,
            expected["step"].as_u64().unwrap() as u8,
            "{id} step got={} expected={}",
            err.step,
            expected["step"]
        );
        seen += 1;
    }
    assert_eq!(
        seen, 41,
        "expected exactly 41 executable malformed frame bins"
    );
}

#[test]
fn protocol_error_fields_are_agreement_ready() {
    let err = ProtocolError::malformed_bootstrap("bad_magic", 0, 2);
    assert_eq!(err.code, 1);
    assert_eq!(err.name, "malformed_bootstrap");
    assert_eq!(err.reason, "bad_magic");
    assert_eq!(err.offset, 0);
    assert_eq!(err.plane, "bootstrap");
    assert_eq!(err.step, 2);
    // Formatting stays total and includes stable tokens.
    let s = err.to_string();
    assert!(s.contains("malformed_bootstrap"));
    assert!(s.contains("bad_magic"));

    let fe = ProtocolError::malformed_frame("truncated_header", 0, 1);
    assert_eq!(fe.plane, "selected_frame");
    assert_eq!(fe.code, 3);
}

#[test]
fn short_and_adversarial_inputs_return_stable_errors() {
    // Every prefix shorter than 12 bytes returns step 1 (truncated_prefix).
    let pad = [0xffu8; 11];
    for len in 0..=11 {
        let err = parse_bootstrap(&pad[..len]).unwrap_err();
        assert_eq!(err.step, 1, "len={len}");
        assert_eq!(err.reason, "truncated_prefix", "len={len}");
        assert_eq!(err.code, 1, "len={len}");
        assert_eq!(err.offset, 0, "len={len}");
        assert_eq!(err.plane, "bootstrap", "len={len}");
    }

    // Step 6: legal 12-byte prefix declaring payload_len 65536 (head-only payload).
    let step6 = [
        0x52, 0x32, 0x57, 0x50, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
    ];
    let err = parse_bootstrap(&step6).unwrap_err();
    assert_eq!(err.step, 6);
    assert_eq!(err.reason, "payload_too_large");
    assert_eq!(err.code, 24);
    assert_eq!(err.offset, 8);

    // Step 8: valid prefix with payload_len 0 and absent body → cbor_profile.
    let empty_payload = [
        0x52, 0x32, 0x57, 0x50, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ];
    let err = parse_bootstrap(&empty_payload).unwrap_err();
    assert_eq!(err.step, 8);
    assert_eq!(err.reason, "cbor_profile");
    assert_eq!(err.offset, BOOTSTRAP_PREFIX_LENGTH);

    // Frame short header → step 1.
    let err = parse_frame(&[0u8; 31], None).unwrap_err();
    assert_eq!(err.step, 1);
    assert_eq!(err.reason, "truncated_header");
    assert_eq!(err.plane, "selected_frame");
}
