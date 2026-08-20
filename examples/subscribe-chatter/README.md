# subscribe-chatter

Browser page that connects to `rclwebd`, subscribes to `/chatter`, and
can publish `std_msgs/msg/String` samples. This is the public `rcl-web`
demo ([how to](../../docs/typescript.md), [API](../../docs/api.md)).
`init` uses WebTransport (QUIC) from `http://127.0.0.1` — no
certificate to install. The demo binds loopback only.

## Run

1. Build the `rcl-web` browser bundle (also stages wasm):

   ```bash
   just build
   ```

   Or, if the native/wasm tree is already current:

   ```bash
   bun run --filter rcl-web build
   ```

2. Start a gateway that can attach to ROS (or the mock-free live image):

   ```bash
   # example: packaged J-FT gateway on the host network
   just gateway
   ```

3. Serve the page:

   ```bash
   bun run --filter @rclweb/subscribe-chatter start
   ```

   Open http://127.0.0.1:4173, type the robot host (or leave
   `127.0.0.1`), click **Connect**, then send from the page or from a
   ROS talker on `/chatter`.

   Intranet WebTransport: `just gateway-wt` on the robot, keep this page
   on `http://127.0.0.1:4173`, type the robot IP. Chromium. That is the
   QUIC path. A tab opened via a LAN IP cannot use WebTransport.

| Variable | Default | Role |
|---|---|---|
| `PORT` | `4173` | HTTP port for the demo page |
| `RCLWEB_GATEWAY_URL` | `127.0.0.1` | Prefills the host field (`192.168.1.10` is enough) |

The page loads `typescript/dist/index.js` (Worker path, not
`inline: true`). `just build` must have produced `dist/` first; the
server exits with a short error if that file is missing. The page uses
`init` + `Node` like rclcpp.
