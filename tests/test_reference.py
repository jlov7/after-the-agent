"""Hand-worked obligations and deliberately broken evidence; no production engine import."""
import copy
import json
import unittest
from pathlib import Path

from oracle.reference import InvalidEvidence, case_digest, expected_pulses, evaluate_case, evaluate_suite

ROOT = Path(__file__).resolve().parents[1]

def case(case_id="normal", handover=0, end=16, transitions=None):
    return {"schema_version":"1.0", "case_id":case_id,
            "handover_tick":handover, "enqueue_until_tick":end,
            "initial_world":{"scene_id":"blue", "active":True},
            "transitions":transitions or []}

def pulse(tick, lamp):
    return {"tick":tick, "lamp":lamp}

def observation(c, pulses):
    return {"schema_version":"1.0", "case_id":c["case_id"],
            "case_sha256":case_digest(c), "candidate_sha256":"a"*64,
            "status":"complete", "terminal_reason":"submitted",
            "handover_tick":c["handover_tick"],
            "observed_through_tick":c["enqueue_until_tick"]+2,
            "budget_exhausted":False, "reset_during_attempt":False,
            "pulses":pulses}

NORMAL = [pulse(6,"left"),pulse(10,"right"),pulse(14,"left"),pulse(18,"right"),pulse(18,"center")]

class ReferenceTests(unittest.TestCase):
    def test_first_fire_is_four_delay_is_two_center_is_additional(self):
        self.assertCountEqual(expected_pulses(case()), NORMAL)

    def test_valid_pending_job_survives_handover(self):
        self.assertCountEqual(expected_pulses(case(handover=5,end=8)), [pulse(6,"left"),pulse(10,"right")])

    def test_transition_between_enqueue_and_delivery_cancels_old_job(self):
        c=case(handover=5,end=8,transitions=[{"tick":5,"scene_id":"amber","active":True}])
        self.assertEqual(expected_pulses(c), [pulse(10,"right")])

    def test_transition_at_delivery_precedes_delivery(self):
        c=case(end=8,transitions=[{"tick":6,"scene_id":"amber","active":True}])
        self.assertEqual(expected_pulses(c), [pulse(10,"right")])

    def test_deactivation_at_enqueue_precedes_clock(self):
        c=case(end=8,transitions=[{"tick":4,"scene_id":"blue","active":False},{"tick":5,"scene_id":"blue","active":True}])
        self.assertEqual(expected_pulses(c), [pulse(10,"right")])

    def test_cached_gate_would_create_forbidden_inactive_outputs(self):
        c=case(end=24,transitions=[{"tick":9,"scene_id":"blue","active":False},{"tick":17,"scene_id":"blue","active":True}])
        expected=[pulse(6,"left"),pulse(22,"left"),pulse(26,"right")]
        self.assertCountEqual(expected_pulses(c),expected)
        self.assertFalse(evaluate_case(c,observation(c,expected+[pulse(14,"left")]))["passed"])

    def test_identical_world_command_is_not_an_epoch_transition(self):
        c=case(end=8,transitions=[{"tick":5,"scene_id":"blue","active":True}])
        self.assertEqual(expected_pulses(c),[pulse(6,"left"),pulse(10,"right")])

    def test_pre_handover_outputs_are_excluded_but_pending_obligations_remain(self):
        self.assertEqual(expected_pulses(case(handover=6,end=8)),[pulse(10,"right")])

    def test_final_drain_is_required(self):
        c=case(end=16)
        o=observation(c,NORMAL[:-2]);o["observed_through_tick"]=16
        with self.assertRaises(InvalidEvidence): evaluate_case(c,o)

    def test_correct_trace_passes_regardless_of_same_tick_event_order(self):
        c=case();o=observation(c,list(reversed(NORMAL)))
        self.assertTrue(evaluate_case(c,o)["passed"])

    def test_duplicate_outputs_cannot_be_deduplicated_by_scorer(self):
        c=case();v=evaluate_case(c,observation(c,NORMAL+[pulse(6,"left")]))
        self.assertFalse(v["passed"])
        self.assertEqual(v["extra"],[{"tick":6,"lamp":"left","count":1}])

    def test_no_clock_and_clear_all_policies_fail_liveness(self):
        c=case(handover=5,end=8)
        self.assertFalse(evaluate_case(c,observation(c,[]))["passed"])
        self.assertFalse(evaluate_case(c,observation(c,[pulse(10,"right")]))["passed"])

    def test_channel_substitution_fails(self):
        c=case();bad=copy.deepcopy(NORMAL);bad[0]["lamp"]="right"
        self.assertFalse(evaluate_case(c,observation(c,bad))["passed"])

    def test_rejects_case_identity_substitution(self):
        c=case();o=observation(c,NORMAL);o["case_sha256"]="b"*64
        with self.assertRaises(InvalidEvidence): evaluate_case(c,o)

    def test_rejects_incomplete_and_budget_exhausted_and_reset_evidence(self):
        c=case()
        for field,value in [("status","error"),("budget_exhausted",True),("reset_during_attempt",True),("terminal_reason","abandoned_reset")]:
            with self.subTest(field=field):
                o=observation(c,NORMAL);o[field]=value
                with self.assertRaises(InvalidEvidence): evaluate_case(c,o)

    def test_rejects_unknown_fields_boolean_ticks_and_out_of_window_pulses(self):
        c=case()
        for edit in [lambda o:o.update(score=100),lambda o:o["pulses"].append(pulse(True,"left")),lambda o:o["pulses"].append(pulse(0,"center"))]:
            o=observation(c,copy.deepcopy(NORMAL));edit(o)
            with self.assertRaises(InvalidEvidence): evaluate_case(c,o)

    def test_rejects_unsorted_or_duplicate_transition_ticks(self):
        for ticks in [(5,4),(4,4)]:
            c=case(transitions=[{"tick":t,"scene_id":"amber","active":True} for t in ticks])
            with self.assertRaises(InvalidEvidence): expected_pulses(c)

    def test_case_digest_is_key_order_independent(self):
        c=case();self.assertRegex(case_digest(c),r"^[a-f0-9]{64}$")
        self.assertEqual(case_digest(c),case_digest(dict(reversed(list(c.items())))))

    def test_suite_rejects_missing_duplicate_and_mixed_candidate_results(self):
        c1=case("one");c2=case("two");o1=observation(c1,NORMAL);o2=observation(c2,NORMAL)
        with self.assertRaises(InvalidEvidence): evaluate_suite([c1,c2],[o1])
        with self.assertRaises(InvalidEvidence): evaluate_suite([c1,c2],[o1,o1])
        o2["candidate_sha256"]="c"*64
        with self.assertRaises(InvalidEvidence): evaluate_suite([c1,c2],[o1,o2])

    def test_suite_requires_every_case_to_pass(self):
        c1=case("one");c2=case("two")
        result=evaluate_suite([c1,c2],[observation(c1,NORMAL),observation(c2,[])])
        self.assertFalse(result["passed"])
        self.assertEqual(result["case_count"],2)

if __name__ == "__main__":
    unittest.main()
