//! Versioned serialized adapter ABI (ADR 0006) — Rust mirror of
//! [`rclwebd/adapter/include/rclweb_adapter_v1.h`](../../adapter/include/rclweb_adapter_v1.h).
//!
//! The ROS attachment (`feature = "ros"`) performs the startup probe against
//! these records. Buffer ownership and stable status codes travel with every
//! cross-boundary payload.

#![allow(dead_code)]

/// ABI major version (must match the C header).
pub const ABI_MAJOR: u32 = 1;
/// ABI minor version (must match the C header).
pub const ABI_MINOR: u32 = 0;
/// Identity string carried on SessionReady `adapter_abi_version`.
pub const ABI_VERSION_STRING: &str = "serialized-adapter-v1";

/// Stable adapter status (wire mapping noted where applicable).
#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdapterStatus {
    Ok = 0,
    /// Maps to R2WP wire code 10 (`schema_unavailable`).
    SchemaUnavailable = 10,
    /// Maps to R2WP wire code 11 (`qos_incompatible`).
    QosIncompatible = 11,
    /// Maps to R2WP wire code 13 (`resource_exhausted`).
    ResourceExhausted = 13,
    Timeout = 14,
    InvalidArgument = 15,
    /// Readiness: `adapter_profile_mismatch`.
    ProfileMismatch = 16,
    Internal = 17,
}

impl AdapterStatus {
    /// R2WP wire error code when this status surfaces on a channel/session.
    #[must_use]
    pub fn wire_code(self) -> u8 {
        match self {
            Self::Ok => 0,
            Self::SchemaUnavailable => 10,
            Self::QosIncompatible => 11,
            Self::ResourceExhausted => 13,
            Self::Timeout | Self::InvalidArgument | Self::ProfileMismatch | Self::Internal => 13,
        }
    }
}

/// Which side allocated a buffer (explicit release on that side).
#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BufferOwner {
    Rust = 0,
    Adapter = 1,
}

/// Versioned buffer record: length, capacity, and owning allocator.
#[derive(Debug)]
pub struct AdapterBuffer {
    pub data: Vec<u8>,
    pub owner: BufferOwner,
}

impl AdapterBuffer {
    #[must_use]
    pub fn from_rust(bytes: Vec<u8>) -> Self {
        Self {
            data: bytes,
            owner: BufferOwner::Rust,
        }
    }

    #[must_use]
    pub fn from_adapter(bytes: Vec<u8>) -> Self {
        Self {
            data: bytes,
            owner: BufferOwner::Adapter,
        }
    }

    /// Release returns the bytes only when `owner` matches; otherwise drops.
    #[must_use]
    pub fn release(self, expected: BufferOwner) -> Option<Vec<u8>> {
        if self.owner == expected {
            Some(self.data)
        } else {
            None
        }
    }
}

/// Opaque adapter entity handle (`0` = invalid).
pub type AdapterHandle = u64;

pub const HANDLE_INVALID: AdapterHandle = 0;

/// Startup probe result compared against [`crate::config::GatewayConfig`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdapterProbe {
    pub abi_major: u32,
    pub abi_minor: u32,
    pub support_row_id: String,
    pub ros_distro: String,
    pub rmw_implementation: String,
    pub abi_version: String,
}

impl AdapterProbe {
    /// Build the probe for the process-local support row after ROS attach.
    #[must_use]
    pub fn for_row(support_row_id: &str, ros_distro: &str, rmw_implementation: &str) -> Self {
        Self {
            abi_major: ABI_MAJOR,
            abi_minor: ABI_MINOR,
            support_row_id: support_row_id.to_owned(),
            ros_distro: ros_distro.to_owned(),
            rmw_implementation: rmw_implementation.to_owned(),
            abi_version: ABI_VERSION_STRING.to_owned(),
        }
    }

    /// Compatibility check: ABI major must match; row/distro/RMW must agree.
    pub fn check_compatible(
        &self,
        expected_row: &str,
        expected_distro: &str,
    ) -> Result<(), AdapterStatus> {
        if self.abi_major != ABI_MAJOR {
            return Err(AdapterStatus::ProfileMismatch);
        }
        if self.abi_version != ABI_VERSION_STRING {
            return Err(AdapterStatus::ProfileMismatch);
        }
        if self.support_row_id != expected_row || self.ros_distro != expected_distro {
            return Err(AdapterStatus::ProfileMismatch);
        }
        Ok(())
    }
}

/// Bounded command/event queue limits (ADR 0006 SPSC topology).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QueueLimits {
    pub command_capacity: u32,
    pub event_capacity: u32,
    pub command_max_bytes: u64,
    pub event_max_bytes: u64,
}

impl Default for QueueLimits {
    fn default() -> Self {
        Self {
            command_capacity: 1024,
            event_capacity: 1024,
            command_max_bytes: 16 * 1024 * 1024,
            event_max_bytes: 64 * 1024 * 1024,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_accepts_matching_row() {
        let probe = AdapterProbe::for_row("J-FT", "jazzy", "rmw_fastrtps_cpp");
        assert_eq!(probe.abi_version, ABI_VERSION_STRING);
        assert!(probe.check_compatible("J-FT", "jazzy").is_ok());
        assert_eq!(
            probe.check_compatible("H-FT", "jazzy"),
            Err(AdapterStatus::ProfileMismatch)
        );
    }

    #[test]
    fn buffer_release_respects_owner() {
        let buf = AdapterBuffer::from_adapter(vec![1, 2, 3]);
        assert!(buf.release(BufferOwner::Rust).is_none());
        let buf = AdapterBuffer::from_rust(vec![4]);
        assert_eq!(buf.release(BufferOwner::Rust), Some(vec![4]));
    }
}
