//! The signed channel manifest (`ota.json`).
//!
//! One file describes every update tier, so the client makes one signed
//! request and then decides locally:
//!
//! ```json
//! {
//!   "schemaVersion": 1,
//!   "channel": "stable",
//!   "publishedAt": "2026-11-01T00:00:00Z",
//!   "app": {
//!     "version": "0.2.0",
//!     "minOtaVersion": "0.1.0",
//!     "minSupportedVersion": "0.1.0",
//!     "notes": "...",
//!     "downloadPages": [
//!       {"label": "GitHub", "url": "https://github.com/.../releases/latest"},
//!       {"label": "国内镜像", "url": "https://mirror.example.cn/ielts/"}
//!     ]
//!   },
//!   "content": [
//!     { "id": "reading", "version": 202611021530, "minAppVersion": "0.1.0",
//!       "file": "content-reading-202611021530.tar.gz", "sha256": "...", "size": 123 }
//!   ]
//! }
//! ```
//!
//! Unknown fields are ignored so an old client keeps reading a newer manifest.

use std::collections::HashSet;

use semver::Version;
use serde::{Deserialize, Serialize};

use crate::OtaError;

pub const SCHEMA_VERSION: u32 = 1;
/// A manifest is a few KiB; anything larger is not ours.
pub const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
/// Hard ceiling for one content pack download.
pub const MAX_PACK_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OtaManifest {
    pub schema_version: u32,
    pub channel: String,
    #[serde(default)]
    pub published_at: Option<String>,
    pub app: AppRelease,
    #[serde(default)]
    pub content: Vec<ContentPack>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRelease {
    /// Latest shipped application version.
    pub version: String,
    /// Installer signatures copied from the verified release's latest.json.
    /// Binding them into this signed policy prevents stale/mixed metadata
    /// from selecting a different installer under an allowed version label.
    #[serde(default)]
    pub installer_signatures: Vec<String>,
    /// Installs older than this cannot reach `version` in place (the release
    /// restructured something an in-place installer cannot migrate): the
    /// client guides the user to download and reinstall instead.
    #[serde(default)]
    pub min_ota_version: Option<String>,
    /// Installs older than this must update before they keep working.
    #[serde(default)]
    pub min_supported_version: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    /// Human download pages for the reinstall tier, in display order.
    #[serde(default)]
    pub download_pages: Vec<DownloadPage>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadPage {
    pub label: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentPack {
    /// Pack slot, e.g. `reading` or `writing-topics`.
    pub id: String,
    /// Monotonic pack version: UTC `YYYYMMDDHHMM`, the same clock the
    /// release build stamps into bundled `ota-pack.json` markers.
    pub version: u64,
    #[serde(default)]
    pub min_app_version: Option<String>,
    /// Bare file name of the `.tar.gz`, resolved against every source.
    pub file: String,
    pub sha256: String,
    pub size: u64,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

pub fn parse_manifest(bytes: &[u8]) -> Result<OtaManifest, OtaError> {
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(OtaError::Manifest("manifest is too large".into()));
    }
    let manifest: OtaManifest = serde_json::from_slice(bytes)
        .map_err(|error| OtaError::Manifest(format!("invalid JSON: {error}")))?;
    validate(&manifest)?;
    Ok(manifest)
}

fn validate(manifest: &OtaManifest) -> Result<(), OtaError> {
    if manifest.schema_version != SCHEMA_VERSION {
        return Err(OtaError::Manifest(format!(
            "unsupported schema version {}",
            manifest.schema_version
        )));
    }
    let app = &manifest.app;
    parse_version(&app.version)?;
    for version in [&app.min_ota_version, &app.min_supported_version]
        .into_iter()
        .flatten()
    {
        parse_version(version)?;
    }
    for page in &app.download_pages {
        require_https(&page.url)?;
    }
    let mut ids = HashSet::new();
    for pack in &manifest.content {
        validate_pack(pack)?;
        if !ids.insert(pack.id.as_str()) {
            return Err(OtaError::Manifest(format!(
                "duplicate content pack {}",
                pack.id
            )));
        }
    }
    Ok(())
}

fn validate_pack(pack: &ContentPack) -> Result<(), OtaError> {
    if !is_safe_name(&pack.id) {
        return Err(OtaError::Manifest(format!(
            "invalid content id {:?}",
            pack.id
        )));
    }
    if !is_safe_name(&pack.file) || !pack.file.ends_with(".tar.gz") {
        return Err(OtaError::Manifest(format!(
            "invalid content file {:?}",
            pack.file
        )));
    }
    if !is_sha256_hex(&pack.sha256) {
        return Err(OtaError::Manifest(format!(
            "invalid sha256 for {}",
            pack.id
        )));
    }
    if pack.size == 0 || pack.size > MAX_PACK_BYTES {
        return Err(OtaError::Manifest(format!("invalid size for {}", pack.id)));
    }
    if let Some(version) = &pack.min_app_version {
        parse_version(version)?;
    }
    Ok(())
}

pub fn parse_version(value: &str) -> Result<Version, OtaError> {
    Version::parse(value.trim().trim_start_matches('v'))
        .map_err(|error| OtaError::Manifest(format!("invalid version {value:?}: {error}")))
}

/// File and slot names travel into URLs and directory names: keep them boring.
pub fn is_safe_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && !value.starts_with('.')
        && !value.contains("..")
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

pub fn require_https(url: &str) -> Result<(), OtaError> {
    let rest = url
        .strip_prefix("https://")
        .ok_or_else(|| OtaError::Manifest(format!("URL must be https: {url}")))?;
    let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if host.is_empty() || host.contains('@') || url.chars().any(char::is_whitespace) {
        return Err(OtaError::Manifest(format!("invalid URL: {url}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    pub(crate) fn sample() -> serde_json::Value {
        json!({
            "schemaVersion": 1,
            "channel": "stable",
            "app": {"version": "0.2.0", "minOtaVersion": "0.1.0", "downloadPages": [{"label": "d", "url": "https://example.com/d"}], "futureField": true},
            "content": [{
                "id": "reading", "version": 202611021530_u64, "minAppVersion": "0.1.0",
                "file": "content-reading-202611021530.tar.gz",
                "sha256": "a".repeat(64), "size": 10
            }]
        })
    }

    #[test]
    fn parses_and_ignores_unknown_fields() {
        let manifest = parse_manifest(sample().to_string().as_bytes()).unwrap();
        assert_eq!(manifest.app.version, "0.2.0");
        assert_eq!(manifest.content[0].version, 202611021530_u64);
    }

    #[test]
    fn rejects_unsafe_names_hashes_and_versions() {
        let cases: Vec<(&str, serde_json::Value)> = vec![
            ("/content/0/file", json!("../evil.tar.gz")),
            ("/content/0/file", json!("pack.zip")),
            ("/content/0/id", json!("a/b")),
            ("/content/0/sha256", json!("ABC")),
            ("/content/0/size", json!(0)),
            ("/app/version", json!("latest")),
            ("/schemaVersion", json!(2)),
            ("/app/downloadPages/0/url", json!("http://example.com")),
        ];
        for (pointer, value) in cases {
            let mut doc = sample();
            *doc.pointer_mut(pointer).unwrap() = value;
            assert!(
                parse_manifest(doc.to_string().as_bytes()).is_err(),
                "{pointer}"
            );
        }
    }

    #[test]
    fn rejects_duplicate_pack_ids() {
        let mut doc = sample();
        let pack = doc["content"][0].clone();
        doc["content"].as_array_mut().unwrap().push(pack);
        assert!(parse_manifest(doc.to_string().as_bytes()).is_err());
    }

    #[test]
    fn https_check_rejects_credentials_and_blank_hosts() {
        assert!(require_https("https://example.com/x").is_ok());
        assert!(require_https("https://user@example.com/x").is_err());
        assert!(require_https("https:///x").is_err());
        assert!(require_https("ftp://example.com").is_err());
    }
}
