# XiaoDaiDai Dashboard Screenshot Workflow

This memo documents how to regenerate the four XiaoDaiDai theme interface screenshots requested by design review.

## Prerequisites
- Python 3.10+
- Playwright with Chromium driver available in the container

## Steps
1. Start a static server from the repository root:
   ```bash
   python -m http.server 8000
   ```
2. In another shell, run the Playwright helper script:
   ```bash
   python developer/tools/capture_xiaodaidai_screens.py
   ```
   The script opens `.superdesign/design_iterations/xiaodaidai_dashboard_1.html`, cycles the navigation (overview, browse, practice, settings) and saves PNG files to `artifacts/`.
3. Upload the generated PNG artifacts when responding to stakeholders.

## Notes
- Ensure cached data is cleared between captures to avoid stale statistics overlays.
- The virtualized question list requires a brief pause (`await asyncio.sleep(1)`) after switching views so that the container stabilizes before the screenshot is taken.
