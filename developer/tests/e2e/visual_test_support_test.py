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
              :root {
                --anth-shadow-1: 0 1px 0 rgba(31, 29, 26, .04), 0 1px 3px rgba(31, 29, 26, .07);
                --anth-shadow-2: 0 2px 6px rgba(31, 29, 26, .07), 0 12px 28px rgba(31, 29, 26, .10);
                --anth-shadow-inset: inset 0 1px 2px rgba(31, 29, 26, .14);
                --anth-highlight: inset 0 1px 0 rgba(255, 255, 255, .14);
                --anth-focus-ring: 0 0 0 2px #F7F5EF, 0 0 0 4px #B4552F;
                --anth-shadow-xs: 0 1px 1px rgb(0 0 0 / 10%); --anth-shadow-sm: none;
              }
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

    def shadow_on_surface(self, value):
        self.page.locator('.surface').evaluate(
            '(node, value) => { node.style.boxShadow = value; }', value,
        )

    def test_paper_token_shadows_are_accepted(self):
        for value in (
            'var(--anth-shadow-1)', 'var(--anth-shadow-2)', 'var(--anth-shadow-inset)',
            'var(--anth-highlight), var(--anth-shadow-1)', 'var(--anth-focus-ring)',
        ):
            with self.subTest(value=value):
                self.shadow_on_surface(value)
                assert_flat_surfaces(self.page, '.surface', value)

    def test_paper_non_token_shadow_is_rejected(self):
        self.shadow_on_surface('0 1px 2px black')
        with self.assertRaisesRegex(AssertionError, 'approved tokens'):
            assert_flat_surfaces(self.page, '.surface', 'literal shadow')

    def test_paper_heavy_blur_is_rejected(self):
        self.shadow_on_surface('var(--anth-shadow-1), 0 2px 40px rgba(31, 29, 26, .10)')
        with self.assertRaises(AssertionError):
            assert_flat_surfaces(self.page, '.surface', 'heavy blur')

    def test_exam_scope_stays_strict(self):
        self.page.set_content("""
            <style>
              :root { --anth-shadow-1: 0 1px 3px rgba(31, 29, 26, .07); --anth-shadow-xs: 0 1px 1px rgb(0 0 0 / 10%); --anth-shadow-sm: none; }
              .surface { width: 120px; height: 40px; background: white; }
            </style>
            <div class="atlas-exam"><div class="surface">Surface</div></div>
        """)
        self.shadow_on_surface('var(--anth-shadow-xs)')
        assert_flat_surfaces(self.page, '.surface', 'exam subtle shadow')
        self.shadow_on_surface('var(--anth-shadow-1)')
        with self.assertRaisesRegex(AssertionError, 'approved tokens'):
            assert_flat_surfaces(self.page, '.surface', 'exam elevated shadow')

    def test_gradient_still_rejected_on_paper(self):
        self.page.locator('.surface').evaluate(
            "node => { node.style.backgroundImage = 'linear-gradient(white, black)'; }",
        )
        with self.assertRaises(AssertionError):
            assert_flat_surfaces(self.page, '.surface', 'gradient')

if __name__ == '__main__':
    unittest.main()
