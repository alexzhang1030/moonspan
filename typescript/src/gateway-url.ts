/**
 * Pick a gateway URL and transport without asking the operator for a CA.
 *
 * Chromium + `http://127.0.0.1` can use WebTransport (hash-pinned local-dev
 * cert). A page opened via a LAN IP is not a secure context, so the same
 * `init("192.168.1.10")` falls back to WebSocket. Do not serve the page over
 * a self-signed HTTPS URL — that interstitial is more trouble than this path.
 */

import {
  DEFAULT_HTTP_PORT,
  DEFAULT_WEBTRANSPORT_PORT,
} from "./local-dev-tls.ts";
import type { ConnectOptions } from "./types.ts";

export type GatewayTransport = "websocket" | "webtransport";

export type GatewayRuntime = {
  webTransport: boolean;
  secureContext: boolean;
};

export type ResolvedGatewayConnect = {
  url: string;
  transport: GatewayTransport;
  /** Set when WebTransport was requested or implied but WebSocket is used. */
  note?: string;
};

const FALLBACK_NOTE =
  "WebTransport needs Chromium and a secure context (open this page at http://127.0.0.1). Using WebSocket; no certificate to install.";

/** `isSecureContext === false` is a LAN-IP page. Unset (bun) is not insecure. */
export function detectGatewayRuntime(
  global: typeof globalThis = globalThis,
): GatewayRuntime {
  return {
    webTransport:
      typeof (global as { WebTransport?: unknown }).WebTransport === "function",
    secureContext: global.isSecureContext !== false,
  };
}

function parseGatewayInput(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("gateway URL is empty");
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return new URL(trimmed);
  }
  if (
    !trimmed.startsWith("[") &&
    trimmed.includes(":") &&
    trimmed.split(":").length > 2
  ) {
    return new URL(`http://[${trimmed}]`);
  }
  return new URL(`http://${trimmed}`);
}

function wsPath(u: URL): string {
  if (!u.pathname || u.pathname === "/") return "/ws";
  return `${u.pathname}${u.search}`;
}

function asWebSocketUrl(u: URL): string {
  if (u.protocol === "ws:" || u.protocol === "wss:") {
    return u.href;
  }
  if (u.protocol === "https:") {
    const port = u.port || "443";
    if (port === DEFAULT_WEBTRANSPORT_PORT) {
      return `ws://${u.hostname}:${DEFAULT_HTTP_PORT}/ws`;
    }
    const host = port === "443" ? u.hostname : `${u.hostname}:${u.port}`;
    return `wss://${host}${wsPath(u)}`;
  }
  const port = u.port || DEFAULT_HTTP_PORT;
  return `ws://${u.hostname}:${port}${wsPath(u)}`;
}

function asWebTransportUrl(u: URL): string {
  if (u.protocol === "https:") {
    const path = !u.pathname || u.pathname === "/" ? "/" : u.pathname;
    return `https://${u.host}${path}`;
  }
  return `https://${u.hostname}:${DEFAULT_WEBTRANSPORT_PORT}/`;
}

function defaultHttpOrWtPort(port: string): boolean {
  return (
    port === "" ||
    port === DEFAULT_HTTP_PORT ||
    port === DEFAULT_WEBTRANSPORT_PORT ||
    port === "80"
  );
}

/** Intranet-shaped hint: bare host, HTTP/WS on 8794, or HTTPS on 4433. */
function impliesIntranetWebTransport(u: URL): boolean {
  if (u.protocol === "wss:") return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "ws:" || u.protocol === "http:") {
    return defaultHttpOrWtPort(u.port);
  }
  return false;
}

function canUseWebTransport(runtime: GatewayRuntime): boolean {
  return runtime.webTransport && runtime.secureContext;
}

/**
 * Resolve `init` / `connect` input to a concrete URL and transport.
 *
 * Pass `runtime` in tests. Applications leave it unset.
 */
export function resolveGatewayConnect(
  input: string,
  options: Pick<ConnectOptions, "transport"> = {},
  runtime: GatewayRuntime = detectGatewayRuntime(),
): ResolvedGatewayConnect {
  const parsed = parseGatewayInput(input);
  const canWt = canUseWebTransport(runtime);
  const explicit = options.transport;

  if (explicit === "websocket") {
    return { url: asWebSocketUrl(parsed), transport: "websocket" };
  }

  if (explicit === "webtransport") {
    if (canWt) {
      return { url: asWebTransportUrl(parsed), transport: "webtransport" };
    }
    return {
      url: asWebSocketUrl(parsed),
      transport: "websocket",
      note: FALLBACK_NOTE,
    };
  }

  if (canWt && impliesIntranetWebTransport(parsed)) {
    return { url: asWebTransportUrl(parsed), transport: "webtransport" };
  }

  const url = asWebSocketUrl(parsed);
  if (!canWt && impliesIntranetWebTransport(parsed)) {
    return { url, transport: "websocket", note: FALLBACK_NOTE };
  }
  return { url, transport: "websocket" };
}
