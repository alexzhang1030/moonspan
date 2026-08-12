#![no_main]

use libfuzzer_sys::fuzz_target;
use rclweb::{CdrReader, decode_point_cloud2_le};

fuzz_target!(|data: &[u8]| {
    let _ = CdrReader::open_default(data);
    let _ = decode_point_cloud2_le(data);
});
