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
                ws.send(fixtures.sample);
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
  expect(cloud.data.byteLength).toBe(48);
  expect(cloud.header.frame_id).toBe("");
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
