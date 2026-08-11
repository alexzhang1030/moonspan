///|
/// M0-03h3 MoonBit Wasm R2WP agreement emitter.
/// Parses embedded agreement jobs through the public protocol API, projects
/// actual records or errors into the h1 outcome schema, and emits one compact
/// JSON envelope between fixed markers.

///|
const FRAME_HEADER_LENGTH : Int = 32

///|
const TEXT_INLINE_MAX_BYTES : Int = 64

///|
const BYTES_INLINE_MAX_BYTES : Int = 32

///|
const HEAD_TAIL_HEX_BYTES : Int = 8

///|
const RECIPE_PAYLOAD_FNV : String = "3a07afcfc8222325"

///|
const RECIPE_PAYLOAD_LENGTH : Int = 67108864

///|
const OUTCOMES_TOTAL : Int = 105

///|
const EMIT_BEGIN : String = "MOONSPAN_R2WP_AGREEMENT_MOONBIT_BEGIN"

///|
const EMIT_END : String = "MOONSPAN_R2WP_AGREEMENT_MOONBIT_END"

// ---------------------------------------------------------------------------
// Hex / digests / materialization
// ---------------------------------------------------------------------------

///|
fn hex_nibble(code : Int) -> Int {
  if code >= 48 && code <= 57 {
    code - 48
  } else if code >= 97 && code <= 102 {
    code - 97 + 10
  } else {
    abort("hex nibble requires [0-9a-f]")
  }
}

///|
fn decode_hex(hex : String) -> Array[Byte] {
  let n = hex.length()
  if n % 2 != 0 {
    abort("hex length requires even count")
  }
  let out : Array[Byte] = []
  let mut i = 0
  while i < n {
    let hi = hex_nibble(hex[i].to_int())
    let lo = hex_nibble(hex[i + 1].to_int())
    out.push(((hi << 4) | lo).to_byte())
    i = i + 2
  }
  out
}

///|
fn expand_chunks(chunks : Array[ByteChunk]) -> Array[Byte] {
  let out : Array[Byte] = []
  for chunk in chunks {
    match chunk {
      Raw(h) => {
        let b = decode_hex(h)
        for x in b {
          out.push(x)
        }
      }
      Rep(h, count) => {
        let pat = decode_hex(h)
        let mut c = 0
        while c < count {
          for x in pat {
            out.push(x)
          }
          c = c + 1
        }
      }
    }
  }
  out
}

///|
fn nibble_char(n : Int) -> Char {
  if n < 10 {
    (48 + n).unsafe_to_char()
  } else {
    (87 + n).unsafe_to_char()
  }
}

///|
fn u64_to_hex16(v : UInt64) -> String {
  let mut out = ""
  let mut i = 0
  while i < 16 {
    let shift = (15 - i) * 4
    let nib = ((v >> shift) & 0xfUL).to_int()
    out = out + nibble_char(nib).to_string()
    i = i + 1
  }
  out
}

///|
fn fnv1a64_hex_bytes(bytes : BytesView) -> String {
  let mut hash : UInt64 = 0xcbf29ce484222325UL
  let prime : UInt64 = 0x100000001b3UL
  let mut i = 0
  let n = bytes.length()
  while i < n {
    hash = (hash ^ bytes[i].to_uint64()) * prime
    i = i + 1
  }
  u64_to_hex16(hash)
}

///|
fn to_hex(bytes : BytesView) -> String {
  let mut out = ""
  let mut i = 0
  let n = bytes.length()
  while i < n {
    let v = bytes[i].to_int()
    out = out + nibble_char((v >> 4) & 0xf).to_string()
    out = out + nibble_char(v & 0xf).to_string()
    i = i + 1
  }
  out
}

///|
fn head_tail_hex(bytes : BytesView) -> (String, String) {
  let n = bytes.length()
  if n == 0 {
    return ("", "")
  }
  let take = if n < HEAD_TAIL_HEX_BYTES { n } else { HEAD_TAIL_HEX_BYTES }
  let head = to_hex(bytes[0:take])
  let tail = if n <= HEAD_TAIL_HEX_BYTES {
    to_hex(bytes)
  } else {
    to_hex(bytes[n - take:n])
  }
  (head, tail)
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
fn options_from_context(ctx : FrameDecoderContext) -> @protocol.FrameOptions {
  @protocol.FrameOptions::new(
    ctx.selected_version,
    ctx.experimental_opcodes_enabled,
    ctx.available_clock_ids,
  )
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

///|
fn j_null() -> Json {
  Json::null()
}

///|
fn j_bool(b : Bool) -> Json {
  Json::boolean(b)
}

///|
fn j_num_int(n : Int) -> Json {
  Json::number(n.to_double())
}

///|
fn j_num_uint(n : UInt) -> Json {
  Json::number(n.to_uint64().to_double())
}

///|
fn j_str(s : String) -> Json {
  Json::string(s)
}

///|
fn j_arr(items : Array[Json]) -> Json {
  Json::array(items)
}

///|
fn j_obj(entries : Array[(String, Json)]) -> Json {
  Json::object(Map(entries))
}

///|
fn text_digest(text : String) -> Json {
  let enc = @utf8.encode(text[:])
  j_obj([
    ("utf8_byte_length", j_num_int(enc.length())),
    ("fnv1a64_hex", j_str(fnv1a64_hex_bytes(enc[:]))),
  ])
}

// ---------------------------------------------------------------------------
// CBOR / record projection
// ---------------------------------------------------------------------------

///|
fn nint_decimal(arg : UInt64) -> String {
  // CborValue::Negative stores the major-type-1 argument; value = -1 - arg.
  if arg == 0xffffffffffffffffUL {
    "-18446744073709551616"
  } else {
    "-" + (arg + 1UL).to_string()
  }
}

///|
fn project_cbor(value : @protocol.CborValue) -> Json {
  match value {
    @protocol.CborValue::Null => j_obj([("t", j_str("null"))])
    @protocol.CborValue::Bool(b) =>
      j_obj([("t", j_str("bool")), ("v", j_bool(b))])
    @protocol.CborValue::Unsigned(n) =>
      j_obj([("t", j_str("uint")), ("v", j_str(n.to_string()))])
    @protocol.CborValue::Negative(arg) =>
      j_obj([("t", j_str("nint")), ("v", j_str(nint_decimal(arg)))])
    @protocol.CborValue::Text(t) => {
      let enc = @utf8.encode(t[:])
      let inline = if enc.length() <= TEXT_INLINE_MAX_BYTES {
        j_str(t)
      } else {
        j_null()
      }
      j_obj([
        ("t", j_str("text")),
        ("utf8_byte_length", j_num_int(enc.length())),
        ("fnv1a64_hex", j_str(fnv1a64_hex_bytes(enc[:]))),
        ("inline", inline),
      ])
    }
    @protocol.CborValue::Bytes(b) => {
      let inline_hex = if b.length() <= BYTES_INLINE_MAX_BYTES {
        j_str(to_hex(b))
      } else {
        j_null()
      }
      j_obj([
        ("t", j_str("bytes")),
        ("byte_length", j_num_int(b.length())),
        ("fnv1a64_hex", j_str(fnv1a64_hex_bytes(b))),
        ("inline_hex", inline_hex),
      ])
    }
    @protocol.CborValue::Array(items) => {
      let out : Array[Json] = []
      for it in items {
        out.push(project_cbor(it))
      }
      j_obj([("t", j_str("array")), ("items", j_arr(out))])
    }
    @protocol.CborValue::Map(entries) => {
      let out : Array[Json] = []
      for e in entries {
        let (k, v) = e
        out.push(
          j_obj([("key", j_str(k.to_string())), ("value", project_cbor(v))]),
        )
      }
      j_obj([("t", j_str("map")), ("entries", j_arr(out))])
    }
  }
}

///|
fn project_transport(tc : @protocol.TransportCapabilities) -> Json {
  let max_dg = match tc.max_datagram_size {
    Some(n) => j_num_uint(n)
    None => j_null()
  }
  j_obj([
    ("webtransport_http3", j_bool(tc.webtransport_http3)),
    ("binary_wss", j_bool(tc.binary_wss)),
    ("max_datagram_size", max_dg),
  ])
}

///|
fn project_buffer(bc : @protocol.BufferCapabilities) -> Json {
  j_obj([
    ("transferable_arraybuffer", j_bool(bc.transferable_arraybuffer)),
    ("shared_arraybuffer", j_bool(bc.shared_arraybuffer)),
  ])
}

///|
fn project_bootstrap(record : @protocol.BootstrapRecord) -> Json {
  match record {
    @protocol.BootstrapRecord::ClientHello(ch) => {
      let wv : Array[Json] = []
      for v in ch.wire_versions {
        wv.push(j_num_int(v))
      }
      let caps : Array[Json] = []
      for c in ch.extension_capabilities {
        caps.push(j_num_int(c))
      }
      let rl = ch.requested_limits
      j_obj([
        ("variant", j_str("client_hello")),
        ("wire_versions", j_arr(wv)),
        ("transport_capabilities", project_transport(ch.transport_capabilities)),
        ("buffer_capabilities", project_buffer(ch.buffer_capabilities)),
        (
          "requested_limits",
          j_obj([
            (
              "max_channels",
              match rl.max_channels {
                Some(n) => j_num_uint(n)
                None => j_null()
              },
            ),
            (
              "max_session_bytes",
              match rl.max_session_bytes {
                Some(n) => j_str(n.to_string())
                None => j_null()
              },
            ),
            (
              "max_message_bytes",
              match rl.max_message_bytes {
                Some(n) => j_num_uint(n)
                None => j_null()
              },
            ),
            (
              "max_control_payload_bytes",
              match rl.max_control_payload_bytes {
                Some(n) => j_num_uint(n)
                None => j_null()
              },
            ),
          ]),
        ),
        ("extension_capabilities", j_arr(caps)),
      ])
    }
    @protocol.BootstrapRecord::ServerHello(sh) => {
      let caps : Array[Json] = []
      for c in sh.extension_capabilities {
        caps.push(j_num_int(c))
      }
      let el = sh.effective_limits
      j_obj([
        ("variant", j_str("server_hello")),
        ("selected_wire_version", j_num_int(sh.selected_wire_version)),
        ("transport_capabilities", project_transport(sh.transport_capabilities)),
        ("buffer_capabilities", project_buffer(sh.buffer_capabilities)),
        (
          "effective_limits",
          j_obj([
            ("max_channels", j_num_uint(el.max_channels)),
            ("max_session_bytes", j_str(el.max_session_bytes.to_string())),
            ("max_message_bytes", j_num_uint(el.max_message_bytes)),
            (
              "max_control_payload_bytes",
              j_num_uint(el.max_control_payload_bytes),
            ),
          ]),
        ),
        ("extension_capabilities", j_arr(caps)),
      ])
    }
    @protocol.BootstrapRecord::BootstrapError(be) => {
      let message = match be.message {
        Some(t) => text_digest(t)
        None => j_null()
      }
      let detail = match be.detail {
        Some(t) => text_digest(t)
        None => j_null()
      }
      j_obj([
        ("variant", j_str("bootstrap_error")),
        ("code", j_num_int(be.code)),
        ("message", message),
        ("detail", detail),
      ])
    }
  }
}

///|
fn project_frame(frame : @protocol.DecodedFrame, raw : BytesView) -> Json {
  let payload_start = FRAME_HEADER_LENGTH + frame.extension_len
  let payload_end = payload_start + frame.payload_len.reinterpret_as_int()
  if payload_end > raw.length() {
    abort("frame payload range requires bytes within input length")
  }
  let raw_payload = raw[payload_start:payload_end]

  let extensions : Array[Json] = []
  for e in frame.extensions {
    extensions.push(
      j_obj([
        ("type_id", j_num_int(e.type_id)),
        ("critical", j_bool(e.critical)),
        ("value_len", j_num_int(e.value.length())),
        ("value_fnv1a64_hex", j_str(fnv1a64_hex_bytes(e.value))),
      ]),
    )
  }

  let payload = match frame.payload {
    @protocol.FramePayload::Application(body) => {
      let (head, tail) = head_tail_hex(body)
      j_obj([
        ("form", j_str("application")),
        ("payload_len", j_num_int(body.length())),
        ("payload_fnv1a64_hex", j_str(fnv1a64_hex_bytes(body))),
        ("payload_head_hex", j_str(head)),
        ("payload_tail_hex", j_str(tail)),
      ])
    }
    @protocol.FramePayload::Control(msg) => {
      let keys : Array[Json] = []
      let entries : Array[Json] = []
      for field in msg.fields {
        let (k, v) = field
        keys.push(Json::number(k.to_double()))
        entries.push(
          j_obj([("key", j_str(k.to_string())), ("value", project_cbor(v))]),
        )
      }
      j_obj([
        ("form", j_str("control")),
        ("payload_len", j_num_int(raw_payload.length())),
        ("payload_fnv1a64_hex", j_str(fnv1a64_hex_bytes(raw_payload))),
        ("control_kind", j_num_int(msg.kind)),
        ("control_field_keys", j_arr(keys)),
        (
          "control_fields",
          j_obj([("t", j_str("map")), ("entries", j_arr(entries))]),
        ),
      ])
    }
  }

  j_obj([
    ("version", j_num_int(frame.version)),
    ("opcode", j_num_int(frame.opcode)),
    ("flags", j_num_int(frame.flags)),
    ("channel_id", j_num_uint(frame.channel_id)),
    ("sequence", j_str(frame.sequence.to_string())),
    ("source_time_ns", j_str(frame.source_time_ns.to_string())),
    ("payload_len", j_num_uint(frame.payload_len)),
    ("extension_len", j_num_int(frame.extension_len)),
    ("priority", j_num_int(frame.priority)),
    ("clock_id", j_num_int(frame.clock_id)),
    ("extensions", j_arr(extensions)),
    ("payload", payload),
  ])
}

///|
fn project_error(err : @protocol.ProtocolError) -> Json {
  j_obj([
    ("code", j_num_int(err.code)),
    ("name", j_str(err.name)),
    ("reason", j_str(err.reason)),
    ("offset", j_num_int(err.offset)),
    ("plane", j_str(err.plane)),
    ("step", j_num_int(err.step)),
  ])
}

///|
fn outcome_json(
  job : AgreeJob,
  status : String,
  record : Json,
  error : Json,
) -> Json {
  j_obj([
    ("id", j_str(job.id)),
    ("corpus", j_str(job.corpus)),
    ("source_id", j_str(job.source_id)),
    ("parser_kind", j_str(job.parser_kind)),
    ("representation", j_str(job.representation)),
    ("byte_length", j_num_int(job.byte_length)),
    ("input_sha256", j_str(job.input_sha256)),
    ("status", j_str(status)),
    ("record", record),
    ("error", error),
  ])
}

// ---------------------------------------------------------------------------
// Job execution
// ---------------------------------------------------------------------------

///|
fn materialize_job_bytes(job : AgreeJob) -> Bytes {
  match job.body {
    Binary(chunks) => {
      let arr = expand_chunks(chunks)
      if arr.length() != job.byte_length {
        abort(job.id + ": expanded length requires manifest byte_length")
      }
      Bytes::from_array(arr[:])
    }
    SegmentRecipe(recipe) => {
      let bytes = materialize_segment_recipe(recipe)
      if bytes.length() != job.byte_length {
        abort(job.id + ": recipe length requires manifest byte_length")
      }
      bytes
    }
  }
}

///|
fn run_job(job : AgreeJob) -> Json {
  let bytes = materialize_job_bytes(job)
  let view = bytes[:]
  if job.expect_success {
    if job.parser_kind == "bootstrap" {
      match @protocol.parse_bootstrap(view) {
        Ok(rec) =>
          outcome_json(job, "success", project_bootstrap(rec), j_null())
        Err(e) =>
          abort(job.id + ": requires successful bootstrap parse: " + e.name)
      }
    } else if job.parser_kind == "frame" {
      let opts = match job.decoder_context {
        Some(ctx) => Some(options_from_context(ctx))
        None => None
      }
      match @protocol.parse_frame(view, opts) {
        Ok(frame) => {
          let projected = project_frame(frame, view)
          if job.source_id == "frame-app-payload-64mib-recipe" {
            // Pin 64 MiB application payload digest from the actual parse.
            match frame.payload {
              @protocol.FramePayload::Application(body) => {
                let dig = fnv1a64_hex_bytes(body)
                if dig != RECIPE_PAYLOAD_FNV {
                  abort(job.id + ": requires payload FNV " + RECIPE_PAYLOAD_FNV)
                }
                if body.length() != RECIPE_PAYLOAD_LENGTH {
                  abort(job.id + ": requires payload length 67108864")
                }
              }
              _ => abort(job.id + ": requires application payload")
            }
          }
          outcome_json(job, "success", projected, j_null())
        }
        Err(e) => abort(job.id + ": requires successful frame parse: " + e.name)
      }
    } else {
      abort(job.id + ": requires parser_kind bootstrap or frame")
    }
  } else {
    let oracle = match job.oracle {
      Some(o) => o
      None => abort(job.id + ": malformed job requires oracle")
    }
    let err = if job.parser_kind == "bootstrap" {
      match @protocol.parse_bootstrap(view) {
        Ok(_) => abort(job.id + ": requires bootstrap parse failure")
        Err(e) => e
      }
    } else if job.parser_kind == "frame" {
      let opts = match job.decoder_context {
        Some(ctx) => Some(options_from_context(ctx))
        None => Some(@protocol.FrameOptions::default())
      }
      match @protocol.parse_frame(view, opts) {
        Ok(_) => abort(job.id + ": requires frame parse failure")
        Err(e) => e
      }
    } else {
      abort(job.id + ": requires parser_kind bootstrap or frame")
    }
    if err.code != oracle.code {
      abort(job.id + ": error.code requires oracle equality")
    }
    if err.name != oracle.name {
      abort(job.id + ": error.name requires oracle equality")
    }
    if err.reason != oracle.reason {
      abort(job.id + ": error.reason requires oracle equality")
    }
    if err.offset != oracle.offset {
      abort(job.id + ": error.offset requires oracle equality")
    }
    if err.plane != oracle.plane {
      abort(job.id + ": error.plane requires oracle equality")
    }
    if err.step != oracle.step {
      abort(job.id + ": error.step requires oracle equality")
    }
    outcome_json(job, "error", j_null(), project_error(err))
  }
}

///|
/// Code-unit strict less-than for agreement ids (ASCII bytewise order).
fn id_lt(a : String, b : String) -> Bool {
  let na = a.length()
  let nb = b.length()
  let n = if na < nb { na } else { nb }
  let mut i = 0
  while i < n {
    let ca = a[i].to_int()
    let cb = b[i].to_int()
    if ca < cb {
      return true
    }
    if ca > cb {
      return false
    }
    i = i + 1
  }
  na < nb
}

///|
fn main {
  if agree_jobs.length() != OUTCOMES_TOTAL {
    abort("agreement jobs require total 101")
  }
  let outcomes : Array[Json] = []
  let mut i = 0
  while i < agree_jobs.length() {
    if i > 0 {
      let prev = agree_jobs[i - 1].id
      let cur = agree_jobs[i].id
      if !id_lt(prev, cur) {
        abort("agreement job ids require strict ascending unique order")
      }
    }
    let job = agree_jobs[i]
    let outcome = run_job(job)
    outcomes.push(outcome)
    i = i + 1
  }
  let envelope = j_obj([
    ("schema_version", j_num_int(1)),
    ("protocol", j_str("r2wp-v0")),
    ("implementation", j_str("moonbit")),
    ("outcomes", j_arr(outcomes)),
  ])
  let compact = envelope.stringify()
  println(EMIT_BEGIN)
  println(compact)
  println(EMIT_END)
}
