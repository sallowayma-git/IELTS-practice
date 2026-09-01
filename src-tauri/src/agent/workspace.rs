use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

const WORKSPACE_GRANT_TTL: Duration = Duration::from_secs(15 * 60);

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
}
