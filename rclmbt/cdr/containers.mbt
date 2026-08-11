///|
/// CDR1 sequences, borrowed byte sequences, and nesting tokens (M1-01c3b).
/// Fixed arrays are expressed by composing existing element codecs with a
/// schema-declared count.

///|
/// Immutable nesting-depth token. Carries depth by value so sibling branches
/// keep independent state. Generated codecs pass tokens through nested calls.
pub struct CdrNesting {
  priv depth : Int
}

///|
/// Current nesting depth (0 at the stream root).
pub fn CdrNesting::depth(self : CdrNesting) -> Int {
  self.depth
}

///|
/// Root nesting token at depth 0.
pub fn CdrReader::root_nesting(self : CdrReader) -> CdrNesting {
  ignore(self)
  { depth: 0 }
}

///|
/// Root nesting token at depth 0.
pub fn CdrWriter::root_nesting(self : CdrWriter) -> CdrNesting {
  ignore(self)
  { depth: 0 }
}

///|
/// Enter one nested aggregate under `parent`. Succeeds when the child depth
/// is within `max_nesting_depth`. Leaves cursor and bytes unchanged.
pub fn CdrReader::enter_nested(
  self : CdrReader,
  parent : CdrNesting,
) -> Result[CdrNesting, CdrError] {
  let next = parent.depth + 1
  let max_d = self.limits.max_nesting_depth
  if next > max_d {
    return Err(CdrError::bounds_exceeded(self.offset, next, max_d))
  }
  Ok({ depth: next })
}

///|
/// Enter one nested aggregate under `parent`. Succeeds when the child depth
/// is within `max_nesting_depth`. Leaves position and bytes unchanged.
pub fn CdrWriter::enter_nested(
  self : CdrWriter,
  parent : CdrNesting,
) -> Result[CdrNesting, CdrError] {
  let next = parent.depth + 1
  let max_d = self.limits.max_nesting_depth
  if next > max_d {
    return Err(CdrError::bounds_exceeded(self.position(), next, max_d))
  }
  Ok({ depth: next })
}

// --- Sequence length ---

///|
/// Read an endian-aware aligned `UInt32` sequence element count.
/// Optional `max_elements` is checked first. `max_stream_bytes` is the absolute
/// element-work ceiling before host `Int` conversion. Commits only the count
/// field on success; every fault restores the cursor to field_start.
pub fn CdrReader::read_sequence_length(
  self : CdrReader,
  max_elements? : UInt,
) -> Result[Int, CdrError] {
  let field_start = self.offset
  let rem_at_start = self.remaining()
  let max_stream = self.limits.max_stream_bytes
  let pad = match self.preflight(field_start, 4, 4) {
    Ok(p) => p
    Err(e) => return Err(e)
  }
  let count_pos = field_start + pad
  let b0 = self.bytes[count_pos].to_uint()
  let b1 = self.bytes[count_pos + 1].to_uint()
  let b2 = self.bytes[count_pos + 2].to_uint()
  let b3 = self.bytes[count_pos + 3].to_uint()
  let count_u = if is_little(self.header.endian) {
    (b3 << 24) | (b2 << 16) | (b1 << 8) | b0
  } else {
    (b0 << 24) | (b1 << 16) | (b2 << 8) | b3
  }
  // Type bound first.
  match max_elements {
    Some(bound) =>
      if count_u > bound {
        self.offset = field_start
        return Err(
          CdrError::bounds_exceeded(
            field_start,
            uint_size_field(count_u),
            uint_size_field(bound),
          ),
        )
      }
    None => ()
  }
  // Absolute element-work ceiling (max_stream_bytes) before host Int use.
  let max_stream_u = max_stream.reinterpret_as_uint()
  if count_u > max_stream_u {
    self.offset = field_start
    return Err(
      CdrError::bounds_exceeded(
        field_start,
        uint_size_field(count_u),
        max_stream,
      ),
    )
  }
  // count_u is within max_stream and therefore within host Int for Phase 1.
  let count_i = count_u.reinterpret_as_int()
  self.offset = count_pos + 4
  ignore(rem_at_start)
  Ok(count_i)
}

///|
/// Write an endian-aware aligned `UInt32` sequence element count.
/// Rejects negative `length` as `length_overflow`. Optional bound, stream work
/// ceiling, and capacity are checked before mutation.
pub fn CdrWriter::write_sequence_length(
  self : CdrWriter,
  length : Int,
  max_elements? : UInt,
) -> Result[Unit, CdrError] {
  let field_start = self.buf.length()
  let rem_cap = self.remaining_capacity()
  if length < 0 {
    return Err(CdrError::length_overflow(field_start, 0, rem_cap))
  }
  let length_u = length.reinterpret_as_uint()
  match max_elements {
    Some(bound) =>
      if length_u > bound {
        return Err(
          CdrError::bounds_exceeded(field_start, length, uint_size_field(bound)),
        )
      }
    None => ()
  }
  let max_stream = self.limits.max_stream_bytes
  if length > max_stream {
    return Err(CdrError::bounds_exceeded(field_start, length, max_stream))
  }
  match self.align_and_reserve(4, 4) {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  if is_little(self.endian) {
    self.buf.write_uint_le(length_u)
  } else {
    self.buf.write_uint_be(length_u)
  }
  Ok(())
}

// --- Byte sequence ---

///|
/// Read a CDR sequence of octets as a borrowed zero-copy `BytesView`.
/// One complete field preflight covers pad + count + payload. Type bound,
/// stream work ceiling, arithmetic, and remaining checks run before commit.
/// Uses stream bounds only; `max_temporary_allocation` is left for owned work.
pub fn CdrReader::read_byte_sequence(
  self : CdrReader,
  max_elements? : UInt,
) -> Result[BytesView, CdrError] {
  let field_start = self.offset
  let rem_at_start = self.remaining()
  let max_stream = self.limits.max_stream_bytes
  let pad = match self.preflight(field_start, 4, 4) {
    Ok(p) => p
    Err(e) => return Err(e)
  }
  let count_pos = field_start + pad
  let b0 = self.bytes[count_pos].to_uint()
  let b1 = self.bytes[count_pos + 1].to_uint()
  let b2 = self.bytes[count_pos + 2].to_uint()
  let b3 = self.bytes[count_pos + 3].to_uint()
  let count_u = if is_little(self.header.endian) {
    (b3 << 24) | (b2 << 16) | (b1 << 8) | b0
  } else {
    (b0 << 24) | (b1 << 16) | (b2 << 8) | b3
  }
  match max_elements {
    Some(bound) =>
      if count_u > bound {
        self.offset = field_start
        return Err(
          CdrError::bounds_exceeded(
            field_start,
            uint_size_field(count_u),
            uint_size_field(bound),
          ),
        )
      }
    None => ()
  }
  let max_stream_u = max_stream.reinterpret_as_uint()
  if count_u > max_stream_u {
    self.offset = field_start
    return Err(
      CdrError::bounds_exceeded(
        field_start,
        uint_size_field(count_u),
        max_stream,
      ),
    )
  }
  let count_i = count_u.reinterpret_as_int()
  let header_and_pad = match checked_add_int(pad, 4) {
    None => {
      self.offset = field_start
      return Err(CdrError::length_overflow(field_start, 0, rem_at_start))
    }
    Some(n) => n
  }
  let total_needed = match checked_add_int(header_and_pad, count_i) {
    None => {
      self.offset = field_start
      return Err(CdrError::length_overflow(field_start, 0, rem_at_start))
    }
    Some(n) => n
  }
  if rem_at_start < total_needed {
    self.offset = field_start
    return Err(CdrError::truncated(field_start, total_needed, rem_at_start))
  }
  let data_start = count_pos + 4
  let data_end = data_start + count_i
  self.offset = data_end
  Ok(self.bytes[data_start:data_end])
}

///|
/// Write a CDR sequence of octets. One complete field preflight covers pad +
/// count + payload, then count and bytes emit directly into the owned buffer.
pub fn CdrWriter::write_byte_sequence(
  self : CdrWriter,
  value : BytesView,
  max_elements? : UInt,
) -> Result[Unit, CdrError] {
  let field_start = self.buf.length()
  let rem_cap = self.remaining_capacity()
  let n = value.length()
  let n_u = n.reinterpret_as_uint()
  match max_elements {
    Some(bound) =>
      if n_u > bound {
        return Err(
          CdrError::bounds_exceeded(field_start, n, uint_size_field(bound)),
        )
      }
    None => ()
  }
  let max_stream = self.limits.max_stream_bytes
  if n > max_stream {
    return Err(CdrError::bounds_exceeded(field_start, n, max_stream))
  }
  let body_size = match checked_add_int(4, n) {
    None => return Err(CdrError::length_overflow(field_start, 0, rem_cap))
    Some(s) => s
  }
  match self.align_and_reserve(4, body_size) {
    Ok(_) => ()
    Err(e) => return Err(e)
  }
  if is_little(self.endian) {
    self.buf.write_uint_le(n_u)
  } else {
    self.buf.write_uint_be(n_u)
  }
  self.buf.write_bytes(value)
  Ok(())
}
