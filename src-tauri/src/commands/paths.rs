use serde::Serialize;
use tauri::State;

use crate::app::state::{discover_legacy_dirs, AppPaths};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDataPathsDto {
    pub app_data: String,
    pub logs: String,
    pub backups: String,
    pub imports: String,
    pub exports: String,
    pub diagnostics: String,
    pub db_dir: String,
}

#[tauri::command]
pub fn get_app_data_paths(paths: State<'_, AppPaths>) -> AppDataPathsDto {
    AppDataPathsDto {
        app_data: paths.app_data.display().to_string(),
        logs: paths.logs.display().to_string(),
        backups: paths.backups.display().to_string(),
        imports: paths.imports.display().to_string(),
        exports: paths.exports.display().to_string(),
        diagnostics: paths.diagnostics.display().to_string(),
        db_dir: paths.db_dir.display().to_string(),
    }
}

#[tauri::command]
pub fn discover_legacy_data_dirs() -> Vec<String> {
    discover_legacy_dirs()
        .into_iter()
        .map(|p| p.display().to_string())
        .collect()
}
