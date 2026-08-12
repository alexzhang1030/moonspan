//! Opt-in local-dev TLS for WebTransport `serverCertificateHashes` (ADR 0011).
//!
//! Mints short-lived ECDSA P-256 self-signed certificates, rotates before the
//! browser's 14-day validity ceiling, and advertises SHA-256 SPKI hashes only
//! (never the private key).

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as B64;
use rcgen::{CertificateParams, KeyPair, PKCS_ECDSA_P256_SHA256, PublicKeyData};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use time::{Duration as TimeDuration, OffsetDateTime};

/// Browser `serverCertificateHashes` rejects windows longer than 14 days;
/// keep a day of margin for clock skew (ADR 0011).
pub const MAX_LIFETIME: Duration = Duration::from_secs(13 * 24 * 60 * 60);
/// Default local-dev certificate lifetime.
pub const DEFAULT_LIFETIME: Duration = Duration::from_secs(7 * 24 * 60 * 60);
/// Remint when less than this remains before notAfter.
pub const REMINT_REMAINING: Duration = Duration::from_secs(24 * 60 * 60);

/// Public advertisement for `/local-dev/tls` and `/healthz` (no secrets).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TlsAdvertisement {
    pub spki_sha256: [u8; 32],
    pub not_after_unix_secs: u64,
    pub not_before_unix_secs: u64,
    pub previous_spki_sha256: Option<[u8; 32]>,
}

impl TlsAdvertisement {
    /// JSON object for HTTP responses. Never includes key material.
    #[must_use]
    pub fn to_json(&self) -> String {
        let current = B64.encode(self.spki_sha256);
        let mut hashes = format!("{{\"algorithm\":\"sha-256\",\"value\":\"{current}\"}}");
        if let Some(prev) = &self.previous_spki_sha256 {
            let previous = B64.encode(prev);
            hashes.push(',');
            hashes.push_str(&format!("{{\"algorithm\":\"sha-256\",\"value\":\"{previous}\"}}"));
        }
        format!(
            "{{\"active\":true,\"algorithm\":\"ECDSA_P256\",\"spkiSha256\":\"{current}\",\"notBefore\":{},\"notAfter\":{},\"hashes\":[{hashes}]}}",
            self.not_before_unix_secs, self.not_after_unix_secs
        )
    }

    /// True when the JSON body never contains PEM/PKCS private-key markers.
    #[must_use]
    pub fn json_has_no_private_key(json: &str) -> bool {
        let lower = json.to_ascii_lowercase();
        !lower.contains("private")
            && !lower.contains("-----begin")
            && !lower.contains("pkcs8")
            && !lower.contains("privatekey")
    }
}

struct Material {
    cert_der: Vec<u8>,
    key_der_pkcs8: Vec<u8>,
    cert_pem: String,
    key_pem: String,
    advertisement: TlsAdvertisement,
}

/// Process-local auto-minted TLS material (mutex for remint).
pub struct LocalDevTls {
    lifetime: Duration,
    remint_remaining: Duration,
    inner: Mutex<Material>,
}

impl LocalDevTls {
    /// Mint the first certificate. `lifetime` is capped at [`MAX_LIFETIME`].
    pub fn mint(lifetime: Duration) -> Result<Self, String> {
        let lifetime = lifetime.min(MAX_LIFETIME);
        if lifetime.is_zero() {
            return Err("local-dev TLS lifetime must be > 0".to_owned());
        }
        let now = system_now();
        let material = mint_material(now, lifetime, None)?;
        Ok(Self { lifetime, remint_remaining: REMINT_REMAINING, inner: Mutex::new(material) })
    }

    /// Default 7-day lifetime.
    pub fn mint_default() -> Result<Self, String> {
        Self::mint(DEFAULT_LIFETIME)
    }

    /// Ensure the active cert has ≥ remint threshold remaining; remint if not.
    pub fn ensure_fresh(&self) -> Result<TlsAdvertisement, String> {
        self.ensure_fresh_at(system_now())
    }

    /// Testable remint decision at an explicit instant (`secs` since Unix epoch).
    pub fn ensure_fresh_at(&self, now_unix_secs: u64) -> Result<TlsAdvertisement, String> {
        let mut guard = self.inner.lock().map_err(|_| "local-dev TLS lock poisoned".to_owned())?;
        let remaining = guard.advertisement.not_after_unix_secs.saturating_sub(now_unix_secs);
        if Duration::from_secs(remaining) < self.remint_remaining {
            let previous = Some(guard.advertisement.spki_sha256);
            *guard = mint_material(now_unix_secs, self.lifetime, previous)?;
        }
        Ok(guard.advertisement.clone())
    }

    /// Current advertisement without reminting.
    pub fn advertisement(&self) -> Result<TlsAdvertisement, String> {
        let guard = self.inner.lock().map_err(|_| "local-dev TLS lock poisoned".to_owned())?;
        Ok(guard.advertisement.clone())
    }

    /// PEM material for a WebTransport/`wtransport` Identity (stays in-process).
    pub fn pem_pair(&self) -> Result<(String, String), String> {
        let guard = self.inner.lock().map_err(|_| "local-dev TLS lock poisoned".to_owned())?;
        Ok((guard.cert_pem.clone(), guard.key_pem.clone()))
    }

    /// DER cert + PKCS#8 key for constructing a `wtransport::Identity`.
    pub fn der_pair(&self) -> Result<(Vec<u8>, Vec<u8>), String> {
        let guard = self.inner.lock().map_err(|_| "local-dev TLS lock poisoned".to_owned())?;
        Ok((guard.cert_der.clone(), guard.key_der_pkcs8.clone()))
    }
}

fn system_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn mint_material(
    now_unix_secs: u64,
    lifetime: Duration,
    previous_spki_sha256: Option<[u8; 32]>,
) -> Result<Material, String> {
    let lifetime = lifetime.min(MAX_LIFETIME);
    let not_before = unix_to_offset(now_unix_secs)?;
    let not_after = not_before + lifetime_as_time(lifetime)?;
    let window = (not_after - not_before)
        .whole_seconds()
        .try_into()
        .map_err(|_| "lifetime overflow".to_owned())?;
    if Duration::from_secs(window) > MAX_LIFETIME {
        return Err("local-dev TLS lifetime exceeds 13-day ceiling".to_owned());
    }

    let mut params = CertificateParams::new(vec![
        "localhost".to_owned(),
        "127.0.0.1".to_owned(),
        "::1".to_owned(),
    ])
    .map_err(|e| e.to_string())?;
    params.not_before = not_before;
    params.not_after = not_after;

    let key = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256).map_err(|e| e.to_string())?;
    let cert = params.self_signed(&key).map_err(|e| e.to_string())?;
    let spki = key.subject_public_key_info();
    let digest = Sha256::digest(&spki);
    let mut spki_sha256 = [0u8; 32];
    spki_sha256.copy_from_slice(&digest);

    let not_after_unix_secs = offset_to_unix(not_after)?;
    let not_before_unix_secs = offset_to_unix(not_before)?;

    Ok(Material {
        cert_der: cert.der().as_ref().to_vec(),
        key_der_pkcs8: key.serialize_der(),
        cert_pem: cert.pem(),
        key_pem: key.serialize_pem(),
        advertisement: TlsAdvertisement {
            spki_sha256,
            not_after_unix_secs,
            not_before_unix_secs,
            previous_spki_sha256,
        },
    })
}

fn lifetime_as_time(lifetime: Duration) -> Result<TimeDuration, String> {
    TimeDuration::try_from(lifetime).map_err(|e| e.to_string())
}

fn unix_to_offset(secs: u64) -> Result<OffsetDateTime, String> {
    let secs_i64 = i64::try_from(secs).map_err(|_| "unix time out of range".to_owned())?;
    OffsetDateTime::from_unix_timestamp(secs_i64).map_err(|e| e.to_string())
}

fn offset_to_unix(t: OffsetDateTime) -> Result<u64, String> {
    u64::try_from(t.unix_timestamp()).map_err(|_| "negative unix time".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mint_uses_ecdsa_p256_and_default_lifetime() {
        let tls = LocalDevTls::mint_default().expect("mint");
        let adv = tls.advertisement().expect("adv");
        let window = adv.not_after_unix_secs - adv.not_before_unix_secs;
        assert_eq!(window, DEFAULT_LIFETIME.as_secs());
        assert!(window <= MAX_LIFETIME.as_secs());
        assert_eq!(adv.spki_sha256.len(), 32);
        assert!(adv.previous_spki_sha256.is_none());
    }

    #[test]
    fn lifetime_capped_at_thirteen_days() {
        let tls = LocalDevTls::mint(Duration::from_secs(30 * 24 * 60 * 60)).expect("mint");
        let adv = tls.advertisement().expect("adv");
        let window = adv.not_after_unix_secs - adv.not_before_unix_secs;
        assert_eq!(window, MAX_LIFETIME.as_secs());
    }

    #[test]
    fn remints_when_less_than_24h_remain_and_keeps_previous_hash() {
        let tls = LocalDevTls::mint(Duration::from_secs(2 * 24 * 60 * 60)).expect("mint");
        let first = tls.advertisement().expect("first");
        // Advance to 23h before notAfter.
        let near_expiry = first.not_after_unix_secs - (23 * 60 * 60);
        let second = tls.ensure_fresh_at(near_expiry).expect("remint");
        assert_ne!(first.spki_sha256, second.spki_sha256);
        assert_eq!(second.previous_spki_sha256, Some(first.spki_sha256));
        let window = second.not_after_unix_secs - second.not_before_unix_secs;
        assert_eq!(window, Duration::from_secs(2 * 24 * 60 * 60).as_secs());
    }

    #[test]
    fn does_not_remint_when_more_than_24h_remain() {
        let tls = LocalDevTls::mint_default().expect("mint");
        let first = tls.advertisement().expect("first");
        let later = first.not_before_unix_secs + 60;
        let second = tls.ensure_fresh_at(later).expect("fresh");
        assert_eq!(first.spki_sha256, second.spki_sha256);
        assert!(second.previous_spki_sha256.is_none());
    }

    #[test]
    fn advertisement_json_never_includes_private_key() {
        let tls = LocalDevTls::mint_default().expect("mint");
        let json = tls.advertisement().expect("adv").to_json();
        assert!(json.contains("spkiSha256"));
        assert!(json.contains("hashes"));
        assert!(TlsAdvertisement::json_has_no_private_key(&json));
        assert!(!json.contains("BEGIN"));
        // Private material exists in-process but must not appear in JSON.
        let (_cert, key) = tls.pem_pair().expect("pem");
        assert!(key.contains("PRIVATE KEY"));
        assert!(!json.contains(&key));
    }

    #[test]
    fn spki_hash_is_sha256_of_subject_public_key_info() {
        let tls = LocalDevTls::mint_default().expect("mint");
        let (cert_pem, key_pem) = tls.pem_pair().expect("pem");
        let key = KeyPair::from_pem(&key_pem).expect("parse key");
        let spki = key.subject_public_key_info();
        let expected = Sha256::digest(&spki);
        let adv = tls.advertisement().expect("adv");
        assert_eq!(&adv.spki_sha256[..], &expected[..]);
        // Cert PEM is available for WT Identity construction.
        assert!(cert_pem.starts_with("-----BEGIN CERTIFICATE-----"));
    }
}
