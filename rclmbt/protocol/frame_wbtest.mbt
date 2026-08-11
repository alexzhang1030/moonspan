///|
fn expect_frame_err(
  bytes : BytesView,
  options : FrameOptions?,
  code : Int,
  name : String,
  reason : String,
  offset : Int,
  plane : String,
  step : Int,
) -> Unit raise {
  match parse_frame(bytes, options) {
    Ok(_) => abort("expected frame error")
    Err(e) => {
      assert_eq(e.code, code)
      assert_eq(e.name, name)
      assert_eq(e.reason, reason)
      assert_eq(e.offset, offset)
      assert_eq(e.plane, plane)
      assert_eq(e.step, step)
    }
  }
}

///|
fn options_from_context(ctx : FrameDecoderContext) -> FrameOptions {
  {
    selected_version: ctx.selected_version,
    experimental_opcodes_enabled: ctx.experimental_opcodes_enabled,
    available_clock_ids: ctx.available_clock_ids,
  }
}

///|
fn materialize_segment_recipe(recipe : RecipeDescriptor) -> Bytes {
  let payload_len = recipe.length
  let total = FRAME_HEADER_LENGTH + payload_len
  let pattern = decode_hex(recipe.pattern_hex)
  let pat_len = pattern.length()
  let opcode = recipe.opcode
  let channel = recipe.channel_id
  let sequence = recipe.sequence
  let priority = recipe.priority
  let clock_id = recipe.clock_id
  Bytes::makei(total, fn(i) {
    if i == 0 {
      b'\x00'
    } else if i == 1 {
      opcode.to_byte()
    } else if i >= 4 && i < 8 {
      let shift = (7 - i) * 8
      ((channel >> shift) & 0xff).to_byte()
    } else if i >= 8 && i < 16 {
      let shift = (15 - i) * 8
      ((sequence >> shift) & 0xff).to_byte()
    } else if i >= 24 && i < 28 {
      let shift = (27 - i) * 8
      ((payload_len >> shift) & 0xff).to_byte()
    } else if i == 30 {
      priority.to_byte()
    } else if i == 31 {
      clock_id.to_byte()
    } else if i >= FRAME_HEADER_LENGTH {
      let pi = i - FRAME_HEADER_LENGTH
      pattern[pi % pat_len]
    } else {
      b'\x00'
    }
  })
}

///|
test "valid frame binaries parse with decoder contexts" {
  let mut seen = 0
  for f in bridge_fixtures {
    if f.kind == "frame" && f.corpus == "valid" && f.representation == "binary" {
      match f.body {
        Binary(chunks) => {
          let arr = expand_chunks(chunks)
          let bytes = Bytes::from_array(arr[:])
          assert_eq(bytes.length(), f.byte_length)
          let opts = match f.decoder_context {
            Some(ctx) => Some(options_from_context(ctx))
            None => abort("valid frame missing decoder context")
          }
          match parse_frame(bytes[:], opts) {
            Ok(frame) => {
              assert_eq(frame.version, 0)
              assert_eq(
                frame.payload_len.reinterpret_as_int() +
                frame.extension_len +
                FRAME_HEADER_LENGTH,
                f.byte_length,
              )
              match frame.payload {
                FramePayload::Control(msg) => {
                  assert_eq(frame.opcode, OPCODE_CONTROL_CBOR)
                  assert_eq(msg.kind >= 1 && msg.kind <= 15, true)
                }
                FramePayload::Application(p) =>
                  assert_eq(p.length(), frame.payload_len.reinterpret_as_int())
              }
              seen = seen + 1
            }
            Err(e) => abort(f.id + ": " + e.reason)
          }
        }
        SegmentRecipe(_) => abort("binary body expected")
      }
    }
  }
  assert_eq(seen, VALID_FRAME_BINARY)
}

///|
test "malformed frame oracles match six fields" {
  let mut seen = 0
  for f in bridge_fixtures {
    if f.kind == "frame" && f.corpus == "malformed" {
      match f.body {
        Binary(chunks) => {
          let arr = expand_chunks(chunks)
          let bytes = Bytes::from_array(arr[:])
          assert_eq(bytes.length(), f.byte_length)
          let opts = match f.decoder_context {
            Some(ctx) => Some(options_from_context(ctx))
            None => None
          }
          match f.oracle {
            Some(o) => {
              expect_frame_err(
                bytes[:],
                opts,
                o.code,
                o.name,
                o.reason,
                o.offset,
                o.plane,
                o.step,
              )
              seen = seen + 1
            }
            None => abort("malformed frame missing oracle")
          }
        }
        SegmentRecipe(_) => abort("malformed segment recipe")
      }
    }
  }
  assert_eq(seen, MALFORMED_FRAME)
}

///|
test "segment recipe 64mib materializes with borrowed payload" {
  // Bounded runtime materialization of the exact 64 MiB application frame recipe.
  let mut found = false
  for f in bridge_fixtures {
    if f.id == "frame-app-payload-64mib-recipe" {
      found = true
      assert_eq(f.representation, "segment_recipe")
      assert_eq(
        f.byte_length,
        FRAME_HEADER_LENGTH + FRAME_PAYLOAD_MAX_BYTES.reinterpret_as_int(),
      )
      match f.body {
        SegmentRecipe(recipe) => {
          assert_eq(recipe.length, FRAME_PAYLOAD_MAX_BYTES.reinterpret_as_int())
          assert_eq(recipe.opcode, OPCODE_ROS_SAMPLE)
          assert_eq(recipe.channel_id, 13)
          assert_eq(recipe.pattern_hex, "a55a")
          let bytes = materialize_segment_recipe(recipe)
          assert_eq(bytes.length(), f.byte_length)
          let opts = match f.decoder_context {
            Some(ctx) => Some(options_from_context(ctx))
            None => None
          }
          match parse_frame(bytes[:], opts) {
            Ok(frame) => {
              assert_eq(frame.opcode, OPCODE_ROS_SAMPLE)
              assert_eq(frame.channel_id, 13U)
              assert_eq(frame.sequence, 0UL)
              assert_eq(frame.priority, 2)
              assert_eq(frame.clock_id, 0)
              assert_eq(frame.payload_len, FRAME_PAYLOAD_MAX_BYTES)
              match frame.payload {
                FramePayload::Application(p) => {
                  assert_eq(
                    p.length(),
                    FRAME_PAYLOAD_MAX_BYTES.reinterpret_as_int(),
                  )
                  assert_eq(p[0], b'\xa5')
                  assert_eq(p[1], b'\x5a')
                  assert_eq(p[p.length() - 2], b'\xa5')
                  assert_eq(p[p.length() - 1], b'\x5a')
                  assert_eq(p.start_offset(), FRAME_HEADER_LENGTH)
                  assert_eq(physical_equal(p.data(), bytes), true)
                }
                FramePayload::Control(_) =>
                  abort("application payload expected")
              }
            }
            Err(e) => abort("segment recipe parse failed: " + e.reason)
          }
        }
        Binary(_) => abort("segment recipe body expected")
      }
    }
  }
  assert_eq(found, true)
}

///|
test "header bounds preserve u32 channel u64 sequence and i64 time extrema" {
  // channel_id preserves the u32 maximum from the valid binary fixture.
  let mut channel_ok = false
  let mut sequence_ok = false
  let mut time_min_ok = false
  let mut time_max_ok = false
  for f in bridge_fixtures {
    if f.id == "frame-ros-sample-channel-u32-max" {
      match f.body {
        Binary(chunks) => {
          let bytes = Bytes::from_array(expand_chunks(chunks)[:])
          match parse_frame(bytes[:], None) {
            Ok(frame) => {
              assert_eq(frame.channel_id, 4294967295U)
              channel_ok = true
            }
            Err(e) => abort(e.reason)
          }
        }
        SegmentRecipe(_) => abort("binary expected")
      }
    }
    if f.id == "frame-ros-sample-sequence-u64-max" {
      match f.body {
        Binary(chunks) => {
          let bytes = Bytes::from_array(expand_chunks(chunks)[:])
          match parse_frame(bytes[:], None) {
            Ok(frame) => {
              assert_eq(frame.sequence, 0xffffffffffffffffUL)
              sequence_ok = true
            }
            Err(e) => abort(e.reason)
          }
        }
        SegmentRecipe(_) => abort("binary expected")
      }
    }
    if f.id == "frame-ros-sample-time-i64-min" {
      match f.body {
        Binary(chunks) => {
          let bytes = Bytes::from_array(expand_chunks(chunks)[:])
          match parse_frame(bytes[:], None) {
            Ok(frame) => {
              assert_eq(frame.source_time_ns, -9223372036854775808L)
              time_min_ok = true
            }
            Err(e) => abort(e.reason)
          }
        }
        SegmentRecipe(_) => abort("binary expected")
      }
    }
    if f.id == "frame-ros-sample-time-i64-max" {
      match f.body {
        Binary(chunks) => {
          let bytes = Bytes::from_array(expand_chunks(chunks)[:])
          match parse_frame(bytes[:], None) {
            Ok(frame) => {
              assert_eq(frame.source_time_ns, 9223372036854775807L)
              time_max_ok = true
            }
            Err(e) => abort(e.reason)
          }
        }
        SegmentRecipe(_) => abort("binary expected")
      }
    }
  }
  assert_eq(channel_ok, true)
  assert_eq(sequence_ok, true)
  assert_eq(time_min_ok, true)
  assert_eq(time_max_ok, true)
}

///|
test "experimental opcode 128 parses when enabled" {
  // Experimental opcode 128 is accepted under the experimental_opcodes gate.
  let arr : Array[Byte] = []
  let mut i = 0
  while i < FRAME_HEADER_LENGTH {
    arr.push(b'\x00')
    i = i + 1
  }
  arr[1] = b'\x80'
  // channel_id = 1
  arr[7] = b'\x01'
  arr[30] = b'\x02'
  arr[31] = b'\x00'
  let bytes = Bytes::from_array(arr[:])
  let opts : FrameOptions = {
    selected_version: 0,
    experimental_opcodes_enabled: true,
    available_clock_ids: [0, 1, 2, 3, 4],
  }
  match parse_frame(bytes[:], Some(opts)) {
    Ok(frame) => {
      assert_eq(frame.opcode, 128)
      assert_eq(frame.channel_id, 1U)
      match frame.payload {
        FramePayload::Application(p) => assert_eq(p.length(), 0)
        FramePayload::Control(_) => abort("application payload expected")
      }
    }
    Err(e) => abort(e.reason)
  }
  // Disabled experimental gate rejects opcode 128 at step 5.
  expect_frame_err(
    bytes[:],
    None,
    5,
    "unsupported_opcode",
    "unsupported_opcode",
    1,
    "selected_frame",
    5,
  )
}

///|
test "priority unassigned precedes control priority within step 9" {
  // Step 9 selects unassigned_priority for CONTROL priority 5.
  let arr : Array[Byte] = []
  let mut i = 0
  while i < FRAME_HEADER_LENGTH {
    arr.push(b'\x00')
    i = i + 1
  }
  arr[1] = OPCODE_CONTROL_CBOR.to_byte()
  arr[30] = b'\x05'
  let bytes = Bytes::from_array(arr[:])
  expect_frame_err(
    bytes[:],
    None,
    25,
    "protocol_violation",
    "unassigned_priority",
    30,
    "selected_frame",
    9,
  )
}

///|
test "trace consistency reports exact flag and extension offsets" {
  // A lone TRACE_PRESENT flag reports offset 2.
  let flag_only : Array[Byte] = []
  let mut i = 0
  while i < FRAME_HEADER_LENGTH {
    flag_only.push(b'\x00')
    i = i + 1
  }
  flag_only[1] = OPCODE_ROS_SAMPLE.to_byte()
  flag_only[7] = b'\x01'
  // flags = FLAG_TRACE_PRESENT (0x0004)
  flag_only[3] = b'\x04'
  flag_only[30] = b'\x02'
  let flag_bytes = Bytes::from_array(flag_only[:])
  expect_frame_err(
    flag_bytes[:],
    None,
    25,
    "protocol_violation",
    "trace_consistency",
    2,
    "selected_frame",
    15,
  )

  // A lone TRACE_CONTEXT extension reports extension area offset 32.
  let arr : Array[Byte] = []
  i = 0
  while i < FRAME_HEADER_LENGTH {
    arr.push(b'\x00')
    i = i + 1
  }
  arr[1] = OPCODE_ROS_SAMPLE.to_byte()
  arr[7] = b'\x01'
  // extension_len = 36 (TRACE_CONTEXT TLV padded)
  arr[28] = b'\x00'
  arr[29] = b'\x24'
  arr[30] = b'\x02'
  // TRACE_CONTEXT type 1, flags 0, value_len 32, 32 zero value bytes
  arr.push(b'\x01')
  arr.push(b'\x00')
  arr.push(b'\x00')
  arr.push(b'\x20')
  i = 0
  while i < 32 {
    arr.push(b'\x00')
    i = i + 1
  }
  let ext_bytes = Bytes::from_array(arr[:])
  expect_frame_err(
    ext_bytes[:],
    None,
    25,
    "protocol_violation",
    "trace_consistency",
    32,
    "selected_frame",
    15,
  )
}

///|
test "control decode failures use absolute payload offsets" {
  // A one-byte CBOR unsigned-zero payload fails CONTROL map shape at absolute offset 32.
  let arr : Array[Byte] = []
  let mut i = 0
  while i < FRAME_HEADER_LENGTH {
    arr.push(b'\x00')
    i = i + 1
  }
  arr[1] = OPCODE_CONTROL_CBOR.to_byte()
  // payload_len = 1, body 0x00 (invalid control map)
  arr[27] = b'\x01'
  arr.push(b'\x00')
  let bytes = Bytes::from_array(arr[:])
  expect_frame_err(
    bytes[:],
    None,
    23,
    "invalid_control",
    "invalid_control",
    32,
    "selected_frame",
    16,
  )
}

///|
test "application payload and extension values share input backing storage" {
  // Application payload and assigned extension values borrow the input Bytes.
  let arr : Array[Byte] = []
  let mut i = 0
  while i < FRAME_HEADER_LENGTH {
    arr.push(b'\x00')
    i = i + 1
  }
  arr[1] = OPCODE_ROS_SAMPLE.to_byte()
  arr[7] = b'\x01'
  // payload_len = 4
  arr[27] = b'\x04'
  // extension_len = 20 (OPERATION_ID 4+16)
  arr[28] = b'\x00'
  arr[29] = b'\x14'
  arr[30] = b'\x02'
  // OPERATION_ID type 2, flags 0, value_len 16
  arr.push(b'\x02')
  arr.push(b'\x00')
  arr.push(b'\x00')
  arr.push(b'\x10')
  i = 1
  while i <= 16 {
    arr.push(i.to_byte())
    i = i + 1
  }
  // application payload
  arr.push(b'\xaa')
  arr.push(b'\xbb')
  arr.push(b'\xcc')
  arr.push(b'\xdd')
  let bytes = Bytes::from_array(arr[:])
  match parse_frame(bytes[:], None) {
    Ok(frame) => {
      assert_eq(frame.extensions.length(), 1)
      assert_eq(frame.extensions[0].type_id, 2)
      assert_eq(frame.extensions[0].value.length(), 16)
      assert_eq(
        frame.extensions[0].value.start_offset(),
        FRAME_HEADER_LENGTH + 4,
      )
      assert_eq(physical_equal(frame.extensions[0].value.data(), bytes), true)
      match frame.payload {
        FramePayload::Application(p) => {
          assert_eq(p.length(), 4)
          assert_eq(p[0], b'\xaa')
          assert_eq(p[3], b'\xdd')
          assert_eq(p.start_offset(), FRAME_HEADER_LENGTH + 20)
          assert_eq(physical_equal(p.data(), bytes), true)
        }
        FramePayload::Control(_) => abort("application payload expected")
      }
    }
    Err(e) => abort(e.reason)
  }
}
