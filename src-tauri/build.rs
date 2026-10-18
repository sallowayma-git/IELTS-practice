use std::{env, fs, path::Path, path::PathBuf};
use sha2::{Digest, Sha256};

/// Release and packaging jobs set this to `1`; then a missing, mismatched or
/// placeholder sidecar fails the build instead of producing a degraded app.
const STRICT_ENV: &str = "IELTS_REQUIRE_FROZEN_SIDECAR";
/// Must equal `SIDECAR_UNAVAILABLE_BUILD_ID` in `src/cognitive_runtime.rs`.
/// It is not a SHA-256, so it can never match a real sidecar's hash.
const UNAVAILABLE_BUILD_ID: &str = "sidecar-unavailable";
/// PyInstaller onefile sidecars are tens of MiB; anything this small is a stub.
const MIN_SIDECAR_BYTES: usize = 1024 * 1024;
const BUILD_HINT: &str = "run developer/tests/ci/build_agent_runtime_sidecar.py";

fn main() {
    let target = env::var("TARGET").expect("Cargo TARGET is required");
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let binaries = manifest_dir.join("binaries");
    let hash_path = binaries.join(format!("ielts-agent-runtime-{target}.sha256"));
    let executable_suffix = if target.contains("windows") { ".exe" } else { "" };
    let sidecar_path = binaries.join(format!("ielts-agent-runtime-{target}{executable_suffix}"));
    println!("cargo:rerun-if-env-changed={STRICT_ENV}");
    // Watch the directory, not the files: a missing watched file would rerun
    // this script (and recompile the crate) on every build.
    println!("cargo:rerun-if-changed={}", binaries.display());
    let strict = env::var(STRICT_ENV).is_ok_and(|value| value == "1");
    let build_id = match frozen_sidecar_build_id(&hash_path, &sidecar_path) {
        Ok(build_id) => build_id,
        Err(problem) if strict => panic!("{STRICT_ENV}=1: {problem}; {BUILD_HINT}"),
        Err(problem) => {
            println!(
                "cargo:warning=building WITHOUT the agent runtime sidecar ({problem}); \
                 AI features will refuse to start. {BUILD_HINT} for a working app, and set \
                 {STRICT_ENV}=1 for release builds."
            );
            omit_external_bin();
            UNAVAILABLE_BUILD_ID.to_owned()
        }
    };
    println!("cargo:rustc-env=IELTS_AGENT_RUNTIME_BUILD_ID={build_id}");
    tauri_build::build()
}

fn frozen_sidecar_build_id(hash_path: &Path, sidecar_path: &Path) -> Result<String, String> {
    let build_id = fs::read_to_string(hash_path)
        .map_err(|error| format!("missing frozen Python sidecar hash {}: {error}", hash_path.display()))?
        .trim()
        .to_ascii_lowercase();
    if build_id.len() != 64 || !build_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(format!("invalid Python sidecar SHA-256 manifest {}", hash_path.display()));
    }
    let bytes = fs::read(sidecar_path)
        .map_err(|error| format!("missing frozen Python sidecar {}: {error}", sidecar_path.display()))?;
    if bytes.len() < MIN_SIDECAR_BYTES || !is_native_executable(&bytes) {
        return Err(format!(
            "{} is not a frozen PyInstaller executable (placeholder?)",
            sidecar_path.display()
        ));
    }
    if hex::encode(Sha256::digest(&bytes)) != build_id {
        return Err(format!(
            "frozen Python sidecar {} does not match its SHA-256 manifest",
            sidecar_path.display()
        ));
    }
    Ok(build_id)
}

fn is_native_executable(bytes: &[u8]) -> bool {
    const MAGICS: [&[u8]; 6] = [
        b"MZ",                     // PE (Windows)
        b"\x7fELF",                // ELF (Linux)
        b"\xcf\xfa\xed\xfe",       // Mach-O 64-bit
        b"\xce\xfa\xed\xfe",       // Mach-O 32-bit
        b"\xca\xfe\xba\xbe",       // Mach-O universal
        b"\xbe\xba\xfe\xca",       // Mach-O universal (swapped)
    ];
    MAGICS.iter().any(|magic| bytes.starts_with(magic))
}

/// Development builds without a sidecar still compile: drop `bundle.externalBin`
/// so tauri-build does not try to copy the missing binary. The merge patch keeps
/// any caller-provided `TAURI_CONFIG` (for example from the Tauri CLI).
fn omit_external_bin() {
    let mut patch = match env::var("TAURI_CONFIG") {
        Ok(existing) => serde_json::from_str(&existing).expect("TAURI_CONFIG must be JSON"),
        Err(_) => serde_json::json!({}),
    };
    let root = patch.as_object_mut().expect("TAURI_CONFIG must be a JSON object");
    let bundle = root.entry("bundle").or_insert_with(|| serde_json::json!({}));
    bundle
        .as_object_mut()
        .expect("TAURI_CONFIG bundle must be a JSON object")
        .insert("externalBin".into(), serde_json::Value::Null);
    env::set_var("TAURI_CONFIG", patch.to_string());
}
