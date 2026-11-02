//! Network side: race every source for the signed manifest, then download
//! files from the fastest source first and fall back down the list.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use semver::Version;
use sha2::{Digest, Sha256};
use tokio::task::JoinSet;

use crate::manifest::{parse_manifest, parse_version, OtaManifest, MAX_MANIFEST_BYTES};
use crate::signature::verify_signature;
use crate::sources::{Candidate, SourceConfig};
use crate::OtaError;

pub type Progress<'a> = &'a (dyn Fn(u64, Option<u64>) + Send + Sync);

#[async_trait]
pub trait Transport: Send + Sync + 'static {
    /// GET `url`, refusing bodies over `max_bytes`. `progress` receives the
    /// running byte count and the announced length.
    async fn get(
        &self,
        url: &str,
        max_bytes: u64,
        progress: Progress<'_>,
    ) -> Result<Vec<u8>, String>;
}

#[derive(Debug, Clone)]
pub struct VerifiedManifest {
    pub manifest: OtaManifest,
    /// Source ids that answered with a valid manifest, fastest first.
    pub source_order: Vec<String>,
}

/// After the first valid answer, wait this long for slower sources: a stale
/// mirror must not hide a release that GitHub already has.
const GRACE: Duration = Duration::from_millis(1500);

pub async fn fetch_manifest(
    transport: Arc<dyn Transport>,
    config: &SourceConfig,
    pubkey: &str,
    timeout: Duration,
) -> Result<VerifiedManifest, OtaError> {
    let mut tasks = JoinSet::new();
    let file = config.manifest_file.clone();
    for candidate in config.channel_candidates(&file, &[]) {
        let transport = Arc::clone(&transport);
        let pubkey = pubkey.to_string();
        tasks.spawn(async move {
            let result = tokio::time::timeout(timeout, probe(&*transport, &candidate.url, &pubkey))
                .await
                .unwrap_or_else(|_| Err("timed out".into()));
            (candidate.source_id, result)
        });
    }

    let mut answers: Vec<(String, OtaManifest)> = Vec::new();
    let mut errors = Vec::new();
    let mut deadline: Option<tokio::time::Instant> = None;
    loop {
        let next = match deadline {
            Some(at) => match tokio::time::timeout_at(at, tasks.join_next()).await {
                Ok(next) => next,
                Err(_) => break,
            },
            None => tasks.join_next().await,
        };
        let Some(joined) = next else { break };
        let Ok((source_id, result)) = joined else {
            continue;
        };
        match result {
            Ok(manifest) => {
                deadline.get_or_insert_with(|| tokio::time::Instant::now() + GRACE);
                answers.push((source_id, manifest));
            }
            Err(error) => errors.push(format!("{}: {error}", config.label(&source_id))),
        }
    }
    tasks.abort_all();

    let newest = answers
        .iter()
        .max_by(|(_, a), (_, b)| freshness(a).cmp(&freshness(b)))
        .map(|(_, manifest)| manifest.clone())
        .ok_or(OtaError::AllSourcesFailed(errors))?;
    // Fastest-first, but only sources that serve the newest manifest: a
    // stale mirror would not have the files it names.
    let source_order = answers
        .into_iter()
        .filter(|(_, manifest)| *manifest == newest)
        .map(|(id, _)| id)
        .collect();
    Ok(VerifiedManifest {
        manifest: newest,
        source_order,
    })
}

fn freshness(manifest: &OtaManifest) -> (Version, String, u64) {
    (
        parse_version(&manifest.app.version).unwrap_or_else(|_| Version::new(0, 0, 0)),
        manifest.published_at.clone().unwrap_or_default(),
        manifest.content.iter().map(|pack| pack.version).sum(),
    )
}

async fn probe(transport: &dyn Transport, url: &str, pubkey: &str) -> Result<OtaManifest, String> {
    let quiet: Progress<'_> = &|_, _| {};
    let body = transport.get(url, MAX_MANIFEST_BYTES, quiet).await?;
    let signature = transport.get(&format!("{url}.sig"), 4096, quiet).await?;
    let signature =
        String::from_utf8(signature).map_err(|_| "signature is not UTF-8".to_string())?;
    verify_signature(&body, &signature, pubkey).map_err(|error| error.to_string())?;
    parse_manifest(&body).map_err(|error| error.to_string())
}

/// Download from each candidate in turn until one returns exactly `size`
/// bytes hashing to `sha256`.
pub async fn download_verified(
    transport: &dyn Transport,
    candidates: &[Candidate],
    sha256: &str,
    size: u64,
    progress: Progress<'_>,
) -> Result<(Vec<u8>, String), OtaError> {
    let mut errors = Vec::new();
    for candidate in candidates {
        progress(0, Some(size));
        match transport.get(&candidate.url, size, progress).await {
            Ok(bytes) if bytes.len() as u64 != size => errors.push(format!(
                "{}: size {} != {size}",
                candidate.source_id,
                bytes.len()
            )),
            Ok(bytes) if hex::encode(Sha256::digest(&bytes)) != sha256 => {
                errors.push(format!("{}: sha256 mismatch", candidate.source_id))
            }
            Ok(bytes) => return Ok((bytes, candidate.source_id.clone())),
            Err(error) => errors.push(format!("{}: {error}", candidate.source_id)),
        }
    }
    Err(OtaError::AllSourcesFailed(errors))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::signature::tests::{TEST_MANIFEST, TEST_MANIFEST_SIG, TEST_PUBKEY};
    use std::collections::HashMap;
    use std::sync::Mutex;

    /// url -> (delay ms, body); a missing url is a network error.
    #[derive(Default)]
    pub(crate) struct FakeTransport {
        pub routes: HashMap<String, (u64, Vec<u8>)>,
        pub hits: Mutex<Vec<String>>,
    }

    impl FakeTransport {
        pub fn route(mut self, url: &str, delay_ms: u64, body: &[u8]) -> Self {
            self.routes.insert(url.into(), (delay_ms, body.to_vec()));
            self
        }
    }

    #[async_trait]
    impl Transport for FakeTransport {
        async fn get(
            &self,
            url: &str,
            max: u64,
            progress: Progress<'_>,
        ) -> Result<Vec<u8>, String> {
            self.hits.lock().unwrap().push(url.into());
            let (delay, body) = self.routes.get(url).cloned().ok_or("unreachable")?;
            tokio::time::sleep(Duration::from_millis(delay)).await;
            if body.len() as u64 > max {
                return Err("too large".into());
            }
            progress(body.len() as u64, Some(body.len() as u64));
            Ok(body)
        }
    }

    fn config() -> SourceConfig {
        SourceConfig::parse(
            br#"{"canonical":"https://gh/{file}","manifestFile":"ota.json","updaterFile":"latest.json",
                "sources":[{"id":"gh","label":"GitHub","template":"https://gh/{file}"},
                           {"id":"cn","label":"CN","template":"https://cn/{file}"},
                           {"id":"px","label":"Proxy","template":"https://px/{url}"}]}"#,
        )
        .unwrap()
    }

    fn signed(transport: FakeTransport, base: &str, delay: u64) -> FakeTransport {
        transport
            .route(&format!("{base}ota.json"), delay, TEST_MANIFEST)
            .route(
                &format!("{base}ota.json.sig"),
                0,
                TEST_MANIFEST_SIG.as_bytes(),
            )
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn fastest_valid_source_leads_and_dead_sources_are_skipped() {
        let transport = signed(
            signed(FakeTransport::default(), "https://gh/", 900),
            "https://cn/",
            50,
        );
        let verified = fetch_manifest(
            Arc::new(transport),
            &config(),
            TEST_PUBKEY,
            Duration::from_secs(10),
        )
        .await
        .unwrap();
        assert_eq!(verified.manifest.app.version, "0.2.0");
        assert_eq!(
            verified.source_order,
            vec!["cn".to_string(), "gh".to_string()]
        );
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn tampered_mirror_is_ignored() {
        let mut bad = TEST_MANIFEST.to_vec();
        bad[20] ^= 1;
        let transport = signed(FakeTransport::default(), "https://gh/", 500)
            .route("https://cn/ota.json", 10, &bad)
            .route("https://cn/ota.json.sig", 0, TEST_MANIFEST_SIG.as_bytes());
        let verified = fetch_manifest(
            Arc::new(transport),
            &config(),
            TEST_PUBKEY,
            Duration::from_secs(10),
        )
        .await
        .unwrap();
        assert_eq!(verified.source_order, vec!["gh".to_string()]);
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn all_sources_down_reports_each_failure() {
        let error = fetch_manifest(
            Arc::new(FakeTransport::default()),
            &config(),
            TEST_PUBKEY,
            Duration::from_secs(1),
        )
        .await
        .unwrap_err();
        match error {
            OtaError::AllSourcesFailed(errors) => assert_eq!(errors.len(), 3),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn download_falls_back_past_corrupt_and_dead_sources() {
        let good = b"pack-bytes".to_vec();
        let sha = hex::encode(Sha256::digest(&good));
        let transport = FakeTransport::default()
            .route("https://cn/p.tar.gz", 0, b"pack-bytez")
            .route("https://px/https://gh/p.tar.gz", 0, &good);
        let candidates = config().channel_candidates("p.tar.gz", &["cn".into()]);
        let (bytes, source) =
            download_verified(&transport, &candidates, &sha, good.len() as u64, &|_, _| {})
                .await
                .unwrap();
        assert_eq!(bytes, good);
        assert_eq!(source, "px");
        assert_eq!(transport.hits.lock().unwrap().len(), 3);
    }
}
