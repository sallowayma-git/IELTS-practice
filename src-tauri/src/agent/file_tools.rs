use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use async_trait::async_trait;
use ielts_application::{
    AgentToolCall, AgentToolDefinition, AgentToolExecution, AgentToolExecutor,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const MAX_FILE_BYTES: u64 = 1024 * 1024;
const MAX_RELATIVE_PATH_BYTES: usize = 4096;

pub(crate) struct WorkspaceFileTools {
    root: PathBuf,
}

impl WorkspaceFileTools {
    pub(crate) fn new(root: PathBuf) -> Result<Self, String> {
        let root = root
            .canonicalize()
            .map_err(|error| format!("cannot resolve workspace root: {error}"))?;
        if !root
            .metadata()
            .map_err(|error| format!("cannot inspect workspace root: {error}"))?
            .is_dir()
        {
            return Err("workspace root is not a directory".into());
        }
        Ok(Self { root })
    }
}

#[async_trait]
impl AgentToolExecutor for WorkspaceFileTools {
    fn definitions(&self) -> Vec<AgentToolDefinition> {
        vec![
            AgentToolDefinition {
                name: "read_file".into(),
                description: "Read one UTF-8 text file from the granted workspace. Returns content, byte length, and SHA-256.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "path": {"type":"string","description":"Workspace-relative file path"}
                    },
                    "required": ["path"],
                    "additionalProperties": false
                }),
            },
            AgentToolDefinition {
                name: "write_file".into(),
                description: "Create or replace one UTF-8 text file. Replacing an existing file requires the SHA-256 returned by read_file.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "path": {"type":"string","description":"Workspace-relative file path"},
                        "content": {"type":"string"},
                        "expectedSha256": {"type":"string","description":"Required when the file already exists"}
                    },
                    "required": ["path", "content"],
                    "additionalProperties": false
                }),
            },
            AgentToolDefinition {
                name: "replace_in_file".into(),
                description: "Replace exact UTF-8 text in an existing file using SHA-256 optimistic concurrency protection.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "path": {"type":"string","description":"Workspace-relative file path"},
                        "oldText": {"type":"string"},
                        "newText": {"type":"string"},
                        "expectedSha256": {"type":"string"},
                        "replaceAll": {"type":"boolean","default":false}
                    },
                    "required": ["path", "oldText", "newText", "expectedSha256"],
                    "additionalProperties": false
                }),
            },
        ]
    }

    fn audit_arguments(&self, call: &AgentToolCall) -> Value {
        match call.name.as_str() {
            "read_file" => serde_json::from_str::<ReadFileArgs>(&call.arguments_json)
                .map(|args| json!({"path":args.path,"valid":true}))
                .unwrap_or_else(|_| json!({"valid":false})),
            "write_file" => serde_json::from_str::<WriteFileArgs>(&call.arguments_json)
                .map(|args| {
                    json!({
                        "path": args.path,
                        "contentBytes": args.content.len(),
                        "expectedSha256": args.expected_sha256,
                        "valid": true,
                    })
                })
                .unwrap_or_else(|_| json!({"valid":false})),
            "replace_in_file" => serde_json::from_str::<ReplaceInFileArgs>(&call.arguments_json)
                .map(|args| {
                    json!({
                        "path": args.path,
                        "oldTextBytes": args.old_text.len(),
                        "newTextBytes": args.new_text.len(),
                        "expectedSha256": args.expected_sha256,
                        "replaceAll": args.replace_all,
                        "valid": true,
                    })
                })
                .unwrap_or_else(|_| json!({"valid":false})),
            _ => json!({"known":false}),
        }
    }

    async fn execute(&self, call: &AgentToolCall) -> AgentToolExecution {
        match call.name.as_str() {
            "read_file" => execute_read(&self.root, &call.arguments_json),
            "write_file" => execute_write(&self.root, &call.arguments_json),
            "replace_in_file" => execute_replace(&self.root, &call.arguments_json),
            _ => AgentToolExecution::rejected(
                "agent.unknown_tool",
                format!("unknown tool: {}", call.name),
                json!({"known":false}),
            ),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadFileArgs {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WriteFileArgs {
    path: String,
    content: String,
    #[serde(default)]
    expected_sha256: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReplaceInFileArgs {
    path: String,
    old_text: String,
    new_text: String,
    expected_sha256: String,
    #[serde(default)]
    replace_all: bool,
}

fn execute_read(root: &Path, raw: &str) -> AgentToolExecution {
    let args: ReadFileArgs = match parse_arguments(raw) {
        Ok(args) => args,
        Err(execution) => return execution,
    };
    let path = match resolve_existing_file(root, &args.path) {
        Ok(path) => path,
        Err(failure) => return failure.into_execution(),
    };
    let (content, sha256, bytes) = match read_utf8_file(&path) {
        Ok(value) => value,
        Err(failure) => return failure.with_path(&args.path).into_execution(),
    };
    let audit = json!({"path":args.path,"bytes":bytes,"sha256":sha256});
    AgentToolExecution::succeeded(
        json!({
            "path": audit["path"],
            "content": content,
            "bytes": bytes,
            "sha256": sha256,
        })
        .to_string(),
        audit,
    )
}

fn execute_write(root: &Path, raw: &str) -> AgentToolExecution {
    let args: WriteFileArgs = match parse_arguments(raw) {
        Ok(args) => args,
        Err(execution) => return execution,
    };
    if args.content.len() as u64 > MAX_FILE_BYTES {
        return ToolFailure::rejected(
            "agent.file_too_large",
            format!("file content exceeds the {MAX_FILE_BYTES} byte limit"),
            json!({"path":args.path,"contentBytes":args.content.len()}),
        )
        .into_execution();
    }
    let target = match resolve_write_target(root, &args.path) {
        Ok(target) => target,
        Err(failure) => return failure.into_execution(),
    };
    let mut previous_hash = None;
    if target.exists {
        let (_, actual_hash, _) = match read_utf8_file(&target.path) {
            Ok(value) => value,
            Err(failure) => return failure.with_path(&args.path).into_execution(),
        };
        let Some(expected) = args.expected_sha256.as_deref() else {
            return hash_required(&args.path, &actual_hash);
        };
        if !hash_matches(expected, &actual_hash) {
            return hash_conflict(&args.path, expected, &actual_hash);
        }
        previous_hash = Some(actual_hash);
    } else if args.expected_sha256.is_some() {
        return ToolFailure::rejected(
            "agent.file_hash_conflict",
            "expectedSha256 was provided but the file does not exist",
            json!({"path":args.path,"exists":false}),
        )
        .into_execution();
    }

    if let Err(failure) = atomic_write(&target.path, args.content.as_bytes(), target.exists) {
        return failure.with_path(&args.path).into_execution();
    }
    let sha256 = sha256(args.content.as_bytes());
    let audit = json!({
        "path": args.path,
        "bytes": args.content.len(),
        "sha256": sha256,
        "previousSha256": previous_hash,
        "created": !target.exists,
    });
    AgentToolExecution::succeeded(audit.to_string(), audit)
}

fn execute_replace(root: &Path, raw: &str) -> AgentToolExecution {
    let args: ReplaceInFileArgs = match parse_arguments(raw) {
        Ok(args) => args,
        Err(execution) => return execution,
    };
    if args.old_text.is_empty() {
        return ToolFailure::rejected(
            "agent.invalid_tool_arguments",
            "oldText must not be empty",
            json!({"path":args.path}),
        )
        .into_execution();
    }
    let path = match resolve_existing_file(root, &args.path) {
        Ok(path) => path,
        Err(failure) => return failure.into_execution(),
    };
    let (content, actual_hash, _) = match read_utf8_file(&path) {
        Ok(value) => value,
        Err(failure) => return failure.with_path(&args.path).into_execution(),
    };
    if !hash_matches(&args.expected_sha256, &actual_hash) {
        return hash_conflict(&args.path, &args.expected_sha256, &actual_hash);
    }
    let matches = content.matches(&args.old_text).count();
    if matches == 0 {
        return ToolFailure::rejected(
            "agent.text_not_found",
            "oldText was not found in the file",
            json!({"path":args.path,"sha256":actual_hash}),
        )
        .into_execution();
    }
    let replaced = if args.replace_all {
        content.replace(&args.old_text, &args.new_text)
    } else {
        content.replacen(&args.old_text, &args.new_text, 1)
    };
    if replaced.len() as u64 > MAX_FILE_BYTES {
        return ToolFailure::rejected(
            "agent.file_too_large",
            format!("replacement exceeds the {MAX_FILE_BYTES} byte limit"),
            json!({"path":args.path,"bytes":replaced.len()}),
        )
        .into_execution();
    }
    if let Err(failure) = atomic_write(&path, replaced.as_bytes(), true) {
        return failure.with_path(&args.path).into_execution();
    }
    let sha256 = sha256(replaced.as_bytes());
    let replacements = if args.replace_all { matches } else { 1 };
    let audit = json!({
        "path": args.path,
        "bytes": replaced.len(),
        "sha256": sha256,
        "previousSha256": actual_hash,
        "replacements": replacements,
    });
    AgentToolExecution::succeeded(audit.to_string(), audit)
}

fn parse_arguments<T: for<'de> Deserialize<'de>>(raw: &str) -> Result<T, AgentToolExecution> {
    serde_json::from_str(raw).map_err(|error| {
        AgentToolExecution::rejected(
            "agent.invalid_tool_arguments",
            format!("tool arguments are invalid: {error}"),
            json!({"valid":false}),
        )
    })
}

struct WriteTarget {
    path: PathBuf,
    exists: bool,
}

fn resolve_existing_file(root: &Path, relative: &str) -> Result<PathBuf, ToolFailure> {
    let relative = validate_relative_path(relative)?;
    let joined = root.join(&relative);
    let canonical = joined.canonicalize().map_err(|error| {
        ToolFailure::rejected(
            "agent.file_not_found",
            format!("cannot resolve workspace file: {error}"),
            json!({"path":relative_path_json(&relative)}),
        )
    })?;
    ensure_contained(root, &canonical, &relative)?;
    let metadata = canonical.metadata().map_err(|error| {
        ToolFailure::failed(
            "agent.file_io",
            format!("cannot inspect workspace file: {error}"),
            true,
            json!({"path":relative_path_json(&relative)}),
        )
    })?;
    if !metadata.is_file() {
        return Err(ToolFailure::rejected(
            "agent.path_not_file",
            "workspace path is not a regular file",
            json!({"path":relative_path_json(&relative)}),
        ));
    }
    Ok(canonical)
}

fn resolve_write_target(root: &Path, relative: &str) -> Result<WriteTarget, ToolFailure> {
    let relative = validate_relative_path(relative)?;
    let joined = root.join(&relative);
    match fs::symlink_metadata(&joined) {
        Ok(_) => resolve_existing_file(root, relative_path_json(&relative).as_str())
            .map(|path| WriteTarget { path, exists: true }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = joined.parent().ok_or_else(|| {
                ToolFailure::rejected(
                    "agent.invalid_path",
                    "workspace-relative file must have a parent directory",
                    json!({"path":relative_path_json(&relative)}),
                )
            })?;
            let canonical_parent = parent.canonicalize().map_err(|error| {
                ToolFailure::rejected(
                    "agent.parent_not_found",
                    format!("file parent directory does not exist: {error}"),
                    json!({"path":relative_path_json(&relative)}),
                )
            })?;
            ensure_contained(root, &canonical_parent, &relative)?;
            if !canonical_parent
                .metadata()
                .map_err(|error| {
                    ToolFailure::failed(
                        "agent.file_io",
                        format!("cannot inspect file parent directory: {error}"),
                        true,
                        json!({"path":relative_path_json(&relative)}),
                    )
                })?
                .is_dir()
            {
                return Err(ToolFailure::rejected(
                    "agent.parent_not_directory",
                    "file parent is not a directory",
                    json!({"path":relative_path_json(&relative)}),
                ));
            }
            let name = relative.file_name().ok_or_else(|| {
                ToolFailure::rejected(
                    "agent.invalid_path",
                    "workspace-relative file name is missing",
                    json!({"path":relative_path_json(&relative)}),
                )
            })?;
            Ok(WriteTarget {
                path: canonical_parent.join(name),
                exists: false,
            })
        }
        Err(error) => Err(ToolFailure::failed(
            "agent.file_io",
            format!("cannot inspect workspace path: {error}"),
            true,
            json!({"path":relative_path_json(&relative)}),
        )),
    }
}

fn validate_relative_path(raw: &str) -> Result<PathBuf, ToolFailure> {
    if raw.is_empty() || raw.len() > MAX_RELATIVE_PATH_BYTES {
        return Err(ToolFailure::rejected(
            "agent.invalid_path",
            "workspace path is empty or too long",
            json!({"valid":false}),
        ));
    }
    let path = Path::new(raw);
    if path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(ToolFailure::rejected(
            "agent.path_escape",
            "workspace path must be relative and cannot contain parent components",
            json!({"valid":false}),
        ));
    }
    reject_sensitive_path(path)?;
    Ok(path.to_path_buf())
}

fn ensure_contained(root: &Path, canonical: &Path, requested: &Path) -> Result<(), ToolFailure> {
    if !canonical.starts_with(root) {
        return Err(ToolFailure::rejected(
            "agent.path_escape",
            "workspace path resolves outside the granted directory",
            json!({"path":relative_path_json(requested)}),
        ));
    }
    if let Ok(relative) = canonical.strip_prefix(root) {
        reject_sensitive_path(relative)?;
    }
    Ok(())
}

fn reject_sensitive_path(path: &Path) -> Result<(), ToolFailure> {
    for component in path.components() {
        let Component::Normal(value) = component else {
            continue;
        };
        let name = value.to_string_lossy().to_ascii_lowercase();
        let blocked_component = matches!(
            name.as_str(),
            ".git" | ".hg" | ".svn" | ".ssh" | ".gnupg" | ".codex"
        );
        let blocked_file = name == ".env"
            || name.starts_with(".env.")
            || matches!(name.as_str(), "id_rsa" | "id_ed25519")
            || [".pem", ".p12", ".pfx"]
                .iter()
                .any(|extension| name.ends_with(extension));
        if blocked_component || blocked_file {
            return Err(ToolFailure::rejected(
                "agent.sensitive_path",
                "workspace path is reserved for sensitive control or credential data",
                json!({"valid":false}),
            ));
        }
    }
    Ok(())
}

fn read_utf8_file(path: &Path) -> Result<(String, String, u64), ToolFailure> {
    let file = File::open(path).map_err(file_io_failure)?;
    let metadata = file.metadata().map_err(file_io_failure)?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err(ToolFailure::rejected(
            "agent.file_too_large",
            format!("file exceeds the {MAX_FILE_BYTES} byte limit"),
            json!({"bytes":metadata.len()}),
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(file_io_failure)?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(ToolFailure::rejected(
            "agent.file_too_large",
            format!("file exceeds the {MAX_FILE_BYTES} byte limit"),
            json!({"bytes":bytes.len()}),
        ));
    }
    let hash = sha256(&bytes);
    let content = String::from_utf8(bytes).map_err(|_| {
        ToolFailure::rejected(
            "agent.file_not_utf8",
            "file is not valid UTF-8 text",
            json!({"validUtf8":false}),
        )
    })?;
    let length = content.len() as u64;
    Ok((content, hash, length))
}

fn atomic_write(path: &Path, bytes: &[u8], preserve_permissions: bool) -> Result<(), ToolFailure> {
    let parent = path.parent().ok_or_else(|| {
        ToolFailure::rejected(
            "agent.invalid_path",
            "file parent directory is missing",
            json!({"valid":false}),
        )
    })?;
    let temp = parent.join(format!(".ielts-agent-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> std::io::Result<()> {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        if preserve_permissions {
            file.set_permissions(fs::metadata(path)?.permissions())?;
        }
        drop(file);
        replace_file(&temp, path)?;
        sync_parent(parent)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(file_io_failure)
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let moved = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(unix)]
fn sync_parent(parent: &Path) -> std::io::Result<()> {
    File::open(parent)?.sync_all()
}

#[cfg(not(unix))]
fn sync_parent(_parent: &Path) -> std::io::Result<()> {
    Ok(())
}

fn hash_matches(expected: &str, actual: &str) -> bool {
    expected.len() == 64
        && expected.bytes().all(|byte| byte.is_ascii_hexdigit())
        && expected.eq_ignore_ascii_case(actual)
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn hash_required(path: &str, actual: &str) -> AgentToolExecution {
    ToolFailure::rejected(
        "agent.file_hash_required",
        "expectedSha256 is required when modifying an existing file",
        json!({"path":path,"actualSha256":actual}),
    )
    .into_execution()
}

fn hash_conflict(path: &str, expected: &str, actual: &str) -> AgentToolExecution {
    ToolFailure::rejected(
        "agent.file_hash_conflict",
        "file changed after it was read; read it again before modifying",
        json!({"path":path,"expectedSha256":expected,"actualSha256":actual}),
    )
    .into_execution()
}

fn file_io_failure(error: std::io::Error) -> ToolFailure {
    ToolFailure::failed(
        "agent.file_io",
        format!("workspace file operation failed: {error}"),
        true,
        json!({}),
    )
}

fn relative_path_json(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

struct ToolFailure {
    rejected: bool,
    code: &'static str,
    message: String,
    retryable: bool,
    audit: Value,
}

impl ToolFailure {
    fn rejected(code: &'static str, message: impl Into<String>, audit: Value) -> Self {
        Self {
            rejected: true,
            code,
            message: message.into(),
            retryable: false,
            audit,
        }
    }

    fn failed(
        code: &'static str,
        message: impl Into<String>,
        retryable: bool,
        audit: Value,
    ) -> Self {
        Self {
            rejected: false,
            code,
            message: message.into(),
            retryable,
            audit,
        }
    }

    fn with_path(mut self, path: &str) -> Self {
        if let Some(object) = self.audit.as_object_mut() {
            object.insert("path".into(), Value::String(path.into()));
        }
        self
    }

    fn into_execution(self) -> AgentToolExecution {
        if self.rejected {
            AgentToolExecution::rejected(self.code, self.message, self.audit)
        } else {
            AgentToolExecution::failed(self.code, self.message, self.retryable, self.audit)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(name: &str, arguments: Value) -> AgentToolCall {
        AgentToolCall {
            id: "call-1".into(),
            name: name.into(),
            arguments_json: arguments.to_string(),
        }
    }

    #[tokio::test]
    async fn reads_and_hashes_utf8_file() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("note.txt"), "hello").unwrap();
        let tools = WorkspaceFileTools::new(directory.path().to_path_buf()).unwrap();
        let result = tools
            .execute(&call("read_file", json!({"path":"note.txt"})))
            .await;
        assert_eq!(result.status, ielts_application::AgentToolStatus::Succeeded);
        let payload: Value = serde_json::from_str(&result.model_content).unwrap();
        assert_eq!(payload["content"], "hello");
        assert_eq!(payload["sha256"], sha256(b"hello"));
    }

    #[tokio::test]
    async fn existing_write_requires_current_hash() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("note.txt");
        fs::write(&path, "before").unwrap();
        let tools = WorkspaceFileTools::new(directory.path().to_path_buf()).unwrap();

        let missing = tools
            .execute(&call(
                "write_file",
                json!({"path":"note.txt","content":"after"}),
            ))
            .await;
        assert_eq!(missing.error.unwrap().code, "agent.file_hash_required");
        let stale = tools
            .execute(&call(
                "write_file",
                json!({"path":"note.txt","content":"after","expectedSha256":"0000000000000000000000000000000000000000000000000000000000000000"}),
            ))
            .await;
        assert_eq!(stale.error.unwrap().code, "agent.file_hash_conflict");

        let success = tools
            .execute(&call(
                "write_file",
                json!({"path":"note.txt","content":"after","expectedSha256":sha256(b"before")}),
            ))
            .await;
        assert_eq!(
            success.status,
            ielts_application::AgentToolStatus::Succeeded
        );
        assert_eq!(fs::read_to_string(path).unwrap(), "after");
        assert!(directory.path().read_dir().unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".ielts-agent-")));
    }

    #[tokio::test]
    async fn creates_new_file_and_replaces_exact_text() {
        let directory = tempfile::tempdir().unwrap();
        let tools = WorkspaceFileTools::new(directory.path().to_path_buf()).unwrap();
        let created = tools
            .execute(&call(
                "write_file",
                json!({"path":"new.txt","content":"one one"}),
            ))
            .await;
        assert_eq!(
            created.status,
            ielts_application::AgentToolStatus::Succeeded
        );
        let replaced = tools
            .execute(&call(
                "replace_in_file",
                json!({
                    "path":"new.txt",
                    "oldText":"one",
                    "newText":"two",
                    "expectedSha256":sha256(b"one one"),
                    "replaceAll":true
                }),
            ))
            .await;
        assert_eq!(
            replaced.status,
            ielts_application::AgentToolStatus::Succeeded
        );
        assert_eq!(
            fs::read_to_string(directory.path().join("new.txt")).unwrap(),
            "two two"
        );
    }

    #[tokio::test]
    async fn rejects_escape_absolute_sensitive_and_non_utf8_paths() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("binary.bin"), [0xff, 0xfe]).unwrap();
        let tools = WorkspaceFileTools::new(directory.path().to_path_buf()).unwrap();
        let result = tools
            .execute(&call("read_file", json!({"path":"../outside.txt"})))
            .await;
        assert_eq!(result.error.unwrap().code, "agent.path_escape");
        let absolute = directory.path().join("binary.bin").display().to_string();
        let result = tools
            .execute(&call("read_file", json!({"path":absolute})))
            .await;
        assert_eq!(result.error.unwrap().code, "agent.path_escape");
        let result = tools
            .execute(&call("read_file", json!({"path":"binary.bin"})))
            .await;
        assert_eq!(result.error.unwrap().code, "agent.file_not_utf8");
    }

    #[test]
    fn rejects_every_sensitive_path_before_filesystem_access() {
        for path in [
            ".git/config",
            "nested/.HG/store",
            ".svn/entries",
            ".ssh/config",
            ".gnupg/private-keys-v1.d/key",
            ".codex/auth.json",
            ".env",
            "config/.env.local",
            "id_rsa",
            "nested/ID_ED25519",
            "certificate.pem",
            "keys/client.P12",
            "archive/identity.pfx",
        ] {
            let failure = validate_relative_path(path).unwrap_err();
            assert_eq!(failure.code, "agent.sensitive_path", "path: {path}");
        }
    }

    #[tokio::test]
    async fn rejects_symlink_escape() {
        let workspace = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.txt"), "outside").unwrap();
        let link = workspace.path().join("linked");
        create_directory_link(outside.path(), &link)
            .expect("the test must create a symlink or junction; skipping would hide a regression");
        let tools = WorkspaceFileTools::new(workspace.path().to_path_buf()).unwrap();
        let result = tools
            .execute(&call("read_file", json!({"path":"linked/secret.txt"})))
            .await;
        assert_eq!(result.error.unwrap().code, "agent.path_escape");
        let result = tools
            .execute(&call(
                "write_file",
                json!({"path":"linked/new.txt","content":"outside"}),
            ))
            .await;
        assert_eq!(result.error.unwrap().code, "agent.path_escape");
        assert!(!outside.path().join("new.txt").exists());
        remove_directory_link(&link).unwrap();
    }

    #[tokio::test]
    async fn enforces_size_limit_and_keeps_content_out_of_audit() {
        let directory = tempfile::tempdir().unwrap();
        let oversized = "x".repeat(MAX_FILE_BYTES as usize + 1);
        fs::write(directory.path().join("large.txt"), oversized.as_bytes()).unwrap();
        let tools = WorkspaceFileTools::new(directory.path().to_path_buf()).unwrap();

        let read = tools
            .execute(&call("read_file", json!({"path":"large.txt"})))
            .await;
        assert_eq!(read.error.unwrap().code, "agent.file_too_large");
        let write_call = call("write_file", json!({"path":"new.txt","content":oversized}));
        let audit = tools.audit_arguments(&write_call);
        assert_eq!(audit["contentBytes"], MAX_FILE_BYTES + 1);
        assert!(!audit.to_string().contains(&"x".repeat(100)));
        let write = tools.execute(&write_call).await;
        assert_eq!(write.error.unwrap().code, "agent.file_too_large");
        assert!(!directory.path().join("new.txt").exists());
    }

    #[tokio::test]
    async fn audit_payloads_exclude_file_bodies_for_every_file_tool() {
        let directory = tempfile::tempdir().unwrap();
        let marker = "PRIVATE_FILE_BODY_MARKER";
        fs::write(directory.path().join("note.txt"), marker).unwrap();
        let tools = WorkspaceFileTools::new(directory.path().to_path_buf()).unwrap();

        let read_call = call("read_file", json!({"path":"note.txt"}));
        let read_result = tools.execute(&read_call).await;
        assert!(!tools
            .audit_arguments(&read_call)
            .to_string()
            .contains(marker));
        assert!(!read_result.audit_result.to_string().contains(marker));

        let write_marker = format!("{marker}_WRITE");
        let write_call = call(
            "write_file",
            json!({"path":"created.txt","content":write_marker}),
        );
        let write_result = tools.execute(&write_call).await;
        assert!(!tools
            .audit_arguments(&write_call)
            .to_string()
            .contains(marker));
        assert!(!write_result.audit_result.to_string().contains(marker));

        let replace_marker = format!("{marker}_REPLACED");
        let replace_call = call(
            "replace_in_file",
            json!({
                "path":"note.txt",
                "oldText":marker,
                "newText":replace_marker,
                "expectedSha256":sha256(marker.as_bytes())
            }),
        );
        let replace_result = tools.execute(&replace_call).await;
        assert!(!tools
            .audit_arguments(&replace_call)
            .to_string()
            .contains(marker));
        assert!(!replace_result.audit_result.to_string().contains(marker));
    }

    #[cfg(unix)]
    fn create_directory_link(target: &Path, link: &Path) -> std::io::Result<()> {
        std::os::unix::fs::symlink(target, link)
    }

    #[cfg(windows)]
    fn create_directory_link(target: &Path, link: &Path) -> std::io::Result<()> {
        match std::os::windows::fs::symlink_dir(target, link) {
            Ok(()) => Ok(()),
            Err(symlink_error) => {
                let output = std::process::Command::new("cmd.exe")
                    .arg("/C")
                    .arg("mklink")
                    .arg("/J")
                    .arg(link)
                    .arg(target)
                    .output()?;
                if output.status.success() {
                    Ok(())
                } else {
                    Err(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        format!(
                            "symlink failed ({symlink_error}); junction failed: {}",
                            String::from_utf8_lossy(&output.stderr).trim()
                        ),
                    ))
                }
            }
        }
    }

    #[cfg(unix)]
    fn remove_directory_link(link: &Path) -> std::io::Result<()> {
        fs::remove_file(link)
    }

    #[cfg(windows)]
    fn remove_directory_link(link: &Path) -> std::io::Result<()> {
        fs::remove_dir(link)
    }
}
