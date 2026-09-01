use std::collections::HashSet;
use std::time::Duration;

use ielts_db::{get_setting, list_secret_refs, DbError, DbResult, NS_AI};
use ielts_domain::dto::{AiConfigDto, SecretRef};

use crate::app::state::{AppDb, AppVault};

use super::{AiProviderConfig, AiRuntime};

const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_SECONDS: u64 = 45;
const API_KEY_REQUIRED_ON_THIS_DEVICE: &str =
    "当前设备未找到可用 API Key；请在设置中重新填写该配置的 API Key 后再使用";

fn provider_defaults(provider: &str) -> (&'static str, &'static str) {
    match provider.trim().to_ascii_lowercase().as_str() {
        "openrouter" => ("https://openrouter.ai/api/v1", "openai-compatible"),
        "deepseek" => ("https://api.deepseek.com/v1", "openai-compatible"),
        "openai" => (DEFAULT_BASE_URL, "openai-compatible"),
        _ => (DEFAULT_BASE_URL, "openai-compatible"),
    }
}

/// Repair a user-entered provider base URL into the form the request builder
/// expects: a scheme-qualified origin plus the API path prefix, with no
/// trailing slash and no `/chat/completions` suffix.
///
/// The request builder appends `/chat/completions` verbatim
/// (`super::runtime`), so every deviation below used to produce a 404 that the
/// UI reported only as "连接失败", with no hint that the URL was the problem:
///
/// - `https://api.deepseek.com` (the provider's marketing URL, and the natural
///   thing to type) had no `/v1`, giving `…/chat/completions`.
/// - `https://api.openai.com/v1/chat/completions`, pasted straight out of
///   provider docs, gave `…/chat/completions/chat/completions`.
/// - `api.openai.com/v1` with no scheme failed inside reqwest as an opaque
///   builder error.
///
/// Appending `/v1` to a bare host is a deliberate trade: all three supported
/// providers serve under `/v1`, and a bare host is far more likely a user who
/// omitted it than a gateway serving completions at the root. A gateway that
/// does serve at the root must be entered with an explicit path.
fn normalize_base_url(raw: &str, default_url: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return default_url.to_string();
    }

    // Add a scheme before any parsing, or the host reads as a path segment.
    let mut url = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };

    while url.ends_with('/') {
        url.pop();
    }

    // Users paste the full endpoint from provider docs. Strip it rather than
    // doubling it.
    if let Some(stripped) = url.strip_suffix("/chat/completions") {
        url = stripped.to_string();
        while url.ends_with('/') {
            url.pop();
        }
    }

    // A bare origin (scheme + host, no path) is missing the API prefix.
    let has_path = url
        .split_once("://")
        .map(|(_, rest)| rest.contains('/'))
        .unwrap_or(false);
    if !has_path {
        url.push_str("/v1");
    }

    url
}

pub(crate) fn normalize_provider(provider: &str, base_url: Option<&str>) -> (String, String) {
    let (default_url, normalized) = provider_defaults(provider);
    let url = normalize_base_url(base_url.unwrap_or(""), default_url);
    (normalized.to_string(), url)
}

/// Whether this device holds a usable credential for `reference`.
///
/// A vault/keyring READ FAILURE must not be reported as `false`. This value
/// feeds `reconcile_default_ai_config_with_secret_availability`, which responds
/// to "no config has a secret" by calling `set_default_ai_config(None)` — and
/// that deletes `defaultConfigId`, overwrites `provider` with `"unconfigured"`,
/// and deletes `baseUrl`, `model` and `secretName`
/// (crates/ielts-db/src/settings/mod.rs:274-281).
///
/// So swallowing the error let one transient Windows Credential Manager hiccup
/// silently un-configure the user's provider — during `ai_list_configs`, which
/// the settings page calls on every load. The next invocation then reported
/// "未配置可用 AI" and the stored base URL and model were already gone. It also
/// inverted the architecture contract: a failed read drove a canonical write.
///
/// `Ok(None)` remains `false`: a reference with no local secret is genuinely
/// absent, which is the normal state after restoring a backup on a new device.
fn vault_has_secret(
    vault: &AppVault,
    reference: &ielts_domain::dto::SecretRef,
) -> DbResult<bool> {
    match vault.0.get_secret_by_ref(&reference.ref_id) {
        Ok(Some(secret)) => Ok(!secret.trim().is_empty()),
        Ok(None) => Ok(false),
        Err(error) => {
            tracing::warn!(
                error = %error,
                "reading the local OS vault failed; refusing to treat this as an                  absent credential"
            );
            Err(error)
        }
    }
}

fn available_secret_ref_ids(db: &AppDb, vault: &AppVault) -> DbResult<HashSet<String>> {
    let refs = db.with_conn(list_secret_refs)?;
    let mut available = HashSet::new();
    for reference in refs {
        // Fail the read rather than feeding a reconcile that would erase state.
        if vault_has_secret(vault, &reference)? {
            available.insert(reference.ref_id);
        }
    }
    Ok(available)
}

fn reconcile_default_ai_config_with_refs(
    conn: &rusqlite::Connection,
    available_refs: &HashSet<String>,
) -> DbResult<Option<AiConfigDto>> {
    ielts_db::reconcile_default_ai_config_with_secret_availability(conn, |reference| {
        available_refs.contains(&reference.ref_id)
    })
}

pub(crate) fn list_ai_configs_with_vault(
    db: &AppDb,
    vault: &AppVault,
) -> DbResult<Vec<AiConfigDto>> {
    let available_refs = available_secret_ref_ids(db, vault)?;
    db.with_conn(|conn| list_ai_configs_with_refs(conn, &available_refs))
}

fn list_ai_configs_with_refs(
    conn: &rusqlite::Connection,
    available_refs: &HashSet<String>,
) -> DbResult<Vec<AiConfigDto>> {
    reconcile_default_ai_config_with_refs(conn, available_refs)?;
    let mut configs = ielts_db::list_ai_configs_with_secret_availability(conn, |reference| {
        available_refs.contains(&reference.ref_id)
    })?;
    if configs
        .iter()
        .any(|config| config.is_default && (!config.is_enabled || !config.has_secret))
    {
        ielts_db::set_default_ai_config(conn, None)?;
        for config in &mut configs {
            config.is_default = false;
        }
    }
    Ok(configs)
}

fn provider_config_for_config(
    conn: &rusqlite::Connection,
    config: &AiConfigDto,
) -> DbResult<AiProviderConfig> {
    if !config.has_secret {
        return Err(DbError::Validation(API_KEY_REQUIRED_ON_THIS_DEVICE.into()));
    }
    let (provider, base_url) = normalize_provider(&config.provider, Some(&config.base_url));
    let secret_name = ielts_db::ai_secret_ref_for_config(conn, &config.id)?
        .map(|reference| reference.name)
        .ok_or_else(|| DbError::Validation(API_KEY_REQUIRED_ON_THIS_DEVICE.into()))?;
    let timeout_seconds = get_setting(conn, NS_AI, "timeoutSeconds")?
        .and_then(|entry| entry.value.as_u64())
        .unwrap_or(DEFAULT_TIMEOUT_SECONDS)
        .clamp(5, 300);
    Ok(AiProviderConfig {
        provider,
        base_url,
        model: config.default_model.clone(),
        secret_name,
        timeout: Duration::from_secs(timeout_seconds),
    })
}

pub(crate) fn load_provider_config(db: &AppDb, vault: &AppVault) -> DbResult<AiProviderConfig> {
    let available_refs = available_secret_ref_ids(db, vault)?;
    db.with_conn(|conn| {
        let config = reconcile_default_ai_config_with_refs(conn, &available_refs)?
            .ok_or_else(|| DbError::Validation(API_KEY_REQUIRED_ON_THIS_DEVICE.into()))?;
        provider_config_for_config(conn, &config)
    })
}

fn load_provider_config_for_id(
    db: &AppDb,
    vault: &AppVault,
    config_id: &str,
) -> DbResult<AiProviderConfig> {
    let available_refs = available_secret_ref_ids(db, vault)?;
    db.with_conn(|conn| {
        let configs = ielts_db::list_ai_configs_with_secret_availability(conn, |reference| {
            available_refs.contains(&reference.ref_id)
        })?;
        let config = select_config_for_test(configs, config_id)?;
        provider_config_for_config(conn, &config)
    })
}

fn select_config_for_test(configs: Vec<AiConfigDto>, config_id: &str) -> DbResult<AiConfigDto> {
    configs
        .into_iter()
        .find(|config| config.id == config_id)
        .ok_or_else(|| DbError::Validation("AI config not found".into()))
}

fn resolve_secret_ref(conn: &rusqlite::Connection, name: &str) -> DbResult<SecretRef> {
    list_secret_refs(conn)?
        .into_iter()
        .find(|secret_ref| secret_ref.name == name)
        .ok_or_else(|| DbError::Validation(API_KEY_REQUIRED_ON_THIS_DEVICE.into()))
}

fn resolve_api_key(vault: &AppVault, secret_ref: &SecretRef) -> DbResult<String> {
    vault
        .0
        .get_secret_by_ref(&secret_ref.ref_id)?
        .filter(|secret| !secret.trim().is_empty())
        .ok_or_else(|| DbError::Validation(API_KEY_REQUIRED_ON_THIS_DEVICE.into()))
}

pub(crate) fn load_runtime(db: &AppDb, vault: &AppVault) -> DbResult<AiRuntime> {
    let config = load_provider_config(db, vault)?;
    load_runtime_from_provider_config(db, vault, config)
}

pub(crate) fn load_runtime_for_config(
    db: &AppDb,
    vault: &AppVault,
    config_id: &str,
) -> DbResult<AiRuntime> {
    let config = load_provider_config_for_id(db, vault, config_id)?;
    load_runtime_from_provider_config(db, vault, config)
}

pub(crate) fn load_runtime_from_provider_config(
    db: &AppDb,
    vault: &AppVault,
    config: AiProviderConfig,
) -> DbResult<AiRuntime> {
    if config.provider != "openai-compatible" {
        return Err(DbError::Validation(format!(
            "provider does not support network AI requests: {}",
            config.provider
        )));
    }
    let secret_ref = db.with_conn(|conn| resolve_secret_ref(conn, &config.secret_name))?;
    let api_key = resolve_api_key(vault, &secret_ref)?;
    AiRuntime::new(config, api_key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn named_providers_map_to_openai_compatible_endpoints() {
        for (provider, expected) in [
            ("openai", "https://api.openai.com/v1"),
            ("openrouter", "https://openrouter.ai/api/v1"),
            ("deepseek", "https://api.deepseek.com/v1"),
        ] {
            let (runtime_provider, base_url) = normalize_provider(provider, None);
            assert_eq!(runtime_provider, "openai-compatible");
            assert_eq!(base_url, expected);
        }
    }

    #[test]
    fn user_entered_base_urls_are_repaired_into_one_canonical_form() {
        // Every input on the left used to reach the provider as
        // `<input>/chat/completions` verbatim and 404, surfacing only as
        // "连接失败". The existing test above passes `None`, so it exercised
        // just the hardcoded defaults — the inputs that already worked.
        for (entered, expected) in [
            // Missing /v1 — the provider's marketing URL.
            ("https://api.deepseek.com", "https://api.deepseek.com/v1"),
            ("https://api.openai.com/", "https://api.openai.com/v1"),
            // Full endpoint pasted from provider docs.
            (
                "https://api.openai.com/v1/chat/completions",
                "https://api.openai.com/v1",
            ),
            (
                "https://api.openai.com/v1/chat/completions/",
                "https://api.openai.com/v1",
            ),
            // Missing scheme — previously an opaque reqwest builder error.
            ("api.openai.com/v1", "https://api.openai.com/v1"),
            // Whitespace and trailing slashes.
            ("  https://api.openai.com/v1/  ", "https://api.openai.com/v1"),
            // Already correct: must be left exactly alone.
            ("https://api.openai.com/v1", "https://api.openai.com/v1"),
            // A non-default path is preserved, including a local server and a
            // custom gateway prefix.
            ("http://localhost:11434/v1", "http://localhost:11434/v1"),
            ("https://gw.example.com/openai/v1", "https://gw.example.com/openai/v1"),
        ] {
            let (_, base_url) = normalize_provider("openai", Some(entered));
            assert_eq!(base_url, expected, "input {entered:?}");
        }
    }

    #[test]
    fn a_blank_base_url_falls_back_to_the_provider_default() {
        for entered in ["", "   "] {
            let (_, base_url) = normalize_provider("deepseek", Some(entered));
            assert_eq!(base_url, "https://api.deepseek.com/v1");
        }
    }

    #[test]
    fn provider_test_selects_requested_config_even_when_disabled() {
        let selected = AiConfigDto {
            id: "selected".into(),
            config_name: "Selected".into(),
            provider: "openrouter".into(),
            base_url: "https://openrouter.ai/api/v1".into(),
            default_model: "gpt-selected".into(),
            is_default: false,
            is_enabled: false,
            has_secret: true,
        };
        let target = select_config_for_test(vec![selected], "selected").unwrap();
        assert_eq!(target.default_model, "gpt-selected");
        assert!(!target.is_enabled);
    }
}
