"""Regression tests for false-success and reference-substitution failures."""

import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from oracle.reference import expected_pulses
from scripts.verify_reference import VerificationError, verify_reference
from scripts.verify_pack import (
    check_required_files,
    summarize_unittest,
    validate_continuations,
    validate_golden_vectors,
)


PACK_ROOT = Path(__file__).resolve().parents[1]


def sample_case(identity="pending"):
    return {
        "schema_version": "1.0", "case_id": identity,
        "handover_tick": 5, "enqueue_until_tick": 8,
        "initial_world": {"scene_id": "blue", "active": True},
        "transitions": [],
    }


def sample_golden():
    return {
        "schema_version": "1.0", "origin": "hand_worked",
        "vectors": [{
            "name": "pending survives",
            "case": sample_case(),
            "expected_pulses": [
                {"tick": 6, "lamp": "left"},
                {"tick": 10, "lamp": "right"},
            ],
        }],
    }


class ReferenceGuardTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.root = self.base / "pack"
        self.root.mkdir()
        self.payload = self.root / "payload.txt"
        self.payload.write_text("frozen semantics\n", encoding="utf-8")
        self.manifest = self.root / "REFERENCE_MANIFEST.json"
        self.data = {
            "schema_version": "1.0", "reference_version": "1.0.0",
            "files": [{
                "path": "payload.txt",
                "sha256": hashlib.sha256(self.payload.read_bytes()).hexdigest(),
            }],
        }
        self.write_manifest()

    def write_manifest(self):
        self.manifest.write_text(json.dumps(self.data), encoding="utf-8")

    def test_valid_reference_passes_without_rewriting_manifest(self):
        before = self.manifest.read_bytes()
        result = verify_reference(self.root)
        self.assertEqual(result["files_checked"], 1)
        self.assertEqual(self.manifest.read_bytes(), before)

    def test_changed_file_fails_instead_of_regenerating_digest(self):
        before = self.manifest.read_bytes()
        self.payload.write_text("changed semantics\n", encoding="utf-8")
        with self.assertRaisesRegex(VerificationError, "digest mismatch"):
            verify_reference(self.root)
        self.assertEqual(self.manifest.read_bytes(), before)

    def test_missing_referenced_file_fails(self):
        self.payload.unlink()
        with self.assertRaises(VerificationError):
            verify_reference(self.root)

    def test_empty_manifest_cannot_claim_success(self):
        self.data["files"] = []
        self.write_manifest()
        with self.assertRaisesRegex(VerificationError, "nonempty"):
            verify_reference(self.root)

    def test_duplicate_reference_path_is_rejected(self):
        self.data["files"].append(copy.deepcopy(self.data["files"][0]))
        self.write_manifest()
        with self.assertRaisesRegex(VerificationError, "duplicate"):
            verify_reference(self.root)

    def test_noncanonical_and_escaping_paths_are_rejected(self):
        for path in ("../outside.txt", "/tmp/outside.txt", "C:/outside.txt",
                     "a\\..\\outside.txt", "./payload.txt", "a//b.txt", ""):
            with self.subTest(path=path):
                self.data["files"][0]["path"] = path
                self.write_manifest()
                with self.assertRaises(VerificationError):
                    verify_reference(self.root)

    def test_symlink_to_outside_file_is_rejected_even_with_matching_digest(self):
        outside = self.base / "outside.txt"
        outside.write_bytes(self.payload.read_bytes())
        self.payload.unlink()
        self.payload.symlink_to(outside)
        with self.assertRaisesRegex(VerificationError, "outside"):
            verify_reference(self.root)

    def test_internal_symlink_is_allowed_when_target_stays_inside_root(self):
        inside = self.root / "actual.txt"
        self.payload.rename(inside)
        self.payload.symlink_to("actual.txt")
        self.assertEqual(verify_reference(self.root)["files_checked"], 1)

    def test_directory_instead_of_file_is_rejected(self):
        self.payload.unlink()
        self.payload.mkdir()
        with self.assertRaises(VerificationError):
            verify_reference(self.root)

    def test_external_anchor_detects_simultaneous_manifest_and_file_edit(self):
        anchor = hashlib.sha256(self.manifest.read_bytes()).hexdigest()
        self.payload.write_text("substituted reference", encoding="utf-8")
        self.data["files"][0]["sha256"] = hashlib.sha256(self.payload.read_bytes()).hexdigest()
        self.write_manifest()
        with self.assertRaisesRegex(VerificationError, "manifest digest mismatch"):
            verify_reference(self.root, expected_manifest_sha=anchor)

    def test_external_manifest_can_be_verified_with_supplied_anchor(self):
        external = self.base / "approved.json"
        self.manifest.rename(external)
        anchor = hashlib.sha256(external.read_bytes()).hexdigest()
        result = verify_reference(self.root, external, anchor)
        self.assertEqual(result["files_checked"], 1)
        self.assertTrue(result["external_anchor_checked"])

    def test_invalid_version_digest_and_extra_fields_are_rejected(self):
        edits = (
            lambda data: data.update(schema_version="2.0"),
            lambda data: data.update(reference_version="9.9.9"),
            lambda data: data.update(ignored=True),
            lambda data: data["files"][0].update(sha256="not-a-sha"),
            lambda data: data["files"][0].update(ignore=True),
        )
        original = copy.deepcopy(self.data)
        for edit in edits:
            self.data = copy.deepcopy(original)
            edit(self.data)
            self.write_manifest()
            with self.assertRaises(VerificationError):
                verify_reference(self.root)

    def test_duplicate_json_key_is_not_silently_overwritten(self):
        self.manifest.write_text(
            '{"schema_version":"bad","schema_version":"1.0",'
            '"reference_version":"1.0.0","files":[]}', encoding="utf-8",
        )
        with self.assertRaisesRegex(VerificationError, "duplicate"):
            verify_reference(self.root)

    def test_cli_reports_missing_reference_with_exit_one(self):
        self.manifest.unlink()
        result = subprocess.run(
            [sys.executable, "-B", str(PACK_ROOT / "scripts/verify_reference.py"),
             "--root", str(self.root)],
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 1)


class PackEvidenceGuardTests(unittest.TestCase):
    def test_missing_and_empty_required_documents_fail(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            with self.assertRaises(VerificationError):
                check_required_files(root, ("AGENTS.md",))
            (root / "AGENTS.md").write_bytes(b"")
            with self.assertRaises(VerificationError):
                check_required_files(root, ("AGENTS.md",))

    def test_hand_worked_vector_matches_reference_independent_of_output_order(self):
        golden = sample_golden()
        golden["vectors"][0]["expected_pulses"].reverse()
        self.assertEqual(validate_golden_vectors(golden, expected_pulses)["vector_count"], 1)

    def test_duplicate_pulse_is_not_erased_by_golden_comparison(self):
        golden = sample_golden()
        golden["vectors"][0]["expected_pulses"].append({"tick": 6, "lamp": "left"})
        with self.assertRaisesRegex(VerificationError, "mismatch"):
            validate_golden_vectors(golden, expected_pulses)

    def test_missing_or_empty_golden_evidence_fails(self):
        for golden in (None, {}, {"schema_version": "1.0", "origin": "hand_worked", "vectors": []}):
            with self.subTest(golden=golden):
                with self.assertRaises(VerificationError):
                    validate_golden_vectors(golden, expected_pulses)

    def test_golden_unknown_fields_and_boolean_ticks_fail(self):
        golden = sample_golden()
        golden["vectors"][0]["expected_pulses"][0]["tick"] = True
        with self.assertRaises(VerificationError):
            validate_golden_vectors(golden, expected_pulses)
        golden = sample_golden()
        golden["vectors"][0]["ignore_failure"] = True
        with self.assertRaises(VerificationError):
            validate_golden_vectors(golden, expected_pulses)

    def test_empty_duplicate_and_all_vacuous_continuations_fail(self):
        inactive = sample_case()
        inactive["initial_world"]["active"] = False
        for cases in ([], [sample_case(), sample_case()], [inactive]):
            with self.subTest(cases=cases):
                with self.assertRaises(VerificationError):
                    validate_continuations(cases, expected_pulses)

    def test_valid_continuation_reports_actual_case_count(self):
        result = validate_continuations([sample_case()], expected_pulses)
        self.assertEqual(result["case_count"], 1)
        self.assertEqual(result["required_pulse_count"], 2)

    def test_zero_exit_without_discovered_tests_is_not_success(self):
        for text in ("", "OK\n", "Ran 0 tests in 0.000s\n\nOK\n"):
            self.assertFalse(summarize_unittest(0, "", text)["passed"])

    def test_skipped_and_failed_test_runs_are_not_complete_success(self):
        self.assertFalse(summarize_unittest(0, "", "Ran 2 tests in 0.001s\nOK (skipped=1)\n")["passed"])
        self.assertFalse(summarize_unittest(1, "", "Ran 2 tests in 0.001s\nFAILED (failures=1)\n")["passed"])
        result = summarize_unittest(0, "", "Ran 2 tests in 0.001s\nOK\n")
        self.assertTrue(result["passed"])
        self.assertEqual(result["tests_run"], 2)


if __name__ == "__main__":
    unittest.main()
