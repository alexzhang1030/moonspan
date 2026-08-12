//! Shared test support: in-memory ROS backend and an R2WP WebSocket client
//! driving the same core `Session` state machine the browser runtime uses.

// Each integration-test binary uses a subset of these helpers.
#![allow(dead_code)]

use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use rclweb::protocol::extension::{OPERATION_ID_EXTENSION_TYPE, R2wpExtension};
use rclweb::{
    BootstrapRecord, BufferCapabilities, CborValue, ClientHello, FrameHeader, RequestedLimits,
    Role, Session, TransportCapabilities, encode_client_hello, encode_control_frame,
    encode_extension_area, encode_frame, parse_bootstrap, parse_frame,
};
use rclwebd::backend::{
    ActionInbound, BackendError, ChannelSpec, EntityId, GraphEndpointInfo, GraphNodeInfo,
    GraphView, RosBackend, ServiceRequest, SubscriptionSample,
};
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};

// ---------- mock backend ----------

struct MockSubscription {
    channel_id: u32,
    topic: String,
    type_name: String,
    sink: mpsc::Sender<SubscriptionSample>,
}

struct MockService {
    channel_id: u32,
    spec: ChannelSpec,
    /// Present for ServiceServer entities.
    sink: Option<mpsc::Sender<ServiceRequest>>,
}

struct MockAction {
    channel_id: u32,
    spec: ChannelSpec,
    sink: Option<mpsc::Sender<ActionInbound>>,
}

#[derive(Default)]
struct MockInner {
    subscriptions: HashMap<EntityId, MockSubscription>,
    publishers: HashMap<EntityId, ChannelSpec>,
    services: HashMap<EntityId, MockService>,
    actions: HashMap<EntityId, MockAction>,
    service_responses: Vec<(EntityId, [u8; 16], Vec<u8>)>,
    action_feedback: Vec<(EntityId, [u8; 16], Vec<u8>)>,
    action_results: Vec<(EntityId, [u8; 16], Vec<u8>)>,
    action_status: Vec<(EntityId, [u8; 16], Vec<u8>)>,
}

/// In-memory ROS backend for gateway integration tests.
#[derive(Default)]
pub struct MockBackend {
    next_entity: AtomicU64,
    inner: Mutex<MockInner>,
    pub published: Mutex<Vec<(EntityId, Vec<u8>)>>,
    pub created: Mutex<Vec<ChannelSpec>>,
    pub destroyed: Mutex<Vec<EntityId>>,
}

const MOCK_NODE_ID: [u8; 16] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];

fn id_from_entity(entity: EntityId) -> Vec<u8> {
    let mut id = [0u8; 16];
    id[8..].copy_from_slice(&entity.to_be_bytes());
    id.to_vec()
}

impl MockBackend {
    fn allocate(&self) -> EntityId {
        self.next_entity.fetch_add(1, Ordering::Relaxed) + 1
    }

    fn check_type(spec: &ChannelSpec) -> Result<(), BackendError> {
        const PREFIXES: &[&str] = &[
            "std_msgs/",
            "sensor_msgs/",
            "example_interfaces/",
            "rcl_interfaces/",
            "std_srvs/",
            "moonspan_cdr_interfaces/",
        ];
        if PREFIXES.iter().any(|p| spec.type_name.starts_with(p)) {
            Ok(())
        } else {
            Err(BackendError::new(
                10,
                format!("no typesupport for {}", spec.type_name),
            ))
        }
    }

    /// Inject a serialized sample into every live subscription of `topic`'s
    /// entity id.
    pub fn emit(&self, entity: EntityId, payload: &[u8]) -> bool {
        let inner = self.inner.lock().unwrap();
        let Some(subscription) = inner.subscriptions.get(&entity) else {
            return false;
        };
        subscription
            .sink
            .try_send(SubscriptionSample::from_payload(
                subscription.channel_id,
                payload,
            ))
            .is_ok()
    }

    /// Inject a service request toward a ServiceServer entity.
    pub fn emit_service_request(
        &self,
        entity: EntityId,
        operation_id: [u8; 16],
        payload: &[u8],
    ) -> bool {
        let inner = self.inner.lock().unwrap();
        let Some(service) = inner.services.get(&entity) else {
            return false;
        };
        let Some(sink) = &service.sink else {
            return false;
        };
        sink.try_send(ServiceRequest::from_payload(
            service.channel_id,
            operation_id,
            payload,
        ))
        .is_ok()
    }

    /// Inject an action goal toward an ActionServer entity.
    pub fn emit_action_goal(
        &self,
        entity: EntityId,
        operation_id: [u8; 16],
        payload: &[u8],
    ) -> bool {
        let inner = self.inner.lock().unwrap();
        let Some(action) = inner.actions.get(&entity) else {
            return false;
        };
        let Some(sink) = &action.sink else {
            return false;
        };
        sink.try_send(ActionInbound::from_goal_payload(
            action.channel_id,
            operation_id,
            payload,
        ))
        .is_ok()
    }

    pub fn live_subscriptions(&self) -> usize {
        self.inner.lock().unwrap().subscriptions.len()
    }

    pub fn service_responses(&self) -> Vec<(EntityId, [u8; 16], Vec<u8>)> {
        self.inner.lock().unwrap().service_responses.clone()
    }
}

impl RosBackend for MockBackend {
    async fn create_subscription(
        &self,
        spec: &ChannelSpec,
        sink: mpsc::Sender<SubscriptionSample>,
    ) -> Result<EntityId, BackendError> {
        Self::check_type(spec)?;
        let entity = self.allocate();
        self.created.lock().unwrap().push(spec.clone());
        self.inner.lock().unwrap().subscriptions.insert(
            entity,
            MockSubscription {
                channel_id: spec.channel_id,
                topic: spec.topic.clone(),
                type_name: spec.type_name.clone(),
                sink,
            },
        );
        Ok(entity)
    }

    async fn create_publisher(&self, spec: &ChannelSpec) -> Result<EntityId, BackendError> {
        Self::check_type(spec)?;
        let entity = self.allocate();
        self.created.lock().unwrap().push(spec.clone());
        self.inner
            .lock()
            .unwrap()
            .publishers
            .insert(entity, spec.clone());
        Ok(entity)
    }

    async fn publish(&self, entity: EntityId, payload: Vec<u8>) -> Result<(), BackendError> {
        if !self.inner.lock().unwrap().publishers.contains_key(&entity) {
            return Err(BackendError::new(13, "unknown publisher entity"));
        }
        self.published.lock().unwrap().push((entity, payload));
        Ok(())
    }

    async fn destroy(&self, entity: EntityId) {
        let mut inner = self.inner.lock().unwrap();
        inner.subscriptions.remove(&entity);
        inner.publishers.remove(&entity);
        inner.services.remove(&entity);
        inner.actions.remove(&entity);
        self.destroyed.lock().unwrap().push(entity);
    }

    async fn create_client(&self, spec: &ChannelSpec) -> Result<EntityId, BackendError> {
        Self::check_type(spec)?;
        let entity = self.allocate();
        self.created.lock().unwrap().push(spec.clone());
        self.inner.lock().unwrap().services.insert(
            entity,
            MockService {
                channel_id: spec.channel_id,
                spec: spec.clone(),
                sink: None,
            },
        );
        Ok(entity)
    }

    async fn create_service(
        &self,
        spec: &ChannelSpec,
        sink: mpsc::Sender<ServiceRequest>,
    ) -> Result<EntityId, BackendError> {
        Self::check_type(spec)?;
        let entity = self.allocate();
        self.created.lock().unwrap().push(spec.clone());
        self.inner.lock().unwrap().services.insert(
            entity,
            MockService {
                channel_id: spec.channel_id,
                spec: spec.clone(),
                sink: Some(sink),
            },
        );
        Ok(entity)
    }

    async fn call(
        &self,
        entity: EntityId,
        _operation_id: [u8; 16],
        request: Vec<u8>,
    ) -> Result<Vec<u8>, BackendError> {
        let inner = self.inner.lock().unwrap();
        let Some(service) = inner.services.get(&entity) else {
            return Err(BackendError::new(13, "unknown service client entity"));
        };
        if service.sink.is_some() {
            return Err(BackendError::new(13, "call on service server entity"));
        }
        // Echo with a marker byte so tests can distinguish response from request.
        let mut response = Vec::with_capacity(request.len() + 1);
        response.push(0xE0);
        response.extend_from_slice(&request);
        Ok(response)
    }

    async fn send_service_response(
        &self,
        entity: EntityId,
        operation_id: [u8; 16],
        response: Vec<u8>,
    ) -> Result<(), BackendError> {
        let mut inner = self.inner.lock().unwrap();
        let Some(service) = inner.services.get(&entity) else {
            return Err(BackendError::new(13, "unknown service server entity"));
        };
        if service.sink.is_none() {
            return Err(BackendError::new(13, "response on service client entity"));
        }
        inner
            .service_responses
            .push((entity, operation_id, response));
        Ok(())
    }

    async fn create_action_client(&self, spec: &ChannelSpec) -> Result<EntityId, BackendError> {
        Self::check_type(spec)?;
        let entity = self.allocate();
        self.created.lock().unwrap().push(spec.clone());
        self.inner.lock().unwrap().actions.insert(
            entity,
            MockAction {
                channel_id: spec.channel_id,
                spec: spec.clone(),
                sink: None,
            },
        );
        Ok(entity)
    }

    async fn create_action_server(
        &self,
        spec: &ChannelSpec,
        sink: mpsc::Sender<ActionInbound>,
    ) -> Result<EntityId, BackendError> {
        Self::check_type(spec)?;
        let entity = self.allocate();
        self.created.lock().unwrap().push(spec.clone());
        self.inner.lock().unwrap().actions.insert(
            entity,
            MockAction {
                channel_id: spec.channel_id,
                spec: spec.clone(),
                sink: Some(sink),
            },
        );
        Ok(entity)
    }

    async fn send_action_goal(
        &self,
        entity: EntityId,
        _operation_id: [u8; 16],
        request: Vec<u8>,
    ) -> Result<Vec<u8>, BackendError> {
        let inner = self.inner.lock().unwrap();
        let Some(action) = inner.actions.get(&entity) else {
            return Err(BackendError::new(13, "unknown action client entity"));
        };
        if action.sink.is_some() {
            return Err(BackendError::new(13, "goal on action server entity"));
        }
        let mut result = Vec::with_capacity(request.len() + 1);
        result.push(0xA0);
        result.extend_from_slice(&request);
        Ok(result)
    }

    async fn cancel_action(
        &self,
        entity: EntityId,
        _operation_id: [u8; 16],
        request: Vec<u8>,
    ) -> Result<Vec<u8>, BackendError> {
        let inner = self.inner.lock().unwrap();
        if !inner.actions.contains_key(&entity) {
            return Err(BackendError::new(13, "unknown action client entity"));
        }
        Ok(request)
    }

    async fn send_action_feedback(
        &self,
        entity: EntityId,
        operation_id: [u8; 16],
        payload: Vec<u8>,
    ) -> Result<(), BackendError> {
        let mut inner = self.inner.lock().unwrap();
        if !inner.actions.contains_key(&entity) {
            return Err(BackendError::new(13, "unknown action server entity"));
        }
        inner.action_feedback.push((entity, operation_id, payload));
        Ok(())
    }

    async fn send_action_result(
        &self,
        entity: EntityId,
        operation_id: [u8; 16],
        payload: Vec<u8>,
    ) -> Result<(), BackendError> {
        let mut inner = self.inner.lock().unwrap();
        if !inner.actions.contains_key(&entity) {
            return Err(BackendError::new(13, "unknown action server entity"));
        }
        inner.action_results.push((entity, operation_id, payload));
        Ok(())
    }

    async fn send_action_status(
        &self,
        entity: EntityId,
        operation_id: [u8; 16],
        payload: Vec<u8>,
    ) -> Result<(), BackendError> {
        let mut inner = self.inner.lock().unwrap();
        if !inner.actions.contains_key(&entity) {
            return Err(BackendError::new(13, "unknown action server entity"));
        }
        inner.action_status.push((entity, operation_id, payload));
        Ok(())
    }

    async fn graph_view(&self) -> Result<GraphView, BackendError> {
        let inner = self.inner.lock().unwrap();
        let node = GraphNodeInfo {
            id: MOCK_NODE_ID.to_vec(),
            name: "mock_gateway".to_owned(),
            namespace: None,
            domain_id: 0,
        };
        let mut endpoints = Vec::new();
        for (entity, sub) in &inner.subscriptions {
            endpoints.push(GraphEndpointInfo {
                id: id_from_entity(*entity),
                node_id: MOCK_NODE_ID.to_vec(),
                name: sub.topic.clone(),
                kind: 1, // topic_sub
                type_name: sub.type_name.clone(),
                domain_id: 0,
            });
        }
        for (entity, spec) in &inner.publishers {
            endpoints.push(GraphEndpointInfo {
                id: id_from_entity(*entity),
                node_id: MOCK_NODE_ID.to_vec(),
                name: spec.topic.clone(),
                kind: 0, // topic_pub
                type_name: spec.type_name.clone(),
                domain_id: 0,
            });
        }
        for (entity, service) in &inner.services {
            let kind = if service.sink.is_some() { 2 } else { 3 };
            endpoints.push(GraphEndpointInfo {
                id: id_from_entity(*entity),
                node_id: MOCK_NODE_ID.to_vec(),
                name: service.spec.topic.clone(),
                kind,
                type_name: service.spec.type_name.clone(),
                domain_id: 0,
            });
        }
        for (entity, action) in &inner.actions {
            let kind = if action.sink.is_some() { 4 } else { 5 };
            endpoints.push(GraphEndpointInfo {
                id: id_from_entity(*entity),
                node_id: MOCK_NODE_ID.to_vec(),
                name: action.spec.topic.clone(),
                kind,
                type_name: action.spec.type_name.clone(),
                domain_id: 0,
            });
        }
        Ok(GraphView {
            nodes: vec![node],
            endpoints,
        })
    }
}

// ---------- test client ----------

pub const RIHS_DEMO: &str =
    "RIHS01_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

pub fn corr(tag: u8) -> [u8; 16] {
    [tag; 16]
}

fn bytes_val(bytes: &[u8]) -> CborValue<'static> {
    CborValue::Bytes(Cow::Owned(bytes.to_vec()))
}

fn text_val(text: &str) -> CborValue<'static> {
    CborValue::Text(Cow::Owned(text.to_owned()))
}

/// R2WP client over tokio-tungstenite mirroring the server with the core
/// client-role session machine (the same one the browser runtime drives).
pub struct TestClient {
    ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
    pub session: Session,
    pub control_seq_out: u64,
}

impl TestClient {
    pub async fn connect(addr: &str) -> Self {
        let (ws, _) = connect_async(format!("ws://{addr}/ws"))
            .await
            .expect("websocket connect");
        Self {
            ws,
            session: Session::new(Role::Client),
            control_seq_out: 0,
        }
    }

    pub async fn send_raw(&mut self, bytes: Vec<u8>) {
        self.ws
            .send(Message::Binary(Bytes::from(bytes)))
            .await
            .expect("ws send");
    }

    /// Next binary message within a 5s deadline; None when the server closed.
    pub async fn recv_raw(&mut self) -> Option<Vec<u8>> {
        let deadline = Duration::from_secs(5);
        loop {
            let msg = tokio::time::timeout(deadline, self.ws.next())
                .await
                .expect("recv timeout")?;
            match msg.expect("ws recv") {
                Message::Binary(bytes) => return Some(bytes.to_vec()),
                Message::Close(_) => return None,
                _ => continue,
            }
        }
    }

    pub async fn expect_closed(&mut self) {
        assert!(self.recv_raw().await.is_none(), "expected server close");
    }

    pub fn default_hello() -> ClientHello {
        ClientHello {
            wire_versions: vec![0],
            transport_capabilities: TransportCapabilities {
                webtransport_http3: false,
                binary_wss: true,
                max_datagram_size: None,
            },
            buffer_capabilities: BufferCapabilities {
                transferable_arraybuffer: true,
                shared_arraybuffer: false,
            },
            requested_limits: RequestedLimits::default(),
            extension_capabilities: Vec::new(),
        }
    }

    pub async fn bootstrap(&mut self, hello: &ClientHello) -> BootstrapRecord {
        let bytes = encode_client_hello(hello).expect("encode client hello");
        let record = parse_bootstrap(&bytes).expect("self-parse client hello");
        self.session
            .record_send_bootstrap(&record)
            .expect("record client hello");
        self.send_raw(bytes).await;
        let response = self.recv_raw().await.expect("bootstrap response");
        let record = parse_bootstrap(&response).expect("parse bootstrap response");
        self.session
            .ingest_bootstrap(&record)
            .expect("ingest bootstrap response");
        record
    }

    pub async fn send_control(&mut self, message: &CborValue<'_>) {
        let bytes = encode_control_frame(0, self.control_seq_out, message).expect("encode control");
        let frame = parse_frame(&bytes, None).expect("self-parse control");
        self.session
            .record_send_frame(&frame)
            .expect("record control send");
        self.control_seq_out += 1;
        self.send_raw(bytes).await;
    }

    /// Send a control frame without recording it (for deliberate violations).
    pub async fn send_control_unchecked(&mut self, message: &CborValue<'_>) {
        let bytes = encode_control_frame(0, self.control_seq_out, message).expect("encode control");
        self.control_seq_out += 1;
        self.send_raw(bytes).await;
    }

    /// Receive one frame and ingest it through the client session machine.
    /// Returns the raw bytes for field-level assertions.
    pub async fn recv_ingested(&mut self) -> Option<(Vec<u8>, rclweb::SessionEffects)> {
        let bytes = self.recv_raw().await?;
        let frame = parse_frame(&bytes, None).expect("parse inbound frame");
        let effects = self
            .session
            .ingest_frame(&frame)
            .expect("ingest inbound frame");
        Some((bytes, effects))
    }

    /// Receive one frame without ingesting (for error frames after which the
    /// server closes).
    pub async fn recv_frame_raw(&mut self) -> Option<Vec<u8>> {
        self.recv_raw().await
    }

    pub fn authenticate_msg(correlation: &[u8; 16]) -> CborValue<'static> {
        CborValue::Map(vec![
            (1, CborValue::Unsigned(1)),
            (2, bytes_val(correlation)),
            (16, text_val("token")),
            (17, bytes_val(b"anonymous")),
        ])
    }

    pub fn open_topic_msg(
        correlation: &[u8; 16],
        channel_id: u32,
        operation_kind: u64,
        topic: &str,
        type_name: &str,
        qos_reliability: u64,
    ) -> CborValue<'static> {
        Self::open_topic_msg_on_row(
            correlation,
            channel_id,
            operation_kind,
            topic,
            type_name,
            qos_reliability,
            0,
            "J-FT",
            "rep2011-rihs",
            RIHS_DEMO,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn open_topic_msg_on_domain(
        correlation: &[u8; 16],
        channel_id: u32,
        operation_kind: u64,
        topic: &str,
        type_name: &str,
        qos_reliability: u64,
        domain_id: u8,
    ) -> CborValue<'static> {
        Self::open_topic_msg_on_row(
            correlation,
            channel_id,
            operation_kind,
            topic,
            type_name,
            qos_reliability,
            domain_id,
            "J-FT",
            "rep2011-rihs",
            RIHS_DEMO,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn open_topic_msg_on_row(
        correlation: &[u8; 16],
        channel_id: u32,
        operation_kind: u64,
        topic: &str,
        type_name: &str,
        qos_reliability: u64,
        domain_id: u8,
        support_row_id: &str,
        schema_scheme: &str,
        schema_value: &str,
    ) -> CborValue<'static> {
        CborValue::Map(vec![
            (1, CborValue::Unsigned(8)),
            (2, bytes_val(correlation)),
            (29, CborValue::Unsigned(u64::from(channel_id))),
            (30, CborValue::Unsigned(operation_kind)),
            (31, text_val(topic)),
            (4, text_val(type_name)),
            (
                3,
                CborValue::Map(vec![
                    (1, text_val(schema_scheme)),
                    (2, text_val(schema_value)),
                ]),
            ),
            (5, CborValue::Unsigned(1)),
            (6, CborValue::Unsigned(0)),
            (
                11,
                CborValue::Map(vec![
                    (1, CborValue::Unsigned(qos_reliability)),
                    (2, CborValue::Unsigned(0)),
                    (3, CborValue::Unsigned(1)),
                    (4, CborValue::Unsigned(5)),
                ]),
            ),
            (32, CborValue::Unsigned(2)),
            (12, CborValue::Map(Vec::new())),
            (9, CborValue::Unsigned(u64::from(domain_id))),
            (8, text_val(support_row_id)),
        ])
    }

    /// OpenChannel for ServiceClient (2) or ServiceServer (3).
    pub fn open_service_msg(
        correlation: &[u8; 16],
        channel_id: u32,
        operation_kind: u64,
        service_name: &str,
        type_name: &str,
    ) -> CborValue<'static> {
        CborValue::Map(vec![
            (1, CborValue::Unsigned(8)),
            (2, bytes_val(correlation)),
            (29, CborValue::Unsigned(u64::from(channel_id))),
            (30, CborValue::Unsigned(operation_kind)),
            (31, text_val(service_name)),
            (4, text_val(type_name)),
            (
                3,
                CborValue::Map(vec![
                    (1, text_val("rep2011-rihs")),
                    (2, text_val(RIHS_DEMO)),
                ]),
            ),
            (5, CborValue::Unsigned(1)),
            (6, CborValue::Unsigned(0)),
            (
                11,
                CborValue::Map(vec![
                    (1, CborValue::Unsigned(1)),
                    (2, CborValue::Unsigned(2)),
                    (3, CborValue::Unsigned(1)),
                    (4, CborValue::Unsigned(5)),
                ]),
            ),
            (32, CborValue::Unsigned(2)),
            (12, CborValue::Map(Vec::new())),
            (9, CborValue::Unsigned(0)),
            (8, text_val("J-FT")),
        ])
    }

    pub fn close_channel_msg(correlation: &[u8; 16], channel_id: u32) -> CborValue<'static> {
        CborValue::Map(vec![
            (1, CborValue::Unsigned(10)),
            (2, bytes_val(correlation)),
            (29, CborValue::Unsigned(u64::from(channel_id))),
            (34, CborValue::Unsigned(1)),
        ])
    }

    pub fn heartbeat_msg(counter: u64) -> CborValue<'static> {
        CborValue::Map(vec![
            (1, CborValue::Unsigned(12)),
            (2, bytes_val(&[0u8; 16])),
            (40, CborValue::Unsigned(counter)),
        ])
    }

    /// Send a client→server ROS_SAMPLE data frame (publish direction).
    pub async fn send_sample(
        &mut self,
        channel_id: u32,
        sequence: u64,
        reliable: bool,
        payload: &[u8],
    ) {
        let bytes = encode_frame(
            &FrameHeader {
                version: 0,
                opcode: rclweb::OPCODE_ROS_SAMPLE,
                flags: if reliable { 0x0001 } else { 0 },
                channel_id,
                sequence,
                source_time_ns: 0,
                priority: 2,
                clock_id: 0,
            },
            &[],
            payload,
        )
        .expect("encode sample");
        let frame = parse_frame(&bytes, None).expect("self-parse sample");
        self.session
            .record_send_frame(&frame)
            .expect("record sample send");
        self.send_raw(bytes).await;
    }

    /// Send SERVICE_REQUEST with OPERATION_ID extension.
    pub async fn send_service_request(
        &mut self,
        channel_id: u32,
        sequence: u64,
        operation_id: [u8; 16],
        payload: &[u8],
    ) {
        let ext = R2wpExtension {
            type_id: OPERATION_ID_EXTENSION_TYPE,
            critical: true,
            value: &operation_id,
        };
        let extension_area = encode_extension_area(&[ext]).expect("encode extension");
        let bytes = encode_frame(
            &FrameHeader {
                version: 0,
                opcode: rclweb::OPCODE_SERVICE_REQUEST,
                flags: 0x0001,
                channel_id,
                sequence,
                source_time_ns: 0,
                priority: 2,
                clock_id: 0,
            },
            &extension_area,
            payload,
        )
        .expect("encode service request");
        let frame = parse_frame(&bytes, None).expect("self-parse service request");
        self.session
            .record_send_frame(&frame)
            .expect("record service request");
        self.send_raw(bytes).await;
    }
}

// ---------- server harness ----------

/// Start a gateway with the mock backend on an ephemeral port; returns the
/// bound address and the backend handle.
pub async fn start_gateway() -> (String, std::sync::Arc<MockBackend>) {
    start_gateway_with_row(rclwebd::SUPPORT_ROW_J_FT).await
}

/// Start a mock gateway bound to the given support row (ADR 0008).
pub async fn start_gateway_with_row(
    support_row: rclwebd::SupportRow,
) -> (String, std::sync::Arc<MockBackend>) {
    let backend = std::sync::Arc::new(MockBackend::default());
    let config = std::sync::Arc::new(rclwebd::GatewayConfig {
        gateway_instance_id: "gw-test".to_owned(),
        support_row,
        ..rclwebd::GatewayConfig::default()
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("local addr").to_string();
    let serve_backend = std::sync::Arc::clone(&backend);
    tokio::spawn(async move {
        let _ = rclwebd::serve(listener, config, serve_backend).await;
    });
    (addr, backend)
}
