//! rcl-backed [`RosBackend`]: one dedicated ROS thread owns every rcl entity
//! and a wait-set loop; async callers talk to it through a command channel
//! and are woken via the guard condition.

use super::rcl::{
    ActionClient, Attachment, GuardCondition, GuardTrigger, SerializedClient, SerializedPublisher,
    SerializedService, SerializedSubscription, TakeBuffer, WaitSet,
};
use super::typesupport::{self, ActionTypeSupport, ServiceTypeSupport};
use crate::adapter::{AdapterProbe, QueueLimits};
use crate::backend::{
    ActionInbound, BackendError, ChannelSpec, EntityId, GraphEndpointInfo, GraphNodeInfo,
    GraphView, RosBackend, ServiceRequest, SubscriptionSample,
};
use crate::config::{SUPPORT_ROW_J_FT, parse_support_row};
use std::collections::HashMap;
use std::sync::mpsc::{SyncSender, sync_channel};
use std::thread::JoinHandle;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};

const WAIT_TIMEOUT_NS: i64 = 100_000_000; // 100ms safety wakeup
const SERVICE_CALL_TIMEOUT: Duration = Duration::from_secs(5);
const ACTION_CALL_TIMEOUT: Duration = Duration::from_secs(30);

/// Topic or service name → type names, as returned by graph queries.
pub type GraphTopics = Vec<(String, Vec<String>)>;

#[allow(dead_code)]
enum Command {
    CreateSubscription {
        spec: ChannelSpec,
        sink: mpsc::Sender<SubscriptionSample>,
        reply: oneshot::Sender<Result<EntityId, BackendError>>,
    },
    CreatePublisher {
        spec: ChannelSpec,
        reply: oneshot::Sender<Result<EntityId, BackendError>>,
    },
    Publish {
        entity: EntityId,
        payload: Vec<u8>,
        reply: oneshot::Sender<Result<(), BackendError>>,
    },
    CreateClient {
        spec: ChannelSpec,
        reply: oneshot::Sender<Result<EntityId, BackendError>>,
    },
    CreateService {
        spec: ChannelSpec,
        sink: mpsc::Sender<ServiceRequest>,
        reply: oneshot::Sender<Result<EntityId, BackendError>>,
    },
    Call {
        entity: EntityId,
        operation_id: [u8; 16], // wire correlation; rcl uses rmw request ids internally
        request: Vec<u8>,
        reply: oneshot::Sender<Result<Vec<u8>, BackendError>>,
    },
    SendServiceResponse {
        entity: EntityId,
        operation_id: [u8; 16],
        response: Vec<u8>,
        reply: oneshot::Sender<Result<(), BackendError>>,
    },
    CreateActionClient {
        spec: ChannelSpec,
        reply: oneshot::Sender<Result<EntityId, BackendError>>,
    },
    SendActionGoal {
        entity: EntityId,
        operation_id: [u8; 16],
        request: Vec<u8>,
        reply: oneshot::Sender<Result<Vec<u8>, BackendError>>,
    },
    CancelAction {
        entity: EntityId,
        operation_id: [u8; 16],
        request: Vec<u8>,
        reply: oneshot::Sender<Result<Vec<u8>, BackendError>>,
    },
    Destroy {
        entity: EntityId,
        reply: oneshot::Sender<()>,
    },
    GraphTopics {
        reply: oneshot::Sender<Result<GraphTopics, BackendError>>,
    },
    GraphView {
        reply: oneshot::Sender<Result<GraphView, BackendError>>,
    },
}

/// Handle to the ROS attachment thread (see module docs).
pub struct RclBackend {
    commands: Option<SyncSender<Command>>,
    trigger: GuardTrigger,
    thread: Option<JoinHandle<()>>,
}

impl RclBackend {
    /// Initialize rcl on `domain_id` and start the attachment thread.
    pub fn spawn(domain_id: u8) -> Result<Self, BackendError> {
        let capacity = usize::try_from(QueueLimits::default().command_capacity).unwrap_or(1024);
        let (command_tx, command_rx) = sync_channel::<Command>(capacity);
        let (init_tx, init_rx) = sync_channel::<Result<GuardTrigger, BackendError>>(1);
        let thread = std::thread::Builder::new()
            .name("rclwebd-ros".to_owned())
            .spawn(move || worker_entry(domain_id, &init_tx, &command_rx))
            .map_err(|err| BackendError::new(13, format!("spawn ros thread: {err}")))?;
        let trigger = match init_rx.recv() {
            Ok(Ok(trigger)) => trigger,
            Ok(Err(err)) => {
                let _ = thread.join();
                return Err(err);
            }
            Err(_) => {
                let _ = thread.join();
                return Err(BackendError::new(13, "ros thread died during init"));
            }
        };
        Ok(Self {
            commands: Some(command_tx),
            trigger,
            thread: Some(thread),
        })
    }

    fn send(&self, command: Command) -> Result<(), BackendError> {
        let sender = self.commands.as_ref().expect("backend used after shutdown");
        sender
            .send(command)
            .map_err(|_| BackendError::new(13, "ros thread stopped"))?;
        self.trigger.trigger();
        Ok(())
    }

    async fn await_reply<T>(rx: oneshot::Receiver<T>) -> Result<T, BackendError> {
        rx.await
            .map_err(|_| BackendError::new(13, "ros thread dropped reply"))
    }

    /// Graph query evidence surface: visible topics with their types.
    pub async fn graph_topics(&self) -> Result<GraphTopics, BackendError> {
        let (reply, rx) = oneshot::channel();
        self.send(Command::GraphTopics { reply })?;
        Self::await_reply(rx).await?
    }
}

fn action_server_unavailable(what: impl Into<String>) -> BackendError {
    BackendError::schema_unavailable(format!(
        "{}: action server live path is not yet attached (browser-as-server)",
        what.into()
    ))
}

impl RosBackend for RclBackend {
    async fn create_subscription(
        &self,
        spec: &ChannelSpec,
        sink: mpsc::Sender<SubscriptionSample>,
    ) -> Result<EntityId, BackendError> {
        let (reply, rx) = oneshot::channel();
        self.send(Command::CreateSubscription {
            spec: spec.clone(),
            sink,
            reply,
        })?;
        Self::await_reply(rx).await?
    }

    async fn create_publisher(&self, spec: &ChannelSpec) -> Result<EntityId, BackendError> {
        let (reply, rx) = oneshot::channel();
        self.send(Command::CreatePublisher {
            spec: spec.clone(),
            reply,
        })?;
        Self::await_reply(rx).await?
    }

    async fn publish(&self, entity: EntityId, payload: Vec<u8>) -> Result<(), BackendError> {
        let (reply, rx) = oneshot::channel();
        self.send(Command::Publish {
            entity,
            payload,
            reply,
        })?;
        Self::await_reply(rx).await?
    }

    async fn destroy(&self, entity: EntityId) {
        let (reply, rx) = oneshot::channel();
        if self.send(Command::Destroy { entity, reply }).is_ok() {
            let _ = rx.await;
        }
    }

    async fn create_client(&self, spec: &ChannelSpec) -> Result<EntityId, BackendError> {
        let (reply, rx) = oneshot::channel();
        self.send(Command::CreateClient {
            spec: spec.clone(),
            reply,
        })?;
        Self::await_reply(rx).await?
    }

    async fn create_service(
        &self,
        spec: &ChannelSpec,
        sink: mpsc::Sender<ServiceRequest>,
    ) -> Result<EntityId, BackendError> {
        let (reply, rx) = oneshot::channel();
        self.send(Command::CreateService {
            spec: spec.clone(),
            sink,
            reply,
        })?;
        Self::await_reply(rx).await?
    }

    async fn call(
        &self,
        entity: EntityId,
        operation_id: [u8; 16],
        request: Vec<u8>,
    ) -> Result<Vec<u8>, BackendError> {
        let (reply, rx) = oneshot::channel();
        self.send(Command::Call {
            entity,
            operation_id,
            request,
            reply,
        })?;
        Self::await_reply(rx).await?
    }

    async fn send_service_response(
        &self,
        entity: EntityId,
        operation_id: [u8; 16],
        response: Vec<u8>,
    ) -> Result<(), BackendError> {
        let (reply, rx) = oneshot::channel();
        self.send(Command::SendServiceResponse {
            entity,
            operation_id,
            response,
            reply,
        })?;
        Self::await_reply(rx).await?
    }

    async fn create_action_client(&self, spec: &ChannelSpec) -> Result<EntityId, BackendError> {
        let (reply, rx) = oneshot::channel();
        self.send(Command::CreateActionClient {
            spec: spec.clone(),
            reply,
        })?;
        Self::await_reply(rx).await?
    }

    async fn create_action_server(
        &self,
        _spec: &ChannelSpec,
        _sink: mpsc::Sender<ActionInbound>,
    ) -> Result<EntityId, BackendError> {
        Err(action_server_unavailable("create_action_server"))
    }

    async fn send_action_goal(
        &self,
        entity: EntityId,
        operation_id: [u8; 16],
        request: Vec<u8>,
    ) -> Result<Vec<u8>, BackendError> {
        let (reply, rx) = oneshot::channel();
        self.send(Command::SendActionGoal {
            entity,
            operation_id,
            request,
            reply,
        })?;
        Self::await_reply(rx).await?
    }

    async fn cancel_action(
        &self,
        entity: EntityId,
        operation_id: [u8; 16],
        request: Vec<u8>,
    ) -> Result<Vec<u8>, BackendError> {
        let (reply, rx) = oneshot::channel();
        self.send(Command::CancelAction {
            entity,
            operation_id,
            request,
            reply,
        })?;
        Self::await_reply(rx).await?
    }

    async fn send_action_feedback(
        &self,
        entity: EntityId,
        _operation_id: [u8; 16],
        _payload: Vec<u8>,
    ) -> Result<(), BackendError> {
        Err(action_server_unavailable(format!(
            "send_action_feedback on entity {entity}"
        )))
    }

    async fn send_action_result(
        &self,
        entity: EntityId,
        _operation_id: [u8; 16],
        _payload: Vec<u8>,
    ) -> Result<(), BackendError> {
        Err(action_server_unavailable(format!(
            "send_action_result on entity {entity}"
        )))
    }

    async fn send_action_status(
        &self,
        entity: EntityId,
        _operation_id: [u8; 16],
        _payload: Vec<u8>,
    ) -> Result<(), BackendError> {
        Err(action_server_unavailable(format!(
            "send_action_status on entity {entity}"
        )))
    }

    async fn graph_view(&self) -> Result<GraphView, BackendError> {
        let (reply, rx) = oneshot::channel();
        self.send(Command::GraphView { reply })?;
        Self::await_reply(rx).await?
    }
}

impl Drop for RclBackend {
    fn drop(&mut self) {
        // Disconnect the command channel, wake the wait loop, join.
        self.commands = None;
        self.trigger.trigger();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

struct SubscriptionEntry {
    entity: EntityId,
    channel_id: u32,
    subscription: SerializedSubscription,
    sink: mpsc::Sender<SubscriptionSample>,
}

struct ClientEntry {
    client: SerializedClient,
    service_ts: ServiceTypeSupport,
}

struct ServiceEntry {
    channel_id: u32,
    service: SerializedService,
    service_ts: ServiceTypeSupport,
    sink: mpsc::Sender<ServiceRequest>,
    pending: HashMap<[u8; 16], super::ffi::bindings::rmw_request_id_t>,
    next_opid: u64,
}

struct ActionClientEntry {
    client: ActionClient,
    action_ts: ActionTypeSupport,
}

struct Worker {
    domain_id: u8,
    attachment: Attachment,
    guard: GuardCondition,
    wait_set: WaitSet,
    take: TakeBuffer,
    next_entity: EntityId,
    subscriptions: Vec<SubscriptionEntry>,
    publishers: HashMap<EntityId, SerializedPublisher>,
    clients: HashMap<EntityId, ClientEntry>,
    services: HashMap<EntityId, ServiceEntry>,
    action_clients: HashMap<EntityId, ActionClientEntry>,
}

fn worker_entry(
    domain_id: u8,
    init_tx: &SyncSender<Result<GuardTrigger, BackendError>>,
    commands: &std::sync::mpsc::Receiver<Command>,
) {
    let mut worker = match Worker::init(domain_id) {
        Ok(worker) => {
            let _ = init_tx.send(Ok(worker.guard.trigger_handle()));
            worker
        }
        Err(err) => {
            let _ = init_tx.send(Err(err));
            return;
        }
    };
    worker.run(commands);
    worker.teardown();
}

fn map_rcl_error(err: super::rcl::RclError) -> BackendError {
    BackendError::new(13, err.message)
}

fn check_adapter_probe() -> Result<(), BackendError> {
    let row_raw =
        std::env::var("RCLWEBD_SUPPORT_ROW").unwrap_or_else(|_| SUPPORT_ROW_J_FT.id.to_owned());
    let row = parse_support_row(&row_raw).unwrap_or(SUPPORT_ROW_J_FT);
    let distro = std::env::var("ROS_DISTRO").unwrap_or_else(|_| row.ros_distro.to_owned());
    let rmw = std::env::var("RMW_IMPLEMENTATION").unwrap_or_else(|_| "rmw_fastrtps_cpp".to_owned());
    let probe = AdapterProbe::for_row(row.id, &distro, &rmw);
    if let Err(status) = probe.check_compatible(row.id, row.ros_distro) {
        return Err(BackendError::new(
            status.wire_code(),
            format!(
                "adapter_profile_mismatch: support_row={} ros_distro={} rmw={} probe={:?}",
                row.id, distro, rmw, probe
            ),
        ));
    }
    eprintln!(
        "rclwebd: adapter probe ok — row={} distro={} rmw={} abi={}",
        probe.support_row_id, probe.ros_distro, probe.rmw_implementation, probe.abi_version
    );
    Ok(())
}

impl Worker {
    fn init(domain_id: u8) -> Result<Self, BackendError> {
        check_adapter_probe()?;
        let node_name = format!("rclwebd_{}", std::process::id());
        let mut attachment =
            Attachment::init(usize::from(domain_id), &node_name).map_err(map_rcl_error)?;
        let guard = GuardCondition::create(&mut attachment).map_err(map_rcl_error)?;
        let wait_set = WaitSet::new(attachment.context_ptr(), 4, 0, 4, 1).map_err(map_rcl_error)?;
        let take = TakeBuffer::new().map_err(map_rcl_error)?;
        Ok(Self {
            domain_id,
            attachment,
            guard,
            wait_set,
            take,
            next_entity: 0,
            subscriptions: Vec::new(),
            publishers: HashMap::new(),
            clients: HashMap::new(),
            services: HashMap::new(),
            action_clients: HashMap::new(),
        })
    }

    fn run(&mut self, commands: &std::sync::mpsc::Receiver<Command>) {
        loop {
            if !self.drain_commands(commands) {
                return;
            }
            if let Err(err) = self.wait_and_pump() {
                eprintln!("rclwebd ros thread: {err}");
                return;
            }
        }
    }

    fn drain_commands(&mut self, commands: &std::sync::mpsc::Receiver<Command>) -> bool {
        loop {
            match commands.try_recv() {
                Ok(command) => self.handle(commands, command),
                Err(std::sync::mpsc::TryRecvError::Empty) => return true,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => return false,
            }
        }
    }

    fn allocate(&mut self) -> EntityId {
        self.next_entity += 1;
        self.next_entity
    }

    fn handle(&mut self, commands: &std::sync::mpsc::Receiver<Command>, command: Command) {
        match command {
            Command::CreateSubscription { spec, sink, reply } => {
                let _ = reply.send(self.create_subscription(&spec, sink));
            }
            Command::CreatePublisher { spec, reply } => {
                let _ = reply.send(self.create_publisher(&spec));
            }
            Command::Publish {
                entity,
                payload,
                reply,
            } => {
                let result = match self.publishers.get_mut(&entity) {
                    Some(publisher) => publisher.publish(&payload).map_err(map_rcl_error),
                    None => Err(BackendError::new(13, "unknown publisher entity")),
                };
                let _ = reply.send(result);
            }
            Command::CreateClient { spec, reply } => {
                let _ = reply.send(self.create_client(&spec));
            }
            Command::CreateService { spec, sink, reply } => {
                let _ = reply.send(self.create_service(&spec, sink));
            }
            Command::Call {
                entity,
                operation_id: _,
                request,
                reply,
            } => {
                let result = self.call_client(commands, entity, &request);
                let _ = reply.send(result);
            }
            Command::SendServiceResponse {
                entity,
                operation_id,
                response,
                reply,
            } => {
                let result = self.send_service_response(entity, operation_id, &response);
                let _ = reply.send(result);
            }
            Command::CreateActionClient { spec, reply } => {
                let _ = reply.send(self.create_action_client(&spec));
            }
            Command::SendActionGoal {
                entity,
                operation_id,
                request,
                reply,
            } => {
                let result = self.send_action_goal(entity, operation_id, &request);
                let _ = reply.send(result);
            }
            Command::CancelAction {
                entity,
                operation_id,
                request: _,
                reply,
            } => {
                let result = self.cancel_action(entity, operation_id);
                let _ = reply.send(result);
            }
            Command::Destroy { entity, reply } => {
                self.destroy_entity(entity);
                let _ = reply.send(());
            }
            Command::GraphTopics { reply } => {
                let _ = reply.send(self.graph_topics());
            }
            Command::GraphView { reply } => {
                let _ = reply.send(self.build_graph_view());
            }
        }
    }

    fn graph_topics(&mut self) -> Result<GraphTopics, BackendError> {
        self.attachment
            .topic_names_and_types()
            .map_err(map_rcl_error)
    }

    fn build_graph_view(&mut self) -> Result<GraphView, BackendError> {
        let topics = self
            .attachment
            .topic_names_and_types()
            .map_err(map_rcl_error)?;
        let services = self
            .attachment
            .service_names_and_types()
            .map_err(map_rcl_error)?;
        let node_id = {
            let mut id = [0u8; 16];
            id[15] = 1;
            id.to_vec()
        };
        let node = GraphNodeInfo {
            id: node_id.clone(),
            name: format!("rclwebd_{}", std::process::id()),
            namespace: None,
            domain_id: self.domain_id,
        };
        let mut endpoints = Vec::new();
        let mut index = 0usize;
        for (name, types) in topics {
            let type_name = types
                .into_iter()
                .next()
                .unwrap_or_else(|| "std_msgs/msg/String".to_owned());
            let mut eid = [0u8; 16];
            let n = (index as u64).saturating_add(1);
            eid[8..].copy_from_slice(&n.to_be_bytes());
            endpoints.push(GraphEndpointInfo {
                id: eid.to_vec(),
                node_id: node_id.clone(),
                name,
                kind: 0,
                type_name,
                domain_id: self.domain_id,
            });
            index += 1;
        }
        for (name, types) in services {
            let type_name = types
                .into_iter()
                .next()
                .unwrap_or_else(|| "std_msgs/srv/Empty".to_owned());
            let mut eid = [0u8; 16];
            let n = (index as u64).saturating_add(1);
            eid[8..].copy_from_slice(&n.to_be_bytes());
            endpoints.push(GraphEndpointInfo {
                id: eid.to_vec(),
                node_id: node_id.clone(),
                name,
                kind: 2,
                type_name,
                domain_id: self.domain_id,
            });
            index += 1;
        }
        Ok(GraphView {
            nodes: vec![node],
            endpoints,
        })
    }

    fn create_subscription(
        &mut self,
        spec: &ChannelSpec,
        sink: mpsc::Sender<SubscriptionSample>,
    ) -> Result<EntityId, BackendError> {
        let Some(msg_ts) = typesupport::message_type_support(&spec.type_name) else {
            return Err(BackendError::new(
                10,
                format!("no dynamic typesupport for {}", spec.type_name),
            ));
        };
        let subscription = SerializedSubscription::create(
            &mut self.attachment,
            &spec.topic,
            msg_ts.handle,
            &spec.qos,
        )
        .map_err(map_rcl_error)?;
        let entity = self.allocate();
        self.subscriptions.push(SubscriptionEntry {
            entity,
            channel_id: spec.channel_id,
            subscription,
            sink,
        });
        Ok(entity)
    }

    fn create_publisher(&mut self, spec: &ChannelSpec) -> Result<EntityId, BackendError> {
        let Some(msg_ts) = typesupport::message_type_support(&spec.type_name) else {
            return Err(BackendError::new(
                10,
                format!("no dynamic typesupport for {}", spec.type_name),
            ));
        };
        let publisher = SerializedPublisher::create(
            &mut self.attachment,
            &spec.topic,
            msg_ts.handle,
            &spec.qos,
        )
        .map_err(map_rcl_error)?;
        let entity = self.allocate();
        self.publishers.insert(entity, publisher);
        Ok(entity)
    }

    fn create_client(&mut self, spec: &ChannelSpec) -> Result<EntityId, BackendError> {
        let Some(service_ts) = typesupport::service_type_support(&spec.type_name) else {
            return Err(BackendError::new(
                10,
                format!("no dynamic typesupport for {}", spec.type_name),
            ));
        };
        let client =
            SerializedClient::create(&mut self.attachment, &spec.topic, service_ts, &spec.qos)
                .map_err(map_rcl_error)?;
        let entity = self.allocate();
        self.clients
            .insert(entity, ClientEntry { client, service_ts });
        Ok(entity)
    }

    fn create_service(
        &mut self,
        spec: &ChannelSpec,
        sink: mpsc::Sender<ServiceRequest>,
    ) -> Result<EntityId, BackendError> {
        let Some(service_ts) = typesupport::service_type_support(&spec.type_name) else {
            return Err(BackendError::new(
                10,
                format!("no dynamic typesupport for {}", spec.type_name),
            ));
        };
        let service =
            SerializedService::create(&mut self.attachment, &spec.topic, service_ts, &spec.qos)
                .map_err(map_rcl_error)?;
        let entity = self.allocate();
        self.services.insert(
            entity,
            ServiceEntry {
                channel_id: spec.channel_id,
                service,
                service_ts,
                sink,
                pending: HashMap::new(),
                next_opid: 0,
            },
        );
        Ok(entity)
    }

    fn create_action_client(&mut self, spec: &ChannelSpec) -> Result<EntityId, BackendError> {
        let Some(action_ts) = typesupport::action_type_support(&spec.type_name) else {
            return Err(BackendError::new(
                10,
                format!("no dynamic typesupport for {}", spec.type_name),
            ));
        };
        let client = ActionClient::create(&mut self.attachment, &spec.topic, action_ts, &spec.qos)
            .map_err(map_rcl_error)?;
        let entity = self.allocate();
        self.action_clients
            .insert(entity, ActionClientEntry { client, action_ts });
        Ok(entity)
    }

    fn call_client(
        &mut self,
        commands: &std::sync::mpsc::Receiver<Command>,
        entity: EntityId,
        request: &[u8],
    ) -> Result<Vec<u8>, BackendError> {
        let client_entry = self
            .clients
            .remove(&entity)
            .ok_or_else(|| BackendError::new(13, "unknown service client entity"))?;
        let request_ts = client_entry.service_ts.request;
        let response_ts = client_entry.service_ts.response;
        let context = self.attachment.context_ptr();
        let guard_ptr = self.guard.raw();
        let result = client_entry
            .client
            .call_with_pump(
                context,
                guard_ptr,
                request_ts,
                response_ts,
                request,
                SERVICE_CALL_TIMEOUT,
                || {
                    self.drain_commands(commands);
                    self.pump_services_and_subscriptions()
                        .map_err(|err| super::rcl::RclError {
                            ret: err.code as i32,
                            message: err.message,
                        })
                },
            )
            .map_err(map_rcl_error);
        self.clients.insert(entity, client_entry);
        result
    }

    fn send_service_response(
        &mut self,
        entity: EntityId,
        operation_id: [u8; 16],
        response: &[u8],
    ) -> Result<(), BackendError> {
        let entry = self
            .services
            .get_mut(&entity)
            .ok_or_else(|| BackendError::new(13, "unknown service server entity"))?;
        let header = entry
            .pending
            .remove(&operation_id)
            .ok_or_else(|| BackendError::new(13, "unknown service operation_id"))?;
        entry
            .service
            .send_response(entry.service_ts.response, header, response)
            .map_err(map_rcl_error)
    }

    fn send_action_goal(
        &mut self,
        entity: EntityId,
        operation_id: [u8; 16],
        goal_cdr: &[u8],
    ) -> Result<Vec<u8>, BackendError> {
        let entry = self
            .action_clients
            .get_mut(&entity)
            .ok_or_else(|| BackendError::new(13, "unknown action client entity"))?;
        entry
            .client
            .send_goal_result(
                self.attachment.context_ptr(),
                &self.guard,
                &entry.action_ts,
                operation_id,
                goal_cdr,
                ACTION_CALL_TIMEOUT,
            )
            .map_err(map_rcl_error)
    }

    fn cancel_action(
        &mut self,
        entity: EntityId,
        operation_id: [u8; 16],
    ) -> Result<Vec<u8>, BackendError> {
        let entry = self
            .action_clients
            .get_mut(&entity)
            .ok_or_else(|| BackendError::new(13, "unknown action client entity"))?;
        entry
            .client
            .cancel_goal(
                self.attachment.context_ptr(),
                &self.guard,
                &entry.action_ts,
                operation_id,
                ACTION_CALL_TIMEOUT,
            )
            .map_err(map_rcl_error)
    }

    fn destroy_entity(&mut self, entity: EntityId) {
        if let Some(index) = self
            .subscriptions
            .iter()
            .position(|entry| entry.entity == entity)
        {
            let entry = self.subscriptions.remove(index);
            entry.subscription.fini(&mut self.attachment);
        }
        if let Some(publisher) = self.publishers.remove(&entity) {
            publisher.fini(&mut self.attachment);
        }
        if let Some(entry) = self.clients.remove(&entity) {
            entry.client.fini(&mut self.attachment);
        }
        if let Some(entry) = self.services.remove(&entity) {
            entry.service.fini(&mut self.attachment);
        }
        if let Some(entry) = self.action_clients.remove(&entity) {
            entry.client.fini(&mut self.attachment);
        }
    }

    fn next_operation_id(counter: &mut u64) -> [u8; 16] {
        *counter += 1;
        let mut id = [0u8; 16];
        id[8..].copy_from_slice(&counter.to_be_bytes());
        id
    }

    fn resize_wait_set_if_needed(&mut self) -> Result<(), BackendError> {
        let sub_cap = self.subscriptions.len().max(4);
        let svc_cap = self.services.len().max(4);
        if sub_cap > self.wait_set.subscription_capacity()
            || svc_cap > self.wait_set.service_capacity()
        {
            let fresh = WaitSet::new(
                self.attachment.context_ptr(),
                sub_cap * 2,
                0,
                svc_cap * 2,
                1,
            )
            .map_err(map_rcl_error)?;
            let old = std::mem::replace(&mut self.wait_set, fresh);
            old.fini();
        }
        Ok(())
    }

    fn pump_services_and_subscriptions(&mut self) -> Result<(), BackendError> {
        for index in 0..self.subscriptions.len() {
            let Some(entry) = self.subscriptions.get_mut(index) else {
                continue;
            };
            loop {
                match entry.subscription.take_serialized(&mut self.take) {
                    Ok(true) => {
                        let sample = SubscriptionSample::from_payload_with_telemetry(
                            entry.channel_id,
                            self.take.as_slice(),
                            Some(&crate::telemetry::PROCESS_TELEMETRY),
                        );
                        let _ = entry.sink.try_send(sample);
                    }
                    Ok(false) => break,
                    Err(err) => {
                        eprintln!("rclwebd take failed: {err}");
                        break;
                    }
                }
            }
        }

        for entry in self.services.values_mut() {
            loop {
                match entry.service.take_request(entry.service_ts.request) {
                    Ok(Some((header, cdr))) => {
                        let operation_id = Self::next_operation_id(&mut entry.next_opid);
                        entry.pending.insert(operation_id, header);
                        let request =
                            ServiceRequest::from_payload(entry.channel_id, operation_id, &cdr);
                        let _ = entry.sink.try_send(request);
                    }
                    Ok(None) => break,
                    Err(err) => {
                        eprintln!("rclwebd service take failed: {err}");
                        break;
                    }
                }
            }
        }
        Ok(())
    }

    fn wait_and_pump(&mut self) -> Result<(), BackendError> {
        self.resize_wait_set_if_needed()?;
        let sub_handles: Vec<&SerializedSubscription> = self
            .subscriptions
            .iter()
            .map(|entry| &entry.subscription)
            .collect();
        let svc_handles: Vec<&SerializedService> =
            self.services.values().map(|entry| &entry.service).collect();
        let _ready = self
            .wait_set
            .wait(&sub_handles, &svc_handles, &self.guard, WAIT_TIMEOUT_NS)
            .map_err(map_rcl_error)?;
        drop(sub_handles);
        drop(svc_handles);

        self.pump_services_and_subscriptions()?;
        Ok(())
    }

    fn teardown(mut self) {
        for entry in self.subscriptions.drain(..) {
            entry.subscription.fini(&mut self.attachment);
        }
        for (_, publisher) in self.publishers.drain() {
            publisher.fini(&mut self.attachment);
        }
        for (_, entry) in self.clients.drain() {
            entry.client.fini(&mut self.attachment);
        }
        for (_, entry) in self.services.drain() {
            entry.service.fini(&mut self.attachment);
        }
        for (_, entry) in self.action_clients.drain() {
            entry.client.fini(&mut self.attachment);
        }
        self.wait_set.fini();
        self.take.fini();
        self.guard.fini();
        self.attachment.fini();
    }
}
