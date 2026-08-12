//! Application channel identity and lifecycle table.

use std::collections::BTreeMap;

/// Wire `operation_kind` values used by the v0.1 topic skeleton.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum OperationKind {
    TopicSubscribe = 0,
    TopicPublish = 1,
}

impl OperationKind {
    /// Parse a supported v0.1 operation kind; other values are rejected by the SM.
    #[must_use]
    pub const fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::TopicSubscribe),
            1 => Some(Self::TopicPublish),
            _ => None,
        }
    }

    /// Whether `ROS_SAMPLE` from `sender` is legal on an active channel of this kind.
    #[must_use]
    pub const fn allows_ros_sample_from(self, sender: super::state::Role) -> bool {
        match self {
            Self::TopicSubscribe => matches!(sender, super::state::Role::Server),
            Self::TopicPublish => matches!(sender, super::state::Role::Client),
        }
    }
}

/// ChannelReady `result` values (registry `channel_result`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ChannelResult {
    Allow = 0,
    Deny = 1,
    Limited = 2,
    Error = 3,
}

impl ChannelResult {
    #[must_use]
    pub const fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Allow),
            1 => Some(Self::Deny),
            2 => Some(Self::Limited),
            3 => Some(Self::Error),
            _ => None,
        }
    }

    #[must_use]
    pub const fn is_success(self) -> bool {
        matches!(self, Self::Allow | Self::Limited)
    }
}

/// Lifecycle state for one application `channel_id`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelState {
    /// No OpenChannel yet for this id (also returned for never-seen ids).
    Unused,
    /// OpenChannel accepted; awaiting ChannelReady.
    Pending,
    /// ChannelReady allow|limited.
    Active,
    /// ChannelReady deny|error; id consumed, terminal.
    Failed,
    /// CloseChannel completed; terminal.
    Closed,
}

impl ChannelState {
    #[must_use]
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Failed | Self::Closed)
    }
}

/// Recorded channel after OpenChannel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelEntry {
    pub state: ChannelState,
    pub operation_kind: OperationKind,
    /// OpenChannel correlation_id bytes (empty if absent/zero-length).
    pub open_correlation: Vec<u8>,
}

/// Channel id → entry. Presence of a key means OpenChannel was seen (id consumed).
#[derive(Debug, Default, Clone)]
pub struct ChannelTable {
    entries: BTreeMap<u32, ChannelEntry>,
}

impl ChannelTable {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Lifecycle view; unknown ids report [`ChannelState::Unused`].
    #[must_use]
    pub fn state(&self, id: u32) -> ChannelState {
        self.entries
            .get(&id)
            .map(|e| e.state)
            .unwrap_or(ChannelState::Unused)
    }

    #[must_use]
    pub fn get(&self, id: u32) -> Option<&ChannelEntry> {
        self.entries.get(&id)
    }

    #[must_use]
    pub fn contains(&self, id: u32) -> bool {
        self.entries.contains_key(&id)
    }

    pub fn insert_pending(
        &mut self,
        id: u32,
        operation_kind: OperationKind,
        open_correlation: Vec<u8>,
    ) {
        self.entries.insert(
            id,
            ChannelEntry {
                state: ChannelState::Pending,
                operation_kind,
                open_correlation,
            },
        );
    }

    pub fn set_state(&mut self, id: u32, state: ChannelState) {
        if let Some(entry) = self.entries.get_mut(&id) {
            entry.state = state;
        }
    }
}
