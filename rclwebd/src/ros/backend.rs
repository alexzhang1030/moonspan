//! rcl-backed [`RosBackend`]: one dedicated ROS thread owns every rcl entity
//! and a wait-set loop; async callers talk to it through a command channel
//! and are woken via the guard condition.

use super::ffi;
use super::rcl::{
    Attachment, GuardCondition, GuardTrigger, SerializedPublisher, SerializedSubscription,
    TakeBuffer, WaitSet,
};
use crate::backend::{
    ActionInbound, BackendError, ChannelSpec, EntityId, GraphEndpointInfo, GraphNodeInfo,
    GraphView, RosBackend, ServiceRequest, SubscriptionSample,
};
use std::collections::HashMap;
use std::sync::mpsc as std_mpsc;
use std::thread::JoinHandle;
use tokio::sync::{mpsc, oneshot};

const WAIT_TIMEOUT_NS: i64 = 100_000_000; // 100ms safety wakeup

/// Topic name → type names, as returned by the graph query.
pub type GraphTopics = Vec<(String, Vec<String>)>;

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
    Destroy {
        entity: EntityId,
        reply: oneshot::Sender<()>,
    },
    GraphTopics {
        reply: oneshot::Sender<Result<GraphTopics, BackendError>>,
    },
}

/// Handle to the ROS attachment thread (see module docs).
pub struct RclBackend {
    commands: Option<std_mpsc::Sender<Command>>,
    trigger: GuardTrigger,
    thread: Option<JoinHandle<()>>,
}

impl RclBackend {
    /// Initialize rcl on `domain_id` and start the attachment thread.
    pub fn spawn(domain_id: u8) -> Result<Self, BackendError> {
        let (command_tx, command_rx) = std_mpsc::channel::<Command>();
        let (init_tx, init_rx) = std_mpsc::channel::<Result<GuardTrigger, BackendError>>();
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

fn unsupported_service_action(what: &str) -> BackendError {
    BackendError::schema_unavailable(format!(
        "{what}: live ROS service/action FFI is not linked in this build"
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

    async fn create_client(&self, _spec: &ChannelSpec) -> Result<EntityId, BackendError> {
        Err(unsupported_service_action("create_client"))
    }

    async fn create_service(
        &self,
        _spec: &ChannelSpec,
        _sink: mpsc::Sender<ServiceRequest>,
    ) -> Result<EntityId, BackendError> {
        Err(unsupported_service_action("create_service"))
    }

    async fn call(
        &self,
        _entity: EntityId,
        _operation_id: [u8; 16],
        _request: Vec<u8>,
    ) -> Result<Vec<u8>, BackendError> {
        Err(unsupported_service_action("call"))
    }

    async fn send_service_response(
        &self,
        _entity: EntityId,
        _operation_id: [u8; 16],
        _response: Vec<u8>,
    ) -> Result<(), BackendError> {
        Err(unsupported_service_action("send_service_response"))
    }

    async fn create_action_client(&self, _spec: &ChannelSpec) -> Result<EntityId, BackendError> {
        Err(unsupported_service_action("create_action_client"))
    }

    async fn create_action_server(
        &self,
        _spec: &ChannelSpec,
        _sink: mpsc::Sender<ActionInbound>,
    ) -> Result<EntityId, BackendError> {
        Err(unsupported_service_action("create_action_server"))
    }

    async fn send_action_goal(
        &self,
        _entity: EntityId,
        _operation_id: [u8; 16],
        _request: Vec<u8>,
    ) -> Result<Vec<u8>, BackendError> {
        Err(unsupported_service_action("send_action_goal"))
    }

    async fn cancel_action(
        &self,
        _entity: EntityId,
        _operation_id: [u8; 16],
        _request: Vec<u8>,
    ) -> Result<Vec<u8>, BackendError> {
        Err(unsupported_service_action("cancel_action"))
    }

    async fn send_action_feedback(
        &self,
        _entity: EntityId,
        _operation_id: [u8; 16],
        _payload: Vec<u8>,
    ) -> Result<(), BackendError> {
        Err(unsupported_service_action("send_action_feedback"))
    }

    async fn send_action_result(
        &self,
        _entity: EntityId,
        _operation_id: [u8; 16],
        _payload: Vec<u8>,
    ) -> Result<(), BackendError> {
        Err(unsupported_service_action("send_action_result"))
    }

    async fn send_action_status(
        &self,
        _entity: EntityId,
        _operation_id: [u8; 16],
        _payload: Vec<u8>,
    ) -> Result<(), BackendError> {
        Err(unsupported_service_action("send_action_status"))
    }

    async fn graph_view(&self) -> Result<GraphView, BackendError> {
        let topics = self.graph_topics().await?;
        let node_id = {
            let mut id = [0u8; 16];
            id[15] = 1;
            id.to_vec()
        };
        let node = GraphNodeInfo {
            id: node_id.clone(),
            name: format!("rclwebd_{}", std::process::id()),
            namespace: None,
            domain_id: 0,
        };
        let mut endpoints = Vec::new();
        for (index, (topic, types)) in topics.into_iter().enumerate() {
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
                name: topic,
                kind: 0, // topic_pub synthesized from graph_topics
                type_name,
                domain_id: 0,
            });
        }
        Ok(GraphView {
            nodes: vec![node],
            endpoints,
        })
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

struct Worker {
    attachment: Attachment,
    guard: GuardCondition,
    wait_set: WaitSet,
    take: TakeBuffer,
    next_entity: EntityId,
    subscriptions: Vec<SubscriptionEntry>,
    publishers: HashMap<EntityId, SerializedPublisher>,
}

fn worker_entry(
    domain_id: u8,
    init_tx: &std_mpsc::Sender<Result<GuardTrigger, BackendError>>,
    commands: &std_mpsc::Receiver<Command>,
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

impl Worker {
    fn init(domain_id: u8) -> Result<Self, BackendError> {
        let node_name = format!("rclwebd_{}", std::process::id());
        let mut attachment =
            Attachment::init(usize::from(domain_id), &node_name).map_err(map_rcl_error)?;
        let guard = GuardCondition::create(&mut attachment).map_err(map_rcl_error)?;
        let wait_set = WaitSet::new(&mut attachment, 4).map_err(map_rcl_error)?;
        let take = TakeBuffer::new().map_err(map_rcl_error)?;
        Ok(Self {
            attachment,
            guard,
            wait_set,
            take,
            next_entity: 0,
            subscriptions: Vec::new(),
            publishers: HashMap::new(),
        })
    }

    fn run(&mut self, commands: &std_mpsc::Receiver<Command>) {
        loop {
            loop {
                match commands.try_recv() {
                    Ok(command) => self.handle(command),
                    Err(std_mpsc::TryRecvError::Empty) => break,
                    Err(std_mpsc::TryRecvError::Disconnected) => return,
                }
            }
            if let Err(err) = self.wait_and_pump() {
                // A wait-set failure is unrecoverable for the attachment.
                eprintln!("rclwebd ros thread: {err}");
                return;
            }
        }
    }

    fn allocate(&mut self) -> EntityId {
        self.next_entity += 1;
        self.next_entity
    }

    fn handle(&mut self, command: Command) {
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
            Command::Destroy { entity, reply } => {
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
                let _ = reply.send(());
            }
            Command::GraphTopics { reply } => {
                let _ = reply.send(
                    self.attachment
                        .topic_names_and_types()
                        .map_err(map_rcl_error),
                );
            }
        }
    }

    fn create_subscription(
        &mut self,
        spec: &ChannelSpec,
        sink: mpsc::Sender<SubscriptionSample>,
    ) -> Result<EntityId, BackendError> {
        let Some(type_support) = ffi::message_type_support(&spec.type_name) else {
            return Err(BackendError::new(
                10,
                format!("no statically linked typesupport for {}", spec.type_name),
            ));
        };
        let subscription = SerializedSubscription::create(
            &mut self.attachment,
            &spec.topic,
            type_support,
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
        let Some(type_support) = ffi::message_type_support(&spec.type_name) else {
            return Err(BackendError::new(
                10,
                format!("no statically linked typesupport for {}", spec.type_name),
            ));
        };
        let publisher =
            SerializedPublisher::create(&mut self.attachment, &spec.topic, type_support, &spec.qos)
                .map_err(map_rcl_error)?;
        let entity = self.allocate();
        self.publishers.insert(entity, publisher);
        Ok(entity)
    }

    fn wait_and_pump(&mut self) -> Result<(), BackendError> {
        if self.subscriptions.len() > self.wait_set.capacity() {
            let capacity = (self.subscriptions.len() * 2).max(4);
            let fresh = WaitSet::new(&mut self.attachment, capacity).map_err(map_rcl_error)?;
            let old = std::mem::replace(&mut self.wait_set, fresh);
            old.fini();
        }
        let handles: Vec<&SerializedSubscription> = self
            .subscriptions
            .iter()
            .map(|entry| &entry.subscription)
            .collect();
        let ready = self
            .wait_set
            .wait(&handles, &self.guard, WAIT_TIMEOUT_NS)
            .map_err(map_rcl_error)?;
        drop(handles);
        for index in ready {
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
                        // Bounded pre-sequence handoff into the connection
                        // write queue. R2-01 owns latest-wins / disposition
                        // accounting on that queue; a full mpsc here only
                        // drops when the connection task is stuck.
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
        Ok(())
    }

    fn teardown(mut self) {
        for entry in self.subscriptions.drain(..) {
            entry.subscription.fini(&mut self.attachment);
        }
        for (_, publisher) in self.publishers.drain() {
            publisher.fini(&mut self.attachment);
        }
        self.wait_set.fini();
        self.take.fini();
        self.guard.fini();
        self.attachment.fini();
    }
}
