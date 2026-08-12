//! Raw serialized-only rcl FFI surface.
//!
//! `bindings` is vendored bindgen output (`scripts/generate-rcl-bindings.sh`).
//! Message/service/action typesupport is resolved at runtime via dlopen
//! ([`super::typesupport`]); R1 static demo links are gone (R3-04 / ADR 0006).

#![allow(unsafe_code)]

pub mod bindings;
