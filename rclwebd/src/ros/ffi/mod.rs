//! Raw serialized-only rcl FFI surface (row J-FT).
//!
//! `bindings` is vendored bindgen output (scripts/generate-rcl-bindings.sh).
//! The typesupport getters below are the R1 "static link" of the demo types'
//! generated C typesupport: resolved by the linker from
//! `lib<pkg>__rosidl_typesupport_c.so` at build time (dynamic dlopen
//! resolution replaces this in R3 per the plan).

#![allow(unsafe_code)]

pub mod bindings;

use bindings::rosidl_message_type_support_t;

unsafe extern "C" {
    pub fn rosidl_typesupport_c__get_message_type_support_handle__std_msgs__msg__String()
    -> *const rosidl_message_type_support_t;
    pub fn rosidl_typesupport_c__get_message_type_support_handle__sensor_msgs__msg__PointCloud2()
    -> *const rosidl_message_type_support_t;
}

/// Statically linked demo typesupport registry (R1 scope: the walking
/// skeleton's `std_msgs/String` plus the R2 large-message type).
///
/// Unknown types map to wire error 10 (`schema_unavailable`) at the caller.
#[must_use]
pub fn message_type_support(type_name: &str) -> Option<*const rosidl_message_type_support_t> {
    // SAFETY: the getters are pure lookups into linked static typesupport
    // data; the returned pointers have static lifetime.
    let handle = match type_name {
        "std_msgs/msg/String" => unsafe {
            rosidl_typesupport_c__get_message_type_support_handle__std_msgs__msg__String()
        },
        "sensor_msgs/msg/PointCloud2" => unsafe {
            rosidl_typesupport_c__get_message_type_support_handle__sensor_msgs__msg__PointCloud2()
        },
        _ => return None,
    };
    (!handle.is_null()).then_some(handle)
}

/// Names of the statically linked demo types (for readiness reporting).
pub const LINKED_TYPES: [&str; 2] = ["std_msgs/msg/String", "sensor_msgs/msg/PointCloud2"];
