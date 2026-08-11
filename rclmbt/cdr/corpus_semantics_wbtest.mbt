///|
/// Authoritative ROS CDR corpus semantic proof (M1-01d2).
/// Package-internal hand-written white-box codecs for the nine root schema
/// surfaces. Round-trip encodes the exact decoded CorpusValue from decode_case.
/// Nesting tokens: the token is the current aggregate; enter a child before
/// every nested aggregate field.

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

///|
/// Tagged root value returned by decode_case and consumed by encode_case.
priv enum CorpusValue {
  PrimitiveScalars(CorpusPrimitiveScalars)
  Collections(CorpusCollections)
  NestedSample(CorpusNestedSample)
  EchoNestedRequest(CorpusEchoNestedRequest)
  EchoNestedResponse(CorpusEchoNestedResponse)
  MeasureSequenceGoal(CorpusMeasureSequenceGoal)
  MeasureSequenceResult(CorpusMeasureSequenceResult)
  MeasureSequenceFeedback(CorpusMeasureSequenceFeedback)
  PointCloud2(CorpusPointCloud2)
}

// ---------------------------------------------------------------------------
// Abort / open helpers
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

///|
/// Enter one nested aggregate under `parent`. Typed abort on bounds fault.
fn cs_enter_r(r : CdrReader, parent : CdrNesting, ctx : String) -> CdrNesting {
  match r.enter_nested(parent) {
    Ok(n) => n
    Err(e) => {
      cs_abort(ctx, e)
      parent
    }
  }
}

///|
fn cs_enter_w(w : CdrWriter, parent : CdrNesting, ctx : String) -> CdrNesting {
  match w.enter_nested(parent) {
    Ok(n) => n
    Err(e) => {
      cs_abort(ctx, e)
      parent
    }
  }
}

// ---------------------------------------------------------------------------
// Expected corpus values (manifest oracle only)
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
      x: Float::from_double(-1.0),
      y: Float::from_double(-2.0),
      z: Float::from_double(-3.0),
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
      x: Float::from_double(-10.0),
      y: Float::from_double(4.0),
      z: Float::from_double(8.0),
      intensity: 50U.to_uint16(),
      ring: 4U.to_uint16(),
    },
    {
      x: Float::from_double(1024.0),
      y: Float::from_double(-1024.0),
      z: Float::from_double(64.0),
      intensity: 60U.to_uint16(),
      ring: 5U.to_uint16(),
    },
  ]
}

///|
fn expected_point_cloud2_data_bytes() -> Array[Byte] {
  let hex = "0000803f00000040000040400a000000000080bf000000c0000040c0140001000000003f0000803e0000003e1e000200000020410000a0410000f04128000300000020c100008040000000413200040000008044000080c4000080423c000500"
  cdr_fx_decode_hex(hex)
}

///|
fn expected_point_cloud2_header() -> CorpusHeader {
  { stamp: { sec: 1700000001, nanosec: 987654321U }, frame_id: "map" }
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
fn eq_bytes_view(a : BytesView, b : BytesView) -> Bool {
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
fn eq_header(a : CorpusHeader, b : CorpusHeader) -> Bool {
  eq_time(a.stamp, b.stamp) && a.frame_id == b.frame_id
}

///|
fn eq_point_cloud2(a : CorpusPointCloud2, b : CorpusPointCloud2) -> Bool {
  if !(eq_header(a.header, b.header) &&
    a.height == b.height &&
    a.width == b.width &&
    a.is_bigendian == b.is_bigendian &&
    a.point_step == b.point_step &&
    a.row_step == b.row_step &&
    a.is_dense == b.is_dense) {
    return false
  }
  if a.fields.length() != b.fields.length() {
    return false
  }
  let mut i = 0
  while i < a.fields.length() {
    if !eq_point_field(a.fields[i], b.fields[i]) {
      return false
    }
    i = i + 1
  }
  eq_bytes_view(a.data, b.data)
}

///|
fn eq_point_record(a : CorpusPointRecord, b : CorpusPointRecord) -> Bool {
  a.x == b.x &&
  a.y == b.y &&
  a.z == b.z &&
  a.intensity == b.intensity &&
  a.ring == b.ring
}

///|
/// Full semantic equality between two decoded root values.
fn eq_corpus_value(a : CorpusValue, b : CorpusValue) -> Bool {
  match (a, b) {
    (PrimitiveScalars(x), PrimitiveScalars(y)) => eq_primitive(x, y)
    (Collections(x), Collections(y)) => eq_collections(x, y)
    (NestedSample(x), NestedSample(y)) => eq_nested(x, y)
    (EchoNestedRequest(x), EchoNestedRequest(y)) => eq_nested(x.input, y.input)
    (EchoNestedResponse(x), EchoNestedResponse(y)) =>
      eq_nested(x.output, y.output) && x.accepted == y.accepted
    (MeasureSequenceGoal(x), MeasureSequenceGoal(y)) =>
      eq_collections(x.target, y.target)
    (MeasureSequenceResult(x), MeasureSequenceResult(y)) =>
      eq_nested(x.result, y.result)
    (MeasureSequenceFeedback(x), MeasureSequenceFeedback(y)) =>
      x.progress == y.progress && eq_nested(x.sample, y.sample)
    (PointCloud2(x), PointCloud2(y)) => eq_point_cloud2(x, y)
    _ => false
  }
}

// ---------------------------------------------------------------------------
// Decode codecs — `current` is this aggregate; enter children for nested fields
// ---------------------------------------------------------------------------

///|
fn decode_time(r : CdrReader, current : CdrNesting) -> CorpusTime {
  ignore(current)
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
  current : CdrNesting,
) -> CorpusPrimitiveScalars {
  ignore(current)
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
fn decode_collections(r : CdrReader, current : CdrNesting) -> CorpusCollections {
  ignore(current)
  let fixed_i32 : Array[Int] = []
  let mut i = 0
  while i < 3 {
    match r.read_i32() {
      Ok(v) => fixed_i32.push(v)
      Err(e) => cs_abort("fixed_i32", e)
    }
    i = i + 1
  }
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
/// `current` is the NestedSample aggregate itself (root depth 0 at top level).
/// Enters only Time, PrimitiveScalars, and Collections children.
fn decode_nested_sample(
  r : CdrReader,
  current : CdrNesting,
) -> CorpusNestedSample {
  let time_n = cs_enter_r(r, current, "NestedSample.Time")
  let stamp = decode_time(r, time_n)
  let scalars_n = cs_enter_r(r, current, "NestedSample.PrimitiveScalars")
  let scalars = decode_primitive_scalars(r, scalars_n)
  let coll_n = cs_enter_r(r, current, "NestedSample.Collections")
  let collections = decode_collections(r, coll_n)
  { stamp, scalars, collections }
}

///|
fn decode_echo_request(
  r : CdrReader,
  parent : CdrNesting,
) -> CorpusEchoNestedRequest {
  // Enter the NestedSample field under the request aggregate.
  let input_n = cs_enter_r(r, parent, "EchoNestedRequest.input")
  { input: decode_nested_sample(r, input_n) }
}

///|
fn decode_echo_response(
  r : CdrReader,
  parent : CdrNesting,
) -> CorpusEchoNestedResponse {
  let output_n = cs_enter_r(r, parent, "EchoNestedResponse.output")
  let output = decode_nested_sample(r, output_n)
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
fn decode_goal(r : CdrReader, parent : CdrNesting) -> CorpusMeasureSequenceGoal {
  let target_n = cs_enter_r(r, parent, "Goal.Collections")
  { target: decode_collections(r, target_n) }
}

///|
fn decode_result(
  r : CdrReader,
  parent : CdrNesting,
) -> CorpusMeasureSequenceResult {
  let result_n = cs_enter_r(r, parent, "Result.result")
  { result: decode_nested_sample(r, result_n) }
}

///|
fn decode_feedback(
  r : CdrReader,
  parent : CdrNesting,
) -> CorpusMeasureSequenceFeedback {
  let progress = match r.read_f32() {
    Ok(v) => v
    Err(e) => {
      cs_abort("progress", e)
      Float::from_double(0.0)
    }
  }
  let sample_n = cs_enter_r(r, parent, "Feedback.sample")
  let sample = decode_nested_sample(r, sample_n)
  { progress, sample }
}

///|
fn decode_point_field(r : CdrReader, current : CdrNesting) -> CorpusPointField {
  ignore(current)
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
fn decode_header(r : CdrReader, parent : CdrNesting) -> CorpusHeader {
  let current = cs_enter_r(r, parent, "Header")
  let time_n = cs_enter_r(r, current, "Header.Time")
  let stamp = decode_time(r, time_n)
  let frame_id = match r.read_string() {
    Ok(v) => v
    Err(e) => {
      cs_abort("frame_id", e)
      ""
    }
  }
  { stamp, frame_id }
}

///|
fn decode_point_cloud2(r : CdrReader, parent : CdrNesting) -> CorpusPointCloud2 {
  let header = decode_header(r, parent)
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
    let fnest = cs_enter_r(r, parent, "PointField")
    fields.push(decode_point_field(r, fnest))
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

// ---------------------------------------------------------------------------
// Encode codecs — mirror nesting discipline
// ---------------------------------------------------------------------------

///|
fn encode_time(w : CdrWriter, v : CorpusTime, current : CdrNesting) -> Unit {
  ignore(current)
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
  current : CdrNesting,
) -> Unit {
  ignore(current)
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
  current : CdrNesting,
) -> Unit raise {
  ignore(current)
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
/// `current` is the NestedSample aggregate itself. Enters only child aggregates.
fn encode_nested_sample(
  w : CdrWriter,
  v : CorpusNestedSample,
  current : CdrNesting,
) -> Unit raise {
  let time_n = cs_enter_w(w, current, "enc NestedSample.Time")
  encode_time(w, v.stamp, time_n)
  let scalars_n = cs_enter_w(w, current, "enc NestedSample.PrimitiveScalars")
  encode_primitive_scalars(w, v.scalars, scalars_n)
  let coll_n = cs_enter_w(w, current, "enc NestedSample.Collections")
  encode_collections(w, v.collections, coll_n)
}

///|
fn encode_echo_request(
  w : CdrWriter,
  v : CorpusEchoNestedRequest,
  parent : CdrNesting,
) -> Unit raise {
  let input_n = cs_enter_w(w, parent, "enc EchoNestedRequest.input")
  encode_nested_sample(w, v.input, input_n)
}

///|
fn encode_echo_response(
  w : CdrWriter,
  v : CorpusEchoNestedResponse,
  parent : CdrNesting,
) -> Unit raise {
  let output_n = cs_enter_w(w, parent, "enc EchoNestedResponse.output")
  encode_nested_sample(w, v.output, output_n)
  match w.write_bool(v.accepted) {
    Ok(_) => ()
    Err(e) => cs_abort("enc accepted", e)
  }
}

///|
fn encode_goal(
  w : CdrWriter,
  v : CorpusMeasureSequenceGoal,
  parent : CdrNesting,
) -> Unit raise {
  let target_n = cs_enter_w(w, parent, "enc Goal.Collections")
  encode_collections(w, v.target, target_n)
}

///|
fn encode_result(
  w : CdrWriter,
  v : CorpusMeasureSequenceResult,
  parent : CdrNesting,
) -> Unit raise {
  let result_n = cs_enter_w(w, parent, "enc Result.result")
  encode_nested_sample(w, v.result, result_n)
}

///|
fn encode_feedback(
  w : CdrWriter,
  v : CorpusMeasureSequenceFeedback,
  parent : CdrNesting,
) -> Unit raise {
  match w.write_f32(v.progress) {
    Ok(_) => ()
    Err(e) => cs_abort("enc progress", e)
  }
  let sample_n = cs_enter_w(w, parent, "enc Feedback.sample")
  encode_nested_sample(w, v.sample, sample_n)
}

///|
fn encode_point_field(
  w : CdrWriter,
  v : CorpusPointField,
  current : CdrNesting,
) -> Unit {
  ignore(current)
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
fn encode_header(w : CdrWriter, v : CorpusHeader, parent : CdrNesting) -> Unit {
  let current = cs_enter_w(w, parent, "enc Header")
  let time_n = cs_enter_w(w, current, "enc Header.Time")
  encode_time(w, v.stamp, time_n)
  match w.write_string(v.frame_id[:]) {
    Ok(_) => ()
    Err(e) => cs_abort("enc frame_id", e)
  }
}

///|
fn encode_point_cloud2(
  w : CdrWriter,
  v : CorpusPointCloud2,
  parent : CdrNesting,
) -> Unit {
  encode_header(w, v.header, parent)
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
    let fnest = cs_enter_w(w, parent, "enc PointField")
    encode_point_field(w, v.fields[i], fnest)
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
  // Borrowed data view from decode is written as-is.
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
// Point records / materialization
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
// Dispatch: decode_case → CorpusValue; encode_case(decoded); expected oracle
// ---------------------------------------------------------------------------

///|
/// Decode the root sample for `case_id`. Top-level starts at root depth 0.
fn decode_case(r : CdrReader, case_id : String) -> CorpusValue {
  let root = r.root_nesting()
  if case_id == "primitive_scalars" || case_id == "primitive_scalars_big_endian" {
    PrimitiveScalars(decode_primitive_scalars(r, root))
  } else if case_id == "collections" {
    Collections(decode_collections(r, root))
  } else if case_id == "nested_sample" {
    NestedSample(decode_nested_sample(r, root))
  } else if case_id == "echo_nested_request" {
    EchoNestedRequest(decode_echo_request(r, root))
  } else if case_id == "echo_nested_response" {
    EchoNestedResponse(decode_echo_response(r, root))
  } else if case_id == "measure_sequence_goal" {
    MeasureSequenceGoal(decode_goal(r, root))
  } else if case_id == "measure_sequence_result" {
    MeasureSequenceResult(decode_result(r, root))
  } else if case_id == "measure_sequence_feedback" {
    MeasureSequenceFeedback(decode_feedback(r, root))
  } else if case_id == "point_cloud2" {
    PointCloud2(decode_point_cloud2(r, root))
  } else {
    abort("unknown case_id " + case_id)
  }
}

///|
/// Manifest constants are an independent oracle; encode_case consumes CorpusValue directly.
fn assert_expected_semantics(
  value : CorpusValue,
  case_id : String,
) -> Unit raise {
  match value {
    PrimitiveScalars(v) =>
      assert_eq(eq_primitive(v, expected_primitive_scalars()), true)
    Collections(v) => assert_eq(eq_collections(v, expected_collections()), true)
    NestedSample(v) => assert_eq(eq_nested(v, expected_nested_sample()), true)
    EchoNestedRequest(v) =>
      assert_eq(eq_nested(v.input, expected_nested_sample()), true)
    EchoNestedResponse(v) => {
      assert_eq(eq_nested(v.output, expected_nested_sample()), true)
      assert_eq(v.accepted, true)
    }
    MeasureSequenceGoal(v) =>
      assert_eq(eq_collections(v.target, expected_collections()), true)
    MeasureSequenceResult(v) =>
      assert_eq(eq_nested(v.result, expected_nested_sample()), true)
    MeasureSequenceFeedback(v) => {
      assert_eq(v.progress, Float::from_double(0.625))
      assert_eq(eq_nested(v.sample, expected_nested_sample()), true)
    }
    PointCloud2(v) => {
      assert_eq(eq_header(v.header, expected_point_cloud2_header()), true)
      assert_eq(v.height, 2U)
      assert_eq(v.width, 3U)
      assert_eq(v.is_bigendian, false)
      assert_eq(v.point_step, 16U)
      assert_eq(v.row_step, 48U)
      assert_eq(v.is_dense, true)
      let exp_fields = expected_point_fields()
      assert_eq(v.fields.length(), exp_fields.length())
      let mut i = 0
      while i < exp_fields.length() {
        assert_eq(eq_point_field(v.fields[i], exp_fields[i]), true)
        i = i + 1
      }
      let exp_data = expected_point_cloud2_data_bytes()
      assert_eq(eq_bytes_view_array(v.data, exp_data), true)
      let records = decode_point_records_from_data(
        v.data,
        v.is_bigendian,
        16,
        6,
      )
      let exp_records = expected_point_records()
      assert_eq(records.length(), 6)
      i = 0
      while i < 6 {
        assert_eq(eq_point_record(records[i], exp_records[i]), true)
        i = i + 1
      }
    }
  }
  ignore(case_id)
}

///|
/// Encode the exact decoded CorpusValue returned by decode_case.
fn encode_case(w : CdrWriter, value : CorpusValue) -> Unit raise {
  let root = w.root_nesting()
  match value {
    PrimitiveScalars(v) => encode_primitive_scalars(w, v, root)
    Collections(v) => encode_collections(w, v, root)
    NestedSample(v) => encode_nested_sample(w, v, root)
    EchoNestedRequest(v) => encode_echo_request(w, v, root)
    EchoNestedResponse(v) => encode_echo_response(w, v, root)
    MeasureSequenceGoal(v) => encode_goal(w, v, root)
    MeasureSequenceResult(v) => encode_result(w, v, root)
    MeasureSequenceFeedback(v) => encode_feedback(w, v, root)
    PointCloud2(v) => encode_point_cloud2(w, v, root)
  }
}

// ---------------------------------------------------------------------------
// Tests
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
    let value = decode_case(r, f.case_id)
    assert_expected_semantics(value, f.case_id)
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
test "corpus multi-row comparison groups decode to equal CorpusValue peers" {
  let mut groups = 0
  for c in cdr_corpus_comparisons {
    assert_eq(c.fixture_ids.length() >= 2, true)
    let first = cdr_fx_find(c.fixture_ids[0])
    let (arr0, bytes0) = materialize_fixture(first)
    ignore(arr0)
    let r0 = cs_open(bytes0[:])
    let v0 = decode_case(r0, first.case_id)
    assert_expected_semantics(v0, first.case_id)
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
      let vp = decode_case(r, peer.case_id)
      // Peer equality compares decoded values directly.
      assert_eq(eq_corpus_value(v0, vp), true)
      assert_expected_semantics(vp, peer.case_id)
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

///|
test "corpus exact re-encode of decoded CorpusValue matches logical prefix" {
  let mut n = 0
  for f in cdr_corpus_fixtures {
    let (arr, bytes) = materialize_fixture(f)
    let r = cs_open(bytes[:])
    let value = decode_case(r, f.case_id)
    assert_expected_semantics(value, f.case_id)
    match r.ensure_complete_with_zero_tail(f.zero_tail_bytes) {
      Ok(_) => ()
      Err(e) => cs_abort(f.id + " complete", e)
    }
    // Encode the same decoded CorpusValue object.
    let endian = cs_endian_of(f.serialized_endianness)
    let w = cs_writer(endian)
    encode_case(w, value)
    let out = w.to_bytes()
    assert_eq(out.length(), f.logical_byte_length)
    assert_eq(prefix_eq_bytes(out, arr, f.logical_byte_length), true)
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
test "point_cloud2 data is borrowed input-backed view and re-encodes decoded value" {
  let f = cdr_fx_find("H-CY-point_cloud2")
  let (arr, bytes) = materialize_fixture(f)
  let input = bytes
  let r = cs_open(input[:])
  let value = decode_case(r, f.case_id)
  match r.ensure_complete_with_zero_tail(f.zero_tail_bytes) {
    Ok(_) => ()
    Err(e) => cs_abort("pc2 complete", e)
  }
  match value {
    PointCloud2(cloud) => {
      let exp = expected_point_cloud2_data_bytes()
      assert_eq(cloud.data.length(), 96)
      assert_eq(eq_bytes_view_array(cloud.data, exp), true)
      assert_eq(cloud.data.data().length(), input.length())
      assert_eq(physical_equal(cloud.data.data(), input), true)
    }
    _ => abort("expected PointCloud2")
  }
  let w = cs_writer(CdrEndian::Little)
  encode_case(w, value)
  let out = w.to_bytes()
  assert_eq(out.length(), f.logical_byte_length)
  assert_eq(prefix_eq_bytes(out, arr, f.logical_byte_length), true)
}

///|
test "big-endian primitive singletons decode and re-encode decoded values" {
  for
    id in [
      "H-FT-primitive_scalars_big_endian", "J-FT-primitive_scalars_big_endian",
    ] {
    let f = cdr_fx_find(id)
    assert_eq(f.serialized_endianness, "big")
    let (arr, bytes) = materialize_fixture(f)
    let r = cs_open(bytes[:])
    assert_eq(r.little_endian(), false)
    let value = decode_case(r, f.case_id)
    assert_expected_semantics(value, f.case_id)
    match r.ensure_complete_with_zero_tail(f.zero_tail_bytes) {
      Ok(_) => ()
      Err(e) => cs_abort(id + " complete", e)
    }
    let w = cs_writer(CdrEndian::Big)
    encode_case(w, value)
    let out = w.to_bytes()
    assert_eq(out.length(), f.logical_byte_length)
    assert_eq(prefix_eq_bytes(out, arr, f.logical_byte_length), true)
  }
}

///|
test "comparison groups re-encode decoded first member to each logical prefix" {
  let mut groups = 0
  for c in cdr_corpus_comparisons {
    let first = cdr_fx_find(c.fixture_ids[0])
    let (arr0, bytes0) = materialize_fixture(first)
    ignore(arr0)
    let r0 = cs_open(bytes0[:])
    let v0 = decode_case(r0, first.case_id)
    match r0.ensure_complete_with_zero_tail(first.zero_tail_bytes) {
      Ok(_) => ()
      Err(e) => cs_abort(first.id + " complete", e)
    }
    let endian = cs_endian_of(first.serialized_endianness)
    let w = cs_writer(endian)
    encode_case(w, v0)
    let out = w.to_bytes()
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

///|
test "encode_case consumes mutated decoded CorpusValue and changes wire bytes" {
  // Decode a real collections fixture, mutate one field, prove encode differs
  // from the corpus logical prefix (and from encoding the unmutated value).
  let f = cdr_fx_find("H-CY-collections")
  let (arr, bytes) = materialize_fixture(f)
  let r = cs_open(bytes[:])
  let value = decode_case(r, f.case_id)
  match r.ensure_complete_with_zero_tail(f.zero_tail_bytes) {
    Ok(_) => ()
    Err(e) => cs_abort("mutate complete", e)
  }
  let w0 = cs_writer(CdrEndian::Little)
  encode_case(w0, value)
  let baseline = w0.to_bytes()
  assert_eq(prefix_eq_bytes(baseline, arr, f.logical_byte_length), true)
  // Mutate decoded fixed_i32[1] from 0 to 1.
  let mutated = match value {
    Collections(c) => {
      let fixed : Array[Int] = [c.fixed_i32[0], 1, c.fixed_i32[2]]
      Collections({
        fixed_i32: fixed,
        bounded_f64: c.bounded_f64,
        bytes_value: c.bytes_value,
        bounded_string: c.bounded_string,
        bounded_wstring: c.bounded_wstring,
      })
    }
    _ => abort("expected Collections")
  }
  let w1 = cs_writer(CdrEndian::Little)
  encode_case(w1, mutated)
  let altered = w1.to_bytes()
  assert_eq(altered.length(), baseline.length())
  // At least one byte differs from the corpus logical prefix.
  let mut differs = false
  let mut i = 0
  while i < f.logical_byte_length {
    if altered[i] != arr[i] {
      differs = true
    }
    i = i + 1
  }
  assert_eq(differs, true)
  assert_eq(eq_corpus_value(value, mutated), false)
}

///|
test "H-FT and H-CY collections peers equal with declared tail length facts" {
  let ft = cdr_fx_find("H-FT-collections")
  let cy = cdr_fx_find("H-CY-collections")
  let (_, ft_bytes) = materialize_fixture(ft)
  let (_, cy_bytes) = materialize_fixture(cy)
  let r_ft = cs_open(ft_bytes[:])
  let r_cy = cs_open(cy_bytes[:])
  let v_ft = decode_case(r_ft, ft.case_id)
  let v_cy = decode_case(r_cy, cy.case_id)
  match r_ft.ensure_complete_with_zero_tail(ft.zero_tail_bytes) {
    Ok(_) => ()
    Err(e) => cs_abort("H-FT complete", e)
  }
  match r_cy.ensure_complete_with_zero_tail(cy.zero_tail_bytes) {
    Ok(_) => ()
    Err(e) => cs_abort("H-CY complete", e)
  }
  assert_eq(eq_corpus_value(v_ft, v_cy), true)
  // Durable bridge facts: equal semantics with different wire lengths.
  assert_eq(cy.zero_tail_bytes, 0)
  assert_eq(ft.zero_tail_bytes > 0, true)
  assert_eq(ft.byte_length, cy.byte_length + ft.zero_tail_bytes)
}

///|
test "top-level nested_sample succeeds at nesting depth budget 1" {
  // NestedSample at root depth 0 enters only three direct aggregate children
  // (Time, PrimitiveScalars, Collections), so max_nesting_depth=1 is enough.
  let f = cdr_fx_find("H-CY-nested_sample")
  let (arr, bytes) = materialize_fixture(f)
  let limits = match
    CdrLimits::new(
      DEFAULT_MAX_STREAM_BYTES,
      1,
      DEFAULT_MAX_TEMPORARY_ALLOCATION,
    ) {
    Ok(l) => l
    Err(e) => {
      cs_abort("limits depth 1", e)
      CdrLimits::defaults()
    }
  }
  let r = match CdrReader::open(bytes[:], limits) {
    Ok(reader) => reader
    Err(e) => {
      cs_abort("open depth 1", e)
      cs_open(bytes[:])
    }
  }
  let value = decode_case(r, f.case_id)
  assert_expected_semantics(value, f.case_id)
  match r.ensure_complete_with_zero_tail(f.zero_tail_bytes) {
    Ok(_) => ()
    Err(e) => cs_abort("nested_sample depth 1 complete", e)
  }
  let w = match CdrWriter::new(CdrEndian::Little, limits) {
    Ok(writer) => writer
    Err(e) => {
      cs_abort("writer depth 1", e)
      cs_writer(CdrEndian::Little)
    }
  }
  encode_case(w, value)
  let out = w.to_bytes()
  assert_eq(out.length(), f.logical_byte_length)
  assert_eq(prefix_eq_bytes(out, arr, f.logical_byte_length), true)
}

///|
test "echo_nested_request succeeds at nesting depth budget 2" {
  // Request root enters NestedSample (depth 1); NestedSample children reach depth 2.
  let f = cdr_fx_find("H-CY-echo_nested_request")
  let (arr, bytes) = materialize_fixture(f)
  let limits = match
    CdrLimits::new(
      DEFAULT_MAX_STREAM_BYTES,
      2,
      DEFAULT_MAX_TEMPORARY_ALLOCATION,
    ) {
    Ok(l) => l
    Err(e) => {
      cs_abort("limits depth 2", e)
      CdrLimits::defaults()
    }
  }
  let r = match CdrReader::open(bytes[:], limits) {
    Ok(reader) => reader
    Err(e) => {
      cs_abort("open depth 2", e)
      cs_open(bytes[:])
    }
  }
  let value = decode_case(r, f.case_id)
  assert_expected_semantics(value, f.case_id)
  match r.ensure_complete_with_zero_tail(f.zero_tail_bytes) {
    Ok(_) => ()
    Err(e) => cs_abort("echo request depth 2 complete", e)
  }
  let w = match CdrWriter::new(CdrEndian::Little, limits) {
    Ok(writer) => writer
    Err(e) => {
      cs_abort("writer depth 2", e)
      cs_writer(CdrEndian::Little)
    }
  }
  encode_case(w, value)
  let out = w.to_bytes()
  assert_eq(out.length(), f.logical_byte_length)
  assert_eq(prefix_eq_bytes(out, arr, f.logical_byte_length), true)
}

///|
test "point_cloud2 succeeds at nesting depth budget 2 for Header.Time" {
  // PointCloud2 at root enters Header (depth 1) then Header.Time (depth 2).
  let f = cdr_fx_find("H-CY-point_cloud2")
  let (arr, bytes) = materialize_fixture(f)
  let limits = match
    CdrLimits::new(
      DEFAULT_MAX_STREAM_BYTES,
      2,
      DEFAULT_MAX_TEMPORARY_ALLOCATION,
    ) {
    Ok(l) => l
    Err(e) => {
      cs_abort("limits pc2 depth 2", e)
      CdrLimits::defaults()
    }
  }
  let r = match CdrReader::open(bytes[:], limits) {
    Ok(reader) => reader
    Err(e) => {
      cs_abort("open pc2 depth 2", e)
      cs_open(bytes[:])
    }
  }
  let value = decode_case(r, f.case_id)
  assert_expected_semantics(value, f.case_id)
  match r.ensure_complete_with_zero_tail(f.zero_tail_bytes) {
    Ok(_) => ()
    Err(e) => cs_abort("pc2 depth 2 complete", e)
  }
  let w = match CdrWriter::new(CdrEndian::Little, limits) {
    Ok(writer) => writer
    Err(e) => {
      cs_abort("writer pc2 depth 2", e)
      cs_writer(CdrEndian::Little)
    }
  }
  encode_case(w, value)
  let out = w.to_bytes()
  assert_eq(out.length(), f.logical_byte_length)
  assert_eq(prefix_eq_bytes(out, arr, f.logical_byte_length), true)
}
