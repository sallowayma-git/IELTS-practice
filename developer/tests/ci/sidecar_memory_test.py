"""Regression coverage for cross-platform frozen-runtime memory evidence."""
import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import psutil
import smoke_agent_runtime_sidecar as smoke


class SidecarMemoryTests(unittest.TestCase):
    def test_counts_bootloader_runtime_and_descendants_on_every_platform(self):
        root, runtime, worker = Mock(), Mock(), Mock()
        root.children.return_value = [runtime, worker]
        for process, rss in zip((root, runtime, worker), (6, 30, 10)):
            process.memory_info.return_value = SimpleNamespace(rss=rss * 1024 * 1024)
        for platform in ("win32", "darwin", "linux"):
            with self.subTest(platform=platform), patch.object(smoke.sys, "platform", platform):
                with patch.object(smoke.psutil, "Process", return_value=root):
                    self.assertEqual(smoke.process_tree_rss_bytes(123), (46 * 1024 * 1024, 3))
                    root.children.assert_called_with(recursive=True)

    def test_zero_measurement_is_not_accepted_as_real_memory_evidence(self):
        root = Mock()
        root.children.return_value = []
        root.memory_info.return_value = SimpleNamespace(rss=0)
        with patch.object(smoke.psutil, "Process", return_value=root):
            with self.assertRaisesRegex(RuntimeError, "measurement was unavailable"):
                smoke.process_tree_rss_bytes(123)

    def test_inaccessible_runtime_does_not_fall_back_to_bootloader_only(self):
        root, runtime = Mock(), Mock()
        root.children.return_value = [runtime]
        root.memory_info.return_value = SimpleNamespace(rss=6 * 1024 * 1024)
        runtime.memory_info.side_effect = psutil.AccessDenied(456)
        with patch.object(smoke.psutil, "Process", return_value=root):
            with self.assertRaises(psutil.AccessDenied):
                smoke.process_tree_rss_bytes(123)

    def test_memory_budget_rejects_missing_and_over_limit_rss_on_all_platforms(self):
        for platform in ("win32", "darwin", "linux"):
            with self.subTest(platform=platform), patch.object(smoke.sys, "platform", platform):
                for rss, expected in ((0, False), (smoke.MAX_IDLE_RSS_BYTES, True),
                                      (smoke.MAX_IDLE_RSS_BYTES + 1, False)):
                    self.assertEqual(smoke.release_thresholds(1, 1, 1, rss, 100)["idleRss"], expected)

    def test_cold_start_budget_remains_specific_to_reference_windows(self):
        for platform in ("win32", "darwin", "linux"):
            with self.subTest(platform=platform), patch.object(smoke.sys, "platform", platform):
                result = smoke.release_thresholds(1, 1, 1, 1024, smoke.MAX_WINDOWS_COLD_START_MS + 1)
                self.assertEqual(result["coldStart"], platform != "win32")

    def test_actual_host_process_has_positive_resident_memory(self):
        rss, process_count = smoke.process_tree_rss_bytes(os.getpid())
        self.assertGreater(rss, 0)
        self.assertGreaterEqual(process_count, 1)


if __name__ == "__main__":
    unittest.main()
