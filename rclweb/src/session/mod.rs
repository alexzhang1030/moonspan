//! Synchronous session and channel state machine for the R2WP v0.1 subset.
//!
//! Host-agnostic and pure: callers parse bootstrap/frames with [`crate::protocol`]
//! first, then ingest or record-send through [`Session`]. Poll ABI, transports,
//! and rcl FFI remain out of scope (R1-03 / R1-04).
//!
//! ## Model
//!
//! - [`Session::ingest_bootstrap`] / [`Session::ingest_frame`] apply messages
//!   **received from the peer** (`sender = role.peer()`).
//! - [`Session::record_send_bootstrap`] / [`Session::record_send_frame`] apply
//!   messages **this peer is sending** (`sender = role`), so both sides can keep
//!   a consistent connection state (for example a server recording its own
//!   `ChannelReady` before emitting samples).
//!
//! Fresh ready path only: Authenticate → SessionReady. SessionResume kinds are
//! protocol violations without capability `1` (parked for v0.1).

mod channel;
mod state;
mod transition;

#[cfg(test)]
mod tests;

pub use channel::{ChannelEntry, ChannelResult, ChannelState, ChannelTable, OperationKind};
pub use state::{Role, SessionPhase};
pub use transition::{
    SessionEffects, FIELD_CHANNEL_ID, FIELD_CHANNEL_RESULT, FIELD_CORRELATION_ID,
    FIELD_OPERATION_KIND,
};

use crate::protocol::bootstrap::BootstrapRecord;
use crate::protocol::error::ProtocolError;
use crate::protocol::frame::DecodedFrame;
use transition::{apply_bootstrap, apply_frame, SessionState};

/// Connection/session state machine for one peer role.
#[derive(Debug, Clone)]
pub struct Session {
    inner: SessionState,
}

impl Session {
    /// Create a session for `role`. Both roles start in [`SessionPhase::AwaitClientHello`];
    /// the client must [`Self::record_send_bootstrap`] its ClientHello before expecting
    /// a ServerHello.
    #[must_use]
    pub fn new(role: Role) -> Self {
        Self {
            inner: SessionState::new(role),
        }
    }

    #[must_use]
    pub fn role(&self) -> Role {
        self.inner.role
    }

    #[must_use]
    pub fn phase(&self) -> SessionPhase {
        self.inner.phase
    }

    /// Lifecycle state for `id`; unknown ids are [`ChannelState::Unused`].
    #[must_use]
    pub fn channel_state(&self, id: u32) -> ChannelState {
        self.inner.channels.state(id)
    }

    #[must_use]
    pub fn selected_wire_version(&self) -> Option<u8> {
        self.inner.selected_wire_version
    }

    /// Apply a bootstrap record received from the peer.
    pub fn ingest_bootstrap(
        &mut self,
        record: &BootstrapRecord,
    ) -> Result<SessionEffects, ProtocolError> {
        let sender = self.inner.role.peer();
        apply_bootstrap(&mut self.inner, record, sender)
    }

    /// Apply a bootstrap record this peer is sending.
    pub fn record_send_bootstrap(
        &mut self,
        record: &BootstrapRecord,
    ) -> Result<SessionEffects, ProtocolError> {
        let sender = self.inner.role;
        apply_bootstrap(&mut self.inner, record, sender)
    }

    /// Apply a selected-version frame received from the peer.
    pub fn ingest_frame(
        &mut self,
        frame: &DecodedFrame<'_>,
    ) -> Result<SessionEffects, ProtocolError> {
        let sender = self.inner.role.peer();
        apply_frame(&mut self.inner, frame, sender)
    }

    /// Apply a selected-version frame this peer is sending.
    pub fn record_send_frame(
        &mut self,
        frame: &DecodedFrame<'_>,
    ) -> Result<SessionEffects, ProtocolError> {
        let sender = self.inner.role;
        apply_frame(&mut self.inner, frame, sender)
    }
}
