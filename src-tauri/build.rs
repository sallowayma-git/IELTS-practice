use std::{env, fs, path::PathBuf};
use sha2::{Digest, Sha256};

fn main() {
    let target = env::var("TARGET").expect("Cargo TARGET is required");
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let hash_path = manifest_dir
        .join("binaries")
        .join(format!("ielts-agent-runtime-{target}.sha256"));
    let executable_suffix = if target.contains("windows") { ".exe" } else { "" };
    let sidecar_path = manifest_dir
        .join("binaries")
        .join(format!("ielts-agent-runtime-{target}{executable_suffix}"));
    println!("cargo:rerun-if-changed={}", hash_path.display());
    println!("cargo:rerun-if-changed={}", sidecar_path.display());
    let build_id = fs::read_to_string(&hash_path)
        .unwrap_or_else(|error| {
            panic!(
                "missing frozen Python sidecar hash {}: {error}; run developer/tests/ci/build_agent_runtime_sidecar.py",
                hash_path.display()
            )
        })
        .trim()
        .to_owned();
    assert!(
        build_id.len() == 64 && build_id.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "invalid Python sidecar SHA-256 manifest"
    );
    let bytes = fs::read(&sidecar_path).unwrap_or_else(|error| {
        panic!(
            "missing frozen Python sidecar {}: {error}; run developer/tests/ci/build_agent_runtime_sidecar.py",
            sidecar_path.display()
        )
    });
    let actual = hex::encode(Sha256::digest(bytes));
    assert_eq!(
        actual,
        build_id.to_ascii_lowercase(),
        "frozen Python sidecar does not match its SHA-256 manifest"
    );
    println!("cargo:rustc-env=IELTS_AGENT_RUNTIME_BUILD_ID={build_id}");
    tauri_build::build()
}
