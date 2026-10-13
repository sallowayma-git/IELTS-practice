"""Exercise review scheduling, browser replay and a large isolated history."""
from pathlib import Path
import os
import subprocess

if __name__ == "__main__":
    env = dict(os.environ, REVIEW_STRESS="1", RECORDS="1000")
    script = Path(__file__).with_name("navigation_performance.node.js")
    raise SystemExit(subprocess.run(["node", str(script)], env=env, check=False).returncode)
