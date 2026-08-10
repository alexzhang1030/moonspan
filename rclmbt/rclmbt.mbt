///|
/// Package-internal identity helper for workspace smoke tests.
fn package_identity() -> String {
  "moonspan/rclmbt"
}

///|
/// Internal workspace smoke test; the public API stays empty.
test "package identity" {
  assert_eq(package_identity(), "moonspan/rclmbt")
}
