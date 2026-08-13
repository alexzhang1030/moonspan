//! Hand-written wasm32 poll ABI.
//!
//! Unsafe is confined to this module: pointer arguments from the host and the
//! process-wide engine table. The rest of `rclweb` stays under crate-level
//! `deny(unsafe_code)`.

#![allow(unsafe_code)]

use crate::engine::ClientEngine;
use crate::host::batch::{BatchError, decode_host_batch, encode_poll_result};
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

/// Allocate `len` bytes in wasm linear memory. Returns null on failure.
#[unsafe(no_mangle)]
pub extern "C" fn rclweb_alloc(len: u32) -> *mut u8 {
  if len == 0 {
    return std::ptr::null_mut();
  }
  let mut buf = vec![0u8; len as usize];
  let ptr = buf.as_mut_ptr();
  // Leak the Vec so the host owns the region until rclweb_free.
  std::mem::forget(buf);
  ptr
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
  // SAFETY: host contract — ptr/len pair from rclweb_alloc.
  let _ = unsafe { Vec::from_raw_parts(ptr, len as usize, len as usize) };
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
    // Take ownership so the retain path moves bytes without a second deep copy
    // (R2-02 large-message controllable-copy budget).
    let vec = unsafe { Vec::from_raw_parts(ptr as *mut u8, len as usize, len as usize) };
    Ok(vec)
  }) {
    Ok(events) => events,
    Err(err) => return map_batch_err(err),
  };

  let encoded = ENGINES.with(|engines| {
    let mut map = engines.borrow_mut();
    let engine = map.get_mut(&handle)?;
    let outcome = engine.poll(events);
    let result =
      encode_poll_result(&outcome, |lease_id| match engine.lease_payload_view(lease_id) {
        Some(view) => (view.as_ptr() as u32, view.len() as u32),
        None => (0, 0),
      });
    Some(result)
  });
  let Some(outcome) = encoded else {
    return -6;
  };

  let len = outcome.len();
  if len > i32::MAX as usize {
    return -5;
  }
  SCRATCH.with(|scratch| {
    scratch.borrow_mut().insert(handle, outcome);
  });
  len as i32
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
