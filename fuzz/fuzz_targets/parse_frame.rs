#![no_main]

use libfuzzer_sys::fuzz_target;
use rclweb::parse_frame;

fuzz_target!(|data: &[u8]| {
    let _ = parse_frame(data, None);
});
