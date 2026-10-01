"""Capture host output after a failed WebDriver flow; never replace its result."""
import json
import os
import subprocess
import tempfile
from pathlib import Path

import psutil

from packaged_tauri_flow import ROOT, sha256_file, stage_test_runtime


def main() -> None:
    app = Path(os.environ["TAURI_APP_BINARY"]).resolve()
    reports = ROOT / "developer/tests/e2e/reports/native-diagnostics"
    reports.mkdir(parents=True, exist_ok=True)
    staged, runtime = stage_test_runtime(app)
    result = {
        "purpose": "Startup diagnosis only; the failed practice-flow result remains required.",
        "applicationSha256": sha256_file(app),
        "observationSeconds": 15,
    }
    with staged, tempfile.TemporaryDirectory(prefix="ielts-startup-probe-") as appdata:
        with (reports / "direct-startup.log").open("wb") as output:
            process = subprocess.Popen(
                [str(runtime)], stdout=output, stderr=subprocess.STDOUT,
                env={**os.environ, "APPDATA": appdata, "RUST_BACKTRACE": "1",
                     "WEBVIEW2_USER_DATA_FOLDER": str(Path(appdata) / "webview")},
            )
            try:
                result["exitCode"] = process.wait(timeout=15)
                result["state"] = "exited"
            except subprocess.TimeoutExpired:
                result["state"] = "running-after-observation"
            finally:
                if process.poll() is None:
                    descendants = psutil.Process(process.pid).children(recursive=True)
                    subprocess.run(["taskkill.exe", "/PID", str(process.pid), "/T", "/F"],
                                   capture_output=True, timeout=10, check=False)
                    process.wait(timeout=5)
                    _, alive = psutil.wait_procs(descendants, timeout=5)
                    for child in alive:
                        child.kill()
                    psutil.wait_procs(alive, timeout=5)
            (reports / "direct-startup.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
