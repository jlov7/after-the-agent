"""Research-summary contract tests, written before its implementation.

Interval regression values use independently tabulated Wilson limits and
Newcombe's independent-proportion construction, not outputs of this module.
These fixtures are synthetic arithmetic examples, not participant evidence.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from research.analysis import (  # noqa: E402
    analyze_document,
    load_document,
    newcombe_interval,
    wilson_interval,
)
from research.power_budget import participant_budget, required_per_arm  # noqa: E402


def synthetic_document(observation, precommitment):
    records = []
    for arm, values in (("observation", observation), ("precommitment", precommitment)):
        for index, value in enumerate(values):
            records.append({
                "participant_id": f"synthetic_{arm}_{index}",
                "arm": arm,
                "outcome": value,
                "reason": "technical_unknown" if value is None else (
                    "recovered" if value == 1 else "failed"
                ),
            })
    return {"schema_version": "1.0", "origin": "synthetic", "records": records}


class IntervalTests(unittest.TestCase):
    def test_wilson_reference_values(self):
        lower, upper = wilson_interval(5, 10)
        self.assertAlmostEqual(lower, 0.236593090512564, places=11)
        self.assertAlmostEqual(upper, 0.763406909487436, places=11)

    def test_boundary_observations_do_not_get_false_zero_uncertainty(self):
        lower, upper = wilson_interval(0, 10)
        self.assertEqual(lower, 0.0)
        self.assertAlmostEqual(upper, 0.2775327998628892, places=11)
        lower, upper = wilson_interval(10, 10)
        self.assertAlmostEqual(lower, 0.7224672001371108, places=11)
        self.assertEqual(upper, 1.0)

    def test_newcombe_reference_values(self):
        lower, upper = newcombe_interval(8, 10, 5, 10)
        self.assertAlmostEqual(lower, -0.10667246527150648, places=10)
        self.assertAlmostEqual(upper, 0.5998719821481642, places=10)
        lower, upper = newcombe_interval(5, 10, 5, 10)
        self.assertAlmostEqual(lower, -0.3725136238199143, places=10)
        self.assertAlmostEqual(upper, 0.3725136238199143, places=10)


class AnalysisTests(unittest.TestCase):
    def test_complete_primary_keeps_real_failures_and_assignment_denominators(self):
        doc = synthetic_document([1, 0, 0, 0], [1, 1, 0, 0])
        doc["records"][2]["reason"] = "timeout"
        doc["records"][3]["reason"] = "voluntary_stop"
        result = analyze_document(doc)
        self.assertEqual(result["origin"], "synthetic")
        self.assertIn("not human evidence", result["label"].lower())
        self.assertEqual(result["counts"]["observation"]["assigned"], 4)
        self.assertEqual(result["counts"]["observation"]["observed_failures"], 3)
        self.assertAlmostEqual(result["primary"]["risk_difference"], .25)
        self.assertEqual(result["primary"]["status"], "complete")
        self.assertIsNotNone(result["primary"]["score_test"])
        self.assertIsNone(result["missingness_sensitivity"])

    def test_arm_swap_mirrors_effect_interval_and_preserves_two_sided_p(self):
        a = analyze_document(synthetic_document([1]*5+[0]*5, [1]*8+[0]*2))
        b = analyze_document(synthetic_document([1]*8+[0]*2, [1]*5+[0]*5))
        self.assertAlmostEqual(a["primary"]["risk_difference"], -b["primary"]["risk_difference"])
        self.assertAlmostEqual(a["primary"]["ci95"][0], -b["primary"]["ci95"][1])
        self.assertAlmostEqual(a["primary"]["ci95"][1], -b["primary"]["ci95"][0])
        self.assertAlmostEqual(a["primary"]["score_test"]["p_two_sided"], b["primary"]["score_test"]["p_two_sided"])

    def test_all_failure_score_test_is_finite_and_keeps_uncertainty(self):
        result = analyze_document(synthetic_document([0]*5, [0]*5))
        self.assertEqual(result["primary"]["score_test"]["z"], 0.0)
        self.assertEqual(result["primary"]["score_test"]["p_two_sided"], 1.0)
        self.assertLess(result["primary"]["ci95"][0], 0)
        self.assertGreater(result["primary"]["ci95"][1], 0)

    def test_technical_unknowns_retained_and_not_given_complete_case_primary(self):
        result = analyze_document(synthetic_document([1, 0, None], [1, 1, None]))
        self.assertEqual(result["counts"]["observation"]["assigned"], 3)
        self.assertEqual(result["counts"]["observation"]["technical_unknowns"], 1)
        self.assertIsNone(result["primary"]["risk_difference"])
        self.assertIsNone(result["primary"]["ci95"])
        self.assertIsNone(result["primary"]["score_test"])
        self.assertAlmostEqual(result["observed_case_descriptive"]["risk_difference"], .5)
        bounds = result["missingness_sensitivity"]["risk_difference_identified"]
        self.assertAlmostEqual(bounds[0], 0.0)
        self.assertAlmostEqual(bounds[1], 2/3)
        corners = result["missingness_sensitivity"]["imputation_corners"]
        self.assertEqual(len(corners), 4)
        envelope = result["missingness_sensitivity"]["ci95_envelope"]
        self.assertAlmostEqual(envelope[0], min(c["ci95"][0] for c in corners))
        self.assertAlmostEqual(envelope[1], max(c["ci95"][1] for c in corners))

    def test_all_unknown_retains_uninformative_bounds(self):
        result = analyze_document(synthetic_document([None]*3, [None]*3))
        self.assertIsNone(result["observed_case_descriptive"])
        self.assertEqual(result["missingness_sensitivity"]["risk_difference_identified"], [-1.0, 1.0])
        self.assertEqual(result["missingness_sensitivity"]["ci95_envelope"], [-1.0, 1.0])

    def test_duplicate_participant_is_rejected(self):
        doc = synthetic_document([1], [0])
        doc["records"][1]["participant_id"] = doc["records"][0]["participant_id"]
        with self.assertRaisesRegex(ValueError, "duplicate"):
            analyze_document(doc)

    def test_booleans_do_not_sneak_through_as_binary_integers(self):
        for invalid in [True, False, 1.0, "1", 2, -1]:
            with self.subTest(invalid=invalid):
                doc = synthetic_document([1], [0])
                doc["records"][0]["outcome"] = invalid
                with self.assertRaises(ValueError):
                    analyze_document(doc)

    def test_outcome_reason_contract_prevents_missingness_relabeling(self):
        for outcome, reason in [(None, "voluntary_stop"), (0, "technical_unknown"), (1, "failed"), (0, "recovered")]:
            with self.subTest(outcome=outcome, reason=reason):
                doc = synthetic_document([1], [0])
                doc["records"][0].update(outcome=outcome, reason=reason)
                with self.assertRaises(ValueError):
                    analyze_document(doc)

    def test_unknown_fields_and_nonresearch_origins_rejected(self):
        for change in ["top", "record", "origin"]:
            with self.subTest(change=change):
                doc = synthetic_document([1], [0])
                if change == "top": doc["claim"] = "approved"
                elif change == "record": doc["records"][0]["email"] = "example@example.com"
                else: doc["origin"] = "local_usability"
                with self.assertRaises(ValueError):
                    analyze_document(doc)

    def test_empty_arm_refuses_misleading_comparison(self):
        with self.assertRaisesRegex(ValueError, "both arms"):
            analyze_document(synthetic_document([1], []))

    def test_record_order_does_not_change_analysis(self):
        doc = synthetic_document([1, 0, None], [0, 0, 1])
        shuffled = copy.deepcopy(doc)
        shuffled["records"].reverse()
        self.assertEqual(analyze_document(doc), analyze_document(shuffled))

    def test_json_duplicate_keys_and_nonfinite_tokens_are_rejected(self):
        for text in ['{"origin":"synthetic","origin":"research"}', '{"outcome":NaN}']:
            with self.subTest(text=text), tempfile.TemporaryDirectory() as directory:
                path = Path(directory)/"invalid.json"
                path.write_text(text, encoding="utf-8")
                with self.assertRaises(ValueError):
                    load_document(path)


class PlanningTests(unittest.TestCase):
    def test_sample_size_known_scenarios_and_monotonicity(self):
        self.assertEqual(required_per_arm(.5, .7), 93)
        self.assertEqual(required_per_arm(.5, .65), 170)
        self.assertEqual(required_per_arm(.5, .6), 388)
        self.assertEqual(required_per_arm(.4, .6), 97)
        self.assertGreater(required_per_arm(.5, .6), required_per_arm(.5, .7))
        self.assertGreater(required_per_arm(.5, .7, power=.9), required_per_arm(.5, .7))
        self.assertEqual(required_per_arm(.7, .5), required_per_arm(.5, .7))

    def test_zero_effect_and_invalid_numeric_inputs_rejected(self):
        for p0, p1 in [(.5, .5), (float("nan"), .7), (True, .7), (-.1, .4), (.5, 1.1)]:
            with self.subTest(p0=p0, p1=p1):
                with self.assertRaises(ValueError):
                    required_per_arm(p0, p1)

    def test_budget_covers_rewards_plus_corporate_fee(self):
        thirty = participant_budget(224, minutes=30)
        forty_five = participant_budget(224, minutes=45)
        self.assertEqual(thirty["participant_rewards_usd"], 1680.0)
        self.assertEqual(thirty["total_usd"], 2400.0)
        self.assertEqual(forty_five["total_usd"], 3600.0)
        with self.assertRaises(ValueError):
            participant_budget(True)
        with self.assertRaises(ValueError):
            participant_budget(224, minutes=-1)

    def test_cli_outputs_are_machine_readable_and_explicitly_labeled(self):
        power = subprocess.run([sys.executable, str(ROOT/"research/power_budget.py"), "--p0", ".5", "--p1", ".7", "--recruits", "224"], capture_output=True, text=True, check=True)
        power_report = json.loads(power.stdout)
        self.assertIn("planning", power_report["label"].lower())
        self.assertEqual(power_report["sample_size"]["per_arm"], 93)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"outcomes.json"
            path.write_text(json.dumps(synthetic_document([1, 0], [1, 1])), encoding="utf-8")
            analyzed = subprocess.run([sys.executable, str(ROOT/"research/analysis.py"), str(path)], capture_output=True, text=True, check=True)
        result = json.loads(analyzed.stdout)
        self.assertEqual(result["origin"], "synthetic")
        self.assertIn("not human evidence", result["label"].lower())


if __name__ == "__main__":
    unittest.main()
