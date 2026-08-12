//! Connection and session phase enums for the v0.1 walking skeleton.

/// Which peer this state machine instance represents.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Client,
    Server,
}

impl Role {
    /// The remote peer for this role.
    #[must_use]
    pub const fn peer(self) -> Self {
        match self {
            Self::Client => Self::Server,
            Self::Server => Self::Client,
        }
    }
}

/// High-level session phase (bootstrap → selected plane → ready / terminal).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionPhase {
    /// Waiting for the client's ClientHello (initial for both roles until client records send).
    AwaitClientHello,
    /// ClientHello observed; waiting for ServerHello or BootstrapError.
    AwaitServerHello,
    /// Selected-version plane entered; waiting for Authenticate (fresh path).
    SelectedAwaitAuthenticate,
    /// Authenticate observed; waiting for SessionReady or Error.
    SelectedAwaitSessionReady,
    /// SessionReady accepted; control and data rules for ready state apply.
    Ready,
    /// BootstrapError terminated the connection without a selected plane.
    BootstrapFailed,
    /// Session-scope failure or explicit close of the session machine.
    Failed,
}

impl SessionPhase {
    /// Whether the selected-version frame plane is active.
    #[must_use]
    pub const fn in_selected_plane(self) -> bool {
        matches!(
            self,
            Self::SelectedAwaitAuthenticate
                | Self::SelectedAwaitSessionReady
                | Self::Ready
                | Self::Failed
        )
    }

    /// Whether ready-required kinds and data are permitted.
    #[must_use]
    pub const fn is_ready(self) -> bool {
        matches!(self, Self::Ready)
    }

    /// Terminal phases that reject further progress.
    #[must_use]
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::BootstrapFailed | Self::Failed)
    }
}
