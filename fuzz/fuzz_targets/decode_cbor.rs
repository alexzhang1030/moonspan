#![no_main]

use libfuzzer_sys::fuzz_target;
use rclweb::decode_deterministic_cbor;

fuzz_target!(|data: &[u8]| {
    let _ = decode_deterministic_cbor(data);
});
