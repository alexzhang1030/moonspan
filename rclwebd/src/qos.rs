//! Wire QoS parsing and the R1 effective-QoS resolution.
//!
//! Wire enums come from the registry (`protocol/registry/r2wp-v0.json`):
//! reliability 0 SYSTEM_DEFAULT / 1 RELIABLE / 2 BEST_EFFORT; durability
//! 0 SYSTEM_DEFAULT / 1 TRANSIENT_LOCAL / 2 VOLATILE; history 0 SYSTEM_DEFAULT
//! / 1 KEEP_LAST / 2 KEEP_ALL; liveliness 0 SYSTEM_DEFAULT / 1 AUTOMATIC /
//! 2 MANUAL_BY_TOPIC. Effective QoS carries only concrete values.

use rclweb::CborValue;

/// Requested QoS as carried by OpenChannel key 11 (already shape-validated by
/// the core control parser; SYSTEM_DEFAULT members permitted).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RequestedQos {
    pub reliability: u8,
    pub durability: u8,
    pub history_kind: u8,
    pub history_depth: Option<u32>,
    pub liveliness: u8,
}

impl RequestedQos {
    /// Extract from the validated OpenChannel `qos` map value.
    #[must_use]
    pub fn from_wire(value: &CborValue<'_>) -> Self {
        let mut out = Self::default();
        if let CborValue::Map(entries) = value {
            for (key, val) in entries {
                let n = match val {
                    CborValue::Unsigned(v) => *v,
                    _ => continue,
                };
                match key {
                    1 => out.reliability = n as u8,
                    2 => out.durability = n as u8,
                    3 => out.history_kind = n as u8,
                    4 => out.history_depth = Some(n as u32),
                    7 => out.liveliness = n as u8,
                    _ => {}
                }
            }
        }
        out
    }
}

/// Concrete resolved QoS (ChannelReady key 57 and the rcl entity profile).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EffectiveQos {
    /// true = RELIABLE (1), false = BEST_EFFORT (2).
    pub reliable: bool,
    /// true = TRANSIENT_LOCAL (1), false = VOLATILE (2).
    pub transient_local: bool,
    /// true = KEEP_ALL (2), false = KEEP_LAST (1) with `depth`.
    pub keep_all: bool,
    pub depth: u32,
    /// true = MANUAL_BY_TOPIC (2), false = AUTOMATIC (1).
    pub manual_by_topic: bool,
}

/// R1 gateway defaults for SYSTEM_DEFAULT members (rcl defaults: reliable,
/// volatile, keep-last depth 10, automatic liveliness).
#[must_use]
pub fn resolve_effective(requested: &RequestedQos) -> EffectiveQos {
    let keep_all = requested.history_kind == 2;
    EffectiveQos {
        reliable: requested.reliability != 2,
        transient_local: requested.durability == 1,
        keep_all,
        depth: if keep_all { 0 } else { requested.history_depth.unwrap_or(10).max(1) },
        manual_by_topic: requested.liveliness == 2,
    }
}

impl EffectiveQos {
    /// ChannelReady key 57 wire map (concrete members only, liveliness
    /// required).
    #[must_use]
    pub fn to_wire(self) -> CborValue<'static> {
        let mut entries = vec![
            (1, CborValue::Unsigned(if self.reliable { 1 } else { 2 })),
            (2, CborValue::Unsigned(if self.transient_local { 1 } else { 2 })),
            (3, CborValue::Unsigned(if self.keep_all { 2 } else { 1 })),
        ];
        if !self.keep_all {
            entries.push((4, CborValue::Unsigned(u64::from(self.depth))));
        }
        entries.push((7, CborValue::Unsigned(if self.manual_by_topic { 2 } else { 1 })));
        CborValue::Map(entries)
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn system_default_resolves_to_rcl_defaults() {
        let effective = resolve_effective(&RequestedQos::default());
        assert!(effective.reliable);
        assert!(!effective.transient_local);
        assert!(!effective.keep_all);
        assert_eq!(effective.depth, 10);
        assert!(!effective.manual_by_topic);
    }

    #[test]
    fn concrete_request_passes_through() {
        let requested = RequestedQos {
            reliability: 2,
            durability: 1,
            history_kind: 1,
            history_depth: Some(3),
            liveliness: 2,
        };
        let effective = resolve_effective(&requested);
        assert!(!effective.reliable);
        assert!(effective.transient_local);
        assert_eq!(effective.depth, 3);
        assert!(effective.manual_by_topic);
    }

    #[test]
    fn wire_map_is_concrete_and_parser_shaped() {
        let effective = resolve_effective(&RequestedQos::default());
        let map = effective.to_wire();
        let CborValue::Map(entries) = &map else {
            panic!("expected map");
        };
        // reliability, durability, history, depth, liveliness
        assert_eq!(entries.len(), 5);
        assert!(entries.iter().all(|(_, v)| match v {
            CborValue::Unsigned(n) => *n > 0,
            _ => false,
        }));
    }
}
