"""Additional boundary/CLI risks absent from the original hand-worked tests.

These tests do not change the baseline tests or derive the normal trace from
the production engine.  CLI inputs are parsed as untrusted data.
"""

import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from oracle.reference import InvalidEvidence, case_digest, evaluate_case, evaluate_suite, expected_pulses


ROOT = Path(__file__).resolve().parents[1]
NORMAL = [
    {"tick": 6, "lamp": "left"}, {"tick": 10, "lamp": "right"},
    {"tick": 14, "lamp": "left"}, {"tick": 18, "lamp": "right"},
    {"tick": 18, "lamp": "center"},
]


def task(case_id="normal", *, active=True):
    return {
        "schema_version": "1.0", "case_id": case_id, "handover_tick": 0,
        "enqueue_until_tick": 16, "initial_world": {"scene_id": "blue", "active": active},
        "transitions": [],
    }


def observed(case, pulses):
    return {
        "schema_version": "1.0", "case_id": case["case_id"],
        "case_sha256": case_digest(case), "candidate_sha256": "a" * 64,
        "status": "complete", "terminal_reason": "submitted",
        "handover_tick": case["handover_tick"],
        "observed_through_tick": case["enqueue_until_tick"] + 2,
        "budget_exhausted": False, "reset_during_attempt": False,
        "pulses": copy.deepcopy(pulses),
    }


class ReferenceBoundaryTests(unittest.TestCase):
    def test_suite_cannot_pass_without_any_required_pulse(self):
        c = task(active=False)
        self.assertTrue(evaluate_case(c, observed(c, []))["passed"])
        with self.assertRaises(InvalidEvidence):
            evaluate_suite([c], [observed(c, [])])
        with self.assertRaises(InvalidEvidence):
            evaluate_suite([], [])

    def test_empty_case_allowed_alongside_liveness_and_observation_order_irrelevant(self):
        # Both continuations inherit the same active world at boundary zero.
        # Only the future suffix differs; changing initial_world would instead
        # describe two different candidates and must be rejected.
        empty = task("inactive")
        empty["transitions"] = [{"tick": 1, "scene_id": "blue", "active": False}]
        live = task("active")
        verdict = evaluate_suite(
            [empty, live], [observed(live, NORMAL), observed(empty, [])]
        )
        self.assertTrue(verdict["passed"])
        self.assertEqual(verdict["case_count"], 2)
        self.assertEqual(verdict["missing"], [])
        self.assertEqual(verdict["extra"], [])

    def test_case_nested_types_identifiers_and_bounds_are_strict(self):
        edits = [
            lambda c: c.update(handover_tick=True),
            lambda c: c.update(enqueue_until_tick=4095),
            lambda c: c.update(case_id="not ASCII \u2603"),
            lambda c: c["initial_world"].update(active=1),
            lambda c: c["initial_world"].update(epoch=42),
            lambda c: c["transitions"].append({"tick": 19, "scene_id": "blue", "active": False}),
        ]
        for edit in edits:
            with self.subTest(edit=edit):
                c = task()
                edit(c)
                with self.assertRaises(InvalidEvidence):
                    expected_pulses(c)
        upper = task()
        upper.update(handover_tick=4093, enqueue_until_tick=4094)
        self.assertEqual(expected_pulses(upper), [{"tick": 4094, "lamp": "left"}])

    def test_nested_observation_types_and_flags_reject_non_json_equivalences(self):
        edits = [
            lambda o: o.update(candidate_sha256=[]),
            lambda o: o.update(reset_during_attempt=0),
            lambda o: o.update(budget_exhausted=0),
            lambda o: o["pulses"][0].update(lamp=["left"]),
            lambda o: o["pulses"][0].update(count=1),
        ]
        c = task()
        for edit in edits:
            with self.subTest(edit=edit):
                o = observed(c, NORMAL)
                edit(o)
                with self.assertRaises(InvalidEvidence):
                    evaluate_case(c, o)


class ReferenceCliTests(unittest.TestCase):
    def run_cli(self, cases_text, observations_text):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            (base / "cases.json").write_text(cases_text, encoding="utf-8")
            (base / "observations.json").write_text(observations_text, encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(ROOT / "oracle/reference.py"),
                 str(base / "cases.json"), str(base / "observations.json")],
                capture_output=True, text=True, timeout=10,
            )
        self.assertNotIn("Traceback", result.stderr)
        return result.returncode, json.loads(result.stdout)

    def test_cli_distinguishes_pass_mismatch_and_invalid(self):
        c = task()
        cases_text = json.dumps([c])
        code, body = self.run_cli(cases_text, json.dumps([observed(c, NORMAL)]))
        self.assertEqual(code, 0)
        self.assertTrue(body["passed"])
        code, body = self.run_cli(cases_text, json.dumps([observed(c, [])]))
        self.assertEqual(code, 1)
        self.assertFalse(body["passed"])
        self.assertEqual(len(body["missing"]), 5)
        code, body = self.run_cli(cases_text, "[]")
        self.assertEqual(code, 2)
        self.assertEqual(body["error"], "invalid_evidence")

    def test_cli_rejects_duplicate_keys_float_and_nonfinite_input(self):
        c = task()
        observations_text = json.dumps([observed(c, NORMAL)])
        cases_text = json.dumps([c])
        broken_inputs = [
            cases_text.replace('"handover_tick": 0', '"handover_tick": 0, "handover_tick": 0'),
            cases_text.replace('"handover_tick": 0', '"handover_tick": 0.0'),
            cases_text.replace('"handover_tick": 0', '"handover_tick": NaN'),
        ]
        for broken in broken_inputs:
            with self.subTest(input=broken):
                code, body = self.run_cli(broken, observations_text)
                self.assertEqual(code, 2)
                self.assertEqual(body["error"], "invalid_evidence")

    def test_cli_rejects_oversized_input_before_parsing(self):
        code, body = self.run_cli(" " * (8 * 1024 * 1024 + 1), "[]")
        self.assertEqual(code, 2)
        self.assertIn("8 MiB", body["detail"])


if __name__ == "__main__":
    unittest.main()
