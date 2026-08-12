//! WebTransport (HTTP/3) accept path for reliable R2WP framing.
//!
//! When built with `--features webtransport` and local-dev TLS material is
//! available, binds a UDP listener and bridges one client-opened bidirectional
//! stream to [`crate::connection::run_connection`]. Each R2WP bootstrap record
//! or frame is one length-prefixed binary message (`u32` BE length + payload).
//!
//! Without the feature, [`maybe_spawn`] is a documented no-op stub so mint /
//! advertise / hello negotiation can land independently.

use crate::backend::RosBackend;
use crate::config::GatewayConfig;
use crate::local_dev_tls::LocalDevTls;
use crate::ops::OpsState;
use std::sync::Arc;

/// Spawn the WT accept loop when config + TLS + feature allow it.
///
/// Returns `Ok(true)` when a listener task was started, `Ok(false)` when WT is
/// intentionally inactive, or `Err` when configuration asks for WT but the
/// runtime cannot start it.
pub fn maybe_spawn<B: RosBackend>(
  config: Arc<GatewayConfig>,
  backend: Arc<B>,
  tls: Option<Arc<LocalDevTls>>,
  ops: Arc<OpsState>,
) -> Result<bool, String> {
  if !config.offer_webtransport {
    return Ok(false);
  }
  let Some(tls) = tls else {
    return Err(
      "offer_webtransport requires local_dev_tls_enabled (or future PKI material)".to_owned(),
    );
  };
  spawn_inner(config, backend, tls, ops)
}

#[cfg(feature = "webtransport")]
fn spawn_inner<B: RosBackend>(
  config: Arc<GatewayConfig>,
  backend: Arc<B>,
  tls: Arc<LocalDevTls>,
  ops: Arc<OpsState>,
) -> Result<bool, String> {
  let bind = config.webtransport_bind.clone();
  tokio::spawn(async move {
    if let Err(err) = serve_webtransport(bind, config, backend, tls, ops).await {
      eprintln!("rclwebd webtransport listener stopped: {err}");
    }
  });
  Ok(true)
}

#[cfg(not(feature = "webtransport"))]
fn spawn_inner<B: RosBackend>(
  _config: Arc<GatewayConfig>,
  _backend: Arc<B>,
  _tls: Arc<LocalDevTls>,
  _ops: Arc<OpsState>,
) -> Result<bool, String> {
  // Stub: TLS mint/advertise + hello negotiation still work without quinn.
  // Rebuild with `--features webtransport` for the HTTP/3 accept loop.
  eprintln!(
    "rclwebd: offer_webtransport set but crate built without `webtransport` feature; \
         WT accept deferred (hello negotiation + /local-dev/tls still active)"
  );
  Ok(false)
}

#[cfg(feature = "webtransport")]
async fn serve_webtransport<B: RosBackend>(
  bind: String,
  config: Arc<GatewayConfig>,
  backend: Arc<B>,
  tls: Arc<LocalDevTls>,
  ops: Arc<OpsState>,
) -> Result<(), String> {
  use std::net::SocketAddr;
  use wtransport::tls::{Certificate, CertificateChain, Identity, PrivateKey};
  use wtransport::{Endpoint, ServerConfig};

  let _ = tls.ensure_fresh().map_err(|e| e.to_string())?;
  let (cert_der, key_der) = tls.der_pair().map_err(|e| e.to_string())?;
  let identity = Identity::new(
    CertificateChain::single(Certificate::from_der(cert_der).map_err(|e| e.to_string())?),
    PrivateKey::from_der_pkcs8(key_der),
  );

  let addr: SocketAddr =
    bind.parse().map_err(|e| format!("invalid webtransport_bind {bind:?}: {e}"))?;
  let server_config =
    ServerConfig::builder().with_bind_address(addr).with_identity(identity).build();
  let endpoint = Endpoint::server(server_config).map_err(|e| e.to_string())?;
  eprintln!(
    "rclwebd webtransport listening on https://{}/ (UDP, local-dev TLS)",
    endpoint.local_addr().map(|a| a.to_string()).unwrap_or(bind)
  );

  loop {
    let incoming = endpoint.accept().await;
    let config = Arc::clone(&config);
    let backend = Arc::clone(&backend);
    let tls = Arc::clone(&tls);
    let ops = Arc::clone(&ops);
    tokio::spawn(async move {
      // Refresh cert material for advertisement; live sessions keep the
      // handshake cert until reconnect (ADR 0011).
      let _ = tls.ensure_fresh();
      if let Err(err) = handle_session(incoming, config, backend, ops).await {
        eprintln!("rclwebd webtransport session ended: {err}");
      }
    });
  }
}

#[cfg(feature = "webtransport")]
async fn handle_session<B: RosBackend>(
  incoming: wtransport::endpoint::IncomingSession,
  config: Arc<GatewayConfig>,
  backend: Arc<B>,
  ops: Arc<OpsState>,
) -> Result<(), String> {
  use crate::config::ActiveTransport;
  use crate::connection::run_connection;

  let request = incoming.await.map_err(|e| e.to_string())?;
  if ops.is_draining() {
    return Err("draining".to_owned());
  }
  let connection = request.accept().await.map_err(|e| e.to_string())?;
  // Client opens one bidirectional stream for reliable R2WP (control + data).
  let (send, recv) = connection.accept_bi().await.map_err(|e| e.to_string())?;
  let transport = LengthPrefixedBiTransport { send, recv };
  let _session = ops.session_guard();
  run_connection(transport, backend.as_ref(), config.as_ref(), ActiveTransport::WebTransportHttp3)
    .await;
  Ok(())
}

/// One R2WP message per length-prefixed chunk on a WT bidirectional stream.
#[cfg(feature = "webtransport")]
struct LengthPrefixedBiTransport {
  send: wtransport::SendStream,
  recv: wtransport::RecvStream,
}

#[cfg(feature = "webtransport")]
impl crate::connection::Transport for LengthPrefixedBiTransport {
  async fn recv(&mut self) -> Option<Result<bytes::Bytes, crate::connection::TransportError>> {
    use crate::connection::TransportError;
    use bytes::Bytes;

    let mut len_buf = [0u8; 4];
    match self.recv.read_exact(&mut len_buf).await {
      Ok(()) => {}
      Err(_) => return None,
    }
    let len = u32::from_be_bytes(len_buf) as usize;
    // Cap at protocol message ceiling + framing headroom.
    const MAX: usize = 67_108_864 + 4096;
    if len > MAX {
      return Some(Err(TransportError { reason: "wt_frame_too_large".to_owned() }));
    }
    let mut buf = vec![0u8; len];
    match self.recv.read_exact(&mut buf).await {
      Ok(()) => Some(Ok(Bytes::from(buf))),
      Err(err) => Some(Err(TransportError { reason: err.to_string() })),
    }
  }

  async fn send(&mut self, bytes: bytes::Bytes) -> Result<(), crate::connection::TransportError> {
    use crate::connection::TransportError;

    let len = u32::try_from(bytes.len())
      .map_err(|_| TransportError { reason: "wt_frame_len_overflow".to_owned() })?;
    self
      .send
      .write_all(&len.to_be_bytes())
      .await
      .map_err(|e| TransportError { reason: e.to_string() })?;
    self.send.write_all(&bytes).await.map_err(|e| TransportError { reason: e.to_string() })
  }

  async fn close(&mut self) {
    let _ = self.send.finish().await;
  }
}

#[cfg(test)]
mod tests {
  #[test]
  fn feature_gate_documented() {
    // HTTP/3 accept loop is behind `--features webtransport`.
    // Without it, maybe_spawn stubs while TLS + hello negotiation still work.
    let _ = cfg!(feature = "webtransport");
  }
}
