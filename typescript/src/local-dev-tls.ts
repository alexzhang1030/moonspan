/** Helpers for ADR 0011 local-dev TLS hash advertisement. */

import type { ServerCertificateHash } from "./types.ts";

/** Decode a base64 SPKI hash (or pass through BufferSource). */
export function decodeCertificateHashValue(
  value: string | BufferSource,
): Uint8Array {
  if (typeof value !== "string") {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  // Prefer atob when available (browsers / bun).
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

type LocalDevTlsJson = {
  active?: boolean;
  hashes?: Array<{ algorithm?: string; value?: string }>;
  spkiSha256?: string;
};

/**
 * Fetch `GET {origin}/local-dev/tls` and return certificate hashes suitable
 * for `WebTransport` `serverCertificateHashes`.
 */
export async function fetchLocalDevTlsHashes(
  origin: string,
): Promise<ServerCertificateHash[]> {
  const base = origin.replace(/\/$/, "");
  const res = await fetch(`${base}/local-dev/tls`);
  if (!res.ok) {
    throw new Error(`/local-dev/tls HTTP ${res.status}`);
  }
  const body = (await res.json()) as LocalDevTlsJson;
  if (body.active === false) {
    throw new Error("local-dev TLS is not active on the gateway");
  }
  const hashes: ServerCertificateHash[] = [];
  if (Array.isArray(body.hashes)) {
    for (const h of body.hashes) {
      if (h?.algorithm === "sha-256" && typeof h.value === "string") {
        hashes.push({ algorithm: "sha-256", value: h.value });
      }
    }
  }
  if (hashes.length === 0 && typeof body.spkiSha256 === "string") {
    hashes.push({ algorithm: "sha-256", value: body.spkiSha256 });
  }
  if (hashes.length === 0) {
    throw new Error("/local-dev/tls response missing hashes");
  }
  return hashes;
}

/** Derive an HTTP origin from a WebTransport `https://` URL. */
export function httpOriginFromWebTransportUrl(wtUrl: string): string {
  const u = new URL(wtUrl);
  // Local-dev advertise endpoint is on the axum HTTP listener, not UDP WT.
  // Callers should prefer ConnectOptions.localDevTlsOrigin when ports differ.
  if (u.protocol === "https:") {
    return `http://${u.hostname}${u.port && u.port !== "443" ? `:${u.port}` : ""}`;
  }
  return `${u.protocol}//${u.host}`;
}
