/**
 * Demo server: serves the built `rclweb` bundle and a page that connects to rclwebd.
 * Build first (`just build` or `bun run --filter rcl-web build`), then:
 * `RCLWEB_GATEWAY_URL=ws://127.0.0.1:8794/ws bun run start`
 */
import { serve } from "bun";
import path from "node:path";

const port = Number(process.env.PORT ?? "4173");
const gatewayUrl =
  process.env.RCLWEB_GATEWAY_URL ?? "ws://127.0.0.1:8794/ws";
const root = import.meta.dir;
const sdkWasm = path.resolve(root, "../../typescript/wasm/rclweb.wasm");
const sdkDist = path.resolve(root, "../../typescript/dist");
const sdkIndex = path.join(sdkDist, "index.js");

if (!(await Bun.file(sdkIndex).exists())) {
  console.error(
    "subscribe-chatter needs the rclweb browser bundle at typescript/dist/index.js.\n" +
      "Run `just build` (or `bun run --filter rcl-web build`) first.",
  );
  process.exit(1);
}

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>rclweb · /chatter</title>
  <style>
    :root {
      --ink: #1a1f1c;
      --paper: #e8efe6;
      --accent: #2f6f4e;
      --muted: #5a6b60;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(1200px 600px at 10% -10%, #cfe0d4 0%, transparent 55%),
        linear-gradient(160deg, #f3f7f2, #d9e5dc 60%, #c5d5c8);
    }
    main {
      max-width: 42rem;
      margin: 0 auto;
      padding: 12vh 1.5rem 3rem;
    }
    h1 {
      font-family: "IBM Plex Serif", Georgia, serif;
      font-weight: 600;
      font-size: clamp(2.4rem, 6vw, 3.6rem);
      letter-spacing: -0.03em;
      margin: 0 0 0.4rem;
      animation: rise 700ms ease-out both;
    }
    .lede {
      color: var(--muted);
      font-size: 1.05rem;
      margin: 0 0 2rem;
      animation: rise 700ms ease-out 80ms both;
    }
    button {
      appearance: none;
      border: 0;
      background: var(--accent);
      color: #f7fbf8;
      font: inherit;
      font-weight: 600;
      padding: 0.7rem 1.2rem;
      cursor: pointer;
      animation: rise 700ms ease-out 140ms both;
    }
    button:disabled { opacity: 0.5; cursor: default; }
    #compose {
      display: flex;
      gap: 0.5rem;
      margin-top: 1rem;
      animation: rise 700ms ease-out 160ms both;
    }
    #compose[hidden] { display: none; }
    #out {
      flex: 1;
      font: inherit;
      padding: 0.7rem 0.8rem;
      border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
      background: color-mix(in srgb, white 70%, transparent);
    }
    #status {
      margin-top: 1.25rem;
      font-variant-numeric: tabular-nums;
      color: var(--muted);
      animation: rise 700ms ease-out 200ms both;
    }
    #log {
      margin-top: 1.5rem;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 0.35rem;
    }
    #log li {
      padding: 0.55rem 0.7rem;
      background: color-mix(in srgb, white 55%, transparent);
      border-left: 3px solid var(--accent);
      animation: tick 280ms ease-out both;
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: none; }
    }
    @keyframes tick {
      from { opacity: 0; transform: translateX(-6px); }
      to { opacity: 1; transform: none; }
    }
  </style>
</head>
<body>
  <main>
    <h1>rclweb</h1>
    <p class="lede">Live <code>/chatter</code> through <code>rclweb</code>.</p>
    <button id="go" type="button">Connect</button>
    <form id="compose" hidden>
      <input id="out" type="text" maxlength="200" placeholder="Publish to /chatter" autocomplete="off" />
      <button id="send" type="submit">Send</button>
    </form>
    <p id="status">Idle · gateway <code>${gatewayUrl}</code></p>
    <ul id="log" aria-live="polite"></ul>
  </main>
  <script type="module">
    import { init, Node, std_msgs } from "/sdk/index.js";
    const status = document.getElementById("status");
    const log = document.getElementById("log");
    const go = document.getElementById("go");
    const compose = document.getElementById("compose");
    const out = document.getElementById("out");
    go.addEventListener("click", async () => {
      go.disabled = true;
      status.textContent = "Connecting…";
      try {
        await init(${JSON.stringify(gatewayUrl)});
        const node = new Node("subscribe_chatter");
        const publisher = node.createPublisher(std_msgs.msg.String, "/chatter", 10);
        node.createSubscription(std_msgs.msg.String, "/chatter", 10, (msg) => {
          const li = document.createElement("li");
          li.textContent = msg.data;
          log.prepend(li);
          while (log.children.length > 12) log.lastElementChild?.remove();
          status.textContent = "Receiving samples";
        });
        status.textContent = "Subscribed · waiting for samples";
        compose.hidden = false;
        compose.addEventListener("submit", (ev) => {
          ev.preventDefault();
          const data = out.value.trim();
          if (!data) return;
          out.value = "";
          const message = new std_msgs.msg.String();
          message.data = data;
          publisher.publish(message);
        });
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : String(err);
        go.disabled = false;
      }
    });
  </script>
</body>
</html>`;

serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname.startsWith("/sdk/")) {
      const rel = url.pathname.slice("/sdk/".length);
      const filePath = path.resolve(sdkDist, rel);
      const distRoot = path.resolve(sdkDist);
      if (filePath !== distRoot && !filePath.startsWith(distRoot + path.sep)) {
        return new Response("not found", { status: 404 });
      }
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file, {
          headers: { "content-type": "text/javascript; charset=utf-8" },
        });
      }
    }
    if (url.pathname === "/wasm/rclweb.wasm") {
      return new Response(Bun.file(sdkWasm), {
        headers: { "content-type": "application/wasm" },
      });
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`subscribe-chatter demo on http://127.0.0.1:${port}`);
