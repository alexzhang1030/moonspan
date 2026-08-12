//! Absolute Phase 1 ceilings for the schema registry builder.
//!
//! Contract: [docs/runtime/generated-types.md](../../../docs/runtime/generated-types.md).

/// Maximum distinct `SchemaKey` rows (`1..=256`).
pub const MAX_REGISTRY_ENTRIES: usize = 256;

/// Maximum source entries in one recursive bundle (`1..=64`).
pub const MAX_SOURCES_PER_BUNDLE: usize = 64;

/// Maximum edges in one bundle dependency graph (`0..=256`).
pub const MAX_DEPENDENCY_EDGES: usize = 256;

/// Maximum UTF-8 bytes of one source entry (`1..=1_048_576`).
pub const MAX_SOURCE_BYTES: usize = 1_048_576;

/// Maximum canonical bundle UTF-8 bytes (`1..=1_048_576`).
pub const MAX_BUNDLE_BYTES: usize = 1_048_576;

/// Maximum `SchemaKey.scheme` length (`1..=64`).
pub const MAX_SCHEME_CHARS: usize = 64;

/// Maximum `SchemaKey.value` length (`1..=128`).
pub const MAX_VALUE_CHARS: usize = 128;

/// Maximum `SchemaKey.type_name` length (`1..=256`).
pub const MAX_TYPE_NAME_CHARS: usize = 256;

/// Maximum lookup `support_row_id` length (`1..=16`).
pub const MAX_SUPPORT_ROW_ID_CHARS: usize = 16;

/// R2WP payload-encoding value for CDR1 (Phase 1 only accepts this).
pub const ENCODING_CDR1: u8 = 1;

/// Phase 1 corpus `schema_generation` value.
pub const PHASE1_SCHEMA_GENERATION: u32 = 1;
