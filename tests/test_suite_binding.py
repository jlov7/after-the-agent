"""Independent regressions for one candidate's continuation-suite binding.

Added after adversarial review reproduced false acceptance of incompatible
candidate boundaries and authoritative prefixes. Suffixes may differ; the
candidate boundary and complete authoritative prefix must match exactly.
"""

import unittest

from oracle.reference import InvalidEvidence, case_digest, evaluate_suite


def case(case_id, handover=5, transitions=None):
    return {
        "schema_version": "1.0", "case_id": case_id,
        "handover_tick": handover, "enqueue_until_tick": 16,
        "initial_world": {"scene_id": "blue", "active": True},
        "transitions": [] if transitions is None else transitions,
    }


def observation(c, pairs):
    return {
        "schema_version": "1.0", "case_id": c["case_id"],
        "case_sha256": case_digest(c), "candidate_sha256": "a"*64,
        "status": "complete", "terminal_reason": "submitted",
        "handover_tick": c["handover_tick"], "observed_through_tick": 18,
        "budget_exhausted": False, "reset_during_attempt": False,
        "pulses": [{"tick": tick, "lamp": lamp} for tick, lamp in pairs],
    }


NORMAL = [(6, "left"), (10, "right"), (14, "left"), (18, "right"), (18, "center")]


class SuiteBindingTests(unittest.TestCase):
    def test_one_candidate_cannot_have_two_settled_boundaries(self):
        a, b = case("boundary5", 5), case("boundary9", 9)
        with self.assertRaises(InvalidEvidence):
            evaluate_suite([a, b], [observation(a, NORMAL), observation(b, NORMAL[1:])])

    def test_one_candidate_cannot_have_conflicting_authoritative_prefixes(self):
        a = case("unchanged")
        b = case("changed", transitions=[{"tick": 5, "scene_id": "amber", "active": True}])
        # Both per-case pulse lists are correct, but these cannot be suffix
        # experiments on the same immutable candidate at settled tick 5.
        with self.assertRaises(InvalidEvidence):
            evaluate_suite([a, b], [observation(a, NORMAL), observation(b, NORMAL[1:])])

    def test_same_prefix_including_redundant_command_allows_different_suffixes(self):
        prefix = [{"tick": 2, "scene_id": "blue", "active": True}]
        a = case("quiet", transitions=list(prefix))
        b = case("inactive_interval", transitions=prefix + [
            {"tick": 8, "scene_id": "blue", "active": False},
            {"tick": 13, "scene_id": "blue", "active": True},
        ])
        result = evaluate_suite([a, b], [
            observation(a, NORMAL),
            observation(b, [(6, "left"), (18, "right"), (18, "center")]),
        ])
        self.assertTrue(result["passed"])
        self.assertEqual(result["case_count"], 2)


if __name__ == "__main__":
    unittest.main()
