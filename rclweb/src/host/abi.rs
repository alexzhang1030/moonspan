//! Hand-written wasm32 poll ABI.
//!
//! Unsafe is confined to this module: pointer arguments from the host and the
//! process-wide engine table. The rest of `rclweb` stays under crate-level
//! `deny(unsafe_code)`.

#![allow(unsafe_code)]

use crate::engine::{ClientEngine, HostEvent, PollOutcome};
use crate::host::batch::{BatchError, decode_host_batch, encode_poll_result_into};
use std::alloc::{Layout, alloc, dealloc};
use std::cell::RefCell;
use std::collections::HashMap;

thread_local! {
    static ENGINES: RefCell<HashMap<u32, ClientEngine>> = RefCell::new(HashMap::new());
    static NEXT_HANDLE: RefCell<u32> = const { RefCell::new(1) };
    /// Outbound / result scratch retained until the next poll or free.
    static SCRATCH: RefCell<HashMap<u32, Vec<u8>>> = RefCell::new(HashMap::new());
}

fn map_batch_err(err: BatchError) -> i32 {
  match err {
    BatchError::Truncated => -1,
    BatchError::BadMagic => -2,
    BatchError::BadVersion => -3,
    BatchError::BadKind => -4,
    BatchError::Limit => -5,
  }
}

fn alloc_layout(len: usize) -> Option<Layout> {
  Layout::array::<u8>(len).ok()
}

/// Allocate `len` bytes in wasm linear memory. Returns null on failure.
///
/// The region is **uninitialized**. The host (or a wasm writer) must fill it
/// before any read. Zeroing here was a full memset before the required ingest
/// copy (header prefix on the sample path; full frame for control/bootstrap).
#[unsafe(no_mangle)]
pub extern "C" fn rclweb_alloc(len: u32) -> *mut u8 {
  if len == 0 {
    return std::ptr::null_mut();
  }
  let Some(layout) = alloc_layout(len as usize) else {
    return std::ptr::null_mut();
  };
  // SAFETY: `len > 0` so the layout is non-zero. Matching [`rclweb_free`] and
  // `Vec::from_raw_parts` in [`rclweb_poll`] use this same layout.
  unsafe { alloc(layout) }
}

/// Free a region previously returned by [`rclweb_alloc`].
///
/// # Safety
/// `ptr` must be a pointer from [`rclweb_alloc`] with the same `len`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rclweb_free(ptr: *mut u8, len: u32) {
  if ptr.is_null() || len == 0 {
    return;
  }
  let Some(layout) = alloc_layout(len as usize) else {
    return;
  };
  // SAFETY: host contract — ptr/len pair from rclweb_alloc with the same layout.
  unsafe { dealloc(ptr, layout) };
}

/// Create a client engine. Returns a non-zero handle, or 0 on failure.
#[unsafe(no_mangle)]
pub extern "C" fn rclweb_engine_new() -> u32 {
  ENGINES.with(|engines| {
    NEXT_HANDLE.with(|next| {
      let handle = *next.borrow();
      *next.borrow_mut() = handle.saturating_add(1);
      engines.borrow_mut().insert(handle, ClientEngine::new());
      handle
    })
  })
}

/// Destroy an engine and drop retained scratch.
#[unsafe(no_mangle)]
pub extern "C" fn rclweb_engine_free(handle: u32) {
  ENGINES.with(|engines| {
    engines.borrow_mut().remove(&handle);
  });
  SCRATCH.with(|scratch| {
    scratch.borrow_mut().remove(&handle);
  });
}

/// Poll the engine.
///
/// `batch_ptr`/`batch_len` describe a host event batch in linear memory.
/// On success, writes a result blob into scratch and returns its byte length
/// (>= 0). Read it via [`rclweb_last_result_ptr`] / [`rclweb_last_result_len`].
/// Negative values are batch decode error codes.
///
/// Sample payload views in the result point into engine-retained slabs that
/// stay valid until the host issues `ReleaseLease` for every lease on that
/// slab (ADR 0004 lease model).
///
/// # Safety
/// `batch_ptr` must point at `batch_len` readable bytes in this module's memory.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rclweb_poll(handle: u32, batch_ptr: *const u8, batch_len: u32) -> i32 {
  if batch_ptr.is_null() && batch_len != 0 {
    return -1;
  }
  // SAFETY: host provides a valid batch region for this call.
  let batch = unsafe { std::slice::from_raw_parts(batch_ptr, batch_len as usize) };

  let events = match decode_host_batch(batch, |_buffer_id, ptr, len| {
    if len == 0 {
      return Ok(Vec::new());
    }
    if ptr == 0 {
      return Err(BatchError::Truncated);
    }
    // SAFETY: host allocated the WS payload with rclweb_alloc and filled it.
    // Take ownership so the retain path moves those wasm bytes without a
    // second deep copy. Application samples copy only the R2WP prefix
    // (ADR 0017) via `rclweb_poll_ws`.
    let vec = unsafe { Vec::from_raw_parts(ptr as *mut u8, len as usize, len as usize) };
    Ok(vec)
  }) {
    Ok(events) => events,
    Err(err) => return map_batch_err(err),
  };

  run_poll(handle, events)
}

/// Ingest one external-ptr WebSocket frame without a host-batch header.
///
/// Same ownership as [`rclweb_poll`]: `ptr`/`len` is a [`rclweb_alloc`] region
/// the engine takes (including when this returns an error other than -1).
/// Skips encoding a 28-byte batch on the sample hot path. The host may pass
/// only the R2WP header+extension prefix; the engine infers the declared
/// frame size from the header (ADR 0017).
///
/// # Safety
/// `ptr` must be a [`rclweb_alloc`] region of `len` bytes the host has filled,
/// or null when `len` is 0.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rclweb_poll_ws(
  handle: u32,
  buffer_id: u32,
  ptr: *mut u8,
  len: u32,
) -> i32 {
  let bytes = if len == 0 {
    Vec::new()
  } else {
    if ptr.is_null() {
      return -1;
    }
    // SAFETY: host allocated and filled this region; we take ownership.
    unsafe { Vec::from_raw_parts(ptr, len as usize, len as usize) }
  };
  ENGINES.with(|engines| {
    let mut map = engines.borrow_mut();
    let Some(engine) = map.get_mut(&handle) else {
      return -6;
    };
    let outcome = engine.poll_ws_bytes(buffer_id, bytes);
    encode_outcome(handle, engine, &outcome)
  })
}

fn run_poll(handle: u32, events: Vec<HostEvent>) -> i32 {
  ENGINES.with(|engines| {
    let mut map = engines.borrow_mut();
    let Some(engine) = map.get_mut(&handle) else {
      return -6;
    };
    let outcome = engine.poll(events);
    encode_outcome(handle, engine, &outcome)
  })
}

fn encode_outcome(handle: u32, engine: &ClientEngine, outcome: &PollOutcome) -> i32 {
  SCRATCH.with(|scratch| {
    let mut smap = scratch.borrow_mut();
    let buf = smap.entry(handle).or_insert_with(|| Vec::with_capacity(256));
    buf.clear();
    encode_poll_result_into(buf, outcome, |lease_id| engine.lease_payload_abi(lease_id));
    let len = buf.len();
    if len > i32::MAX as usize { -5 } else { len as i32 }
  })
}

/// Pointer to the last poll result for `handle`, or null.
#[unsafe(no_mangle)]
pub extern "C" fn rclweb_last_result_ptr(handle: u32) -> *const u8 {
  SCRATCH.with(|scratch| scratch.borrow().get(&handle).map_or(std::ptr::null(), |v| v.as_ptr()))
}

/// Length of the last poll result for `handle`.
#[unsafe(no_mangle)]
pub extern "C" fn rclweb_last_result_len(handle: u32) -> u32 {
  SCRATCH.with(|scratch| scratch.borrow().get(&handle).map_or(0, |v| v.len() as u32))
}

/// Write seven little-endian `u64` telemetry fields into `out_ptr` (56 bytes):
/// copies_into_engine, bytes_copied_into_engine, poll_turns, poll_nanos_total,
/// samples_emitted, leases_released, samples_sent. Returns 0 on success, -6 if
/// unknown handle.
///
/// # Safety
/// `out_ptr` must point at at least 56 writable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rclweb_telemetry(handle: u32, out_ptr: *mut u8) -> i32 {
  if out_ptr.is_null() {
    return -1;
  }
  let Some(snapshot) =
    ENGINES.with(|engines| engines.borrow().get(&handle).map(|engine| engine.telemetry()))
  else {
    return -6;
  };
  let fields = [
    snapshot.copies_into_engine,
    snapshot.bytes_copied_into_engine,
    snapshot.poll_turns,
    snapshot.poll_nanos_total,
    snapshot.samples_emitted,
    snapshot.leases_released,
    snapshot.samples_sent,
  ];
  // SAFETY: host provides a 56-byte writable region.
  let out = unsafe { std::slice::from_raw_parts_mut(out_ptr, 56) };
  for (i, value) in fields.iter().enumerate() {
    out[i * 8..(i + 1) * 8].copy_from_slice(&value.to_le_bytes());
  }
  0
}

/// Decode PointCloud2 metadata from a CDR payload in wasm linear memory.
///
/// Writes a little-endian meta record to `out_ptr` (`out_len` bytes):
/// `height:u32, width:u32, point_step:u32, row_step:u32, data_offset:u32,
/// data_len:u32, is_bigendian:u8, is_dense:u8, pad:u16, field_count:u32,
/// stamp_sec:i32, stamp_nanosec:u32, frame_id_len:u16, frame_id...,
/// then fields: name_len:u16, name..., offset:u32, datatype:u8, count:u32`.
/// `data_offset` is relative to `payload_ptr`. Returns bytes written (>= 42)
/// on success, negative on fault. Does not materialize or iterate the point
/// payload (R2-02). If `out_len` is too small, returns -4 and, when
/// `out_len >= 4`, writes the needed size as `u32` at `out_ptr`.
///
/// # Safety
/// `payload_ptr` must address `payload_len` readable bytes; `out_ptr` must
/// address `out_len` writable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rclweb_point_cloud2_meta(
  payload_ptr: *const u8,
  payload_len: u32,
  out_ptr: *mut u8,
  out_len: u32,
) -> i32 {
  if payload_ptr.is_null() || out_ptr.is_null() {
    return -1;
  }
  // SAFETY: host provides a readable CDR payload region.
  let payload = unsafe { std::slice::from_raw_parts(payload_ptr, payload_len as usize) };
  let view = match crate::cdr::decode_point_cloud2_le(payload) {
    Ok(v) => v,
    Err(_) => return -2,
  };
  let data_offset = (view.data.as_ptr() as usize).saturating_sub(payload.as_ptr() as usize);
  if data_offset > u32::MAX as usize || view.data.len() > u32::MAX as usize {
    return -3;
  }
  let need = crate::cdr::point_cloud2_host_meta_len(&view);
  if (out_len as usize) < need {
    if out_len >= 4 {
      // SAFETY: host provides at least 4 writable bytes.
      let out = unsafe { std::slice::from_raw_parts_mut(out_ptr, out_len as usize) };
      out[..4].copy_from_slice(&(need as u32).to_le_bytes());
    }
    return -4;
  }
  // SAFETY: host provides `out_len` writable bytes, already checked >= need.
  let out = unsafe { std::slice::from_raw_parts_mut(out_ptr, out_len as usize) };
  match crate::cdr::write_point_cloud2_host_meta(&view, data_offset as u32, out) {
    Some(n) => i32::try_from(n).unwrap_or(-3),
    None => -3,
  }
}

/// Decode a Phase 1 generated message from CDR into the packed host layout.
///
/// `type_ptr`/`type_len` is the ROS type name. Returns bytes written, or
/// negative on fault. `-4` plus a `u32` size at `out_ptr` means retry with a
/// larger buffer (same convention as [`rclweb_point_cloud2_meta`]).
///
/// # Safety
/// Pointers must address the stated readable/writable lengths in wasm memory.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rclweb_decode_generated(
  type_ptr: *const u8,
  type_len: u32,
  payload_ptr: *const u8,
  payload_len: u32,
  out_ptr: *mut u8,
  out_len: u32,
) -> i32 {
  if type_ptr.is_null() || payload_ptr.is_null() || out_ptr.is_null() {
    return -1;
  }
  // SAFETY: host provides readable type name and CDR payload.
  let type_name = unsafe { std::slice::from_raw_parts(type_ptr, type_len as usize) };
  let Ok(type_name) = std::str::from_utf8(type_name) else {
    return -2;
  };
  let payload = unsafe { std::slice::from_raw_parts(payload_ptr, payload_len as usize) };
  let msg = match crate::types::decode_generated_cdr(type_name, payload) {
    Ok(v) => v,
    Err(_) => return -2,
  };
  let encoded = crate::types::encode_host_value(&msg);
  if (out_len as usize) < encoded.len() {
    if out_len >= 4 {
      let out = unsafe { std::slice::from_raw_parts_mut(out_ptr, out_len as usize) };
      out[..4].copy_from_slice(&(encoded.len() as u32).to_le_bytes());
    }
    return -4;
  }
  let out = unsafe { std::slice::from_raw_parts_mut(out_ptr, out_len as usize) };
  out[..encoded.len()].copy_from_slice(&encoded);
  i32::try_from(encoded.len()).unwrap_or(-3)
}
