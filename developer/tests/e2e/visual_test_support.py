"""Shared behavioral and current-theme checks for the Vue visual fixtures."""

import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from contextlib import contextmanager
from pathlib import Path


def capture_state(page, name):
    destination = Path(__file__).parent / 'reports' / f'{name}-current.png'
    page.screenshot(path=str(destination), full_page=True)


def wait_for_route_layout(page, selector):
    """Wait for the routed view and finite entry motion, never for a CSS value."""
    page.wait_for_selector(selector)
    page.evaluate(
        """async () => {
          const finite = document.getAnimations().filter(animation =>
            Number.isFinite(animation.effect?.getComputedTiming().endTime));
          await Promise.all(finite.map(animation => animation.finished.catch(() => {})));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }"""
    )


def _computed_color_alpha(color):
    """Read alpha from legacy and modern CSSOM color serializations."""
    if color == 'transparent':
        return 0.0
    match = re.fullmatch(r'(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(([^()]*)\)', color)
    if not match:
        raise AssertionError(f'Unsupported computed background color: {color}')
    components = match.group(1)
    if '/' in components:
        alpha = components.rsplit('/', 1)[1].strip()
    elif color.startswith(('rgba(', 'hsla(')) and ',' in components:
        alpha = components.rsplit(',', 1)[1].strip()
    else:
        return 1.0
    return float(alpha.rstrip('%')) / (100 if alpha.endswith('%') else 1)


def assert_flat_surfaces(page, selector, name):
    """The shipping skin permits hairline elevation, not the retired glass layers."""
    surfaces = page.evaluate(
        """selector => {
          // Probe inside the surface's own theme root: the exam routes keep
          // their frozen tokens, the paper routes have no elevation at all.
          const probe = document.createElement('span');
          (document.querySelector(selector)?.parentElement || document.body).append(probe);
          const subtleShadows = ['--anth-shadow-xs', '--anth-shadow-sm'].map(token => {
            probe.style.boxShadow = `var(${token})`;
            return getComputedStyle(probe).boxShadow;
          });
          probe.remove();
          return [...document.querySelectorAll(selector)].map(node => {
            const style = getComputedStyle(node);
            return {
              classes: node.className,
              backgroundImage: style.backgroundImage,
              backgroundColor: style.backgroundColor,
              shadow: style.boxShadow,
              subtleShadows,
              width: node.getBoundingClientRect().width,
            };
          });
        }""",
        selector,
    )
    if not surfaces:
        raise AssertionError(f"{name}: no surfaces matched {selector}")
    for surface in surfaces:
        surface['backgroundAlpha'] = _computed_color_alpha(surface['backgroundColor'])
        if (
            surface['backgroundImage'] != 'none'
            or surface['backgroundAlpha'] != 1.0
            or surface['shadow'] not in ('none', *surface['subtleShadows'])
        ):
            raise AssertionError(f"{name}: surface violates the opaque, hairline-elevation theme: {surface}")
        if surface["width"] <= 0:
            raise AssertionError(f"{name}: surface collapsed: {surface}")


def assert_document_unlocked(page, name):
    overflow = page.evaluate("() => [document.documentElement, document.body].map(node => getComputedStyle(node).overflowY)")
    if "hidden" in overflow:
        raise AssertionError(f"{name}: closing the overlay did not release document scrolling: {overflow}")


@contextmanager
def flagged_preview(**flags):
    """Serve a throwaway Vue build with VITE_FEATURE_* flags switched on.

    Developer-only routes (e.g. /dev/agent) are not registered in the shipping
    build, so their checks build their own bundle instead of the shared dist.
    """
    root = Path(__file__).resolve().parents[3]
    npm = shutil.which('npm.cmd') or shutil.which('npm')
    with tempfile.TemporaryDirectory(prefix='atlas-flagged-dist-') as out_dir:
        environment = {**os.environ, **{name: 'true' for name in flags}}
        subprocess.run(
            [npm, 'exec', '--', 'vite', 'build', '--outDir', out_dir, '--emptyOutDir', '--logLevel', 'warn'],
            cwd=root / 'apps/writing-vue', env=environment, check=True, timeout=300,
        )
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        server = subprocess.Popen(
            [sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '--directory', out_dir],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        base_url = f'http://127.0.0.1:{port}'
        try:
            for _ in range(80):
                try:
                    urllib.request.urlopen(base_url, timeout=1)
                    break
                except OSError:
                    time.sleep(0.25)
            yield base_url
        finally:
            server.kill()
            server.wait(timeout=5)
