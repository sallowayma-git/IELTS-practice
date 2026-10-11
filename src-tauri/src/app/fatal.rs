//! Startup failures the user must see. Release builds are `windows_subsystem =
//! "windows"`, so stderr goes nowhere: the error is logged to a file and shown
//! in a native message box.

use std::io::Write;
use std::path::Path;

/// Record a fatal startup error (log file + tracing) and show it to the user.
pub fn report_startup_failure(logs_dir: &Path, backups_dir: &Path, error: &str) {
    let body = startup_failure_text(backups_dir, error);
    tracing::error!(%error, "application did not start");
    append_log(logs_dir, &body);
    show_error_dialog("IELTS Atlas 无法启动", &body);
}

fn startup_failure_text(backups_dir: &Path, error: &str) -> String {
    format!(
        "IELTS Atlas 无法打开学习数据库，因此没有启动。\n\n\
         错误：{error}\n\n\
         你的数据没有被修改：失败的迁移已回滚；迁移前的快照（如有）保存在：\n{}\n\n\
         下一步：\n\
         1. 不要删除上述备份目录。\n\
         2. 把本对话框的错误文本发给开发者（同时已写入日志目录下的 startup-error.log）。\n\
         3. 若是更新后出现，请安装上一版本后再启动，或从备份恢复。",
        backups_dir.display()
    )
}

fn append_log(logs_dir: &Path, body: &str) {
    // Best effort: the dialog is the primary channel and must still appear.
    if std::fs::create_dir_all(logs_dir).is_err() {
        return;
    }
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(logs_dir.join("startup-error.log"))
    {
        let _ = writeln!(file, "[{}]\n{body}\n", chrono::Utc::now().to_rfc3339());
    }
}

#[cfg(windows)]
fn show_error_dialog(title: &str, body: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }
    let body = wide(body);
    let title = wide(title);
    // SAFETY: both buffers are NUL-terminated UTF-16 and outlive the call; a null
    // owner window makes the box modal to the process.
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            body.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}

#[cfg(not(windows))]
fn show_error_dialog(title: &str, body: &str) {
    eprintln!("{title}\n\n{body}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_message_points_at_the_backups_not_the_logs() {
        let text = startup_failure_text(Path::new("C:/data/backups"), "migration 30 failed");
        assert!(text.contains("C:/data/backups"));
        assert!(text.contains("migration 30 failed"));
        assert!(text.contains("不要删除"));
    }
}
