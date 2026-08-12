//! Typed schema-registry faults ([docs/runtime/generated-types.md](../../../docs/runtime/generated-types.md)).

use std::fmt;

/// Stable schema / registry fault codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SchemaErrorCode {
    /// Scheme, value form, encoding, generation, or representation is invalid.
    InvalidSchemaKey,
    /// Required descriptor, identity, provenance, or wire-profile material is missing.
    SchemaUnavailable,
    /// Builder registration conflicts with existing material.
    SchemaConflict,
    /// Absolute Phase 1 registry / input ceiling would be exceeded.
    SchemaBoundsExceeded,
    /// Authoritative input is malformed or fails a join rule.
    SchemaInputInvalid,
    /// Generator `--check` output differs from the committed artifact.
    SchemaGenerationDrift,
}

impl SchemaErrorCode {
    /// Stable string token matching the contract taxonomy.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidSchemaKey => "invalid_schema_key",
            Self::SchemaUnavailable => "schema_unavailable",
            Self::SchemaConflict => "schema_conflict",
            Self::SchemaBoundsExceeded => "schema_bounds_exceeded",
            Self::SchemaInputInvalid => "schema_input_invalid",
            Self::SchemaGenerationDrift => "schema_generation_drift",
        }
    }

    /// R2WP wire error code when this fault blocks channel activation.
    ///
    /// `schema_unavailable` maps to wire code 10; other codes stay local.
    #[must_use]
    pub const fn wire_error_code(self) -> Option<u8> {
        match self {
            Self::SchemaUnavailable => Some(10),
            _ => None,
        }
    }
}

impl fmt::Display for SchemaErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Structured schema-registry fault.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchemaError {
    /// Stable fault code.
    pub code: SchemaErrorCode,
    /// Offending field or limit name when known.
    pub field: Option<&'static str>,
    /// Human-stable diagnostic (no schema source text).
    pub message: String,
    /// Requested size when a bounds check fails.
    pub needed: Option<u64>,
    /// Allowed capacity when a bounds check fails.
    pub remaining: Option<u64>,
}

impl SchemaError {
    #[must_use]
    pub fn new(code: SchemaErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            field: None,
            message: message.into(),
            needed: None,
            remaining: None,
        }
    }

    #[must_use]
    pub fn with_field(mut self, field: &'static str) -> Self {
        self.field = Some(field);
        self
    }

    #[must_use]
    pub fn with_sizes(mut self, needed: u64, remaining: u64) -> Self {
        self.needed = Some(needed);
        self.remaining = Some(remaining);
        self
    }

    #[must_use]
    pub fn invalid_schema_key(message: impl Into<String>) -> Self {
        Self::new(SchemaErrorCode::InvalidSchemaKey, message).with_field("schema_key")
    }

    #[must_use]
    pub fn schema_unavailable(message: impl Into<String>) -> Self {
        Self::new(SchemaErrorCode::SchemaUnavailable, message)
    }

    #[must_use]
    pub fn schema_conflict(message: impl Into<String>) -> Self {
        Self::new(SchemaErrorCode::SchemaConflict, message)
    }

    #[must_use]
    pub fn schema_bounds_exceeded(
        field: &'static str,
        needed: u64,
        remaining: u64,
        message: impl Into<String>,
    ) -> Self {
        Self::new(SchemaErrorCode::SchemaBoundsExceeded, message)
            .with_field(field)
            .with_sizes(needed, remaining)
    }

    #[must_use]
    pub fn schema_input_invalid(message: impl Into<String>) -> Self {
        Self::new(SchemaErrorCode::SchemaInputInvalid, message)
    }
}

impl fmt::Display for SchemaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)?;
        if let Some(field) = self.field {
            write!(f, " ({field})")?;
        }
        Ok(())
    }
}

impl std::error::Error for SchemaError {}
