#![no_main]

use libfuzzer_sys::fuzz_target;
use rclweb::parse_bootstrap;

fuzz_target!(|data: &[u8]| {
    let _ = parse_bootstrap(data);
});
