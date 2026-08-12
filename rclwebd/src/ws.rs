//! Binary WebSocket endpoint (tokio/axum) for the R2WP session plane.

use crate::backend::RosBackend;
use crate::config::GatewayConfig;
use crate::connection::{Transport, TransportError, run_connection};
use axum::Router;
use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::Response;
use axum::routing::get;
use bytes::Bytes;
use std::sync::Arc;

/// Shared gateway state for the WebSocket routes.
pub struct AppState<B> {
    pub config: Arc<GatewayConfig>,
    pub backend: Arc<B>,
}

impl<B> Clone for AppState<B> {
    fn clone(&self) -> Self {
        Self {
            config: Arc::clone(&self.config),
            backend: Arc::clone(&self.backend),
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
        run_connection(transport, state.backend.as_ref(), state.config.as_ref()).await;
    })
}

async fn healthz() -> &'static str {
    "ok"
}

async fn telemetryz() -> String {
    crate::telemetry::PROCESS_TELEMETRY.snapshot().to_json()
}

/// Gateway router: `GET /ws`, `GET /healthz`, `GET /telemetryz`.
pub fn router<B: RosBackend>(config: Arc<GatewayConfig>, backend: Arc<B>) -> Router {
    Router::new()
        .route("/ws", get(ws_handler::<B>))
        .route("/healthz", get(healthz))
        .route("/telemetryz", get(telemetryz))
        .with_state(AppState { config, backend })
}

/// Serve the gateway on an already-bound listener until the task is dropped.
pub async fn serve<B: RosBackend>(
    listener: tokio::net::TcpListener,
    config: Arc<GatewayConfig>,
    backend: Arc<B>,
) -> std::io::Result<()> {
    axum::serve(listener, router(config, backend)).await
}
