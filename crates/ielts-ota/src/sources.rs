//! Download sources: GitHub, mirrors and GitHub proxies, all equal.
//!
//! A source is a URL template with exactly one placeholder:
//! - `{file}`: a mirror that hosts the release files under their bare names,
//!   e.g. `https://cdn.example.cn/ielts/stable/{file}`;
//! - `{url}`: a proxy that takes the full canonical GitHub URL,
//!   e.g. `https://ghfast.top/{url}`.
//!
//! Integrity never depends on the source (everything is signed), so adding a
//! mirror is a pure availability decision.

use serde::{Deserialize, Serialize};

use crate::manifest::require_https;
use crate::OtaError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub label: String,
    pub template: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceConfig {
    /// Where the channel files live on GitHub; `{file}` is the bare name.
    pub canonical: String,
    /// Name of the signed channel manifest (`ota.json`).
    pub manifest_file: String,
    /// Name of the Tauri updater manifest in the same channel.
    pub updater_file: String,
    pub sources: Vec<Source>,
}

impl SourceConfig {
    pub fn parse(bytes: &[u8]) -> Result<Self, OtaError> {
        let config: SourceConfig = serde_json::from_slice(bytes)
            .map_err(|error| OtaError::Config(format!("sources: {error}")))?;
        config.validate()?;
        Ok(config)
    }

    fn validate(&self) -> Result<(), OtaError> {
        if placeholder(&self.canonical) != Some(Placeholder::File) {
            return Err(OtaError::Config("canonical must contain {file}".into()));
        }
        require_https(&self.canonical).map_err(config_error)?;
        if self.sources.is_empty() {
            return Err(OtaError::Config("at least one source is required".into()));
        }
        let mut ids = std::collections::HashSet::new();
        for source in &self.sources {
            if placeholder(&source.template).is_none() {
                return Err(OtaError::Config(format!(
                    "source {} needs exactly one {{file}} or {{url}}",
                    source.id
                )));
            }
            require_https(&source.template).map_err(config_error)?;
            if !ids.insert(source.id.as_str()) {
                return Err(OtaError::Config(format!("duplicate source {}", source.id)));
            }
        }
        Ok(())
    }

    /// Canonical GitHub URL of a channel file.
    pub fn canonical_url(&self, file: &str) -> String {
        self.canonical.replace("{file}", file)
    }

    /// Every source's URL for a channel file, in `order`.
    pub fn channel_candidates(&self, file: &str, order: &[String]) -> Vec<Candidate> {
        self.candidates(file, &self.canonical_url(file), order)
    }

    /// Every source's URL for `file`, whose canonical location is `canonical`
    /// (e.g. an installer URL from the updater manifest). Mirrors serve it
    /// under its bare name; proxies wrap the canonical URL.
    pub fn candidates(&self, file: &str, canonical: &str, order: &[String]) -> Vec<Candidate> {
        let mut out: Vec<Candidate> = Vec::new();
        for source in self.ordered(order) {
            let url = match placeholder(&source.template) {
                // The canonical source serves files at their canonical URL.
                Some(Placeholder::File) if source.template == self.canonical => {
                    canonical.to_string()
                }
                Some(Placeholder::File) => source.template.replace("{file}", file),
                Some(Placeholder::Url) => source.template.replace("{url}", canonical),
                None => continue,
            };
            if !out.iter().any(|existing| existing.url == url) {
                out.push(Candidate {
                    source_id: source.id.clone(),
                    url,
                });
            }
        }
        out
    }

    /// Sources named in `order` first (fastest probe first), then the rest
    /// in configured order.
    pub fn ordered(&self, order: &[String]) -> Vec<&Source> {
        let mut out: Vec<&Source> = order
            .iter()
            .filter_map(|id| self.sources.iter().find(|source| &source.id == id))
            .collect();
        for source in &self.sources {
            if !out.iter().any(|picked| picked.id == source.id) {
                out.push(source);
            }
        }
        out
    }

    pub fn label(&self, id: &str) -> String {
        self.sources
            .iter()
            .find(|source| source.id == id)
            .map_or_else(|| id.to_string(), |source| source.label.clone())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub source_id: String,
    pub url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Placeholder {
    File,
    Url,
}

fn placeholder(template: &str) -> Option<Placeholder> {
    match (
        template.matches("{file}").count(),
        template.matches("{url}").count(),
    ) {
        (1, 0) => Some(Placeholder::File),
        (0, 1) => Some(Placeholder::Url),
        _ => None,
    }
}

fn config_error(error: OtaError) -> OtaError {
    OtaError::Config(error.to_string())
}

/// Bare file name of a URL path (`.../download/v1/App_1.0_x64-setup.exe`).
pub fn url_file_name(url: &str) -> Option<&str> {
    let path = url.split(['?', '#']).next()?;
    let name = path.rsplit('/').next()?;
    crate::manifest::is_safe_name(name).then_some(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    pub(crate) fn config() -> SourceConfig {
        SourceConfig::parse(
            json!({
                "canonical": "https://github.com/o/r/releases/download/ota-stable/{file}",
                "manifestFile": "ota.json",
                "updaterFile": "latest.json",
                "sources": [
                    {"id": "github", "label": "GitHub", "template": "https://github.com/o/r/releases/download/ota-stable/{file}"},
                    {"id": "cn", "label": "国内镜像", "template": "https://cdn.example.cn/stable/{file}"},
                    {"id": "proxy", "label": "加速", "template": "https://proxy.example/{url}"}
                ]
            })
            .to_string()
            .as_bytes(),
        )
        .unwrap()
    }

    #[test]
    fn resolves_file_and_url_templates_in_order() {
        let urls: Vec<String> = config()
            .channel_candidates("ota.json", &["cn".into()])
            .into_iter()
            .map(|candidate| candidate.url)
            .collect();
        assert_eq!(
            urls,
            vec![
                "https://cdn.example.cn/stable/ota.json",
                "https://github.com/o/r/releases/download/ota-stable/ota.json",
                "https://proxy.example/https://github.com/o/r/releases/download/ota-stable/ota.json",
            ]
        );
    }

    #[test]
    fn installer_candidates_wrap_the_canonical_url() {
        let canonical = "https://github.com/o/r/releases/download/v0.2.0/App_0.2.0_x64-setup.exe";
        let name = url_file_name(canonical).unwrap();
        let urls: Vec<String> = config()
            .candidates(name, canonical, &[])
            .into_iter()
            .map(|candidate| candidate.url)
            .collect();
        assert_eq!(urls[0], canonical);
        assert_eq!(
            urls[1],
            "https://cdn.example.cn/stable/App_0.2.0_x64-setup.exe"
        );
        assert_eq!(urls[2], format!("https://proxy.example/{canonical}"));
    }

    #[test]
    fn rejects_bad_templates() {
        for template in [
            "https://x/{file}/{file}",
            "https://x/none",
            "http://x/{file}",
            "https://x/{file}{url}",
        ] {
            let doc = json!({
                "canonical": "https://github.com/o/r/{file}",
                "manifestFile": "ota.json", "updaterFile": "latest.json",
                "sources": [{"id": "a", "label": "a", "template": template}]
            });
            assert!(
                SourceConfig::parse(doc.to_string().as_bytes()).is_err(),
                "{template}"
            );
        }
    }

    #[test]
    fn file_name_extraction_rejects_traversal() {
        assert_eq!(url_file_name("https://x/a/b.exe?x=1"), Some("b.exe"));
        assert_eq!(url_file_name("https://x/a/"), None);
        assert_eq!(url_file_name("https://x/a/..%2f"), None);
    }
}
