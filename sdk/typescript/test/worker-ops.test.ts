/**
 * Worker-path (default `connect`, not `inline`) coverage for subscribe,
 * graph, services, and actions. Scripted peer bytes come from fixture-gen.
 */

import { expect, test } from "bun:test";
import path from "node:path";
import { connect, STD_MSGS_STRING } from "../src/index.ts";
import { scriptedPeerFixtures } from "./scripted-peer.ts";

const wasmPath = path.join(import.meta.dir, "..", "wasm", "rclweb.wasm");
const OPCODE_CONTROL = 1;
const OPCODE_SERVICE_REQUEST = 3;
const OPCODE_SERVICE_RESPONSE = 4;
const OPCODE_ACTION_GOAL = 5;
const OPCODE_ACTION_RESULT = 7;

function pathToFileUrl(p: string): string {
  return `file://${path.resolve(p)}`;
}

function echoOpcode(frame: Uint8Array, opcode: number): Uint8Array {
  const out = frame.slice();
  out[1] = opcode;
  return out;
}

function isHello(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x32;
}

test("Worker path: scripted subscribe reaches a typed String sample", async () => {
  const fixtures = scriptedPeerFixtures();
  const wasmUrl = pathToFileUrl(wasmPath);
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
              ws.send(fixtures.sample);
              step = "done";
            }
          }, 10);
        }
      },
    },
  });

  const client = await connect(`ws://127.0.0.1:${server.port}`, { wasmUrl });
  const sub = await client.session.subscribe("/chatter", STD_MSGS_STRING);
  const sample = await new Promise<{ data: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("sample timeout")), 5000);
    sub.onMessage((msg, lease) => {
      clearTimeout(timer);
      lease.release();
      resolve(msg);
    });
  });
  expect(sample.data).toBe("hello-from-fixture");
  await client.close();
  server.stop(true);
});

test("Worker path: GraphSnapshot reaches onGraph", async () => {
  const fixtures = scriptedPeerFixtures();
  const wasmUrl = pathToFileUrl(wasmPath);
  let step: "hello" | "ready" | "done" = "hello";

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
          step = "done";
          ws.send(fixtures.sessionReady);
          ws.send(fixtures.graphSnapshot);
        }
      },
    },
  });

  const client = await connect(`ws://127.0.0.1:${server.port}`, { wasmUrl });
  const graph = await new Promise<{ generation: number; name: string }>(
    (resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("graph timeout")), 5000);
      client.session.onGraph((view) => {
        if (view.generation < 1 || view.nodes.length === 0) return;
        clearTimeout(timer);
        resolve({ generation: view.generation, name: view.nodes[0]!.name });
      });
    },
  );
  expect(graph.generation).toBe(1);
  expect(graph.name).toBe("/talker");
  await client.close();
  server.stop(true);
});

test("Worker path: service client call echoes CDR payload", async () => {
  const fixtures = scriptedPeerFixtures();
  const wasmUrl = pathToFileUrl(wasmPath);
  const request = new TextEncoder().encode("req-bytes");
  let step: "hello" | "ready" | "open" | "call" = "hello";

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
          step = "open";
          ws.send(fixtures.sessionReady);
          return;
        }
        if (step === "open" && bytes[1] === OPCODE_CONTROL) {
          step = "call";
          ws.send(fixtures.serviceChannelReady);
          return;
        }
        if (step === "call" && bytes[1] === OPCODE_SERVICE_REQUEST) {
          ws.send(echoOpcode(bytes, OPCODE_SERVICE_RESPONSE));
        }
      },
    },
  });

  const client = await connect(`ws://127.0.0.1:${server.port}`, { wasmUrl });
  const svc = await client.session.createServiceClient(
    "/add_two_ints",
    "example_interfaces/srv/AddTwoInts",
  );
  const response = await svc.call(request);
  expect([...response]).toEqual([...request]);
  await client.close();
  server.stop(true);
});

test("Worker path: action client sendGoal echoes result CDR", async () => {
  const fixtures = scriptedPeerFixtures();
  const wasmUrl = pathToFileUrl(wasmPath);
  const goal = new TextEncoder().encode("goal-bytes");
  let step: "hello" | "ready" | "open" | "goal" = "hello";

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
          step = "open";
          ws.send(fixtures.sessionReady);
          return;
        }
        if (step === "open" && bytes[1] === OPCODE_CONTROL) {
          step = "goal";
          ws.send(fixtures.actionChannelReady);
          return;
        }
        if (step === "goal" && bytes[1] === OPCODE_ACTION_GOAL) {
          ws.send(echoOpcode(bytes, OPCODE_ACTION_RESULT));
        }
      },
    },
  });

  const client = await connect(`ws://127.0.0.1:${server.port}`, { wasmUrl });
  const action = await client.session.createActionClient(
    "/fibonacci",
    "example_interfaces/action/Fibonacci",
  );
  const { result } = action.sendGoal(goal);
  const payload = await result;
  expect([...payload]).toEqual([...goal]);
  await client.close();
  server.stop(true);
});
