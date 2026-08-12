//! Host-facing event and result types for the client connection engine.
//!
//! These types are transport-agnostic: the wasm poll ABI and native tests both
//! speak them. Sample payloads are exposed as borrowed views under an explicit
//! lease id — the host must [`HostEvent::ReleaseLease`] before the engine
//! reclaims the backing store.

use crate::session::SessionPhase;

/// Default schema type name for the R1 string path.
pub const STD_MSGS_STRING: &str = "std_msgs/msg/String";

/// Maximum host events accepted in one poll turn (bounded batch).
pub const MAX_HOST_EVENTS_PER_POLL: usize = 64;

/// Maximum outbound messages queued from one poll turn.
pub const MAX_OUTBOUND_PER_POLL: usize = 64;

/// Host → engine events for one poll turn.
#[derive(Debug, Clone)]
pub enum HostEvent {
    /// Complete R2WP bootstrap record or selected-version frame bytes.
    ///
    /// `buffer_id` identifies a host-owned inbound allocation (wasm ptr or
    /// native slab). The engine retains it while any sample lease still points
    /// into it; once idle it appears in [`PollOutcome::released_buffers`].
    WsBytes { buffer_id: u32, bytes: Vec<u8> },
    /// Host clock tick; `now_ms` is monotonic milliseconds from an arbitrary origin.
    Timer { now_ms: u64 },
    /// Application command from the SDK (no protocol parsing on the TS side).
    Command(AppCommand),
    /// Release a previously issued sample lease so its backing store may free.
    ReleaseLease { lease_id: u32 },
}

/// Application commands the SDK issues through the host.
#[derive(Debug, Clone)]
pub enum AppCommand {
    /// Begin bootstrap: emit ClientHello.
    Start { transferable_arraybuffer: bool },
    /// Send Authenticate after ServerHello.
    Authenticate {
        correlation: [u8; 16],
        scheme: String,
        token: Vec<u8>,
    },
    /// Open a TOPIC_SUBSCRIBE channel.
    Subscribe {
        correlation: [u8; 16],
        channel_id: u32,
        topic: String,
        type_name: String,
        qos_reliability: u8,
        domain_id: u8,
    },
    /// Close an open channel.
    Unsubscribe {
        correlation: [u8; 16],
        channel_id: u32,
    },
    /// Tear down the session (best-effort; host closes the transport).
    Close,
}

/// Engine → application events produced by a poll turn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppEvent {
    /// ServerHello accepted; selected plane entered.
    BootstrapComplete { selected_wire_version: u8 },
    /// SessionReady accepted.
    SessionReady {
        support_row: String,
        domain_id: u8,
        gateway_instance_id: String,
    },
    /// ChannelReady allow|limited.
    Subscribed {
        channel_id: u32,
        topic: String,
        type_name: String,
    },
    /// ChannelReady deny|error, or open rejected.
    SubscribeFailed {
        channel_id: u32,
        code: u8,
        message: String,
    },
    /// Inbound ROS_SAMPLE on a subscribe channel.
    ///
    /// `payload` is a borrowed view into engine-retained memory. For
    /// `std_msgs/msg/String`, `string_data` carries the decoded field so the
    /// SDK can deliver a typed event without parsing CDR itself.
    Sample {
        channel_id: u32,
        lease_id: u32,
        sequence: u64,
        source_time_ns: i64,
        payload: Vec<u8>,
        string_data: Option<String>,
    },
    /// Peer heartbeat observed (and optionally replied).
    Heartbeat { counter: u64 },
    /// Session-scope error; connection should close.
    Error { code: u8, message: String },
    /// Engine reached a terminal phase.
    Closed { phase: SessionPhase },
}

/// One outbound binary message ready for the transport.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutboundMessage {
    /// Engine-owned allocation id (wasm ptr or native slab id).
    pub buffer_id: u32,
    pub bytes: Vec<u8>,
}

/// Buffer the host may reclaim after this poll (inbound WS slabs or outbound
/// messages the host has already taken).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReleasedBuffer {
    pub buffer_id: u32,
    pub len: u32,
}

/// Result of one [`super::ClientEngine::poll`] turn.
#[derive(Debug, Clone, Default)]
pub struct PollOutcome {
    pub outbound: Vec<OutboundMessage>,
    pub events: Vec<AppEvent>,
    pub released_buffers: Vec<ReleasedBuffer>,
    /// Next timer deadline in the same clock domain as [`HostEvent::Timer`], if any.
    pub next_deadline_ms: Option<u64>,
}
