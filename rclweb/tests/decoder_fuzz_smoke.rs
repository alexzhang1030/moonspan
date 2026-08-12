//! Deterministic decoder fuzz smoke (R2-03).
//!
//! Mutates seed corpora from `protocol/testdata` and `conformance/cdr` and
//! feeds frame / bootstrap / CDR parsers. Goal: no panics under adversarial
//! inputs on the stable toolchain (libFuzzer/cargo-fuzz stays optional for
//! nightly; see `fuzz/README.md`).

use rclweb::{
    CdrReader, FRAME_HEADER_LENGTH, decode_deterministic_cbor, decode_point_cloud2_le,
    parse_bootstrap, parse_frame,
};
use std::fs;
use std::path::{Path, PathBuf};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("workspace root")
        .to_path_buf()
}

fn load_seeds(dir: &Path, limit: usize) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return out;
    };
    let mut paths: Vec<_> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("bin"))
        .collect();
    paths.sort();
    for path in paths.into_iter().take(limit) {
        if let Ok(bytes) = fs::read(&path) {
            out.push(bytes);
        }
    }
    out
}

fn mutate(seed: &[u8], strategy: u32, salt: u32) -> Vec<u8> {
    let mut bytes = seed.to_vec();
    if bytes.is_empty() {
        bytes.push((salt & 0xff) as u8);
        return bytes;
    }
    match strategy % 8 {
        0 => {
            // Bit flip
            let i = (salt as usize) % bytes.len();
            bytes[i] ^= 1 << (salt % 8);
        }
        1 => {
            // Truncate
            let len = (salt as usize) % (bytes.len() + 1);
            bytes.truncate(len);
        }
        2 => {
            // Append noise
            bytes.extend_from_slice(&salt.to_le_bytes());
            bytes.push(0xaa);
        }
        3 => {
            // Splice zero block
            let i = (salt as usize) % bytes.len();
            let n = 1 + (salt as usize % 17);
            bytes.splice(i..i, std::iter::repeat_n(0u8, n));
        }
        4 => {
            // Overwrite header-ish prefix
            let n = bytes.len().min(FRAME_HEADER_LENGTH.max(12));
            for b in bytes.iter_mut().take(n) {
                *b = b.wrapping_add((salt as u8).wrapping_mul(3));
            }
        }
        5 => {
            // Drop middle
            if bytes.len() > 4 {
                let start = (salt as usize) % (bytes.len() / 2);
                let end = start + 1 + (salt as usize % (bytes.len() - start));
                let end = end.min(bytes.len());
                bytes.drain(start..end);
            }
        }
        6 => {
            // Duplicate payload chunk
            let chunk = bytes.clone();
            bytes.extend_from_slice(&chunk[..chunk.len().min(64)]);
        }
        _ => {
            // Replace with short adversarial stubs
            bytes = match salt % 5 {
                0 => vec![],
                1 => vec![0],
                2 => b"R2WP".to_vec(),
                3 => vec![0; FRAME_HEADER_LENGTH],
                _ => vec![0xff; 3],
            };
        }
    }
    bytes
}

fn exercise_bootstrap(bytes: &[u8]) {
    let _ = parse_bootstrap(bytes);
}

fn exercise_frame(bytes: &[u8]) {
    let _ = parse_frame(bytes, None);
    if let Ok(frame) = parse_frame(bytes, None)
        && let rclweb::FramePayload::Control(msg) = frame.payload
    {
        let _ = msg;
    }
}

fn exercise_cbor(bytes: &[u8]) {
    let _ = decode_deterministic_cbor(bytes);
}

fn exercise_cdr(bytes: &[u8]) {
    if let Ok(mut reader) = CdrReader::open_default(bytes) {
        let _ = reader.read_u32();
        let _ = reader.read_string(None);
    }
    let _ = decode_point_cloud2_le(bytes);
}

#[test]
fn fuzz_smoke_bootstrap_frame_cbor_cdr_no_panic() {
    let root = repo_root();
    let mut seeds = Vec::new();
    seeds.extend(load_seeds(&root.join("protocol/testdata/valid"), 22));
    seeds.extend(load_seeds(&root.join("protocol/testdata/malformed"), 55));
    seeds.extend(load_seeds(&root.join("conformance/cdr/fixtures/J-FT"), 12));
    // Tiny hard-coded adversarial stubs always present even if dirs move.
    seeds.push(Vec::new());
    seeds.push(b"R2WP".to_vec());
    seeds.push(vec![0; 32]);

    assert!(
        seeds.len() >= 20,
        "expected a non-trivial seed corpus, got {}",
        seeds.len()
    );

    const STRATEGIES: u32 = 8;
    const SALTS_PER_SEED: u32 = 16;
    let mut cases = 0u64;
    for seed in &seeds {
        for strategy in 0..STRATEGIES {
            for salt in 0..SALTS_PER_SEED {
                let bytes = mutate(seed, strategy, salt.wrapping_mul(17).wrapping_add(strategy));
                exercise_bootstrap(&bytes);
                exercise_frame(&bytes);
                exercise_cbor(&bytes);
                exercise_cdr(&bytes);
                cases += 1;
            }
        }
    }
    //  seeds * 8 * 16 exercises — keep this assertion so the smoke cannot shrink unnoticed.
    assert!(cases >= 20 * 8 * 16, "fuzz smoke case count {cases}");
}
