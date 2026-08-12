//! Session identity for Authenticate (R4-01).
//!
//! Default is **off**: accept any credential, SessionReady subject stays
//! `anonymous`, no audit line — same as R1–R3. `oidc` is opt-in
//! (`RCLWEBD_AUTH_MODE=oidc`) and verifies a JWT (issuer + audience +
//! signature). The OIDC tenant and SROS2 keystore remain D-04.

use crate::config::GatewayConfig;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// Wire error code `authentication_failed`.
pub const AUTHENTICATION_FAILED: u8 = 26;

/// Walking-skeleton SessionReady identity when auth is off.
pub const ANONYMOUS_SUBJECT: &str = "anonymous";

/// How Authenticate is evaluated for this process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthMode {
  /// Auth disabled: accept any credential, subject `anonymous`, no audit.
  Off,
  /// Require a JWT matching [`OidcSettings`].
  Oidc,
}

impl AuthMode {
  /// `off` (default) and the compatibility alias `dev` disable auth.
  #[must_use]
  pub fn parse(raw: &str) -> Option<Self> {
    match raw.trim().to_ascii_lowercase().as_str() {
      "" | "off" | "dev" => Some(Self::Off),
      "oidc" => Some(Self::Oidc),
      _ => None,
    }
  }

  #[must_use]
  pub fn is_off(self) -> bool {
    matches!(self, Self::Off)
  }
}

/// Provider-agnostic JWT checks. D-04 fills the actual tenant and key material.
#[derive(Debug, Clone)]
pub struct OidcSettings {
  pub issuer: String,
  pub audience: String,
  pub hs_secret: Option<Vec<u8>>,
  pub jwks: Option<JwkSet>,
}

impl OidcSettings {
  pub fn from_env() -> Result<Self, String> {
    let issuer = std::env::var("RCLWEBD_OIDC_ISSUER")
      .map_err(|_| "RCLWEBD_AUTH_MODE=oidc requires RCLWEBD_OIDC_ISSUER".to_owned())?;
    let audience = std::env::var("RCLWEBD_OIDC_AUDIENCE")
      .map_err(|_| "RCLWEBD_AUTH_MODE=oidc requires RCLWEBD_OIDC_AUDIENCE".to_owned())?;
    let hs_secret = std::env::var("RCLWEBD_OIDC_HS_SECRET").ok().map(|s| s.into_bytes());
    let jwks = match std::env::var("RCLWEBD_OIDC_JWKS") {
      Ok(json) => Some(
        serde_json::from_str(&json)
          .map_err(|err| format!("RCLWEBD_OIDC_JWKS is not a JWK set: {err}"))?,
      ),
      Err(_) => match std::env::var("RCLWEBD_OIDC_JWKS_PATH") {
        Ok(path) => {
          let json = std::fs::read_to_string(&path)
            .map_err(|err| format!("read RCLWEBD_OIDC_JWKS_PATH={path}: {err}"))?;
          Some(
            serde_json::from_str(&json)
              .map_err(|err| format!("JWKS file {path} is not a JWK set: {err}"))?,
          )
        }
        Err(_) => None,
      },
    };
    if hs_secret.is_none() && jwks.is_none() {
      return Err(
        "RCLWEBD_AUTH_MODE=oidc requires RCLWEBD_OIDC_HS_SECRET or RCLWEBD_OIDC_JWKS(_PATH)"
          .to_owned(),
      );
    }
    Ok(Self { issuer, audience, hs_secret, jwks })
  }
}

/// Outcome of one Authenticate attempt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthResult {
  pub allow: bool,
  pub subject: String,
  pub reason: String,
}

/// Evaluate Authenticate fields 16 (scheme) and 17 (token).
///
/// Off mode does not inspect the token and does not emit audit.
#[must_use]
pub fn authenticate(config: &GatewayConfig, scheme: &str, token: &[u8]) -> AuthResult {
  match config.auth_mode {
    AuthMode::Off => AuthResult {
      allow: true,
      subject: ANONYMOUS_SUBJECT.to_owned(),
      reason: "auth_off".to_owned(),
    },
    AuthMode::Oidc => {
      let result = match config.oidc.as_ref() {
        Some(settings) => verify_jwt(settings, token),
        None => AuthResult {
          allow: false,
          subject: String::new(),
          reason: "oidc_not_configured".to_owned(),
        },
      };
      emit_audit(config, scheme, &result);
      result
    }
  }
}

#[derive(Debug, Deserialize)]
struct IdClaims {
  sub: String,
}

fn verify_jwt(settings: &OidcSettings, token: &[u8]) -> AuthResult {
  let Ok(token) = std::str::from_utf8(token) else {
    return AuthResult {
      allow: false,
      subject: String::new(),
      reason: "token_not_utf8".to_owned(),
    };
  };
  let header = match decode_header(token) {
    Ok(header) => header,
    Err(_) => {
      return AuthResult { allow: false, subject: String::new(), reason: "jwt_header".to_owned() };
    }
  };
  let Some(key) = decoding_key(settings, &header) else {
    return AuthResult { allow: false, subject: String::new(), reason: "jwt_key".to_owned() };
  };
  let mut validation = Validation::new(header.alg);
  validation.leeway = 0;
  validation.set_issuer(&[&settings.issuer]);
  validation.set_audience(&[&settings.audience]);
  match decode::<IdClaims>(token, &key, &validation) {
    Ok(data) => AuthResult { allow: true, subject: data.claims.sub, reason: "oidc_ok".to_owned() },
    Err(_) => AuthResult { allow: false, subject: String::new(), reason: "jwt_invalid".to_owned() },
  }
}

fn decoding_key(settings: &OidcSettings, header: &jsonwebtoken::Header) -> Option<DecodingKey> {
  if header.alg == Algorithm::HS256 {
    return settings.hs_secret.as_ref().map(|secret| DecodingKey::from_secret(secret));
  }
  let jwks = settings.jwks.as_ref()?;
  let kid = header.kid.as_deref()?;
  let jwk = jwks.find(kid)?;
  DecodingKey::from_jwk(jwk).ok()
}

fn emit_audit(config: &GatewayConfig, scheme: &str, result: &AuthResult) {
  let ros_security = std::env::var("ROS_SECURITY_ENABLE").ok().filter(|v| !v.is_empty());
  let event = serde_json::json!({
      "event": "authenticate",
      "decision": if result.allow { "allow" } else { "deny" },
      "reason": result.reason,
      "scheme": scheme,
      "subject": result.subject,
      "gateway_instance_id": config.gateway_instance_id,
      "support_row_id": config.support_row.id,
      "domain_id": config.domain_id,
      "auth_mode": match config.auth_mode {
          AuthMode::Off => "off",
          AuthMode::Oidc => "oidc",
      },
      "ros_security_enable": ros_security,
  });
  eprintln!("rclwebd audit {event}");
}

/// Mint an HS256 JWT for tests and local oidc bring-up (not a production issuer).
#[must_use]
pub fn mint_hs256_token(secret: &[u8], issuer: &str, audience: &str, subject: &str) -> String {
  mint_hs256_token_exp(secret, issuer, audience, subject, now_secs() + 3600)
}

fn now_secs() -> u64 {
  SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[derive(Serialize)]
struct MintClaims<'a> {
  sub: &'a str,
  iss: &'a str,
  aud: &'a str,
  exp: u64,
}

fn mint_hs256_token_exp(
  secret: &[u8],
  issuer: &str,
  audience: &str,
  subject: &str,
  exp: u64,
) -> String {
  let claims = MintClaims { sub: subject, iss: issuer, aud: audience, exp };
  jsonwebtoken::encode(
    &jsonwebtoken::Header::new(Algorithm::HS256),
    &claims,
    &jsonwebtoken::EncodingKey::from_secret(secret),
  )
  .expect("mint hs256 jwt")
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::config::GatewayConfig;

  fn oidc_config(secret: &[u8]) -> GatewayConfig {
    GatewayConfig {
      auth_mode: AuthMode::Oidc,
      oidc: Some(OidcSettings {
        issuer: "https://issuer.test".to_owned(),
        audience: "rclwebd".to_owned(),
        hs_secret: Some(secret.to_vec()),
        jwks: None,
      }),
      ..GatewayConfig::default()
    }
  }

  #[test]
  fn parse_off_aliases_and_oidc() {
    assert_eq!(AuthMode::parse(""), Some(AuthMode::Off));
    assert_eq!(AuthMode::parse("off"), Some(AuthMode::Off));
    assert_eq!(AuthMode::parse("DEV"), Some(AuthMode::Off));
    assert_eq!(AuthMode::parse("oidc"), Some(AuthMode::Oidc));
    assert_eq!(AuthMode::parse("jwt"), None);
  }

  #[test]
  fn off_ignores_token_and_stays_anonymous() {
    let config = GatewayConfig::default();
    assert!(config.auth_mode.is_off());
    let anon = authenticate(&config, "token", b"");
    assert!(anon.allow);
    assert_eq!(anon.subject, ANONYMOUS_SUBJECT);
    let named = authenticate(&config, "token", b"operator");
    assert!(named.allow);
    assert_eq!(named.subject, ANONYMOUS_SUBJECT);
  }

  #[test]
  fn oidc_accepts_valid_hs256() {
    let secret = b"test-secret-32-bytes-minimum-ok";
    let config = oidc_config(secret);
    let token = mint_hs256_token(secret, "https://issuer.test", "rclwebd", "alice");
    let result = authenticate(&config, "oidc", token.as_bytes());
    assert!(result.allow, "{}", result.reason);
    assert_eq!(result.subject, "alice");
  }

  #[test]
  fn oidc_rejects_wrong_audience_and_garbage() {
    let secret = b"test-secret-32-bytes-minimum-ok";
    let config = oidc_config(secret);
    let token = mint_hs256_token(secret, "https://issuer.test", "other-aud", "alice");
    let result = authenticate(&config, "oidc", token.as_bytes());
    assert!(!result.allow);
    let garbage = authenticate(&config, "oidc", b"not-a-jwt");
    assert!(!garbage.allow);
  }

  #[test]
  fn oidc_rejects_expired() {
    let secret = b"test-secret-32-bytes-minimum-ok";
    let config = oidc_config(secret);
    let token =
      mint_hs256_token_exp(secret, "https://issuer.test", "rclwebd", "alice", now_secs() - 120);
    let result = authenticate(&config, "oidc", token.as_bytes());
    assert!(!result.allow);
  }
}
