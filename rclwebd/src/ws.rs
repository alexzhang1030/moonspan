//! Binary WebSocket endpoint (tokio/axum) for the R2WP session plane.
//!
//! Also hosts liveness/readiness (`/healthz`, `/livez`, `/readyz`), scrape
//! (`/telemetryz`, `/metrics`), config (`/configz`), drain (`POST /drain`),
//! and opt-in `/local-dev/tls` (ADR 0011).

use crate::backend::RosBackend;
use crate::config::{ActiveTransport, GatewayConfig};
use crate::connection::{Transport, TransportError, run_connection};
use crate::local_dev_tls::LocalDevTls;
use crate::ops::{
  OpsState, configz_json, cors_allow_origin, drain_json, livez_json, metrics_text, readyz_json,
};
use crate::wt;
use axum::Router;
use axum::extract::Request;
use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::http::{HeaderName, HeaderValue, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use bytes::Bytes;
use std::sync::Arc;
use std::time::Duration;

/// Shared gateway state for HTTP + WebSocket routes.
pub struct AppState<B> {
  pub config: Arc<GatewayConfig>,
  pub backend: Arc<B>,
  pub local_dev_tls: Option<Arc<LocalDevTls>>,
  pub ops: Arc<OpsState>,
}

impl<B> Clone for AppState<B> {
  fn clone(&self) -> Self {
    Self {
      config: Arc::clone(&self.config),
      backend: Arc::clone(&self.backend),
      local_dev_tls: self.local_dev_tls.clone(),
      ops: Arc::clone(&self.ops),
    }
  }
}

struct WsTransport {
  socket: WebSocket,
}

impl Transport for WsTransport {
  async fn recv(&mut self) -> Option<Result<Bytes, TransportError>> {
    loop {
      match self.socket.recv().await? {
        Ok(Message::Binary(bytes)) => return Some(Ok(bytes)),
        // R2WP uses binary messages only; a text message is a
        // transport violation and closes the connection.
        Ok(Message::Text(_)) => {
          return Some(Err(TransportError {
            reason: "text_message_on_binary_transport".to_owned(),
          }));
        }
        Ok(Message::Ping(_) | Message::Pong(_)) => continue,
        Ok(Message::Close(_)) => return None,
        Err(err) => {
          return Some(Err(TransportError { reason: err.to_string() }));
        }
      }
    }
  }

  async fn send(&mut self, bytes: Bytes) -> Result<(), TransportError> {
    self
      .socket
      .send(Message::Binary(bytes))
      .await
      .map_err(|err| TransportError { reason: err.to_string() })
  }

  async fn close(&mut self) {
    let _ = self.socket.send(Message::Close(None)).await;
  }
}

fn json_response(status: StatusCode, body: String) -> Response {
  (status, [(header::CONTENT_TYPE, "application/json"), (header::CACHE_CONTROL, "no-store")], body)
    .into_response()
}

async fn ws_handler<B: RosBackend>(
  ws: WebSocketUpgrade,
  State(state): State<AppState<B>>,
) -> Response {
  if state.ops.is_draining() {
    return json_response(
      StatusCode::SERVICE_UNAVAILABLE,
      "{\"status\":\"not_ready\",\"reason\":\"draining\"}".to_owned(),
    );
  }
  let backend = Arc::clone(&state.backend);
  let config = Arc::clone(&state.config);
  let ops = Arc::clone(&state.ops);
  ws.on_upgrade(move |socket| async move {
    let _session = ops.session_guard();
    let transport = WsTransport { socket };
    run_connection(transport, backend.as_ref(), config.as_ref(), ActiveTransport::BinaryWebSocket)
      .await;
  })
}

/// Liveness. Body stays plain `ok` (no local-dev TLS) so the R1-05 harness
/// keeps working. During drain this remains 200 — use `/readyz` for LB.
async fn healthz<B: RosBackend>(State(state): State<AppState<B>>) -> Response {
  match &state.local_dev_tls {
    Some(tls) => match tls.ensure_fresh() {
      Ok(adv) => {
        let body = format!("{{\"status\":\"ok\",\"localDevTls\":{}}}", adv.to_json());
        (
          StatusCode::OK,
          [(header::CONTENT_TYPE, "application/json"), (header::CACHE_CONTROL, "no-store")],
          body,
        )
          .into_response()
      }
      Err(err) => {
        (StatusCode::SERVICE_UNAVAILABLE, format!("{{\"status\":\"error\",\"reason\":{err:?}}}"))
          .into_response()
      }
    },
    None => (StatusCode::OK, [(header::CACHE_CONTROL, "no-store")], "ok").into_response(),
  }
}

async fn livez() -> Response {
  json_response(StatusCode::OK, livez_json())
}

async fn readyz<B: RosBackend>(State(state): State<AppState<B>>) -> Response {
  let draining = state.ops.is_draining();
  let status = if draining { StatusCode::SERVICE_UNAVAILABLE } else { StatusCode::OK };
  json_response(status, readyz_json(state.config.as_ref(), state.ops.as_ref()))
}

async fn configz<B: RosBackend>(State(state): State<AppState<B>>) -> Response {
  json_response(StatusCode::OK, configz_json(state.config.as_ref(), state.ops.as_ref()))
}

async fn drain<B: RosBackend>(State(state): State<AppState<B>>) -> Response {
  state.ops.begin_drain();
  eprintln!(
    "rclwebd ops {}",
    serde_json::json!({
        "event": "drain",
        "sessions": state.ops.session_count(),
        "gateway_instance_id": state.config.gateway_instance_id,
        "support_row_id": state.config.support_row.id,
    })
  );
  json_response(StatusCode::OK, drain_json(state.ops.as_ref()))
}

async fn local_dev_tls_handler<B: RosBackend>(State(state): State<AppState<B>>) -> Response {
  let Some(tls) = &state.local_dev_tls else {
    return json_response(
      StatusCode::NOT_FOUND,
      "{\"active\":false,\"reason\":\"local_dev_tls_disabled\"}".to_owned(),
    );
  };
  match tls.ensure_fresh() {
    Ok(adv) => json_response(StatusCode::OK, adv.to_json()),
    Err(err) => json_response(
      StatusCode::SERVICE_UNAVAILABLE,
      format!("{{\"active\":false,\"reason\":{err:?}}}"),
    ),
  }
}

async fn telemetryz() -> String {
  crate::telemetry::PROCESS_TELEMETRY.snapshot().to_json()
}

async fn metrics<B: RosBackend>(State(state): State<AppState<B>>) -> Response {
  (
    StatusCode::OK,
    [
      (header::CONTENT_TYPE, "text/plain; version=0.0.4; charset=utf-8"),
      (header::CACHE_CONTROL, "no-store"),
    ],
    metrics_text(state.ops.as_ref()),
  )
    .into_response()
}

async fn ops_headers<B: RosBackend>(
  State(state): State<AppState<B>>,
  request: Request,
  next: Next,
) -> Response {
  let origin =
    request.headers().get(header::ORIGIN).and_then(|v| v.to_str().ok()).map(str::to_owned);
  let mut response = next.run(request).await;
  apply_ops_headers(&state.config, origin.as_deref(), &mut response);
  response
}

fn apply_ops_headers(config: &GatewayConfig, origin: Option<&str>, response: &mut Response) {
  if config.isolation_headers {
    let headers = response.headers_mut();
    headers.insert(
      HeaderName::from_static("cross-origin-opener-policy"),
      HeaderValue::from_static("same-origin"),
    );
    headers.insert(
      HeaderName::from_static("cross-origin-embedder-policy"),
      HeaderValue::from_static("require-corp"),
    );
    headers.insert(
      HeaderName::from_static("cross-origin-resource-policy"),
      HeaderValue::from_static("same-origin"),
    );
  }
  if let Some(allow) = cors_allow_origin(&config.cors_origins, origin)
    && let Ok(value) = HeaderValue::from_str(&allow)
  {
    response.headers_mut().insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
    response.headers_mut().insert(header::VARY, HeaderValue::from_static("Origin"));
  }
}

/// Gateway router: session plane plus operations endpoints.
pub fn router<B: RosBackend>(
  config: Arc<GatewayConfig>,
  backend: Arc<B>,
  local_dev_tls: Option<Arc<LocalDevTls>>,
  ops: Arc<OpsState>,
) -> Router {
  let state = AppState { config, backend, local_dev_tls, ops };
  Router::new()
    .route("/ws", get(ws_handler::<B>))
    .route("/healthz", get(healthz::<B>))
    .route("/livez", get(livez))
    .route("/readyz", get(readyz::<B>))
    .route("/configz", get(configz::<B>))
    .route("/drain", post(drain::<B>))
    .route("/telemetryz", get(telemetryz))
    .route("/metrics", get(metrics::<B>))
    .route("/local-dev/tls", get(local_dev_tls_handler::<B>))
    .layer(middleware::from_fn_with_state(state.clone(), ops_headers::<B>))
    .with_state(state)
}

/// Serve until the task is dropped. Tests use this so parallel tokio
/// runtimes do not share a ctrl_c handler.
pub async fn serve<B: RosBackend>(
  listener: tokio::net::TcpListener,
  config: Arc<GatewayConfig>,
  backend: Arc<B>,
) -> std::io::Result<()> {
  serve_inner(listener, config, backend, false).await
}

/// Like [`serve`], but SIGTERM / ctrl_c drain live sessions before exit.
pub async fn serve_with_os_signals<B: RosBackend>(
  listener: tokio::net::TcpListener,
  config: Arc<GatewayConfig>,
  backend: Arc<B>,
) -> std::io::Result<()> {
  serve_inner(listener, config, backend, true).await
}

/// When `local_dev_tls_enabled` is set, mints ADR 0011 material and advertises
/// it. When `offer_webtransport` is also set, starts the WT accept loop
/// (`--features webtransport`) or logs the stub deferral.
///
/// With `catch_os_signals`, SIGTERM / ctrl_c marks the process not-ready,
/// waits up to [`GatewayConfig::drain_timeout_secs`] for sessions, then stops.
async fn serve_inner<B: RosBackend>(
  listener: tokio::net::TcpListener,
  config: Arc<GatewayConfig>,
  backend: Arc<B>,
  catch_os_signals: bool,
) -> std::io::Result<()> {
  let ops = Arc::new(OpsState::new());
  let local_dev_tls = if config.local_dev_tls_enabled {
    match LocalDevTls::mint_default() {
      Ok(tls) => {
        let tls = Arc::new(tls);
        match tls.ensure_fresh() {
          Ok(adv) => {
            eprintln!(
              "rclwebd local-dev TLS active; SPKI sha-256 (base64)={} notAfter={}",
              base64::Engine::encode(&base64::engine::general_purpose::STANDARD, adv.spki_sha256),
              adv.not_after_unix_secs
            );
          }
          Err(err) => eprintln!("rclwebd local-dev TLS advertise failed: {err}"),
        }
        Some(tls)
      }
      Err(err) => {
        eprintln!("rclwebd local-dev TLS mint failed: {err}");
        None
      }
    }
  } else {
    None
  };

  match wt::maybe_spawn(
    Arc::clone(&config),
    Arc::clone(&backend),
    local_dev_tls.clone(),
    Arc::clone(&ops),
  ) {
    Ok(true) => {}
    Ok(false) => {}
    Err(err) => eprintln!("rclwebd webtransport: {err}"),
  }

  let drain_timeout = Duration::from_secs(config.drain_timeout_secs);
  let ops_shutdown = Arc::clone(&ops);
  let server = axum::serve(listener, router(config, backend, local_dev_tls, ops));
  if catch_os_signals {
    server
      .with_graceful_shutdown(async move {
        shutdown_signal().await;
        ops_shutdown.begin_drain();
        eprintln!(
          "rclwebd ops {}",
          serde_json::json!({
              "event": "shutdown_signal",
              "sessions": ops_shutdown.session_count(),
          })
        );
        ops_shutdown.wait_idle(drain_timeout).await;
        eprintln!("rclwebd shutdown");
      })
      .await
  } else {
    let _ = ops_shutdown;
    let _ = drain_timeout;
    server.await
  }
}

async fn shutdown_signal() {
  let ctrl_c = async {
    let _ = tokio::signal::ctrl_c().await;
  };
  #[cfg(unix)]
  {
    let sigterm = async {
      match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
        Ok(mut signal) => {
          let _ = signal.recv().await;
        }
        Err(_) => std::future::pending::<()>().await,
      }
    };
    tokio::select! {
        () = ctrl_c => {}
        () = sigterm => {}
    }
  }
  #[cfg(not(unix))]
  {
    ctrl_c.await;
  }
}
