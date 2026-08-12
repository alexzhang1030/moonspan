//! Corpus semantic decode / re-encode gate for the CDR Rust port (R1-01).

mod common;

use common::*;
use std::collections::HashMap;

#[test]
fn frozen_corpus_counts() {
    let manifest = load_manifest();
    let fixtures = manifest["fixtures"].as_array().unwrap();
    let comparisons = manifest["comparisons"].as_array().unwrap();
    assert_eq!(fixtures.len(), 56);
    assert_eq!(comparisons.len(), 18);

    let tail = load_tail_slack();
    let summary = &tail["summary"];
    assert_eq!(summary["fixtures"].as_u64().unwrap(), 56);
    assert_eq!(summary["comparisons"].as_u64().unwrap(), 18);
    assert_eq!(summary["exact_fixtures"].as_u64().unwrap(), 24);
    assert_eq!(summary["four_byte_tail_fixtures"].as_u64().unwrap(), 12);
    assert_eq!(summary["twelve_byte_tail_fixtures"].as_u64().unwrap(), 20);

    let mut exact = 0;
    let mut four = 0;
    let mut twelve = 0;
    for fx in tail["fixtures"].as_array().unwrap() {
        match fx["zero_tail_bytes"].as_u64().unwrap() {
            0 => exact += 1,
            4 => four += 1,
            12 => twelve += 1,
            other => panic!("unexpected zero_tail_bytes {other}"),
        }
    }
    assert_eq!((exact, four, twelve), (24, 12, 20));
}

#[test]
fn decode_all_56_fixtures_against_manifest_values_and_reencode() {
    let manifest = load_manifest();
    let tail = load_tail_slack();
    let tail_by_id: HashMap<&str, &serde_json::Value> = tail["fixtures"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| (f["id"].as_str().unwrap(), f))
        .collect();

    let fixtures = manifest["fixtures"].as_array().unwrap();
    assert_eq!(fixtures.len(), 56);

    for fx in fixtures {
        let id = fx["id"].as_str().unwrap();
        let case_id = fx["case_id"].as_str().unwrap();
        let ser = &fx["serialized"];
        let path = ser["path"].as_str().unwrap();
        let byte_length = ser["byte_length"].as_u64().unwrap() as usize;
        let endian = endian_of(ser["endianness"].as_str().unwrap());
        let bytes = load_fixture_bytes(path);
        assert_eq!(bytes.len(), byte_length, "{id} byte_length");

        let tail_fx = tail_by_id[id];
        let logical = tail_fx["logical_byte_length"].as_u64().unwrap() as usize;
        let zero_tail = tail_fx["zero_tail_bytes"].as_u64().unwrap() as usize;
        assert_eq!(logical + zero_tail, byte_length, "{id} logical+tail");

        let mut r = open_default(&bytes);
        let value = decode_case(&mut r, case_id);
        assert_eq!(r.position(), logical, "{id} logical cursor");
        assert_value_vs_json(&value, case_id, &fx["values"]);
        r.ensure_complete_with_zero_tail(zero_tail)
            .unwrap_or_else(|e| panic!("{id} zero-tail: {e}"));

        let mut w = writer_default(endian);
        encode_case(&mut w, &value);
        let out = w.to_bytes();
        assert_eq!(out.len(), logical, "{id} re-encode length");
        assert_eq!(out.as_slice(), &bytes[..logical], "{id} re-encode bytes");
    }
}

#[test]
fn comparison_groups_semantic_equality() {
    let manifest = load_manifest();
    let comparisons = manifest["comparisons"].as_array().unwrap();
    assert_eq!(comparisons.len(), 18);

    let fixtures = manifest["fixtures"].as_array().unwrap();
    let by_key: HashMap<(String, String), &serde_json::Value> = fixtures
        .iter()
        .map(|f| {
            (
                (
                    f["support_row_id"].as_str().unwrap().to_string(),
                    f["case_id"].as_str().unwrap().to_string(),
                ),
                f,
            )
        })
        .collect();

    for group in comparisons {
        let case_id = group["case_id"].as_str().unwrap();
        let rows = group["rows"].as_array().unwrap();
        let mut decoded = Vec::new();
        let mut owned_bytes = Vec::new();
        for row in rows {
            let row_id = row.as_str().unwrap();
            let fx = by_key[&(row_id.to_string(), case_id.to_string())];
            let path = fx["serialized"]["path"].as_str().unwrap();
            owned_bytes.push(load_fixture_bytes(path));
        }
        for (i, row) in rows.iter().enumerate() {
            let row_id = row.as_str().unwrap();
            let fx = by_key[&(row_id.to_string(), case_id.to_string())];
            let mut r = open_default(&owned_bytes[i]);
            let value = decode_case(&mut r, case_id);
            assert_value_vs_json(&value, case_id, &fx["values"]);
            decoded.push(value);
        }
        for i in 1..decoded.len() {
            assert!(
                semantic_eq(&decoded[0], &decoded[i]),
                "comparison {case_id} row {} vs {}",
                rows[0],
                rows[i]
            );
        }
    }
}

#[test]
fn point_cloud2_data_is_borrowed_input_backed() {
    let bytes = load_fixture_bytes("fixtures/H-CY/point_cloud2.bin");
    let mut r = open_default(&bytes);
    let value = decode_case(&mut r, "point_cloud2");
    let CorpusValue::PointCloud2(cloud) = value else {
        panic!("expected PointCloud2");
    };
    assert_eq!(cloud.data.len(), 96);
    let input_start = bytes.as_ptr() as usize;
    let input_end = input_start + bytes.len();
    let view_start = cloud.data.as_ptr() as usize;
    assert!(view_start >= input_start && view_start + cloud.data.len() <= input_end);
}
