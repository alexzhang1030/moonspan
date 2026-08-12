#!/usr/bin/env bash
# Re-run H-FT mock protocol gates and refresh evidence stamp.
set -euo pipefail
cd /workspace

EVIDENCE_DIR="${RCLWEB_EVIDENCE_DIR:-/workspace/docs/evidence}"
mkdir -p "${EVIDENCE_DIR}"

echo "r3-03-h-ft: running mock protocol gates"
cargo test --locked -p rclweb --lib h_ft_session_ready
cargo test --locked -p rclwebd --test ws_gateway h_ft
cargo test --locked -p rclweb --test generated_types_registry

# Stamp pass into evidence JSON (commands already recorded in committed file).
python3 - <<'PY'
import json, os
from datetime import datetime, timezone
path = os.path.join(os.environ.get("RCLWEB_EVIDENCE_DIR", "/workspace/docs/evidence"), "r3-03-h-ft-row.json")
with open(path) as f:
    data = json.load(f)
data["recordedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
data["results"] = {
    "engine_h_ft_moonspan_open_channel": "pass",
    "ws_gateway_h_ft_session_ready_and_moonspan_subscribe": "pass",
    "ws_gateway_h_ft_rejects_wrong_row_open_channel": "pass",
    "generated_types_registry": "pass",
}
with open(path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
print(f"r3-03-h-ft: evidence → {path}")
PY

echo "r3-03-h-ft: complete"
