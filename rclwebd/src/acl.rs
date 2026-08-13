//! Channel/operation ACLs (R4-01 second slice).
//!
//! Default is **off**: every OpenChannel is admitted — same as R1–R3.
//! `enforce` is opt-in (`RCLWEBD_ACL_MODE=enforce`) and is **default-deny**:
//! an OpenChannel succeeds only when an allow rule matches the authenticated
//! subject, the operation kind, and the ROS name. Denials fail the channel
//! with wire code 12 (`permission_denied`).
//!
//! The gateway consumes a policy document; *which* rules a deployment runs
//! is the reviewed policy matrix (human input), the same split as R4-01
//! OIDC not picking a tenant.

use crate::config::GatewayConfig;
use rclweb::session::OperationKind;
use serde::Deserialize;

/// Wire error code `permission_denied` (registry code 12).
pub const PERMISSION_DENIED: u8 = 12;

/// How OpenChannel authorization is evaluated for this process.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AclMode {
  /// ACLs disabled: every OpenChannel is admitted (R1–R3 behavior).
  #[default]
  Off,
  /// Default-deny: OpenChannel needs a matching allow rule.
  Enforce,
}

impl AclMode {
  /// `off` (default) disables ACLs; `enforce` turns on default-deny.
  #[must_use]
  pub fn parse(raw: &str) -> Option<Self> {
    match raw.trim().to_ascii_lowercase().as_str() {
      "" | "off" => Some(Self::Off),
      "enforce" => Some(Self::Enforce),
      _ => None,
    }
  }

  #[must_use]
  pub fn is_off(self) -> bool {
    matches!(self, Self::Off)
  }
}

/// One allow rule. Every listed dimension must match (AND); a rule list
/// matches when any rule matches (OR). `"*"` matches any subject or name;
/// a name ending in `*` is a prefix glob (`/tf*`).
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AclRule {
  pub subjects: Vec<String>,
  pub operations: Vec<AclOperation>,
  pub names: Vec<String>,
}

/// OpenChannel operation kinds in policy vocabulary (channel class 0–5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AclOperation {
  Subscribe,
  Publish,
  ServiceClient,
  ServiceServer,
  ActionClient,
  ActionServer,
}

impl AclOperation {
  #[must_use]
  pub fn from_kind(kind: OperationKind) -> Self {
    match kind {
      OperationKind::TopicSubscribe => Self::Subscribe,
      OperationKind::TopicPublish => Self::Publish,
      OperationKind::ServiceClient => Self::ServiceClient,
      OperationKind::ServiceServer => Self::ServiceServer,
      OperationKind::ActionClient => Self::ActionClient,
      OperationKind::ActionServer => Self::ActionServer,
    }
  }

  #[must_use]
  pub fn as_str(self) -> &'static str {
    match self {
      Self::Subscribe => "subscribe",
      Self::Publish => "publish",
      Self::ServiceClient => "service_client",
      Self::ServiceServer => "service_server",
      Self::ActionClient => "action_client",
      Self::ActionServer => "action_server",
    }
  }
}

/// Parsed policy document (`RCLWEBD_ACL` / `RCLWEBD_ACL_PATH`).
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AclPolicy {
  /// Optional policy revision; when set it becomes the SessionReady
  /// `policy_revision` so clients see which matrix admitted them.
  #[serde(default)]
  pub revision: Option<String>,
  pub rules: Vec<AclRule>,
}

impl AclPolicy {
  pub fn from_json(json: &str) -> Result<Self, String> {
    let policy: Self =
      serde_json::from_str(json).map_err(|err| format!("ACL policy is not valid: {err}"))?;
    Ok(policy)
  }

  /// Load from `RCLWEBD_ACL` (inline JSON) or `RCLWEBD_ACL_PATH` (file).
  pub fn from_env() -> Result<Self, String> {
    if let Ok(json) = std::env::var("RCLWEBD_ACL") {
      return Self::from_json(&json).map_err(|err| format!("RCLWEBD_ACL: {err}"));
    }
    match std::env::var("RCLWEBD_ACL_PATH") {
      Ok(path) => {
        let json = std::fs::read_to_string(&path)
          .map_err(|err| format!("read RCLWEBD_ACL_PATH={path}: {err}"))?;
        Self::from_json(&json).map_err(|err| format!("RCLWEBD_ACL_PATH={path}: {err}"))
      }
      Err(_) => Err("RCLWEBD_ACL_MODE=enforce requires RCLWEBD_ACL or RCLWEBD_ACL_PATH".to_owned()),
    }
  }

  /// Default-deny evaluation: some rule must match subject AND operation AND name.
  #[must_use]
  pub fn allow(&self, subject: &str, operation: AclOperation, name: &str) -> bool {
    self.rules.iter().any(|rule| {
      rule.operations.contains(&operation)
        && rule.subjects.iter().any(|s| s == "*" || s == subject)
        && rule.names.iter().any(|pattern| name_matches(pattern, name))
    })
  }
}

fn name_matches(pattern: &str, name: &str) -> bool {
  if pattern == "*" {
    return true;
  }
  match pattern.strip_suffix('*') {
    Some(prefix) => name.starts_with(prefix),
    None => pattern == name,
  }
}

/// One audit JSON line per OpenChannel decision in enforce mode
/// (same shape family as the Authenticate audit in `crate::auth`).
pub fn emit_channel_audit(
  config: &GatewayConfig,
  subject: &str,
  operation: AclOperation,
  name: &str,
  type_name: &str,
  allow: bool,
) {
  let event = serde_json::json!({
      "event": "open_channel",
      "decision": if allow { "allow" } else { "deny" },
      "reason": if allow { "acl_match" } else { "permission_denied" },
      "subject": subject,
      "operation": operation.as_str(),
      "name": name,
      "type": type_name,
      "gateway_instance_id": config.gateway_instance_id,
      "support_row_id": config.support_row.id,
      "domain_id": config.domain_id,
      "policy_revision": config.policy_revision,
  });
  eprintln!("rclwebd audit {event}");
}

#[cfg(test)]
mod tests {
  use super::*;

  const POLICY: &str = r#"{
    "revision": "matrix-test-1",
    "rules": [
      {"subjects": ["*"], "operations": ["subscribe"], "names": ["/chatter", "/tf*"]},
      {"subjects": ["alice"], "operations": ["publish", "service_client"], "names": ["/cmd_vel", "/add_two_ints"]}
    ]
  }"#;

  #[test]
  fn parse_modes() {
    assert_eq!(AclMode::parse(""), Some(AclMode::Off));
    assert_eq!(AclMode::parse("off"), Some(AclMode::Off));
    assert_eq!(AclMode::parse("Enforce"), Some(AclMode::Enforce));
    assert_eq!(AclMode::parse("allow"), None);
  }

  #[test]
  fn default_deny_needs_a_matching_rule() {
    let policy = AclPolicy::from_json(POLICY).unwrap();
    assert_eq!(policy.revision.as_deref(), Some("matrix-test-1"));
    // Anyone can subscribe /chatter and /tf-prefixed names.
    assert!(policy.allow("anonymous", AclOperation::Subscribe, "/chatter"));
    assert!(policy.allow("bob", AclOperation::Subscribe, "/tf_static"));
    // Publish is scoped to alice on /cmd_vel.
    assert!(policy.allow("alice", AclOperation::Publish, "/cmd_vel"));
    assert!(!policy.allow("bob", AclOperation::Publish, "/cmd_vel"));
    assert!(!policy.allow("alice", AclOperation::Publish, "/chatter"));
    // No rule → deny (default-deny).
    assert!(!policy.allow("alice", AclOperation::ActionClient, "/fibonacci"));
    assert!(!policy.allow("anonymous", AclOperation::Subscribe, "/cmd_vel"));
  }

  #[test]
  fn name_glob_is_prefix_only() {
    assert!(name_matches("*", "/anything"));
    assert!(name_matches("/tf*", "/tf"));
    assert!(name_matches("/tf*", "/tf_static"));
    assert!(!name_matches("/tf*", "/other/tf"));
    assert!(!name_matches("/chatter", "/chatter2"));
  }

  #[test]
  fn rejects_unknown_fields_and_operations() {
    assert!(AclPolicy::from_json(r#"{"rules": [], "extra": 1}"#).is_err());
    assert!(
      AclPolicy::from_json(
        r#"{"rules": [{"subjects": ["*"], "operations": ["admin"], "names": ["*"]}]}"#
      )
      .is_err()
    );
    assert!(AclPolicy::from_json("not json").is_err());
  }

  #[test]
  fn operation_maps_every_channel_class() {
    for (kind, op) in [
      (OperationKind::TopicSubscribe, AclOperation::Subscribe),
      (OperationKind::TopicPublish, AclOperation::Publish),
      (OperationKind::ServiceClient, AclOperation::ServiceClient),
      (OperationKind::ServiceServer, AclOperation::ServiceServer),
      (OperationKind::ActionClient, AclOperation::ActionClient),
      (OperationKind::ActionServer, AclOperation::ActionServer),
    ] {
      assert_eq!(AclOperation::from_kind(kind), op);
    }
  }
}
