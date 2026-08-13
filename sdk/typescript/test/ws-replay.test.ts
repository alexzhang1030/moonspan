/**
 * Scripted WebSocket server replaying committed peer bytes into the inline SDK host.
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { connect, STD_MSGS_STRING } from "../src/internal.ts";
import { scriptedPeerFixtures } from "./scripted-peer.ts";

const wasmPath = path.join(import.meta.dir, "..", "wasm", "rclweb.wasm");

test("scripted WebSocket replay reaches a typed String sample", async () => {
  const fixtures = scriptedPeerFixtures();
  const wasmUrl = pathToFileUrl(wasmPath);

  let step: "hello" | "ready" | "channel" | "sample" | "done" = "hello";

  const server = Bun.serve<{ outbound: Uint8Array[] }>({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req, { data: { outbound: [] } })) {
        return undefined;
      }
      return new Response("expected websocket", { status: 400 });
    },
    websocket: {
      open(ws) {
        // Wait for ClientHello, then replay the scripted peer stream.
        void ws;
      },
      message(ws, message) {
        const bytes =
          typeof message === "string"
            ? new TextEncoder().encode(message)
            : message instanceof ArrayBuffer
              ? new Uint8Array(message)
              : new Uint8Array(message);

        if (step === "hello") {
          // ClientHello received.
          expect(bytes.length).toBeGreaterThan(12);
          step = "ready";
          ws.send(fixtures.serverHello);
          return;
        }
        if (step === "ready") {
          // Authenticate received.
          step = "channel";
          ws.send(fixtures.sessionReady);
          return;
        }
        if (step === "channel") {
          // OpenChannel received.
          step = "sample";
          ws.send(fixtures.channelReady);
          // Sample follows once the client has processed ChannelReady.
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

  const url = `ws://127.0.0.1:${server.port}`;
  const client = await connect(url, { inline: true, wasmUrl });

  const sub = await client.session.subscribe("/chatter", STD_MSGS_STRING);
  const sample = await new Promise<{ data: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("sample timeout")), 3000);
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

function pathToFileUrl(p: string): string {
  const resolved = path.resolve(p);
  return `file://${resolved}`;
}
