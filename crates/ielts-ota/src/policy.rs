//! Turn a verified manifest into per-tier decisions. Pure functions only.

use semver::Version;
use serde::Serialize;

use crate::manifest::{parse_version, AppRelease, ContentPack};

/// How the installed application reaches the latest release.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AppTier {
    UpToDate,
    /// Signed in-place update (Rust core, frontend and sidecar together),
    /// downloaded in the background, applied by a restart.
    Ota,
    /// The release cannot be applied in place: download and reinstall.
    Reinstall,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDecision {
    pub tier: AppTier,
    pub current_version: String,
    pub latest_version: String,
    /// The installed version is below `minSupportedVersion`.
    pub forced: bool,
}

pub fn decide_app(current: &Version, release: &AppRelease) -> AppDecision {
    let below = |field: &Option<String>| {
        field
            .as_deref()
            .and_then(|value| parse_version(value).ok())
            .is_some_and(|floor| *current < floor)
    };
    let latest = parse_version(&release.version).unwrap_or_else(|_| current.clone());
    let tier = if *current >= latest {
        AppTier::UpToDate
    } else if below(&release.min_ota_version) {
        AppTier::Reinstall
    } else {
        AppTier::Ota
    };
    AppDecision {
        tier,
        current_version: current.to_string(),
        latest_version: latest.to_string(),
        forced: tier != AppTier::UpToDate && below(&release.min_supported_version),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ContentState {
    UpToDate,
    Available,
    /// A newer pack exists but needs a newer application first.
    NeedsAppUpdate,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentDecision {
    pub id: String,
    pub state: ContentState,
    pub installed_version: u64,
    pub offered_version: u64,
    pub size: u64,
    pub title: Option<String>,
    pub notes: Option<String>,
}

/// Versions only move forward, so replaying an old signed manifest can never
/// roll content back.
pub fn decide_content(current: &Version, pack: &ContentPack, installed: u64) -> ContentDecision {
    let app_too_old = pack
        .min_app_version
        .as_deref()
        .and_then(|value| parse_version(value).ok())
        .is_some_and(|floor| *current < floor);
    let state = match (pack.version > installed, app_too_old) {
        (false, _) => ContentState::UpToDate,
        (true, true) => ContentState::NeedsAppUpdate,
        (true, false) => ContentState::Available,
    };
    ContentDecision {
        id: pack.id.clone(),
        state,
        installed_version: installed,
        offered_version: pack.version,
        size: pack.size,
        title: pack.title.clone(),
        notes: pack.notes.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(version: &str, min_ota: Option<&str>, min_supported: Option<&str>) -> AppRelease {
        AppRelease {
            version: version.into(),
            installer_signatures: Vec::new(),
            min_ota_version: min_ota.map(Into::into),
            min_supported_version: min_supported.map(Into::into),
            notes: None,
            download_pages: Vec::new(),
        }
    }

    fn v(value: &str) -> Version {
        Version::parse(value).unwrap()
    }

    #[test]
    fn app_tiers() {
        let r = release("0.3.0", Some("0.2.0"), Some("0.1.5"));
        assert_eq!(decide_app(&v("0.3.0"), &r).tier, AppTier::UpToDate);
        assert_eq!(decide_app(&v("0.4.0"), &r).tier, AppTier::UpToDate);
        assert_eq!(decide_app(&v("0.2.0"), &r).tier, AppTier::Ota);
        assert_eq!(decide_app(&v("0.1.9"), &r).tier, AppTier::Reinstall);
        assert!(!decide_app(&v("0.1.9"), &r).forced);
        assert!(decide_app(&v("0.1.0"), &r).forced);
        assert!(!decide_app(&v("0.3.0"), &r).forced);
    }

    #[test]
    fn app_without_floors_is_plain_ota() {
        let r = release("1.0.0", None, None);
        let decision = decide_app(&v("0.1.0"), &r);
        assert_eq!(decision.tier, AppTier::Ota);
        assert!(!decision.forced);
    }

    #[test]
    fn prerelease_orders_before_release() {
        let r = release("0.1.0", None, None);
        assert_eq!(decide_app(&v("0.1.0-beta"), &r).tier, AppTier::Ota);
    }

    #[test]
    fn content_states() {
        let pack = ContentPack {
            id: "reading".into(),
            version: 5,
            min_app_version: Some("0.2.0".into()),
            file: "content-reading-5.tar.gz".into(),
            sha256: "a".repeat(64),
            size: 1,
            title: None,
            notes: None,
        };
        assert_eq!(
            decide_content(&v("0.2.0"), &pack, 4).state,
            ContentState::Available
        );
        assert_eq!(
            decide_content(&v("0.2.0"), &pack, 5).state,
            ContentState::UpToDate
        );
        assert_eq!(
            decide_content(&v("0.2.0"), &pack, 9).state,
            ContentState::UpToDate
        );
        assert_eq!(
            decide_content(&v("0.1.0"), &pack, 4).state,
            ContentState::NeedsAppUpdate
        );
    }
}
