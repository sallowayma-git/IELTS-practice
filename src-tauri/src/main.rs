#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args_os().nth(1).as_deref() == Some(std::ffi::OsStr::new("--verify-sidecar")) {
        std::process::exit(match ielts_practice_tauri_lib::verify_bundled_sidecar() {
            Ok(()) => 0,
            Err(error) => {
                eprintln!("{error}");
                1
            }
        });
    }
    ielts_practice_tauri_lib::run();
}
