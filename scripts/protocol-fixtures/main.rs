//! Regenerates R2WP v0 protocol fixtures for the v0.1 normative subset (R2-03).
//!
//! Materializes `protocol/testdata` entries from their manifest `source` recipes:
//! - malformed: `hex` / `mutate` (adversarial + validation-order cases)
//! - valid bootstrap: structured sources via `rclweb` encoders
//! - valid `segment_recipe`: materialize in-memory (no on-disk bin)
//!
//! Parked valid frame binaries (schema/media/service, …) stay frozen; `--check`
//! still verifies their committed sha256 so the oracle cannot drift unnoticed.
//!
//! ```bash
//! cargo run -p protocol-fixtures -- --check
//! cargo run -p protocol-fixtures -- --write
//! ```

use rclweb::protocol::bootstrap::{
    BootstrapErrorRecord, BufferCapabilities, ClientHello, EffectiveLimits, RequestedLimits,
    ServerHello, TransportCapabilities,
};
use rclweb::{encode_bootstrap_error, encode_client_hello, encode_server_hello};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("workspace root")
        .to_path_buf()
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn parse_hex(hex: &str) -> Vec<u8> {
    assert!(hex.len().is_multiple_of(2), "hex length must be even: {}", hex.len());
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("hex byte"))
        .collect()
}

fn materialize_hex_source(source: &Value) -> Vec<u8> {
    let hex = source["hex"].as_str().expect("hex source.hex");
    parse_hex(hex)
}

fn materialize_mutate_source(source: &Value) -> Vec<u8> {
    let base = &source["base"];
    assert_eq!(base["$type"], "hex");
    let mut bytes = materialize_hex_source(base);
    let ops = source["ops"].as_array().expect("mutate ops");
    for op in ops {
        match op["op"].as_str().expect("op") {
            "set_u8" => {
                let offset = op["offset"].as_u64().expect("offset") as usize;
                let value = op["value"].as_u64().expect("value") as u8;
                if offset >= bytes.len() {
                    bytes.resize(offset + 1, 0);
                }
                bytes[offset] = value;
            }
            "set_u16be" => {
                let offset = op["offset"].as_u64().expect("offset") as usize;
                let value = op["value"].as_u64().expect("value") as u16;
                if offset + 2 > bytes.len() {
                    bytes.resize(offset + 2, 0);
                }
                bytes[offset..offset + 2].copy_from_slice(&value.to_be_bytes());
            }
            "set_u32be" => {
                let offset = op["offset"].as_u64().expect("offset") as usize;
                let value = op["value"].as_u64().expect("value") as u32;
                if offset + 4 > bytes.len() {
                    bytes.resize(offset + 4, 0);
                }
                bytes[offset..offset + 4].copy_from_slice(&value.to_be_bytes());
            }
            "append_hex" => {
                let hex = op["hex"].as_str().expect("append_hex.hex");
                bytes.extend_from_slice(&parse_hex(hex));
            }
            "truncate" => {
                let len = op["length"].as_u64().expect("truncate.length") as usize;
                bytes.truncate(len);
            }
            other => panic!("unsupported mutate op: {other}"),
        }
    }
    bytes
}

fn bigint_u64(v: &Value) -> u64 {
    if let Some(n) = v.as_u64() {
        return n;
    }
    if v.get("$type").and_then(|t| t.as_str()) == Some("bigint") {
        return v["value"].as_str().expect("bigint.value").parse::<u64>().expect("bigint parse");
    }
    panic!("expected u64 or bigint, got {v}");
}

fn encode_bootstrap_from_source(source: &Value) -> Vec<u8> {
    match source["kind"].as_str().expect("bootstrap kind") {
        "client_hello" => {
            let wire_versions = source["wireVersions"]
                .as_array()
                .expect("wireVersions")
                .iter()
                .map(|v| v.as_u64().expect("wv") as u8)
                .collect();
            let tc = &source["transportCapabilities"];
            let bc = &source["bufferCapabilities"];
            let rl = &source["requestedLimits"];
            let caps = source["extensionCapabilities"]
                .as_array()
                .expect("extensionCapabilities")
                .iter()
                .map(|v| v.as_u64().expect("cap") as u16)
                .collect();
            let hello = ClientHello {
                wire_versions,
                transport_capabilities: TransportCapabilities {
                    webtransport_http3: tc["webtransportHttp3"].as_bool().unwrap(),
                    binary_wss: tc["binaryWss"].as_bool().unwrap(),
                    max_datagram_size: tc
                        .get("maxDatagramSize")
                        .and_then(|v| v.as_u64())
                        .map(|n| n as u32),
                },
                buffer_capabilities: BufferCapabilities {
                    transferable_arraybuffer: bc["transferableArraybuffer"].as_bool().unwrap(),
                    shared_arraybuffer: bc["sharedArraybuffer"].as_bool().unwrap(),
                },
                requested_limits: RequestedLimits {
                    max_channels: rl.get("maxChannels").and_then(|v| v.as_u64()).map(|n| n as u32),
                    max_session_bytes: rl.get("maxSessionBytes").map(bigint_u64),
                    max_message_bytes: rl
                        .get("maxMessageBytes")
                        .and_then(|v| v.as_u64())
                        .map(|n| n as u32),
                    max_control_payload_bytes: rl
                        .get("maxControlPayloadBytes")
                        .and_then(|v| v.as_u64())
                        .map(|n| n as u32),
                },
                extension_capabilities: caps,
            };
            encode_client_hello(&hello).expect("encode client hello")
        }
        "server_hello" => {
            let tc = &source["transportCapabilities"];
            let bc = &source["bufferCapabilities"];
            let el = &source["effectiveLimits"];
            let caps = source["extensionCapabilities"]
                .as_array()
                .expect("extensionCapabilities")
                .iter()
                .map(|v| v.as_u64().expect("cap") as u16)
                .collect();
            let hello = ServerHello {
                selected_wire_version: source["selectedWireVersion"].as_u64().unwrap() as u8,
                transport_capabilities: TransportCapabilities {
                    webtransport_http3: tc["webtransportHttp3"].as_bool().unwrap(),
                    binary_wss: tc["binaryWss"].as_bool().unwrap(),
                    max_datagram_size: tc
                        .get("maxDatagramSize")
                        .and_then(|v| v.as_u64())
                        .map(|n| n as u32),
                },
                buffer_capabilities: BufferCapabilities {
                    transferable_arraybuffer: bc["transferableArraybuffer"].as_bool().unwrap(),
                    shared_arraybuffer: bc["sharedArraybuffer"].as_bool().unwrap(),
                },
                effective_limits: EffectiveLimits {
                    max_channels: el["maxChannels"].as_u64().unwrap() as u32,
                    max_session_bytes: bigint_u64(&el["maxSessionBytes"]),
                    max_message_bytes: el["maxMessageBytes"].as_u64().unwrap() as u32,
                    max_control_payload_bytes: el["maxControlPayloadBytes"].as_u64().unwrap()
                        as u32,
                },
                extension_capabilities: caps,
            };
            encode_server_hello(&hello).expect("encode server hello")
        }
        "bootstrap_error" => {
            let message = source["message"].as_str().map(|s| s.to_owned());
            let detail = source["detail"].as_str().map(|s| s.to_owned());
            // Manifest may use recipe-style max text; fall back to repeated chars.
            let message = message.or_else(|| {
                source.get("messageRecipe").map(|r| {
                    let ch = r["char"].as_str().unwrap_or("a").chars().next().unwrap_or('a');
                    let len = r["length"].as_u64().unwrap_or(4096) as usize;
                    std::iter::repeat_n(ch, len).collect()
                })
            });
            let detail = detail.or_else(|| {
                source.get("detailRecipe").map(|r| {
                    let ch = r["char"].as_str().unwrap_or("b").chars().next().unwrap_or('b');
                    let len = r["length"].as_u64().unwrap_or(4096) as usize;
                    std::iter::repeat_n(ch, len).collect()
                })
            });
            let record = BootstrapErrorRecord {
                code: source["code"].as_u64().unwrap() as u8,
                message,
                detail,
            };
            encode_bootstrap_error(&record).expect("encode bootstrap error")
        }
        other => panic!("unsupported bootstrap kind: {other}"),
    }
}

fn materialize_source(source: &Value) -> Option<Vec<u8>> {
    match source.get("$type").and_then(|t| t.as_str()) {
        Some("hex") => Some(materialize_hex_source(source)),
        Some("mutate") => Some(materialize_mutate_source(source)),
        Some("bootstrap") => Some(encode_bootstrap_from_source(source)),
        Some("frame") => None, // binary frames: frozen parked + v0.1 checked by sha; recipe handled separately
        other => panic!("unsupported source $type: {other:?}"),
    }
}

/// Coverage tags that mark a fixture as part of the v0.1 normative regenerate set.
fn is_v0_1_coverage(coverage: &[Value]) -> bool {
    const TAGS: &[&str] = &[
        "client_hello",
        "server_hello",
        "bootstrap_error",
        "ros_sample",
        "session_ready",
        "authenticate",
        "open_channel",
        "channel_ready",
        "close_channel",
        "heartbeat",
        "error",
        "bootstrap_step_1",
        "bootstrap_step_2",
        "bootstrap_step_3",
        "bootstrap_step_4",
        "bootstrap_step_5",
        "bootstrap_step_6",
        "bootstrap_step_7",
        "bootstrap_step_8",
        "bootstrap_step_9",
        "frame_step_1",
        "frame_step_2",
        "frame_step_3",
        "frame_step_4",
        "frame_step_5",
        "frame_step_6",
        "frame_step_7",
        "frame_step_8",
        "frame_step_9",
        "frame_step_10",
        "frame_step_11",
        "frame_step_12",
        "frame_step_13",
        "frame_step_14",
        "frame_step_15",
        "frame_step_16",
        "multi_invalid",
        "bootstrap_precedence",
        "truncated",
        "bad_magic",
    ];
    coverage
        .iter()
        .any(|c| c.as_str().is_some_and(|s| TAGS.iter().any(|t| s == *t || s.starts_with(t))))
}

struct Stats {
    regenerated: usize,
    checked_frozen: usize,
    v0_1: usize,
}

fn process_manifest(
    root: &Path,
    manifest_rel: &str,
    write: bool,
    generated_by: &str,
) -> Result<Stats, String> {
    let manifest_path = root.join(manifest_rel);
    let text = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("read {}: {e}", manifest_path.display()))?;
    let mut manifest: Value = serde_json::from_str(&text)
        .map_err(|e| format!("parse {}: {e}", manifest_path.display()))?;
    let fixtures = manifest["fixtures"]
        .as_array_mut()
        .ok_or_else(|| format!("{manifest_rel}: fixtures array"))?;

    let mut stats = Stats { regenerated: 0, checked_frozen: 0, v0_1: 0 };
    let mut bins_changed = false;

    for entry in fixtures.iter_mut() {
        let id = entry["id"].as_str().unwrap_or("?").to_owned();
        let coverage: Vec<Value> =
            entry.get("coverage").and_then(|c| c.as_array()).cloned().unwrap_or_default();
        if is_v0_1_coverage(&coverage) {
            stats.v0_1 += 1;
        }

        let representation = entry["representation"].as_str().unwrap_or("binary");
        if representation == "segment_recipe" {
            // In-memory only; sha is of the materialization contract tested in rclweb.
            stats.checked_frozen += 1;
            continue;
        }

        let source = entry.get("source").ok_or_else(|| format!("{id}: missing source"))?;
        let path = entry["path"].as_str().ok_or_else(|| format!("{id}: missing path"))?;
        let abs = root.join("protocol/testdata").join(path);

        if let Some(bytes) = materialize_source(source) {
            let digest = sha256_hex(&bytes);
            let len = bytes.len() as u64;
            if write {
                let previous = fs::read(&abs).ok();
                if previous.as_deref() != Some(bytes.as_slice()) {
                    bins_changed = true;
                    if let Some(parent) = abs.parent() {
                        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    fs::write(&abs, &bytes).map_err(|e| format!("write {}: {e}", abs.display()))?;
                }
                if entry["sha256"].as_str() != Some(digest.as_str())
                    || entry["byte_length"].as_u64() != Some(len)
                {
                    bins_changed = true;
                    entry["sha256"] = json!(digest);
                    entry["byte_length"] = json!(len);
                }
            } else {
                let on_disk = fs::read(&abs).map_err(|e| format!("read {}: {e}", abs.display()))?;
                let expected_sha = entry["sha256"].as_str().unwrap_or("");
                let expected_len = entry["byte_length"].as_u64().unwrap_or(0);
                if on_disk != bytes {
                    return Err(format!(
                        "{id}: materialized bytes differ from on-disk bin (regen with --write)"
                    ));
                }
                if sha256_hex(&on_disk) != expected_sha {
                    return Err(format!("{id}: sha256 mismatch"));
                }
                if on_disk.len() as u64 != expected_len {
                    return Err(format!("{id}: byte_length mismatch"));
                }
                if digest != expected_sha {
                    return Err(format!("{id}: materialized sha256 != manifest"));
                }
            }
            stats.regenerated += 1;
        } else {
            // Frozen binary (parked frame shapes): integrity check only.
            let on_disk = fs::read(&abs).map_err(|e| format!("read {}: {e}", abs.display()))?;
            let expected_sha = entry["sha256"].as_str().unwrap_or("");
            let expected_len = entry["byte_length"].as_u64().unwrap_or(0);
            if sha256_hex(&on_disk) != expected_sha {
                return Err(format!("{id}: frozen sha256 mismatch"));
            }
            if on_disk.len() as u64 != expected_len {
                return Err(format!("{id}: frozen byte_length mismatch"));
            }
            stats.checked_frozen += 1;
        }
    }

    if write {
        if bins_changed {
            manifest["generated_by"] = json!(generated_by);
            let out = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())? + "\n";
            fs::write(&manifest_path, out).map_err(|e| e.to_string())?;
        } else {
            let original = fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
            if let Some(updated) = patch_generated_by(&original, generated_by) {
                fs::write(&manifest_path, updated).map_err(|e| e.to_string())?;
            } else {
                return Err(format!(
                    "{}: could not patch generated_by in place",
                    manifest_path.display()
                ));
            }
        }
    }

    Ok(stats)
}

fn patch_generated_by(text: &str, generated_by: &str) -> Option<String> {
    const KEY: &str = "\"generated_by\"";
    let idx = text.find(KEY)?;
    let after = &text[idx + KEY.len()..];
    let colon = after.find(':')?;
    let rest = &after[colon + 1..];
    let start_quote = rest.find('"')?;
    let value_start = start_quote + 1;
    let value_end = rest[value_start..].find('"')? + value_start;
    let abs_start = idx + KEY.len() + colon + 1 + value_start;
    let abs_end = idx + KEY.len() + colon + 1 + value_end;
    let mut out = String::with_capacity(text.len() + 32);
    out.push_str(&text[..abs_start]);
    out.push_str(generated_by);
    out.push_str(&text[abs_end..]);
    Some(out)
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    let write = args.iter().any(|a| a == "--write");
    let check = args.iter().any(|a| a == "--check") || !write;
    if args.iter().any(|a| a == "--help" || a == "-h") {
        eprintln!(
            "usage: protocol-fixtures [--check|--write]\n  --check  verify bins match sources (default)\n  --write  regenerate materializable bins + update manifests"
        );
        return ExitCode::SUCCESS;
    }
    let _ = check;
    let root = repo_root();
    let generated_by = "scripts/protocol-fixtures (R2-03)";

    let malformed = match process_manifest(
        &root,
        "protocol/testdata/malformed/manifest.json",
        write,
        generated_by,
    ) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("malformed: {e}");
            return ExitCode::FAILURE;
        }
    };
    let valid =
        match process_manifest(&root, "protocol/testdata/manifest.json", write, generated_by) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("valid: {e}");
                return ExitCode::FAILURE;
            }
        };

    println!(
        "protocol-fixtures: mode={} malformed_regen={} valid_regen={} frozen_checked={} v0_1_tagged={}",
        if write { "write" } else { "check" },
        malformed.regenerated,
        valid.regenerated,
        malformed.checked_frozen + valid.checked_frozen,
        malformed.v0_1 + valid.v0_1,
    );
    ExitCode::SUCCESS
}
