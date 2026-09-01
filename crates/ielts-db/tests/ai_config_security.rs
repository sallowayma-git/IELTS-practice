use ielts_db::{
    delete_secret_ref, get_setting, list_ai_configs, list_ai_configs_with_secret_availability,
    list_secret_refs, migrate::open_and_migrate, put_secret_ref, reconcile_default_ai_config,
    reconcile_default_ai_config_with_secret_availability, set_default_ai_config, upsert_ai_config,
    upsert_setting, NS_AI,
};
use ielts_domain::dto::AiConfigDto;
use serde_json::json;
use tempfile::tempdir;

#[test]
fn provider_config_rejects_nested_plaintext_credentials() {
    let dir = tempdir().unwrap();
    let conn = open_and_migrate(&dir.path().join("v2.db")).unwrap();
    let legacy_provider = json!({
        "id": "legacy-openai",
        "provider": "openai",
        "base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4o-mini",
        "api_key": "sk-legacy-plaintext-must-never-reach-v2"
    });

    let error = upsert_setting(&conn, "provider_configs", "legacy-openai", &legacy_provider)
        .expect_err("nested API keys must be rejected");
    assert!(error.to_string().contains("secret") || error.to_string().contains("API key"));

    let stored: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM settings WHERE value_json LIKE '%sk-legacy%'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stored, 0);
}

#[test]
fn active_runtime_config_is_complete_and_contains_only_a_secret_name() {
    let dir = tempdir().unwrap();
    let conn = open_and_migrate(&dir.path().join("v2.db")).unwrap();
    let config = AiConfigDto {
        id: "legacy-openai".into(),
        config_name: "Legacy OpenAI".into(),
        provider: "openai".into(),
        base_url: "https://api.openai.com/v1".into(),
        default_model: "gpt-4o-mini".into(),
        is_default: false,
        is_enabled: true,
        has_secret: true,
    };
    upsert_ai_config(&conn, &config).unwrap();
    put_secret_ref(&conn, "ai.config.legacy-openai", "keyring:legacy-openai").unwrap();
    set_default_ai_config(&conn, Some(&config)).unwrap();

    for key in [
        "provider",
        "baseUrl",
        "model",
        "secretName",
        "timeoutSeconds",
    ] {
        assert!(
            get_setting(&conn, NS_AI, key).unwrap().is_some(),
            "missing {key}"
        );
    }
    let dump: String = conn
        .query_row(
            "SELECT group_concat(value_json, '|') FROM settings",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(!dump.contains("sk-"));
    assert!(dump.contains("ai.config.legacy-openai"));
}

#[test]
fn deleting_secret_reference_removes_only_the_reference_record() {
    let dir = tempdir().unwrap();
    let conn = open_and_migrate(&dir.path().join("v2.db")).unwrap();
    put_secret_ref(&conn, "first.api_key", "keyring:first").unwrap();
    put_secret_ref(&conn, "second.api_key", "keyring:second").unwrap();

    assert!(delete_secret_ref(&conn, "first.api_key").unwrap());
    assert!(!delete_secret_ref(&conn, "first.api_key").unwrap());
    let refs = list_secret_refs(&conn).unwrap();
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0].name, "second.api_key");
}

#[test]
fn default_config_cannot_trust_a_forged_has_secret_flag_without_a_reference() {
    let dir = tempdir().unwrap();
    let conn = open_and_migrate(&dir.path().join("v2.db")).unwrap();
    let config = AiConfigDto {
        id: "forged".into(),
        config_name: "Forged metadata".into(),
        provider: "openai".into(),
        base_url: "https://api.openai.com/v1".into(),
        default_model: "gpt-4o-mini".into(),
        is_default: false,
        is_enabled: true,
        has_secret: true,
    };
    upsert_ai_config(&conn, &config).unwrap();

    assert!(set_default_ai_config(&conn, Some(&config)).is_err());
    assert!(get_setting(&conn, NS_AI, "defaultConfigId")
        .unwrap()
        .is_none());
}

#[test]
fn default_config_is_always_enabled_and_backed_by_a_secret_reference() {
    let dir = tempdir().unwrap();
    let conn = open_and_migrate(&dir.path().join("v2.db")).unwrap();
    let primary = AiConfigDto {
        id: "primary".into(),
        config_name: "Primary".into(),
        provider: "openai".into(),
        base_url: "https://api.openai.com/v1".into(),
        default_model: "gpt-4o-mini".into(),
        is_default: false,
        is_enabled: true,
        has_secret: false,
    };
    upsert_ai_config(&conn, &primary).unwrap();
    put_secret_ref(&conn, "ai.config.primary.api_key", "keyring:primary").unwrap();
    let primary = list_ai_configs(&conn).unwrap().pop().unwrap();
    set_default_ai_config(&conn, Some(&primary)).unwrap();

    let mut disabled = primary.clone();
    disabled.is_enabled = false;
    upsert_ai_config(&conn, &disabled).unwrap();
    assert!(reconcile_default_ai_config(&conn).unwrap().is_none());
    assert!(get_setting(&conn, NS_AI, "defaultConfigId")
        .unwrap()
        .is_none());
    assert_eq!(
        get_setting(&conn, NS_AI, "provider")
            .unwrap()
            .unwrap()
            .value,
        json!("unconfigured")
    );

    let secondary = AiConfigDto {
        id: "secondary".into(),
        config_name: "Secondary".into(),
        provider: "openai".into(),
        base_url: "https://api.openai.com/v1".into(),
        default_model: "gpt-4o-mini".into(),
        is_default: false,
        is_enabled: true,
        has_secret: false,
    };
    upsert_ai_config(&conn, &secondary).unwrap();
    assert!(reconcile_default_ai_config(&conn).unwrap().is_none());

    put_secret_ref(&conn, "ai.config.secondary.api_key", "keyring:secondary").unwrap();
    let selected = reconcile_default_ai_config(&conn).unwrap().unwrap();
    assert_eq!(selected.id, "secondary");
    assert!(selected.is_default);

    let mut invalid = selected.clone();
    invalid.has_secret = false;
    assert!(set_default_ai_config(&conn, Some(&invalid)).is_err());
}

#[test]
fn reference_without_a_local_vault_secret_is_not_available_or_default() {
    let dir = tempdir().unwrap();
    let conn = open_and_migrate(&dir.path().join("v2.db")).unwrap();
    let config = AiConfigDto {
        id: "restored".into(),
        config_name: "Restored OpenAI".into(),
        provider: "openai".into(),
        base_url: "https://api.openai.com/v1".into(),
        default_model: "gpt-4o-mini".into(),
        is_default: false,
        is_enabled: true,
        has_secret: false,
    };
    upsert_ai_config(&conn, &config).unwrap();
    put_secret_ref(&conn, "ai.config.restored.api_key", "keyring:source-device").unwrap();
    let stored = list_ai_configs(&conn).unwrap().pop().unwrap();
    set_default_ai_config(&conn, Some(&stored)).unwrap();

    let visible = list_ai_configs_with_secret_availability(&conn, |_| false).unwrap();
    assert_eq!(visible.len(), 1);
    assert!(
        !visible[0].has_secret,
        "a reference is not a local credential"
    );
    assert!(
        visible[0].is_default,
        "the raw backup metadata still records its former default"
    );

    assert!(
        reconcile_default_ai_config_with_secret_availability(&conn, |_| false)
            .unwrap()
            .is_none()
    );
    let reconciled = list_ai_configs_with_secret_availability(&conn, |_| false).unwrap();
    assert!(!reconciled[0].has_secret);
    assert!(!reconciled[0].is_default);
    assert!(get_setting(&conn, NS_AI, "defaultConfigId")
        .unwrap()
        .is_none());
    assert_eq!(
        get_setting(&conn, NS_AI, "provider")
            .unwrap()
            .unwrap()
            .value,
        json!("unconfigured")
    );
}

#[test]
fn a_production_shaped_uuid_config_id_can_become_the_default() {
    // Round-3 remediation. Every other id in this suite is a short hand-written
    // label ("primary", "secondary", "forged") — all under 20 characters — which
    // is the only reason they pass. Production ids are UUIDs minted by
    // `ai_upsert_config` (src-tauri/src/commands/ai.rs), i.e. 36 characters with
    // no spaces, and that is exactly the shape `looks_like_secret_payload`'s
    // ai-namespace rule rejects (crates/ielts-db/src/settings/mod.rs:424-427).
    //
    // Because `set_default_ai_config` wrote `defaultConfigId` through the guarded
    // public `upsert_setting`, every real save of a config that had a locally
    // available API key failed with "refusing to store API key / secret material
    // in settings table" — and since `reconcile` runs on list too, the settings
    // page then stayed permanently empty and every AI invocation path failed.
    // One root cause, and it presented as "cannot save" + "cannot configure" +
    // "cannot invoke" at once.
    let dir = tempdir().unwrap();
    let conn = open_and_migrate(&dir.path().join("uuid.db")).unwrap();
    let id = "67e55044-10b1-426f-9247-bb680e5fe0c8";
    assert!(id.len() >= 20 && !id.contains(' '), "fixture must be the shape that used to be rejected");

    let config = AiConfigDto {
        id: id.into(),
        config_name: "Primary".into(),
        provider: "openai".into(),
        base_url: "https://api.openai.com/v1".into(),
        default_model: "gpt-4o-mini".into(),
        is_default: false,
        is_enabled: true,
        has_secret: false,
    };
    upsert_ai_config(&conn, &config).unwrap();
    put_secret_ref(&conn, &format!("ai.config.{id}.api_key"), "keyring:uuid").unwrap();
    let stored = list_ai_configs(&conn).unwrap().pop().unwrap();

    set_default_ai_config(&conn, Some(&stored)).expect("a UUID config id must be storable");
    assert_eq!(
        get_setting(&conn, NS_AI, "defaultConfigId").unwrap().unwrap().value,
        json!(id)
    );

    // And the path the settings page actually exercises on every load must work,
    // since that is what left the list permanently empty.
    let selected = reconcile_default_ai_config(&conn).unwrap().unwrap();
    assert_eq!(selected.id, id);
    assert!(selected.is_default);
}

#[test]
fn the_public_settings_command_still_refuses_a_long_opaque_ai_value() {
    // The counterpart to the test above: the fix routes one trusted
    // host-internal write around the guard, it does NOT weaken the guard.
    // `upsert_setting` is a registered Tauri command (src-tauri/src/lib.rs:224)
    // taking an arbitrary namespace/key/value from the webview, so this rule is
    // what stops a webview from parking an API key in the settings table.
    let dir = tempdir().unwrap();
    let conn = open_and_migrate(&dir.path().join("guard.db")).unwrap();
    assert!(
        upsert_setting(&conn, NS_AI, "someInnocentKey", &json!("sk-a-long-opaque-secret-value"))
            .is_err(),
        "the ai-namespace guard must still reject long opaque values from the public path"
    );
}
