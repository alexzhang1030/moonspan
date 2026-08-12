//! Binary WebSocket endpoint (tokio/axum) for the R2WP session plane.
//!
//! Also hosts `/healthz`, `/telemetryz`, and opt-in `/local-dev/tls` (ADR 0011).

use crate::backend::RosBackend;
use crate::config::{ActiveTransport, GatewayConfig};
use crate::connection::{Transport, TransportError, run_connection};
use crate::local_dev_tls::LocalDevTls;
use crate::wt;
use axum::Router;
use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use bytes::Bytes;
use std::sync::Arc;

/// Shared gateway state for HTTP + WebSocket routes.
pub struct AppState<B> {
    pub config: Arc<GatewayConfig>,
    pub backend: Arc<B>,
    pub local_dev_tls: Option<Arc<LocalDevTls>>,
}

impl<B> Clone for AppState<B> {
    fn clone(&self) -> Self {
        Self {
            config: Arc::clone(&self.config),
            backend: Arc::clone(&self.backend),
            local_dev_tls: self.local_dev_tls.clone(),
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
                    return Some(Err(TransportError {
                        reason: err.to_string(),
                    }));
                }
            }
        }
    }

    async fn send(&mut self, bytes: Bytes) -> Result<(), TransportError> {
        self.socket
            .send(Message::Binary(bytes))
            .await
            .map_err(|err| TransportError {
                reason: err.to_string(),
            })
    }

    async fn close(&mut self) {
        let _ = self.socket.send(Message::Close(None)).await;
    }
}

async fn ws_handler<B: RosBackend>(
    ws: WebSocketUpgrade,
    State(state): State<AppState<B>>,
) -> Response {
    ws.on_upgrade(move |socket| async move {
        let transport = WsTransport { socket };
        run_connection(
            transport,
            state.backend.as_ref(),
            state.config.as_ref(),
            ActiveTransport::BinaryWebSocket,
        )
        .await;
    })
}

async fn healthz<B: RosBackend>(State(state): State<AppState<B>>) -> Response {
    match &state.local_dev_tls {
        Some(tls) => match tls.ensure_fresh() {
            Ok(adv) => {
                let body = format!("{{\"status\":\"ok\",\"localDevTls\":{}}}", adv.to_json());
                (
                    StatusCode::OK,
                    [(header::CONTENT_TYPE, "application/json")],
                    body,
                )
                    .into_response()
            }
            Err(err) => (
                StatusCode::SERVICE_UNAVAILABLE,
                format!("{{\"status\":\"error\",\"reason\":{err:?}}}"),
            )
                .into_response(),
        },
        None => "ok".into_response(),
    }
}

async fn local_dev_tls_handler<B: RosBackend>(State(state): State<AppState<B>>) -> Response {
    let Some(tls) = &state.local_dev_tls else {
        return (
            StatusCode::NOT_FOUND,
            [(header::CONTENT_TYPE, "application/json")],
            "{\"active\":false,\"reason\":\"local_dev_tls_disabled\"}",
        )
            .into_response();
    };
    match tls.ensure_fresh() {
        Ok(adv) => (
            StatusCode::OK,
            [(header::CONTENT_TYPE, "application/json")],
            adv.to_json(),
        )
            .into_response(),
        Err(err) => (
            StatusCode::SERVICE_UNAVAILABLE,
            [(header::CONTENT_TYPE, "application/json")],
            format!("{{\"active\":false,\"reason\":{err:?}}}"),
        )
            .into_response(),
    }
}

async fn telemetryz() -> String {
    crate::telemetry::PROCESS_TELEMETRY.snapshot().to_json()
}

/// Gateway router: `GET /ws`, `GET /healthz`, `GET /telemetryz`, optional TLS.
pub fn router<B: RosBackend>(
    config: Arc<GatewayConfig>,
    backend: Arc<B>,
    local_dev_tls: Option<Arc<LocalDevTls>>,
) -> Router {
    Router::new()
        .route("/ws", get(ws_handler::<B>))
        .route("/healthz", get(healthz::<B>))
        .route("/telemetryz", get(telemetryz))
        .route("/local-dev/tls", get(local_dev_tls_handler::<B>))
        .with_state(AppState {
            config,
            backend,
            local_dev_tls,
        })
}

/// Serve the gateway on an already-bound listener until the task is dropped.
///
/// When `local_dev_tls_enabled` is set, mints ADR 0011 material and advertises
/// it. When `offer_webtransport` is also set, starts the WT accept loop
/// (`--features webtransport`) or logs the stub deferral.
pub async fn serve<B: RosBackend>(
    listener: tokio::net::TcpListener,
    config: Arc<GatewayConfig>,
    backend: Arc<B>,
) -> std::io::Result<()> {
    let local_dev_tls = if config.local_dev_tls_enabled {
        match LocalDevTls::mint_default() {
            Ok(tls) => {
                let tls = Arc::new(tls);
                match tls.ensure_fresh() {
                    Ok(adv) => {
                        eprintln!(
                            "rclwebd local-dev TLS active; SPKI sha-256 (base64)={} notAfter={}",
                            base64::Engine::encode(
                                &base64::engine::general_purpose::STANDARD,
                                adv.spki_sha256
                            ),
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
    ) {
        Ok(true) => {}
        Ok(false) => {}
        Err(err) => eprintln!("rclwebd webtransport: {err}"),
    }

    axum::serve(listener, router(config, backend, local_dev_tls)).await
}
