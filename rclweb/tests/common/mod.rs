//! Shared corpus helpers for CDR integration tests.

#![allow(dead_code)]

use rclweb::{CdrEndian, CdrError, CdrLimits, CdrNesting, CdrReader, CdrWriter};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

pub fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().expect("workspace root").to_path_buf()
}

pub fn cdr_root() -> PathBuf {
    repo_root().join("conformance/cdr")
}

pub fn read_json(path: &Path) -> Value {
    let text = fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {}: {e}", path.display()))
}

pub fn load_manifest() -> Value {
    read_json(&cdr_root().join("manifest.json"))
}

pub fn load_tail_slack() -> Value {
    read_json(&cdr_root().join("tail-slack.json"))
}

pub fn load_fixture_bytes(serialized_path: &str) -> Vec<u8> {
    let path = cdr_root().join(serialized_path);
    fs::read(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
}

pub fn json_i64(v: &Value) -> i64 {
    if let Some(n) = v.as_i64() {
        return n;
    }
    if let Some(n) = v.as_u64() {
        return i64::try_from(n).expect("u64→i64");
    }
    if let Some(s) = v.as_str() {
        return s.parse().unwrap_or_else(|_| panic!("parse i64 {s}"));
    }
    panic!("expected i64-compatible json, got {v}");
}

pub fn json_u64(v: &Value) -> u64 {
    if let Some(n) = v.as_u64() {
        return n;
    }
    if let Some(n) = v.as_i64() {
        return u64::try_from(n).expect("i64→u64");
    }
    if let Some(s) = v.as_str() {
        return s.parse().unwrap_or_else(|_| panic!("parse u64 {s}"));
    }
    panic!("expected u64-compatible json, got {v}");
}

pub fn json_f64(v: &Value) -> f64 {
    v.as_f64().unwrap_or_else(|| panic!("expected f64, got {v}"))
}

pub fn assert_f64_bits(got: f64, expected: f64) {
    assert_eq!(got.to_bits(), expected.to_bits(), "f64 bits {got} vs {expected}");
}

pub fn assert_f32_bits(got: f32, expected: f32) {
    assert_eq!(got.to_bits(), expected.to_bits(), "f32 bits {got} vs {expected}");
}

#[derive(Debug, Clone, PartialEq)]
pub struct Time {
    pub sec: i32,
    pub nanosec: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PrimitiveScalars {
    pub bool_value: bool,
    pub byte_value: u8,
    pub char_value: u8,
    pub float32_value: f32,
    pub float64_value: f64,
    pub int8_value: i8,
    pub uint8_value: u8,
    pub int16_value: i16,
    pub uint16_value: u16,
    pub int32_value: i32,
    pub uint32_value: u32,
    pub int64_value: i64,
    pub uint64_value: u64,
    pub string_value: String,
    pub wstring_value: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Collections {
    pub fixed_i32: [i32; 3],
    pub bounded_f64: Vec<f64>,
    pub bytes_value: Vec<u8>,
    pub bounded_string: String,
    pub bounded_wstring: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NestedSample {
    pub stamp: Time,
    pub scalars: PrimitiveScalars,
    pub collections: Collections,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PointField {
    pub name: String,
    pub offset: u32,
    pub datatype: u8,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Header {
    pub stamp: Time,
    pub frame_id: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PointCloud2<'a> {
    pub header: Header,
    pub height: u32,
    pub width: u32,
    pub fields: Vec<PointField>,
    pub is_bigendian: bool,
    pub point_step: u32,
    pub row_step: u32,
    pub data: &'a [u8],
    pub is_dense: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CorpusValue<'a> {
    PrimitiveScalars(PrimitiveScalars),
    Collections(Collections),
    NestedSample(NestedSample),
    EchoNestedRequest { input: NestedSample },
    EchoNestedResponse { output: NestedSample, accepted: bool },
    MeasureSequenceGoal { target: Collections },
    MeasureSequenceResult { result: NestedSample },
    MeasureSequenceFeedback { progress: f32, sample: NestedSample },
    PointCloud2(PointCloud2<'a>),
}

fn abort(ctx: &str, e: CdrError) -> ! {
    panic!("{ctx}: {e}");
}

pub fn decode_time(r: &mut CdrReader<'_>, _n: CdrNesting) -> Time {
    let sec = r.read_i32().unwrap_or_else(|e| abort("Time.sec", e));
    let nanosec = r.read_u32().unwrap_or_else(|e| abort("Time.nanosec", e));
    Time { sec, nanosec }
}

pub fn encode_time(w: &mut CdrWriter, v: &Time, _n: CdrNesting) {
    w.write_i32(v.sec).unwrap_or_else(|e| abort("enc Time.sec", e));
    w.write_u32(v.nanosec).unwrap_or_else(|e| abort("enc Time.nanosec", e));
}

pub fn decode_primitive_scalars(r: &mut CdrReader<'_>, _n: CdrNesting) -> PrimitiveScalars {
    PrimitiveScalars {
        bool_value: r.read_bool().unwrap_or_else(|e| abort("bool_value", e)),
        byte_value: r.read_u8().unwrap_or_else(|e| abort("byte_value", e)),
        char_value: r.read_u8().unwrap_or_else(|e| abort("char_value", e)),
        float32_value: r.read_f32().unwrap_or_else(|e| abort("float32_value", e)),
        float64_value: r.read_f64().unwrap_or_else(|e| abort("float64_value", e)),
        int8_value: r.read_i8().unwrap_or_else(|e| abort("int8_value", e)),
        uint8_value: r.read_u8().unwrap_or_else(|e| abort("uint8_value", e)),
        int16_value: r.read_i16().unwrap_or_else(|e| abort("int16_value", e)),
        uint16_value: r.read_u16().unwrap_or_else(|e| abort("uint16_value", e)),
        int32_value: r.read_i32().unwrap_or_else(|e| abort("int32_value", e)),
        uint32_value: r.read_u32().unwrap_or_else(|e| abort("uint32_value", e)),
        int64_value: r.read_i64().unwrap_or_else(|e| abort("int64_value", e)),
        uint64_value: r.read_u64().unwrap_or_else(|e| abort("uint64_value", e)),
        string_value: r.read_string(None).unwrap_or_else(|e| abort("string_value", e)),
        wstring_value: r.read_wstring(None).unwrap_or_else(|e| abort("wstring_value", e)),
    }
}

pub fn encode_primitive_scalars(w: &mut CdrWriter, v: &PrimitiveScalars, _n: CdrNesting) {
    w.write_bool(v.bool_value).unwrap_or_else(|e| abort("enc bool", e));
    w.write_u8(v.byte_value).unwrap_or_else(|e| abort("enc byte", e));
    w.write_u8(v.char_value).unwrap_or_else(|e| abort("enc char", e));
    w.write_f32(v.float32_value).unwrap_or_else(|e| abort("enc f32", e));
    w.write_f64(v.float64_value).unwrap_or_else(|e| abort("enc f64", e));
    w.write_i8(v.int8_value).unwrap_or_else(|e| abort("enc i8", e));
    w.write_u8(v.uint8_value).unwrap_or_else(|e| abort("enc u8", e));
    w.write_i16(v.int16_value).unwrap_or_else(|e| abort("enc i16", e));
    w.write_u16(v.uint16_value).unwrap_or_else(|e| abort("enc u16", e));
    w.write_i32(v.int32_value).unwrap_or_else(|e| abort("enc i32", e));
    w.write_u32(v.uint32_value).unwrap_or_else(|e| abort("enc u32", e));
    w.write_i64(v.int64_value).unwrap_or_else(|e| abort("enc i64", e));
    w.write_u64(v.uint64_value).unwrap_or_else(|e| abort("enc u64", e));
    w.write_string(&v.string_value, None).unwrap_or_else(|e| abort("enc string", e));
    w.write_wstring(&v.wstring_value, None).unwrap_or_else(|e| abort("enc wstring", e));
}

pub fn decode_collections(r: &mut CdrReader<'_>, _n: CdrNesting) -> Collections {
    let mut fixed_i32 = [0i32; 3];
    for slot in &mut fixed_i32 {
        *slot = r.read_i32().unwrap_or_else(|e| abort("fixed_i32", e));
    }
    let f64_count =
        r.read_sequence_length(Some(4)).unwrap_or_else(|e| abort("bounded_f64 count", e));
    let mut bounded_f64 = Vec::with_capacity(f64_count as usize);
    for _ in 0..f64_count {
        bounded_f64.push(r.read_f64().unwrap_or_else(|e| abort("bounded_f64", e)));
    }
    let bytes_view = r.read_byte_sequence(None).unwrap_or_else(|e| abort("bytes_value", e));
    let bytes_value = bytes_view.to_vec();
    let bounded_string = r.read_string(Some(16)).unwrap_or_else(|e| abort("bounded_string", e));
    let bounded_wstring = r.read_wstring(Some(16)).unwrap_or_else(|e| abort("bounded_wstring", e));
    Collections { fixed_i32, bounded_f64, bytes_value, bounded_string, bounded_wstring }
}

pub fn encode_collections(w: &mut CdrWriter, v: &Collections, _n: CdrNesting) {
    for x in v.fixed_i32 {
        w.write_i32(x).unwrap_or_else(|e| abort("enc fixed_i32", e));
    }
    w.write_sequence_length(v.bounded_f64.len() as u32, Some(4))
        .unwrap_or_else(|e| abort("enc bounded_f64 count", e));
    for x in &v.bounded_f64 {
        w.write_f64(*x).unwrap_or_else(|e| abort("enc bounded_f64", e));
    }
    w.write_byte_sequence(&v.bytes_value, None).unwrap_or_else(|e| abort("enc bytes", e));
    w.write_string(&v.bounded_string, Some(16)).unwrap_or_else(|e| abort("enc bounded_string", e));
    w.write_wstring(&v.bounded_wstring, Some(16))
        .unwrap_or_else(|e| abort("enc bounded_wstring", e));
}

pub fn decode_nested_sample(r: &mut CdrReader<'_>, current: CdrNesting) -> NestedSample {
    let time_n = r.enter_nested(current).unwrap_or_else(|e| abort("NestedSample.Time", e));
    let stamp = decode_time(r, time_n);
    let scalars_n =
        r.enter_nested(current).unwrap_or_else(|e| abort("NestedSample.PrimitiveScalars", e));
    let scalars = decode_primitive_scalars(r, scalars_n);
    let coll_n = r.enter_nested(current).unwrap_or_else(|e| abort("NestedSample.Collections", e));
    let collections = decode_collections(r, coll_n);
    NestedSample { stamp, scalars, collections }
}

pub fn encode_nested_sample(w: &mut CdrWriter, v: &NestedSample, current: CdrNesting) {
    let time_n = w.enter_nested(current).unwrap_or_else(|e| abort("enc NestedSample.Time", e));
    encode_time(w, &v.stamp, time_n);
    let scalars_n =
        w.enter_nested(current).unwrap_or_else(|e| abort("enc NestedSample.PrimitiveScalars", e));
    encode_primitive_scalars(w, &v.scalars, scalars_n);
    let coll_n =
        w.enter_nested(current).unwrap_or_else(|e| abort("enc NestedSample.Collections", e));
    encode_collections(w, &v.collections, coll_n);
}

fn decode_point_field(r: &mut CdrReader<'_>) -> PointField {
    PointField {
        name: r.read_string(None).unwrap_or_else(|e| abort("PointField.name", e)),
        offset: r.read_u32().unwrap_or_else(|e| abort("PointField.offset", e)),
        datatype: r.read_u8().unwrap_or_else(|e| abort("PointField.datatype", e)),
        count: r.read_u32().unwrap_or_else(|e| abort("PointField.count", e)),
    }
}

fn encode_point_field(w: &mut CdrWriter, v: &PointField) {
    w.write_string(&v.name, None).unwrap_or_else(|e| abort("enc PointField.name", e));
    w.write_u32(v.offset).unwrap_or_else(|e| abort("enc PointField.offset", e));
    w.write_u8(v.datatype).unwrap_or_else(|e| abort("enc PointField.datatype", e));
    w.write_u32(v.count).unwrap_or_else(|e| abort("enc PointField.count", e));
}

fn decode_header(r: &mut CdrReader<'_>, parent: CdrNesting) -> Header {
    let current = r.enter_nested(parent).unwrap_or_else(|e| abort("Header", e));
    let time_n = r.enter_nested(current).unwrap_or_else(|e| abort("Header.Time", e));
    let stamp = decode_time(r, time_n);
    let frame_id = r.read_string(None).unwrap_or_else(|e| abort("frame_id", e));
    Header { stamp, frame_id }
}

fn encode_header(w: &mut CdrWriter, v: &Header, parent: CdrNesting) {
    let current = w.enter_nested(parent).unwrap_or_else(|e| abort("enc Header", e));
    let time_n = w.enter_nested(current).unwrap_or_else(|e| abort("enc Header.Time", e));
    encode_time(w, &v.stamp, time_n);
    w.write_string(&v.frame_id, None).unwrap_or_else(|e| abort("enc frame_id", e));
}

pub fn decode_point_cloud2<'a>(r: &mut CdrReader<'a>, parent: CdrNesting) -> PointCloud2<'a> {
    let header = decode_header(r, parent);
    let height = r.read_u32().unwrap_or_else(|e| abort("height", e));
    let width = r.read_u32().unwrap_or_else(|e| abort("width", e));
    let field_count = r.read_sequence_length(None).unwrap_or_else(|e| abort("fields count", e));
    let mut fields = Vec::with_capacity(field_count as usize);
    for _ in 0..field_count {
        let _fnest = r.enter_nested(parent).unwrap_or_else(|e| abort("PointField", e));
        fields.push(decode_point_field(r));
    }
    let is_bigendian = r.read_bool().unwrap_or_else(|e| abort("is_bigendian", e));
    let point_step = r.read_u32().unwrap_or_else(|e| abort("point_step", e));
    let row_step = r.read_u32().unwrap_or_else(|e| abort("row_step", e));
    let data = r.read_byte_sequence(None).unwrap_or_else(|e| abort("data", e));
    let is_dense = r.read_bool().unwrap_or_else(|e| abort("is_dense", e));
    PointCloud2 {
        header,
        height,
        width,
        fields,
        is_bigendian,
        point_step,
        row_step,
        data,
        is_dense,
    }
}

pub fn encode_point_cloud2(w: &mut CdrWriter, v: &PointCloud2<'_>, parent: CdrNesting) {
    encode_header(w, &v.header, parent);
    w.write_u32(v.height).unwrap_or_else(|e| abort("enc height", e));
    w.write_u32(v.width).unwrap_or_else(|e| abort("enc width", e));
    w.write_sequence_length(v.fields.len() as u32, None)
        .unwrap_or_else(|e| abort("enc fields count", e));
    for f in &v.fields {
        let _fnest = w.enter_nested(parent).unwrap_or_else(|e| abort("enc PointField", e));
        encode_point_field(w, f);
    }
    w.write_bool(v.is_bigendian).unwrap_or_else(|e| abort("enc is_bigendian", e));
    w.write_u32(v.point_step).unwrap_or_else(|e| abort("enc point_step", e));
    w.write_u32(v.row_step).unwrap_or_else(|e| abort("enc row_step", e));
    w.write_byte_sequence(v.data, None).unwrap_or_else(|e| abort("enc data", e));
    w.write_bool(v.is_dense).unwrap_or_else(|e| abort("enc is_dense", e));
}

pub fn decode_case<'a>(r: &mut CdrReader<'a>, case_id: &str) -> CorpusValue<'a> {
    let root = r.root_nesting();
    match case_id {
        "primitive_scalars" | "primitive_scalars_big_endian" => {
            CorpusValue::PrimitiveScalars(decode_primitive_scalars(r, root))
        }
        "collections" => CorpusValue::Collections(decode_collections(r, root)),
        "nested_sample" => CorpusValue::NestedSample(decode_nested_sample(r, root)),
        "echo_nested_request" => {
            let input_n =
                r.enter_nested(root).unwrap_or_else(|e| abort("EchoNestedRequest.input", e));
            CorpusValue::EchoNestedRequest { input: decode_nested_sample(r, input_n) }
        }
        "echo_nested_response" => {
            let output_n =
                r.enter_nested(root).unwrap_or_else(|e| abort("EchoNestedResponse.output", e));
            let output = decode_nested_sample(r, output_n);
            let accepted = r.read_bool().unwrap_or_else(|e| abort("accepted", e));
            CorpusValue::EchoNestedResponse { output, accepted }
        }
        "measure_sequence_goal" => {
            let target_n =
                r.enter_nested(root).unwrap_or_else(|e| abort("MeasureSequenceGoal.target", e));
            CorpusValue::MeasureSequenceGoal { target: decode_collections(r, target_n) }
        }
        "measure_sequence_result" => {
            let result_n =
                r.enter_nested(root).unwrap_or_else(|e| abort("MeasureSequenceResult.result", e));
            CorpusValue::MeasureSequenceResult { result: decode_nested_sample(r, result_n) }
        }
        "measure_sequence_feedback" => {
            let progress = r.read_f32().unwrap_or_else(|e| abort("progress", e));
            let sample_n =
                r.enter_nested(root).unwrap_or_else(|e| abort("MeasureSequenceFeedback.sample", e));
            CorpusValue::MeasureSequenceFeedback {
                progress,
                sample: decode_nested_sample(r, sample_n),
            }
        }
        "point_cloud2" => CorpusValue::PointCloud2(decode_point_cloud2(r, root)),
        other => panic!("unknown case_id {other}"),
    }
}

pub fn encode_case(w: &mut CdrWriter, value: &CorpusValue<'_>) {
    let root = w.root_nesting();
    match value {
        CorpusValue::PrimitiveScalars(v) => encode_primitive_scalars(w, v, root),
        CorpusValue::Collections(v) => encode_collections(w, v, root),
        CorpusValue::NestedSample(v) => encode_nested_sample(w, v, root),
        CorpusValue::EchoNestedRequest { input } => {
            let n = w.enter_nested(root).unwrap_or_else(|e| abort("enc request.input", e));
            encode_nested_sample(w, input, n);
        }
        CorpusValue::EchoNestedResponse { output, accepted } => {
            let n = w.enter_nested(root).unwrap_or_else(|e| abort("enc response.output", e));
            encode_nested_sample(w, output, n);
            w.write_bool(*accepted).unwrap_or_else(|e| abort("enc accepted", e));
        }
        CorpusValue::MeasureSequenceGoal { target } => {
            let n = w.enter_nested(root).unwrap_or_else(|e| abort("enc goal.target", e));
            encode_collections(w, target, n);
        }
        CorpusValue::MeasureSequenceResult { result } => {
            let n = w.enter_nested(root).unwrap_or_else(|e| abort("enc result.result", e));
            encode_nested_sample(w, result, n);
        }
        CorpusValue::MeasureSequenceFeedback { progress, sample } => {
            w.write_f32(*progress).unwrap_or_else(|e| abort("enc progress", e));
            let n = w.enter_nested(root).unwrap_or_else(|e| abort("enc feedback.sample", e));
            encode_nested_sample(w, sample, n);
        }
        CorpusValue::PointCloud2(v) => encode_point_cloud2(w, v, root),
    }
}

pub fn assert_primitive_vs_json(v: &PrimitiveScalars, j: &Value) {
    assert_eq!(v.bool_value, j["bool_value"].as_bool().unwrap());
    assert_eq!(v.byte_value as u64, j["byte_value"].as_u64().unwrap());
    assert_eq!(v.char_value as u64, j["char_value"].as_u64().unwrap());
    assert_f32_bits(v.float32_value, json_f64(&j["float32_value"]) as f32);
    assert_f64_bits(v.float64_value, json_f64(&j["float64_value"]));
    assert_eq!(v.int8_value as i64, json_i64(&j["int8_value"]));
    assert_eq!(v.uint8_value as u64, j["uint8_value"].as_u64().unwrap());
    assert_eq!(v.int16_value as i64, json_i64(&j["int16_value"]));
    assert_eq!(v.uint16_value as u64, j["uint16_value"].as_u64().unwrap());
    assert_eq!(v.int32_value as i64, json_i64(&j["int32_value"]));
    assert_eq!(v.uint32_value as u64, j["uint32_value"].as_u64().unwrap());
    assert_eq!(v.int64_value, json_i64(&j["int64_value"]));
    assert_eq!(v.uint64_value, json_u64(&j["uint64_value"]));
    assert_eq!(v.string_value, j["string_value"].as_str().unwrap());
    assert_eq!(v.wstring_value, j["wstring_value"].as_str().unwrap());
}

pub fn assert_collections_vs_json(v: &Collections, j: &Value) {
    let fixed = j["fixed_i32"].as_array().unwrap();
    for (i, slot) in v.fixed_i32.iter().enumerate() {
        assert_eq!(*slot as i64, json_i64(&fixed[i]));
    }
    let bf = j["bounded_f64"].as_array().unwrap();
    assert_eq!(v.bounded_f64.len(), bf.len());
    for (got, exp) in v.bounded_f64.iter().zip(bf) {
        assert_f64_bits(*got, json_f64(exp));
    }
    let bytes = j["bytes_value"].as_array().unwrap();
    assert_eq!(v.bytes_value.len(), bytes.len());
    for (got, exp) in v.bytes_value.iter().zip(bytes) {
        assert_eq!(u64::from(*got), exp.as_u64().unwrap());
    }
    assert_eq!(v.bounded_string, j["bounded_string"].as_str().unwrap());
    assert_eq!(v.bounded_wstring, j["bounded_wstring"].as_str().unwrap());
}

pub fn assert_nested_vs_json(v: &NestedSample, j: &Value) {
    assert_eq!(v.stamp.sec as i64, json_i64(&j["stamp"]["sec"]));
    assert_eq!(u64::from(v.stamp.nanosec), j["stamp"]["nanosec"].as_u64().unwrap());
    assert_primitive_vs_json(&v.scalars, &j["scalars"]);
    assert_collections_vs_json(&v.collections, &j["collections"]);
}

fn read_f32_le(data: &[u8], off: usize) -> f32 {
    f32::from_le_bytes(data[off..off + 4].try_into().unwrap())
}

fn read_u16_le(data: &[u8], off: usize) -> u16 {
    u16::from_le_bytes(data[off..off + 2].try_into().unwrap())
}

pub fn assert_point_cloud2_vs_json(v: &PointCloud2<'_>, j: &Value) {
    assert_eq!(v.header.stamp.sec as i64, json_i64(&j["header"]["stamp"]["sec"]));
    assert_eq!(
        u64::from(v.header.stamp.nanosec),
        j["header"]["stamp"]["nanosec"].as_u64().unwrap()
    );
    assert_eq!(v.header.frame_id, j["header"]["frame_id"].as_str().unwrap());
    assert_eq!(u64::from(v.height), j["height"].as_u64().unwrap());
    assert_eq!(u64::from(v.width), j["width"].as_u64().unwrap());
    assert_eq!(v.is_bigendian, j["is_bigendian"].as_bool().unwrap());
    assert_eq!(u64::from(v.point_step), j["point_step"].as_u64().unwrap());
    assert_eq!(u64::from(v.row_step), j["row_step"].as_u64().unwrap());
    assert_eq!(v.is_dense, j["is_dense"].as_bool().unwrap());
    let fields = j["fields"].as_array().unwrap();
    assert_eq!(v.fields.len(), fields.len());
    for (got, exp) in v.fields.iter().zip(fields) {
        assert_eq!(got.name, exp["name"].as_str().unwrap());
        assert_eq!(u64::from(got.offset), exp["offset"].as_u64().unwrap());
        assert_eq!(u64::from(got.datatype), exp["datatype"].as_u64().unwrap());
        assert_eq!(u64::from(got.count), exp["count"].as_u64().unwrap());
    }
    let points = j["points"].as_array().unwrap();
    let count = (v.height as usize) * (v.width as usize);
    assert_eq!(points.len(), count);
    assert_eq!(v.data.len(), count * v.point_step as usize);
    for (i, p) in points.iter().enumerate() {
        let base = i * v.point_step as usize;
        assert_f32_bits(read_f32_le(v.data, base), json_f64(&p["x"]) as f32);
        assert_f32_bits(read_f32_le(v.data, base + 4), json_f64(&p["y"]) as f32);
        assert_f32_bits(read_f32_le(v.data, base + 8), json_f64(&p["z"]) as f32);
        assert_eq!(u64::from(read_u16_le(v.data, base + 12)), p["intensity"].as_u64().unwrap());
        assert_eq!(u64::from(read_u16_le(v.data, base + 14)), p["ring"].as_u64().unwrap());
    }
}

pub fn assert_value_vs_json(value: &CorpusValue<'_>, case_id: &str, j: &Value) {
    match (case_id, value) {
        (
            "primitive_scalars" | "primitive_scalars_big_endian",
            CorpusValue::PrimitiveScalars(v),
        ) => {
            assert_primitive_vs_json(v, j);
        }
        ("collections", CorpusValue::Collections(v)) => assert_collections_vs_json(v, j),
        ("nested_sample", CorpusValue::NestedSample(v)) => assert_nested_vs_json(v, j),
        ("echo_nested_request", CorpusValue::EchoNestedRequest { input }) => {
            assert_nested_vs_json(input, &j["input"]);
        }
        ("echo_nested_response", CorpusValue::EchoNestedResponse { output, accepted }) => {
            assert_nested_vs_json(output, &j["output"]);
            assert_eq!(*accepted, j["accepted"].as_bool().unwrap());
        }
        ("measure_sequence_goal", CorpusValue::MeasureSequenceGoal { target }) => {
            assert_collections_vs_json(target, &j["target"]);
        }
        ("measure_sequence_result", CorpusValue::MeasureSequenceResult { result }) => {
            assert_nested_vs_json(result, &j["result"]);
        }
        (
            "measure_sequence_feedback",
            CorpusValue::MeasureSequenceFeedback { progress, sample },
        ) => {
            assert_f32_bits(*progress, json_f64(&j["progress"]) as f32);
            assert_nested_vs_json(sample, &j["sample"]);
        }
        ("point_cloud2", CorpusValue::PointCloud2(v)) => assert_point_cloud2_vs_json(v, j),
        (c, _) => panic!("case/value mismatch for {c}"),
    }
}

/// Semantic equality ignoring PointCloud2 borrowed data pointer identity.
pub fn semantic_eq(a: &CorpusValue<'_>, b: &CorpusValue<'_>) -> bool {
    match (a, b) {
        (CorpusValue::PrimitiveScalars(x), CorpusValue::PrimitiveScalars(y)) => {
            x.bool_value == y.bool_value
                && x.byte_value == y.byte_value
                && x.char_value == y.char_value
                && x.float32_value.to_bits() == y.float32_value.to_bits()
                && x.float64_value.to_bits() == y.float64_value.to_bits()
                && x.int8_value == y.int8_value
                && x.uint8_value == y.uint8_value
                && x.int16_value == y.int16_value
                && x.uint16_value == y.uint16_value
                && x.int32_value == y.int32_value
                && x.uint32_value == y.uint32_value
                && x.int64_value == y.int64_value
                && x.uint64_value == y.uint64_value
                && x.string_value == y.string_value
                && x.wstring_value == y.wstring_value
        }
        (CorpusValue::Collections(x), CorpusValue::Collections(y)) => {
            x.fixed_i32 == y.fixed_i32
                && x.bounded_f64.len() == y.bounded_f64.len()
                && x.bounded_f64.iter().zip(&y.bounded_f64).all(|(a, b)| a.to_bits() == b.to_bits())
                && x.bytes_value == y.bytes_value
                && x.bounded_string == y.bounded_string
                && x.bounded_wstring == y.bounded_wstring
        }
        (CorpusValue::NestedSample(x), CorpusValue::NestedSample(y)) => {
            semantic_eq(
                &CorpusValue::PrimitiveScalars(x.scalars.clone()),
                &CorpusValue::PrimitiveScalars(y.scalars.clone()),
            ) && semantic_eq(
                &CorpusValue::Collections(x.collections.clone()),
                &CorpusValue::Collections(y.collections.clone()),
            ) && x.stamp == y.stamp
        }
        (
            CorpusValue::EchoNestedRequest { input: x },
            CorpusValue::EchoNestedRequest { input: y },
        ) => semantic_eq(
            &CorpusValue::NestedSample(x.clone()),
            &CorpusValue::NestedSample(y.clone()),
        ),
        (
            CorpusValue::EchoNestedResponse { output: xo, accepted: xa },
            CorpusValue::EchoNestedResponse { output: yo, accepted: ya },
        ) => {
            xa == ya
                && semantic_eq(
                    &CorpusValue::NestedSample(xo.clone()),
                    &CorpusValue::NestedSample(yo.clone()),
                )
        }
        (
            CorpusValue::MeasureSequenceGoal { target: x },
            CorpusValue::MeasureSequenceGoal { target: y },
        ) => {
            semantic_eq(&CorpusValue::Collections(x.clone()), &CorpusValue::Collections(y.clone()))
        }
        (
            CorpusValue::MeasureSequenceResult { result: x },
            CorpusValue::MeasureSequenceResult { result: y },
        ) => semantic_eq(
            &CorpusValue::NestedSample(x.clone()),
            &CorpusValue::NestedSample(y.clone()),
        ),
        (
            CorpusValue::MeasureSequenceFeedback { progress: xp, sample: xs },
            CorpusValue::MeasureSequenceFeedback { progress: yp, sample: ys },
        ) => {
            xp.to_bits() == yp.to_bits()
                && semantic_eq(
                    &CorpusValue::NestedSample(xs.clone()),
                    &CorpusValue::NestedSample(ys.clone()),
                )
        }
        (CorpusValue::PointCloud2(x), CorpusValue::PointCloud2(y)) => {
            x.header == y.header
                && x.height == y.height
                && x.width == y.width
                && x.fields == y.fields
                && x.is_bigendian == y.is_bigendian
                && x.point_step == y.point_step
                && x.row_step == y.row_step
                && x.data == y.data
                && x.is_dense == y.is_dense
        }
        _ => false,
    }
}

pub fn endian_of(name: &str) -> CdrEndian {
    match name {
        "little" => CdrEndian::Little,
        "big" => CdrEndian::Big,
        other => panic!("bad endian {other}"),
    }
}

pub fn open_default(bytes: &[u8]) -> CdrReader<'_> {
    CdrReader::open_default(bytes).unwrap_or_else(|e| abort("open_default", e))
}

pub fn open_with(bytes: &[u8], limits: CdrLimits) -> Result<CdrReader<'_>, CdrError> {
    CdrReader::open(bytes, limits)
}

pub fn writer_default(endian: CdrEndian) -> CdrWriter {
    CdrWriter::new_default(endian).unwrap_or_else(|e| abort("writer", e))
}
