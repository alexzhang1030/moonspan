//! Apply bootstrap records and decoded frames to session state.

use super::channel::{ChannelResult, ChannelState, ChannelTable, OperationKind};
use super::state::{Role, SessionPhase};
use crate::protocol::bootstrap::BootstrapRecord;
use crate::protocol::cbor::CborValue;
use crate::protocol::control::{
    CONTROL_KIND_AUTHENTICATE, CONTROL_KIND_CHANNEL_READY, CONTROL_KIND_CLOCK_SYNC,
    CONTROL_KIND_CLOSE_CHANNEL, CONTROL_KIND_ERROR, CONTROL_KIND_GRAPH_DELTA,
    CONTROL_KIND_GRAPH_SNAPSHOT, CONTROL_KIND_HEARTBEAT, CONTROL_KIND_OPEN_CHANNEL,
    CONTROL_KIND_SCHEMA_ADVERTISE, CONTROL_KIND_SCHEMA_REQUEST, CONTROL_KIND_SCHEMA_RESPONSE,
    CONTROL_KIND_SESSION_READY, CONTROL_KIND_SESSION_RESUME, CONTROL_KIND_SESSION_RESUME_RESULT,
    ControlMessage,
};
use crate::protocol::error::ProtocolError;
use crate::protocol::frame::{DecodedFrame, FramePayload, OPCODE_CONTROL_CBOR, OPCODE_ROS_SAMPLE};

/// Control field key: correlation_id (bstr).
pub const FIELD_CORRELATION_ID: u64 = 2;
/// Control field key: channel_id (app id).
pub const FIELD_CHANNEL_ID: u64 = 29;
/// Control field key: operation_kind.
pub const FIELD_OPERATION_KIND: u64 = 30;
/// Control field key: ChannelReady result.
pub const FIELD_CHANNEL_RESULT: u64 = 33;

/// Minimal host-facing effects produced by a successful transition.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SessionEffects {
    pub entered_selected_plane: bool,
    pub entered_ready: bool,
    pub bootstrap_failed: bool,
    pub session_error: bool,
    pub channel_opened: Option<u32>,
    pub channel_failed: Option<u32>,
    pub channel_closed: Option<u32>,
    pub heartbeat: bool,
    /// Matched Authenticate ↔ SessionReady/Error correlation when present.
    pub auth_correlation_matched: bool,
    /// Matched OpenChannel ↔ ChannelReady/Error correlation when present.
    pub channel_correlation_matched: bool,
}

/// Mutable session connection state (phase + channels + entry correlation).
#[derive(Debug, Clone)]
pub struct SessionState {
    pub role: Role,
    pub phase: SessionPhase,
    pub channels: ChannelTable,
    /// Correlation bytes from the outstanding Authenticate, if any.
    pub pending_auth_correlation: Option<Vec<u8>>,
    /// Selected wire version from ServerHello (informational).
    pub selected_wire_version: Option<u8>,
}

impl SessionState {
    #[must_use]
    pub fn new(role: Role) -> Self {
        Self {
            role,
            phase: SessionPhase::AwaitClientHello,
            channels: ChannelTable::new(),
            pending_auth_correlation: None,
            selected_wire_version: None,
        }
    }
}

fn field_uint(msg: &ControlMessage<'_>, key: u64) -> Option<u64> {
    match msg.fields.get(&key) {
        Some(CborValue::Unsigned(v)) => Some(*v),
        Some(CborValue::Negative(v)) if *v >= 0 => Some(*v as u64),
        _ => None,
    }
}

fn field_bytes<'a>(msg: &'a ControlMessage<'_>, key: u64) -> Option<&'a [u8]> {
    match msg.fields.get(&key) {
        Some(CborValue::Bytes(b)) => Some(b.as_ref()),
        _ => None,
    }
}

fn correlation_vec(msg: &ControlMessage<'_>) -> Vec<u8> {
    field_bytes(msg, FIELD_CORRELATION_ID)
        .unwrap_or_default()
        .to_vec()
}

fn correlations_match(pending: Option<&[u8]>, response: &[u8]) -> bool {
    match pending {
        Some(p) if !p.is_empty() && !response.is_empty() => p == response,
        // Zero / absent correlation: no positive match claim; still allow the transition.
        _ => false,
    }
}

fn is_ready_required_kind(kind: u8) -> bool {
    matches!(
        kind,
        CONTROL_KIND_GRAPH_SNAPSHOT
            | CONTROL_KIND_GRAPH_DELTA
            | CONTROL_KIND_SCHEMA_REQUEST
            | CONTROL_KIND_SCHEMA_RESPONSE
            | CONTROL_KIND_SCHEMA_ADVERTISE
            | CONTROL_KIND_OPEN_CHANNEL
            | CONTROL_KIND_CHANNEL_READY
            | CONTROL_KIND_CLOSE_CHANNEL
            | CONTROL_KIND_CLOCK_SYNC
            | CONTROL_KIND_HEARTBEAT
    )
}

/// Absolute wire sender for a control kind (None = either direction).
fn control_sender(kind: u8) -> Option<Role> {
    match kind {
        CONTROL_KIND_AUTHENTICATE | CONTROL_KIND_SESSION_RESUME | CONTROL_KIND_OPEN_CHANNEL => {
            Some(Role::Client)
        }
        CONTROL_KIND_SESSION_READY
        | CONTROL_KIND_SESSION_RESUME_RESULT
        | CONTROL_KIND_CHANNEL_READY
        | CONTROL_KIND_GRAPH_SNAPSHOT
        | CONTROL_KIND_GRAPH_DELTA
        | CONTROL_KIND_SCHEMA_ADVERTISE
        | CONTROL_KIND_SCHEMA_RESPONSE => Some(Role::Server),
        CONTROL_KIND_SCHEMA_REQUEST => Some(Role::Client),
        CONTROL_KIND_CLOSE_CHANNEL | CONTROL_KIND_CLOCK_SYNC | CONTROL_KIND_HEARTBEAT
        | CONTROL_KIND_ERROR => None,
        _ => None,
    }
}

fn reject_if_wrong_sender(kind: u8, sender: Role) -> Result<(), ProtocolError> {
    if let Some(expected) = control_sender(kind) {
        if sender != expected {
            return Err(ProtocolError::protocol_violation(
                "wrong_control_direction",
                0,
                25,
            ));
        }
    }
    Ok(())
}

/// Apply a bootstrap record observed with `sender` as the originating peer.
pub fn apply_bootstrap(
    state: &mut SessionState,
    record: &BootstrapRecord,
    sender: Role,
) -> Result<SessionEffects, ProtocolError> {
    if state.phase.is_terminal() {
        return Err(ProtocolError::protocol_violation_bootstrap(
            "session_terminal",
            0,
            9,
        ));
    }
    if state.phase.in_selected_plane() {
        return Err(ProtocolError::protocol_violation_bootstrap(
            "bootstrap_after_selected",
            0,
            9,
        ));
    }

    let mut effects = SessionEffects::default();
    match record {
        BootstrapRecord::ClientHello(_) => {
            if sender != Role::Client {
                return Err(ProtocolError::protocol_violation_bootstrap(
                    "wrong_bootstrap_direction",
                    0,
                    9,
                ));
            }
            if state.phase != SessionPhase::AwaitClientHello {
                return Err(ProtocolError::protocol_violation_bootstrap(
                    "duplicate_or_late_client_hello",
                    0,
                    9,
                ));
            }
            state.phase = SessionPhase::AwaitServerHello;
            Ok(effects)
        }
        BootstrapRecord::ServerHello(hello) => {
            if sender != Role::Server {
                return Err(ProtocolError::protocol_violation_bootstrap(
                    "wrong_bootstrap_direction",
                    0,
                    9,
                ));
            }
            if state.phase != SessionPhase::AwaitServerHello {
                return Err(ProtocolError::protocol_violation_bootstrap(
                    "server_hello_out_of_order",
                    0,
                    9,
                ));
            }
            state.selected_wire_version = Some(hello.selected_wire_version);
            state.phase = SessionPhase::SelectedAwaitAuthenticate;
            effects.entered_selected_plane = true;
            Ok(effects)
        }
        BootstrapRecord::BootstrapError(_) => {
            if sender != Role::Server {
                return Err(ProtocolError::protocol_violation_bootstrap(
                    "wrong_bootstrap_direction",
                    0,
                    9,
                ));
            }
            if state.phase != SessionPhase::AwaitServerHello {
                return Err(ProtocolError::protocol_violation_bootstrap(
                    "bootstrap_error_out_of_order",
                    0,
                    9,
                ));
            }
            state.phase = SessionPhase::BootstrapFailed;
            effects.bootstrap_failed = true;
            Ok(effects)
        }
    }
}

/// Apply a decoded selected-version frame with `sender` as the originating peer.
pub fn apply_frame(
    state: &mut SessionState,
    frame: &DecodedFrame<'_>,
    sender: Role,
) -> Result<SessionEffects, ProtocolError> {
    if state.phase.is_terminal() {
        return Err(ProtocolError::protocol_violation(
            "session_terminal",
            0,
            25,
        ));
    }
    if !state.phase.in_selected_plane() {
        return Err(ProtocolError::protocol_violation(
            "selected_frame_before_plane",
            0,
            25,
        ));
    }

    match frame.opcode {
        OPCODE_CONTROL_CBOR => match &frame.payload {
            FramePayload::Control(msg) => apply_control(state, msg, sender),
            FramePayload::Application(_) => Err(ProtocolError::invalid_control(
                "control_opcode_without_control_payload",
                0,
                16,
            )),
        },
        OPCODE_ROS_SAMPLE => apply_ros_sample(state, frame, sender),
        _ => {
            // Other application opcodes: treat like data-plane for readiness / channel rules,
            // then reject as unsupported for the v0.1 topic skeleton.
            if !state.phase.is_ready() {
                return Err(ProtocolError::session_not_ready(
                    "data_before_ready",
                    0,
                ));
            }
            apply_data_channel_gates(state, frame.channel_id)?;
            Err(ProtocolError::protocol_violation(
                "unsupported_operation_opcode",
                0,
                22,
            ))
        }
    }
}

fn apply_control(
    state: &mut SessionState,
    msg: &ControlMessage<'_>,
    sender: Role,
) -> Result<SessionEffects, ProtocolError> {
    reject_if_wrong_sender(msg.kind, sender)?;

    // Resume kinds: parked without capability 1 → protocol_violation as entry or otherwise.
    if matches!(
        msg.kind,
        CONTROL_KIND_SESSION_RESUME | CONTROL_KIND_SESSION_RESUME_RESULT
    ) {
        return Err(ProtocolError::protocol_violation(
            "session_resume_not_enabled",
            0,
            25,
        ));
    }

    // Ready-required kinds before ready → session_not_ready (step 17).
    if !state.phase.is_ready() && is_ready_required_kind(msg.kind) {
        return Err(ProtocolError::session_not_ready(
            "control_before_ready",
            0,
        ));
    }

    let mut effects = SessionEffects::default();
    match msg.kind {
        CONTROL_KIND_AUTHENTICATE => apply_authenticate(state, msg, &mut effects)?,
        CONTROL_KIND_SESSION_READY => apply_session_ready(state, msg, &mut effects)?,
        CONTROL_KIND_ERROR => apply_error(state, msg, &mut effects)?,
        CONTROL_KIND_OPEN_CHANNEL => apply_open_channel(state, msg, &mut effects)?,
        CONTROL_KIND_CHANNEL_READY => apply_channel_ready(state, msg, &mut effects)?,
        CONTROL_KIND_CLOSE_CHANNEL => apply_close_channel(state, msg, &mut effects)?,
        CONTROL_KIND_HEARTBEAT => {
            effects.heartbeat = true;
        }
        CONTROL_KIND_GRAPH_SNAPSHOT
        | CONTROL_KIND_GRAPH_DELTA
        | CONTROL_KIND_SCHEMA_REQUEST
        | CONTROL_KIND_SCHEMA_RESPONSE
        | CONTROL_KIND_SCHEMA_ADVERTISE
        | CONTROL_KIND_CLOCK_SYNC => {
            // Legal when ready (direction already checked); product semantics parked.
        }
        _ => {
            return Err(ProtocolError::protocol_violation(
                "unknown_control_kind",
                0,
                25,
            ));
        }
    }
    Ok(effects)
}

fn apply_authenticate(
    state: &mut SessionState,
    msg: &ControlMessage<'_>,
    effects: &mut SessionEffects,
) -> Result<(), ProtocolError> {
    let _ = effects;
    match state.phase {
        SessionPhase::SelectedAwaitAuthenticate => {
            state.pending_auth_correlation = Some(correlation_vec(msg));
            state.phase = SessionPhase::SelectedAwaitSessionReady;
            Ok(())
        }
        SessionPhase::SelectedAwaitSessionReady | SessionPhase::Ready => Err(
            ProtocolError::protocol_violation("authenticate_out_of_order", 0, 25),
        ),
        _ => Err(ProtocolError::protocol_violation(
            "authenticate_bad_phase",
            0,
            25,
        )),
    }
}

fn apply_session_ready(
    state: &mut SessionState,
    msg: &ControlMessage<'_>,
    effects: &mut SessionEffects,
) -> Result<(), ProtocolError> {
    if state.phase != SessionPhase::SelectedAwaitSessionReady {
        return Err(ProtocolError::protocol_violation(
            "session_ready_out_of_order",
            0,
            25,
        ));
    }
    let response_corr = correlation_vec(msg);
    if correlations_match(
        state.pending_auth_correlation.as_deref(),
        &response_corr,
    ) {
        effects.auth_correlation_matched = true;
    }
    state.pending_auth_correlation = None;
    state.phase = SessionPhase::Ready;
    effects.entered_ready = true;
    Ok(())
}

fn apply_error(
    state: &mut SessionState,
    msg: &ControlMessage<'_>,
    effects: &mut SessionEffects,
) -> Result<(), ProtocolError> {
    // Error is legal after selected-plane entry (not a ready-required kind).
    let response_corr = correlation_vec(msg);
    if state.phase == SessionPhase::SelectedAwaitSessionReady {
        if correlations_match(
            state.pending_auth_correlation.as_deref(),
            &response_corr,
        ) {
            effects.auth_correlation_matched = true;
        }
        state.pending_auth_correlation = None;
        state.phase = SessionPhase::Failed;
        effects.session_error = true;
        return Ok(());
    }
    if state.phase.is_ready() {
        // Channel-scoped Error may pair with an open; session-scope fails the session.
        // For v0.1 skeleton: treat as session_error effect without forcing Failed unless
        // no channel_id is present (session scope default when channel_id absent).
        let channel_id = field_uint(msg, FIELD_CHANNEL_ID).map(|v| v as u32);
        if let Some(id) = channel_id {
            if state.channels.state(id) == ChannelState::Pending {
                if let Some(entry) = state.channels.get(id) {
                    if correlations_match(Some(&entry.open_correlation), &response_corr) {
                        effects.channel_correlation_matched = true;
                    }
                }
                state.channels.set_state(id, ChannelState::Failed);
                effects.channel_failed = Some(id);
                return Ok(());
            }
        }
        effects.session_error = true;
        return Ok(());
    }
    // SelectedAwaitAuthenticate: Error without Authenticate is a protocol violation
    // (fresh path requires Authenticate first; Error is legal "according to its scope"
    // after plane entry — allow as session failure for unsolicited session Error).
    if state.phase == SessionPhase::SelectedAwaitAuthenticate {
        state.phase = SessionPhase::Failed;
        effects.session_error = true;
        return Ok(());
    }
    Err(ProtocolError::protocol_violation(
        "error_bad_phase",
        0,
        25,
    ))
}

fn apply_open_channel(
    state: &mut SessionState,
    msg: &ControlMessage<'_>,
    effects: &mut SessionEffects,
) -> Result<(), ProtocolError> {
    debug_assert!(state.phase.is_ready());
    let channel_id = field_uint(msg, FIELD_CHANNEL_ID).ok_or_else(|| {
        ProtocolError::protocol_violation("open_channel_missing_channel_id", 0, 25)
    })? as u32;
    if channel_id == 0 {
        return Err(ProtocolError::protocol_violation(
            "open_channel_id_zero",
            0,
            25,
        ));
    }
    if state.channels.contains(channel_id) {
        return Err(ProtocolError::protocol_violation(
            "channel_id_reuse",
            0,
            25,
        ));
    }
    let op_raw = field_uint(msg, FIELD_OPERATION_KIND).ok_or_else(|| {
        ProtocolError::protocol_violation("open_channel_missing_operation_kind", 0, 25)
    })?;
    if op_raw > u64::from(u8::MAX) {
        return Err(ProtocolError::protocol_violation(
            "open_channel_bad_operation_kind",
            0,
            25,
        ));
    }
    let operation_kind = OperationKind::from_u8(op_raw as u8).ok_or_else(|| {
        ProtocolError::protocol_violation("unsupported_operation_kind", 0, 25)
    })?;
    state
        .channels
        .insert_pending(channel_id, operation_kind, correlation_vec(msg));
    effects.channel_opened = Some(channel_id);
    Ok(())
}

fn apply_channel_ready(
    state: &mut SessionState,
    msg: &ControlMessage<'_>,
    effects: &mut SessionEffects,
) -> Result<(), ProtocolError> {
    debug_assert!(state.phase.is_ready());
    let channel_id = field_uint(msg, FIELD_CHANNEL_ID).ok_or_else(|| {
        ProtocolError::protocol_violation("channel_ready_missing_channel_id", 0, 25)
    })? as u32;
    match state.channels.state(channel_id) {
        ChannelState::Pending => {}
        ChannelState::Unused => {
            return Err(ProtocolError::protocol_violation(
                "channel_ready_without_open",
                0,
                25,
            ));
        }
        _ => {
            return Err(ProtocolError::protocol_violation(
                "channel_ready_bad_state",
                0,
                25,
            ));
        }
    }
    let result_raw = field_uint(msg, FIELD_CHANNEL_RESULT).ok_or_else(|| {
        ProtocolError::protocol_violation("channel_ready_missing_result", 0, 25)
    })?;
    if result_raw > u64::from(u8::MAX) {
        return Err(ProtocolError::protocol_violation(
            "channel_ready_bad_result",
            0,
            25,
        ));
    }
    let result = ChannelResult::from_u8(result_raw as u8).ok_or_else(|| {
        ProtocolError::protocol_violation("channel_ready_bad_result", 0, 25)
    })?;
    let response_corr = correlation_vec(msg);
    if let Some(entry) = state.channels.get(channel_id) {
        if correlations_match(Some(&entry.open_correlation), &response_corr) {
            effects.channel_correlation_matched = true;
        }
    }
    if result.is_success() {
        state.channels.set_state(channel_id, ChannelState::Active);
    } else {
        state.channels.set_state(channel_id, ChannelState::Failed);
        effects.channel_failed = Some(channel_id);
    }
    Ok(())
}

fn apply_close_channel(
    state: &mut SessionState,
    msg: &ControlMessage<'_>,
    effects: &mut SessionEffects,
) -> Result<(), ProtocolError> {
    debug_assert!(state.phase.is_ready());
    let channel_id = field_uint(msg, FIELD_CHANNEL_ID).ok_or_else(|| {
        ProtocolError::protocol_violation("close_channel_missing_channel_id", 0, 25)
    })? as u32;
    match state.channels.state(channel_id) {
        ChannelState::Active => {
            state.channels.set_state(channel_id, ChannelState::Closed);
            effects.channel_closed = Some(channel_id);
            Ok(())
        }
        ChannelState::Pending => Err(ProtocolError::protocol_violation(
            "close_channel_while_pending",
            0,
            25,
        )),
        ChannelState::Failed | ChannelState::Closed => Err(ProtocolError::protocol_violation(
            "close_channel_terminal",
            0,
            25,
        )),
        ChannelState::Unused => Err(ProtocolError::protocol_violation(
            "close_channel_unknown",
            0,
            25,
        )),
    }
}

fn apply_data_channel_gates(state: &SessionState, channel_id: u32) -> Result<(), ProtocolError> {
    match state.channels.state(channel_id) {
        ChannelState::Pending => Err(ProtocolError::protocol_violation(
            "data_on_pending_channel",
            0,
            19,
        )),
        ChannelState::Failed | ChannelState::Closed | ChannelState::Unused => {
            Err(ProtocolError::unknown_channel("data_on_inactive_channel", 0))
        }
        ChannelState::Active => Ok(()),
    }
}

fn apply_ros_sample(
    state: &mut SessionState,
    frame: &DecodedFrame<'_>,
    sender: Role,
) -> Result<SessionEffects, ProtocolError> {
    if !state.phase.is_ready() {
        return Err(ProtocolError::session_not_ready("data_before_ready", 0));
    }
    apply_data_channel_gates(state, frame.channel_id)?;
    let entry = state
        .channels
        .get(frame.channel_id)
        .expect("active channel must exist");
    if !entry.operation_kind.allows_ros_sample_from(sender) {
        return Err(ProtocolError::protocol_violation(
            "ros_sample_wrong_direction",
            0,
            22,
        ));
    }
    Ok(SessionEffects::default())
}
