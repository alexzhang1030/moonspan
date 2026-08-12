//! Corpus adversarial gate for the CDR Rust port (R1-01).

mod common;

use common::*;
use rclweb::{CdrEndian, CdrErrorCode, CdrLimits, CdrReader};

const EXACT_TAIL: usize = 24;
const TAIL_BEARING: usize = 32;
const FOUR_BYTE_TAILS: usize = 12;
const TWELVE_BYTE_TAILS: usize = 20;
const NONZERO_TAIL_MUTATIONS: usize = 288;
const FIXTURE_TOTAL: usize = 56;

fn wrong_tail(declared: usize) -> usize {
    match declared {
        0 => 4,
        4 => 0,
        12 => 4,
        other => panic!("unexpected declared tail {other}"),
    }
}

#[test]
fn strict_and_declared_completion_across_all_56() {
    let manifest = load_manifest();
    let tail = load_tail_slack();
    let tail_by_id: std::collections::HashMap<&str, &serde_json::Value> = tail["fixtures"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| (f["id"].as_str().unwrap(), f))
        .collect();

    let mut exact = 0;
    let mut bearing = 0;
    for fx in manifest["fixtures"].as_array().unwrap() {
        let id = fx["id"].as_str().unwrap();
        let case_id = fx["case_id"].as_str().unwrap();
        let path = fx["serialized"]["path"].as_str().unwrap();
        let bytes = load_fixture_bytes(path);
        let t = tail_by_id[id];
        let logical = t["logical_byte_length"].as_u64().unwrap() as usize;
        let zero_tail = t["zero_tail_bytes"].as_u64().unwrap() as usize;

        let mut r = open_default(&bytes);
        let _ = decode_case(&mut r, case_id);
        assert_eq!(r.position(), logical);
        if zero_tail == 0 {
            r.ensure_complete().unwrap();
            assert_eq!(r.remaining(), 0);
            exact += 1;
        } else {
            let err = r.ensure_complete().unwrap_err();
            assert_eq!(err.code, CdrErrorCode::TrailingData);
            assert_eq!(err.offset, logical);
            assert_eq!(err.remaining, zero_tail as u64);
            assert_eq!(err.needed, 0);
            assert_eq!(r.position(), logical);
            r.ensure_complete_with_zero_tail(zero_tail).unwrap();
            assert_eq!(r.remaining(), 0);
            assert_eq!(r.position(), bytes.len());
            bearing += 1;
        }
    }
    assert_eq!(exact, EXACT_TAIL);
    assert_eq!(bearing, TAIL_BEARING);
    assert_eq!(exact + bearing, FIXTURE_TOTAL);
}

#[test]
fn nonzero_mutation_of_every_declared_tail_byte() {
    let manifest = load_manifest();
    let tail = load_tail_slack();
    let tail_by_id: std::collections::HashMap<&str, &serde_json::Value> = tail["fixtures"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| (f["id"].as_str().unwrap(), f))
        .collect();

    let mut mutations = 0usize;
    let mut four = 0usize;
    let mut twelve = 0usize;
    for fx in manifest["fixtures"].as_array().unwrap() {
        let id = fx["id"].as_str().unwrap();
        let case_id = fx["case_id"].as_str().unwrap();
        let t = tail_by_id[id];
        let zero_tail = t["zero_tail_bytes"].as_u64().unwrap() as usize;
        if zero_tail == 0 {
            continue;
        }
        match zero_tail {
            4 => four += 1,
            12 => twelve += 1,
            other => panic!("{id} unexpected tail {other}"),
        }
        let logical = t["logical_byte_length"].as_u64().unwrap() as usize;
        let path = fx["serialized"]["path"].as_str().unwrap();
        let base = load_fixture_bytes(path);
        for t_idx in 0..zero_tail {
            let dirty_index = logical + t_idx;
            let mut dirty = base.clone();
            dirty[dirty_index] = 0x01;
            let mut r = open_default(&dirty);
            let _ = decode_case(&mut r, case_id);
            assert_eq!(r.position(), logical);
            let err = r.ensure_complete_with_zero_tail(zero_tail).unwrap_err();
            assert_eq!(err.code, CdrErrorCode::TrailingData);
            assert_eq!(err.offset, logical);
            assert_eq!(err.remaining, zero_tail as u64);
            assert_eq!(r.position(), logical);
            mutations += 1;
        }
    }
    assert_eq!(four, FOUR_BYTE_TAILS);
    assert_eq!(twelve, TWELVE_BYTE_TAILS);
    assert_eq!(mutations, NONZERO_TAIL_MUTATIONS);
}

#[test]
fn exact_end_any_declaration_wrong_declaration_and_appended_byte() {
    let manifest = load_manifest();
    let tail = load_tail_slack();
    let tail_by_id: std::collections::HashMap<&str, &serde_json::Value> = tail["fixtures"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| (f["id"].as_str().unwrap(), f))
        .collect();

    let mut exact_decl_ok = 0usize;
    let mut wrong_reject = 0usize;
    let mut append_reject = 0usize;

    for fx in manifest["fixtures"].as_array().unwrap() {
        let id = fx["id"].as_str().unwrap();
        let case_id = fx["case_id"].as_str().unwrap();
        let path = fx["serialized"]["path"].as_str().unwrap();
        let bytes = load_fixture_bytes(path);
        let t = tail_by_id[id];
        let logical = t["logical_byte_length"].as_u64().unwrap() as usize;
        let zero_tail = t["zero_tail_bytes"].as_u64().unwrap() as usize;

        if zero_tail == 0 {
            let mut r = open_default(&bytes);
            let _ = decode_case(&mut r, case_id);
            r.ensure_complete_with_zero_tail(4).unwrap();
            exact_decl_ok += 1;
        } else {
            let mut r = open_default(&bytes);
            let _ = decode_case(&mut r, case_id);
            let wrong = wrong_tail(zero_tail);
            let err = r.ensure_complete_with_zero_tail(wrong).unwrap_err();
            assert_eq!(err.code, CdrErrorCode::TrailingData);
            wrong_reject += 1;
        }

        let mut appended = bytes.clone();
        appended.push(0);
        let mut r = open_default(&appended);
        let _ = decode_case(&mut r, case_id);
        assert_eq!(r.position(), logical);
        let err = r.ensure_complete_with_zero_tail(zero_tail).unwrap_err();
        assert_eq!(err.code, CdrErrorCode::TrailingData);
        append_reject += 1;
    }

    assert_eq!(exact_decl_ok, EXACT_TAIL);
    assert_eq!(wrong_reject, TAIL_BEARING);
    assert_eq!(append_reject, FIXTURE_TOTAL);
}

#[test]
fn stream_open_at_length_rejects_one_byte_below() {
    let manifest = load_manifest();
    let mut ok_n = 0usize;
    let mut reject_n = 0usize;
    for fx in manifest["fixtures"].as_array().unwrap() {
        let path = fx["serialized"]["path"].as_str().unwrap();
        let bytes = load_fixture_bytes(path);
        let len = bytes.len();
        let limits_ok = CdrLimits::new(len, 8, len).unwrap();
        open_with(&bytes, limits_ok).unwrap();
        ok_n += 1;

        let below = len - 1;
        let limits_bad = CdrLimits::new(below, 8, below).unwrap();
        let err = open_with(&bytes, limits_bad).unwrap_err();
        assert_eq!(err.code, CdrErrorCode::BoundsExceeded);
        assert_eq!(err.offset, 0);
        assert_eq!(err.needed, len as u64);
        assert_eq!(err.remaining, below as u64);
        reject_n += 1;
    }
    assert_eq!(ok_n, FIXTURE_TOTAL);
    assert_eq!(reject_n, FIXTURE_TOTAL);
}

#[test]
fn point_cloud2_borrowed_data_under_small_temp_budget() {
    let path = "fixtures/H-CY/point_cloud2.bin";
    let bytes = load_fixture_bytes(path);
    let temp_budget = 18;
    assert!(temp_budget < 96);
    assert!(temp_budget >= 9);
    let limits = CdrLimits::new(bytes.len(), 2, temp_budget).unwrap();
    let mut r = CdrReader::open(&bytes, limits).unwrap();
    let value = decode_case(&mut r, "point_cloud2");
    let CorpusValue::PointCloud2(cloud) = &value else {
        panic!("expected PointCloud2");
    };
    assert_eq!(cloud.data.len(), 96);
    let input_start = bytes.as_ptr() as usize;
    let view_start = cloud.data.as_ptr() as usize;
    assert!(view_start >= input_start && view_start < input_start + bytes.len());
    r.ensure_complete_with_zero_tail(0).unwrap();

    let logical = 257;
    let w_limits = CdrLimits::new(logical, 2, logical).unwrap();
    let mut w = rclweb::CdrWriter::new(CdrEndian::Little, w_limits).unwrap();
    encode_case(&mut w, &value);
    let out = w.to_bytes();
    assert_eq!(out.len(), logical);
    assert_eq!(out.as_slice(), &bytes[..logical]);
}

#[test]
fn framing_bridge_le_be_encapsulation_faults() {
    for n in 0..4 {
        let arr = vec![0u8; n];
        let err = CdrReader::open_default(&arr).unwrap_err();
        assert_eq!(err.code, CdrErrorCode::InvalidEncapsulation);
        assert_eq!(err.offset, 0);
        assert_eq!(err.needed, 4);
        assert_eq!(err.remaining, n as u64);
    }
    for rep in [0x0002u16, 0x0003, 0xFFFF] {
        let mut arr = vec![0u8; 4];
        arr[0] = (rep >> 8) as u8;
        arr[1] = (rep & 0xFF) as u8;
        let err = CdrReader::open_default(&arr).unwrap_err();
        assert_eq!(err.code, CdrErrorCode::UnsupportedRepresentation);
    }
    // Canonical LE/BE headers open.
    assert!(CdrReader::open_default(&[0x00, 0x01, 0x00, 0x00]).is_ok());
    assert!(CdrReader::open_default(&[0x00, 0x00, 0x00, 0x00]).is_ok());
}
