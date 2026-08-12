//! Integration tests: Phase 1 generated codecs + schema registry.
//!
//! Decodes one corpus fixture per root via production codecs and exact-encodes
//! the logical prefix (zero top-level tail).

mod common;

use common::{load_fixture_bytes, load_manifest, load_tail_slack};
use rclweb::types::generated::{
    collections, echo_nested, measure_sequence, nested_sample, point_cloud2, primitive_scalars,
};
use rclweb::{
    CdrEndian, CdrRepresentation, SCHEME_REP2011_RIHS, SchemaKey, SchemaRegistry,
    schema_identity_for_type,
};
use serde_json::Value;

fn fixture_for_type<'a>(manifest: &'a Value, type_name: &str) -> &'a Value {
    manifest["fixtures"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| {
            f["type_name"] == type_name
                && f["support_row_id"] == "J-FT"
                && f["serialized"]["endianness"] == "little"
        })
        .unwrap_or_else(|| panic!("missing J-FT little fixture for {type_name}"))
}

fn zero_tail_for(tail_slack: &Value, fixture_id: &str) -> usize {
    tail_slack["fixtures"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["id"] == fixture_id)
        .map(|f| f["zero_tail_bytes"].as_u64().unwrap() as usize)
        .unwrap_or_else(|| panic!("missing tail-slack for {fixture_id}"))
}

#[test]
fn phase1_registry_counts() {
    let reg = SchemaRegistry::phase1().unwrap();
    assert_eq!(reg.identity_count(), 18);
    assert_eq!(reg.descriptor_count(), 9);
}

#[test]
fn schema_identity_helper_for_roots() {
    let id = schema_identity_for_type(
        "moonspan_cdr_interfaces/msg/PrimitiveScalars",
        SCHEME_REP2011_RIHS,
    )
    .unwrap()
    .expect("root");
    assert_eq!(id.0, SCHEME_REP2011_RIHS);
    assert!(id.1.starts_with("RIHS01_"));
    assert!(
        schema_identity_for_type("std_msgs/msg/String", SCHEME_REP2011_RIHS)
            .unwrap()
            .is_none()
    );
}

#[test]
fn decode_encode_one_fixture_per_root() {
    let manifest = load_manifest();
    let tail_slack = load_tail_slack();

    // PrimitiveScalars
    {
        let f = fixture_for_type(&manifest, primitive_scalars::TYPE_NAME);
        let bytes = load_fixture_bytes(f["serialized"]["path"].as_str().unwrap());
        let z = zero_tail_for(&tail_slack, f["id"].as_str().unwrap());
        let v = primitive_scalars::decode(&bytes, z).unwrap();
        let again = primitive_scalars::encode(&v, CdrEndian::Little).unwrap();
        assert_eq!(&bytes[..again.len()], again.as_slice());
        assert!(bytes[again.len()..].iter().all(|&b| b == 0));
    }

    // Collections
    {
        let f = fixture_for_type(&manifest, collections::TYPE_NAME);
        let bytes = load_fixture_bytes(f["serialized"]["path"].as_str().unwrap());
        let z = zero_tail_for(&tail_slack, f["id"].as_str().unwrap());
        let v = collections::decode(&bytes, z).unwrap();
        let again = collections::encode(&v, CdrEndian::Little).unwrap();
        assert_eq!(&bytes[..again.len()], again.as_slice());
    }

    // NestedSample
    {
        let f = fixture_for_type(&manifest, nested_sample::TYPE_NAME);
        let bytes = load_fixture_bytes(f["serialized"]["path"].as_str().unwrap());
        let z = zero_tail_for(&tail_slack, f["id"].as_str().unwrap());
        let v = nested_sample::decode(&bytes, z).unwrap();
        let again = nested_sample::encode(&v, CdrEndian::Little).unwrap();
        assert_eq!(&bytes[..again.len()], again.as_slice());
    }

    // EchoNested Request/Response
    {
        let f = fixture_for_type(&manifest, echo_nested::REQUEST_TYPE_NAME);
        let bytes = load_fixture_bytes(f["serialized"]["path"].as_str().unwrap());
        let z = zero_tail_for(&tail_slack, f["id"].as_str().unwrap());
        let v = echo_nested::decode_request(&bytes, z).unwrap();
        let again = echo_nested::encode_request(&v, CdrEndian::Little).unwrap();
        assert_eq!(&bytes[..again.len()], again.as_slice());
    }
    {
        let f = fixture_for_type(&manifest, echo_nested::RESPONSE_TYPE_NAME);
        let bytes = load_fixture_bytes(f["serialized"]["path"].as_str().unwrap());
        let z = zero_tail_for(&tail_slack, f["id"].as_str().unwrap());
        let v = echo_nested::decode_response(&bytes, z).unwrap();
        let again = echo_nested::encode_response(&v, CdrEndian::Little).unwrap();
        assert_eq!(&bytes[..again.len()], again.as_slice());
    }

    // MeasureSequence Goal/Result/Feedback
    {
        let f = fixture_for_type(&manifest, measure_sequence::GOAL_TYPE_NAME);
        let bytes = load_fixture_bytes(f["serialized"]["path"].as_str().unwrap());
        let z = zero_tail_for(&tail_slack, f["id"].as_str().unwrap());
        let v = measure_sequence::decode_goal(&bytes, z).unwrap();
        let again = measure_sequence::encode_goal(&v, CdrEndian::Little).unwrap();
        assert_eq!(&bytes[..again.len()], again.as_slice());
    }
    {
        let f = fixture_for_type(&manifest, measure_sequence::RESULT_TYPE_NAME);
        let bytes = load_fixture_bytes(f["serialized"]["path"].as_str().unwrap());
        let z = zero_tail_for(&tail_slack, f["id"].as_str().unwrap());
        let v = measure_sequence::decode_result(&bytes, z).unwrap();
        let again = measure_sequence::encode_result(&v, CdrEndian::Little).unwrap();
        assert_eq!(&bytes[..again.len()], again.as_slice());
    }
    {
        let f = fixture_for_type(&manifest, measure_sequence::FEEDBACK_TYPE_NAME);
        let bytes = load_fixture_bytes(f["serialized"]["path"].as_str().unwrap());
        let z = zero_tail_for(&tail_slack, f["id"].as_str().unwrap());
        let v = measure_sequence::decode_feedback(&bytes, z).unwrap();
        let again = measure_sequence::encode_feedback(&v, CdrEndian::Little).unwrap();
        assert_eq!(&bytes[..again.len()], again.as_slice());
    }

    // PointCloud2 (borrowed data)
    {
        let f = fixture_for_type(&manifest, point_cloud2::TYPE_NAME);
        let bytes = load_fixture_bytes(f["serialized"]["path"].as_str().unwrap());
        let z = zero_tail_for(&tail_slack, f["id"].as_str().unwrap());
        let v = point_cloud2::decode(&bytes, z).unwrap();
        let again = point_cloud2::encode(&v, CdrEndian::Little).unwrap();
        assert_eq!(&bytes[..again.len()], again.as_slice());
        let start = bytes.as_ptr() as usize;
        let data_start = v.data.as_ptr() as usize;
        assert!(data_start >= start && data_start < start + bytes.len());
    }
}

#[test]
fn lookup_primitive_scalars_j_ft() {
    let reg = SchemaRegistry::phase1().unwrap();
    let key = SchemaKey::new(
        SCHEME_REP2011_RIHS,
        "RIHS01_db44c373c05fc055970958730d7cb835f816b091b68bfdf93d6ed50086092cea",
        "moonspan_cdr_interfaces/msg/PrimitiveScalars",
        1,
        1,
    )
    .unwrap();
    let le = reg.lookup(&key, "J-FT", CdrRepresentation::Le).unwrap();
    assert_eq!(le.zero_tail_bytes, 4);
    let be = reg.lookup(&key, "J-FT", CdrRepresentation::Be).unwrap();
    assert_eq!(be.zero_tail_bytes, 0);
}
