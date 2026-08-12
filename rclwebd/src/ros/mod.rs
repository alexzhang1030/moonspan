//! Serialized-only rcl attachment (`feature = "ros"`, row J-FT).
//!
//! Surface per the plan: init, node, serialized publish/take, wait set, and
//! graph queries — no typed message code and no third-party rcl binding.
//! `ffi` holds the vendored bindings and the statically linked demo
//! typesupport; `rcl` is the thin safe wrapper; `backend` runs the single
//! ROS thread behind the [`crate::backend::RosBackend`] trait.

pub mod ffi;

mod backend;
mod rcl;

pub use backend::RclBackend;
pub use ffi::LINKED_TYPES;
