/**
 * Load committed scripted-peer byte fixtures for SDK tests.
 * Fixtures are produced by `scripts/fixture-gen` (same encoders as the core).
 */

import { readFileSync } from "node:fs";
import path from "node:path";

type FixtureSet = {
  serverHello: string;
  sessionReady: string;
  channelReady: string;
  serviceChannelReady: string;
  actionChannelReady: string;
  graphSnapshot: string;
  sample: string;
  pointCloud2Sample: string;
  authCorrelationHex: string;
  subCorrelationHex: string;
  serviceCorrelationHex: string;
  actionCorrelationHex: string;
};

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const fixturesPath = path.join(import.meta.dir, "fixtures", "scripted-peer.json");

export function scriptedPeerFixtures() {
  const cached = JSON.parse(readFileSync(fixturesPath, "utf8")) as FixtureSet;
  return {
    serverHello: hexToBytes(cached.serverHello),
    sessionReady: hexToBytes(cached.sessionReady),
    channelReady: hexToBytes(cached.channelReady),
    serviceChannelReady: hexToBytes(cached.serviceChannelReady),
    actionChannelReady: hexToBytes(cached.actionChannelReady),
    graphSnapshot: hexToBytes(cached.graphSnapshot),
    sample: hexToBytes(cached.sample),
    pointCloud2Sample: hexToBytes(cached.pointCloud2Sample),
    authCorrelation: hexToBytes(cached.authCorrelationHex),
    subCorrelation: hexToBytes(cached.subCorrelationHex),
    serviceCorrelation: hexToBytes(cached.serviceCorrelationHex),
    actionCorrelation: hexToBytes(cached.actionCorrelationHex),
  };
}
