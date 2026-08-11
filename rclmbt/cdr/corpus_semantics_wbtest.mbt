///|
/// Authoritative ROS CDR corpus semantic proof (M1-01d2).
/// Package-internal hand-written white-box codecs for the nine root schema
/// surfaces in the committed corpus. Uses the d1 bridge fixtures and the
/// existing CdrReader/CdrWriter surface only — no public generated types.

// ---------------------------------------------------------------------------
// Value models (test-only)
// ---------------------------------------------------------------------------

///|
priv struct CorpusTime {
  sec : Int
  nanosec : UInt
}

///|
priv struct CorpusPrimitiveScalars {
  bool_value : Bool
  byte_value : Byte
  char_value : Byte
  float32_value : Float
  float64_value : Double
  int8_value : Int
  uint8_value : Byte
  int16_value : Int
  uint16_value : UInt16
  int32_value : Int
  uint32_value : UInt
  int64_value : Int64
  uint64_value : UInt64
  string_value : String
  wstring_value : String
}

///|
priv struct CorpusCollections {
  fixed_i32 : Array[Int]
  bounded_f64 : Array[Double]
  bytes_value : Array[Byte]
  bounded_string : String
  bounded_wstring : String
}

///|
priv struct CorpusNestedSample {
  stamp : CorpusTime
  scalars : CorpusPrimitiveScalars
  collections : CorpusCollections
}

///|
priv struct CorpusEchoNestedRequest {
  input : CorpusNestedSample
}

///|
priv struct CorpusEchoNestedResponse {
  output : CorpusNestedSample
  accepted : Bool
}

///|
priv struct CorpusMeasureSequenceGoal {
  target : CorpusCollections
}

///|
priv struct CorpusMeasureSequenceResult {
  result : CorpusNestedSample
}

///|
priv struct CorpusMeasureSequenceFeedback {
  progress : Float
  sample : CorpusNestedSample
}

///|
priv struct CorpusPointField {
  name : String
  offset : UInt
  datatype : Byte
  count : UInt
}

///|
priv struct CorpusHeader {
  stamp : CorpusTime
  frame_id : String
}

///|
priv struct CorpusPointRecord {
  x : Float
  y : Float
  z : Float
  intensity : UInt16
  ring : UInt16
}

///|
priv struct CorpusPointCloud2 {
  header : CorpusHeader
  height : UInt
  width : UInt
  fields : Array[CorpusPointField]
  is_bigendian : Bool
  point_step : UInt
  row_step : UInt
  data : BytesView
  is_dense : Bool
}

// ---------------------------------------------------------------------------
// Abort helpers
// ---------------------------------------------------------------------------

///|
fn cs_abort(ctx : String, e : CdrError) -> Unit {
  abort(ctx + ": " + e.code)
}

///|
fn cs_bytes_of(arr : Array[Byte]) -> Bytes {
  Bytes::from_array(arr[:])
}

///|
fn cs_open(bytes : BytesView) -> CdrReader {
  match CdrReader::open_default(bytes) {
    Ok(r) => r
    Err(e) => abort("open_default: " + e.code)
  }
}

///|
fn cs_writer(endian : CdrEndian) -> CdrWriter {
  match CdrWriter::new_default(endian) {
    Ok(w) => w
    Err(e) => abort("writer: " + e.code)
  }
}

///|
fn cs_endian_of(name : String) -> CdrEndian {
  if name == "little" {
    CdrEndian::Little
  } else if name == "big" {
    CdrEndian::Big
  } else {
    abort("bad endian " + name)
  }
}

// ---------------------------------------------------------------------------
// Expected corpus values (logical sample from committed manifest)
// ---------------------------------------------------------------------------

///|
fn expected_primitive_scalars() -> CorpusPrimitiveScalars {
  {
    bool_value: true,
    byte_value: b'\xa5',
    char_value: b'Z',
    float32_value: Float::from_double(-12.5),
    float64_value: 12345.125,
    int8_value: -120,
    uint8_value: b'\xfa',
    int16_value: -32000,
    uint16_value: 65000U.to_uint16(),
    int32_value: -2000000000,
    uint32_value: 4000000000U,
    int64_value: -9000000000000000000L,
    uint64_value: 18000000000000000000UL,
    string_value: "Moonspan CDR ✓",
    wstring_value: "月面CDR",
  }
}

///|
fn expected_collections() -> CorpusCollections {
  {
    fixed_i32: [-2147483648, 0, 2147483647],
    bounded_f64: [-1.25, 0.0, 3.5, 1024.125],
    bytes_value: [b'\x00', b'\x01', b'\x7f', b'\x80', b'\xff'],
    bounded_string: "0123456789abcdef",
    bounded_wstring: "0123456789abcdef",
  }
}

///|
fn expected_nested_sample() -> CorpusNestedSample {
  {
    stamp: { sec: 1700000000, nanosec: 123456789U },
    scalars: expected_primitive_scalars(),
    collections: expected_collections(),
  }
}

///|
fn expected_point_fields() -> Array[CorpusPointField] {
  [
    { name: "x", offset: 0U, datatype: b'\x07', count: 1U },
    { name: "y", offset: 4U, datatype: b'\x07', count: 1U },
    { name: "z", offset: 8U, datatype: b'\x07', count: 1U },
    { name: "intensity", offset: 12U, datatype: b'\x04', count: 1U },
    { name: "ring", offset: 14U, datatype: b'\x04', count: 1U },
  ]
}

///|
fn expected_point_records() -> Array[CorpusPointRecord] {
  [
    {
      x: Float::from_double(1.0),
      y: Float::from_double(2.0),
      z: Float::from_double(3.0),
      intensity: 10U.to_uint16(),
      ring: 0U.to_uint16(),
    },
    {
      x: -Float::from_double(1.0),
      y: -Float::from_double(2.0),
      z: -Float::from_double(3.0),
      intensity: 20U.to_uint16(),
      ring: 1U.to_uint16(),
    },
    {
      x: Float::from_double(0.5),
      y: Float::from_double(0.25),
      z: Float::from_double(0.125),
      intensity: 30U.to_uint16(),
      ring: 2U.to_uint16(),
    },
    {
      x: Float::from_double(10.0),
      y: Float::from_double(20.0),
      z: Float::from_double(30.0),
      intensity: 40U.to_uint16(),
      ring: 3U.to_uint16(),
    },
    {
      x: -Float::from_double(10.0),
      y: Float::from_double(4.0),
      z: Float::from_double(8.0),
      intensity: 50U.to_uint16(),
      ring: 4U.to_uint16(),
    },
    {
      x: Float::from_double(1024.0),
      y: -Float::from_double(1024.0),
      z: Float::from_double(64.0),
      intensity: 60U.to_uint16(),
      ring: 5U.to_uint16(),
    },
  ]
}

///|
/// Committed PointCloud2 opaque payload (96 bytes, little-endian field values).
fn expected_point_cloud2_data_bytes() -> Array[Byte] {
  let hex = "0000803f00000040000040400a000000000080bf000000c0000040c0140001000000003f0000803e0000003e1e000200000020410000a0410000f04128000300000020c100008040000000413200040000008044000080c4000080423c000500"
  cdr_fx_decode_hex(hex)
}

// ---------------------------------------------------------------------------
// Equality
// ---------------------------------------------------------------------------

///|
fn eq_time(a : CorpusTime, b : CorpusTime) -> Bool {
  a.sec == b.sec && a.nanosec == b.nanosec
}

///|
fn eq_primitive(a : CorpusPrimitiveScalars, b : CorpusPrimitiveScalars) -> Bool {
  a.bool_value == b.bool_value &&
  a.byte_value == b.byte_value &&
  a.char_value == b.char_value &&
  a.float32_value == b.float32_value &&
  a.float64_value == b.float64_value &&
  a.int8_value == b.int8_value &&
  a.uint8_value == b.uint8_value &&
  a.int16_value == b.int16_value &&
  a.uint16_value == b.uint16_value &&
  a.int32_value == b.int32_value &&
  a.uint32_value == b.uint32_value &&
  a.int64_value == b.int64_value &&
  a.uint64_value == b.uint64_value &&
  a.string_value == b.string_value &&
  a.wstring_value == b.wstring_value
}

///|
fn eq_int_array(a : Array[Int], b : Array[Int]) -> Bool {
  if a.length() != b.length() {
    return false
  }
  let mut i = 0
  while i < a.length() {
    if a[i] != b[i] {
      return false
    }
    i = i + 1
  }
  true
}

///|
fn eq_double_array(a : Array[Double], b : Array[Double]) -> Bool {
  if a.length() != b.length() {
    return false
  }
  let mut i = 0
  while i < a.length() {
    if a[i] != b[i] {
      return false
    }
    i = i + 1
  }
  true
}

///|
fn eq_byte_array(a : Array[Byte], b : Array[Byte]) -> Bool {
  if a.length() != b.length() {
    return false
  }
  let mut i = 0
  while i < a.length() {
    if a[i] != b[i] {
      return false
    }
    i = i + 1
  }
  true
}

///|
fn eq_collections(a : CorpusCollections, b : CorpusCollections) -> Bool {
  eq_int_array(a.fixed_i32, b.fixed_i32) &&
  eq_double_array(a.bounded_f64, b.bounded_f64) &&
  eq_byte_array(a.bytes_value, b.bytes_value) &&
  a.bounded_string == b.bounded_string &&
  a.bounded_wstring == b.bounded_wstring
}

///|
fn eq_nested(a : CorpusNestedSample, b : CorpusNestedSample) -> Bool {
  eq_time(a.stamp, b.stamp) &&
  eq_primitive(a.scalars, b.scalars) &&
  eq_collections(a.collections, b.collections)
}

///|
fn eq_bytes_view_array(bv : BytesView, arr : Array[Byte]) -> Bool {
  if bv.length() != arr.length() {
    return false
  }
  let mut i = 0
  while i < arr.length() {
    if bv[i] != arr[i] {
      return false
    }
    i = i + 1
  }
  true
}

///|
fn eq_point_field(a : CorpusPointField, b : CorpusPointField) -> Bool {
  a.name == b.name &&
  a.offset == b.offset &&
  a.datatype == b.datatype &&
  a.count == b.count
}

///|
fn eq_point_cloud2_meta(
  a : CorpusPointCloud2,
  b_header : CorpusHeader,
  height : UInt,
  width : UInt,
  fields : Array[CorpusPointField],
  is_bigendian : Bool,
  point_step : UInt,
  row_step : UInt,
  data : Array[Byte],
  is_dense : Bool,
) -> Bool {
  if !(eq_time(a.header.stamp, b_header.stamp) &&
    a.header.frame_id == b_header.frame_id &&
    a.height == height &&
    a.width == width &&
    a.is_bigendian == is_bigendian &&
    a.point_step == point_step &&
    a.row_step == row_step &&
    a.is_dense == is_dense) {
    return false
  }
  if a.fields.length() != fields.length() {
    return false
  }
  let mut i = 0
  while i < fields.length() {
    if !eq_point_field(a.fields[i], fields[i]) {
      return false
    }
    i = i + 1
  }
  eq_bytes_view_array(a.data, data)
}

// ---------------------------------------------------------------------------
// Decode codecs (declared ROS field order)
// ---------------------------------------------------------------------------

///|
fn decode_time(r : CdrReader, nest : CdrNesting) -> CorpusTime {
  ignore(nest)
  let sec = match r.read_i32() {
    Ok(v) => v
    Err(e) => {
      cs_abort("Time.sec", e)
      0
    }
  }
  let nanosec = match r.read_u32() {
    Ok(v) => v
    Err(e) => {
      cs_abort("Time.nanosec", e)
      0U
    }
  }
  { sec, nanosec }
}

///|
fn decode_primitive_scalars(
  r : CdrReader,
  nest : CdrNesting,
) -> CorpusPrimitiveScalars {
  ignore(nest)
  let bool_value = match r.read_bool() {
    Ok(v) => v
    Err(e) => {
      cs_abort("bool_value", e)
      false
    }
  }
  let byte_value = match r.read_u8() {
    Ok(v) => v
    Err(e) => {
      cs_abort("byte_value", e)
      b'\x00'
    }
  }
  let char_value = match r.read_char8() {
    Ok(v) => v
    Err(e) => {
      cs_abort("char_value", e)
      b'\x00'
    }
  }
  let float32_value = match r.read_f32() {
    Ok(v) => v
    Err(e) => {
      cs_abort("float32_value", e)
      Float::from_double(0.0)
    }
  }
  let float64_value = match r.read_f64() {
    Ok(v) => v
    Err(e) => {
      cs_abort("float64_value", e)
      0.0
    }
  }
  let int8_value = match r.read_i8() {
    Ok(v) => v
    Err(e) => {
      cs_abort("int8_value", e)
      0
    }
  }
  let uint8_value = match r.read_u8() {
    Ok(v) => v
    Err(e) => {
      cs_abort("uint8_value", e)
      b'\x00'
    }
  }
  let int16_value = match r.read_i16() {
    Ok(v) => v
    Err(e) => {
      cs_abort("int16_value", e)
      0
    }
  }
  let uint16_value = match r.read_u16() {
    Ok(v) => v
    Err(e) => {
      cs_abort("uint16_value", e)
      0U.to_uint16()
    }
  }
  let int32_value = match r.read_i32() {
    Ok(v) => v
    Err(e) => {
      cs_abort("int32_value", e)
      0
    }
  }
  let uint32_value = match r.read_u32() {
    Ok(v) => v
    Err(e) => {
      cs_abort("uint32_value", e)
      0U
    }
  }
  let int64_value = match r.read_i64() {
    Ok(v) => v
    Err(e) => {
      cs_abort("int64_value", e)
      0L
    }
  }
  let uint64_value = match r.read_u64() {
    Ok(v) => v
    Err(e) => {
      cs_abort("uint64_value", e)
      0UL
    }
  }
  let string_value = match r.read_string() {
    Ok(v) => v
    Err(e) => {
      cs_abort("string_value", e)
      ""
    }
  }
  let wstring_value = match r.read_wstring() {
    Ok(v) => v
    Err(e) => {
      cs_abort("wstring_value", e)
      ""
    }
  }
  {
    bool_value,
    byte_value,
    char_value,
    float32_value,
    float64_value,
    int8_value,
    uint8_value,
    int16_value,
    uint16_value,
    int32_value,
    uint32_value,
    int64_value,
    uint64_value,
    string_value,
    wstring_value,
  }
}

///|
fn decode_collections(r : CdrReader, nest : CdrNesting) -> CorpusCollections {
  ignore(nest)
  // fixed_i32[3]
  let fixed_i32 : Array[Int] = []
  let mut i = 0
  while i < 3 {
    match r.read_i32() {
      Ok(v) => fixed_i32.push(v)
      Err(e) => cs_abort("fixed_i32", e)
    }
    i = i + 1
  }
  // float64[<=4]
  let f64_count = match r.read_sequence_length(max_elements=4U) {
    Ok(n) => n
    Err(e) => {
      cs_abort("bounded_f64 count", e)
      0
    }
  }
  let bounded_f64 : Array[Double] = []
  i = 0
  while i < f64_count {
    match r.read_f64() {
      Ok(v) => bounded_f64.push(v)
      Err(e) => cs_abort("bounded_f64", e)
    }
    i = i + 1
  }
  // uint8[]
  let bytes_view = match r.read_byte_sequence() {
    Ok(v) => v
    Err(e) => {
      cs_abort("bytes_value", e)
      b""[:]
    }
  }
  let bytes_value : Array[Byte] = []
  i = 0
  while i < bytes_view.length() {
    bytes_value.push(bytes_view[i])
    i = i + 1
  }
  let bounded_string = match r.read_string(max_bytes=16U) {
    Ok(v) => v
    Err(e) => {
      cs_abort("bounded_string", e)
      ""
    }
  }
  let bounded_wstring = match r.read_wstring(max_scalars=16U) {
    Ok(v) => v
    Err(e) => {
      cs_abort("bounded_wstring", e)
      ""
    }
  }
  { fixed_i32, bounded_f64, bytes_value, bounded_string, bounded_wstring }
}

///|
fn decode_nested_sample(
  r : CdrReader,
  parent : CdrNesting,
) -> CorpusNestedSample {
  let nest = match r.enter_nested(parent) {
    Ok(n) => n
    Err(e) => {
      cs_abort("NestedSample nest", e)
      parent
    }
  }
  let stamp = decode_time(r, nest)
  let scalars = decode_primitive_scalars(r, nest)
  let collections = decode_collections(r, nest)
  { stamp, scalars, collections }
}

///|
fn decode_echo_request(r : CdrReader) -> CorpusEchoNestedRequest {
  let root = r.root_nesting()
  { input: decode_nested_sample(r, root) }
}

///|
fn decode_echo_response(r : CdrReader) -> CorpusEchoNestedResponse {
  let root = r.root_nesting()
  let output = decode_nested_sample(r, root)
  let accepted = match r.read_bool() {
    Ok(v) => v
    Err(e) => {
      cs_abort("accepted", e)
      false
    }
  }
  { output, accepted }
}

///|
fn decode_goal(r : CdrReader) -> CorpusMeasureSequenceGoal {
  let root = r.root_nesting()
  let nest = match r.enter_nested(root) {
    Ok(n) => n
    Err(e) => {
      cs_abort("Goal nest", e)
      root
    }
  }
  { target: decode_collections(r, nest) }
}

///|
fn decode_result(r : CdrReader) -> CorpusMeasureSequenceResult {
  let root = r.root_nesting()
  { result: decode_nested_sample(r, root) }
}

///|
fn decode_feedback(r : CdrReader) -> CorpusMeasureSequenceFeedback {
  let root = r.root_nesting()
  let progress = match r.read_f32() {
    Ok(v) => v
    Err(e) => {
      cs_abort("progress", e)
      Float::from_double(0.0)
    }
  }
  let sample = decode_nested_sample(r, root)
  { progress, sample }
}

///|
fn decode_point_field(r : CdrReader) -> CorpusPointField {
  let name = match r.read_string() {
    Ok(v) => v
    Err(e) => {
      cs_abort("PointField.name", e)
      ""
    }
  }
  let offset = match r.read_u32() {
    Ok(v) => v
    Err(e) => {
      cs_abort("PointField.offset", e)
      0U
    }
  }
  let datatype = match r.read_u8() {
    Ok(v) => v
    Err(e) => {
      cs_abort("PointField.datatype", e)
      b'\x00'
    }
  }
  let count = match r.read_u32() {
    Ok(v) => v
    Err(e) => {
      cs_abort("PointField.count", e)
      0U
    }
  }
  { name, offset, datatype, count }
}

///|
fn decode_point_cloud2(r : CdrReader) -> CorpusPointCloud2 {
  let root = r.root_nesting()
  let header_nest = match r.enter_nested(root) {
    Ok(n) => n
    Err(e) => {
      cs_abort("Header nest", e)
      root
    }
  }
  let stamp = decode_time(r, header_nest)
  let frame_id = match r.read_string() {
    Ok(v) => v
    Err(e) => {
      cs_abort("frame_id", e)
      ""
    }
  }
  let height = match r.read_u32() {
    Ok(v) => v
    Err(e) => {
      cs_abort("height", e)
      0U
    }
  }
  let width = match r.read_u32() {
    Ok(v) => v
    Err(e) => {
      cs_abort("width", e)
      0U
    }
  }
  let field_count = match r.read_sequence_length() {
    Ok(n) => n
    Err(e) => {
      cs_abort("fields count", e)
      0
    }
  }
  let fields : Array[CorpusPointField] = []
  let mut i = 0
  while i < field_count {
    let fnest = match r.enter_nested(root) {
      Ok(n) => n
      Err(e) => {
        cs_abort("PointField nest", e)
        root
      }
    }
    ignore(fnest)
    fields.push(decode_point_field(r))
    i = i + 1
  }
  let is_bigendian = match r.read_bool() {
    Ok(v) => v
    Err(e) => {
      cs_abort("is_bigendian", e)
      false
    }
  }
  let point_step = match r.read_u32() {
    Ok(v) => v
    Err(e) => {
      cs_abort("point_step", e)
      0U
    }
  }
  let row_step = match r.read_u32() {
    Ok(v) => v
    Err(e) => {
      cs_abort("row_step", e)
      0U
    }
  }
  let data = match r.read_byte_sequence() {
    Ok(v) => v
    Err(e) => {
      cs_abort("data", e)
      b""[:]
    }
  }
  let is_dense = match r.read_bool() {
    Ok(v) => v
    Err(e) => {
      cs_abort("is_dense", e)
      false
    }
  }
  {
    header: { stamp, frame_id },
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

// ---------------------------------------------------------------------------
// Encode codecs (exact canonical form, zero top-level tail)
// ---------------------------------------------------------------------------

///|
fn encode_time(w : CdrWriter, v : CorpusTime, nest : CdrNesting) -> Unit {
  ignore(nest)
  match w.write_i32(v.sec) {
    Ok(_) => ()
    Err(e) => cs_abort("enc Time.sec", e)
  }
  match w.write_u32(v.nanosec) {
    Ok(_) => ()
    Err(e) => cs_abort("enc Time.nanosec", e)
  }
}

///|
fn encode_primitive_scalars(
  w : CdrWriter,
  v : CorpusPrimitiveScalars,
  nest : CdrNesting,
) -> Unit {
  ignore(nest)
  match w.write_bool(v.bool_value) {
    Ok(_) => ()
    Err(e) => cs_abort("enc bool", e)
  }
  match w.write_u8(v.byte_value) {
    Ok(_) => ()
    Err(e) => cs_abort("enc byte", e)
  }
  match w.write_char8(v.char_value) {
    Ok(_) => ()
    Err(e) => cs_abort("enc char", e)
  }
  match w.write_f32(v.float32_value) {
    Ok(_) => ()
    Err(e) => cs_abort("enc f32", e)
  }
  match w.write_f64(v.float64_value) {
    Ok(_) => ()
    Err(e) => cs_abort("enc f64", e)
  }
  match w.write_i8(v.int8_value) {
    Ok(_) => ()
    Err(e) => cs_abort("enc i8", e)
  }
  match w.write_u8(v.uint8_value) {
    Ok(_) => ()
    Err(e) => cs_abort("enc u8", e)
  }
  match w.write_i16(v.int16_value) {
    Ok(_) => ()
    Err(e) => cs_abort("enc i16", e)
  }
  match w.write_u16(v.uint16_value) {
    Ok(_) => ()
    Err(e) => cs_abort("enc u16", e)
  }
  match w.write_i32(v.int32_value) {
    Ok(_) => ()
    Err(e) => cs_abort("enc i32", e)
  }
  match w.write_u32(v.uint32_value) {
    Ok(_) => ()
    Err(e) => cs_abort("enc u32", e)
  }
  match w.write_i64(v.int64_value) {
    Ok(_) => ()
    Err(e) => cs_abort("enc i64", e)
  }
  match w.write_u64(v.uint64_value) {
    Ok(_) => ()
    Err(e) => cs_abort("enc u64", e)
  }
  match w.write_string(v.string_value[:]) {
    Ok(_) => ()
    Err(e) => cs_abort("enc string", e)
  }
  match w.write_wstring(v.wstring_value[:]) {
    Ok(_) => ()
    Err(e) => cs_abort("enc wstring", e)
  }
}

///|
fn encode_collections(
  w : CdrWriter,
  v : CorpusCollections,
  nest : CdrNesting,
) -> Unit raise {
  ignore(nest)
  assert_eq(v.fixed_i32.length(), 3)
  let mut i = 0
  while i < 3 {
    match w.write_i32(v.fixed_i32[i]) {
      Ok(_) => ()
      Err(e) => cs_abort("enc fixed_i32", e)
    }
    i = i + 1
  }
  match w.write_sequence_length(v.bounded_f64.length(), max_elements=4U) {
    Ok(_) => ()
    Err(e) => cs_abort("enc bounded_f64 count", e)
  }
  i = 0
  while i < v.bounded_f64.length() {
    match w.write_f64(v.bounded_f64[i]) {
      Ok(_) => ()
      Err(e) => cs_abort("enc bounded_f64", e)
    }
    i = i + 1
  }
  match w.write_byte_sequence(cs_bytes_of(v.bytes_value)[:]) {
    Ok(_) => ()
    Err(e) => cs_abort("enc bytes_value", e)
  }
  match w.write_string(v.bounded_string[:], max_bytes=16U) {
    Ok(_) => ()
    Err(e) => cs_abort("enc bounded_string", e)
  }
  match w.write_wstring(v.bounded_wstring[:], max_scalars=16U) {
    Ok(_) => ()
    Err(e) => cs_abort("enc bounded_wstring", e)
  }
}

///|
fn encode_nested_sample(
  w : CdrWriter,
  v : CorpusNestedSample,
  parent : CdrNesting,
) -> Unit raise {
  let nest = match w.enter_nested(parent) {
    Ok(n) => n
    Err(e) => {
      cs_abort("enc NestedSample nest", e)
      parent
    }
  }
  encode_time(w, v.stamp, nest)
  encode_primitive_scalars(w, v.scalars, nest)
  encode_collections(w, v.collections, nest)
}

///|
fn encode_echo_request(
  w : CdrWriter,
  v : CorpusEchoNestedRequest,
) -> Unit raise {
  encode_nested_sample(w, v.input, w.root_nesting())
}

///|
fn encode_echo_response(
  w : CdrWriter,
  v : CorpusEchoNestedResponse,
) -> Unit raise {
  encode_nested_sample(w, v.output, w.root_nesting())
  match w.write_bool(v.accepted) {
    Ok(_) => ()
    Err(e) => cs_abort("enc accepted", e)
  }
}

///|
fn encode_goal(w : CdrWriter, v : CorpusMeasureSequenceGoal) -> Unit raise {
  let root = w.root_nesting()
  let nest = match w.enter_nested(root) {
    Ok(n) => n
    Err(e) => {
      cs_abort("enc Goal nest", e)
      root
    }
  }
  encode_collections(w, v.target, nest)
}

///|
fn encode_result(w : CdrWriter, v : CorpusMeasureSequenceResult) -> Unit raise {
  encode_nested_sample(w, v.result, w.root_nesting())
}

///|
fn encode_feedback(
  w : CdrWriter,
  v : CorpusMeasureSequenceFeedback,
) -> Unit raise {
  match w.write_f32(v.progress) {
    Ok(_) => ()
    Err(e) => cs_abort("enc progress", e)
  }
  encode_nested_sample(w, v.sample, w.root_nesting())
}

///|
fn encode_point_field(w : CdrWriter, v : CorpusPointField) -> Unit {
  match w.write_string(v.name[:]) {
    Ok(_) => ()
    Err(e) => cs_abort("enc PointField.name", e)
  }
  match w.write_u32(v.offset) {
    Ok(_) => ()
    Err(e) => cs_abort("enc PointField.offset", e)
  }
  match w.write_u8(v.datatype) {
    Ok(_) => ()
    Err(e) => cs_abort("enc PointField.datatype", e)
  }
  match w.write_u32(v.count) {
    Ok(_) => ()
    Err(e) => cs_abort("enc PointField.count", e)
  }
}

///|
fn encode_point_cloud2(w : CdrWriter, v : CorpusPointCloud2) -> Unit {
  let root = w.root_nesting()
  let header_nest = match w.enter_nested(root) {
    Ok(n) => n
    Err(e) => {
      cs_abort("enc Header nest", e)
      root
    }
  }
  encode_time(w, v.header.stamp, header_nest)
  match w.write_string(v.header.frame_id[:]) {
    Ok(_) => ()
    Err(e) => cs_abort("enc frame_id", e)
  }
  match w.write_u32(v.height) {
    Ok(_) => ()
    Err(e) => cs_abort("enc height", e)
  }
  match w.write_u32(v.width) {
    Ok(_) => ()
    Err(e) => cs_abort("enc width", e)
  }
  match w.write_sequence_length(v.fields.length()) {
    Ok(_) => ()
    Err(e) => cs_abort("enc fields count", e)
  }
  let mut i = 0
  while i < v.fields.length() {
    let fnest = match w.enter_nested(root) {
      Ok(n) => n
      Err(e) => {
        cs_abort("enc PointField nest", e)
        root
      }
    }
    ignore(fnest)
    encode_point_field(w, v.fields[i])
    i = i + 1
  }
  match w.write_bool(v.is_bigendian) {
    Ok(_) => ()
    Err(e) => cs_abort("enc is_bigendian", e)
  }
  match w.write_u32(v.point_step) {
    Ok(_) => ()
    Err(e) => cs_abort("enc point_step", e)
  }
  match w.write_u32(v.row_step) {
    Ok(_) => ()
    Err(e) => cs_abort("enc row_step", e)
  }
  match w.write_byte_sequence(v.data) {
    Ok(_) => ()
    Err(e) => cs_abort("enc data", e)
  }
  match w.write_bool(v.is_dense) {
    Ok(_) => ()
    Err(e) => cs_abort("enc is_dense", e)
  }
}

// ---------------------------------------------------------------------------
// Point record decode from opaque data
// ---------------------------------------------------------------------------

///|
fn read_f32_le_at(data : BytesView, off : Int) -> Float {
  let b0 = data[off].to_uint()
  let b1 = data[off + 1].to_uint()
  let b2 = data[off + 2].to_uint()
  let b3 = data[off + 3].to_uint()
  let bits = (b3 << 24) | (b2 << 16) | (b1 << 8) | b0
  Float::reinterpret_from_uint(bits)
}

///|
fn read_u16_le_at(data : BytesView, off : Int) -> UInt16 {
  let b0 = data[off].to_uint()
  let b1 = data[off + 1].to_uint()
  ((b1 << 8) | b0).to_uint16()
}

///|
fn decode_point_records_from_data(
  data : BytesView,
  is_bigendian : Bool,
  point_step : Int,
  count : Int,
) -> Array[CorpusPointRecord] raise {
  assert_eq(is_bigendian, false)
  assert_eq(point_step, 16)
  assert_eq(data.length(), count * point_step)
  let out : Array[CorpusPointRecord] = []
  let mut i = 0
  while i < count {
    let base = i * point_step
    out.push({
      x: read_f32_le_at(data, base),
      y: read_f32_le_at(data, base + 4),
      z: read_f32_le_at(data, base + 8),
      intensity: read_u16_le_at(data, base + 12),
      ring: read_u16_le_at(data, base + 14),
    })
    i = i + 1
  }
  out
}

///|
fn eq_point_record(a : CorpusPointRecord, b : CorpusPointRecord) -> Bool {
  a.x == b.x &&
  a.y == b.y &&
  a.z == b.z &&
  a.intensity == b.intensity &&
  a.ring == b.ring
}

// ---------------------------------------------------------------------------
// Fixture materialization from d1 bridge
// ---------------------------------------------------------------------------

///|
fn materialize_fixture(f : CdrCorpusFixture) -> (Array[Byte], Bytes) {
  let arr = cdr_fx_decode_hex(f.hex_bytes)
  let bytes = cs_bytes_of(arr)
  (arr, bytes)
}

///|
fn prefix_eq_bytes(out : Bytes, src : Array[Byte], logical : Int) -> Bool {
  if out.length() != logical {
    return false
  }
  if src.length() < logical {
    return false
  }
  let mut i = 0
  while i < logical {
    if out[i] != src[i] {
      return false
    }
    i = i + 1
  }
  true
}

// ---------------------------------------------------------------------------
// Dispatch: decode + complete + optional re-encode
// ---------------------------------------------------------------------------

///|
fn decode_and_check_values(r : CdrReader, case_id : String) -> Unit raise {
  let root = r.root_nesting()
  if case_id == "primitive_scalars" || case_id == "primitive_scalars_big_endian" {
    let v = decode_primitive_scalars(r, root)
    assert_eq(eq_primitive(v, expected_primitive_scalars()), true)
  } else if case_id == "collections" {
    let v = decode_collections(r, root)
    assert_eq(eq_collections(v, expected_collections()), true)
  } else if case_id == "nested_sample" {
    let v = decode_nested_sample(r, root)
    assert_eq(eq_nested(v, expected_nested_sample()), true)
  } else if case_id == "echo_nested_request" {
    let v = decode_echo_request(r)
    assert_eq(eq_nested(v.input, expected_nested_sample()), true)
  } else if case_id == "echo_nested_response" {
    let v = decode_echo_response(r)
    assert_eq(eq_nested(v.output, expected_nested_sample()), true)
    assert_eq(v.accepted, true)
  } else if case_id == "measure_sequence_goal" {
    let v = decode_goal(r)
    assert_eq(eq_collections(v.target, expected_collections()), true)
  } else if case_id == "measure_sequence_result" {
    let v = decode_result(r)
    assert_eq(eq_nested(v.result, expected_nested_sample()), true)
  } else if case_id == "measure_sequence_feedback" {
    let v = decode_feedback(r)
    assert_eq(v.progress, Float::from_double(0.625))
    assert_eq(eq_nested(v.sample, expected_nested_sample()), true)
  } else if case_id == "point_cloud2" {
    let v = decode_point_cloud2(r)
    let exp_header : CorpusHeader = {
      stamp: { sec: 1700000001, nanosec: 987654321U },
      frame_id: "map",
    }
    let exp_data = expected_point_cloud2_data_bytes()
    assert_eq(
      eq_point_cloud2_meta(
        v,
        exp_header,
        2U,
        3U,
        expected_point_fields(),
        false,
        16U,
        48U,
        exp_data,
        true,
      ),
      true,
    )
    let records = decode_point_records_from_data(v.data, v.is_bigendian, 16, 6)
    let exp_records = expected_point_records()
    assert_eq(records.length(), 6)
    let mut i = 0
    while i < 6 {
      assert_eq(eq_point_record(records[i], exp_records[i]), true)
      i = i + 1
    }
  } else {
    abort("unknown case_id " + case_id)
  }
}

///|
fn reencode_case(
  case_id : String,
  endian : CdrEndian,
  decoded_holder : Unit,
) -> Bytes raise {
  // Re-encode from expected logical values (same sample across rows).
  ignore(decoded_holder)
  let w = cs_writer(endian)
  if case_id == "primitive_scalars" || case_id == "primitive_scalars_big_endian" {
    encode_primitive_scalars(w, expected_primitive_scalars(), w.root_nesting())
  } else if case_id == "collections" {
    encode_collections(w, expected_collections(), w.root_nesting())
  } else if case_id == "nested_sample" {
    encode_nested_sample(w, expected_nested_sample(), w.root_nesting())
  } else if case_id == "echo_nested_request" {
    encode_echo_request(w, { input: expected_nested_sample() })
  } else if case_id == "echo_nested_response" {
    encode_echo_response(w, { output: expected_nested_sample(), accepted: true })
  } else if case_id == "measure_sequence_goal" {
    encode_goal(w, { target: expected_collections() })
  } else if case_id == "measure_sequence_result" {
    encode_result(w, { result: expected_nested_sample() })
  } else if case_id == "measure_sequence_feedback" {
    encode_feedback(w, {
      progress: Float::from_double(0.625),
      sample: expected_nested_sample(),
    })
  } else if case_id == "point_cloud2" {
    // Re-encode uses decoded data view path in dedicated test; here use expected bytes.
    let data_arr = expected_point_cloud2_data_bytes()
    let data_bytes = cs_bytes_of(data_arr)
    encode_point_cloud2(w, {
      header: {
        stamp: { sec: 1700000001, nanosec: 987654321U },
        frame_id: "map",
      },
      height: 2U,
      width: 3U,
      fields: expected_point_fields(),
      is_bigendian: false,
      point_step: 16U,
      row_step: 48U,
      data: data_bytes[:],
      is_dense: true,
    })
  } else {
    abort("unknown case_id " + case_id)
  }
  w.to_bytes()
}

// ---------------------------------------------------------------------------
// Tests: decode semantics (M1-01d2)
// ---------------------------------------------------------------------------

///|
test "corpus expected primitives and collections field extremes" {
  let p = expected_primitive_scalars()
  assert_eq(p.bool_value, true)
  assert_eq(p.byte_value, b'\xa5')
  assert_eq(p.char_value, b'Z')
  assert_eq(p.int8_value, -120)
  assert_eq(p.uint8_value, b'\xfa')
  assert_eq(p.int16_value, -32000)
  assert_eq(p.uint16_value, 65000U.to_uint16())
  assert_eq(p.int32_value, -2000000000)
  assert_eq(p.uint32_value, 4000000000U)
  assert_eq(p.int64_value, -9000000000000000000L)
  assert_eq(p.uint64_value, 18000000000000000000UL)
  assert_eq(p.string_value, "Moonspan CDR ✓")
  assert_eq(p.wstring_value, "月面CDR")
  let c = expected_collections()
  assert_eq(c.fixed_i32[0], -2147483648)
  assert_eq(c.fixed_i32[2], 2147483647)
  assert_eq(c.bounded_f64.length(), 4)
  assert_eq(c.bytes_value.length(), 5)
  assert_eq(c.bounded_string.length(), 16)
  assert_eq(c.bounded_wstring.length(), 16)
}

///|
test "corpus decode all 56 fixtures with zero-tail completion and logical values" {
  let mut n = 0
  for f in cdr_corpus_fixtures {
    let (arr, bytes) = materialize_fixture(f)
    ignore(arr)
    let r = cs_open(bytes[:])
    assert_eq(r.little_endian(), f.serialized_endianness == "little")
    decode_and_check_values(r, f.case_id)
    match r.ensure_complete_with_zero_tail(f.zero_tail_bytes) {
      Ok(_) => ()
      Err(e) => cs_abort(f.id + " complete", e)
    }
    assert_eq(r.remaining(), 0)
    n = n + 1
  }
  assert_eq(n, CDR_FX_FIXTURE_TOTAL)
}

///|
test "corpus multi-row comparison groups decode to identical semantics" {
  let mut groups = 0
  for c in cdr_corpus_comparisons {
    assert_eq(c.fixture_ids.length() >= 2, true)
    let first = cdr_fx_find(c.fixture_ids[0])
    let (arr0, bytes0) = materialize_fixture(first)
    ignore(arr0)
    let r0 = cs_open(bytes0[:])
    // Decode first into expected checks, then each peer.
    decode_and_check_values(r0, first.case_id)
    match r0.ensure_complete_with_zero_tail(first.zero_tail_bytes) {
      Ok(_) => ()
      Err(e) => cs_abort(first.id + " complete", e)
    }
    let mut i = 1
    while i < c.fixture_ids.length() {
      let peer = cdr_fx_find(c.fixture_ids[i])
      assert_eq(peer.case_id, first.case_id)
      assert_eq(peer.ros_distro, first.ros_distro)
      let (arr, bytes) = materialize_fixture(peer)
      ignore(arr)
      let r = cs_open(bytes[:])
      decode_and_check_values(r, peer.case_id)
      match r.ensure_complete_with_zero_tail(peer.zero_tail_bytes) {
        Ok(_) => ()
        Err(e) => cs_abort(peer.id + " complete", e)
      }
      i = i + 1
    }
    groups = groups + 1
  }
  assert_eq(groups, CDR_FX_COMPARISON_TOTAL)
}

// ---------------------------------------------------------------------------
// Tests: exact re-encode (M1-01d2)
// ---------------------------------------------------------------------------

///|
test "corpus exact re-encode matches logical prefix for all 56 fixtures" {
  let mut n = 0
  for f in cdr_corpus_fixtures {
    let (arr, bytes) = materialize_fixture(f)
    let r = cs_open(bytes[:])
    decode_and_check_values(r, f.case_id)
    match r.ensure_complete_with_zero_tail(f.zero_tail_bytes) {
      Ok(_) => ()
      Err(e) => cs_abort(f.id + " complete", e)
    }
    let endian = cs_endian_of(f.serialized_endianness)
    let out = reencode_case(f.case_id, endian, ())
    assert_eq(out.length(), f.logical_byte_length)
    assert_eq(prefix_eq_bytes(out, arr, f.logical_byte_length), true)
    // Canonical encode carries zero top-level tail.
    assert_eq(out.length() == f.byte_length || f.zero_tail_bytes > 0, true)
    if f.zero_tail_bytes == 0 {
      assert_eq(out.length(), f.byte_length)
    } else {
      assert_eq(out.length() + f.zero_tail_bytes, f.byte_length)
    }
    n = n + 1
  }
  assert_eq(n, CDR_FX_FIXTURE_TOTAL)
}

///|
test "point_cloud2 data is borrowed input-backed view and re-encodes exactly" {
  let f = cdr_fx_find("H-CY-point_cloud2")
  let (arr, bytes) = materialize_fixture(f)
  let input = bytes
  let r = cs_open(input[:])
  let cloud = decode_point_cloud2(r)
  match r.ensure_complete_with_zero_tail(f.zero_tail_bytes) {
    Ok(_) => ()
    Err(e) => cs_abort("pc2 complete", e)
  }
  let exp = expected_point_cloud2_data_bytes()
  assert_eq(cloud.data.length(), 96)
  assert_eq(eq_bytes_view_array(cloud.data, exp), true)
  // Package-visible view identity: data() spans the full input buffer.
  assert_eq(cloud.data.data().length(), input.length())
  assert_eq(physical_equal(cloud.data.data(), input), true)
  // Exact re-encode from the borrowed view (not a copied array).
  let w = cs_writer(CdrEndian::Little)
  encode_point_cloud2(w, cloud)
  let out = w.to_bytes()
  assert_eq(out.length(), f.logical_byte_length)
  assert_eq(prefix_eq_bytes(out, arr, f.logical_byte_length), true)
}

///|
test "big-endian primitive singletons decode and re-encode" {
  for
    id in [
      "H-FT-primitive_scalars_big_endian", "J-FT-primitive_scalars_big_endian",
    ] {
    let f = cdr_fx_find(id)
    assert_eq(f.serialized_endianness, "big")
    let (arr, bytes) = materialize_fixture(f)
    let r = cs_open(bytes[:])
    assert_eq(r.little_endian(), false)
    let v = decode_primitive_scalars(r, r.root_nesting())
    assert_eq(eq_primitive(v, expected_primitive_scalars()), true)
    match r.ensure_complete_with_zero_tail(f.zero_tail_bytes) {
      Ok(_) => ()
      Err(e) => cs_abort(id + " complete", e)
    }
    let out = reencode_case(f.case_id, CdrEndian::Big, ())
    assert_eq(out.length(), f.logical_byte_length)
    assert_eq(prefix_eq_bytes(out, arr, f.logical_byte_length), true)
  }
}

///|
test "comparison groups re-encode to one logical prefix per group" {
  // Cross-row fixtures share logical values; exact re-encode is identical per
  // case_id and endianness, and equals each member's canonical logical prefix.
  let mut groups = 0
  for c in cdr_corpus_comparisons {
    let first = cdr_fx_find(c.fixture_ids[0])
    let endian = cs_endian_of(first.serialized_endianness)
    let out = reencode_case(first.case_id, endian, ())
    let mut i = 0
    while i < c.fixture_ids.length() {
      let f = cdr_fx_find(c.fixture_ids[i])
      let (arr, bytes) = materialize_fixture(f)
      ignore(bytes)
      assert_eq(out.length(), f.logical_byte_length)
      assert_eq(prefix_eq_bytes(out, arr, f.logical_byte_length), true)
      i = i + 1
    }
    groups = groups + 1
  }
  assert_eq(groups, CDR_FX_COMPARISON_TOTAL)
}
