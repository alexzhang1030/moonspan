//! Manifest-driven bootstrap fixture tests (valid + malformed).

use super::{BOOTSTRAP_PREFIX_LENGTH, BootstrapRecord, ProtocolError, parse_bootstrap};
use serde_json::Value;
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
}
