//! `SchemaKey` validation for dual-scheme Phase 1 identity.
//!
//! Contract: [docs/runtime/generated-types.md](../../../docs/runtime/generated-types.md).

use super::error::SchemaError;
use super::limits::{
  ENCODING_CDR1, MAX_SCHEME_CHARS, MAX_TYPE_NAME_CHARS, MAX_VALUE_CHARS, PHASE1_SCHEMA_GENERATION,
};

/// Humble bundle identity scheme (SHA-256 of canonical bundle bytes).
pub const SCHEME_MOONSPAN_SCHEMA_V1: &str = "moonspan-schema-v1";

/// Jazzy REP-2011 RIHS identity scheme.
pub const SCHEME_REP2011_RIHS: &str = "rep2011-rihs";

/// Unified registry identity key (five fields).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SchemaKey {
  pub scheme: String,
  pub value: String,
  pub type_name: String,
  /// R2WP payload-encoding enum; Phase 1 requires `1` (CDR1).
  pub encoding: u8,
  /// Generation counter; Phase 1 corpus uses `1`.
  pub schema_generation: u32,
}

impl SchemaKey {
  /// Build a Phase 1 key after validating scheme/value/encoding/generation and length ceilings.
  pub fn new(
    scheme: impl Into<String>,
    value: impl Into<String>,
    type_name: impl Into<String>,
    encoding: u8,
    schema_generation: u32,
  ) -> Result<Self, SchemaError> {
    let key = Self {
      scheme: scheme.into(),
      value: value.into(),
      type_name: type_name.into(),
      encoding,
      schema_generation,
    };
    key.validate()?;
    Ok(key)
  }

  /// Validate this key against Phase 1 scheme rules and absolute length ceilings.
  pub fn validate(&self) -> Result<(), SchemaError> {
    validate_scheme_value(&self.scheme, &self.value)?;
    if self.type_name.is_empty() || self.type_name.chars().count() > MAX_TYPE_NAME_CHARS {
      return Err(
        SchemaError::invalid_schema_key(format!(
          "type_name length {} outside 1..={MAX_TYPE_NAME_CHARS}",
          self.type_name.chars().count()
        ))
        .with_field("type_name"),
      );
    }
    if self.encoding != ENCODING_CDR1 {
      return Err(
        SchemaError::invalid_schema_key(format!(
          "encoding {} is not Phase 1 CDR1 ({ENCODING_CDR1})",
          self.encoding
        ))
        .with_field("encoding"),
      );
    }
    // schema_generation is u32 so the absolute domain is always satisfied;
    // Phase 1 still requires the corpus value.
    if self.schema_generation != PHASE1_SCHEMA_GENERATION {
      return Err(
        SchemaError::invalid_schema_key(format!(
          "schema_generation {} is not Phase 1 value {PHASE1_SCHEMA_GENERATION}",
          self.schema_generation
        ))
        .with_field("schema_generation"),
      );
    }
    Ok(())
  }
}

/// Validate scheme name and value form (lowercase hex rules, exact lengths).
pub fn validate_scheme_value(scheme: &str, value: &str) -> Result<(), SchemaError> {
  let scheme_len = scheme.chars().count();
  if scheme.is_empty() || scheme_len > MAX_SCHEME_CHARS {
    return Err(
      SchemaError::invalid_schema_key(format!(
        "scheme length {scheme_len} outside 1..={MAX_SCHEME_CHARS}"
      ))
      .with_field("scheme"),
    );
  }
  let value_len = value.chars().count();
  if value.is_empty() || value_len > MAX_VALUE_CHARS {
    return Err(
      SchemaError::invalid_schema_key(format!(
        "value length {value_len} outside 1..={MAX_VALUE_CHARS}"
      ))
      .with_field("value"),
    );
  }

  match scheme {
    SCHEME_MOONSPAN_SCHEMA_V1 => {
      if value.len() != 64 || !is_lowercase_hex(value) {
        return Err(
          SchemaError::invalid_schema_key(
            "moonspan-schema-v1 value must be exactly 64 lowercase hex characters",
          )
          .with_field("value"),
        );
      }
    }
    SCHEME_REP2011_RIHS => {
      if !value.starts_with("RIHS01_") || value.len() != 71 || !is_lowercase_hex(&value[7..]) {
        return Err(
          SchemaError::invalid_schema_key(
            "rep2011-rihs value must be RIHS01_ plus 64 lowercase hex characters",
          )
          .with_field("value"),
        );
      }
    }
    _ => {
      return Err(
        SchemaError::invalid_schema_key(format!("unsupported scheme `{scheme}`"))
          .with_field("scheme"),
      );
    }
  }
  Ok(())
}

fn is_lowercase_hex(s: &str) -> bool {
  !s.is_empty() && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn accepts_moonspan_and_rihs() {
    SchemaKey::new(
      SCHEME_MOONSPAN_SCHEMA_V1,
      "3aba18ec187625b72e035716e63d060ece2e68946990bf04f77c93802eb669fd",
      "moonspan_cdr_interfaces/msg/PrimitiveScalars",
      1,
      1,
    )
    .unwrap();
    SchemaKey::new(
      SCHEME_REP2011_RIHS,
      "RIHS01_db44c373c05fc055970958730d7cb835f816b091b68bfdf93d6ed50086092cea",
      "moonspan_cdr_interfaces/msg/PrimitiveScalars",
      1,
      1,
    )
    .unwrap();
  }

  #[test]
  fn rejects_uppercase_and_wrong_encoding() {
    assert!(
      SchemaKey::new(
        SCHEME_MOONSPAN_SCHEMA_V1,
        "3ABA18EC187625B72E035716E63D060ECE2E68946990BF04F77C93802EB669FD",
        "t",
        1,
        1,
      )
      .is_err()
    );
    assert!(
      SchemaKey::new(
        SCHEME_MOONSPAN_SCHEMA_V1,
        "3aba18ec187625b72e035716e63d060ece2e68946990bf04f77c93802eb669fd",
        "t",
        2,
        1,
      )
      .is_err()
    );
  }
}
