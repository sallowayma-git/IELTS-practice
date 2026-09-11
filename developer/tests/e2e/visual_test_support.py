"""Shared behavioral and current-theme checks for the Vue visual fixtures."""

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


def assert_flat_surfaces(page, selector, name):
    """The shipping skin permits hairline elevation, not the retired glass layers."""
    surfaces = page.evaluate(
        """selector => {
          const probe = document.createElement('span');
          document.body.append(probe);
          const subtleShadows = ['--anth-shadow-xs', '--anth-shadow-sm'].map(token => {
            probe.style.boxShadow = `var(${token})`;
            return getComputedStyle(probe).boxShadow;
          });
          probe.remove();
          return [...document.querySelectorAll(selector)].map(node => {
            const style = getComputedStyle(node);
            return {
              background: style.backgroundImage,
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
        if surface["background"] != "none" or surface["shadow"] not in ("none", *surface["subtleShadows"]):
            raise AssertionError(f"{name}: surface violates the opaque, hairline-elevation theme: {surface}")
        if surface["width"] <= 0:
            raise AssertionError(f"{name}: surface collapsed: {surface}")


def assert_document_unlocked(page, name):
    overflow = page.evaluate("() => [document.documentElement, document.body].map(node => getComputedStyle(node).overflowY)")
    if "hidden" in overflow:
        raise AssertionError(f"{name}: closing the overlay did not release document scrolling: {overflow}")
