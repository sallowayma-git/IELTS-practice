//! Minisign verification with the Tauri updater key format.
//!
//! The channel manifest is signed with the same key as the app installers
//! (`tauri signer sign`), so a release has exactly one trust root: the
//! updater public key compiled into the app. Every download source is then
//! untrusted transport; a mirror can delay an update but never alter one.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};

use crate::OtaError;

/// `pubkey` and `signature` are what Tauri stores: base64 of the minisign
/// text files (`tauri.conf.json > plugins.updater.pubkey`, `*.sig`).
pub fn verify_signature(data: &[u8], signature: &str, pubkey: &str) -> Result<(), OtaError> {
    let public_key = PublicKey::decode(&base64_text(pubkey)?)
        .map_err(|error| OtaError::Signature(format!("public key: {error}")))?;
    let signature = Signature::decode(&base64_text(signature)?)
        .map_err(|error| OtaError::Signature(format!("signature: {error}")))?;
    public_key
        .verify(data, &signature, false)
        .map_err(|error| OtaError::Signature(error.to_string()))
}

fn base64_text(value: &str) -> Result<String, OtaError> {
    let bytes = STANDARD
        .decode(value.trim())
        .map_err(|error| OtaError::Signature(format!("base64: {error}")))?;
    String::from_utf8(bytes).map_err(|_| OtaError::Signature("not UTF-8".into()))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    // Test-only key pair generated with `tauri signer generate`; the private
    // half is not kept anywhere. Never use it outside tests.
    pub(crate) const TEST_PUBKEY: &str = include_str!("../tests/fixtures/test.pub");
    pub(crate) const TEST_MANIFEST: &[u8] = include_bytes!("../tests/fixtures/ota.json");
    pub(crate) const TEST_MANIFEST_SIG: &str = include_str!("../tests/fixtures/ota.json.sig");

    #[test]
    fn accepts_the_signed_bytes() {
        verify_signature(TEST_MANIFEST, TEST_MANIFEST_SIG, TEST_PUBKEY).unwrap();
    }

    #[test]
    fn rejects_tampered_bytes_and_garbage() {
        let mut tampered = TEST_MANIFEST.to_vec();
        tampered[10] ^= 1;
        assert!(verify_signature(&tampered, TEST_MANIFEST_SIG, TEST_PUBKEY).is_err());
        assert!(verify_signature(TEST_MANIFEST, "not base64!", TEST_PUBKEY).is_err());
        assert!(verify_signature(TEST_MANIFEST, TEST_MANIFEST_SIG, "").is_err());
    }
}
