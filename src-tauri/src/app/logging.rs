use tracing_subscriber::{fmt, EnvFilter};

pub fn init() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,ielts_practice_tauri_lib=debug"));
    let _ = fmt().with_env_filter(filter).with_target(true).try_init();
}
