//! Application channel identity and lifecycle table.

use std::collections::BTreeMap;

/// Wire `operation_kind` values for the R3-01 semantics subset.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum OperationKind {
  TopicSubscribe = 0,
  TopicPublish = 1,
  ServiceClient = 2,
  ServiceServer = 3,
  ActionClient = 4,
  ActionServer = 5,
}

impl OperationKind {
  /// Parse a supported operation kind; media/recording/asset stay rejected.
  #[must_use]
  pub const fn from_u8(value: u8) -> Option<Self> {
    match value {
      0 => Some(Self::TopicSubscribe),
      1 => Some(Self::TopicPublish),
      2 => Some(Self::ServiceClient),
      3 => Some(Self::ServiceServer),
      4 => Some(Self::ActionClient),
      5 => Some(Self::ActionServer),
      _ => None,
    }
  }

  /// Whether `ROS_SAMPLE` from `sender` is legal on an active channel of this kind.
  #[must_use]
  pub const fn allows_ros_sample_from(self, sender: super::state::Role) -> bool {
    match self {
      Self::TopicSubscribe => matches!(sender, super::state::Role::Server),
      Self::TopicPublish => matches!(sender, super::state::Role::Client),
      Self::ServiceClient | Self::ServiceServer | Self::ActionClient | Self::ActionServer => false,
    }
  }

  /// Whether this kind uses Service opcodes (`SERVICE_REQUEST` / `SERVICE_RESPONSE`).
  #[must_use]
  pub const fn is_service(self) -> bool {
    matches!(self, Self::ServiceClient | Self::ServiceServer)
  }

  /// Whether this kind uses Action opcodes.
  #[must_use]
  pub const fn is_action(self) -> bool {
    matches!(self, Self::ActionClient | Self::ActionServer)
  }

  /// Whether `opcode` is legal for this kind (application opcodes only).
  #[must_use]
  pub const fn allows_opcode(self, opcode: u8) -> bool {
    use crate::protocol::frame::{
      OPCODE_ACTION_CANCEL, OPCODE_ACTION_FEEDBACK, OPCODE_ACTION_GOAL, OPCODE_ACTION_RESULT,
      OPCODE_ACTION_STATUS, OPCODE_ROS_SAMPLE, OPCODE_SERVICE_REQUEST, OPCODE_SERVICE_RESPONSE,
    };
    match self {
      Self::TopicSubscribe | Self::TopicPublish => opcode == OPCODE_ROS_SAMPLE,
      Self::ServiceClient | Self::ServiceServer => {
        opcode == OPCODE_SERVICE_REQUEST || opcode == OPCODE_SERVICE_RESPONSE
      }
      Self::ActionClient | Self::ActionServer => matches!(
        opcode,
        OPCODE_ACTION_GOAL
          | OPCODE_ACTION_FEEDBACK
          | OPCODE_ACTION_RESULT
          | OPCODE_ACTION_STATUS
          | OPCODE_ACTION_CANCEL
      ),
    }
  }

  /// Absolute wire sender for `opcode` on this kind (`None` = illegal).
  #[must_use]
  pub const fn opcode_sender(self, opcode: u8) -> Option<super::state::Role> {
    use super::state::Role;
    use crate::protocol::frame::{
      OPCODE_ACTION_CANCEL, OPCODE_ACTION_FEEDBACK, OPCODE_ACTION_GOAL, OPCODE_ACTION_RESULT,
      OPCODE_ACTION_STATUS, OPCODE_ROS_SAMPLE, OPCODE_SERVICE_REQUEST, OPCODE_SERVICE_RESPONSE,
    };
    match (self, opcode) {
      (Self::TopicSubscribe, OPCODE_ROS_SAMPLE) => Some(Role::Server),
      (Self::TopicPublish, OPCODE_ROS_SAMPLE) => Some(Role::Client),
      (Self::ServiceClient, OPCODE_SERVICE_REQUEST) => Some(Role::Client),
      (Self::ServiceClient, OPCODE_SERVICE_RESPONSE) => Some(Role::Server),
      (Self::ServiceServer, OPCODE_SERVICE_REQUEST) => Some(Role::Server),
      (Self::ServiceServer, OPCODE_SERVICE_RESPONSE) => Some(Role::Client),
      (Self::ActionClient, OPCODE_ACTION_GOAL | OPCODE_ACTION_CANCEL) => Some(Role::Client),
      (
        Self::ActionClient,
        OPCODE_ACTION_FEEDBACK | OPCODE_ACTION_RESULT | OPCODE_ACTION_STATUS,
      ) => Some(Role::Server),
      (Self::ActionServer, OPCODE_ACTION_GOAL | OPCODE_ACTION_CANCEL) => Some(Role::Server),
      (
        Self::ActionServer,
        OPCODE_ACTION_FEEDBACK | OPCODE_ACTION_RESULT | OPCODE_ACTION_STATUS,
      ) => Some(Role::Client),
      _ => None,
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
    self.entries.get(&id).map(|e| e.state).unwrap_or(ChannelState::Unused)
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
    self
      .entries
      .insert(id, ChannelEntry { state: ChannelState::Pending, operation_kind, open_correlation });
  }

  pub fn set_state(&mut self, id: u32, state: ChannelState) {
    if let Some(entry) = self.entries.get_mut(&id) {
      entry.state = state;
    }
  }
}
