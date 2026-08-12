//! Dual-scheme Phase 1 schema registry: builder, freeze, and lookup.
//!
//! Contract: [docs/runtime/generated-types.md](../../../docs/runtime/generated-types.md).
//!
//! Embedded metadata under `rclweb/generated/metadata/` is compile-time loaded via
//! `include_str!`. Schema *exchange* (SchemaRequest/Response) stays lightly parked
//! in the session SM; this registry is for local resolve before channel activation.

use super::error::{SchemaError, SchemaErrorCode};
use super::key::{SCHEME_RCLWEB_SCHEMA_V1, SCHEME_REP2011_RIHS, SchemaKey, validate_scheme_value};
use super::limits::{
  ENCODING_CDR1, MAX_REGISTRY_ENTRIES, MAX_SUPPORT_ROW_ID_CHARS, MAX_TYPE_NAME_CHARS,
  PHASE1_SCHEMA_GENERATION,
};
use crate::cdr::{REPRESENTATION_CDR_BE, REPRESENTATION_CDR_LE};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::OnceLock;

const DESCRIPTORS_JSON: &str = include_str!("../../generated/metadata/descriptors.json");
const IDENTITIES_JSON: &str = include_str!("../../generated/metadata/identities.json");
const WIRE_PROFILES_JSON: &str = include_str!("../../generated/metadata/wire_profiles.json");
const PROVENANCE_JSON: &str = include_str!("../../generated/metadata/provenance.json");

/// CDR1 encapsulation / endian on the wire (matches [`crate::cdr`] representation ids).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u16)]
pub enum CdrRepresentation {
  /// CDR1 big-endian (`0x0000`).
  Be = REPRESENTATION_CDR_BE,
  /// CDR1 little-endian (`0x0001`).
  Le = REPRESENTATION_CDR_LE,
}

impl CdrRepresentation {
  #[must_use]
  pub const fn as_u16(self) -> u16 {
    self as u16
  }

  pub fn from_u16(value: u16) -> Result<Self, SchemaError> {
    match value {
      REPRESENTATION_CDR_LE => Ok(Self::Le),
      REPRESENTATION_CDR_BE => Ok(Self::Be),
      other => Err(
        SchemaError::invalid_schema_key(format!("unknown cdr_representation 0x{other:04x}"))
          .with_field("cdr_representation"),
      ),
    }
  }
}

/// Successful registry lookup: descriptor handle plus expected top-level zero-tail.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LookupResult {
  pub type_name: String,
  pub descriptor_id: String,
  pub zero_tail_bytes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DescriptorRow {
  descriptor_id: String,
  type_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct IdentityRow {
  key: SchemaKey,
  descriptor_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WireProfileRow {
  type_name: String,
  support_row_id: String,
  cdr_representation: CdrRepresentation,
  zero_tail_bytes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProvenanceRow {
  rihs: String,
  bundle_sha256: String,
  type_name: String,
}

/// Mutable Phase 1 registry builder. Freeze into [`SchemaRegistry`] before lookup.
#[derive(Debug, Default)]
pub struct SchemaRegistryBuilder {
  descriptors: BTreeMap<String, DescriptorRow>,
  identities: BTreeMap<(String, String), IdentityRow>,
  /// Keyed by (type_name, support_row_id, representation u16).
  wire_profiles: BTreeMap<(String, String, u16), WireProfileRow>,
  /// Keyed by RIHS value.
  provenance: BTreeMap<String, ProvenanceRow>,
}

impl SchemaRegistryBuilder {
  #[must_use]
  pub fn new() -> Self {
    Self::default()
  }

  /// Register `descriptor_id → type_name`. Identical re-registration is idempotent.
  pub fn register_descriptor(
    &mut self,
    descriptor_id: impl Into<String>,
    type_name: impl Into<String>,
  ) -> Result<(), SchemaError> {
    let descriptor_id = descriptor_id.into();
    let type_name = type_name.into();
    validate_type_name_len(&type_name)?;
    if descriptor_id.is_empty() {
      return Err(SchemaError::schema_input_invalid("descriptor_id must be non-empty"));
    }
    let row = DescriptorRow { descriptor_id: descriptor_id.clone(), type_name: type_name.clone() };
    if let Some(existing) = self.descriptors.get(&descriptor_id) {
      if existing.type_name != type_name {
        return Err(SchemaError::schema_conflict(format!(
          "descriptor `{descriptor_id}` already maps to `{}`",
          existing.type_name
        )));
      }
      return Ok(());
    }
    if self.descriptors.len() >= MAX_REGISTRY_ENTRIES {
      return Err(SchemaError::schema_bounds_exceeded(
        "max_registry_entries",
        (self.descriptors.len() + 1) as u64,
        MAX_REGISTRY_ENTRIES as u64,
        "descriptor registration would exceed max_registry_entries",
      ));
    }
    self.descriptors.insert(descriptor_id, row);
    let _ = type_name;
    Ok(())
  }

  /// Register identity → descriptor_id. Identical re-registration is idempotent.
  pub fn register_identity(
    &mut self,
    key: SchemaKey,
    descriptor_id: impl Into<String>,
  ) -> Result<(), SchemaError> {
    key.validate()?;
    let descriptor_id = descriptor_id.into();
    if !self.descriptors.contains_key(&descriptor_id) {
      return Err(SchemaError::schema_unavailable(format!(
        "descriptor `{descriptor_id}` is not registered"
      )));
    }
    let map_key = (key.scheme.clone(), key.value.clone());
    let row = IdentityRow { key: key.clone(), descriptor_id: descriptor_id.clone() };
    if let Some(existing) = self.identities.get(&map_key) {
      if existing.descriptor_id != descriptor_id || existing.key != key {
        return Err(SchemaError::schema_conflict(format!(
          "identity {}:{} already registered with conflicting material",
          key.scheme, key.value
        )));
      }
      return Ok(());
    }
    if self.identities.len() >= MAX_REGISTRY_ENTRIES {
      return Err(SchemaError::schema_bounds_exceeded(
        "max_registry_entries",
        (self.identities.len() + 1) as u64,
        MAX_REGISTRY_ENTRIES as u64,
        "identity registration would exceed max_registry_entries",
      ));
    }
    self.identities.insert(map_key, row);
    Ok(())
  }

  /// Register wire-profile triple → expected zero-tail. Identical re-registration is idempotent.
  pub fn register_wire_profile(
    &mut self,
    type_name: impl Into<String>,
    support_row_id: impl Into<String>,
    cdr_representation: CdrRepresentation,
    zero_tail_bytes: usize,
  ) -> Result<(), SchemaError> {
    let type_name = type_name.into();
    let support_row_id = support_row_id.into();
    validate_type_name_len(&type_name)?;
    validate_support_row_id(&support_row_id)?;
    if !(zero_tail_bytes == 0 || zero_tail_bytes == 4 || zero_tail_bytes == 12) {
      // Phase 1 evidence uses only these; still accept other usize if identical re-reg.
      // Conflicting non-matching values still conflict below.
    }
    let map_key = (type_name.clone(), support_row_id.clone(), cdr_representation.as_u16());
    let row = WireProfileRow {
      type_name: type_name.clone(),
      support_row_id,
      cdr_representation,
      zero_tail_bytes,
    };
    if let Some(existing) = self.wire_profiles.get(&map_key) {
      if existing.zero_tail_bytes != zero_tail_bytes {
        return Err(SchemaError::schema_conflict(format!(
          "wire profile for `{type_name}` already has zero_tail {}",
          existing.zero_tail_bytes
        )));
      }
      return Ok(());
    }
    self.wire_profiles.insert(map_key, row);
    Ok(())
  }

  /// Register Jazzy RIHS → bundle provenance. Identical re-registration is idempotent.
  pub fn register_provenance(
    &mut self,
    rihs: impl Into<String>,
    bundle_sha256: impl Into<String>,
    type_name: impl Into<String>,
  ) -> Result<(), SchemaError> {
    let rihs = rihs.into();
    let bundle_sha256 = bundle_sha256.into();
    let type_name = type_name.into();
    validate_scheme_value(SCHEME_REP2011_RIHS, &rihs)?;
    validate_scheme_value(SCHEME_RCLWEB_SCHEMA_V1, &bundle_sha256)?;
    validate_type_name_len(&type_name)?;
    let row = ProvenanceRow {
      rihs: rihs.clone(),
      bundle_sha256: bundle_sha256.clone(),
      type_name: type_name.clone(),
    };
    if let Some(existing) = self.provenance.get(&rihs) {
      if existing.bundle_sha256 != bundle_sha256 || existing.type_name != type_name {
        return Err(SchemaError::schema_conflict(format!(
          "provenance for `{rihs}` already maps to conflicting material"
        )));
      }
      return Ok(());
    }
    self.provenance.insert(rihs, row);
    Ok(())
  }

  /// Freeze into an immutable registry.
  pub fn freeze(self) -> Result<SchemaRegistry, SchemaError> {
    if self.descriptors.is_empty() {
      return Err(SchemaError::schema_input_invalid("cannot freeze an empty descriptor set"));
    }
    Ok(SchemaRegistry {
      descriptors: self.descriptors,
      identities: self.identities,
      wire_profiles: self.wire_profiles,
      provenance: self.provenance,
    })
  }
}

/// Immutable Phase 1 schema registry.
#[derive(Debug, Clone)]
pub struct SchemaRegistry {
  descriptors: BTreeMap<String, DescriptorRow>,
  identities: BTreeMap<(String, String), IdentityRow>,
  wire_profiles: BTreeMap<(String, String, u16), WireProfileRow>,
  provenance: BTreeMap<String, ProvenanceRow>,
}

impl SchemaRegistry {
  /// Load embedded Phase 1 metadata JSON and freeze.
  pub fn phase1() -> Result<Self, SchemaError> {
    let mut builder = SchemaRegistryBuilder::new();
    load_descriptors(&mut builder)?;
    load_identities(&mut builder)?;
    load_wire_profiles(&mut builder)?;
    load_provenance(&mut builder)?;
    builder.freeze()
  }

  /// Cached Phase 1 registry (`OnceLock`). Panics only if embedded metadata is corrupt
  /// (committed artifacts must load); prefer [`Self::phase1`] in fallible contexts.
  pub fn phase1_cached() -> &'static SchemaRegistry {
    static REGISTRY: OnceLock<SchemaRegistry> = OnceLock::new();
    REGISTRY
      .get_or_init(|| SchemaRegistry::phase1().expect("embedded Phase 1 schema metadata must load"))
  }

  /// Number of registered identities (Phase 1 expects 18).
  #[must_use]
  pub fn identity_count(&self) -> usize {
    self.identities.len()
  }

  /// Number of registered descriptors (Phase 1 expects 9).
  #[must_use]
  pub fn descriptor_count(&self) -> usize {
    self.descriptors.len()
  }

  /// Resolve `SchemaKey` + support row + CDR representation to descriptor and zero-tail.
  pub fn lookup(
    &self,
    key: &SchemaKey,
    support_row_id: &str,
    cdr_representation: CdrRepresentation,
  ) -> Result<LookupResult, SchemaError> {
    key.validate()?;
    validate_support_row_id(support_row_id)?;

    let identity =
      self.identities.get(&(key.scheme.clone(), key.value.clone())).ok_or_else(|| {
        SchemaError::schema_unavailable(format!("no identity for {}:{}", key.scheme, key.value))
      })?;
    if identity.key.type_name != key.type_name
      || identity.key.encoding != key.encoding
      || identity.key.schema_generation != key.schema_generation
    {
      return Err(SchemaError::schema_unavailable(
        "SchemaKey fields do not match registered identity material",
      ));
    }
    let descriptor = self.descriptors.get(&identity.descriptor_id).ok_or_else(|| {
      SchemaError::schema_unavailable(format!("descriptor `{}` missing", identity.descriptor_id))
    })?;
    if descriptor.type_name != key.type_name {
      return Err(SchemaError::schema_unavailable("descriptor type_name does not match SchemaKey"));
    }
    let profile = self
      .wire_profiles
      .get(&(key.type_name.clone(), support_row_id.to_owned(), cdr_representation.as_u16()))
      .ok_or_else(|| {
        SchemaError::schema_unavailable(format!(
          "no wire profile for {} / {} / 0x{:04x}",
          key.type_name,
          support_row_id,
          cdr_representation.as_u16()
        ))
      })?;

    Ok(LookupResult {
      type_name: descriptor.type_name.clone(),
      descriptor_id: descriptor.descriptor_id.clone(),
      zero_tail_bytes: profile.zero_tail_bytes,
    })
  }

  /// Look up the identity value for a Phase 1 root under the given scheme.
  pub fn identity_value_for_type(
    &self,
    type_name: &str,
    scheme: &str,
  ) -> Result<&str, SchemaError> {
    validate_type_name_len(type_name)?;
    for row in self.identities.values() {
      if row.key.type_name == type_name && row.key.scheme == scheme {
        return Ok(row.key.value.as_str());
      }
    }
    Err(SchemaError::schema_unavailable(format!("no {scheme} identity for `{type_name}`")))
  }

  /// Whether `type_name` is one of the nine Phase 1 registry roots.
  #[must_use]
  pub fn is_phase1_root(&self, type_name: &str) -> bool {
    self.descriptors.values().any(|d| d.type_name == type_name)
  }

  /// Provenance row for a RIHS value, if present.
  #[must_use]
  pub fn provenance_for_rihs(&self, rihs: &str) -> Option<(&str, &str)> {
    self.provenance.get(rihs).map(|p| (p.bundle_sha256.as_str(), p.type_name.as_str()))
  }
}

fn validate_type_name_len(type_name: &str) -> Result<(), SchemaError> {
  let n = type_name.chars().count();
  if type_name.is_empty() || n > MAX_TYPE_NAME_CHARS {
    return Err(
      SchemaError::invalid_schema_key(format!(
        "type_name length {n} outside 1..={MAX_TYPE_NAME_CHARS}"
      ))
      .with_field("type_name"),
    );
  }
  Ok(())
}

fn validate_support_row_id(support_row_id: &str) -> Result<(), SchemaError> {
  let n = support_row_id.chars().count();
  if support_row_id.is_empty() || n > MAX_SUPPORT_ROW_ID_CHARS {
    return Err(
      SchemaError::invalid_schema_key(format!(
        "support_row_id length {n} outside 1..={MAX_SUPPORT_ROW_ID_CHARS}"
      ))
      .with_field("support_row_id"),
    );
  }
  Ok(())
}

#[derive(Debug, Deserialize)]
struct DescriptorsFile {
  roots: Vec<DescriptorJson>,
}

#[derive(Debug, Deserialize)]
struct DescriptorJson {
  descriptor_id: String,
  type_name: String,
  #[serde(default)]
  kind: Option<String>,
  #[serde(default)]
  bundle_sha256: Option<String>,
  #[serde(default)]
  dependency_type_names: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct IdentitiesFile {
  identities: Vec<IdentityJson>,
}

#[derive(Debug, Deserialize)]
struct IdentityJson {
  scheme: String,
  value: String,
  type_name: String,
  encoding: u8,
  schema_generation: u32,
  descriptor_id: String,
}

#[derive(Debug, Deserialize)]
struct WireProfilesFile {
  profiles: Vec<WireProfileJson>,
}

#[derive(Debug, Deserialize)]
struct WireProfileJson {
  type_name: String,
  support_row_id: String,
  /// `"CDR_LE"` / `"CDR_BE"` (generator) or numeric `0` / `1`.
  cdr_representation: CdrRepresentationJson,
  zero_tail_bytes: usize,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum CdrRepresentationJson {
  Name(String),
  Number(u16),
}

impl CdrRepresentationJson {
  fn into_rep(self) -> Result<CdrRepresentation, SchemaError> {
    match self {
      Self::Name(s) => match s.as_str() {
        "CDR_LE" => Ok(CdrRepresentation::Le),
        "CDR_BE" => Ok(CdrRepresentation::Be),
        other => Err(
          SchemaError::invalid_schema_key(format!("unknown cdr_representation `{other}`"))
            .with_field("cdr_representation"),
        ),
      },
      Self::Number(n) => CdrRepresentation::from_u16(n),
    }
  }
}

#[derive(Debug, Deserialize)]
struct ProvenanceFile {
  mappings: Vec<ProvenanceJson>,
}

#[derive(Debug, Deserialize)]
struct ProvenanceJson {
  rihs: String,
  bundle_sha256: String,
  type_name: String,
}

fn load_descriptors(builder: &mut SchemaRegistryBuilder) -> Result<(), SchemaError> {
  let file: DescriptorsFile = serde_json::from_str(DESCRIPTORS_JSON).map_err(|e| {
    SchemaError::schema_input_invalid(format!("descriptors.json parse failed: {e}"))
  })?;
  for row in file.roots {
    let _ = (row.kind, row.bundle_sha256, row.dependency_type_names);
    builder.register_descriptor(row.descriptor_id, row.type_name)?;
  }
  Ok(())
}

fn load_identities(builder: &mut SchemaRegistryBuilder) -> Result<(), SchemaError> {
  let file: IdentitiesFile = serde_json::from_str(IDENTITIES_JSON)
    .map_err(|e| SchemaError::schema_input_invalid(format!("identities.json parse failed: {e}")))?;
  for row in file.identities {
    let key =
      SchemaKey::new(row.scheme, row.value, row.type_name, row.encoding, row.schema_generation)?;
    builder.register_identity(key, row.descriptor_id)?;
  }
  Ok(())
}

fn load_wire_profiles(builder: &mut SchemaRegistryBuilder) -> Result<(), SchemaError> {
  let file: WireProfilesFile = serde_json::from_str(WIRE_PROFILES_JSON).map_err(|e| {
    SchemaError::schema_input_invalid(format!("wire_profiles.json parse failed: {e}"))
  })?;
  for row in file.profiles {
    let rep = row.cdr_representation.into_rep()?;
    builder.register_wire_profile(row.type_name, row.support_row_id, rep, row.zero_tail_bytes)?;
  }
  Ok(())
}

fn load_provenance(builder: &mut SchemaRegistryBuilder) -> Result<(), SchemaError> {
  let file: ProvenanceFile = serde_json::from_str(PROVENANCE_JSON)
    .map_err(|e| SchemaError::schema_input_invalid(format!("provenance.json parse failed: {e}")))?;
  for row in file.mappings {
    builder.register_provenance(row.rihs, row.bundle_sha256, row.type_name)?;
  }
  Ok(())
}

/// Resolve scheme+value for OpenChannel when `type_name` is a Phase 1 root.
///
/// Defaults to `rep2011-rihs` (J-FT). Returns `None` for non-roots (e.g. `std_msgs/msg/String`).
pub fn schema_identity_for_type(
  type_name: &str,
  scheme: &str,
) -> Result<Option<(String, String)>, SchemaError> {
  let registry = SchemaRegistry::phase1_cached();
  if !registry.is_phase1_root(type_name) {
    return Ok(None);
  }
  let value = registry.identity_value_for_type(type_name, scheme)?;
  Ok(Some((scheme.to_owned(), value.to_owned())))
}

/// Look up a Phase 1 root before channel activation (J-FT + CDR_LE by default for OpenChannel).
pub fn lookup_phase1_root_for_open(
  type_name: &str,
  support_row_id: &str,
  cdr_representation: CdrRepresentation,
) -> Result<Option<(LookupResult, SchemaKey)>, SchemaError> {
  let registry = SchemaRegistry::phase1_cached();
  if !registry.is_phase1_root(type_name) {
    return Ok(None);
  }
  // Prefer RIHS on Jazzy rows; bundle digest on Humble rows.
  let scheme =
    if support_row_id.starts_with('J') { SCHEME_REP2011_RIHS } else { SCHEME_RCLWEB_SCHEMA_V1 };
  let value = registry.identity_value_for_type(type_name, scheme)?.to_owned();
  let key = SchemaKey::new(scheme, value, type_name, ENCODING_CDR1, PHASE1_SCHEMA_GENERATION)?;
  let result = registry.lookup(&key, support_row_id, cdr_representation)?;
  Ok(Some((result, key)))
}

/// Wire error code for `schema_unavailable` (R2WP).
pub const WIRE_ERROR_SCHEMA_UNAVAILABLE: u8 = 10;

impl From<SchemaErrorCode> for Option<u8> {
  fn from(code: SchemaErrorCode) -> Self {
    code.wire_error_code()
  }
}
