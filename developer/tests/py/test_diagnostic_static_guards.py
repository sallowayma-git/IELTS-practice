import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location('diagnostic_static_guards', ROOT / 'developer/tests/ci/run_static_suite.py')
guards = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guards)


class DiagnosticStaticGuardsTest(unittest.TestCase):
    def test_shipped_generated_bootstrap_is_the_only_inline_exception(self):
        self.assertTrue(guards._check_index_no_inline_runtime(ROOT / 'index.html')[0])
        index = (ROOT / 'index.html').read_text(encoding='utf-8')
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'index.html'
            for tampered in [index.replace('</script>', 'alert(1);</script>', 1),
                             index.replace('</head>', '<script>alert(1)</script></head>'),
                             index.replace('function defineDiagnosticBootstrap', 'function changedBootstrap', 1)]:
                target.write_text(tampered, encoding='utf-8')
                self.assertFalse(guards._check_index_no_inline_runtime(target)[0])

    def test_resource_declarations_do_not_count_as_bundled_optional_data(self):
        self.assertTrue(guards._check_optional_listening_assets_not_bundled(
            ROOT / 'scripts/build-bundles.mjs', ROOT / 'js/bundles/core-foundation.bundle.js')[0])
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'bundle.js'
            for payload in ['global.listeningExamIndex = [', 'global.__LISTENING_EXAM_MANIFEST__ = ',
                            '/* ===== assets/generated/listening-exams/listening-index.compat.js ===== */']:
                target.write_text(payload, encoding='utf-8')
                self.assertFalse(guards._check_optional_listening_assets_not_bundled(
                    ROOT / 'scripts/build-bundles.mjs', target)[0])

    def test_only_verified_bootstrap_paths_are_excluded_from_html_source_reference_checks(self):
        index = (ROOT / 'index.html').read_text(encoding='utf-8')
        checked = guards._strip_verified_diagnostic_bootstrap(index)
        self.assertNotIn('js/data/v2/dataKernel.js', checked)
        bad = index + '<script src="js/data/v2/dataKernel.js"></script>'
        self.assertIn('js/data/v2/dataKernel.js', guards._strip_verified_diagnostic_bootstrap(bad))

    def test_reading_entry_uses_the_verified_generated_payload(self):
        entry = (ROOT / 'assets/generated/reading-exams/reading-practice-unified.html').read_text(encoding='utf-8')
        self.assertNotIn('function defineDiagnosticBootstrap', guards._strip_verified_diagnostic_bootstrap(entry))
        bad = entry.replace('function defineDiagnosticBootstrap', 'function tamperedBootstrap', 1)
        self.assertIn('function tamperedBootstrap', guards._strip_verified_diagnostic_bootstrap(bad))

    def test_listening_and_legacy_entries_require_exact_early_coverage_declarations(self):
        for file in ('assets/generated/listening-exams/listening-practice-unified.html', 'templates/template_base.html'):
            entry = (ROOT / file).read_text(encoding='utf-8')
            self.assertNotIn('function defineDiagnosticBootstrap', guards._strip_verified_diagnostic_bootstrap(entry))
            bad = entry.replace('"capture":"before-dependencies"', '"capture":"late-injection"')
            self.assertIn('function defineDiagnosticBootstrap', guards._strip_verified_diagnostic_bootstrap(bad))
