use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

const WORKSPACE_GRANT_TTL: Duration = Duration::from_secs(15 * 60);

/// Both locations are host-owned policy, never paths supplied by the Webview.
pub(crate) fn default_workspace(installation: &Path, app_data: &Path) -> Result<PathBuf, String> {
    prepare_workspace(installation).or_else(|preferred_error| {
        prepare_workspace(app_data).map_err(|fallback_error| {
            format!("cannot prepare default workspace: installation: {preferred_error}; app data: {fallback_error}")
        })
    })
}

fn prepare_workspace(parent: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let parent = parent.canonicalize().map_err(|error| error.to_string())?;
    let root = parent.join("agent-workspace");
    std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let metadata = std::fs::symlink_metadata(&root).map_err(|error| error.to_string())?;
    if !metadata.is_dir() || is_redirected_directory(&metadata) {
        return Err("default workspace must be a real directory, not a link".into());
    }
    let canonical = root.canonicalize().map_err(|error| error.to_string())?;
    if canonical.parent() != Some(parent.as_path()) {
        return Err("default workspace escaped its host-owned parent".into());
    }
    // Test effective access, not permission bits (which are unreliable on Windows).
    // Only remove our freshly-created probe; preserve all user workspace contents.
    let probe = canonical.join(format!(".write-probe-{}", uuid::Uuid::new_v4()));
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .map_err(|error| error.to_string())?;
    drop(file);
    std::fs::remove_file(&probe).map_err(|error| error.to_string())?;
    Ok(canonical)
}

fn is_redirected_directory(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0 // includes junctions, not just symlinks
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGrant {
    pub grant_id: String,
    pub display_path: String,
    pub expires_at: String,
}

#[derive(Debug)]
struct WorkspaceGrantRecord {
    root: PathBuf,
    expires_at: Instant,
}

#[derive(Default)]
pub struct WorkspaceGrants {
    grants: Mutex<HashMap<String, WorkspaceGrantRecord>>,
}

impl WorkspaceGrants {
    pub(crate) fn issue(&self, root: &Path) -> Result<WorkspaceGrant, String> {
        self.issue_with_ttl(root, WORKSPACE_GRANT_TTL)
    }

    fn issue_with_ttl(&self, root: &Path, ttl: Duration) -> Result<WorkspaceGrant, String> {
        let canonical = root
            .canonicalize()
            .map_err(|error| format!("invalid workspace path: {error}"))?;
        if !canonical
            .metadata()
            .map_err(|error| format!("cannot inspect workspace directory: {error}"))?
            .is_dir()
        {
            return Err("workspace selection is not a directory".into());
        }

        let grant_id = uuid::Uuid::new_v4().to_string();
        let expires_at = Instant::now() + ttl;
        let mut grants = self
            .grants
            .lock()
            .map_err(|_| "workspace grant store is unavailable".to_string())?;
        grants.retain(|_, grant| grant.expires_at > Instant::now());
        grants.insert(
            grant_id.clone(),
            WorkspaceGrantRecord {
                root: canonical.clone(),
                expires_at,
            },
        );
        Ok(WorkspaceGrant {
            grant_id,
            display_path: canonical.display().to_string(),
            expires_at: (chrono::Utc::now()
                + chrono::Duration::from_std(ttl)
                    .unwrap_or_else(|_| chrono::Duration::minutes(15)))
            .to_rfc3339(),
        })
    }

    pub(crate) fn resolve(&self, grant_id: &str) -> Result<PathBuf, String> {
        let mut grants = self
            .grants
            .lock()
            .map_err(|_| "workspace grant store is unavailable".to_string())?;
        let now = Instant::now();
        grants.retain(|_, grant| grant.expires_at > now);
        grants
            .get(grant_id)
            .map(|grant| grant.root.clone())
            .ok_or_else(|| "workspace grant is invalid or expired".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_grants_are_short_lived_and_process_local() {
        let directory = tempfile::tempdir().unwrap();
        let grants = WorkspaceGrants::default();
        let grant = grants
            .issue_with_ttl(directory.path(), Duration::from_secs(60))
            .unwrap();
        assert_eq!(
            grants.resolve(&grant.grant_id).unwrap(),
            directory.path().canonicalize().unwrap()
        );
        assert!(grants.resolve("forged").is_err());

        let expired = grants
            .issue_with_ttl(directory.path(), Duration::ZERO)
            .unwrap();
        assert!(grants.resolve(&expired.grant_id).is_err());
        assert!(WorkspaceGrants::default().resolve(&grant.grant_id).is_err());
    }

    #[test]
    fn workspace_grant_rejects_files() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("file.txt");
        std::fs::write(&file, "content").unwrap();
        assert!(WorkspaceGrants::default().issue(&file).is_err());
    }

    #[test]
    fn default_workspace_is_stable_and_preserves_existing_files() {
        let installation = tempfile::tempdir().unwrap();
        let app_data = tempfile::tempdir().unwrap();
        let root = default_workspace(installation.path(), app_data.path()).unwrap();
        assert_eq!(
            root,
            installation
                .path()
                .canonicalize()
                .unwrap()
                .join("agent-workspace")
        );
        std::fs::write(root.join("note.txt"), "keep me").unwrap();
        assert_eq!(
            default_workspace(installation.path(), app_data.path()).unwrap(),
            root
        );
        assert_eq!(
            std::fs::read_to_string(root.join("note.txt")).unwrap(),
            "keep me"
        );
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        assert!(!app_data.path().join("agent-workspace").exists());
        let grants = WorkspaceGrants::default();
        let grant = grants.issue(&root).unwrap();
        assert_eq!(grants.resolve(&grant.grant_id).unwrap(), root);
    }

    #[test]
    fn default_workspace_falls_back_without_overwriting_a_blocked_installation_path() {
        let installation = tempfile::tempdir().unwrap();
        let app_data = tempfile::tempdir().unwrap();
        let blocked = installation.path().join("agent-workspace");
        std::fs::write(&blocked, "keep the obstruction").unwrap();
        let root = default_workspace(installation.path(), app_data.path()).unwrap();
        assert_eq!(
            root,
            app_data
                .path()
                .canonicalize()
                .unwrap()
                .join("agent-workspace")
        );
        assert_eq!(
            std::fs::read_to_string(blocked).unwrap(),
            "keep the obstruction"
        );
        assert_eq!(std::fs::read_dir(root).unwrap().count(), 0);
    }

    #[test]
    fn default_workspace_fails_closed_when_both_locations_are_blocked() {
        let installation = tempfile::tempdir().unwrap();
        let app_data = tempfile::tempdir().unwrap();
        for parent in [installation.path(), app_data.path()] {
            std::fs::write(parent.join("agent-workspace"), "keep").unwrap();
        }
        let error = default_workspace(installation.path(), app_data.path()).unwrap_err();
        assert!(error.contains("installation:") && error.contains("app data:"));
    }

    #[test]
    fn default_workspace_rejects_redirected_root_without_touching_its_target() {
        let installation = tempfile::tempdir().unwrap();
        let app_data = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("private.txt"), "private").unwrap();
        let link = installation.path().join("agent-workspace");
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), &link).unwrap();
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let output = std::process::Command::new("cmd.exe")
                .args(["/C", "mklink", "/J"])
                .arg(&link)
                .arg(outside.path())
                .creation_flags(0x08000000)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "junction creation failed: {output:?}"
            );
        }
        let result = default_workspace(installation.path(), app_data.path());
        // Remove just the link before TempDir cleanup; never traverse its target.
        #[cfg(unix)]
        std::fs::remove_file(&link).unwrap();
        #[cfg(windows)]
        std::fs::remove_dir(&link).unwrap();
        assert_eq!(
            result.unwrap(),
            app_data
                .path()
                .canonicalize()
                .unwrap()
                .join("agent-workspace")
        );
        assert_eq!(std::fs::read_dir(outside.path()).unwrap().count(), 1);
        assert_eq!(
            std::fs::read_to_string(outside.path().join("private.txt")).unwrap(),
            "private"
        );
    }
}
