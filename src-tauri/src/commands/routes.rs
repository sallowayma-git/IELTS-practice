use crate::app::routes::{normalize_route, RouteTarget};

#[tauri::command]
pub fn normalize_shell_route(raw: String) -> RouteTarget {
    normalize_route(&raw)
}

/// Explicit legacy resolver used by frontend redirects.
#[tauri::command]
pub fn resolve_legacy_route(raw: String) -> RouteTarget {
    normalize_route(&raw)
}
