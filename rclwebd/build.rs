//! Link the serialized-only rcl surface when `--features ros` is enabled.
//!
//! The FFI bindings are vendored (rclwebd/src/ros/ffi/bindings.rs, regenerated
//! by scripts/generate-rcl-bindings.sh), so default builds need no ROS
//! installation; only ros-feature builds resolve these libraries.
//!
//! R3-04: demo message typesupport is resolved at runtime via dlopen (see
//! `ros::typesupport`). Only core rcl/rmw/rcutils (+ rcl_action) link here.

use std::env;
use std::path::Path;

fn main() {
  println!("cargo:rerun-if-env-changed=CARGO_FEATURE_ROS");
  if env::var_os("CARGO_FEATURE_ROS").is_none() {
    return;
  }
  println!("cargo:rerun-if-env-changed=ROS_PREFIX");
  println!("cargo:rerun-if-env-changed=AMENT_PREFIX_PATH");

  let prefix = env::var("ROS_PREFIX")
    .ok()
    .or_else(|| {
      env::var("AMENT_PREFIX_PATH")
        .ok()
        .and_then(|paths| paths.split(':').next().map(str::to_owned))
    })
    .unwrap_or_else(|| "/opt/ros/jazzy".to_owned());
  let lib_dir = format!("{prefix}/lib");
  assert!(
    Path::new(&lib_dir).join("librcl.so").exists(),
    "feature `ros` requires a ROS 2 installation at {prefix} \
         (source the environment or set ROS_PREFIX; J-FT → /opt/ros/jazzy, \
         H-FT → /opt/ros/humble)"
  );

  println!("cargo:rustc-link-search=native={lib_dir}");
  for lib in ["rcl", "rcl_action", "rcutils", "rmw", "rmw_implementation", "rosidl_runtime_c"] {
    println!("cargo:rustc-link-lib=dylib={lib}");
  }
  // dlopen typesupport libraries at runtime (libdl).
  println!("cargo:rustc-link-lib=dylib=dl");
}
