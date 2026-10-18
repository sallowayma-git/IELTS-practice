//! The real capability file, compiled into the real context, gates app
//! commands: the webview reaches only what `capabilities/main.json` allows.

use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::WebviewWindowBuilder;

use crate::commands;

fn invoke(cmd: &str) -> Result<serde_json::Value, String> {
    let app = mock_builder()
        .invoke_handler(tauri::generate_handler![
            commands::modes::timer_elapsed_seconds,
            commands::settings::delete_secret,
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
            url: "tauri://localhost".parse().unwrap(),
            body: InvokeBody::default(),
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
    let error = invoke("timer_elapsed_seconds").unwrap_err();
    assert!(error.contains("missing required key"), "{error}");
}

#[test]
fn host_only_command_is_refused_before_its_handler() {
    let error = invoke("delete_secret").unwrap_err();
    assert!(error.contains("not allowed"), "{error}");
}
