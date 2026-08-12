//! Shared dependency: `builtin_interfaces/msg/Time`.

use crate::cdr::{CdrError, CdrNesting, CdrReader, CdrWriter};

/// `builtin_interfaces/msg/Time`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Time {
    pub sec: i32,
    pub nanosec: u32,
}

pub fn decode_time(r: &mut CdrReader<'_>, _n: CdrNesting) -> Result<Time, CdrError> {
    Ok(Time { sec: r.read_i32()?, nanosec: r.read_u32()? })
}

pub fn encode_time(w: &mut CdrWriter, v: &Time, _n: CdrNesting) -> Result<(), CdrError> {
    w.write_i32(v.sec)?;
    w.write_u32(v.nanosec)?;
    Ok(())
}
