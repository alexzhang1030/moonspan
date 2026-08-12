//! rclwebd: rclweb edge gateway daemon (R1 walking skeleton).
//!
//! Environment:
//! - `RCLWEBD_BIND` — listen address (default `127.0.0.1:8794`)
//! - `ROS_DOMAIN_ID` — ROS domain to attach (default 0)
//!
//! Requires a sourced ROS 2 Jazzy environment at runtime (row J-FT).

use rclwebd::ros::RclBackend;
use rclwebd::{GatewayConfig, serve};
use std::sync::Arc;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let bind = std::env::var("RCLWEBD_BIND").unwrap_or_else(|_| "127.0.0.1:8794".to_owned());
    let domain_id: u8 = std::env::var("ROS_DOMAIN_ID")
        .ok()
        .map(|v| v.parse())
        .transpose()?
        .unwrap_or(0);

    let config = GatewayConfig {
        domain_id,
        ..GatewayConfig::default()
    };
    let backend = Arc::new(RclBackend::spawn(domain_id)?);

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    runtime.block_on(async move {
        let listener = tokio::net::TcpListener::bind(&bind).await?;
        eprintln!(
            "rclwebd listening on ws://{}/ws (domain {domain_id}, row J-FT)",
            listener.local_addr()?
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
