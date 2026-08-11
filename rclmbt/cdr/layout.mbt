///|
/// Shared CDR1 body-relative layout helpers for reader and writer.

///|
/// Padding bytes required so `((offset - BODY_ORIGIN) % align) == 0`.
fn padding_for(offset : Int, align : Int) -> Int {
  if align <= 1 {
    return 0
  }
  let body_rel = offset - BODY_ORIGIN
  let rem = body_rel % align
  if rem == 0 {
    0
  } else {
    align - rem
  }
}

///|
fn is_little(endian : CdrEndian) -> Bool {
  match endian {
    CdrEndian::Little => true
    CdrEndian::Big => false
  }
}

///|
/// Representation identifier for the given endianness.
fn representation_of(endian : CdrEndian) -> Int {
  match endian {
    CdrEndian::Little => REPRESENTATION_CDR_LE
    CdrEndian::Big => REPRESENTATION_CDR_BE
  }
}

///|
/// Effective writer capacity: min(stream, temporary) over the full stream
/// including the 4-byte encapsulation header.
fn writer_capacity(limits : CdrLimits) -> Int {
  if limits.max_stream_bytes < limits.max_temporary_allocation {
    limits.max_stream_bytes
  } else {
    limits.max_temporary_allocation
  }
}

///|
/// Checked `a + b` into host `Int`. Overflow yields `None`.
fn checked_add_int(a : Int, b : Int) -> Int? {
  if b < 0 {
    return None
  }
  if a > 2147483647 - b {
    return None
  }
  Some(a + b)
}
