//! Audit sink: stderr JSON lines plus an optional hash-chained file.
//!
//! Default is **stderr** — the same `rclwebd audit {json}` lines Authenticate
//! and OpenChannel already emit. `RCLWEBD_AUDIT_SINK=file` also appends each
//! line to `RCLWEBD_AUDIT_PATH` as JSONL. The file is the integrity / export
//! artifact; `/configz` reports sink health, never event bodies.
//!
//! Integrity: each record is a compact JSON object with keys sorted
//! alphabetically. `sha256` is hex(`SHA-256(prev_sha256 || LF || canonical)`)
//! where `canonical` is that object **without** the `sha256` field and
//! `prev_sha256` is the previous record's `sha256` (64 zero hex digits for
//! the first record of a new file that does not continue a rotation).
//! A truncated or edited line fails [`verify_file`].
//!
//! Retention: when the live file would exceed `RCLWEBD_AUDIT_MAX_BYTES`,
//! it is renamed to `<name>.1` and older rotations shift up; `<name>.N`
//! beyond `RCLWEBD_AUDIT_RETAIN` is dropped. The new live file continues
//! the hash chain (`prev_sha256` of its first record is the last hash of
//! `.1`) so [`export_chain`] can concatenate rotations into one verifiable
//! JSONL.
//!
//! A write failure does not change the Authenticate / OpenChannel decision.
//! It increments `audit_write_errors` and leaves `/configz` integrity
//! `error`. Mid-line crash on restart: `fail` (default) refuses start;
//! `rotate` moves the live file aside as `<name>.corrupt.<unix>` and
//! starts a new chain.

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

/// Genesis `prev_sha256` (64 zero hex digits).
pub const GENESIS_PREV: &str = "0000000000000000000000000000000000000000000000000000000000000000";

/// Default live-file size that triggers rotation (8 MiB).
pub const DEFAULT_MAX_BYTES: u64 = 8 * 1024 * 1024;

/// Default number of rotated copies (`<name>.1` .. `<name>.N`).
pub const DEFAULT_RETAIN: u32 = 3;

const INTEGRITY_NA: u8 = 0;
const INTEGRITY_OK: u8 = 1;
const INTEGRITY_ERROR: u8 = 2;

/// Where audit lines are persisted beyond stderr.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AuditMode {
  /// Stderr only (R1–R4 default).
  #[default]
  Stderr,
  /// Stderr plus a hash-chained JSONL file.
  File,
}

impl AuditMode {
  #[must_use]
  pub fn parse(raw: &str) -> Option<Self> {
    match raw.trim().to_ascii_lowercase().as_str() {
      "" | "stderr" => Some(Self::Stderr),
      "file" => Some(Self::File),
      _ => None,
    }
  }

  #[must_use]
  pub fn as_str(self) -> &'static str {
    match self {
      Self::Stderr => "stderr",
      Self::File => "file",
    }
  }
}

/// Start-up behavior when the live file exists but fails [`verify_file`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum OnCorrupt {
  /// Refuse process start (default; same force as a bad ACL document).
  #[default]
  Fail,
  /// Move the live file aside and start a new chain.
  Rotate,
}

impl OnCorrupt {
  #[must_use]
  pub fn parse(raw: &str) -> Option<Self> {
    match raw.trim().to_ascii_lowercase().as_str() {
      "" | "fail" => Some(Self::Fail),
      "rotate" => Some(Self::Rotate),
      _ => None,
    }
  }

  #[must_use]
  pub fn as_str(self) -> &'static str {
    match self {
      Self::Fail => "fail",
      Self::Rotate => "rotate",
    }
  }
}

/// File-chain health for `/configz` / `/metrics`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuditIntegrity {
  /// Stderr-only: there is no file to verify.
  NotApplicable,
  Ok,
  Error,
}

impl AuditIntegrity {
  #[must_use]
  pub fn as_str(self) -> &'static str {
    match self {
      Self::NotApplicable => "n/a",
      Self::Ok => "ok",
      Self::Error => "error",
    }
  }

  fn from_code(code: u8) -> Self {
    match code {
      INTEGRITY_OK => Self::Ok,
      INTEGRITY_ERROR => Self::Error,
      _ => Self::NotApplicable,
    }
  }
}

/// Point-in-time sink counters. Event bodies are never included.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuditSnapshot {
  pub mode: AuditMode,
  pub path: Option<PathBuf>,
  pub max_bytes: u64,
  pub retain: u32,
  pub on_corrupt: OnCorrupt,
  pub events: u64,
  pub write_errors: u64,
  pub last_seq: u64,
  pub last_sha256: String,
  pub bytes: u64,
  pub integrity: AuditIntegrity,
}

/// One gateway process's audit sink.
#[derive(Debug, Clone)]
pub struct AuditSink {
  inner: Arc<Inner>,
}

#[derive(Debug)]
struct Inner {
  mode: AuditMode,
  path: Option<PathBuf>,
  max_bytes: u64,
  retain: u32,
  on_corrupt: OnCorrupt,
  file: Mutex<Option<FileState>>,
  stderr_chain: Mutex<Chain>,
  events: AtomicU64,
  write_errors: AtomicU64,
  integrity: AtomicU8,
}

#[derive(Debug)]
struct Chain {
  seq: u64,
  prev_hex: String,
}

#[derive(Debug)]
struct FileState {
  file: Option<File>,
  bytes: u64,
  chain: Chain,
}

impl Default for AuditSink {
  fn default() -> Self {
    Self::stderr()
  }
}

impl AuditSink {
  /// Stderr-only sink (default).
  #[must_use]
  pub fn stderr() -> Self {
    Self {
      inner: Arc::new(Inner {
        mode: AuditMode::Stderr,
        path: None,
        max_bytes: DEFAULT_MAX_BYTES,
        retain: DEFAULT_RETAIN,
        on_corrupt: OnCorrupt::Fail,
        file: Mutex::new(None),
        stderr_chain: Mutex::new(Chain { seq: 0, prev_hex: GENESIS_PREV.to_owned() }),
        events: AtomicU64::new(0),
        write_errors: AtomicU64::new(0),
        integrity: AtomicU8::new(INTEGRITY_NA),
      }),
    }
  }

  /// Open or continue a hash-chained file. Fails start-up on I/O or, when
  /// [`OnCorrupt::Fail`], a live file that does not verify.
  pub fn file(
    path: impl Into<PathBuf>,
    max_bytes: u64,
    retain: u32,
    on_corrupt: OnCorrupt,
  ) -> Result<Self, String> {
    if max_bytes == 0 {
      return Err("RCLWEBD_AUDIT_MAX_BYTES must be at least 1".to_owned());
    }
    if !(1..=64).contains(&retain) {
      return Err("RCLWEBD_AUDIT_RETAIN must be an integer from 1 to 64".to_owned());
    }
    let path = path.into();
    if path.as_os_str().is_empty() {
      return Err("RCLWEBD_AUDIT_PATH must not be empty".to_owned());
    }
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
      fs::create_dir_all(parent)
        .map_err(|err| format!("create audit directory {}: {err}", parent.display()))?;
    }

    let mut rotated_corrupt = false;
    let mut chain = Chain { seq: 0, prev_hex: GENESIS_PREV.to_owned() };
    if path.is_file() {
      let meta = fs::metadata(&path)
        .map_err(|err| format!("stat RCLWEBD_AUDIT_PATH={}: {err}", path.display()))?;
      if meta.len() > 0 {
        match verify_file(&path) {
          Ok(verified) => {
            chain.seq = verified.last_seq;
            chain.prev_hex = verified.last_sha256;
          }
          Err(err) => match on_corrupt {
            OnCorrupt::Fail => {
              return Err(format!("RCLWEBD_AUDIT_PATH={} failed integrity: {err}", path.display()));
            }
            OnCorrupt::Rotate => {
              let aside = corrupt_aside_path(&path);
              fs::rename(&path, &aside).map_err(|rename_err| {
                format!(
                  "move corrupt audit {} to {}: {rename_err}",
                  path.display(),
                  aside.display()
                )
              })?;
              rotated_corrupt = true;
            }
          },
        }
      }
    }

    let state = open_live(&path, chain)?;
    let sink = Self {
      inner: Arc::new(Inner {
        mode: AuditMode::File,
        path: Some(path),
        max_bytes,
        retain,
        on_corrupt,
        file: Mutex::new(Some(state)),
        stderr_chain: Mutex::new(Chain { seq: 0, prev_hex: GENESIS_PREV.to_owned() }),
        events: AtomicU64::new(0),
        write_errors: AtomicU64::new(0),
        integrity: AtomicU8::new(INTEGRITY_OK),
      }),
    };
    if rotated_corrupt {
      sink.emit(json!({
          "event": "audit_sink",
          "decision": "rotate",
          "reason": "integrity_fail",
      }));
    }
    Ok(sink)
  }

  /// `RCLWEBD_AUDIT_SINK` / `_PATH` / `_MAX_BYTES` / `_RETAIN` / `_ON_CORRUPT`.
  pub fn from_env() -> Result<Self, String> {
    let mode = match std::env::var("RCLWEBD_AUDIT_SINK") {
      Ok(raw) => AuditMode::parse(&raw).ok_or_else(|| {
        format!("unsupported RCLWEBD_AUDIT_SINK={raw:?}; expected stderr or file")
      })?,
      Err(_) => AuditMode::Stderr,
    };
    match mode {
      AuditMode::Stderr => Ok(Self::stderr()),
      AuditMode::File => {
        let path = std::env::var("RCLWEBD_AUDIT_PATH")
          .map_err(|_| "RCLWEBD_AUDIT_SINK=file requires RCLWEBD_AUDIT_PATH".to_owned())?;
        let max_bytes = parse_u64_env("RCLWEBD_AUDIT_MAX_BYTES", DEFAULT_MAX_BYTES)?;
        let retain = parse_u32_env("RCLWEBD_AUDIT_RETAIN", DEFAULT_RETAIN)?;
        let on_corrupt = match std::env::var("RCLWEBD_AUDIT_ON_CORRUPT") {
          Ok(raw) => OnCorrupt::parse(&raw).ok_or_else(|| {
            format!("unsupported RCLWEBD_AUDIT_ON_CORRUPT={raw:?}; expected fail or rotate")
          })?,
          Err(_) => OnCorrupt::Fail,
        };
        Self::file(path, max_bytes, retain, on_corrupt)
      }
    }
  }

  /// Emit one event to stderr and, when configured, the file.
  pub fn emit(&self, event: Value) {
    let line = match self.inner.mode {
      AuditMode::Stderr => {
        let mut chain = lock(&self.inner.stderr_chain);
        next_line(&mut chain, event)
      }
      AuditMode::File => {
        let mut guard = lock(&self.inner.file);
        let Some(state) = guard.as_mut() else {
          self.inner.write_errors.fetch_add(1, Ordering::Relaxed);
          self.inner.integrity.store(INTEGRITY_ERROR, Ordering::Relaxed);
          let mut chain = lock(&self.inner.stderr_chain);
          return eprint_line(&next_line(&mut chain, event));
        };
        if state.bytes >= self.inner.max_bytes
          && let Err(err) = rotate_live(state, self.inner.path.as_deref(), self.inner.retain)
        {
          self.inner.write_errors.fetch_add(1, Ordering::Relaxed);
          self.inner.integrity.store(INTEGRITY_ERROR, Ordering::Relaxed);
          eprintln!("rclwebd audit-sink-error {err}");
        }
        let line = next_line(&mut state.chain, event);
        if let Err(err) = append_line(state, &line) {
          self.inner.write_errors.fetch_add(1, Ordering::Relaxed);
          self.inner.integrity.store(INTEGRITY_ERROR, Ordering::Relaxed);
          eprintln!("rclwebd audit-sink-error {err}");
          // Do not advance the on-disk chain: `next_line` already did.
          // Rewind so a later successful write still verifies.
          rewind_chain(&mut state.chain, &line);
        }
        line
      }
    };
    eprint_line(&line);
    self.inner.events.fetch_add(1, Ordering::Relaxed);
  }

  #[must_use]
  pub fn snapshot(&self) -> AuditSnapshot {
    let (bytes, last_seq, last_sha256) = match self.inner.mode {
      AuditMode::Stderr => {
        let chain = lock(&self.inner.stderr_chain);
        (0, chain.seq, chain.prev_hex.clone())
      }
      AuditMode::File => {
        let guard = lock(&self.inner.file);
        match guard.as_ref() {
          Some(state) => (state.bytes, state.chain.seq, state.chain.prev_hex.clone()),
          None => (0, 0, GENESIS_PREV.to_owned()),
        }
      }
    };
    AuditSnapshot {
      mode: self.inner.mode,
      path: self.inner.path.clone(),
      max_bytes: self.inner.max_bytes,
      retain: self.inner.retain,
      on_corrupt: self.inner.on_corrupt,
      events: self.inner.events.load(Ordering::Relaxed),
      write_errors: self.inner.write_errors.load(Ordering::Relaxed),
      last_seq,
      last_sha256,
      bytes,
      integrity: AuditIntegrity::from_code(self.inner.integrity.load(Ordering::Relaxed)),
    }
  }
}

/// Emit through the process sink on `config`.
pub fn emit(config: &crate::config::GatewayConfig, event: Value) {
  config.audit.emit(event);
}

/// A verified JSONL file (live or one rotation).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedFile {
  pub path: PathBuf,
  pub records: u64,
  pub last_seq: u64,
  pub last_sha256: String,
  pub first_prev_sha256: String,
}

/// Result of concatenating live + rotations into one JSONL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportReport {
  pub dest: PathBuf,
  pub files: u32,
  pub records: u64,
  pub last_sha256: String,
}

/// Verify one JSONL file's hash chain. The first record may continue a
/// rotation (its `prev_sha256` need not be genesis).
pub fn verify_file(path: &Path) -> Result<VerifiedFile, String> {
  let file = File::open(path).map_err(|err| format!("read {}: {err}", path.display()))?;
  let reader = BufReader::new(file);
  let mut records = 0u64;
  let mut last_seq = 0u64;
  let mut last_sha256 = GENESIS_PREV.to_owned();
  let mut first_prev = None;
  let mut expected_prev: Option<String> = None;
  for (idx, line) in reader.lines().enumerate() {
    let line = line.map_err(|err| format!("{}:{}: {err}", path.display(), idx + 1))?;
    if line.is_empty() {
      return Err(format!("{}:{}: empty line", path.display(), idx + 1));
    }
    let (seq, prev, digest) = verify_line(&line, idx + 1, path)?;
    if let Some(expected) = expected_prev.as_deref()
      && prev != expected
    {
      return Err(format!(
        "{}:{}: prev_sha256 does not match previous sha256",
        path.display(),
        idx + 1
      ));
    }
    if first_prev.is_none() {
      first_prev = Some(prev);
    }
    expected_prev = Some(digest.clone());
    last_seq = seq;
    last_sha256 = digest;
    records += 1;
  }
  if records == 0 {
    return Err(format!("{}: empty audit file", path.display()));
  }
  Ok(VerifiedFile {
    path: path.to_path_buf(),
    records,
    last_seq,
    last_sha256,
    first_prev_sha256: first_prev.unwrap_or_else(|| GENESIS_PREV.to_owned()),
  })
}

/// Concatenate oldest rotation → live into `dest` after verifying each
/// file and the stitch between them. Overwrites `dest`.
pub fn export_chain(live: &Path, dest: &Path) -> Result<ExportReport, String> {
  let files = rotation_stack(live);
  if files.is_empty() {
    return Err(format!("{}: no audit file to export", live.display()));
  }
  let mut verified = Vec::new();
  for path in &files {
    verified.push(verify_file(path)?);
  }
  for window in verified.windows(2) {
    if window[1].first_prev_sha256 != window[0].last_sha256 {
      return Err(format!(
        "{}: hash chain does not stitch to {}",
        window[1].path.display(),
        window[0].path.display()
      ));
    }
  }
  let mut out = File::create(dest).map_err(|err| format!("write {}: {err}", dest.display()))?;
  let mut records = 0u64;
  for path in &files {
    let text = fs::read_to_string(path).map_err(|err| format!("read {}: {err}", path.display()))?;
    if !text.is_empty() {
      out.write_all(text.as_bytes()).map_err(|err| format!("write {}: {err}", dest.display()))?;
      if !text.ends_with('\n') {
        out.write_all(b"\n").map_err(|err| format!("write {}: {err}", dest.display()))?;
      }
    }
    records += verified.iter().find(|v| v.path == *path).map(|v| v.records).unwrap_or(0);
  }
  out.flush().map_err(|err| format!("flush {}: {err}", dest.display()))?;
  let last_sha256 = verified.last().map(|v| v.last_sha256.clone()).unwrap_or_default();
  // The concatenation of a stitched stack is itself one verifiable file.
  let check = verify_file(dest)?;
  if check.records != records {
    return Err(format!("{}: export record count drifted", dest.display()));
  }
  Ok(ExportReport { dest: dest.to_path_buf(), files: files.len() as u32, records, last_sha256 })
}

fn verify_line(line: &str, lineno: usize, path: &Path) -> Result<(u64, String, String), String> {
  let value: Value = serde_json::from_str(line)
    .map_err(|err| format!("{}:{lineno}: not JSON: {err}", path.display()))?;
  let obj = value
    .as_object()
    .ok_or_else(|| format!("{}:{lineno}: audit line is not an object", path.display()))?;
  let claimed = obj
    .get("sha256")
    .and_then(Value::as_str)
    .ok_or_else(|| format!("{}:{lineno}: missing sha256", path.display()))?;
  let prev = obj
    .get("prev_sha256")
    .and_then(Value::as_str)
    .ok_or_else(|| format!("{}:{lineno}: missing prev_sha256", path.display()))?
    .to_owned();
  if !is_sha256_hex(&prev) || !is_sha256_hex(claimed) {
    return Err(format!(
      "{}:{lineno}: sha256 fields must be 64 lowercase hex digits",
      path.display()
    ));
  }
  let seq = obj
    .get("seq")
    .and_then(Value::as_u64)
    .ok_or_else(|| format!("{}:{lineno}: missing seq", path.display()))?;
  let mut map = BTreeMap::new();
  for (key, val) in obj {
    if key != "sha256" {
      map.insert(key.clone(), val.clone());
    }
  }
  let canonical = serde_json::to_vec(&map)
    .map_err(|err| format!("{}:{lineno}: reserialize: {err}", path.display()))?;
  let digest = hex_encode(&hash_record(&prev, &canonical));
  if digest != claimed {
    return Err(format!("{}:{lineno}: sha256 mismatch", path.display()));
  }
  Ok((seq, prev, digest))
}

fn next_line(chain: &mut Chain, event: Value) -> String {
  chain.seq += 1;
  let ts = now_millis();
  let mut map: BTreeMap<String, Value> = BTreeMap::new();
  map.insert("seq".to_owned(), json!(chain.seq));
  map.insert("ts".to_owned(), json!(ts));
  map.insert("prev_sha256".to_owned(), json!(chain.prev_hex));
  match event {
    Value::Object(obj) => {
      for (key, val) in obj {
        if matches!(key.as_str(), "seq" | "ts" | "prev_sha256" | "sha256") {
          continue;
        }
        map.insert(key, val);
      }
    }
    other => {
      map.insert("event".to_owned(), json!("opaque"));
      map.insert("value".to_owned(), other);
    }
  }
  let canonical = serde_json::to_vec(&map).expect("audit envelope is serializable");
  let digest = hex_encode(&hash_record(&chain.prev_hex, &canonical));
  chain.prev_hex = digest.clone();
  map.insert("sha256".to_owned(), json!(digest));
  serde_json::to_string(&map).expect("audit line is serializable")
}

fn rewind_chain(chain: &mut Chain, failed_line: &str) {
  let Ok(value) = serde_json::from_str::<Value>(failed_line) else {
    return;
  };
  let Some(obj) = value.as_object() else {
    return;
  };
  if let Some(prev) = obj.get("prev_sha256").and_then(Value::as_str) {
    chain.prev_hex = prev.to_owned();
  }
  if chain.seq > 0 {
    chain.seq -= 1;
  }
}

fn append_line(state: &mut FileState, line: &str) -> Result<(), String> {
  let file = state.file.as_mut().ok_or_else(|| "audit file is closed".to_owned())?;
  writeln!(file, "{line}").map_err(|err| format!("write audit: {err}"))?;
  file.flush().map_err(|err| format!("flush audit: {err}"))?;
  let _ = file.sync_all();
  state.bytes += line.len() as u64 + 1;
  Ok(())
}

fn rotate_live(state: &mut FileState, live: Option<&Path>, retain: u32) -> Result<(), String> {
  let live = live.ok_or_else(|| "audit rotate without a path".to_owned())?;
  if let Some(file) = state.file.take() {
    let _ = file.sync_all();
    drop(file);
  }
  let chain = Chain { seq: state.chain.seq, prev_hex: state.chain.prev_hex.clone() };
  let oldest = rotation_path(live, retain);
  if oldest.exists() {
    fs::remove_file(&oldest).map_err(|err| format!("remove {}: {err}", oldest.display()))?;
  }
  for index in (1..retain).rev() {
    let from = rotation_path(live, index);
    if from.exists() {
      let to = rotation_path(live, index + 1);
      fs::rename(&from, &to)
        .map_err(|err| format!("rename {} -> {}: {err}", from.display(), to.display()))?;
    }
  }
  fs::rename(live, rotation_path(live, 1))
    .map_err(|err| format!("rename {} -> {}.1: {err}", live.display(), live.display()))?;
  *state = open_live(live, chain)?;
  Ok(())
}

fn open_live(path: &Path, chain: Chain) -> Result<FileState, String> {
  let file = open_append(path).map_err(|err| format!("open {}: {err}", path.display()))?;
  let bytes = file.metadata().map(|m| m.len()).unwrap_or(0);
  Ok(FileState { file: Some(file), bytes, chain })
}

fn open_append(path: &Path) -> std::io::Result<File> {
  let mut opts = OpenOptions::new();
  opts.read(true).write(true).create(true).append(true);
  #[cfg(unix)]
  {
    use std::os::unix::fs::OpenOptionsExt;
    opts.mode(0o600);
  }
  opts.open(path)
}

fn rotation_path(live: &Path, n: u32) -> PathBuf {
  let mut name = live.file_name().unwrap_or_default().to_os_string();
  name.push(format!(".{n}"));
  live.with_file_name(name)
}

fn rotation_stack(live: &Path) -> Vec<PathBuf> {
  let mut n = 1u32;
  while rotation_path(live, n).is_file() {
    n += 1;
    if n > 128 {
      break;
    }
  }
  let mut files = Vec::new();
  for index in (1..n).rev() {
    files.push(rotation_path(live, index));
  }
  if live.is_file() {
    files.push(live.to_path_buf());
  }
  files
}

fn corrupt_aside_path(live: &Path) -> PathBuf {
  let mut name = live.file_name().unwrap_or_default().to_os_string();
  name.push(format!(".corrupt.{}", now_secs()));
  live.with_file_name(name)
}

fn hash_record(prev_hex: &str, canonical: &[u8]) -> [u8; 32] {
  let mut hasher = Sha256::new();
  hasher.update(prev_hex.as_bytes());
  hasher.update(b"\n");
  hasher.update(canonical);
  hasher.finalize().into()
}

fn hex_encode(bytes: &[u8]) -> String {
  const HEX: &[u8; 16] = b"0123456789abcdef";
  let mut out = String::with_capacity(bytes.len() * 2);
  for byte in bytes {
    out.push(HEX[(byte >> 4) as usize] as char);
    out.push(HEX[(byte & 0x0f) as usize] as char);
  }
  out
}

fn is_sha256_hex(value: &str) -> bool {
  value.len() == 64 && value.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn eprint_line(line: &str) {
  eprintln!("rclwebd audit {line}");
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
  mutex.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn now_millis() -> u64 {
  SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn now_secs() -> u64 {
  SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn parse_u64_env(name: &str, default: u64) -> Result<u64, String> {
  match std::env::var(name) {
    Ok(raw) => {
      raw.parse().map_err(|_| format!("invalid {name}={raw:?}; expected a non-negative integer"))
    }
    Err(_) => Ok(default),
  }
}

fn parse_u32_env(name: &str, default: u32) -> Result<u32, String> {
  match std::env::var(name) {
    Ok(raw) => {
      raw.parse().map_err(|_| format!("invalid {name}={raw:?}; expected a non-negative integer"))
    }
    Err(_) => Ok(default),
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::atomic::{AtomicU64, Ordering};

  static UNIQUE: AtomicU64 = AtomicU64::new(0);

  fn temp_path(label: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!(
      "rclwebd-audit-{}-{}-{label}",
      std::process::id(),
      UNIQUE.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = fs::remove_file(&path);
    for n in 1..=8 {
      let _ = fs::remove_file(rotation_path(&path, n));
    }
    path
  }

  fn cleanup(path: &Path) {
    let _ = fs::remove_file(path);
    for n in 1..=8 {
      let _ = fs::remove_file(rotation_path(path, n));
    }
    if let Some(dir) = path.parent()
      && let Ok(entries) = fs::read_dir(dir)
    {
      let prefix = path.file_name().unwrap_or_default().to_string_lossy();
      for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(prefix.as_ref()) && name.contains(".corrupt.") {
          let _ = fs::remove_file(entry.path());
        }
      }
    }
  }

  fn emit_n(sink: &AuditSink, n: u32) {
    for i in 0..n {
      sink.emit(json!({"event": "test", "i": i}));
    }
  }

  #[test]
  fn parse_modes_and_on_corrupt() {
    assert_eq!(AuditMode::parse(""), Some(AuditMode::Stderr));
    assert_eq!(AuditMode::parse("stderr"), Some(AuditMode::Stderr));
    assert_eq!(AuditMode::parse("FILE"), Some(AuditMode::File));
    assert_eq!(AuditMode::parse("syslog"), None);
    assert_eq!(OnCorrupt::parse(""), Some(OnCorrupt::Fail));
    assert_eq!(OnCorrupt::parse("rotate"), Some(OnCorrupt::Rotate));
    assert_eq!(OnCorrupt::parse("ignore"), None);
  }

  #[test]
  fn file_chain_verifies_and_rejects_tamper() {
    let path = temp_path("chain");
    let sink = AuditSink::file(&path, DEFAULT_MAX_BYTES, 2, OnCorrupt::Fail).unwrap();
    emit_n(&sink, 3);
    let snap = sink.snapshot();
    assert_eq!(snap.mode, AuditMode::File);
    assert_eq!(snap.events, 3);
    assert_eq!(snap.last_seq, 3);
    assert_eq!(snap.integrity, AuditIntegrity::Ok);
    let verified = verify_file(&path).expect("verify live");
    assert_eq!(verified.records, 3);
    assert_eq!(verified.last_sha256, snap.last_sha256);
    assert_eq!(verified.first_prev_sha256, GENESIS_PREV);

    let mut text = fs::read_to_string(&path).unwrap();
    text = text.replace("\"i\":1", "\"i\":99");
    fs::write(&path, text).unwrap();
    let err = verify_file(&path).unwrap_err();
    assert!(err.contains("sha256 mismatch"), "{err}");
    cleanup(&path);
  }

  #[test]
  fn truncated_line_fails_verify() {
    let path = temp_path("trunc");
    let sink = AuditSink::file(&path, DEFAULT_MAX_BYTES, 2, OnCorrupt::Fail).unwrap();
    emit_n(&sink, 2);
    let mut bytes = fs::read(&path).unwrap();
    bytes.truncate(bytes.len().saturating_sub(8));
    fs::write(&path, bytes).unwrap();
    assert!(verify_file(&path).is_err());
    cleanup(&path);
  }

  #[test]
  fn corrupt_fail_refuses_open() {
    let path = temp_path("fail");
    fs::write(&path, "{not json}\n").unwrap();
    let err = AuditSink::file(&path, 1024, 2, OnCorrupt::Fail).unwrap_err();
    assert!(err.contains("integrity"), "{err}");
    cleanup(&path);
  }

  #[test]
  fn corrupt_rotate_moves_aside_and_starts_new_chain() {
    let path = temp_path("rotate-corrupt");
    fs::write(&path, "{not json}\n").unwrap();
    let sink = AuditSink::file(&path, 1024, 2, OnCorrupt::Rotate).unwrap();
    let verified = verify_file(&path).expect("new chain");
    assert_eq!(verified.records, 1);
    assert_eq!(verified.first_prev_sha256, GENESIS_PREV);
    let line = fs::read_to_string(&path).unwrap();
    assert!(line.contains("\"reason\":\"integrity_fail\""));
    let parent = path.parent().unwrap();
    let prefix = path.file_name().unwrap().to_string_lossy();
    let aside = fs::read_dir(parent)
      .unwrap()
      .flatten()
      .map(|e| e.file_name().to_string_lossy().into_owned())
      .find(|name| name.starts_with(prefix.as_ref()) && name.contains(".corrupt."))
      .expect("corrupt aside");
    assert!(parent.join(&aside).is_file());
    let _ = sink;
    cleanup(&path);
  }

  #[test]
  fn rotation_stitches_and_export_verifies() {
    let path = temp_path("rotate");
    // ~230-byte test lines: 400 bytes holds two records, then the next
    // emit rotates. retain=5 keeps every rotation from eight events.
    let sink = AuditSink::file(&path, 400, 5, OnCorrupt::Fail).unwrap();
    emit_n(&sink, 8);
    assert!(rotation_path(&path, 1).is_file(), "expected at least one rotation");
    let live = verify_file(&path).expect("live after rotate");
    let older = verify_file(&rotation_path(&path, 1)).expect("rotation .1");
    assert_eq!(live.first_prev_sha256, older.last_sha256);

    let dest = temp_path("export");
    let report = export_chain(&path, &dest).expect("export");
    assert_eq!(report.records, 8, "retain must keep the full eight-event chain");
    assert!(report.files >= 2);
    let exported = verify_file(&dest).expect("exported chain");
    assert_eq!(exported.records, report.records);
    assert_eq!(exported.last_sha256, report.last_sha256);
    cleanup(&path);
    cleanup(&dest);
  }

  #[test]
  fn export_rejects_unstitchable_stack() {
    let path = temp_path("unstitch");
    let sink = AuditSink::file(&path, DEFAULT_MAX_BYTES, 2, OnCorrupt::Fail).unwrap();
    emit_n(&sink, 1);
    drop(sink);
    // Pretend a foreign rotation that does not continue this chain.
    let other = temp_path("other");
    let other_sink = AuditSink::file(&other, DEFAULT_MAX_BYTES, 2, OnCorrupt::Fail).unwrap();
    emit_n(&other_sink, 1);
    drop(other_sink);
    fs::rename(&other, rotation_path(&path, 1)).unwrap();
    let dest = temp_path("bad-export");
    let err = export_chain(&path, &dest).unwrap_err();
    assert!(err.contains("stitch") || err.contains("sha256"), "{err}");
    cleanup(&path);
    cleanup(&other);
    cleanup(&dest);
  }

  #[test]
  fn stderr_sink_snapshots_without_a_path() {
    let sink = AuditSink::stderr();
    sink.emit(json!({"event": "authenticate", "decision": "allow"}));
    let snap = sink.snapshot();
    assert_eq!(snap.mode, AuditMode::Stderr);
    assert!(snap.path.is_none());
    assert_eq!(snap.events, 1);
    assert_eq!(snap.integrity, AuditIntegrity::NotApplicable);
    assert_ne!(snap.last_sha256, GENESIS_PREV);
  }

  #[test]
  fn reserved_envelope_keys_are_not_caller_controlled() {
    let path = temp_path("reserved");
    let sink = AuditSink::file(&path, DEFAULT_MAX_BYTES, 1, OnCorrupt::Fail).unwrap();
    sink.emit(json!({
        "event": "test",
        "seq": 99,
        "sha256": "deadbeef",
        "prev_sha256": "nope",
    }));
    let verified = verify_file(&path).unwrap();
    assert_eq!(verified.last_seq, 1);
    let line = fs::read_to_string(&path).unwrap();
    assert!(!line.contains("deadbeef"));
    cleanup(&path);
  }

  #[test]
  fn file_rejects_zero_max_or_retain() {
    let path = temp_path("badcfg");
    assert!(AuditSink::file(&path, 0, 2, OnCorrupt::Fail).is_err());
    assert!(AuditSink::file(&path, 100, 0, OnCorrupt::Fail).is_err());
    cleanup(&path);
  }
}
