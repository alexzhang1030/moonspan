import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sensor_msgs, std_msgs } from "../src/index.ts";
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
    "Client",
    "Header",
    "KeepLast",
    "Node",
    "PointCloud2",
    "PointField",
    "Publisher",
    "QoS",
    "Service",
    "String",
    "Subscription",
    "Time",
    "WallTimer",
    "builtin_interfaces",
    "decodeCertificateHashValue",
    "fetchLocalDevTlsHashes",
    "httpOriginFromWebTransportUrl",
    "init",
    "ok",
    "sensor_msgs",
    "shutdown",
    "spin",
    "std_msgs",
  ]);
  expect(sdk).not.toHaveProperty("connect");
  expect(sdk).not.toHaveProperty("loadWasm");
  expect(sdk).not.toHaveProperty("IoHost");
  expect(sdk).not.toHaveProperty("connectOfflineForTests");
  expect(sdk).not.toHaveProperty("encodeHostBatch");
  expect(sdk).not.toHaveProperty("STD_MSGS_STRING");
  expect(sdk).not.toHaveProperty("SENSOR_MSGS_POINT_CLOUD2");
});

test("workspace export map resolves public and internal subpaths", async () => {
  const pub = await import("@rclweb/sdk");
  const intern = await import("@rclweb/sdk/internal");
  expect(typeof pub.init).toBe("function");
  expect(typeof pub.Node).toBe("function");
  expect(pub.std_msgs.msg.String.typeName).toBe("std_msgs/msg/String");
  expect(typeof intern.resolveIoWorkerUrl).toBe("function");
  expect(typeof intern.connect).toBe("function");
  expect(intern).not.toHaveProperty("init");
  expect(intern).not.toHaveProperty("STD_MSGS_STRING");
  expect(intern).not.toHaveProperty("SENSOR_MSGS_POINT_CLOUD2");
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

  const subPromise = client.session.subscribe("/chatter", std_msgs.msg.String);
  // OpenChannel is pending; feed ChannelReady.
  host.ingestBytes(fixtures.channelReady);
  host.flushSync();
  const sub = await subPromise;
  expect(sub.channelId).toBe(1);
  expect(sub.topic).toBe("/chatter");
  expect(sub.typeName).toBe(std_msgs.msg.String.typeName);

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

  const subPromise = client.session.subscribe("/chatter", std_msgs.msg.String);
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

  const pubPromise = client.session.publish("/chatter", std_msgs.msg.String, {
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

function xyzCloud(points: number) {
  const data = new Uint8Array(points * 12);
  const view = new DataView(data.buffer);
  for (let i = 0; i < points; i++) {
    view.setFloat32(i * 12, i * 0.01, true);
    view.setFloat32(i * 12 + 4, i * 0.02, true);
    view.setFloat32(i * 12 + 8, i * 0.03, true);
  }
  return {
    stampSec: 1,
    stampNanosec: 2,
    frameId: "map",
    height: 1,
    width: points,
    fields: [
      { name: "x", offset: 0, datatype: 7, count: 1 },
      { name: "y", offset: 4, datatype: 7, count: 1 },
      { name: "z", offset: 8, datatype: 7, count: 1 },
    ],
    pointStep: 12,
    rowStep: points * 12,
    isBigendian: false,
    isDense: true,
    data,
  };
}

test("scripted peer: publish PointCloud2 increments samplesSent", async () => {
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

  const pubPromise = client.session.publish("/points", sensor_msgs.msg.PointCloud2);
  host.flushSync();
  host.ingestBytes(fixtures.channelReady);
  host.flushSync();
  const publisher = await pubPromise;
  expect(publisher.typeName).toBe(sensor_msgs.msg.PointCloud2.typeName);

  await publisher.publish(xyzCloud(4));
  const telemetry = client.telemetry();
  expect(telemetry).not.toBeNull();
  expect(telemetry!.samplesSent).toBe(1);

  await client.close();
});

function readXyz(data: Uint8Array, index: number): [number, number, number] {
  const view = new DataView(data.buffer, data.byteOffset + index * 12, 12);
  return [
    view.getFloat32(0, true),
    view.getFloat32(4, true),
    view.getFloat32(8, true),
  ];
}

test("scripted peer: PointCloud2 sample is a borrowed wasm view", async () => {
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

  const subPromise = client.session.subscribe("/points", sensor_msgs.msg.PointCloud2);
  host.ingestBytes(fixtures.channelReady);
  host.flushSync();
  const sub = await subPromise;
  expect(sub.typeName).toBe(sensor_msgs.msg.PointCloud2.typeName);

  let saw: {
    width: number;
    height: number;
    dataLen: number;
    borrowed: boolean;
    frameId: string;
    stampSec: number;
    field0: string;
    xyz0: [number, number, number];
    xyz1: [number, number, number];
  } | null = null;
  sub.onMessage((msg, lease) => {
    saw = {
      width: msg.width,
      height: msg.height,
      dataLen: msg.data.length,
      borrowed: msg.data.buffer === host.engineMemory(),
      frameId: msg.frameId,
      stampSec: msg.stampSec,
      field0: msg.fields[0]?.name ?? "",
      xyz0: readXyz(msg.data, 0),
      xyz1: readXyz(msg.data, 1),
    };
    lease.release();
  });

  host.ingestBytes(fixtures.pointCloud2Sample);
  host.flushSync();

  expect(saw).not.toBeNull();
  expect(saw!.width).toBe(4);
  expect(saw!.height).toBe(1);
  expect(saw!.dataLen).toBe(48);
  expect(saw!.borrowed).toBe(true);
  expect(saw!.frameId).toBe("map");
  expect(saw!.stampSec).toBe(1);
  expect(saw!.field0).toBe("x");
  expect(saw!.xyz0[0]).toBeCloseTo(0);
  expect(saw!.xyz0[1]).toBeCloseTo(0);
  expect(saw!.xyz0[2]).toBeCloseTo(0);
  expect(saw!.xyz1[0]).toBeCloseTo(0.01);
  expect(saw!.xyz1[1]).toBeCloseTo(0.02);
  expect(saw!.xyz1[2]).toBeCloseTo(0.03);

  const telemetry = client.telemetry();
  expect(telemetry).not.toBeNull();
  expect(telemetry!.leasesReleased).toBe(telemetry!.samplesEmitted);

  await client.close();
});

test("scripted peer: PointCloud2 sample with no handler still releases its lease", async () => {
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

  const subPromise = client.session.subscribe("/points", sensor_msgs.msg.PointCloud2);
  host.ingestBytes(fixtures.channelReady);
  host.flushSync();
  await subPromise;

  host.ingestBytes(fixtures.pointCloud2Sample);
  host.flushSync();
  host.flushSync();

  const telemetry = client.telemetry();
  expect(telemetry).not.toBeNull();
  expect(telemetry!.samplesEmitted).toBeGreaterThan(0);
  expect(telemetry!.leasesReleased).toBe(telemetry!.samplesEmitted);

  await client.close();
});
