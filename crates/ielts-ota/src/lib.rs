//! Tiered OTA updates for the IELTS Practice desktop client.
//!
//! - **Content** (question banks, writing topics): signed `.tar.gz` packs
//!   installed into app data and re-indexed live, no restart.
//! - **App** (Rust core, Vue frontend, sidecar): the Tauri updater installs
//!   a signed build in place; a restart applies it.
//! - **Reinstall**: releases that cannot be applied in place
//!   (`minOtaVersion`) send the user to a download page.
//!
//! One signed manifest drives all three; every download source is untrusted
//! transport. This crate holds the pure parts so they are testable without a
//! webview; the Tauri glue lives in `src-tauri/src/commands/ota.rs`.

pub mod fetch;
pub mod manifest;
pub mod pack;
pub mod policy;
pub mod signature;
pub mod sources;

#[derive(Debug, thiserror::Error)]
pub enum OtaError {
    #[error("manifest: {0}")]
    Manifest(String),
    #[error("signature: {0}")]
    Signature(String),
    #[error("config: {0}")]
    Config(String),
    #[error("pack: {0}")]
    Pack(String),
    #[error("all download sources failed: {}", .0.join("; "))]
    AllSourcesFailed(Vec<String>),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}
