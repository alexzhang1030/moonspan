//! Encoder proofs against the frozen parser oracle and committed fixtures.
//!
//! Every valid binary fixture must re-encode byte-identically from its parsed
//! form (the fixtures declare `roundtrip: decode-reencode`). The single
//! exception is the unknown-noncritical extension fixture: the decoder
//! deliberately drops unknown TLVs, so its parsed form cannot reproduce them.

use super::cbor::CborValue;
use super::encode::{
    FrameHeader, encode_bootstrap_error, encode_client_hello, encode_control_frame,
    encode_deterministic_cbor, encode_extension_area, encode_frame, encode_server_hello,
};
use super::frame::{FrameOptions, FramePayload, OPCODE_ROS_SAMPLE, parse_frame};
use super::{BootstrapRecord, parse_bootstrap};
use serde_json::Value;
use std::borrow::Cow;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().expect("workspace root").to_path_buf()
}

fn read_manifest(root: &Path) -> Value {
    let path = root.join("protocol/testdata/manifest.json");
    let text = fs::read_to_string(&path).expect("read manifest");
    serde_json::from_str(&text).expect("parse manifest")
}

fn load_bin(root: &Path, rel: &str) -> Vec<u8> {
    let path = root.join("protocol/testdata").join(rel);
    fs::read(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
}

fn frame_options_from_context(ctx: &Value) -> FrameOptions {
    let mut opts = FrameOptions::default();
    if let Some(v) = ctx.get("selectedVersion").and_then(Value::as_u64) {
        opts.selected_version = v as u8;
    }
    if let Some(v) = ctx.get("experimentalOpcodesEnabled").and_then(Value::as_bool) {
        opts.experimental_opcodes_enabled = v;
    }
    if let Some(arr) = ctx.get("availableClockIds").and_then(Value::as_array) {
        opts.available_clock_ids =
            arr.iter().filter_map(|x| x.as_u64().map(|n| n as u8)).collect::<BTreeSet<_>>();
    }
    opts
}

#[test]
fn valid_bootstrap_fixtures_reencode_byte_identical() {
    let root = repo_root();
    let manifest = read_manifest(&root);
    let mut seen = 0usize;
    for entry in manifest["fixtures"].as_array().unwrap() {
        if entry["kind"].as_str() != Some("bootstrap")
            || entry["representation"].as_str() != Some("binary")
        {
            continue;
        }
        let id = entry["id"].as_str().unwrap();
        let bytes = load_bin(&root, entry["path"].as_str().unwrap());
        let record = parse_bootstrap(&bytes).unwrap_or_else(|e| panic!("{id}: parse {e:?}"));
        let reencoded = match &record {
            BootstrapRecord::ClientHello(hello) => encode_client_hello(hello),
            BootstrapRecord::ServerHello(hello) => encode_server_hello(hello),
            BootstrapRecord::BootstrapError(err) => encode_bootstrap_error(err),
        }
        .unwrap_or_else(|e| panic!("{id}: encode {e:?}"));
        assert_eq!(reencoded, bytes, "{id}: byte identity");
        seen += 1;
    }
    assert_eq!(seen, 3, "expected 3 valid bootstrap fixtures");
}

/// Unknown noncritical TLVs are dropped by the decoder by design; the parsed
/// form of this fixture cannot reproduce them.
const REENCODE_SKIP: &[&str] = &["frame-extension-area-4096-unknown-noncritical"];

#[test]
fn valid_frame_fixtures_reencode_byte_identical() {
    let root = repo_root();
    let manifest = read_manifest(&root);
    let mut seen = 0usize;
    for entry in manifest["fixtures"].as_array().unwrap() {
        if entry["kind"].as_str() != Some("frame")
            || entry["representation"].as_str() != Some("binary")
            || entry["expected"]["status"].as_str() != Some("success")
        {
            continue;
        }
        let id = entry["id"].as_str().unwrap();
        if REENCODE_SKIP.contains(&id) {
            continue;
        }
        let bytes = load_bin(&root, entry["path"].as_str().unwrap());
        let opts = frame_options_from_context(&entry["context"]);
        let frame =
            parse_frame(&bytes, Some(&opts)).unwrap_or_else(|e| panic!("{id}: parse {e:?}"));

        let extension_area = encode_extension_area(&frame.extensions)
            .unwrap_or_else(|e| panic!("{id}: extension encode {e:?}"));
        let payload = match &frame.payload {
            FramePayload::Application(p) => p.to_vec(),
            FramePayload::Control(msg) => {
                let map = CborValue::Map(
                    msg.fields.iter().map(|(k, v)| (*k, v.clone())).collect::<Vec<_>>(),
                );
                encode_deterministic_cbor(&map)
                    .unwrap_or_else(|e| panic!("{id}: control encode {e:?}"))
            }
        };
        let reencoded = encode_frame(
            &FrameHeader {
                version: frame.version,
                opcode: frame.opcode,
                flags: frame.flags,
                channel_id: frame.channel_id,
                sequence: frame.sequence,
                source_time_ns: frame.source_time_ns,
                priority: frame.priority,
                clock_id: frame.clock_id,
            },
            &extension_area,
            &payload,
        )
        .unwrap_or_else(|e| panic!("{id}: frame encode {e:?}"));
        assert_eq!(reencoded, bytes, "{id}: byte identity");
        seen += 1;
    }
    assert!(seen >= 10, "expected at least 10 reencoded frame fixtures");
}

#[test]
fn control_frame_encoder_parses_back() {
    // Heartbeat {kind:12, correlation:16 zero bytes, counter:7}
    let message = CborValue::Map(vec![
        (1, CborValue::Unsigned(12)),
        (2, CborValue::Bytes(Cow::Owned(vec![0u8; 16]))),
        (40, CborValue::Unsigned(7)),
    ]);
    let bytes = encode_control_frame(0, 3, &message).unwrap();
    let frame = parse_frame(&bytes, None).unwrap();
    assert_eq!(frame.opcode, super::frame::OPCODE_CONTROL_CBOR);
    assert_eq!(frame.channel_id, 0);
    assert_eq!(frame.sequence, 3);
    match frame.payload {
        FramePayload::Control(msg) => {
            assert_eq!(msg.kind, 12);
            assert_eq!(msg.fields.get(&40), Some(&CborValue::Unsigned(7)));
        }
        FramePayload::Application(_) => panic!("expected control payload"),
    }
}

#[test]
fn ros_sample_frame_encoder_parses_back() {
    let payload = [0u8, 1, 0, 0, 6, 0, 0, 0, b'h', b'e', b'l', b'l', b'o', 0];
    let bytes = encode_frame(
        &FrameHeader {
            version: 0,
            opcode: OPCODE_ROS_SAMPLE,
            flags: super::frame::FLAG_ROS_RELIABLE,
            channel_id: 9,
            sequence: 0,
            source_time_ns: 0,
            priority: 2,
            clock_id: 0,
        },
        &[],
        &payload,
    )
    .unwrap();
    let frame = parse_frame(&bytes, None).unwrap();
    assert_eq!(frame.opcode, OPCODE_ROS_SAMPLE);
    assert_eq!(frame.channel_id, 9);
    assert_eq!(frame.flags, super::frame::FLAG_ROS_RELIABLE);
    match frame.payload {
        FramePayload::Application(p) => assert_eq!(p, payload),
        FramePayload::Control(_) => panic!("expected application payload"),
    }
}

#[test]
fn deterministic_cbor_boundary_heads_round_trip() {
    use super::cbor::decode_deterministic_cbor;
    let cases: Vec<CborValue<'static>> = vec![
        CborValue::Unsigned(0),
        CborValue::Unsigned(23),
        CborValue::Unsigned(24),
        CborValue::Unsigned(0xff),
        CborValue::Unsigned(0x100),
        CborValue::Unsigned(0xffff),
        CborValue::Unsigned(0x1_0000),
        CborValue::Unsigned(0xffff_ffff),
        CborValue::Unsigned(0x1_0000_0000),
        CborValue::Unsigned(u64::MAX),
        CborValue::Negative(-1),
        CborValue::Negative(-24),
        CborValue::Negative(-25),
        CborValue::Negative(i128::from(i64::MIN)),
        CborValue::Negative(-(i128::from(u64::MAX)) - 1),
        CborValue::Bool(true),
        CborValue::Bool(false),
        CborValue::Null,
        CborValue::Text(Cow::Borrowed("chatter")),
        CborValue::Bytes(Cow::Owned(vec![0xaa; 300])),
        CborValue::Array(vec![CborValue::Unsigned(1), CborValue::Negative(-2)]),
        CborValue::Map(vec![
            (1, CborValue::Unsigned(2)),
            (29, CborValue::Text(Cow::Borrowed("x"))),
        ]),
    ];
    for value in &cases {
        let bytes = encode_deterministic_cbor(value).unwrap();
        let decoded = decode_deterministic_cbor(&bytes)
            .unwrap_or_else(|e| panic!("decode of {value:?} failed: {e:?}"));
        assert_eq!(&decoded, value, "round trip {value:?}");
    }
}

#[test]
fn map_keys_are_sorted_and_duplicates_rejected() {
    let unsorted = CborValue::Map(vec![(29, CborValue::Unsigned(1)), (1, CborValue::Unsigned(8))]);
    let bytes = encode_deterministic_cbor(&unsorted).unwrap();
    // Deterministic profile requires ascending keys; the parser is the oracle.
    let decoded = super::cbor::decode_deterministic_cbor(&bytes).unwrap();
    match decoded {
        CborValue::Map(entries) => {
            assert_eq!(entries[0].0, 1);
            assert_eq!(entries[1].0, 29);
        }
        _ => panic!("expected map"),
    }

    let duplicate = CborValue::Map(vec![(1, CborValue::Unsigned(1)), (1, CborValue::Unsigned(2))]);
    let err = encode_deterministic_cbor(&duplicate).unwrap_err();
    assert_eq!(err.reason, "duplicate_map_key");
}

#[test]
fn frame_encoder_rejects_oversized_and_misaligned_input() {
    let header = FrameHeader {
        version: 0,
        opcode: OPCODE_ROS_SAMPLE,
        flags: 0,
        channel_id: 1,
        sequence: 0,
        source_time_ns: 0,
        priority: 2,
        clock_id: 0,
    };
    let err = encode_frame(&header, &[0u8; 6], &[]).unwrap_err();
    assert_eq!(err.reason, "extension_area_bounds");
    let err = encode_frame(&header, &[0u8; 4100], &[]).unwrap_err();
    assert_eq!(err.reason, "extension_area_bounds");

    let control_header = FrameHeader {
        opcode: super::frame::OPCODE_CONTROL_CBOR,
        channel_id: 0,
        priority: 0,
        ..header
    };
    let big = vec![0u8; super::control::CONTROL_PAYLOAD_MAX_BYTES + 1];
    let err = encode_frame(&control_header, &[], &big).unwrap_err();
    assert_eq!(err.reason, "control_payload_too_large");
}
