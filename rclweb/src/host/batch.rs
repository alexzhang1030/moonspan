//! Flat binary poll batch layout shared by the native engine tests and the
//! wasm32 host ABI.
//!
//! ## Inbound batch (host → engine)
//!
//! ```text
//! magic:u32 = 0x5243_4C42 ("RCLB")
//! version:u16 = 1
//! flags:u16 = 0
//! event_count:u32
//! events: [ HostEventRecord ... ]
//! ```
//!
//! Each event starts with `kind:u8` + `pad:u8*3`:
//! - `1` WsBytes `{ buffer_id:u32, ptr:u32, len:u32 }` — `ptr` is a wasm linear
//!   memory offset when crossing the ABI; native tests use an inline payload
//!   trailer instead (`flags` bit 0 = inline).
//! - `2` Timer `{ now_ms:u64 }`
//! - `3` Command — see command kinds below
//! - `4` ReleaseLease `{ lease_id:u32 }`
//!
//! Command kinds (`cmd:u8` after the event header):
//! - `1` Start `{ transferable_arraybuffer:u8, webtransport:u8, pad:u8*2 }`
//! - `2` Authenticate `{ correlation:[u8;16], scheme_len:u16, scheme..., token_len:u16, token... }`
//! - `3` Subscribe `{ correlation:[u8;16], channel_id:u32, qos:u8, domain:u8, depth:u16,
//!                    topic_len:u16, topic..., type_len:u16, type... }`
//! - `4` Unsubscribe `{ correlation:[u8;16], channel_id:u32 }`
//! - `5` Close
//! - `6` Publish `{ correlation:[u8;16], channel_id:u32, qos:u8, domain:u8, depth:u16,
//!                  topic_len:u16, topic..., type_len:u16, type... }`
//! - `7` SendSample `{ channel_id:u32, string_len:u32, string... }`
//! - `8` OpenService `{ correlation[16], channel_id:u32, client:u8, domain:u8, pad:u16,
//!                     name_len:u16, name..., type_len:u16, type... }`
//! - `9` CallService `{ channel_id:u32, operation_id[16], req_len:u32, req... }`
//! - `10` SendServiceResponse `{ channel_id:u32, operation_id[16], resp_len:u32, resp... }`
//! - `11` OpenAction `{ same as OpenService }`
//! - `12` SendActionGoal `{ channel_id, opid[16], len:u32, bytes... }`
//! - `13` CancelAction `{ channel_id, opid[16] }`
//! - `14` SendActionFeedback `{ channel_id, opid[16], len:u32, bytes... }`
//! - `15` SendActionResult `{ channel_id, opid[16], len:u32, bytes... }`
//! - `16` SendActionStatus `{ channel_id, opid[16], len:u32, bytes... }`
//!
//! ## Outbound result (engine → host)
//!
//! ```text
//! magic:u32 = 0x5243_4C52 ("RCLR")
//! version:u16 = 1
//! flags:u16 = 0
//! outbound_count:u32
//! event_count:u32
//! released_count:u32
//! next_deadline_ms:i64   (-1 = none)
//! outbound: [ { buffer_id:u32, ptr:u32, len:u32 } ]
//! events: [ AppEventRecord ... ]
//! released: [ { buffer_id:u32, len:u32 } ]
//! ```
//!
//! App event kinds:
//! - `1` BootstrapComplete `{ selected_wire_version:u8 }`
//! - `2` SessionReady `{ domain_id:u8, pad:u8*3, row_len:u16, row..., gw_len:u16, gw... }`
//! - `3` Subscribed `{ channel_id:u32, topic_len:u16, topic..., type_len:u16, type... }`
//! - `4` SubscribeFailed `{ channel_id:u32, code:u8, pad:u8*3, msg_len:u16, msg... }`
//! - `5` Sample `{ channel_id:u32, lease_id:u32, sequence:u64, source_time_ns:i64,
//!                 payload_ptr:u32, payload_len:u32, string_len:i32, string...? }`
//!   `string_len < 0` means no decoded string; otherwise UTF-8 follows.
//! - `6` Heartbeat `{ counter:u64 }`
//! - `7` Error `{ code:u8, pad:u8*3, msg_len:u16, msg... }`
//! - `8` Closed `{ phase:u8 }`
//! - `9` Published `{ channel_id:u32, qos_reliability:u8, pad:u8*3,
//!                    topic_len:u16, topic..., type_len:u16, type... }`
//! - `10` PublishFailed `{ channel_id:u32, code:u8, pad:u8*3, msg_len:u16, msg... }`
//! - `11` ServiceReady `{ channel_id, client:u8, pad*3, name_len, name, type_len, type }`
//! - `12` ServiceFailed `{ channel_id, code, pad*3, msg_len, msg }`
//! - `13` ServiceRequest `{ channel_id, opid[16], lease_id, sequence:u64, payload_ptr, payload_len }`
//! - `14` ServiceResponse `{ same }`
//! - `15` ActionReady `{ like ServiceReady }`
//! - `16` ActionFailed `{ like ServiceFailed }`
//! - `17` ActionGoal `{ like ServiceRequest }`
//! - `18` ActionFeedback
//! - `19` ActionResult
//! - `20` ActionStatus
//! - `21` GraphSnapshot `{ generation:u64, nodes_len:u32, nodes_utf8..., endpoints_len:u32, endpoints_utf8... }`
//! - `22` GraphDelta `{ generation:u64 }`
//! - `23` OperationCancelled `{ channel_id, code, pad*3, msg_len, msg }`

pub const BATCH_MAGIC: u32 = 0x5243_4C42; // RCLB
pub const RESULT_MAGIC: u32 = 0x5243_4C52; // RCLR
pub const LAYOUT_VERSION: u16 = 1;

pub const FLAG_INLINE_WS_BYTES: u16 = 0x0001;

pub const EVENT_WS_BYTES: u8 = 1;
pub const EVENT_TIMER: u8 = 2;
pub const EVENT_COMMAND: u8 = 3;
pub const EVENT_RELEASE: u8 = 4;

pub const CMD_START: u8 = 1;
pub const CMD_AUTHENTICATE: u8 = 2;
pub const CMD_SUBSCRIBE: u8 = 3;
pub const CMD_UNSUBSCRIBE: u8 = 4;
pub const CMD_CLOSE: u8 = 5;
pub const CMD_PUBLISH: u8 = 6;
pub const CMD_SEND_SAMPLE: u8 = 7;
pub const CMD_OPEN_SERVICE: u8 = 8;
pub const CMD_CALL_SERVICE: u8 = 9;
pub const CMD_SEND_SERVICE_RESPONSE: u8 = 10;
pub const CMD_OPEN_ACTION: u8 = 11;
pub const CMD_SEND_ACTION_GOAL: u8 = 12;
pub const CMD_CANCEL_ACTION: u8 = 13;
pub const CMD_SEND_ACTION_FEEDBACK: u8 = 14;
pub const CMD_SEND_ACTION_RESULT: u8 = 15;
pub const CMD_SEND_ACTION_STATUS: u8 = 16;

pub const APP_BOOTSTRAP_COMPLETE: u8 = 1;
pub const APP_SESSION_READY: u8 = 2;
pub const APP_SUBSCRIBED: u8 = 3;
pub const APP_SUBSCRIBE_FAILED: u8 = 4;
pub const APP_SAMPLE: u8 = 5;
pub const APP_HEARTBEAT: u8 = 6;
pub const APP_ERROR: u8 = 7;
pub const APP_CLOSED: u8 = 8;
pub const APP_PUBLISHED: u8 = 9;
pub const APP_PUBLISH_FAILED: u8 = 10;
pub const APP_SERVICE_READY: u8 = 11;
pub const APP_SERVICE_FAILED: u8 = 12;
pub const APP_SERVICE_REQUEST: u8 = 13;
pub const APP_SERVICE_RESPONSE: u8 = 14;
pub const APP_ACTION_READY: u8 = 15;
pub const APP_ACTION_FAILED: u8 = 16;
pub const APP_ACTION_GOAL: u8 = 17;
pub const APP_ACTION_FEEDBACK: u8 = 18;
pub const APP_ACTION_RESULT: u8 = 19;
pub const APP_ACTION_STATUS: u8 = 20;
pub const APP_GRAPH_SNAPSHOT: u8 = 21;
pub const APP_GRAPH_DELTA: u8 = 22;
pub const APP_OPERATION_CANCELLED: u8 = 23;

use crate::engine::{
    AppCommand, AppEvent, HostEvent, OutboundMessage, PollOutcome, ReleasedBuffer,
};
use crate::session::SessionPhase;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BatchError {
    Truncated,
    BadMagic,
    BadVersion,
    BadKind,
    Limit,
}

/// Decode a host event batch. When `resolve_ws` is provided it maps
/// `(buffer_id, ptr, len)` into owned bytes (wasm host copies from linear
/// memory). When the batch sets [`FLAG_INLINE_WS_BYTES`], WS payloads follow
/// each WsBytes header inline and `resolve_ws` is unused.
pub fn decode_host_batch(
    bytes: &[u8],
    mut resolve_ws: impl FnMut(u32, u32, u32) -> Result<Vec<u8>, BatchError>,
) -> Result<Vec<HostEvent>, BatchError> {
    if bytes.len() < 12 {
        return Err(BatchError::Truncated);
    }
    let magic = read_u32(bytes, 0);
    if magic != BATCH_MAGIC {
        return Err(BatchError::BadMagic);
    }
    let version = read_u16(bytes, 4);
    if version != LAYOUT_VERSION {
        return Err(BatchError::BadVersion);
    }
    let flags = read_u16(bytes, 6);
    let inline_ws = flags & FLAG_INLINE_WS_BYTES != 0;
    let count = read_u32(bytes, 8) as usize;
    let mut offset = 12usize;
    let mut events = Vec::with_capacity(count);
    for _ in 0..count {
        if offset + 4 > bytes.len() {
            return Err(BatchError::Truncated);
        }
        let kind = bytes[offset];
        offset += 4;
        match kind {
            EVENT_WS_BYTES => {
                if offset + 12 > bytes.len() {
                    return Err(BatchError::Truncated);
                }
                let buffer_id = read_u32(bytes, offset);
                let ptr = read_u32(bytes, offset + 4);
                let len = read_u32(bytes, offset + 8);
                offset += 12;
                let payload = if inline_ws {
                    let len_usize = len as usize;
                    if offset + len_usize > bytes.len() {
                        return Err(BatchError::Truncated);
                    }
                    let slice = bytes[offset..offset + len_usize].to_vec();
                    offset += len_usize;
                    slice
                } else {
                    resolve_ws(buffer_id, ptr, len)?
                };
                events.push(HostEvent::WsBytes { buffer_id, bytes: payload });
            }
            EVENT_TIMER => {
                if offset + 8 > bytes.len() {
                    return Err(BatchError::Truncated);
                }
                let now_ms = read_u64(bytes, offset);
                offset += 8;
                events.push(HostEvent::Timer { now_ms });
            }
            EVENT_COMMAND => {
                if offset + 4 > bytes.len() {
                    return Err(BatchError::Truncated);
                }
                let cmd = bytes[offset];
                offset += 4;
                let command = decode_command(bytes, &mut offset, cmd)?;
                events.push(HostEvent::Command(command));
            }
            EVENT_RELEASE => {
                if offset + 4 > bytes.len() {
                    return Err(BatchError::Truncated);
                }
                let lease_id = read_u32(bytes, offset);
                offset += 4;
                events.push(HostEvent::ReleaseLease { lease_id });
            }
            _ => return Err(BatchError::BadKind),
        }
    }
    Ok(events)
}

fn decode_command(bytes: &[u8], offset: &mut usize, cmd: u8) -> Result<AppCommand, BatchError> {
    match cmd {
        CMD_START => {
            if *offset + 4 > bytes.len() {
                return Err(BatchError::Truncated);
            }
            let transferable = bytes[*offset] != 0;
            let webtransport = bytes[*offset + 1] != 0;
            *offset += 4;
            Ok(AppCommand::Start { transferable_arraybuffer: transferable, webtransport })
        }
        CMD_AUTHENTICATE => {
            if *offset + 16 + 2 > bytes.len() {
                return Err(BatchError::Truncated);
            }
            let mut correlation = [0u8; 16];
            correlation.copy_from_slice(&bytes[*offset..*offset + 16]);
            *offset += 16;
            let scheme_len = read_u16(bytes, *offset) as usize;
            *offset += 2;
            if *offset + scheme_len + 2 > bytes.len() {
                return Err(BatchError::Truncated);
            }
            let scheme = std::str::from_utf8(&bytes[*offset..*offset + scheme_len])
                .map_err(|_| BatchError::BadKind)?
                .to_owned();
            *offset += scheme_len;
            let token_len = read_u16(bytes, *offset) as usize;
            *offset += 2;
            if *offset + token_len > bytes.len() {
                return Err(BatchError::Truncated);
            }
            let token = bytes[*offset..*offset + token_len].to_vec();
            *offset += token_len;
            Ok(AppCommand::Authenticate { correlation, scheme, token })
        }
        CMD_SUBSCRIBE => {
            if *offset + 16 + 4 + 4 + 2 > bytes.len() {
                return Err(BatchError::Truncated);
            }
            let mut correlation = [0u8; 16];
            correlation.copy_from_slice(&bytes[*offset..*offset + 16]);
            *offset += 16;
            let channel_id = read_u32(bytes, *offset);
            *offset += 4;
            let qos_reliability = bytes[*offset];
            let domain_id = bytes[*offset + 1];
            let qos_depth = u32::from(read_u16(bytes, *offset + 2));
            *offset += 4;
            let topic_len = read_u16(bytes, *offset) as usize;
            *offset += 2;
            if *offset + topic_len + 2 > bytes.len() {
                return Err(BatchError::Truncated);
            }
            let topic = std::str::from_utf8(&bytes[*offset..*offset + topic_len])
                .map_err(|_| BatchError::BadKind)?
                .to_owned();
            *offset += topic_len;
            let type_len = read_u16(bytes, *offset) as usize;
            *offset += 2;
            if *offset + type_len > bytes.len() {
                return Err(BatchError::Truncated);
            }
            let type_name = std::str::from_utf8(&bytes[*offset..*offset + type_len])
                .map_err(|_| BatchError::BadKind)?
                .to_owned();
            *offset += type_len;
            Ok(AppCommand::Subscribe {
                correlation,
                channel_id,
                topic,
                type_name,
                qos_reliability,
                qos_depth,
                domain_id,
            })
        }
        CMD_PUBLISH => {
            if *offset + 16 + 4 + 4 + 2 > bytes.len() {
                return Err(BatchError::Truncated);
            }
            let mut correlation = [0u8; 16];
            correlation.copy_from_slice(&bytes[*offset..*offset + 16]);
            *offset += 16;
            let channel_id = read_u32(bytes, *offset);
            *offset += 4;
            let qos_reliability = bytes[*offset];
            let domain_id = bytes[*offset + 1];
            let qos_depth = u32::from(read_u16(bytes, *offset + 2));
            *offset += 4;
            let topic_len = read_u16(bytes, *offset) as usize;
            *offset += 2;
            if *offset + topic_len + 2 > bytes.len() {
                return Err(BatchError::Truncated);
            }
            let topic = std::str::from_utf8(&bytes[*offset..*offset + topic_len])
                .map_err(|_| BatchError::BadKind)?
                .to_owned();
            *offset += topic_len;
            let type_len = read_u16(bytes, *offset) as usize;
            *offset += 2;
            if *offset + type_len > bytes.len() {
                return Err(BatchError::Truncated);
            }
            let type_name = std::str::from_utf8(&bytes[*offset..*offset + type_len])
                .map_err(|_| BatchError::BadKind)?
                .to_owned();
            *offset += type_len;
            Ok(AppCommand::Publish {
                correlation,
                channel_id,
                topic,
                type_name,
                qos_reliability,
                qos_depth,
                domain_id,
            })
        }
        CMD_SEND_SAMPLE => {
            if *offset + 4 + 4 > bytes.len() {
                return Err(BatchError::Truncated);
            }
            let channel_id = read_u32(bytes, *offset);
            *offset += 4;
            let string_len = read_u32(bytes, *offset) as usize;
            *offset += 4;
            if *offset + string_len > bytes.len() {
                return Err(BatchError::Truncated);
            }
            let string_data = std::str::from_utf8(&bytes[*offset..*offset + string_len])
                .map_err(|_| BatchError::BadKind)?
                .to_owned();
            *offset += string_len;
            Ok(AppCommand::SendSample { channel_id, string_data })
        }
        CMD_OPEN_SERVICE | CMD_OPEN_ACTION => {
            if *offset + 16 + 4 + 4 + 2 > bytes.len() {
                return Err(BatchError::Truncated);
            }
            let mut correlation = [0u8; 16];
            correlation.copy_from_slice(&bytes[*offset..*offset + 16]);
            *offset += 16;
            let channel_id = read_u32(bytes, *offset);
            *offset += 4;
            let client = bytes[*offset] != 0;
            let domain_id = bytes[*offset + 1];
            *offset += 4; // client, domain, pad:u16
            let name_len = read_u16(bytes, *offset) as usize;
            *offset += 2;
            if *offset + name_len + 2 > bytes.len() {
                return Err(BatchError::Truncated);
            }
            let name = std::str::from_utf8(&bytes[*offset..*offset + name_len])
                .map_err(|_| BatchError::BadKind)?
                .to_owned();
            *offset += name_len;
            let type_len = read_u16(bytes, *offset) as usize;
            *offset += 2;
            if *offset + type_len > bytes.len() {
                return Err(BatchError::Truncated);
            }
            let type_name = std::str::from_utf8(&bytes[*offset..*offset + type_len])
                .map_err(|_| BatchError::BadKind)?
                .to_owned();
            *offset += type_len;
            if cmd == CMD_OPEN_SERVICE {
                Ok(AppCommand::OpenService {
                    correlation,
                    channel_id,
                    name,
                    type_name,
                    domain_id,
                    client,
                })
            } else {
                Ok(AppCommand::OpenAction {
                    correlation,
                    channel_id,
                    name,
                    type_name,
                    domain_id,
                    client,
                })
            }
        }
        CMD_CALL_SERVICE => {
            let (channel_id, operation_id, payload) = decode_opid_payload(bytes, offset)?;
            Ok(AppCommand::CallService { channel_id, operation_id, request: payload })
        }
        CMD_SEND_SERVICE_RESPONSE => {
            let (channel_id, operation_id, payload) = decode_opid_payload(bytes, offset)?;
            Ok(AppCommand::SendServiceResponse { channel_id, operation_id, response: payload })
        }
        CMD_SEND_ACTION_GOAL => {
            let (channel_id, operation_id, payload) = decode_opid_payload(bytes, offset)?;
            Ok(AppCommand::SendActionGoal { channel_id, operation_id, goal: payload })
        }
        CMD_CANCEL_ACTION => {
            if *offset + 4 + 16 > bytes.len() {
                return Err(BatchError::Truncated);
            }
            let channel_id = read_u32(bytes, *offset);
            *offset += 4;
            let mut operation_id = [0u8; 16];
            operation_id.copy_from_slice(&bytes[*offset..*offset + 16]);
            *offset += 16;
            Ok(AppCommand::CancelAction { channel_id, operation_id })
        }
        CMD_SEND_ACTION_FEEDBACK => {
            let (channel_id, operation_id, payload) = decode_opid_payload(bytes, offset)?;
            Ok(AppCommand::SendActionFeedback { channel_id, operation_id, feedback: payload })
        }
        CMD_SEND_ACTION_RESULT => {
            let (channel_id, operation_id, payload) = decode_opid_payload(bytes, offset)?;
            Ok(AppCommand::SendActionResult { channel_id, operation_id, result: payload })
        }
        CMD_SEND_ACTION_STATUS => {
            let (channel_id, operation_id, payload) = decode_opid_payload(bytes, offset)?;
            Ok(AppCommand::SendActionStatus { channel_id, operation_id, status: payload })
        }
        CMD_UNSUBSCRIBE => {
            if *offset + 16 + 4 > bytes.len() {
                return Err(BatchError::Truncated);
            }
            let mut correlation = [0u8; 16];
            correlation.copy_from_slice(&bytes[*offset..*offset + 16]);
            *offset += 16;
            let channel_id = read_u32(bytes, *offset);
            *offset += 4;
            Ok(AppCommand::Unsubscribe { correlation, channel_id })
        }
        CMD_CLOSE => Ok(AppCommand::Close),
        _ => Err(BatchError::BadKind),
    }
}

fn decode_opid_payload(
    bytes: &[u8],
    offset: &mut usize,
) -> Result<(u32, [u8; 16], Vec<u8>), BatchError> {
    if *offset + 4 + 16 + 4 > bytes.len() {
        return Err(BatchError::Truncated);
    }
    let channel_id = read_u32(bytes, *offset);
    *offset += 4;
    let mut operation_id = [0u8; 16];
    operation_id.copy_from_slice(&bytes[*offset..*offset + 16]);
    *offset += 16;
    let len = read_u32(bytes, *offset) as usize;
    *offset += 4;
    if *offset + len > bytes.len() {
        return Err(BatchError::Truncated);
    }
    let payload = bytes[*offset..*offset + len].to_vec();
    *offset += len;
    Ok((channel_id, operation_id, payload))
}

/// Encode a poll outcome for the host. `payload_view` maps a sample lease to
/// `(ptr, len)` in wasm linear memory (or returns zeros for inline-only hosts).
pub fn encode_poll_result(
    outcome: &PollOutcome,
    mut payload_view: impl FnMut(u32) -> (u32, u32),
) -> Vec<u8> {
    let mut out = Vec::with_capacity(64);
    write_u32(&mut out, RESULT_MAGIC);
    write_u16(&mut out, LAYOUT_VERSION);
    write_u16(&mut out, 0);
    write_u32(&mut out, outcome.outbound.len() as u32);
    write_u32(&mut out, outcome.events.len() as u32);
    write_u32(&mut out, outcome.released_buffers.len() as u32);
    match outcome.next_deadline_ms {
        Some(ms) => write_i64(&mut out, ms as i64),
        None => write_i64(&mut out, -1),
    }
    for msg in &outcome.outbound {
        encode_outbound(&mut out, msg);
    }
    for event in &outcome.events {
        encode_app_event(&mut out, event, &mut payload_view);
    }
    for released in &outcome.released_buffers {
        encode_released(&mut out, released);
    }
    out
}

fn encode_outbound(out: &mut Vec<u8>, msg: &OutboundMessage) {
    write_u32(out, msg.buffer_id);
    // Native / pre-wasm path: ptr unused (0); host uses the following inline bytes.
    write_u32(out, 0);
    write_u32(out, msg.bytes.len() as u32);
    out.extend_from_slice(&msg.bytes);
}

fn encode_released(out: &mut Vec<u8>, released: &ReleasedBuffer) {
    write_u32(out, released.buffer_id);
    write_u32(out, released.len);
}

fn encode_app_event(
    out: &mut Vec<u8>,
    event: &AppEvent,
    payload_view: &mut impl FnMut(u32) -> (u32, u32),
) {
    match event {
        AppEvent::BootstrapComplete { selected_wire_version } => {
            out.extend_from_slice(&[APP_BOOTSTRAP_COMPLETE, 0, 0, 0]);
            out.extend_from_slice(&[*selected_wire_version, 0, 0, 0]);
        }
        AppEvent::SessionReady { support_row, domain_id, gateway_instance_id } => {
            out.extend_from_slice(&[APP_SESSION_READY, 0, 0, 0]);
            out.extend_from_slice(&[*domain_id, 0, 0, 0]);
            write_u16(out, support_row.len() as u16);
            out.extend_from_slice(support_row.as_bytes());
            write_u16(out, gateway_instance_id.len() as u16);
            out.extend_from_slice(gateway_instance_id.as_bytes());
        }
        AppEvent::Subscribed { channel_id, topic, type_name } => {
            out.extend_from_slice(&[APP_SUBSCRIBED, 0, 0, 0]);
            write_u32(out, *channel_id);
            write_u16(out, topic.len() as u16);
            out.extend_from_slice(topic.as_bytes());
            write_u16(out, type_name.len() as u16);
            out.extend_from_slice(type_name.as_bytes());
        }
        AppEvent::SubscribeFailed { channel_id, code, message } => {
            out.extend_from_slice(&[APP_SUBSCRIBE_FAILED, 0, 0, 0]);
            write_u32(out, *channel_id);
            out.extend_from_slice(&[*code, 0, 0, 0]);
            write_u16(out, message.len() as u16);
            out.extend_from_slice(message.as_bytes());
        }
        AppEvent::Published { channel_id, topic, type_name, qos_reliability } => {
            out.extend_from_slice(&[APP_PUBLISHED, 0, 0, 0]);
            write_u32(out, *channel_id);
            out.extend_from_slice(&[*qos_reliability, 0, 0, 0]);
            write_u16(out, topic.len() as u16);
            out.extend_from_slice(topic.as_bytes());
            write_u16(out, type_name.len() as u16);
            out.extend_from_slice(type_name.as_bytes());
        }
        AppEvent::PublishFailed { channel_id, code, message } => {
            out.extend_from_slice(&[APP_PUBLISH_FAILED, 0, 0, 0]);
            write_u32(out, *channel_id);
            out.extend_from_slice(&[*code, 0, 0, 0]);
            write_u16(out, message.len() as u16);
            out.extend_from_slice(message.as_bytes());
        }
        AppEvent::Sample { channel_id, lease_id, sequence, source_time_ns, string_data } => {
            out.extend_from_slice(&[APP_SAMPLE, 0, 0, 0]);
            write_u32(out, *channel_id);
            write_u32(out, *lease_id);
            write_u64(out, *sequence);
            write_i64(out, *source_time_ns);
            let (ptr, len) = payload_view(*lease_id);
            write_u32(out, ptr);
            write_u32(out, len);
            match string_data {
                Some(s) => {
                    write_i32(out, s.len() as i32);
                    out.extend_from_slice(s.as_bytes());
                }
                None => write_i32(out, -1),
            }
        }
        AppEvent::Heartbeat { counter } => {
            out.extend_from_slice(&[APP_HEARTBEAT, 0, 0, 0]);
            write_u64(out, *counter);
        }
        AppEvent::Error { code, message } => {
            out.extend_from_slice(&[APP_ERROR, 0, 0, 0]);
            out.extend_from_slice(&[*code, 0, 0, 0]);
            write_u16(out, message.len() as u16);
            out.extend_from_slice(message.as_bytes());
        }
        AppEvent::Closed { phase } => {
            out.extend_from_slice(&[APP_CLOSED, 0, 0, 0]);
            out.extend_from_slice(&[phase_to_u8(*phase), 0, 0, 0]);
        }
        AppEvent::ServiceReady { channel_id, name, type_name, client } => {
            out.extend_from_slice(&[APP_SERVICE_READY, 0, 0, 0]);
            write_u32(out, *channel_id);
            out.extend_from_slice(&[u8::from(*client), 0, 0, 0]);
            write_u16(out, name.len() as u16);
            out.extend_from_slice(name.as_bytes());
            write_u16(out, type_name.len() as u16);
            out.extend_from_slice(type_name.as_bytes());
        }
        AppEvent::ServiceFailed { channel_id, code, message } => {
            out.extend_from_slice(&[APP_SERVICE_FAILED, 0, 0, 0]);
            write_u32(out, *channel_id);
            out.extend_from_slice(&[*code, 0, 0, 0]);
            write_u16(out, message.len() as u16);
            out.extend_from_slice(message.as_bytes());
        }
        AppEvent::ServiceRequest { channel_id, operation_id, lease_id, sequence } => {
            encode_leased_opid_event(
                out,
                APP_SERVICE_REQUEST,
                *channel_id,
                operation_id,
                *lease_id,
                *sequence,
                payload_view,
            );
        }
        AppEvent::ServiceResponse { channel_id, operation_id, lease_id, sequence } => {
            encode_leased_opid_event(
                out,
                APP_SERVICE_RESPONSE,
                *channel_id,
                operation_id,
                *lease_id,
                *sequence,
                payload_view,
            );
        }
        AppEvent::ActionReady { channel_id, name, type_name, client } => {
            out.extend_from_slice(&[APP_ACTION_READY, 0, 0, 0]);
            write_u32(out, *channel_id);
            out.extend_from_slice(&[u8::from(*client), 0, 0, 0]);
            write_u16(out, name.len() as u16);
            out.extend_from_slice(name.as_bytes());
            write_u16(out, type_name.len() as u16);
            out.extend_from_slice(type_name.as_bytes());
        }
        AppEvent::ActionFailed { channel_id, code, message } => {
            out.extend_from_slice(&[APP_ACTION_FAILED, 0, 0, 0]);
            write_u32(out, *channel_id);
            out.extend_from_slice(&[*code, 0, 0, 0]);
            write_u16(out, message.len() as u16);
            out.extend_from_slice(message.as_bytes());
        }
        AppEvent::ActionGoal { channel_id, operation_id, lease_id, sequence } => {
            encode_leased_opid_event(
                out,
                APP_ACTION_GOAL,
                *channel_id,
                operation_id,
                *lease_id,
                *sequence,
                payload_view,
            );
        }
        AppEvent::ActionFeedback { channel_id, operation_id, lease_id, sequence } => {
            encode_leased_opid_event(
                out,
                APP_ACTION_FEEDBACK,
                *channel_id,
                operation_id,
                *lease_id,
                *sequence,
                payload_view,
            );
        }
        AppEvent::ActionResult { channel_id, operation_id, lease_id, sequence } => {
            encode_leased_opid_event(
                out,
                APP_ACTION_RESULT,
                *channel_id,
                operation_id,
                *lease_id,
                *sequence,
                payload_view,
            );
        }
        AppEvent::ActionStatus { channel_id, operation_id, lease_id, sequence } => {
            encode_leased_opid_event(
                out,
                APP_ACTION_STATUS,
                *channel_id,
                operation_id,
                *lease_id,
                *sequence,
                payload_view,
            );
        }
        AppEvent::GraphSnapshot { generation, nodes_json, endpoints_json } => {
            out.extend_from_slice(&[APP_GRAPH_SNAPSHOT, 0, 0, 0]);
            write_u64(out, *generation);
            write_u32(out, nodes_json.len() as u32);
            out.extend_from_slice(nodes_json.as_bytes());
            write_u32(out, endpoints_json.len() as u32);
            out.extend_from_slice(endpoints_json.as_bytes());
        }
        AppEvent::GraphDelta { generation } => {
            out.extend_from_slice(&[APP_GRAPH_DELTA, 0, 0, 0]);
            write_u64(out, *generation);
        }
        AppEvent::OperationCancelled { channel_id, code, message } => {
            out.extend_from_slice(&[APP_OPERATION_CANCELLED, 0, 0, 0]);
            write_u32(out, *channel_id);
            out.extend_from_slice(&[*code, 0, 0, 0]);
            write_u16(out, message.len() as u16);
            out.extend_from_slice(message.as_bytes());
        }
    }
}

fn encode_leased_opid_event(
    out: &mut Vec<u8>,
    kind: u8,
    channel_id: u32,
    operation_id: &[u8; 16],
    lease_id: u32,
    sequence: u64,
    payload_view: &mut impl FnMut(u32) -> (u32, u32),
) {
    out.extend_from_slice(&[kind, 0, 0, 0]);
    write_u32(out, channel_id);
    out.extend_from_slice(operation_id);
    write_u32(out, lease_id);
    write_u64(out, sequence);
    let (ptr, len) = payload_view(lease_id);
    write_u32(out, ptr);
    write_u32(out, len);
}

fn phase_to_u8(phase: SessionPhase) -> u8 {
    match phase {
        SessionPhase::AwaitClientHello => 0,
        SessionPhase::AwaitServerHello => 1,
        SessionPhase::SelectedAwaitAuthenticate => 2,
        SessionPhase::SelectedAwaitSessionReady => 3,
        SessionPhase::Ready => 4,
        SessionPhase::BootstrapFailed => 5,
        SessionPhase::Failed => 6,
    }
}

/// Encode a host batch with inline WS payloads (native tests / scripted hosts).
pub fn encode_host_batch_inline(events: &[HostEvent]) -> Vec<u8> {
    let mut out = Vec::new();
    write_u32(&mut out, BATCH_MAGIC);
    write_u16(&mut out, LAYOUT_VERSION);
    write_u16(&mut out, FLAG_INLINE_WS_BYTES);
    write_u32(&mut out, events.len() as u32);
    for event in events {
        match event {
            HostEvent::WsBytes { buffer_id, bytes } => {
                out.extend_from_slice(&[EVENT_WS_BYTES, 0, 0, 0]);
                write_u32(&mut out, *buffer_id);
                write_u32(&mut out, 0);
                write_u32(&mut out, bytes.len() as u32);
                out.extend_from_slice(bytes);
            }
            HostEvent::Timer { now_ms } => {
                out.extend_from_slice(&[EVENT_TIMER, 0, 0, 0]);
                write_u64(&mut out, *now_ms);
            }
            HostEvent::Command(cmd) => {
                out.extend_from_slice(&[EVENT_COMMAND, 0, 0, 0]);
                encode_command(&mut out, cmd);
            }
            HostEvent::ReleaseLease { lease_id } => {
                out.extend_from_slice(&[EVENT_RELEASE, 0, 0, 0]);
                write_u32(&mut out, *lease_id);
            }
        }
    }
    out
}

fn encode_command(out: &mut Vec<u8>, cmd: &AppCommand) {
    match cmd {
        AppCommand::Start { transferable_arraybuffer, webtransport } => {
            out.extend_from_slice(&[CMD_START, 0, 0, 0]);
            out.extend_from_slice(&[
                u8::from(*transferable_arraybuffer),
                u8::from(*webtransport),
                0,
                0,
            ]);
        }
        AppCommand::Authenticate { correlation, scheme, token } => {
            out.extend_from_slice(&[CMD_AUTHENTICATE, 0, 0, 0]);
            out.extend_from_slice(correlation);
            write_u16(out, scheme.len() as u16);
            out.extend_from_slice(scheme.as_bytes());
            write_u16(out, token.len() as u16);
            out.extend_from_slice(token);
        }
        AppCommand::Subscribe {
            correlation,
            channel_id,
            topic,
            type_name,
            qos_reliability,
            qos_depth,
            domain_id,
        } => {
            out.extend_from_slice(&[CMD_SUBSCRIBE, 0, 0, 0]);
            out.extend_from_slice(correlation);
            write_u32(out, *channel_id);
            let depth = (*qos_depth).min(u32::from(u16::MAX)) as u16;
            out.extend_from_slice(&[*qos_reliability, *domain_id]);
            write_u16(out, depth);
            write_u16(out, topic.len() as u16);
            out.extend_from_slice(topic.as_bytes());
            write_u16(out, type_name.len() as u16);
            out.extend_from_slice(type_name.as_bytes());
        }
        AppCommand::Publish {
            correlation,
            channel_id,
            topic,
            type_name,
            qos_reliability,
            qos_depth,
            domain_id,
        } => {
            out.extend_from_slice(&[CMD_PUBLISH, 0, 0, 0]);
            out.extend_from_slice(correlation);
            write_u32(out, *channel_id);
            let depth = (*qos_depth).min(u32::from(u16::MAX)) as u16;
            out.extend_from_slice(&[*qos_reliability, *domain_id]);
            write_u16(out, depth);
            write_u16(out, topic.len() as u16);
            out.extend_from_slice(topic.as_bytes());
            write_u16(out, type_name.len() as u16);
            out.extend_from_slice(type_name.as_bytes());
        }
        AppCommand::SendSample { channel_id, string_data } => {
            out.extend_from_slice(&[CMD_SEND_SAMPLE, 0, 0, 0]);
            write_u32(out, *channel_id);
            write_u32(out, string_data.len() as u32);
            out.extend_from_slice(string_data.as_bytes());
        }
        AppCommand::OpenService { correlation, channel_id, name, type_name, domain_id, client } => {
            encode_open_service_or_action(
                out,
                CMD_OPEN_SERVICE,
                correlation,
                *channel_id,
                *client,
                *domain_id,
                name,
                type_name,
            );
        }
        AppCommand::OpenAction { correlation, channel_id, name, type_name, domain_id, client } => {
            encode_open_service_or_action(
                out,
                CMD_OPEN_ACTION,
                correlation,
                *channel_id,
                *client,
                *domain_id,
                name,
                type_name,
            );
        }
        AppCommand::CallService { channel_id, operation_id, request } => {
            encode_opid_payload(out, CMD_CALL_SERVICE, *channel_id, operation_id, request);
        }
        AppCommand::SendServiceResponse { channel_id, operation_id, response } => {
            encode_opid_payload(
                out,
                CMD_SEND_SERVICE_RESPONSE,
                *channel_id,
                operation_id,
                response,
            );
        }
        AppCommand::SendActionGoal { channel_id, operation_id, goal } => {
            encode_opid_payload(out, CMD_SEND_ACTION_GOAL, *channel_id, operation_id, goal);
        }
        AppCommand::CancelAction { channel_id, operation_id } => {
            out.extend_from_slice(&[CMD_CANCEL_ACTION, 0, 0, 0]);
            write_u32(out, *channel_id);
            out.extend_from_slice(operation_id);
        }
        AppCommand::SendActionFeedback { channel_id, operation_id, feedback } => {
            encode_opid_payload(out, CMD_SEND_ACTION_FEEDBACK, *channel_id, operation_id, feedback);
        }
        AppCommand::SendActionResult { channel_id, operation_id, result } => {
            encode_opid_payload(out, CMD_SEND_ACTION_RESULT, *channel_id, operation_id, result);
        }
        AppCommand::SendActionStatus { channel_id, operation_id, status } => {
            encode_opid_payload(out, CMD_SEND_ACTION_STATUS, *channel_id, operation_id, status);
        }
        AppCommand::Unsubscribe { correlation, channel_id } => {
            out.extend_from_slice(&[CMD_UNSUBSCRIBE, 0, 0, 0]);
            out.extend_from_slice(correlation);
            write_u32(out, *channel_id);
        }
        AppCommand::Close => {
            out.extend_from_slice(&[CMD_CLOSE, 0, 0, 0]);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn encode_open_service_or_action(
    out: &mut Vec<u8>,
    cmd: u8,
    correlation: &[u8; 16],
    channel_id: u32,
    client: bool,
    domain_id: u8,
    name: &str,
    type_name: &str,
) {
    out.extend_from_slice(&[cmd, 0, 0, 0]);
    out.extend_from_slice(correlation);
    write_u32(out, channel_id);
    out.extend_from_slice(&[u8::from(client), domain_id, 0, 0]);
    write_u16(out, name.len() as u16);
    out.extend_from_slice(name.as_bytes());
    write_u16(out, type_name.len() as u16);
    out.extend_from_slice(type_name.as_bytes());
}

fn encode_opid_payload(
    out: &mut Vec<u8>,
    cmd: u8,
    channel_id: u32,
    operation_id: &[u8; 16],
    payload: &[u8],
) {
    out.extend_from_slice(&[cmd, 0, 0, 0]);
    write_u32(out, channel_id);
    out.extend_from_slice(operation_id);
    write_u32(out, payload.len() as u32);
    out.extend_from_slice(payload);
}

pub fn read_u16(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}

pub fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]])
}

pub fn read_u64(bytes: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
        bytes[offset + 4],
        bytes[offset + 5],
        bytes[offset + 6],
        bytes[offset + 7],
    ])
}

pub fn write_u16(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_le_bytes());
}

pub fn write_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

pub fn write_u64(out: &mut Vec<u8>, value: u64) {
    out.extend_from_slice(&value.to_le_bytes());
}

pub fn write_i32(out: &mut Vec<u8>, value: i32) {
    out.extend_from_slice(&value.to_le_bytes());
}

pub fn write_i64(out: &mut Vec<u8>, value: i64) {
    out.extend_from_slice(&value.to_le_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{AppCommand, HostEvent};

    #[test]
    fn inline_batch_round_trip() {
        let events = vec![
            HostEvent::Command(AppCommand::Start {
                transferable_arraybuffer: true,
                webtransport: false,
            }),
            HostEvent::WsBytes { buffer_id: 9, bytes: b"hello".to_vec() },
            HostEvent::Timer { now_ms: 42 },
            HostEvent::ReleaseLease { lease_id: 3 },
        ];
        let encoded = encode_host_batch_inline(&events);
        let decoded = decode_host_batch(&encoded, |_, _, _| Err(BatchError::BadKind)).unwrap();
        assert_eq!(decoded.len(), 4);
        match &decoded[1] {
            HostEvent::WsBytes { buffer_id, bytes } => {
                assert_eq!(*buffer_id, 9);
                assert_eq!(bytes, b"hello");
            }
            _ => panic!("expected ws bytes"),
        }
    }

    #[test]
    fn service_and_action_commands_round_trip() {
        let corr = [0xABu8; 16];
        let opid = [0x11u8; 16];
        let events = vec![
            HostEvent::Command(AppCommand::OpenService {
                correlation: corr,
                channel_id: 3,
                name: "/add".into(),
                type_name: "example_interfaces/srv/AddTwoInts".into(),
                domain_id: 0,
                client: true,
            }),
            HostEvent::Command(AppCommand::CallService {
                channel_id: 3,
                operation_id: opid,
                request: b"req".to_vec(),
            }),
            HostEvent::Command(AppCommand::OpenAction {
                correlation: corr,
                channel_id: 4,
                name: "/fib".into(),
                type_name: "example_interfaces/action/Fibonacci".into(),
                domain_id: 0,
                client: false,
            }),
            HostEvent::Command(AppCommand::CancelAction { channel_id: 4, operation_id: opid }),
        ];
        let encoded = encode_host_batch_inline(&events);
        let decoded = decode_host_batch(&encoded, |_, _, _| Err(BatchError::BadKind)).unwrap();
        assert_eq!(decoded.len(), 4);
        match &decoded[0] {
            HostEvent::Command(AppCommand::OpenService { channel_id, client, name, .. }) => {
                assert_eq!(*channel_id, 3);
                assert!(*client);
                assert_eq!(name, "/add");
            }
            _ => panic!("expected OpenService"),
        }
        match &decoded[1] {
            HostEvent::Command(AppCommand::CallService { channel_id, operation_id, request }) => {
                assert_eq!(*channel_id, 3);
                assert_eq!(*operation_id, opid);
                assert_eq!(request, b"req");
            }
            _ => panic!("expected CallService"),
        }
        match &decoded[2] {
            HostEvent::Command(AppCommand::OpenAction { client, .. }) => {
                assert!(!*client);
            }
            _ => panic!("expected OpenAction"),
        }
        match &decoded[3] {
            HostEvent::Command(AppCommand::CancelAction { channel_id, .. }) => {
                assert_eq!(*channel_id, 4);
            }
            _ => panic!("expected CancelAction"),
        }
    }
}
