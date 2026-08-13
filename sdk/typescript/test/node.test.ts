/**
 * Public rclcpp-shaped API: init / Node / createPublisher / createSubscription.
 * Leases, connect, and type-name strings must not appear on this path.
 */

import { afterEach, expect, test } from "bun:test";
import path from "node:path";
import {
  init,
  Node,
  ok,
  rclweb_cdr_interfaces,
  sensor_msgs,
  shutdown,
  std_msgs,
} from "../src/index.ts";
import { scriptedPeerFixtures } from "./scripted-peer.ts";

const wasmPath = path.join(import.meta.dir, "..", "wasm", "rclweb.wasm");
const OPCODE_CONTROL = 1;
const OPCODE_ROS_SAMPLE = 2;

function pathToFileUrl(p: string): string {
  return `file://${path.resolve(p)}`;
}

function isHello(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x32;
}

afterEach(async () => {
  if (ok()) await shutdown();
});

function serveScripted(options: {
  inboundSample?: boolean;
  inboundFrame?: Uint8Array;
  onOutboundSample?: (bytes: Uint8Array) => void;
} = {}) {
  const fixtures = scriptedPeerFixtures();
  let step: "hello" | "ready" | "channel" | "sample" | "done" = "hello";
  return Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return undefined;
      return new Response("expected websocket", { status: 400 });
    },
    websocket: {
      message(ws, message) {
        const bytes =
          message instanceof ArrayBuffer
            ? new Uint8Array(message)
            : typeof message === "string"
              ? new TextEncoder().encode(message)
              : new Uint8Array(message);
        if (step === "hello" && isHello(bytes)) {
          step = "ready";
          ws.send(fixtures.serverHello);
          return;
        }
        if (step === "ready" && bytes[1] === OPCODE_CONTROL) {
          step = "channel";
          ws.send(fixtures.sessionReady);
          return;
        }
        if (step === "channel" && bytes[1] === OPCODE_CONTROL) {
          step = "sample";
          ws.send(fixtures.channelReady);
          if (options.inboundSample !== false) {
            setTimeout(() => {
              if (step === "sample") {
                ws.send(options.inboundFrame ?? fixtures.sample);
                step = "done";
              }
            }, 10);
          }
          return;
        }
        if (bytes[1] === OPCODE_ROS_SAMPLE) {
          options.onOutboundSample?.(bytes);
          step = "done";
        }
      },
    },
  });
}

test("Node subscribe delivers std_msgs.msg.String without a lease", async () => {
  const server = serveScripted();
  await init(`ws://127.0.0.1:${server.port}`, {
    wasmUrl: pathToFileUrl(wasmPath),
  });
  const node = new Node("minimal_subscriber");
  const sample = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("sample timeout")), 5000);
    node.createSubscription(std_msgs.msg.String, "chatter", 10, (msg) => {
      clearTimeout(timer);
      resolve(msg.data);
    });
  });
  expect(sample).toBe("hello-from-fixture");
  expect(node.getName()).toBe("minimal_subscriber");
  server.stop(true);
});

test("Node publish sends std_msgs.msg.String", async () => {
  let sampleFrame: Uint8Array | null = null;
  const server = serveScripted({
    inboundSample: false,
    onOutboundSample: (bytes) => {
      sampleFrame = bytes;
    },
  });
  await init(`ws://127.0.0.1:${server.port}`, {
    wasmUrl: pathToFileUrl(wasmPath),
  });
  const node = new Node("minimal_publisher");
  const publisher = node.createPublisher(std_msgs.msg.String, "chatter", 10);
  expect(publisher.topic).toBe("/chatter");
  const message = new std_msgs.msg.String();
  message.data = "hello from node";
  publisher.publish(message);
  const deadline = Date.now() + 5000;
  while (sampleFrame == null && Date.now() < deadline) {
    await Bun.sleep(10);
  }
  expect(sampleFrame).not.toBeNull();
  expect(sampleFrame!.length).toBeGreaterThan(4);
  server.stop(true);
});

test("PointCloud2 callback uses ROS field names and owns data", async () => {
  const fixtures = scriptedPeerFixtures();
  let step: "hello" | "ready" | "channel" | "sample" | "done" = "hello";
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return undefined;
      return new Response("expected websocket", { status: 400 });
    },
    websocket: {
      message(ws, message) {
        const bytes =
          message instanceof ArrayBuffer
            ? new Uint8Array(message)
            : typeof message === "string"
              ? new TextEncoder().encode(message)
              : new Uint8Array(message);
        if (step === "hello" && isHello(bytes)) {
          step = "ready";
          ws.send(fixtures.serverHello);
          return;
        }
        if (step === "ready" && bytes[1] === OPCODE_CONTROL) {
          step = "channel";
          ws.send(fixtures.sessionReady);
          return;
        }
        if (step === "channel" && bytes[1] === OPCODE_CONTROL) {
          step = "sample";
          ws.send(fixtures.channelReady);
          setTimeout(() => {
            if (step === "sample") {
              ws.send(fixtures.pointCloud2Sample);
              step = "done";
            }
          }, 10);
        }
      },
    },
  });

  await init(`ws://127.0.0.1:${server.port}`, {
    wasmUrl: pathToFileUrl(wasmPath),
  });
  const node = new Node("cloud_listener");
  const cloud = await new Promise<InstanceType<typeof sensor_msgs.msg.PointCloud2>>(
    (resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("cloud timeout")), 5000);
      node.createSubscription(
        sensor_msgs.msg.PointCloud2,
        "/points",
        10,
        (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
      );
    },
  );
  expect(cloud.width).toBe(4);
  expect(cloud.point_step).toBe(12);
  expect(cloud.fields.length).toBe(3);
  expect(cloud.fields[0]!.name).toBe("x");
  expect(cloud.fields[0]!.offset).toBe(0);
  expect(cloud.fields[0]!.datatype).toBe(sensor_msgs.msg.PointField.FLOAT32);
  expect(cloud.data.byteLength).toBe(48);
  expect(cloud.header.frame_id).toBe("map");
  expect(cloud.header.stamp.sec).toBe(1);
  expect(cloud.header.stamp.nanosec).toBe(2);
  server.stop(true);
});

test("Node publish sends PointCloud2 header and fields", async () => {
  let sampleFrame: Uint8Array | null = null;
  const fixtures = scriptedPeerFixtures();
  let step: "hello" | "ready" | "channel" | "sample" | "done" = "hello";
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return undefined;
      return new Response("expected websocket", { status: 400 });
    },
    websocket: {
      message(ws, message) {
        const bytes =
          message instanceof ArrayBuffer
            ? new Uint8Array(message)
            : typeof message === "string"
              ? new TextEncoder().encode(message)
              : new Uint8Array(message);
        if (step === "hello" && isHello(bytes)) {
          step = "ready";
          ws.send(fixtures.serverHello);
          return;
        }
        if (step === "ready" && bytes[1] === OPCODE_CONTROL) {
          step = "channel";
          ws.send(fixtures.sessionReady);
          return;
        }
        if (step === "channel" && bytes[1] === OPCODE_CONTROL) {
          step = "sample";
          ws.send(fixtures.channelReady);
          return;
        }
        if (bytes[1] === OPCODE_ROS_SAMPLE) {
          sampleFrame = bytes;
          step = "done";
        }
      },
    },
  });

  await init(`ws://127.0.0.1:${server.port}`, {
    wasmUrl: pathToFileUrl(wasmPath),
  });
  const node = new Node("cloud_talker");
  const publisher = node.createPublisher(sensor_msgs.msg.PointCloud2, "points", 10);
  const cloud = new sensor_msgs.msg.PointCloud2();
  cloud.header.frame_id = "camera";
  cloud.header.stamp.sec = 9;
  cloud.header.stamp.nanosec = 8;
  cloud.height = 1;
  cloud.width = 1;
  cloud.point_step = 16;
  cloud.row_step = 16;
  cloud.is_dense = false;
  cloud.fields = [
    Object.assign(new sensor_msgs.msg.PointField(), {
      name: "rgb",
      offset: 0,
      datatype: sensor_msgs.msg.PointField.UINT32,
      count: 1,
    }),
  ];
  cloud.data = new Uint8Array(16);
  publisher.publish(cloud);
  const deadline = Date.now() + 5000;
  while (sampleFrame == null && Date.now() < deadline) {
    await Bun.sleep(10);
  }
  expect(sampleFrame).not.toBeNull();
  expect(sampleFrame!.length).toBeGreaterThan(4);
  server.stop(true);
});

test("init is required and is not callable twice", async () => {
  expect(ok()).toBe(false);
  expect(() => new Node("n")).toThrow("init");
  const server = serveScripted();
  await init(`ws://127.0.0.1:${server.port}`, {
    wasmUrl: pathToFileUrl(wasmPath),
  });
  expect(ok()).toBe(true);
  await expect(
    init(`ws://127.0.0.1:${server.port}`, { wasmUrl: pathToFileUrl(wasmPath) }),
  ).rejects.toThrow("already called");
  server.stop(true);
});

test("Node subscribe delivers PrimitiveScalars without a lease", async () => {
  const fixtures = scriptedPeerFixtures();
  const server = serveScripted({ inboundFrame: fixtures.primitiveScalarsSample });
  await init(`ws://127.0.0.1:${server.port}`, {
    wasmUrl: pathToFileUrl(wasmPath),
  });
  const node = new Node("scalar_listener");
  const sample = await new Promise<InstanceType<typeof rclweb_cdr_interfaces.msg.PrimitiveScalars>>(
    (resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("sample timeout")), 5000);
      node.createSubscription(
        rclweb_cdr_interfaces.msg.PrimitiveScalars,
        "scalars",
        10,
        (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
      );
    },
  );
  expect(sample.string_value).toBe("hello-scalars");
  expect(sample.int64_value).toBe(-70_000n);
  expect(sample.wstring_value).toBe("wide");
  server.stop(true);
});

test("Node publish sends PrimitiveScalars", async () => {
  let sampleFrame: Uint8Array | null = null;
  const server = serveScripted({
    inboundSample: false,
    onOutboundSample: (bytes) => {
      sampleFrame = bytes;
    },
  });
  await init(`ws://127.0.0.1:${server.port}`, {
    wasmUrl: pathToFileUrl(wasmPath),
  });
  const node = new Node("scalar_talker");
  const publisher = node.createPublisher(
    rclweb_cdr_interfaces.msg.PrimitiveScalars,
    "scalars",
    10,
  );
  const message = new rclweb_cdr_interfaces.msg.PrimitiveScalars();
  message.string_value = "hello-scalars";
  message.int64_value = -70_000n;
  message.uint64_value = 80_000n;
  message.bool_value = true;
  publisher.publish(message);
  const deadline = Date.now() + 5000;
  while (sampleFrame == null && Date.now() < deadline) {
    await Bun.sleep(10);
  }
  expect(sampleFrame).not.toBeNull();
  expect(sampleFrame!.length).toBeGreaterThan(4);
  server.stop(true);
});

test("Node subscribe delivers NestedSample collections", async () => {
  const fixtures = scriptedPeerFixtures();
  const server = serveScripted({ inboundFrame: fixtures.nestedSample });
  await init(`ws://127.0.0.1:${server.port}`, {
    wasmUrl: pathToFileUrl(wasmPath),
  });
  const node = new Node("nested_listener");
  const sample = await new Promise<InstanceType<typeof rclweb_cdr_interfaces.msg.NestedSample>>(
    (resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("nested timeout")), 5000);
      node.createSubscription(
        rclweb_cdr_interfaces.msg.NestedSample,
        "nested",
        10,
        (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
      );
    },
  );
  expect(sample.stamp.sec).toBe(11);
  expect(sample.stamp.nanosec).toBe(22);
  expect(sample.scalars.string_value).toBe("hello-scalars");
  expect(sample.collections.bounded_string).toBe("abc");
  expect([...sample.collections.bytes_value]).toEqual([10, 20, 30]);
  server.stop(true);
});
