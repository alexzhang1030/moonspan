/**
 * rclcpp-shaped context: `init` / `ok` / `spin` / `shutdown`.
 *
 * The one extra argument versus `rclcpp::init(argc, argv)` is the gateway URL.
 * Wasm, Worker, and leases stay inside this module.
 */

import { connect, type RclwebClient } from "./client.ts";
import type { ConnectOptions } from "./types.ts";

export type InitOptions = ConnectOptions;

type Context = {
  client: RclwebClient;
  shutdownPromise: Promise<void>;
  resolveShutdown: () => void;
};

let context: Context | null = null;

export async function init(url: string, options: InitOptions = {}): Promise<void> {
  if (context) {
    throw new Error("rclweb.init() already called; call shutdown() first");
  }
  const client = await connect(url, options);
  let resolveShutdown = (): void => {};
  const shutdownPromise = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });
  context = { client, shutdownPromise, resolveShutdown };
}

export function ok(): boolean {
  return context !== null;
}

export async function shutdown(): Promise<void> {
  const current = context;
  if (!current) return;
  context = null;
  await current.client.close();
  current.resolveShutdown();
}

/**
 * Wait until `shutdown()`. The browser event loop already delivers callbacks;
 * this matches `rclcpp::spin` as the "run until we stop" call.
 */
export async function spin(_node?: unknown): Promise<void> {
  if (!context) {
    throw new Error("rclweb.spin() requires init()");
  }
  await context.shutdownPromise;
}

export function requireClient(): RclwebClient {
  if (!context) {
    throw new Error("Node requires rclweb.init(url) first");
  }
  return context.client;
}
