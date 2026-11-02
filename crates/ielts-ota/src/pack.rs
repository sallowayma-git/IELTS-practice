//! Content packs on disk.
//!
//! ```text
//! <root>/<id>/<version>/...        an extracted pack (immutable once named)
//! <root>/<id>/<version>/ota-pack.json
//! <root>/<id>/active.json          which version the app should load
//! <root>/<id>/.staging-*           extraction in progress (deleted on prune)
//! ```
//!
//! Every pack directory, bundled or downloaded, carries `ota-pack.json`
//! (`{"id","version","minAppVersion"}`), so choosing between the bundled
//! pack and a downloaded one is one version comparison.

use std::fs;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

use flate2::read::GzDecoder;
use semver::Version;
use serde::{Deserialize, Serialize};

use crate::manifest::{is_safe_name, parse_version};
use crate::OtaError;

pub const MARKER_FILE: &str = "ota-pack.json";
const ACTIVE_FILE: &str = "active.json";
const MAX_ENTRIES: usize = 20_000;
const MAX_EXTRACTED_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackMarker {
    pub id: String,
    pub version: u64,
    #[serde(default)]
    pub min_app_version: Option<String>,
}

pub fn read_marker(dir: &Path) -> Option<PackMarker> {
    let raw = fs::read(dir.join(MARKER_FILE)).ok()?;
    serde_json::from_slice(&raw).ok()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActiveRecord {
    version: u64,
    sha256: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PackOrigin {
    Bundled,
    Downloaded,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedPack {
    pub dir: PathBuf,
    pub version: u64,
    pub origin: PackOrigin,
}

#[derive(Debug, Clone)]
pub struct ContentStore {
    root: PathBuf,
}

impl ContentStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    fn slot(&self, id: &str) -> PathBuf {
        self.root.join(id)
    }

    /// The downloaded pack the app should load, if any and still valid.
    fn active(&self, id: &str, app: &Version) -> Option<ResolvedPack> {
        let raw = fs::read(self.slot(id).join(ACTIVE_FILE)).ok()?;
        let record: ActiveRecord = serde_json::from_slice(&raw).ok()?;
        let dir = self.slot(id).join(record.version.to_string());
        let marker = read_marker(&dir)?;
        let compatible = marker
            .min_app_version
            .as_deref()
            .is_none_or(|floor| parse_version(floor).is_ok_and(|floor| *app >= floor));
        (marker.id == id && marker.version == record.version && compatible).then_some(
            ResolvedPack {
                dir,
                version: record.version,
                origin: PackOrigin::Downloaded,
            },
        )
    }

    /// Version named by `active.json`, whether or not it currently wins.
    pub fn active_version(&self, id: &str) -> Option<u64> {
        let raw = fs::read(self.slot(id).join(ACTIVE_FILE)).ok()?;
        serde_json::from_slice::<ActiveRecord>(&raw)
            .ok()
            .map(|record| record.version)
    }

    /// Bundled pack unless a newer, compatible download is active. A newer
    /// app that bundles newer content wins over an older download.
    pub fn resolve(&self, id: &str, bundled_dir: &Path, app: &Version) -> ResolvedPack {
        let bundled = ResolvedPack {
            dir: bundled_dir.to_path_buf(),
            version: read_marker(bundled_dir).map_or(0, |marker| marker.version),
            origin: PackOrigin::Bundled,
        };
        match self.active(id, app) {
            Some(downloaded) if downloaded.version > bundled.version => downloaded,
            _ => bundled,
        }
    }

    /// Extract a verified `.tar.gz` and move it to `<id>/<version>`. The
    /// pack is not active until [`ContentStore::activate`].
    pub fn install(&self, id: &str, version: u64, archive: &[u8]) -> Result<PathBuf, OtaError> {
        if !is_safe_name(id) {
            return Err(OtaError::Pack(format!("invalid pack id {id:?}")));
        }
        let slot = self.slot(id);
        fs::create_dir_all(&slot)?;
        let staging = slot.join(format!(".staging-{version}-{}", std::process::id()));
        remove_dir_if_exists(&staging)?;
        let result = extract(archive, &staging).and_then(|()| {
            let marker = read_marker(&staging)
                .ok_or_else(|| OtaError::Pack(format!("pack has no valid {MARKER_FILE}")))?;
            if marker.id != id || marker.version != version {
                return Err(OtaError::Pack(format!(
                    "pack marker says {}@{}, manifest says {id}@{version}",
                    marker.id, marker.version
                )));
            }
            let target = slot.join(version.to_string());
            remove_dir_if_exists(&target)?;
            fs::rename(&staging, &target)?;
            Ok(target)
        });
        if result.is_err() {
            let _ = remove_dir_if_exists(&staging);
        }
        result
    }

    /// Point the slot at `version` (written atomically via rename).
    pub fn activate(&self, id: &str, version: u64, sha256: &str) -> Result<(), OtaError> {
        let slot = self.slot(id);
        let record = ActiveRecord {
            version,
            sha256: sha256.into(),
        };
        let tmp = slot.join(format!("{ACTIVE_FILE}.tmp"));
        fs::write(
            &tmp,
            serde_json::to_vec_pretty(&record).map_err(io::Error::other)?,
        )?;
        fs::rename(&tmp, slot.join(ACTIVE_FILE))?;
        Ok(())
    }

    /// Forget the active download (the app falls back to the bundled pack).
    pub fn deactivate(&self, id: &str) -> Result<(), OtaError> {
        match fs::remove_file(self.slot(id).join(ACTIVE_FILE)) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error.into()),
            _ => Ok(()),
        }
    }

    /// Drop a version directory that never became active.
    pub fn discard(&self, id: &str, version: u64) -> Result<(), OtaError> {
        remove_dir_if_exists(&self.slot(id).join(version.to_string())).map_err(Into::into)
    }

    /// Remove every version directory and staging leftover except `keep`.
    pub fn prune(&self, id: &str, keep: &[u64]) -> Result<usize, OtaError> {
        let Ok(entries) = fs::read_dir(self.slot(id)) else {
            return Ok(0);
        };
        let mut removed = 0;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let stale = name.starts_with(".staging-")
                || name
                    .parse::<u64>()
                    .is_ok_and(|version| !keep.contains(&version));
            if stale && entry.path().is_dir() {
                fs::remove_dir_all(entry.path())?;
                removed += 1;
            }
        }
        Ok(removed)
    }
}

fn remove_dir_if_exists(path: &Path) -> io::Result<()> {
    match fs::remove_dir_all(path) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

/// Extract regular files and directories only; every path must stay inside
/// `dest` (no absolute paths, `..`, links or devices).
fn extract(archive: &[u8], dest: &Path) -> Result<(), OtaError> {
    fs::create_dir_all(dest)?;
    let mut tar = tar::Archive::new(GzDecoder::new(archive));
    let mut budget = MAX_EXTRACTED_BYTES;
    for (index, entry) in tar.entries()?.enumerate() {
        if index >= MAX_ENTRIES {
            return Err(OtaError::Pack("pack has too many entries".into()));
        }
        let mut entry = entry?;
        let relative = safe_relative(&entry.path()?)?;
        let target = dest.join(&relative);
        match entry.header().entry_type() {
            tar::EntryType::Directory => fs::create_dir_all(&target)?,
            tar::EntryType::Regular => {
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent)?;
                }
                let mut file = fs::File::create(&target)?;
                let copied = io::copy(&mut (&mut entry).take(budget + 1), &mut file)?;
                budget = budget
                    .checked_sub(copied)
                    .ok_or_else(|| OtaError::Pack("pack expands beyond the size limit".into()))?;
            }
            other => return Err(OtaError::Pack(format!("unsupported entry type {other:?}"))),
        }
    }
    Ok(())
}

fn safe_relative(path: &Path) -> Result<PathBuf, OtaError> {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) if !part.to_string_lossy().contains('\\') => out.push(part),
            Component::CurDir => {}
            _ => {
                return Err(OtaError::Pack(format!(
                    "unsafe path in pack: {}",
                    path.display()
                )))
            }
        }
    }
    if out.as_os_str().is_empty() {
        return Err(OtaError::Pack("empty path in pack".into()));
    }
    Ok(out)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use flate2::{write::GzEncoder, Compression};

    pub(crate) fn tar_gz(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut builder = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::fast()));
        for (path, body) in files {
            let mut header = tar::Header::new_gnu();
            header.set_size(body.len() as u64);
            header.set_mode(0o644);
            header.set_entry_type(tar::EntryType::Regular);
            // set_path refuses `..`; write the raw name so the extractor's
            // own checks are what the traversal tests exercise.
            let name = &mut header.as_old_mut().name;
            name[..path.len()].copy_from_slice(path.as_bytes());
            header.set_cksum();
            builder.append(&header, *body).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap()
    }

    fn marker(id: &str, version: u64, min_app: Option<&str>) -> Vec<u8> {
        serde_json::to_vec(&PackMarker {
            id: id.into(),
            version,
            min_app_version: min_app.map(Into::into),
        })
        .unwrap()
    }

    fn v(value: &str) -> Version {
        Version::parse(value).unwrap()
    }

    fn bundled(root: &Path, version: u64) -> PathBuf {
        let dir = root.join("bundled");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(MARKER_FILE), marker("reading", version, None)).unwrap();
        dir
    }

    #[test]
    fn install_activate_resolve_and_prune() {
        let temp = tempfile::tempdir().unwrap();
        let store = ContentStore::new(temp.path().join("ota"));
        let bundled_dir = bundled(temp.path(), 10);
        assert_eq!(
            store.resolve("reading", &bundled_dir, &v("0.1.0")).origin,
            PackOrigin::Bundled
        );

        let archive = tar_gz(&[
            (MARKER_FILE, &marker("reading", 11, None)),
            ("payloads/a.json", b"{}"),
        ]);
        let dir = store.install("reading", 11, &archive).unwrap();
        assert!(dir.join("payloads/a.json").is_file());
        // Installed but not active yet.
        assert_eq!(
            store.resolve("reading", &bundled_dir, &v("0.1.0")).version,
            10
        );

        store.activate("reading", 11, "abc").unwrap();
        let resolved = store.resolve("reading", &bundled_dir, &v("0.1.0"));
        assert_eq!(
            (resolved.version, resolved.origin),
            (11, PackOrigin::Downloaded)
        );

        // A newer app bundling newer content wins over the old download.
        let newer_bundle = bundled(&temp.path().join("new"), 12);
        assert_eq!(
            store.resolve("reading", &newer_bundle, &v("0.1.0")).origin,
            PackOrigin::Bundled
        );

        fs::create_dir_all(temp.path().join("ota/reading/9")).unwrap();
        fs::create_dir_all(temp.path().join("ota/reading/.staging-12-1")).unwrap();
        assert_eq!(store.prune("reading", &[11]).unwrap(), 2);
        assert!(dir.is_dir());

        store.deactivate("reading").unwrap();
        assert_eq!(
            store.resolve("reading", &bundled_dir, &v("0.1.0")).origin,
            PackOrigin::Bundled
        );
    }

    #[test]
    fn incompatible_download_falls_back_to_bundle() {
        let temp = tempfile::tempdir().unwrap();
        let store = ContentStore::new(temp.path().join("ota"));
        let bundled_dir = bundled(temp.path(), 1);
        let archive = tar_gz(&[(MARKER_FILE, &marker("reading", 2, Some("9.0.0")))]);
        store.install("reading", 2, &archive).unwrap();
        store.activate("reading", 2, "x").unwrap();
        assert_eq!(
            store.resolve("reading", &bundled_dir, &v("1.0.0")).origin,
            PackOrigin::Bundled
        );
    }

    #[test]
    fn rejects_traversal_wrong_marker_and_missing_marker() {
        let temp = tempfile::tempdir().unwrap();
        let store = ContentStore::new(temp.path().join("ota"));
        let traversal = tar_gz(&[
            (MARKER_FILE, &marker("reading", 3, None)),
            ("../escape.txt", b"x"),
        ]);
        assert!(store.install("reading", 3, &traversal).is_err());
        assert!(!temp.path().join("ota/escape.txt").exists());

        let wrong = tar_gz(&[(MARKER_FILE, &marker("writing-topics", 3, None))]);
        assert!(store.install("reading", 3, &wrong).is_err());
        assert!(store
            .install("reading", 3, &tar_gz(&[("a.json", b"{}")]))
            .is_err());
        assert!(store.install("../x", 3, &tar_gz(&[])).is_err());
        // Failed installs leave nothing behind.
        let left: Vec<_> = fs::read_dir(temp.path().join("ota/reading"))
            .unwrap()
            .collect();
        assert!(left.is_empty());
    }

    #[test]
    fn safe_relative_rules() {
        assert!(safe_relative(Path::new("a/b.json")).is_ok());
        assert!(safe_relative(Path::new("./a")).is_ok());
        assert!(safe_relative(Path::new("/etc/passwd")).is_err());
        assert!(safe_relative(Path::new("a/../../b")).is_err());
        assert!(safe_relative(Path::new("a\\..\\b")).is_err());
        assert!(safe_relative(Path::new("")).is_err());
    }
}

#[cfg(test)]
mod python_pack_tests {
    use super::*;

    /// Built by `developer/tests/ci/ota_channel.py` (PAX, long file name):
    /// the publishing tool and the client must agree on the format.
    #[test]
    fn installs_a_pack_built_by_the_release_tool() {
        let temp = tempfile::tempdir().unwrap();
        let store = ContentStore::new(temp.path());
        let archive = include_bytes!("../tests/fixtures/python-pack.tar.gz");
        let dir = store.install("reading", 42, archive).unwrap();
        assert!(dir.join("manifest.json").is_file());
        assert!(dir
            .join("payloads")
            .join(format!("{}.json", "x".repeat(120)))
            .is_file());
    }
}
