//! Minimal safe wrapper over the serialized-only rcl surface.
//!
//! Ownership contract: every entity here is created, used, and finalized on
//! the single ROS attachment thread ([`super::backend`]); only the
//! guard-condition trigger crosses threads (rcl documents triggering as
//! thread-safe against `rcl_wait`). Nothing in this module parses message
//! bodies — payloads stay serialized CDR end to end.

#![allow(unsafe_code)]

use super::ffi::bindings as b;
use crate::qos::EffectiveQos;
use std::ffi::{CStr, CString};
use std::sync::{Arc, Mutex};

const RCL_OK: b::rcl_ret_t = b::RCL_RET_OK as b::rcl_ret_t;
const RCL_TIMEOUT: b::rcl_ret_t = b::RCL_RET_TIMEOUT as b::rcl_ret_t;
const RCL_TAKE_FAILED: b::rcl_ret_t = b::RCL_RET_SUBSCRIPTION_TAKE_FAILED as b::rcl_ret_t;

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
        // SAFETY: zero-initialized out-struct; fini after copying out.
        unsafe {
            // rcl_get_zero_initialized_names_and_types is a #define for this.
            let mut names_and_types = b::rmw_get_zero_initialized_names_and_types();
            let mut alloc = allocator();
            check(
                b::rcl_get_topic_names_and_types(
                    self.node.as_ref(),
                    &mut alloc,
                    false,
                    &mut names_and_types,
                ),
                "rcl_get_topic_names_and_types",
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

/// Wait set over subscriptions plus one guard condition.
pub struct WaitSet {
    wait_set: Box<b::rcl_wait_set_t>,
    capacity: usize,
}

impl WaitSet {
    pub fn new(
        attachment: &mut Attachment,
        subscription_capacity: usize,
    ) -> Result<Self, RclError> {
        // SAFETY: documented wait-set init with explicit capacities.
        unsafe {
            let mut wait_set = Box::new(b::rcl_get_zero_initialized_wait_set());
            check(
                b::rcl_wait_set_init(
                    wait_set.as_mut(),
                    subscription_capacity,
                    1,
                    0,
                    0,
                    0,
                    0,
                    attachment.context_ptr(),
                    allocator(),
                ),
                "rcl_wait_set_init",
            )?;
            Ok(Self {
                wait_set,
                capacity: subscription_capacity,
            })
        }
    }

    #[must_use]
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// Clear, re-add all handles, and wait up to `timeout_ns`. Returns the
    /// indexes of ready subscriptions (in the order they were added).
    pub fn wait(
        &mut self,
        subscriptions: &[&SerializedSubscription],
        guard: &GuardCondition,
        timeout_ns: i64,
    ) -> Result<Vec<usize>, RclError> {
        assert!(subscriptions.len() <= self.capacity, "wait set overflow");
        // SAFETY: standard clear/add/wait cycle; ready entries are read from
        // the parallel arrays the wait set maintains.
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
            let guard_ptr = guard.raw();
            if !guard_ptr.is_null() {
                check(
                    b::rcl_wait_set_add_guard_condition(
                        self.wait_set.as_mut(),
                        guard_ptr,
                        std::ptr::null_mut(),
                    ),
                    "rcl_wait_set_add_guard_condition",
                )?;
            }
            let ret = b::rcl_wait(self.wait_set.as_mut(), timeout_ns);
            if ret == RCL_TIMEOUT {
                b::rcutils_reset_error();
                return Ok(Vec::new());
            }
            check(ret, "rcl_wait")?;
            let mut ready = Vec::new();
            for index in 0..subscriptions.len() {
                if !(*self.wait_set.subscriptions.add(index)).is_null() {
                    ready.push(index);
                }
            }
            Ok(ready)
        }
    }

    pub fn fini(mut self) {
        // SAFETY: wait set initialized in `new`.
        unsafe {
            let _ = b::rcl_wait_set_fini(self.wait_set.as_mut());
        }
    }
}
