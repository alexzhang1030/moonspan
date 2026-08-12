//! rclwebd: rclweb edge gateway daemon (R1 walking skeleton).
//!
//! Environment:
//! - `RCLWEBD_BIND` — listen address (default `127.0.0.1:8794`)
//! - `ROS_DOMAIN_ID` — ROS domain to attach (default 0)
//! - `RCLWEBD_SUPPORT_ROW` — support row id (`J-FT` default; `H-FT` accepted)
//! - `RCLWEBD_LOCAL_DEV_TLS` — `1`/`true` enables ADR 0011 local-dev TLS
//! - `RCLWEBD_OFFER_WEBTRANSPORT` — `1`/`true` AND-negotiates WT + starts accept
//! - `RCLWEBD_AUTH_MODE` — `off` (default) or `oidc` (JWT; requires issuer/keys)
//! - `RCLWEBD_OIDC_ISSUER` / `RCLWEBD_OIDC_AUDIENCE` — required in `oidc` mode
//! - `RCLWEBD_OIDC_HS_SECRET` or `RCLWEBD_OIDC_JWKS` / `RCLWEBD_OIDC_JWKS_PATH`
//!
//! The `ros` feature links whatever ROS prefix is on `ROS_PREFIX` /
//! `AMENT_PREFIX_PATH` (default `/opt/ros/jazzy`). Pair `RCLWEBD_SUPPORT_ROW`
//! with that prefix: `J-FT` ↔ Jazzy, `H-FT` ↔ Humble. The H-FT live compose
//! regenerates FFI bindings against Humble before linking.

use rclwebd::ros::RclBackend;
use rclwebd::{AuthMode, GatewayConfig, OidcSettings, SUPPORT_ROW_J_FT, parse_support_row, serve};
use std::sync::Arc;

fn env_flag(name: &str) -> bool {
  match std::env::var(name) {
    Ok(v) => {
      let v = v.trim();
      v == "1" || v.eq_ignore_ascii_case("true") || v.eq_ignore_ascii_case("yes")
    }
    Err(_) => false,
  }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
  let bind = std::env::var("RCLWEBD_BIND").unwrap_or_else(|_| "127.0.0.1:8794".to_owned());
  let domain_id: u8 =
    std::env::var("ROS_DOMAIN_ID").ok().map(|v| v.parse()).transpose()?.unwrap_or(0);

  let support_row = match std::env::var("RCLWEBD_SUPPORT_ROW") {
    Ok(raw) => parse_support_row(&raw)
      .ok_or_else(|| format!("unsupported RCLWEBD_SUPPORT_ROW={raw:?}; expected J-FT or H-FT"))?,
    Err(_) => SUPPORT_ROW_J_FT,
  };
  if let Ok(distro) = std::env::var("ROS_DISTRO") {
    let distro = distro.trim();
    if !distro.is_empty() && distro != support_row.ros_distro {
      eprintln!(
        "rclwebd: warning: ROS_DISTRO={distro} but RCLWEBD_SUPPORT_ROW={} \
                 expects ros_distro={}; SessionReady will advertise the support row \
                 (link the matching prefix / regenerate FFI for that distro)",
        support_row.id, support_row.ros_distro
      );
    }
  }

  let local_dev_tls_enabled = env_flag("RCLWEBD_LOCAL_DEV_TLS");
  let offer_webtransport = env_flag("RCLWEBD_OFFER_WEBTRANSPORT");
  let webtransport_bind =
    std::env::var("RCLWEBD_WT_BIND").unwrap_or_else(|_| "127.0.0.1:4433".to_owned());

  let auth_mode = match std::env::var("RCLWEBD_AUTH_MODE") {
    Ok(raw) => AuthMode::parse(&raw)
      .ok_or_else(|| format!("unsupported RCLWEBD_AUTH_MODE={raw:?}; expected off or oidc"))?,
    Err(_) => AuthMode::Off,
  };
  let oidc = match auth_mode {
    AuthMode::Off => None,
    AuthMode::Oidc => Some(OidcSettings::from_env()?),
  };

  let config = GatewayConfig {
    domain_id,
    support_row,
    local_dev_tls_enabled,
    offer_webtransport,
    webtransport_bind,
    auth_mode,
    oidc,
    ..GatewayConfig::default()
  };
  let backend = Arc::new(RclBackend::spawn(domain_id)?);

  let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build()?;
  runtime.block_on(async move {
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    eprintln!(
      "rclwebd listening on ws://{}/ws (domain {domain_id}, row {})",
      listener.local_addr()?,
      config.support_row.id
    );
    tokio::select! {
        result = serve(listener, Arc::new(config), backend) => result?,
        _ = tokio::signal::ctrl_c() => {
            eprintln!("rclwebd shutting down");
        }
    }
    Ok::<(), Box<dyn std::error::Error>>(())
  })?;
  Ok(())
}
