//! Minimal safe wrapper over the serialized-only rcl surface.
//!
//! Ownership contract: every entity here is created, used, and finalized on
//! the single ROS attachment thread ([`super::backend`]); only the
//! guard-condition trigger crosses threads (rcl documents triggering as
//! thread-safe against `rcl_wait`). Nothing in this module parses message
//! bodies — payloads stay serialized CDR end to end.

#![allow(unsafe_code)]

use super::ffi::bindings as b;
use super::typesupport::{ActionTypeSupport, MessageTypeSupport, ServiceTypeSupport};
use crate::qos::EffectiveQos;
use std::ffi::{CStr, CString};
use std::os::raw::c_void;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const RCL_OK: b::rcl_ret_t = b::RCL_RET_OK as b::rcl_ret_t;
const RCL_TIMEOUT: b::rcl_ret_t = b::RCL_RET_TIMEOUT as b::rcl_ret_t;
const RMW_OK: b::rmw_ret_t = b::RMW_RET_OK as b::rmw_ret_t;

pub const RCL_TAKE_FAILED: b::rcl_ret_t = b::RCL_RET_SUBSCRIPTION_TAKE_FAILED as b::rcl_ret_t;
pub const RCL_CLIENT_TAKE_FAILED: b::rcl_ret_t = b::RCL_RET_CLIENT_TAKE_FAILED as b::rcl_ret_t;
pub const RCL_SERVICE_TAKE_FAILED: b::rcl_ret_t = b::RCL_RET_SERVICE_TAKE_FAILED as b::rcl_ret_t;
pub const RCL_ACTION_CLIENT_TAKE_FAILED: b::rcl_ret_t =
    b::RCL_RET_ACTION_CLIENT_TAKE_FAILED as b::rcl_ret_t;

/// rcl call failure with the drained rcutils error string.
#[derive(Debug, Clone)]
pub struct RclError {
    pub ret: b::rcl_ret_t,
    pub message: String,
}

impl std::fmt::Display for RclError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "rcl error {}: {}", self.ret, self.message)
    }
}

impl std::error::Error for RclError {}

fn drain_error_string() -> String {
    // SAFETY: plain value returns; reset clears thread-local error state.
    let raw = unsafe { b::rcutils_get_error_string() };
    unsafe { b::rcutils_reset_error() };
    let bytes: Vec<u8> = raw
        .str_
        .iter()
        .take_while(|c| **c != 0)
        .map(|c| *c as u8)
        .collect();
    String::from_utf8_lossy(&bytes).into_owned()
}

fn check(ret: b::rcl_ret_t, operation: &str) -> Result<(), RclError> {
    if ret == RCL_OK {
        Ok(())
    } else {
        Err(RclError {
            ret,
            message: format!("{operation}: {}", drain_error_string()),
        })
    }
}

fn check_rmw(ret: b::rmw_ret_t, operation: &str) -> Result<(), RclError> {
    if ret == RMW_OK {
        Ok(())
    } else {
        Err(RclError {
            ret,
            message: format!("{operation}: {}", drain_error_string()),
        })
    }
}

fn allocator() -> b::rcutils_allocator_t {
    // SAFETY: returns the process default allocator by value.
    unsafe { b::rcutils_get_default_allocator() }
}

/// Concrete effective QoS → rmw profile.
fn rmw_profile(qos: &EffectiveQos) -> b::rmw_qos_profile_t {
    b::rmw_qos_profile_t {
        history: if qos.keep_all {
            b::RMW_QOS_POLICY_HISTORY_KEEP_ALL
        } else {
            b::RMW_QOS_POLICY_HISTORY_KEEP_LAST
        },
        depth: qos.depth as usize,
        reliability: if qos.reliable {
            b::RMW_QOS_POLICY_RELIABILITY_RELIABLE
        } else {
            b::RMW_QOS_POLICY_RELIABILITY_BEST_EFFORT
        },
        durability: if qos.transient_local {
            b::RMW_QOS_POLICY_DURABILITY_TRANSIENT_LOCAL
        } else {
            b::RMW_QOS_POLICY_DURABILITY_VOLATILE
        },
        deadline: b::rmw_time_s { sec: 0, nsec: 0 },
        lifespan: b::rmw_time_s { sec: 0, nsec: 0 },
        liveliness: if qos.manual_by_topic {
            b::RMW_QOS_POLICY_LIVELINESS_MANUAL_BY_TOPIC
        } else {
            b::RMW_QOS_POLICY_LIVELINESS_AUTOMATIC
        },
        liveliness_lease_duration: b::rmw_time_s { sec: 0, nsec: 0 },
        avoid_ros_namespace_conventions: false,
    }
}

/// Allocate one ROS message via typesupport create.
pub fn allocate_message(ts: MessageTypeSupport) -> Result<*mut c_void, RclError> {
    // SAFETY: create is the rosidl generator hook for this message type.
    let ptr = unsafe { (ts.create)() };
    if ptr.is_null() {
        return Err(RclError {
            ret: -1,
            message: "message create returned null".to_owned(),
        });
    }
    Ok(ptr)
}

/// Destroy a message allocated with [`allocate_message`].
pub fn destroy_message(ts: MessageTypeSupport, ptr: *mut c_void) {
    if !ptr.is_null() {
        // SAFETY: destroy pairs with create for the same type.
        unsafe { (ts.destroy)(ptr) };
    }
}

/// Deserialize CDR into an already-allocated ROS message.
pub fn deserialize_into(
    ts: MessageTypeSupport,
    cdr: &[u8],
    msg: *mut c_void,
) -> Result<(), RclError> {
    // SAFETY: serialized view borrows `cdr` for the call only.
    unsafe {
        let serialized = b::rcl_serialized_message_t {
            buffer: cdr.as_ptr().cast_mut(),
            buffer_length: cdr.len(),
            buffer_capacity: cdr.len(),
            allocator: allocator(),
        };
        check_rmw(
            b::rmw_deserialize(&serialized, ts.handle, msg),
            "rmw_deserialize",
        )
    }
}

/// Serialize a ROS message into a fresh CDR byte vector.
pub fn serialize_message(ts: MessageTypeSupport, msg: *const c_void) -> Result<Vec<u8>, RclError> {
    let mut scratch = TakeBuffer::new()?;
    // SAFETY: scratch owns a valid uint8 array; msg is a live ROS message.
    unsafe {
        check_rmw(
            b::rmw_serialize(msg, ts.handle, &mut scratch.array),
            "rmw_serialize",
        )?;
    }
    Ok(scratch.as_slice().to_vec())
}

/// Context + node pair (init and domain attachment).
pub struct Attachment {
    context: Box<b::rcl_context_t>,
    node: Box<b::rcl_node_t>,
}

impl Attachment {
    /// `rcl_init` + `rcl_node_init` on `domain_id`.
    pub fn init(domain_id: usize, node_name: &str) -> Result<Self, RclError> {
        let name = CString::new(node_name).expect("node name without NUL");
        let namespace = CString::new("/").expect("static namespace");

        // SAFETY: zero-initialized structs per the documented rcl init
        // sequence; options are finalized on every path after rcl_init copies
        // them into the context.
        unsafe {
            let mut init_options = b::rcl_get_zero_initialized_init_options();
            check(
                b::rcl_init_options_init(&mut init_options, allocator()),
                "rcl_init_options_init",
            )?;
            let result = (|| {
                check(
                    b::rcl_init_options_set_domain_id(&mut init_options, domain_id),
                    "rcl_init_options_set_domain_id",
                )?;
                let mut context = Box::new(b::rcl_get_zero_initialized_context());
                check(
                    b::rcl_init(0, std::ptr::null(), &init_options, context.as_mut()),
                    "rcl_init",
                )?;
                let mut node = Box::new(b::rcl_get_zero_initialized_node());
                let node_options = b::rcl_node_get_default_options();
                let node_ret = b::rcl_node_init(
                    node.as_mut(),
                    name.as_ptr(),
                    namespace.as_ptr(),
                    context.as_mut(),
                    &node_options,
                );
                if let Err(err) = check(node_ret, "rcl_node_init") {
                    let _ = b::rcl_shutdown(context.as_mut());
                    let _ = b::rcl_context_fini(context.as_mut());
                    return Err(err);
                }
                Ok(Self { context, node })
            })();
            let _ = b::rcl_init_options_fini(&mut init_options);
            result
        }
    }

    pub fn node_ptr(&mut self) -> *mut b::rcl_node_t {
        self.node.as_mut()
    }

    pub fn context_ptr(&mut self) -> *mut b::rcl_context_t {
        self.context.as_mut()
    }

    /// Graph query: all visible topic names with their types.
    pub fn topic_names_and_types(&mut self) -> Result<Vec<(String, Vec<String>)>, RclError> {
        names_and_types(
            self.node.as_ref(),
            b::rcl_get_topic_names_and_types,
            "rcl_get_topic_names_and_types",
            false,
        )
    }

    /// Graph query: all visible service names with their types.
    pub fn service_names_and_types(&mut self) -> Result<Vec<(String, Vec<String>)>, RclError> {
        names_and_types(
            self.node.as_ref(),
            service_names_fn,
            "rcl_get_service_names_and_types",
            false,
        )
    }

    /// Finalize node then context. Call after all entities are finalized.
    pub fn fini(mut self) {
        // SAFETY: reverse-order teardown per rcl lifecycle.
        unsafe {
            let _ = b::rcl_node_fini(self.node.as_mut());
            let _ = b::rcl_shutdown(self.context.as_mut());
            let _ = b::rcl_context_fini(self.context.as_mut());
        }
    }
}

unsafe extern "C" fn service_names_fn(
    node: *const b::rcl_node_t,
    allocator: *mut b::rcutils_allocator_t,
    no_demangle: bool,
    names_and_types: *mut b::rcl_names_and_types_t,
) -> b::rcl_ret_t {
    let _ = no_demangle;
    unsafe { b::rcl_get_service_names_and_types(node, allocator, names_and_types) }
}

fn names_and_types(
    node: *const b::rcl_node_t,
    query: unsafe extern "C" fn(
        *const b::rcl_node_t,
        *mut b::rcutils_allocator_t,
        bool,
        *mut b::rcl_names_and_types_t,
    ) -> b::rcl_ret_t,
    operation: &'static str,
    no_demangle: bool,
) -> Result<Vec<(String, Vec<String>)>, RclError> {
    // SAFETY: zero-initialized out-struct; fini after copying out.
    unsafe {
        let mut names_and_types = b::rmw_get_zero_initialized_names_and_types();
        let mut alloc = allocator();
        check(
            query(node, &mut alloc, no_demangle, &mut names_and_types),
            operation,
        )?;
        let mut out = Vec::with_capacity(names_and_types.names.size);
        for i in 0..names_and_types.names.size {
            let name_ptr = *names_and_types.names.data.add(i);
            let name = CStr::from_ptr(name_ptr).to_string_lossy().into_owned();
            let types_array = &*names_and_types.types.add(i);
            let mut types = Vec::with_capacity(types_array.size);
            for j in 0..types_array.size {
                let type_ptr = *types_array.data.add(j);
                types.push(CStr::from_ptr(type_ptr).to_string_lossy().into_owned());
            }
            out.push((name, types));
        }
        let _ = b::rcl_names_and_types_fini(&mut names_and_types);
        Ok(out)
    }
}

/// Serialized-only publisher.
pub struct SerializedPublisher {
    publisher: Box<b::rcl_publisher_t>,
}

impl SerializedPublisher {
    pub fn create(
        attachment: &mut Attachment,
        topic: &str,
        type_support: *const b::rosidl_message_type_support_t,
        qos: &EffectiveQos,
    ) -> Result<Self, RclError> {
        let topic_c = CString::new(topic).map_err(|_| RclError {
            ret: -1,
            message: "topic name contains NUL".to_owned(),
        })?;
        // SAFETY: documented publisher init sequence; options embed the QoS
        // profile by value.
        unsafe {
            let mut publisher = Box::new(b::rcl_get_zero_initialized_publisher());
            let mut options = b::rcl_publisher_get_default_options();
            options.qos = rmw_profile(qos);
            check(
                b::rcl_publisher_init(
                    publisher.as_mut(),
                    attachment.node_ptr(),
                    type_support,
                    topic_c.as_ptr(),
                    &options,
                ),
                "rcl_publisher_init",
            )?;
            Ok(Self { publisher })
        }
    }

    /// Publish one already-serialized CDR message (`rcl_publish_serialized_message`).
    pub fn publish(&mut self, payload: &[u8]) -> Result<(), RclError> {
        // SAFETY: the serialized-message view borrows `payload` for the call
        // only; rcl treats it as const input.
        unsafe {
            let message = b::rcl_serialized_message_t {
                buffer: payload.as_ptr().cast_mut(),
                buffer_length: payload.len(),
                buffer_capacity: payload.len(),
                allocator: allocator(),
            };
            check(
                b::rcl_publish_serialized_message(
                    self.publisher.as_ref(),
                    &message,
                    std::ptr::null_mut(),
                ),
                "rcl_publish_serialized_message",
            )
        }
    }

    pub fn fini(mut self, attachment: &mut Attachment) {
        // SAFETY: publisher outlived by node until this call.
        unsafe {
            let _ = b::rcl_publisher_fini(self.publisher.as_mut(), attachment.node_ptr());
        }
    }
}

/// Serialized-only subscription.
pub struct SerializedSubscription {
    subscription: Box<b::rcl_subscription_t>,
}

impl SerializedSubscription {
    pub fn create(
        attachment: &mut Attachment,
        topic: &str,
        type_support: *const b::rosidl_message_type_support_t,
        qos: &EffectiveQos,
    ) -> Result<Self, RclError> {
        let topic_c = CString::new(topic).map_err(|_| RclError {
            ret: -1,
            message: "topic name contains NUL".to_owned(),
        })?;
        // SAFETY: documented subscription init sequence.
        unsafe {
            let mut subscription = Box::new(b::rcl_get_zero_initialized_subscription());
            let mut options = b::rcl_subscription_get_default_options();
            options.qos = rmw_profile(qos);
            check(
                b::rcl_subscription_init(
                    subscription.as_mut(),
                    attachment.node_ptr(),
                    type_support,
                    topic_c.as_ptr(),
                    &options,
                ),
                "rcl_subscription_init",
            )?;
            Ok(Self { subscription })
        }
    }

    pub fn raw(&self) -> *const b::rcl_subscription_t {
        self.subscription.as_ref()
    }

    /// Take one serialized message into `scratch`. `Ok(true)` when a message
    /// was taken, `Ok(false)` when the queue is empty.
    pub fn take_serialized(&mut self, scratch: &mut TakeBuffer) -> Result<bool, RclError> {
        // SAFETY: scratch owns an initialized uint8 array that rcl resizes
        // with its stored allocator as needed.
        unsafe {
            let ret = b::rcl_take_serialized_message(
                self.subscription.as_ref(),
                &mut scratch.array,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            );
            if ret == RCL_TAKE_FAILED {
                // Not an error: nothing queued.
                b::rcutils_reset_error();
                return Ok(false);
            }
            check(ret, "rcl_take_serialized_message")?;
            Ok(true)
        }
    }

    pub fn fini(mut self, attachment: &mut Attachment) {
        // SAFETY: subscription outlived by node until this call.
        unsafe {
            let _ = b::rcl_subscription_fini(self.subscription.as_mut(), attachment.node_ptr());
        }
    }
}

/// Serialized service client.
pub struct SerializedClient {
    client: Box<b::rcl_client_t>,
}

impl SerializedClient {
    pub fn create(
        attachment: &mut Attachment,
        service_name: &str,
        type_support: ServiceTypeSupport,
        qos: &EffectiveQos,
    ) -> Result<Self, RclError> {
        let name_c = CString::new(service_name).map_err(|_| RclError {
            ret: -1,
            message: "service name contains NUL".to_owned(),
        })?;
        // SAFETY: documented client init sequence.
        unsafe {
            let mut client = Box::new(b::rcl_get_zero_initialized_client());
            let mut options = b::rcl_client_get_default_options();
            options.qos = rmw_profile(qos);
            check(
                b::rcl_client_init(
                    client.as_mut(),
                    attachment.node_ptr(),
                    type_support.handle,
                    name_c.as_ptr(),
                    &options,
                ),
                "rcl_client_init",
            )?;
            Ok(Self { client })
        }
    }

    #[allow(dead_code)]
    pub fn raw(&self) -> *const b::rcl_client_t {
        self.client.as_ref()
    }

    /// Send `request_cdr`, wait up to `timeout`, return response CDR.
    ///
    /// `pump` is invoked each loop iteration so the worker can service other
    /// entities (for example a loopback service server) while waiting.
    #[allow(clippy::too_many_arguments)]
    pub fn call_with_pump<F>(
        &self,
        context: *mut b::rcl_context_t,
        guard: *const b::rcl_guard_condition_t,
        request_ts: MessageTypeSupport,
        response_ts: MessageTypeSupport,
        request_cdr: &[u8],
        timeout: Duration,
        mut pump: F,
    ) -> Result<Vec<u8>, RclError>
    where
        F: FnMut() -> Result<(), RclError>,
    {
        let request = allocate_message(request_ts)?;
        let response = allocate_message(response_ts)?;
        let mut wait_set = WaitSet::new(context, 0, 1, 0, 1)?;
        let result = (|| {
            deserialize_into(request_ts, request_cdr, request)?;
            let mut seq = 0i64;
            unsafe {
                check(
                    b::rcl_send_request(self.client.as_ref(), request, &mut seq),
                    "rcl_send_request",
                )?;
            }
            let deadline = Instant::now() + timeout;
            loop {
                pump()?;
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return Err(RclError {
                        ret: RCL_TIMEOUT,
                        message: "service call timed out".to_owned(),
                    });
                }
                wait_set.wait_raw_client(
                    self.client.as_ref(),
                    guard,
                    remaining.as_nanos() as i64,
                )?;
                let mut header = b::rmw_request_id_t {
                    writer_guid: [0; 16],
                    sequence_number: 0,
                };
                let ret = unsafe {
                    b::rcl_take_response(
                        self.client.as_ref(),
                        &mut header,
                        response,
                    )
                };
                if ret == RCL_CLIENT_TAKE_FAILED {
                    unsafe { b::rcutils_reset_error() };
                    continue;
                }
                check(ret, "rcl_take_response")?;
                return serialize_message(response_ts, response);
            }
        })();
        destroy_message(request_ts, request);
        destroy_message(response_ts, response);
        wait_set.fini();
        result
    }

    /// Send `request_cdr`, wait up to `timeout`, return response CDR.
    /// Blocking service call without an interleaved pump hook.
    #[allow(dead_code)]
    pub fn call(
        &self,
        context: *mut b::rcl_context_t,
        guard: *const b::rcl_guard_condition_t,
        request_ts: MessageTypeSupport,
        response_ts: MessageTypeSupport,
        request_cdr: &[u8],
        timeout: Duration,
    ) -> Result<Vec<u8>, RclError> {
        self.call_with_pump(
            context,
            guard,
            request_ts,
            response_ts,
            request_cdr,
            timeout,
            || Ok(()),
        )
    }

    pub fn fini(mut self, attachment: &mut Attachment) {
        // SAFETY: client outlived by node until this call.
        unsafe {
            let _ = b::rcl_client_fini(self.client.as_mut(), attachment.node_ptr());
        }
    }
}

/// Serialized service server.
pub struct SerializedService {
    service: Box<b::rcl_service_t>,
}

impl SerializedService {
    pub fn create(
        attachment: &mut Attachment,
        service_name: &str,
        type_support: ServiceTypeSupport,
        qos: &EffectiveQos,
    ) -> Result<Self, RclError> {
        let name_c = CString::new(service_name).map_err(|_| RclError {
            ret: -1,
            message: "service name contains NUL".to_owned(),
        })?;
        // SAFETY: documented service init sequence.
        unsafe {
            let mut service = Box::new(b::rcl_get_zero_initialized_service());
            let mut options = b::rcl_service_get_default_options();
            options.qos = rmw_profile(qos);
            check(
                b::rcl_service_init(
                    service.as_mut(),
                    attachment.node_ptr(),
                    type_support.handle,
                    name_c.as_ptr(),
                    &options,
                ),
                "rcl_service_init",
            )?;
            Ok(Self { service })
        }
    }

    pub fn raw(&self) -> *const b::rcl_service_t {
        self.service.as_ref()
    }

    /// Take one pending request; `None` when the queue is empty.
    pub fn take_request(
        &mut self,
        request_ts: MessageTypeSupport,
    ) -> Result<Option<(b::rmw_request_id_t, Vec<u8>)>, RclError> {
        let request = allocate_message(request_ts)?;
        let mut header = b::rmw_request_id_t {
            writer_guid: [0; 16],
            sequence_number: 0,
        };
        let ret = unsafe {
            b::rcl_take_request(self.service.as_ref(), &mut header, request)
        };
        if ret == RCL_SERVICE_TAKE_FAILED {
            unsafe { b::rcutils_reset_error() };
            destroy_message(request_ts, request);
            return Ok(None);
        }
        if let Err(err) = check(ret, "rcl_take_request") {
            destroy_message(request_ts, request);
            return Err(err);
        }
        let cdr = serialize_message(request_ts, request)?;
        destroy_message(request_ts, request);
        Ok(Some((header, cdr)))
    }

    /// Send a response for a previously taken request header.
    pub fn send_response(
        &mut self,
        response_ts: MessageTypeSupport,
        header: b::rmw_request_id_t,
        response_cdr: &[u8],
    ) -> Result<(), RclError> {
        let response = allocate_message(response_ts)?;
        let result = (|| {
            deserialize_into(response_ts, response_cdr, response)?;
            let mut header_mut = header;
            // SAFETY: response is a live ROS response message.
            unsafe {
                check(
                    b::rcl_send_response(
                        self.service.as_ref(),
                        &mut header_mut,
                        response,
                    ),
                    "rcl_send_response",
                )
            }
        })();
        destroy_message(response_ts, response);
        result
    }

    pub fn fini(mut self, attachment: &mut Attachment) {
        // SAFETY: service outlived by node until this call.
        unsafe {
            let _ = b::rcl_service_fini(self.service.as_mut(), attachment.node_ptr());
        }
    }
}

/// Action client for call-style goal→result (and cancel) round-trips.
pub struct ActionClient {
    client: Box<b::rcl_action_client_t>,
}

impl ActionClient {
    pub fn create(
        attachment: &mut Attachment,
        action_name: &str,
        type_support: ActionTypeSupport,
        qos: &EffectiveQos,
    ) -> Result<Self, RclError> {
        let name_c = CString::new(action_name).map_err(|_| RclError {
            ret: -1,
            message: "action name contains NUL".to_owned(),
        })?;
        // SAFETY: documented action client init sequence.
        unsafe {
            let mut client = Box::new(b::rcl_action_get_zero_initialized_client());
            let mut options = b::rcl_action_client_get_default_options();
            let profile = rmw_profile(qos);
            options.goal_service_qos = profile;
            options.result_service_qos = profile;
            options.cancel_service_qos = profile;
            options.feedback_topic_qos = profile;
            options.status_topic_qos = profile;
            check(
                b::rcl_action_client_init(
                    client.as_mut(),
                    attachment.node_ptr(),
                    type_support.handle,
                    name_c.as_ptr(),
                    &options,
                ),
                "rcl_action_client_init",
            )?;
            Ok(Self { client })
        }
    }

    pub fn raw(&self) -> *const b::rcl_action_client_t {
        self.client.as_ref()
    }

    /// Send goal, wait for acceptance, fetch result; returns GetResult_Response CDR.
    pub fn send_goal_result(
        &mut self,
        context: *mut b::rcl_context_t,
        guard: &GuardCondition,
        action_ts: &ActionTypeSupport,
        operation_id: [u8; 16],
        goal_cdr: &[u8],
        timeout: Duration,
    ) -> Result<Vec<u8>, RclError> {
        let send_goal_req = allocate_message(action_ts.send_goal_request)?;
        let send_goal_resp = allocate_message(action_ts.send_goal_response)?;
        let get_result_req = allocate_message(action_ts.get_result_request)?;
        let get_result_resp = allocate_message(action_ts.get_result_response)?;

        let result = (|| {
            // SAFETY: goal_id is the first 16 bytes of SendGoal_Request.
            unsafe {
                std::ptr::copy_nonoverlapping(
                    operation_id.as_ptr(),
                    send_goal_req as *mut u8,
                    16,
                );
            }
            deserialize_into(action_ts.goal, goal_cdr, unsafe {
                send_goal_req.add(16) as *mut c_void
            })?;

            let mut seq = 0i64;
            unsafe {
                check(
                    b::rcl_action_send_goal_request(
                        self.client.as_ref(),
                        send_goal_req,
                        &mut seq,
                    ),
                    "rcl_action_send_goal_request",
                )?;
            }

            self.wait_and_take_goal_response(
                context,
                guard,
                action_ts.send_goal_response,
                send_goal_resp,
                timeout,
            )?;

            let accepted = unsafe { *(send_goal_resp as *const bool) };
            if !accepted {
                return Err(RclError {
                    ret: b::RCL_RET_ACTION_GOAL_REJECTED as b::rcl_ret_t,
                    message: "action goal rejected".to_owned(),
                });
            }

            unsafe {
                std::ptr::copy_nonoverlapping(
                    operation_id.as_ptr(),
                    get_result_req as *mut u8,
                    16,
                );
            }
            let mut result_seq = 0i64;
            unsafe {
                check(
                    b::rcl_action_send_result_request(
                        self.client.as_ref(),
                        get_result_req,
                        &mut result_seq,
                    ),
                    "rcl_action_send_result_request",
                )?;
            }

            self.wait_and_take_result_response(
                context,
                guard,
                action_ts.get_result_response,
                get_result_resp,
                timeout,
            )?;

            serialize_message(action_ts.get_result_response, get_result_resp)
        })();

        destroy_message(action_ts.send_goal_request, send_goal_req);
        destroy_message(action_ts.send_goal_response, send_goal_resp);
        destroy_message(action_ts.get_result_request, get_result_req);
        destroy_message(action_ts.get_result_response, get_result_resp);
        result
    }

    /// Cancel a goal; returns CancelGoal_Response CDR.
    pub fn cancel_goal(
        &mut self,
        context: *mut b::rcl_context_t,
        guard: &GuardCondition,
        action_ts: &ActionTypeSupport,
        operation_id: [u8; 16],
        timeout: Duration,
    ) -> Result<Vec<u8>, RclError> {
        let cancel_req = allocate_message(action_ts.cancel_request)?;
        let cancel_resp = allocate_message(action_ts.cancel_response)?;

        let result = (|| {
            // SAFETY: GoalInfo.goal_id.uuid is the first 16 bytes of CancelGoal_Request.
            unsafe {
                std::ptr::copy_nonoverlapping(
                    operation_id.as_ptr(),
                    cancel_req as *mut u8,
                    16,
                );
            }
            let mut seq = 0i64;
            unsafe {
                check(
                    b::rcl_action_send_cancel_request(
                        self.client.as_ref(),
                        cancel_req,
                        &mut seq,
                    ),
                    "rcl_action_send_cancel_request",
                )?;
            }
            self.wait_and_take_cancel_response(
                context,
                guard,
                action_ts.cancel_response,
                cancel_resp,
                timeout,
            )?;
            serialize_message(action_ts.cancel_response, cancel_resp)
        })();

        destroy_message(action_ts.cancel_request, cancel_req);
        destroy_message(action_ts.cancel_response, cancel_resp);
        result
    }

    fn wait_and_take_goal_response(
        &self,
        context: *mut b::rcl_context_t,
        guard: &GuardCondition,
        _response_ts: MessageTypeSupport,
        response: *mut c_void,
        timeout: Duration,
    ) -> Result<(), RclError> {
        let deadline = Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(RclError {
                    ret: RCL_TIMEOUT,
                    message: "action goal response timed out".to_owned(),
                });
            }
            if self.wait_action_ready(context, guard, remaining)? {
                let mut header = b::rmw_request_id_t {
                    writer_guid: [0; 16],
                    sequence_number: 0,
                };
                let ret = unsafe {
                    b::rcl_action_take_goal_response(
                        self.client.as_ref(),
                        &mut header,
                        response,
                    )
                };
                if ret == RCL_ACTION_CLIENT_TAKE_FAILED {
                    unsafe { b::rcutils_reset_error() };
                    continue;
                }
                return check(ret, "rcl_action_take_goal_response");
            }
        }
    }

    fn wait_and_take_result_response(
        &self,
        context: *mut b::rcl_context_t,
        guard: &GuardCondition,
        _response_ts: MessageTypeSupport,
        response: *mut c_void,
        timeout: Duration,
    ) -> Result<(), RclError> {
        let deadline = Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(RclError {
                    ret: RCL_TIMEOUT,
                    message: "action result response timed out".to_owned(),
                });
            }
            if self.wait_action_ready(context, guard, remaining)? {
                let mut header = b::rmw_request_id_t {
                    writer_guid: [0; 16],
                    sequence_number: 0,
                };
                let ret = unsafe {
                    b::rcl_action_take_result_response(
                        self.client.as_ref(),
                        &mut header,
                        response,
                    )
                };
                if ret == RCL_ACTION_CLIENT_TAKE_FAILED {
                    unsafe { b::rcutils_reset_error() };
                    continue;
                }
                return check(ret, "rcl_action_take_result_response");
            }
        }
    }

    fn wait_and_take_cancel_response(
        &self,
        context: *mut b::rcl_context_t,
        guard: &GuardCondition,
        _response_ts: MessageTypeSupport,
        response: *mut c_void,
        timeout: Duration,
    ) -> Result<(), RclError> {
        let deadline = Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(RclError {
                    ret: RCL_TIMEOUT,
                    message: "action cancel response timed out".to_owned(),
                });
            }
            if self.wait_action_ready(context, guard, remaining)? {
                let mut header = b::rmw_request_id_t {
                    writer_guid: [0; 16],
                    sequence_number: 0,
                };
                let ret = unsafe {
                    b::rcl_action_take_cancel_response(
                        self.client.as_ref(),
                        &mut header,
                        response,
                    )
                };
                if ret == RCL_ACTION_CLIENT_TAKE_FAILED {
                    unsafe { b::rcutils_reset_error() };
                    continue;
                }
                return check(ret, "rcl_action_take_cancel_response");
            }
        }
    }

    fn wait_action_ready(
        &self,
        context: *mut b::rcl_context_t,
        guard: &GuardCondition,
        timeout: Duration,
    ) -> Result<bool, RclError> {
        let mut num_subs = 0;
        let mut num_gc = 0;
        let mut num_timers = 0;
        let mut num_clients = 0;
        let mut num_services = 0;
        unsafe {
            check(
                b::rcl_action_client_wait_set_get_num_entities(
                    self.client.as_ref(),
                    &mut num_subs,
                    &mut num_gc,
                    &mut num_timers,
                    &mut num_clients,
                    &mut num_services,
                ),
                "rcl_action_client_wait_set_get_num_entities",
            )?;
        }
        let mut wait_set = WaitSet::new(
            context,
            num_subs,
            num_clients,
            num_services,
            num_gc + 1,
        )?;
        let ready = wait_set.wait_action_client(self, guard, timeout.as_nanos() as i64)?;
        wait_set.fini();
        Ok(ready)
    }

    pub fn fini(mut self, attachment: &mut Attachment) {
        // SAFETY: action client outlived by node until this call.
        unsafe {
            let _ = b::rcl_action_client_fini(self.client.as_mut(), attachment.node_ptr());
        }
    }
}

/// Reused take buffer (rmw copies into it; rcl grows it as needed).
pub struct TakeBuffer {
    array: b::rcl_serialized_message_t,
}

impl TakeBuffer {
    pub fn new() -> Result<Self, RclError> {
        // SAFETY: zero-initialized array + init with capacity 0.
        unsafe {
            let mut array = b::rcutils_get_zero_initialized_uint8_array();
            let alloc = allocator();
            let ret = b::rcutils_uint8_array_init(&mut array, 0, &alloc);
            check(ret, "rcutils_uint8_array_init")?;
            Ok(Self { array })
        }
    }

    #[must_use]
    pub fn as_slice(&self) -> &[u8] {
        if self.array.buffer.is_null() || self.array.buffer_length == 0 {
            return &[];
        }
        // SAFETY: rcl maintains buffer/buffer_length as a valid region.
        unsafe { std::slice::from_raw_parts(self.array.buffer, self.array.buffer_length) }
    }

    pub fn fini(mut self) {
        // SAFETY: array was initialized in `new`.
        unsafe {
            let _ = b::rcutils_uint8_array_fini(&mut self.array);
        }
    }
}

/// Guard condition owned by the ROS thread; `GuardTrigger` is the cross-thread
/// wake handle.
pub struct GuardCondition {
    guard: Arc<GuardCell>,
}

struct GuardPtr(*mut b::rcl_guard_condition_t);
// SAFETY: rcl documents rcl_trigger_guard_condition as callable from any
// thread; the cell's mutex serializes trigger against finalization.
unsafe impl Send for GuardPtr {}

pub struct GuardCell {
    ptr: Mutex<Option<GuardPtr>>,
}

/// Cross-thread wake handle for `rcl_wait`.
#[derive(Clone)]
pub struct GuardTrigger {
    guard: Arc<GuardCell>,
}

impl GuardTrigger {
    /// Wake the ROS thread; no-op after the guard condition is finalized.
    pub fn trigger(&self) {
        let cell = self.guard.ptr.lock().expect("guard mutex");
        if let Some(GuardPtr(ptr)) = cell.as_ref() {
            // SAFETY: pointer valid while present in the cell (removal is
            // mutex-serialized in GuardCondition::fini).
            unsafe {
                let _ = b::rcl_trigger_guard_condition(*ptr);
            }
        }
    }
}

impl GuardCondition {
    pub fn create(attachment: &mut Attachment) -> Result<Self, RclError> {
        // SAFETY: documented guard-condition init; the box gives the pointer
        // a stable address for the trigger handle.
        unsafe {
            let mut guard = Box::new(b::rcl_get_zero_initialized_guard_condition());
            let options = b::rcl_guard_condition_get_default_options();
            check(
                b::rcl_guard_condition_init(guard.as_mut(), attachment.context_ptr(), options),
                "rcl_guard_condition_init",
            )?;
            let ptr = Box::into_raw(guard);
            Ok(Self {
                guard: Arc::new(GuardCell {
                    ptr: Mutex::new(Some(GuardPtr(ptr))),
                }),
            })
        }
    }

    #[must_use]
    pub fn trigger_handle(&self) -> GuardTrigger {
        GuardTrigger {
            guard: Arc::clone(&self.guard),
        }
    }

    pub fn raw(&self) -> *const b::rcl_guard_condition_t {
        let cell = self.guard.ptr.lock().expect("guard mutex");
        match cell.as_ref() {
            Some(GuardPtr(ptr)) => ptr.cast_const(),
            None => std::ptr::null(),
        }
    }

    pub fn fini(self) {
        let mut cell = self.guard.ptr.lock().expect("guard mutex");
        if let Some(GuardPtr(ptr)) = cell.take() {
            // SAFETY: exclusive access under the mutex; triggers observe None
            // afterwards.
            unsafe {
                let mut guard = Box::from_raw(ptr);
                let _ = b::rcl_guard_condition_fini(guard.as_mut());
            }
        }
    }
}

/// Ready indices returned from [`WaitSet::wait`].
#[derive(Debug, Clone, Default)]
pub struct WaitReady {
    pub subscriptions: Vec<usize>,
    pub services: Vec<usize>,
}

/// Wait set over subscriptions, services, clients, and one guard condition.
pub struct WaitSet {
    wait_set: Box<b::rcl_wait_set_t>,
    subscription_capacity: usize,
    #[allow(dead_code)]
    client_capacity: usize,
    service_capacity: usize,
    #[allow(dead_code)]
    guard_capacity: usize,
}

impl WaitSet {
    pub fn new(
        context: *mut b::rcl_context_t,
        subscription_capacity: usize,
        client_capacity: usize,
        service_capacity: usize,
        guard_capacity: usize,
    ) -> Result<Self, RclError> {
        // SAFETY: documented wait-set init with explicit capacities.
        unsafe {
            let mut wait_set = Box::new(b::rcl_get_zero_initialized_wait_set());
            check(
                b::rcl_wait_set_init(
                    wait_set.as_mut(),
                    subscription_capacity,
                    guard_capacity,
                    0,
                    client_capacity,
                    service_capacity,
                    0,
                    context,
                    allocator(),
                ),
                "rcl_wait_set_init",
            )?;
            Ok(Self {
                wait_set,
                subscription_capacity,
                client_capacity,
                service_capacity,
                guard_capacity,
            })
        }
    }

    #[must_use]
    pub fn subscription_capacity(&self) -> usize {
        self.subscription_capacity
    }

    #[must_use]
    pub fn service_capacity(&self) -> usize {
        self.service_capacity
    }

    /// Clear, re-add handles, and wait up to `timeout_ns`.
    pub fn wait(
        &mut self,
        subscriptions: &[&SerializedSubscription],
        services: &[&SerializedService],
        guard: &GuardCondition,
        timeout_ns: i64,
    ) -> Result<WaitReady, RclError> {
        assert!(
            subscriptions.len() <= self.subscription_capacity,
            "subscription wait set overflow"
        );
        assert!(
            services.len() <= self.service_capacity,
            "service wait set overflow"
        );
        // SAFETY: standard clear/add/wait cycle.
        unsafe {
            check(
                b::rcl_wait_set_clear(self.wait_set.as_mut()),
                "rcl_wait_set_clear",
            )?;
            for subscription in subscriptions {
                check(
                    b::rcl_wait_set_add_subscription(
                        self.wait_set.as_mut(),
                        subscription.raw(),
                        std::ptr::null_mut(),
                    ),
                    "rcl_wait_set_add_subscription",
                )?;
            }
            for service in services {
                check(
                    b::rcl_wait_set_add_service(
                        self.wait_set.as_mut(),
                        service.raw(),
                        std::ptr::null_mut(),
                    ),
                    "rcl_wait_set_add_service",
                )?;
            }
            self.add_guard(guard)?;
            let ret = b::rcl_wait(self.wait_set.as_mut(), timeout_ns);
            if ret == RCL_TIMEOUT {
                b::rcutils_reset_error();
                return Ok(WaitReady::default());
            }
            check(ret, "rcl_wait")?;
            let mut ready = WaitReady::default();
            for index in 0..subscriptions.len() {
                if !(*self.wait_set.subscriptions.add(index)).is_null() {
                    ready.subscriptions.push(index);
                }
            }
            for index in 0..services.len() {
                if !(*self.wait_set.services.add(index)).is_null() {
                    ready.services.push(index);
                }
            }
            Ok(ready)
        }
    }

    /// Wait on a raw client handle (used when the client cannot be borrowed from the worker map).
    pub fn wait_raw_client(
        &mut self,
        client: *const b::rcl_client_t,
        guard: *const b::rcl_guard_condition_t,
        timeout_ns: i64,
    ) -> Result<(), RclError> {
        unsafe {
            check(
                b::rcl_wait_set_clear(self.wait_set.as_mut()),
                "rcl_wait_set_clear",
            )?;
            check(
                b::rcl_wait_set_add_client(
                    self.wait_set.as_mut(),
                    client,
                    std::ptr::null_mut(),
                ),
                "rcl_wait_set_add_client",
            )?;
            if !guard.is_null() {
                check(
                    b::rcl_wait_set_add_guard_condition(
                        self.wait_set.as_mut(),
                        guard,
                        std::ptr::null_mut(),
                    ),
                    "rcl_wait_set_add_guard_condition",
                )?;
            }
            let ret = b::rcl_wait(self.wait_set.as_mut(), timeout_ns);
            if ret == RCL_TIMEOUT {
                b::rcutils_reset_error();
                return Ok(());
            }
            check(ret, "rcl_wait")?;
            Ok(())
        }
    }

    /// Wait on service clients only.
    #[allow(dead_code)]
    pub fn wait_clients(
        &mut self,
        clients: &[&SerializedClient],
        guard: &GuardCondition,
        timeout_ns: i64,
    ) -> Result<Vec<usize>, RclError> {
        assert!(clients.len() <= self.client_capacity, "client wait set overflow");
        unsafe {
            check(
                b::rcl_wait_set_clear(self.wait_set.as_mut()),
                "rcl_wait_set_clear",
            )?;
            for client in clients {
                check(
                    b::rcl_wait_set_add_client(
                        self.wait_set.as_mut(),
                        client.raw(),
                        std::ptr::null_mut(),
                    ),
                    "rcl_wait_set_add_client",
                )?;
            }
            self.add_guard(guard)?;
            let ret = b::rcl_wait(self.wait_set.as_mut(), timeout_ns);
            if ret == RCL_TIMEOUT {
                b::rcutils_reset_error();
                return Ok(Vec::new());
            }
            check(ret, "rcl_wait")?;
            let mut ready = Vec::new();
            for index in 0..clients.len() {
                if !(*self.wait_set.clients.add(index)).is_null() {
                    ready.push(index);
                }
            }
            Ok(ready)
        }
    }

    /// Wait for an action client's internal entities to become ready.
    pub fn wait_action_client(
        &mut self,
        action_client: &ActionClient,
        guard: &GuardCondition,
        timeout_ns: i64,
    ) -> Result<bool, RclError> {
        unsafe {
            check(
                b::rcl_wait_set_clear(self.wait_set.as_mut()),
                "rcl_wait_set_clear",
            )?;
            let mut client_index = 0;
            let mut subscription_index = 0;
            check(
                b::rcl_action_wait_set_add_action_client(
                    self.wait_set.as_mut(),
                    action_client.raw(),
                    &mut client_index,
                    &mut subscription_index,
                ),
                "rcl_action_wait_set_add_action_client",
            )?;
            self.add_guard(guard)?;
            let ret = b::rcl_wait(self.wait_set.as_mut(), timeout_ns);
            if ret == RCL_TIMEOUT {
                b::rcutils_reset_error();
                return Ok(false);
            }
            check(ret, "rcl_wait")?;
            let client_ready = !(*self.wait_set.clients.add(client_index)).is_null();
            Ok(client_ready)
        }
    }

    unsafe fn add_guard(&mut self, guard: &GuardCondition) -> Result<(), RclError> {
        let guard_ptr = guard.raw();
        if !guard_ptr.is_null() {
            unsafe {
                check(
                    b::rcl_wait_set_add_guard_condition(
                        self.wait_set.as_mut(),
                        guard_ptr,
                        std::ptr::null_mut(),
                    ),
                    "rcl_wait_set_add_guard_condition",
                )?;
            }
        }
        Ok(())
    }

    pub fn fini(mut self) {
        // SAFETY: wait set initialized in `new`.
        unsafe {
            let _ = b::rcl_wait_set_fini(self.wait_set.as_mut());
        }
    }
}
