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
        /// Wire reliability: 1 RELIABLE, 2 BEST_EFFORT (0 = system default → gateway).
        qos_reliability: u8,
        /// KEEP_LAST history depth (R2-01 QoS subset).
        qos_depth: u32,
        domain_id: u8,
    },
    /// Open a TOPIC_PUBLISH channel (symmetric to [`Self::Subscribe`]).
    Publish {
        correlation: [u8; 16],
        channel_id: u32,
        topic: String,
        type_name: String,
        qos_reliability: u8,
        qos_depth: u32,
        domain_id: u8,
    },
    /// Send one `std_msgs/msg/String` sample on a ready publish channel.
    SendSample {
        channel_id: u32,
        string_data: String,
    },
    /// Close an open channel (subscribe or publish).
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
    /// ChannelReady allow|limited for a subscribe channel.
    Subscribed {
        channel_id: u32,
        topic: String,
        type_name: String,
    },
    /// ChannelReady deny|error, or open rejected (subscribe).
    SubscribeFailed {
        channel_id: u32,
        code: u8,
        message: String,
    },
    /// ChannelReady allow|limited for a publish channel.
    Published {
        channel_id: u32,
        topic: String,
        type_name: String,
        /// Effective reliability from ChannelReady (1 RELIABLE, 2 BEST_EFFORT).
        qos_reliability: u8,
    },
    /// ChannelReady deny|error, or open rejected (publish).
    PublishFailed {
        channel_id: u32,
        code: u8,
        message: String,
    },
    /// Inbound ROS_SAMPLE on a subscribe channel.
    ///
    /// The CDR payload is reachable as a borrowed view via
    /// [`super::ClientEngine::lease_payload_view`] with `lease_id` while the
    /// lease is outstanding. For `std_msgs/msg/String`, `string_data` carries
    /// the decoded field so the SDK can deliver a typed event without parsing
    /// CDR itself.
    Sample {
        channel_id: u32,
        lease_id: u32,
        sequence: u64,
        source_time_ns: i64,
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

/// Controllable-copy and poll telemetry for the browser-side engine (R1-05).
///
/// The standing copy budget is two controllable payload copies end-to-end:
/// (1) gateway rcl-take → frame buffer, (2) Worker → wasm/engine retained
/// memory. Application delivery uses borrowed views / decoded String fields
/// (zero extra controllable copies).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct EngineTelemetry {
    /// Inbound WS/bootstrap/frame buffers retained (each is one controllable copy).
    pub copies_into_engine: u64,
    /// Total bytes copied into engine retained storage.
    pub bytes_copied_into_engine: u64,
    /// Number of poll turns executed.
    pub poll_turns: u64,
    /// Cumulative nanoseconds spent inside [`super::ClientEngine::poll`] (host-measured optional).
    pub poll_nanos_total: u64,
    /// Samples emitted as application events.
    pub samples_emitted: u64,
    /// Leases explicitly released by the host.
    pub leases_released: u64,
    /// Outbound ROS_SAMPLE frames produced by [`AppCommand::SendSample`].
    pub samples_sent: u64,
}
