//! Serialized-only rcl attachment (`feature = "ros"`).
//!
//! Surface: init, node, serialized publish/take, wait set, graph queries,
//! live service client/server, and live action client/server (call-style
//! goal→result; browser-as-server via inbound goals).
//! Typesupport is resolved dynamically ([`typesupport`]). The versioned
//! adapter ABI records live in [`crate::adapter`]. Unsafe code stays in
//! `ffi` / `rcl` / `typesupport`; `backend` owns the single ROS thread.

pub mod ffi;
pub mod typesupport;

mod backend;
mod rcl;

pub use backend::RclBackend;
/// Demo types historically linked at build time; now resolved via dlopen.
pub use typesupport::DEMO_TYPES as LINKED_TYPES;
