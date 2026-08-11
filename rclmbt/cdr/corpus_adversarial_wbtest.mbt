///|
/// Corpus-level adversarial gate (M1-01d3).
/// Composes the d1 fixture bridge, d2 decode pipeline, and typed CDR APIs.
/// Focused low-level suites remain the authoritative source for illegal
/// booleans, UTF-8, string/wstring faults, sequence bounds, alignment,
/// allocation ceilings, nesting 64/65, writer atomicity, and unit-level
/// strict/declared tail mechanics.

// ---------------------------------------------------------------------------
// Frozen adversarial counters (committed 56-fixture corpus)
// ---------------------------------------------------------------------------

///|
const CA_EXACT_TAIL = 24

///|
const CA_TAIL_BEARING = 32

///|
const CA_FOUR_BYTE_TAILS = 12

///|
const CA_TWELVE_BYTE_TAILS = 20

///|
const CA_NONZERO_TAIL_MUTATIONS = 288

///|
const CA_FIXTURE_TOTAL = 56

///|
/// Exact fixtures: original unpadded buffer, rem=0, declaration 4 succeeds.
const CA_EXACT_END_DECLARED_SUCCESSES = 24

///|
/// Tail-bearing fixtures: mismatched declaration yields trailing_data.
const CA_WRONG_DECLARATION_REJECTIONS = 32

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

///|
fn ca_abort(ctx : String, e : CdrError) -> Unit {
  abort(ctx + ": " + e.code)
}

///|
fn ca_materialize(f : CdrCorpusFixture) -> Array[Byte] {
  cdr_fx_decode_hex(f.hex_bytes)
}

///|
fn ca_bytes(arr : Array[Byte]) -> Bytes {
  Bytes::from_array(arr[:])
}

///|
fn ca_open_default(arr : Array[Byte]) -> CdrReader {
  match CdrReader::open_default(ca_bytes(arr)[:]) {
    Ok(r) => r
    Err(e) => {
      ca_abort("open_default", e)
      // unreachable
      match CdrReader::open_default(b"\x00\x01\x00\x00"[:]) {
        Ok(r) => r
        Err(_) => abort("unreachable")
      }
    }
  }
}

///|
fn ca_wrong_tail(declared : Int) -> Int {
  if declared == 0 {
    4
  } else if declared == 4 {
    0
  } else if declared == 12 {
    4
  } else {
    abort("unexpected declared tail " + declared.to_string())
  }
}

///|
fn ca_clone_with_append(src : Array[Byte], extra : Byte) -> Array[Byte] {
  let out : Array[Byte] = []
  let mut i = 0
  while i < src.length() {
    out.push(src[i])
    i = i + 1
  }
  out.push(extra)
  out
}

///|
fn ca_clone_with_tail_byte(
  src : Array[Byte],
  index : Int,
  value : Byte,
) -> Array[Byte] {
  let out : Array[Byte] = []
  let mut i = 0
  while i < src.length() {
    if i == index {
      out.push(value)
    } else {
      out.push(src[i])
    }
    i = i + 1
  }
  out
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

///|
test "strict and declared completion across all 56 corpus fixtures" {
  let mut exact = 0
  let mut tail_bearing = 0
  for f in cdr_corpus_fixtures {
    let arr = ca_materialize(f)
    let r = ca_open_default(arr)
    ignore(decode_case(r, f.case_id))
    let logical_pos = r.position()
    assert_eq(logical_pos, f.logical_byte_length)
    if f.zero_tail_bytes == 0 {
      match r.ensure_complete() {
        Ok(_) => ()
        Err(e) => ca_abort(f.id + " strict exact", e)
      }
      assert_eq(r.remaining(), 0)
      exact = exact + 1
    } else {
      match r.ensure_complete() {
        Ok(_) => abort(f.id + " strict accepts tail")
        Err(e) => {
          assert_eq(e.code, CODE_TRAILING_DATA)
          assert_eq(e.offset, f.logical_byte_length)
          assert_eq(e.remaining, f.zero_tail_bytes)
          assert_eq(e.needed, 0)
        }
      }
      // Logical cursor stays at the sample end after the strict fault.
      assert_eq(r.position(), f.logical_byte_length)
      match r.ensure_complete_with_zero_tail(f.zero_tail_bytes) {
        Ok(_) => ()
        Err(e) => ca_abort(f.id + " declared tail", e)
      }
      assert_eq(r.remaining(), 0)
      assert_eq(r.position(), f.byte_length)
      tail_bearing = tail_bearing + 1
    }
  }
  assert_eq(exact, CA_EXACT_TAIL)
  assert_eq(tail_bearing, CA_TAIL_BEARING)
  assert_eq(exact + tail_bearing, CA_FIXTURE_TOTAL)
}

///|
test "nonzero mutation of every declared tail byte yields trailing_data" {
  let mut mutations = 0
  let mut four = 0
  let mut twelve = 0
  for f in cdr_corpus_fixtures {
    if f.zero_tail_bytes == 0 {
      continue
    }
    if f.zero_tail_bytes == 4 {
      four = four + 1
    } else if f.zero_tail_bytes == 12 {
      twelve = twelve + 1
    } else {
      abort(f.id + " unexpected tail length")
    }
    let base = ca_materialize(f)
    let mut t = 0
    while t < f.zero_tail_bytes {
      let dirty_index = f.logical_byte_length + t
      let dirty = ca_clone_with_tail_byte(base, dirty_index, b'\x01')
      let r = ca_open_default(dirty)
      ignore(decode_case(r, f.case_id))
      assert_eq(r.position(), f.logical_byte_length)
      match r.ensure_complete_with_zero_tail(f.zero_tail_bytes) {
        Ok(_) => abort(f.id + " accepted dirty tail at " + t.to_string())
        Err(e) => {
          assert_eq(e.code, CODE_TRAILING_DATA)
          assert_eq(e.offset, f.logical_byte_length)
          assert_eq(e.remaining, f.zero_tail_bytes)
        }
      }
      assert_eq(r.position(), f.logical_byte_length)
      mutations = mutations + 1
      t = t + 1
    }
  }
  assert_eq(four, CA_FOUR_BYTE_TAILS)
  assert_eq(twelve, CA_TWELVE_BYTE_TAILS)
  assert_eq(mutations, CA_NONZERO_TAIL_MUTATIONS)
  assert_eq(mutations, four * 4 + twelve * 12)
}

///|
test "exact-end declaration success wrong-declaration rejection and appended bytes" {
  // Contract: ensure_complete_with_zero_tail accepts exact end (rem=0) for any
  // valid declared amount. Decode the original unpadded buffer for every fixture.
  // Exact fixtures: ensure_complete_with_zero_tail(4) succeeds.
  // Tail-bearing fixtures: mismatched declaration yields trailing_data.
  // All 56 fixtures: one appended byte yields trailing_data under the original declaration.
  let mut exact_end_declared_successes = 0
  let mut wrong_declaration_rejections = 0
  let mut appended = 0
  for f in cdr_corpus_fixtures {
    let base = ca_materialize(f)
    let r_decl = ca_open_default(base)
    ignore(decode_case(r_decl, f.case_id))
    assert_eq(r_decl.position(), f.logical_byte_length)
    if f.zero_tail_bytes == 0 {
      match r_decl.ensure_complete_with_zero_tail(4) {
        Ok(_) => ()
        Err(e) => ca_abort(f.id + " exact-end declaration 4", e)
      }
      assert_eq(r_decl.remaining(), 0)
      assert_eq(r_decl.position(), f.logical_byte_length)
      exact_end_declared_successes = exact_end_declared_successes + 1
    } else {
      let wrong_decl = ca_wrong_tail(f.zero_tail_bytes)
      match r_decl.ensure_complete_with_zero_tail(wrong_decl) {
        Ok(_) => abort(f.id + " accepted mismatched declaration")
        Err(e) => {
          assert_eq(e.code, CODE_TRAILING_DATA)
          assert_eq(e.offset, f.logical_byte_length)
          assert_eq(e.remaining, f.zero_tail_bytes)
        }
      }
      assert_eq(r_decl.position(), f.logical_byte_length)
      wrong_declaration_rejections = wrong_declaration_rejections + 1
    }
    let with_extra = ca_clone_with_append(base, b'\xaa')
    let r_app = ca_open_default(with_extra)
    ignore(decode_case(r_app, f.case_id))
    match r_app.ensure_complete_with_zero_tail(f.zero_tail_bytes) {
      Ok(_) => abort(f.id + " accepted appended byte")
      Err(e) => {
        assert_eq(e.code, CODE_TRAILING_DATA)
        assert_eq(e.offset, f.logical_byte_length)
      }
    }
    assert_eq(r_app.position(), f.logical_byte_length)
    appended = appended + 1
  }
  assert_eq(exact_end_declared_successes, CA_EXACT_END_DECLARED_SUCCESSES)
  assert_eq(wrong_declaration_rejections, CA_WRONG_DECLARATION_REJECTIONS)
  assert_eq(
    exact_end_declared_successes + wrong_declaration_rejections,
    CA_FIXTURE_TOTAL,
  )
  assert_eq(appended, CA_FIXTURE_TOTAL)
}

///|
test "stream resource bound open succeeds at length and rejects one byte below" {
  let mut ok_n = 0
  let mut reject_n = 0
  for f in cdr_corpus_fixtures {
    let arr = ca_materialize(f)
    let view = ca_bytes(arr)[:]
    // Temporary budget must stay within max_stream_bytes (CdrLimits contract).
    let limits_ok = match
      CdrLimits::new(f.byte_length, DEFAULT_MAX_NESTING_DEPTH, f.byte_length) {
      Ok(l) => l
      Err(e) => {
        ca_abort(f.id + " limits exact", e)
        CdrLimits::defaults()
      }
    }
    match CdrReader::open(view, limits_ok) {
      Ok(r) => {
        ignore(decode_case(r, f.case_id))
        ok_n = ok_n + 1
      }
      Err(e) => ca_abort(f.id + " open exact stream", e)
    }
    let below = f.byte_length - 1
    assert_eq(below >= MIN_MAX_STREAM_BYTES, true)
    let limits_lo = match
      CdrLimits::new(below, DEFAULT_MAX_NESTING_DEPTH, below) {
      Ok(l) => l
      Err(e) => {
        ca_abort(f.id + " limits below", e)
        CdrLimits::defaults()
      }
    }
    match CdrReader::open(view, limits_lo) {
      Ok(_) => abort(f.id + " open accepted undersized stream limit")
      Err(e) => {
        assert_eq(e.code, CODE_BOUNDS_EXCEEDED)
        assert_eq(e.offset, 0)
        assert_eq(e.needed, f.byte_length)
        assert_eq(e.remaining, below)
      }
    }
    reject_n = reject_n + 1
  }
  assert_eq(ok_n, CA_FIXTURE_TOTAL)
  assert_eq(reject_n, CA_FIXTURE_TOTAL)
}

///|
test "PointCloud2 borrowed data under small owned-temporary budget" {
  // Field name "intensity" is 9 UTF-8 payload bytes (owned decode under temp).
  // The 96-byte point payload is a borrowed BytesView and stays outside that budget.
  let f = cdr_fx_find("H-CY-point_cloud2")
  let arr = ca_materialize(f)
  let input = ca_bytes(arr)
  let temp_budget = 18
  assert_eq(temp_budget < 96, true)
  assert_eq(temp_budget >= 9, true)
  let limits = match CdrLimits::new(f.byte_length, 2, temp_budget) {
    Ok(l) => l
    Err(e) => {
      ca_abort("pc2 limits", e)
      CdrLimits::defaults()
    }
  }
  let r = match CdrReader::open(input[:], limits) {
    Ok(reader) => reader
    Err(e) => {
      ca_abort("pc2 open", e)
      ca_open_default(arr)
    }
  }
  let value = decode_case(r, f.case_id)
  assert_expected_semantics(value, f.case_id)
  match value {
    PointCloud2(cloud) => {
      assert_eq(cloud.data.length(), 96)
      assert_eq(cloud.data.data().length(), input.length())
      assert_eq(physical_equal(cloud.data.data(), input), true)
    }
    _ => abort("expected PointCloud2 value")
  }
  match r.ensure_complete_with_zero_tail(f.zero_tail_bytes) {
    Ok(_) => ()
    Err(e) => ca_abort("pc2 complete", e)
  }
  // Writer capacity covers the exact logical stream (header + body).
  let w_limits = match
    CdrLimits::new(f.logical_byte_length, 2, f.logical_byte_length) {
    Ok(l) => l
    Err(e) => {
      ca_abort("pc2 writer limits", e)
      CdrLimits::defaults()
    }
  }
  let w = match CdrWriter::new(CdrEndian::Little, w_limits) {
    Ok(writer) => writer
    Err(e) => {
      ca_abort("pc2 writer", e)
      match CdrWriter::new_default(CdrEndian::Little) {
        Ok(writer) => writer
        Err(_) => abort("unreachable writer")
      }
    }
  }
  encode_case(w, value)
  let out = w.to_bytes()
  assert_eq(out.length(), f.logical_byte_length)
  let mut i = 0
  while i < f.logical_byte_length {
    assert_eq(out[i], arr[i])
    i = i + 1
  }
}

///|
test "corpus framing bridge for little and big endian encapsulation faults" {
  // Detailed framing coverage lives in reader_wbtest; this gate bridges both endians.
  let mut n = 0
  while n < 4 {
    let arr : Array[Byte] = []
    let mut i = 0
    while i < n {
      arr.push(b'\x00')
      i = i + 1
    }
    match CdrReader::open_default(ca_bytes(arr)[:]) {
      Ok(_) => abort("short header accepted")
      Err(e) => {
        assert_eq(e.code, CODE_INVALID_ENCAPSULATION)
        assert_eq(e.offset, 0)
        assert_eq(e.needed, 4)
        assert_eq(e.remaining, n)
      }
    }
    n = n + 1
  }
  // Unsupported representation: non-zero high byte with LE-looking low byte.
  match CdrReader::open_default(b"\x01\x01\x00\x00"[:]) {
    Ok(_) => abort("unsupported LE-like representation accepted")
    Err(e) => {
      assert_eq(e.code, CODE_UNSUPPORTED_REPRESENTATION)
      assert_eq(e.offset, 0)
    }
  }
  match CdrReader::open_default(b"\x01\x00\x00\x00"[:]) {
    Ok(_) => abort("unsupported BE-like representation accepted")
    Err(e) => {
      assert_eq(e.code, CODE_UNSUPPORTED_REPRESENTATION)
      assert_eq(e.offset, 0)
    }
  }
  // Canonical little and big encapsulation headers open successfully.
  match CdrReader::open_default(b"\x00\x01\x00\x00"[:]) {
    Ok(r) => assert_eq(r.little_endian(), true)
    Err(e) => ca_abort("LE header", e)
  }
  match CdrReader::open_default(b"\x00\x00\x00\x00"[:]) {
    Ok(r) => assert_eq(r.little_endian(), false)
    Err(e) => ca_abort("BE header", e)
  }
}
