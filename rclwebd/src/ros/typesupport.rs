//! Dynamic (dlopen) typesupport resolution for messages, services, and actions.
//!
//! Replaces the R1 static link of demo `*_rosidl_typesupport_c` libraries.
//! Libraries are loaded from `{ROS_PREFIX}/lib` (or `AMENT_PREFIX_PATH`) and
//! kept for the process lifetime. Missing libraries or symbols map to wire
//! code 10 (`schema_unavailable`).

#![allow(unsafe_code)]

use super::ffi::bindings::{
    rosidl_action_type_support_t, rosidl_message_type_support_t, rosidl_service_type_support_t,
};
use libloading::Library;
use std::collections::HashMap;
use std::ffi::CString;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

type MessageTsFn = unsafe extern "C" fn() -> *const rosidl_message_type_support_t;
type ServiceTsFn = unsafe extern "C" fn() -> *const rosidl_service_type_support_t;
type ActionTsFn = unsafe extern "C" fn() -> *const rosidl_action_type_support_t;
type CreateFn = unsafe extern "C" fn() -> *mut std::ffi::c_void;
type DestroyFn = unsafe extern "C" fn(*mut std::ffi::c_void);

#[derive(Clone, Copy)]
pub struct MessageTypeSupport {
    pub handle: *const rosidl_message_type_support_t,
    pub create: CreateFn,
    pub destroy: DestroyFn,
}

// SAFETY: typesupport handles point at process-lifetime static data in the
// loaded shared libraries; create/destroy are plain C function pointers.
unsafe impl Send for MessageTypeSupport {}
unsafe impl Sync for MessageTypeSupport {}

#[derive(Clone, Copy)]
pub struct ServiceTypeSupport {
    pub handle: *const rosidl_service_type_support_t,
    pub request: MessageTypeSupport,
    pub response: MessageTypeSupport,
}

unsafe impl Send for ServiceTypeSupport {}
unsafe impl Sync for ServiceTypeSupport {}

#[derive(Clone, Copy)]
pub struct ActionTypeSupport {
    pub handle: *const rosidl_action_type_support_t,
    pub goal: MessageTypeSupport,
    pub result: MessageTypeSupport,
    pub feedback: MessageTypeSupport,
    pub feedback_message: MessageTypeSupport,
    pub send_goal_request: MessageTypeSupport,
    pub send_goal_response: MessageTypeSupport,
    pub get_result_request: MessageTypeSupport,
    pub get_result_response: MessageTypeSupport,
    pub cancel_request: MessageTypeSupport,
    pub cancel_response: MessageTypeSupport,
}

unsafe impl Send for ActionTypeSupport {}
unsafe impl Sync for ActionTypeSupport {}

struct Cache {
    libraries: Vec<Library>,
    messages: HashMap<String, MessageTypeSupport>,
    services: HashMap<String, ServiceTypeSupport>,
    actions: HashMap<String, ActionTypeSupport>,
}

fn cache() -> &'static Mutex<Cache> {
    static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
    CACHE.get_or_init(|| {
        Mutex::new(Cache {
            libraries: Vec::new(),
            messages: HashMap::new(),
            services: HashMap::new(),
            actions: HashMap::new(),
        })
    })
}

fn ros_lib_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(prefix) = std::env::var("ROS_PREFIX") {
        dirs.push(PathBuf::from(prefix).join("lib"));
    }
    if let Ok(ament) = std::env::var("AMENT_PREFIX_PATH") {
        for entry in ament.split(':').filter(|s| !s.is_empty()) {
            let lib = PathBuf::from(entry).join("lib");
            if !dirs.contains(&lib) {
                dirs.push(lib);
            }
        }
    }
    if dirs.is_empty() {
        dirs.push(PathBuf::from("/opt/ros/jazzy/lib"));
    }
    dirs
}

fn parse_type_name(type_name: &str) -> Option<(&str, &str, &str)> {
    let mut parts = type_name.split('/');
    let pkg = parts.next()?;
    let kind = parts.next()?;
    let name = parts.next()?;
    if parts.next().is_some() || pkg.is_empty() || name.is_empty() {
        return None;
    }
    match kind {
        "msg" | "srv" | "action" => Some((pkg, kind, name)),
        _ => None,
    }
}

fn c_symbol(name: &str) -> CString {
    CString::new(name).expect("typesupport symbol without NUL")
}

fn open_library(cache: &mut Cache, path: &Path) -> Result<*const Library, String> {
    // Reuse an already-open library with the same path.
    for lib in &cache.libraries {
        // libloading does not expose path; open fresh and rely on the dynamic
        // linker to dedupe by soname. Keep every Library alive.
        let _ = lib;
    }
    let lib =
        unsafe { Library::new(path) }.map_err(|err| format!("dlopen {}: {err}", path.display()))?;
    cache.libraries.push(lib);
    Ok(cache.libraries.last().expect("just pushed") as *const Library)
}

fn find_library(dirs: &[PathBuf], file_name: &str) -> Option<PathBuf> {
    for dir in dirs {
        let candidate = dir.join(file_name);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

fn load_symbol<T: Copy>(lib: &Library, symbol: &str) -> Result<T, String> {
    let sym = c_symbol(symbol);
    unsafe {
        let f: libloading::Symbol<T> = lib
            .get(sym.as_bytes_with_nul())
            .map_err(|err| format!("dlsym {symbol}: {err}"))?;
        Ok(*f)
    }
}

fn load_message_ts(
    cache: &mut Cache,
    dirs: &[PathBuf],
    pkg: &str,
    kind: &str,
    name: &str,
) -> Result<MessageTypeSupport, String> {
    let key = format!("{pkg}/{kind}/{name}");
    if let Some(ts) = cache.messages.get(&key) {
        return Ok(*ts);
    }
    let ts_name = format!("lib{pkg}__rosidl_typesupport_c.so");
    let gen_name = format!("lib{pkg}__rosidl_generator_c.so");
    let ts_path =
        find_library(dirs, &ts_name).ok_or_else(|| format!("missing {ts_name} under ROS lib"))?;
    let gen_path =
        find_library(dirs, &gen_name).ok_or_else(|| format!("missing {gen_name} under ROS lib"))?;
    let ts_lib = unsafe { &*open_library(cache, &ts_path)? };
    let gen_lib = unsafe { &*open_library(cache, &gen_path)? };
    let getter =
        format!("rosidl_typesupport_c__get_message_type_support_handle__{pkg}__{kind}__{name}");
    let create_name = format!("{pkg}__{kind}__{name}__create");
    let destroy_name = format!("{pkg}__{kind}__{name}__destroy");
    let getter_fn: MessageTsFn = load_symbol(ts_lib, &getter)?;
    let create: CreateFn = load_symbol(gen_lib, &create_name)?;
    let destroy: DestroyFn = load_symbol(gen_lib, &destroy_name)?;
    let handle = unsafe { getter_fn() };
    if handle.is_null() {
        return Err(format!("null message typesupport for {key}"));
    }
    let ts = MessageTypeSupport {
        handle,
        create,
        destroy,
    };
    cache.messages.insert(key, ts);
    Ok(ts)
}

/// Resolve a message typesupport (`pkg/msg/Type`).
pub fn message_type_support(type_name: &str) -> Option<MessageTypeSupport> {
    let (pkg, kind, name) = parse_type_name(type_name)?;
    if kind != "msg" {
        return None;
    }
    let dirs = ros_lib_dirs();
    let mut cache = cache().lock().expect("typesupport cache");
    load_message_ts(&mut cache, &dirs, pkg, kind, name).ok()
}

/// Resolve a service typesupport plus request/response message handles.
pub fn service_type_support(type_name: &str) -> Option<ServiceTypeSupport> {
    let (pkg, kind, name) = parse_type_name(type_name)?;
    if kind != "srv" {
        return None;
    }
    let dirs = ros_lib_dirs();
    let mut cache = cache().lock().expect("typesupport cache");
    if let Some(ts) = cache.services.get(type_name) {
        return Some(*ts);
    }
    let ts_name = format!("lib{pkg}__rosidl_typesupport_c.so");
    let ts_path = find_library(&dirs, &ts_name)?;
    let ts_lib = unsafe { &*open_library(&mut cache, &ts_path).ok()? };
    let getter =
        format!("rosidl_typesupport_c__get_service_type_support_handle__{pkg}__srv__{name}");
    let getter_fn: ServiceTsFn = load_symbol(ts_lib, &getter).ok()?;
    let handle = unsafe { getter_fn() };
    if handle.is_null() {
        return None;
    }
    let request =
        load_message_ts(&mut cache, &dirs, pkg, "srv", &format!("{name}_Request")).ok()?;
    let response =
        load_message_ts(&mut cache, &dirs, pkg, "srv", &format!("{name}_Response")).ok()?;
    let ts = ServiceTypeSupport {
        handle,
        request,
        response,
    };
    cache.services.insert(type_name.to_owned(), ts);
    Some(ts)
}

/// Resolve an action typesupport plus the messages needed for a call-style
/// goal→result round-trip (and cancel).
pub fn action_type_support(type_name: &str) -> Option<ActionTypeSupport> {
    let (pkg, kind, name) = parse_type_name(type_name)?;
    if kind != "action" {
        return None;
    }
    let dirs = ros_lib_dirs();
    let mut cache = cache().lock().expect("typesupport cache");
    if let Some(ts) = cache.actions.get(type_name) {
        return Some(*ts);
    }
    let ts_name = format!("lib{pkg}__rosidl_typesupport_c.so");
    let ts_path = find_library(&dirs, &ts_name)?;
    let ts_lib = unsafe { &*open_library(&mut cache, &ts_path).ok()? };
    let getter =
        format!("rosidl_typesupport_c__get_action_type_support_handle__{pkg}__action__{name}");
    let getter_fn: ActionTsFn = load_symbol(ts_lib, &getter).ok()?;
    let handle = unsafe { getter_fn() };
    if handle.is_null() {
        return None;
    }
    // CancelGoal lives in action_msgs.
    let cancel_request = load_message_ts(
        &mut cache,
        &dirs,
        "action_msgs",
        "srv",
        "CancelGoal_Request",
    )
    .ok()?;
    let cancel_response = load_message_ts(
        &mut cache,
        &dirs,
        "action_msgs",
        "srv",
        "CancelGoal_Response",
    )
    .ok()?;
    let ts = ActionTypeSupport {
        handle,
        goal: load_message_ts(&mut cache, &dirs, pkg, "action", &format!("{name}_Goal")).ok()?,
        result: load_message_ts(&mut cache, &dirs, pkg, "action", &format!("{name}_Result"))
            .ok()?,
        feedback: load_message_ts(
            &mut cache,
            &dirs,
            pkg,
            "action",
            &format!("{name}_Feedback"),
        )
        .ok()?,
        feedback_message: load_message_ts(
            &mut cache,
            &dirs,
            pkg,
            "action",
            &format!("{name}_FeedbackMessage"),
        )
        .ok()?,
        send_goal_request: load_message_ts(
            &mut cache,
            &dirs,
            pkg,
            "action",
            &format!("{name}_SendGoal_Request"),
        )
        .ok()?,
        send_goal_response: load_message_ts(
            &mut cache,
            &dirs,
            pkg,
            "action",
            &format!("{name}_SendGoal_Response"),
        )
        .ok()?,
        get_result_request: load_message_ts(
            &mut cache,
            &dirs,
            pkg,
            "action",
            &format!("{name}_GetResult_Request"),
        )
        .ok()?,
        get_result_response: load_message_ts(
            &mut cache,
            &dirs,
            pkg,
            "action",
            &format!("{name}_GetResult_Response"),
        )
        .ok()?,
        cancel_request,
        cancel_response,
    };
    cache.actions.insert(type_name.to_owned(), ts);
    Some(ts)
}

/// Demo types historically linked at build time (readiness / test hints).
pub const DEMO_TYPES: [&str; 2] = ["std_msgs/msg/String", "sensor_msgs/msg/PointCloud2"];

/// Whether `type_name` can be resolved from the current ROS lib path.
pub fn is_available(type_name: &str) -> bool {
    if let Some((_, kind, _)) = parse_type_name(type_name) {
        match kind {
            "msg" => message_type_support(type_name).is_some(),
            "srv" => service_type_support(type_name).is_some(),
            "action" => action_type_support(type_name).is_some(),
            _ => false,
        }
    } else {
        false
    }
}
