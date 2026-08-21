/**
 * WebTransport / local-dev TLS SDK surface (R3-03).
 * Bun has no WebTransport; the connect path must stay on websocket by default.
 */

import { describe, expect, test } from "bun:test";
import {
  decodeCertificateHashValue,
  httpOriginFromWebTransportUrl,
} from "../src/local-dev-tls.ts";

describe("local-dev TLS helpers", () => {
  test("decodeCertificateHashValue accepts base64", () => {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) bytes[i] = i;
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    const b64 = btoa(binary);
    const decoded = decodeCertificateHashValue(b64);
    expect([...decoded]).toEqual([...bytes]);
  });

  test("httpOriginFromWebTransportUrl maps default WT 4433 to HTTP 8794", () => {
    expect(httpOriginFromWebTransportUrl("https://127.0.0.1:4433/r2wp")).toBe(
      "http://127.0.0.1:8794",
    );
    expect(httpOriginFromWebTransportUrl("https://192.168.1.10:4433/")).toBe(
      "http://192.168.1.10:8794",
    );
  });

  test("httpOriginFromWebTransportUrl keeps a custom WT port", () => {
    expect(httpOriginFromWebTransportUrl("https://127.0.0.1:9443/r2wp")).toBe(
      "http://127.0.0.1:9443",
    );
    expect(httpOriginFromWebTransportUrl("https://example.com/")).toBe(
      "http://example.com",
    );
  });

  test("WebTransport constructor path is skipped without globalThis.WebTransport", () => {
    const WT = (globalThis as { WebTransport?: unknown }).WebTransport;
    expect(WT).toBeUndefined();
  });
});
