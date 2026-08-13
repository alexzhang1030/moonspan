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
  primitiveScalarsSample: string;
  nestedSample: string;
  echoNestedRequestCdr: string;
  echoNestedResponseCdr: string;
  measureSequenceGoalCdr: string;
  measureSequenceResultCdr: string;
  measureSequenceFeedbackCdr: string;
  authCorrelationHex: string;
  subCorrelationHex: string;
  serviceCorrelationHex: string;
  actionCorrelationHex: string;
};

const FRAME_HEADER_LENGTH = 32;

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
    primitiveScalarsSample: hexToBytes(cached.primitiveScalarsSample),
    nestedSample: hexToBytes(cached.nestedSample),
    echoNestedRequestCdr: hexToBytes(cached.echoNestedRequestCdr),
    echoNestedResponseCdr: hexToBytes(cached.echoNestedResponseCdr),
    measureSequenceGoalCdr: hexToBytes(cached.measureSequenceGoalCdr),
    measureSequenceResultCdr: hexToBytes(cached.measureSequenceResultCdr),
    measureSequenceFeedbackCdr: hexToBytes(cached.measureSequenceFeedbackCdr),
    authCorrelation: hexToBytes(cached.authCorrelationHex),
    subCorrelation: hexToBytes(cached.subCorrelationHex),
    serviceCorrelation: hexToBytes(cached.serviceCorrelationHex),
    actionCorrelation: hexToBytes(cached.actionCorrelationHex),
  };
}

/** Keep header + OPERATION_ID extension; replace the application payload. Test-only. */
export function replaceFramePayload(
  frame: Uint8Array,
  payload: Uint8Array,
): Uint8Array {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const extLen = view.getUint16(28, false);
  const prefixLen = FRAME_HEADER_LENGTH + extLen;
  const out = new Uint8Array(prefixLen + payload.length);
  out.set(frame.subarray(0, prefixLen));
  new DataView(out.buffer).setUint32(24, payload.length, false);
  out.set(payload, prefixLen);
  return out;
}
