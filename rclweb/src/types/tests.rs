//! Unit tests for the Phase 1 schema registry and key validation.

use super::error::SchemaErrorCode;
use super::key::{SCHEME_RCLWEB_SCHEMA_V1, SCHEME_REP2011_RIHS, SchemaKey};
use super::registry::{CdrRepresentation, SchemaRegistry, SchemaRegistryBuilder};

#[test]
fn phase1_has_eighteen_identities_and_nine_descriptors() {
  let reg = SchemaRegistry::phase1().expect("phase1 load");
  assert_eq!(reg.identity_count(), 18);
  assert_eq!(reg.descriptor_count(), 9);
}

#[test]
fn primitive_scalars_h_ft_and_j_ft_tails() {
  let reg = SchemaRegistry::phase1().unwrap();
  let type_name = "rclweb_cdr_interfaces/msg/PrimitiveScalars";

  for (scheme, value) in [
    (SCHEME_RCLWEB_SCHEMA_V1, "ec92f53bd1a60ed2b7aaf4df51159a7330e3eddc6ac24341973f60bffec6a0c7"),
    (
      SCHEME_REP2011_RIHS,
      "RIHS01_db44c373c05fc055970958730d7cb835f816b091b68bfdf93d6ed50086092cea",
    ),
  ] {
    let key = SchemaKey::new(scheme, value, type_name, 1, 1).unwrap();
    for row in ["H-FT", "J-FT"] {
      let le = reg.lookup(&key, row, CdrRepresentation::Le).unwrap();
      assert_eq!(le.zero_tail_bytes, 4, "{scheme} {row} LE");
      let be = reg.lookup(&key, row, CdrRepresentation::Be).unwrap();
      assert_eq!(be.zero_tail_bytes, 0, "{scheme} {row} BE");
    }
  }
}

#[test]
fn invalid_key_faults() {
  let err = SchemaKey::new(
    SCHEME_RCLWEB_SCHEMA_V1,
    "3ABA18EC187625B72E035716E63D060ECE2E68946990BF04F77C93802EB669FD",
    "rclweb_cdr_interfaces/msg/PrimitiveScalars",
    1,
    1,
  )
  .unwrap_err();
  assert_eq!(err.code, SchemaErrorCode::InvalidSchemaKey);

  let err = SchemaKey::new(
    "unknown-scheme",
    "ec92f53bd1a60ed2b7aaf4df51159a7330e3eddc6ac24341973f60bffec6a0c7",
    "t",
    1,
    1,
  )
  .unwrap_err();
  assert_eq!(err.code, SchemaErrorCode::InvalidSchemaKey);

  let err = SchemaKey::new(
    SCHEME_REP2011_RIHS,
    "RIHS01_DB44C373C05FC055970958730D7CB835F816B091B68BFDF93D6ED50086092CEA",
    "t",
    1,
    1,
  )
  .unwrap_err();
  assert_eq!(err.code, SchemaErrorCode::InvalidSchemaKey);

  let err = SchemaKey::new(
    SCHEME_RCLWEB_SCHEMA_V1,
    "ec92f53bd1a60ed2b7aaf4df51159a7330e3eddc6ac24341973f60bffec6a0c7",
    "t",
    2,
    1,
  )
  .unwrap_err();
  assert_eq!(err.code, SchemaErrorCode::InvalidSchemaKey);
}

#[test]
fn builder_conflict_and_idempotent() {
  let mut b = SchemaRegistryBuilder::new();
  b.register_descriptor("d1", "pkg/msg/A").unwrap();
  b.register_descriptor("d1", "pkg/msg/A").unwrap(); // idempotent
  let err = b.register_descriptor("d1", "pkg/msg/B").unwrap_err();
  assert_eq!(err.code, SchemaErrorCode::SchemaConflict);

  let key = SchemaKey::new(
    SCHEME_RCLWEB_SCHEMA_V1,
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "pkg/msg/A",
    1,
    1,
  )
  .unwrap();
  b.register_identity(key.clone(), "d1").unwrap();
  b.register_identity(key.clone(), "d1").unwrap();
  let mut key2 = key.clone();
  key2.type_name = "pkg/msg/Other".into();
  // Different type_name with same scheme/value → conflict
  let err = b.register_identity(key2, "d1").unwrap_err();
  assert_eq!(err.code, SchemaErrorCode::SchemaConflict);

  b.register_wire_profile("pkg/msg/A", "J-FT", CdrRepresentation::Le, 4).unwrap();
  b.register_wire_profile("pkg/msg/A", "J-FT", CdrRepresentation::Le, 4).unwrap();
  let err = b.register_wire_profile("pkg/msg/A", "J-FT", CdrRepresentation::Le, 0).unwrap_err();
  assert_eq!(err.code, SchemaErrorCode::SchemaConflict);
}

#[test]
fn missing_wire_profile_is_unavailable() {
  let reg = SchemaRegistry::phase1().unwrap();
  let key = SchemaKey::new(
    SCHEME_REP2011_RIHS,
    "RIHS01_db44c373c05fc055970958730d7cb835f816b091b68bfdf93d6ed50086092cea",
    "rclweb_cdr_interfaces/msg/PrimitiveScalars",
    1,
    1,
  )
  .unwrap();
  // H-CY has no BE fixture for PrimitiveScalars.
  let err = reg.lookup(&key, "H-CY", CdrRepresentation::Be).unwrap_err();
  assert_eq!(err.code, SchemaErrorCode::SchemaUnavailable);
}
