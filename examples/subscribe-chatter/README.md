# subscribe-chatter

Browser page that connects to `rclwebd` over WebSocket, subscribes to
`/chatter`, and can publish `std_msgs/msg/String` samples. This is the
public-SDK demo ([docs/sdk.md](../../docs/sdk.md)).

## Run

1. Build the SDK browser bundle (also stages wasm):

   ```bash
   just build
   ```

   Or, if the native/wasm tree is already current:

   ```bash
   bun run --filter @rclweb/sdk build
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

   Open http://127.0.0.1:4173, click **Connect**, then send from the
   page or from a ROS talker on `/chatter`.

| Variable | Default | Role |
|---|---|---|
| `PORT` | `4173` | HTTP port for the demo page |
| `RCLWEB_GATEWAY_URL` | `ws://127.0.0.1:8794/ws` | Gateway WebSocket |

The page loads `sdk/typescript/dist/index.js` (Worker path, not
`inline: true`). `just build` must have produced `dist/` first; the
server exits with a short error if that file is missing. The page uses
`init` + `Node` like rclcpp.
