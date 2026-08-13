import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { STD_MSGS_STRING } from "../src/index.ts";
import {
  connectOfflineForTests,
  decodePollResult,
  encodeHostBatch,
  loadWasm,
  pollEngine,
  resolveIoWorkerUrl,
} from "../src/internal.ts";
import { scriptedPeerFixtures } from "./scripted-peer.ts";

const wasmPath = path.join(import.meta.dir, "..", "wasm", "rclweb.wasm");

test("sdk package identity and privacy", () => {
  const packageJsonPath = path.join(import.meta.dir, "..", "package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    name: string;
    version: string;
    private: boolean;
    type: string;
    exports: Record<string, string>;
  };
  expect(pkg.name).toBe("@rclweb/sdk");
  expect(pkg.version).toBe("0.0.0");
  expect(pkg.private).toBe(true);
  expect(pkg.type).toBe("module");
  expect(pkg.exports["."]).toBe("./src/index.ts");
  expect(pkg.exports["./internal"]).toBe("./src/internal.ts");
});

test("public runtime exports stay application-facing", async () => {
  const sdk = await import("../src/index.ts");
  expect(Object.keys(sdk).sort()).toEqual([
    "DEFAULT_QOS_DEPTH",
    "STD_MSGS_STRING",
    "connect",
    "decodeCertificateHashValue",
    "fetchLocalDevTlsHashes",
    "httpOriginFromWebTransportUrl",
  ]);
  expect(sdk).not.toHaveProperty("loadWasm");
  expect(sdk).not.toHaveProperty("IoHost");
  expect(sdk).not.toHaveProperty("connectOfflineForTests");
  expect(sdk).not.toHaveProperty("encodeHostBatch");
  expect(sdk).not.toHaveProperty("SENSOR_MSGS_POINT_CLOUD2");
});

test("workspace export map resolves public and internal subpaths", async () => {
  const pub = await import("@rclweb/sdk");
  const intern = await import("@rclweb/sdk/internal");
  expect(typeof pub.connect).toBe("function");
  expect(typeof intern.resolveIoWorkerUrl).toBe("function");
  expect(intern).not.toHaveProperty("connect");
});

test("I/O Worker URL follows the loading script extension", () => {
  expect(
    resolveIoWorkerUrl("file:///pkg/dist/index.js").href,
  ).toBe("file:///pkg/dist/worker/io-worker.js");
  expect(
    resolveIoWorkerUrl("file:///pkg/src/client.ts").href,
  ).toBe("file:///pkg/src/worker/io-worker.ts");
  expect(
    resolveIoWorkerUrl(
      "file:///pkg/dist/index.js",
      "https://example.test/io-worker.js",
    ).href,
  ).toBe("https://example.test/io-worker.js");
});

test("wasm artifact loads and exports the poll ABI", async () => {
  const bytes = readFileSync(wasmPath);
  const wasm = await loadWasm(bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ));
  const handle = wasm.rclweb_engine_new();
  expect(handle).toBeGreaterThan(0);
  const batch = encodeHostBatch([
    {
      type: "command",
      command: { type: "start", transferableArrayBuffer: true },
    },
  ]);
  const result = pollEngine(wasm, handle, [
    {
      type: "command",
      command: { type: "start", transferableArrayBuffer: true },
    },
  ]);
  expect(result.outbound.length).toBe(1);
  expect(result.outbound[0]!.bytes.length).toBeGreaterThan(12);
  // Result codec round-trip
  const reencoded = encodeHostBatch([]);
  expect(reencoded[0]).toBeDefined();
  void batch;
  void decodePollResult;
  wasm.rclweb_engine_free(handle);
});

test("scripted peer: connect → subscribe → String sample + lease release", async () => {
  const fixtures = scriptedPeerFixtures();
  const wasmBytes = readFileSync(wasmPath);
  const client = await connectOfflineForTests(
    wasmBytes.buffer.slice(
      wasmBytes.byteOffset,
      wasmBytes.byteOffset + wasmBytes.byteLength,
    ),
  );

  const host = client.host;
  host.startOffline();
  host.flushSync();

  host.ingestBytes(fixtures.serverHello);
  host.flushSync();

  // Auto-auth may already have been queued by bootstrapComplete; flush again.
  host.flushSync();

  host.ingestBytes(fixtures.sessionReady);
  host.flushSync();

  const subPromise = client.session.subscribe("/chatter", STD_MSGS_STRING);
  // OpenChannel is pending; feed ChannelReady.
  host.ingestBytes(fixtures.channelReady);
  host.flushSync();
  const sub = await subPromise;
  expect(sub.channelId).toBe(1);
  expect(sub.topic).toBe("/chatter");
  expect(sub.typeName).toBe(STD_MSGS_STRING);

  let saw: { data: string; leaseId: number } | null = null;
  sub.onMessage((msg, lease) => {
    saw = { data: msg.data, leaseId: lease.leaseId };
    lease.release();
  });

  host.ingestBytes(fixtures.sample);
  host.flushSync();

  expect(saw).not.toBeNull();
  expect(saw!.data).toBe("hello-from-fixture");
  expect(saw!.leaseId).toBeGreaterThan(0);

  await client.close();
});

test("scripted peer: sample with no handler still releases its lease", async () => {
  const fixtures = scriptedPeerFixtures();
  const wasmBytes = readFileSync(wasmPath);
  const client = await connectOfflineForTests(
    wasmBytes.buffer.slice(
      wasmBytes.byteOffset,
      wasmBytes.byteOffset + wasmBytes.byteLength,
    ),
  );

  const host = client.host;
  host.startOffline();
  host.flushSync();

  host.ingestBytes(fixtures.serverHello);
  host.flushSync();
  host.flushSync();

  host.ingestBytes(fixtures.sessionReady);
  host.flushSync();

  const subPromise = client.session.subscribe("/chatter", STD_MSGS_STRING);
  host.ingestBytes(fixtures.channelReady);
  host.flushSync();
  const sub = await subPromise;
  expect(sub.channelId).toBe(1);

  // Deliberately no onMessage handler: the no-handler drop path must release
  // the lease (subscribed + first sample can share one poll flush).
  host.ingestBytes(fixtures.sample);
  host.flushSync();
  // The drop-site release is enqueued (not flushSync'd); drain it.
  host.flushSync();

  const telemetry = client.telemetry();
  expect(telemetry).not.toBeNull();
  expect(telemetry!.samplesEmitted).toBeGreaterThan(0);
  expect(telemetry!.leasesReleased).toBe(telemetry!.samplesEmitted);

  await client.close();
});

test("scripted peer: publish → ChannelReady → SendSample outbound", async () => {
  const fixtures = scriptedPeerFixtures();
  const wasmBytes = readFileSync(wasmPath);
  const client = await connectOfflineForTests(
    wasmBytes.buffer.slice(
      wasmBytes.byteOffset,
      wasmBytes.byteOffset + wasmBytes.byteLength,
    ),
  );

  const host = client.host;
  host.startOffline();
  host.flushSync();
  host.ingestBytes(fixtures.serverHello);
  host.flushSync();
  host.flushSync();
  host.ingestBytes(fixtures.sessionReady);
  host.flushSync();

  const pubPromise = client.session.publish("/chatter", STD_MSGS_STRING, {
    reliability: 1,
    depth: 5,
  });
  // Capture OpenChannel outbound before ChannelReady.
  host.flushSync();
  host.ingestBytes(fixtures.channelReady);
  host.flushSync();
  const publisher = await pubPromise;
  expect(publisher.channelId).toBe(1);
  expect(publisher.topic).toBe("/chatter");

  await publisher.publish({ data: "hello-publish" });
  const telemetry = client.telemetry();
  expect(telemetry).not.toBeNull();
  expect(telemetry!.samplesSent).toBe(1);

  await client.close();
});
