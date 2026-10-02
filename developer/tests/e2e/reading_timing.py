"""Run Reading Timing acceptance checks with Node Playwright."""
from pathlib import Path
import subprocess

if __name__ == "__main__":
    raise SystemExit(subprocess.run(["node", str(Path(__file__).with_suffix(".node.js"))], check=False).returncode)
