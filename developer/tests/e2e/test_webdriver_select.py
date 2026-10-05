"""Driver selection against the installed WebView2 runtime. No registry, no app, no download."""
import tempfile
import unittest
from pathlib import Path

import webdriver_select as select


class WebDriverSelectionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="webdriver-select-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.versions: dict[str, str | None] = {}

    def driver(self, relative: str, version: str | None) -> str:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"")
        self.versions[str(path)] = version
        return str(path)

    def choose(self, runtime="154.0.4258.53", env=None, on_path=None):
        env = {"TEMP": str(self.root / "temp"), "LOCALAPPDATA": str(self.root / "local"),
               "PROGRAMFILES": str(self.root / "pf"), "PROGRAMFILES(X86)": str(self.root / "pf86"), **(env or {})}
        return select.select_native_driver(
            env, runtime_version=runtime, which=lambda name: (on_path or {}).get(name),
            version_of=lambda path: self.versions.get(path))

    def test_runtime_version_comes_from_the_registry_locations_in_order(self):
        seen = []
        def read(hive, subkey):
            seen.append((hive, subkey.split("\\")[1]))
            return "154.0.4258.53" if hive == "HKCU" else None
        self.assertEqual(select.installed_webview2_version(read), "154.0.4258.53")
        self.assertEqual(seen, [("HKLM", "WOW6432Node"), ("HKLM", "Microsoft"), ("HKCU", "Microsoft")])
        self.assertIn("WOW6432Node", select.REGISTRY_LOCATIONS[0][1])
        self.assertTrue(select.REGISTRY_LOCATIONS[0][1].endswith("{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"))
        self.assertIsNone(select.installed_webview2_version(lambda hive, subkey: None))

    def test_major_matching_ignores_everything_else(self):
        self.assertEqual(select.major_of("Microsoft Edge WebDriver 154.0.4258.53 (5af6e80)"), 154)
        self.assertEqual(select.major_of("ChromeDriver 150.0.1.2"), 150)
        self.assertIsNone(select.major_of("garbage"))

    def test_the_stale_default_is_skipped_for_the_temp_driver_that_matches(self):
        stale = self.driver("local/IELTSAtlas/webdriver/msedgedriver.exe", "150.0.7000.1")
        fresh = self.driver("temp/ielts-msedgedriver-154.0.4258.53/msedgedriver.exe", "154.0.4258.53")
        chosen = self.choose()
        self.assertEqual((chosen.path, chosen.version), (fresh, "154.0.4258.53"))
        self.assertTrue(chosen.checked_against_runtime)
        self.assertEqual(chosen.source, "%TEMP%/ielts-msedgedriver-154.0.4258.53")
        self.assertEqual(chosen.skipped, ())  # the stale default is never even reached
        self.assertNotEqual(chosen.path, stale)

    def test_explicit_env_wins_when_it_matches_and_is_passed_over_when_it_does_not(self):
        wrong = self.driver("env/msedgedriver.exe", "150.0.7000.1")
        right = self.driver("temp/ielts-msedgedriver-154.0.4258.53/msedgedriver.exe", "154.0.4258.53")
        chosen = self.choose(env={select.ENV_NAME: wrong})
        self.assertEqual(chosen.path, right)
        self.assertEqual([(source, path, version) for source, path, version in chosen.skipped],
                         [(select.ENV_NAME, wrong, "150.0.7000.1")])
        matching_env = self.driver("env2/msedgedriver.exe", "154.0.4258.99")
        self.assertEqual(self.choose(env={select.ENV_NAME: matching_env}).path, matching_env)

    def test_path_entries_and_env_names_resolved_through_path_are_candidates(self):
        on_path = self.driver("bin/msedgedriver.exe", "154.0.4258.53")
        self.assertEqual(self.choose(on_path={"msedgedriver": on_path}).path, on_path)
        named = self.driver("bin/custom-driver.exe", "154.1.1.1")
        self.assertEqual(self.choose(env={select.ENV_NAME: "custom"}, on_path={"custom": named}).path, named)

    def test_newest_temp_driver_is_preferred_among_matches_and_dedupe_holds(self):
        self.driver("temp/ielts-msedgedriver-154.0.4258.53/msedgedriver.exe", "154.0.4258.53")
        newer = self.driver("temp/ielts-msedgedriver-154.0.4300.1/msedgedriver.exe", "154.0.4300.1")
        self.driver("temp/ielts-msedgedriver-150.0.7000.1/msedgedriver.exe", "150.0.7000.1")
        self.assertEqual(self.choose().path, newer)
        found = select.candidate_drivers(
            {"TEMP": str(self.root / "temp"), select.ENV_NAME: newer}, lambda name: newer)
        self.assertEqual([path for _, path in found].count(newer), 1)

    def test_no_match_fails_with_an_actionable_message_and_no_download(self):
        self.driver("local/IELTSAtlas/webdriver/msedgedriver.exe", "150.0.7000.1")
        self.driver("pf86/Microsoft/Edge/Application/msedgedriver.exe", None)
        with self.assertRaises(select.DriverSelectionError) as raised:
            self.choose()
        message = str(raised.exception)
        for expected in ("154.0.4258.53", "major 154", "150.0.7000.1", "unreadable", "TAURI_NATIVE_DRIVER",
                         "https://msedgedriver.microsoft.com/154.0.4258.53/edgedriver_win64.zip",
                         "ielts-msedgedriver-154.0.4258.53", "never downloads"):
            self.assertIn(expected, message)

    def test_no_driver_at_all_is_a_clear_failure_too(self):
        with self.assertRaisesRegex(select.DriverSelectionError, "No msedgedriver/chromedriver was found.*154.0.4258.53"):
            self.choose()

    def test_unknown_runtime_keeps_the_unchecked_first_driver_behaviour(self):
        only = self.driver("local/IELTSAtlas/webdriver/msedgedriver.exe", "150.0.7000.1")
        chosen = select.select_native_driver(
            {"LOCALAPPDATA": str(self.root / "local"), "TEMP": str(self.root / "temp")},
            runtime_version=None, read_runtime=lambda: None, which=lambda name: None,
            version_of=lambda path: self.versions.get(path))
        self.assertEqual(chosen.path, only)
        self.assertFalse(chosen.checked_against_runtime)

    def test_the_selection_module_cannot_download(self):
        source = Path(select.__file__).read_text(encoding="utf-8")
        for forbidden in ("urllib", "requests", "http.client", "Invoke-WebRequest", "urlretrieve"):
            self.assertNotIn(forbidden, source.replace("https://msedgedriver.microsoft.com", ""))


if __name__ == "__main__":
    unittest.main()
