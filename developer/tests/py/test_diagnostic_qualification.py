import importlib.util
from pathlib import Path
import sys
import unittest

E2E = Path(__file__).resolve().parents[1] / 'e2e'
sys.path.insert(0, str(E2E))
SPEC = importlib.util.spec_from_file_location('diagnostic_qualification', E2E / 'diagnostic_qualification.py')
qualification = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(qualification)


class QualificationEvidenceTest(unittest.TestCase):
    def rows(self):
        return [{'mode': mode, 'scenario': 'synthetic-case', 'passed': True, 'error': 'PRIVATE_TOKEN',
                 'answers': 'PRIVATE_ANSWER'} for mode in qualification.MODES]

    def test_only_allowlisted_evidence_survives(self):
        result = qualification.evidence_rows({'results': self.rows()}, 1)
        self.assertEqual(len(result), 3)
        self.assertNotIn('PRIVATE', str(result))
        self.assertEqual(set(result[0]), {'mode', 'scenario', 'result'})

    def test_empty_failed_duplicate_partial_and_hostile_reports_cannot_pass(self):
        for rows in [[], self.rows()[:2], self.rows() + self.rows()[:1],
                     [{**row, 'passed': False} for row in self.rows()],
                     [{**row, 'scenario': 'C:/PRIVATE'} for row in self.rows()],
                     [{**row, 'mode': 'unknown'} for row in self.rows()]]:
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                qualification.evidence_rows(rows, 1)
        with self.assertRaises(ValueError):
            qualification.evidence_rows(self.rows(), 2)
        with self.assertRaises(ValueError):
            qualification.evidence_rows([{**row, 'passed': False, 'status': 'pass'} for row in self.rows()], 1)

    def test_source_gate_covers_all_criteria_and_package_has_real_practice_contexts(self):
        self.assertEqual(set(range(1, 13)), {c for suite in qualification.SUITES for c in suite[3]})
        self.assertTrue({'reading_diagnostics', 'listening_diagnostics', 'diagnostic_settings', 'diagnostic_acceptance'}
                        <= {suite[0] for suite in qualification.SUITES if suite[4]})

    def test_partial_failure_retains_only_sanitized_checkpoint_evidence(self):
        rows = [{**self.rows()[0], 'passed': False}]
        self.assertEqual(qualification.evidence_rows(rows, 0, partial=True),
                         [{'mode': 'file', 'scenario': 'synthetic-case', 'result': 'fail'}])

    def test_failure_location_excludes_paths_and_error_payloads(self):
        rows = [{**self.rows()[0], 'passed': False,
                 'error': 'PRIVATE_ANSWER\n at file:///C:/PRIVATE/listening_diagnostics.node.js:231:17'}]
        result = qualification.evidence_rows(rows, 0, partial=True, script='listening_diagnostics')
        self.assertEqual(result, [{'mode': 'file', 'scenario': 'synthetic-case', 'result': 'fail', 'sourceLine': 231}])
        self.assertNotIn('PRIVATE', str(result))
        self.assertNotIn('sourceLine', qualification.evidence_rows(rows, 0, partial=True, script='diagnostic_settings')[0])

    def test_submission_checkpoints_keep_only_fixed_boolean_fields_on_failures(self):
        row = {**self.rows()[0], 'passed': False, 'submitCheckpoint': {
            'completionReceived': True, 'ackAttempted': False, 'nackAttempted': 'PRIVATE_TOKEN',
            'answers': 'PRIVATE_ANSWER', 'sessionId': 'PRIVATE_SESSION'}}
        result = qualification.evidence_rows([row], 0, partial=True, script='listening_diagnostics')
        self.assertEqual(result[0]['submitCheckpoint'], {'completionReceived': True, 'ackAttempted': False})
        self.assertNotIn('PRIVATE', str(result))
        self.assertNotIn('submitCheckpoint', qualification.evidence_rows(
            [row], 0, partial=True, script='reading_diagnostics')[0])
        self.assertNotIn('submitCheckpoint', qualification.evidence_rows(
            [{**row, 'passed': True}], 0, partial=True, script='listening_diagnostics')[0])
