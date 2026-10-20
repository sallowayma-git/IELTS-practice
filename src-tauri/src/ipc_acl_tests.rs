//! The real capability file, compiled into the real context, gates app
//! commands: the webview reaches only what `capabilities/main.json` allows.

use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::WebviewWindowBuilder;

use crate::app::state::test_support::test_db;
use crate::commands;

/// The origin Tauri serves the bundled frontend from; anything else is remote.
const LOCAL_ORIGIN: &str = if cfg!(windows) {
    "http://tauri.localhost"
} else {
    "tauri://localhost"
};

/// Invoke a command in a mock app whose main webview is at the local origin.
/// The temp directory outlives the app, which owns the migrated database.
fn invoke(cmd: &str, body: InvokeBody) -> Result<serde_json::Value, String> {
    let directory = tempfile::tempdir().expect("temp dir for the mock database");
    let app = mock_builder()
        .manage(test_db(directory.path()))
        .invoke_handler(tauri::generate_handler![
            commands::modes::timer_elapsed_seconds,
            commands::settings::delete_secret,
            commands::soul::soul_get,
            commands::soul::soul_update,
            commands::soul::soul_undo,
        ])
        .build(tauri::generate_context!())
        .expect("mock app builds with the real context");
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("main webview");
    get_ipc_response(
        &webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: LOCAL_ORIGIN.parse().unwrap(),
            body,
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|body| body.deserialize().unwrap())
    .map_err(|error| error.to_string())
}

#[test]
fn allowed_command_reaches_its_handler() {
    // Missing arguments are rejected by the handler, i.e. after the ACL let it through.
    let error = invoke("timer_elapsed_seconds", InvokeBody::default()).unwrap_err();
    assert!(error.contains("missing required key"), "{error}");
}

#[test]
fn host_only_command_is_refused_before_its_handler() {
    let error = invoke("delete_secret", InvokeBody::default()).unwrap_err();
    assert!(error.contains("not allowed"), "{error}");
}

#[test]
fn allowed_soul_commands_reach_their_handlers() {
    let snapshot = invoke("soul_get", InvokeBody::default()).expect("soul_get passes the ACL");
    assert_eq!(snapshot["ok"], serde_json::json!(true));
    assert_eq!(snapshot["data"]["profile"], serde_json::json!({}));

    let response = invoke(
        "soul_update",
        InvokeBody::Json(serde_json::json!({ "fields": "not an object" })),
    )
    .expect("soul_update passes the ACL");
    assert_eq!(response["ok"], serde_json::json!(false));
    assert_eq!(
        response["error"]["code"],
        serde_json::json!("soul.update_failed")
    );

    let response = invoke(
        "soul_undo",
        InvokeBody::Json(serde_json::json!({ "revisionId": "soul-missing" })),
    )
    .expect("soul_undo passes the ACL");
    assert_eq!(response["ok"], serde_json::json!(false));
    assert_eq!(
        response["error"]["code"],
        serde_json::json!("soul.undo_failed")
    );
}

#[test]
fn allowed_soul_update_still_rejects_missing_arguments() {
    let error = invoke("soul_update", InvokeBody::default()).unwrap_err();
    assert!(error.contains("missing required key"), "{error}");
    assert!(!error.contains("not allowed"), "{error}");
}
