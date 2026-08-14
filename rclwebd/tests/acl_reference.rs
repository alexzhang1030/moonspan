//! The committed wide ACL matrix must parse and stay default-deny
//! on names the matrix does not list.
//!
//! Policy file: `docs/acl-reference.json`.

use rclwebd::{AclOperation, AclPolicy};
use std::path::Path;

fn load_reference() -> AclPolicy {
  let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../docs/acl-reference.json");
  let json =
    std::fs::read_to_string(&path).unwrap_or_else(|err| panic!("read {}: {err}", path.display()));
  AclPolicy::from_json(&json).expect("acl-reference.json must parse")
}

#[test]
fn reference_matrix_parses_and_names_a_revision() {
  let policy = load_reference();
  assert_eq!(policy.revision.as_deref(), Some("rclweb-acl-v0.1-wide"));
  assert!(!policy.rules.is_empty());
}

#[test]
fn reference_matrix_covers_every_channel_class() {
  let policy = load_reference();
  let mut seen = [false; 6];
  for rule in &policy.rules {
    for op in &rule.operations {
      let idx = match op {
        AclOperation::Subscribe => 0,
        AclOperation::Publish => 1,
        AclOperation::ServiceClient => 2,
        AclOperation::ServiceServer => 3,
        AclOperation::ActionClient => 4,
        AclOperation::ActionServer => 5,
      };
      seen[idx] = true;
    }
  }
  assert!(seen.iter().all(|v| *v), "matrix must mention all six operations: {seen:?}");
}

#[test]
fn reference_matrix_admits_the_demo_and_client_surface() {
  let policy = load_reference();
  assert!(policy.allow("anonymous", AclOperation::Subscribe, "/chatter"));
  assert!(policy.allow("anonymous", AclOperation::Subscribe, "/tf_static"));
  assert!(policy.allow("anonymous", AclOperation::Publish, "/chatter"));
  assert!(policy.allow("anonymous", AclOperation::Publish, "/cmd_vel"));
  assert!(policy.allow("anonymous", AclOperation::ServiceClient, "/add_two_ints"));
  assert!(policy.allow("anonymous", AclOperation::ActionClient, "/fibonacci"));
  assert!(policy.allow("anonymous", AclOperation::ServiceServer, "/add_two_ints"));
  assert!(policy.allow("anonymous", AclOperation::ActionServer, "/fibonacci"));
}

#[test]
fn reference_matrix_stays_default_deny_on_unlisted_commands() {
  let policy = load_reference();
  assert!(!policy.allow("anonymous", AclOperation::Publish, "/clock"));
  assert!(!policy.allow("anonymous", AclOperation::Publish, "/rosout"));
  assert!(!policy.allow("anonymous", AclOperation::Publish, "/rclweb_unlisted"));
  assert!(!policy.allow("anonymous", AclOperation::ServiceServer, "/kill"));
  assert!(!policy.allow("anonymous", AclOperation::ActionServer, "/navigate_to_pose"));
}
