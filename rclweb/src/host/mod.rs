//! Host poll ABI: flat binary batches and (on wasm32) hand-written exports.
//!
//! Hand-written `extern "C"` exports keep the artifact small and the boundary
//! explicit (ADR 0004). Full `wasm-bindgen` stays out of R1; artifact size and
//! poll latency are R-D1 reopen inputs.

pub mod batch;

#[cfg(target_arch = "wasm32")]
pub mod abi;

pub use batch::{
    APP_BOOTSTRAP_COMPLETE, APP_CLOSED, APP_ERROR, APP_HEARTBEAT, APP_SAMPLE, APP_SESSION_READY,
    APP_SUBSCRIBE_FAILED, APP_SUBSCRIBED, BATCH_MAGIC, BatchError, CMD_AUTHENTICATE, CMD_CLOSE,
    CMD_START, CMD_SUBSCRIBE, CMD_UNSUBSCRIBE, EVENT_COMMAND, EVENT_RELEASE, EVENT_TIMER,
    EVENT_WS_BYTES, FLAG_INLINE_WS_BYTES, LAYOUT_VERSION, RESULT_MAGIC, decode_host_batch,
    encode_host_batch_inline, encode_poll_result,
};
