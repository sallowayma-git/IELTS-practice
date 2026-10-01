"""Browser-backed regression tests for the shared visual assertions."""

import unittest

from playwright.sync_api import sync_playwright

from visual_test_support import assert_flat_surfaces


class VisualSurfaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.page = self.browser.new_page()
        self.page.set_content("""
            <style>
              :root { --anth-shadow-xs: 0 1px 1px rgb(0 0 0 / 10%); --anth-shadow-sm: none; }
              .surface { width: 120px; height: 40px; background: white; }
            </style>
            <div class="surface">Surface</div>
        """)

    def tearDown(self):
        self.page.close()

    def set_background(self, color):
        self.page.locator('.surface').evaluate(
            '(node, color) => { node.style.backgroundColor = color; }', color,
        )

    def test_opaque_colors_are_accepted(self):
        for color in (
            'white', 'rgba(255, 255, 255, 1)', 'rgb(255 255 255 / 100%)',
            'color(srgb 1 1 1)', 'color(display-p3 1 1 1 / 1)',
            'oklch(100% 0 0 / 100%)', 'color-mix(in srgb, white 52%, black)',
        ):
            with self.subTest(color=color):
                self.set_background(color)
                assert_flat_surfaces(self.page, '.surface', color)

    def test_non_opaque_colors_are_rejected(self):
        for color in (
            'transparent', 'rgba(255, 255, 255, 0)', 'rgba(255, 255, 255, 0.5)',
            'rgba(255, 255, 255, 0.99)', 'rgb(255 255 255 / 50%)',
            'color(srgb 1 1 1 / 0.5)', 'color(display-p3 1 1 1 / 50%)',
            'oklch(100% 0 0 / 50%)', 'color-mix(in srgb, white 52%, transparent)',
            'color(srgb 1 1 1 / 0.999)', 'color-mix(in srgb, white 99.9%, transparent)',
        ):
            with self.subTest(color=color):
                self.set_background(color)
                with self.assertRaisesRegex(AssertionError, 'opaque'):
                    assert_flat_surfaces(self.page, '.surface', color)

    def test_every_matched_surface_must_be_opaque(self):
        self.page.locator('.surface').evaluate("""node => {
            const transparentSibling = node.cloneNode(true);
            transparentSibling.style.backgroundColor = 'transparent';
            node.after(transparentSibling);
        }""")
        with self.assertRaisesRegex(AssertionError, 'opaque'):
            assert_flat_surfaces(self.page, '.surface', 'mixed surfaces')

    def test_gradients_remain_rejected(self):
        self.page.locator('.surface').evaluate(
            "node => { node.style.backgroundImage = 'linear-gradient(white, black)'; }",
        )
        with self.assertRaises(AssertionError):
            assert_flat_surfaces(self.page, '.surface', 'gradient')

    def test_only_theme_shadows_are_accepted(self):
        self.page.locator('.surface').evaluate(
            "node => { node.style.boxShadow = 'var(--anth-shadow-xs)'; }",
        )
        assert_flat_surfaces(self.page, '.surface', 'hairline shadow')
        self.page.locator('.surface').evaluate(
            "node => { node.style.boxShadow = '0 12px 24px black'; }",
        )
        with self.assertRaises(AssertionError):
            assert_flat_surfaces(self.page, '.surface', 'heavy shadow')


if __name__ == '__main__':
    unittest.main()
