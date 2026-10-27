"""Verify the handoff starter only; never claim the application is implemented.

This stdlib-only gate checks files/reference bytes, hand-worked oracle vectors,
continuation inputs, JSON schema parsing, and actual unittest discovery. It does
not provide formal JSON Schema validation or any browser/MCP/product evidence.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from typing import Any, Callable

if __package__:
    from .verify_reference import (FailClosedParser, VerificationError, load_json,
                                  safe_file, verify_reference)
else:
    from verify_reference import (FailClosedParser, VerificationError, load_json,
                                 safe_file, verify_reference)


PACK_ROOT = Path(__file__).resolve().parents[1]
REQUIRED_FILES = (
    "README.md", "START_HERE.md", "AGENTS.md", "CLAUDE.md",
    ".agent/PLANS.md", ".agent/PROGRESS.md",
    "docs/00_DECISION_AND_PRIOR_ART.md", "docs/01_PRODUCT_SPEC.md",
    "docs/02_ENGINE_AND_CONTRACTS.md", "docs/03_BUILD_PLAN.md",
    "docs/04_VERIFICATION_AND_FAILURE_MODES.md",
    "docs/05_AGENT_RECORDING_AND_RELEASE.md", "docs/06_RESEARCH_PROTOCOL.md",
    "docs/07_RESEARCH_LAUNCH.md", "docs/08_ACCEPTANCE_AND_HANDOFF.md",
    "docs/09_PUBLIC_FRONT_DOORS.md",
    "prompts/CODEX_START.md", "prompts/ADVERSARIAL_REVIEW.md",
    "contracts/board.schema.json", "contracts/evaluation.schema.json",
    "oracle/reference.py", "fixtures/golden.json", "fixtures/continuations.json",
    "fixtures/continuation-policy.json", "fixtures/README.md",
    "research/analysis.py", "research/power_budget.py", "research/example_outcomes.json",
    "research/launch-config.example.json",
    "scripts/verify_reference.py", "scripts/verify_pack.py",
    "tests/test_reference.py", "tests/test_reference_extra.py", "tests/test_suite_binding.py",
    "tests/test_research.py", "tests/test_pack_guards.py",
)
SCHEMA_FILES = ("contracts/board.schema.json", "contracts/evaluation.schema.json")


def check_required_files(root: Path, required_files: tuple[str, ...] = REQUIRED_FILES) -> dict[str, Any]:
    if not required_files:
        raise VerificationError("required file list must not be empty")
    problems = []
    for relative in required_files:
        try:
            target = safe_file(root, relative)
            if target.stat().st_size == 0:
                raise VerificationError(f"required file is empty: {relative}")
        except (VerificationError, OSError) as error:
            problems.append(str(error))
    if problems:
        raise VerificationError("; ".join(problems))
    return {"required_files_checked": len(required_files)}


def _pulse_counter(pulses: Any) -> Counter:
    if type(pulses) is not list or len(pulses) > 16384:
        raise VerificationError("golden pulses must be a bounded array")
    for pulse in pulses:
        if (type(pulse) is not dict or pulse.keys() != {"tick", "lamp"}
                or type(pulse["tick"]) is not int or not 1 <= pulse["tick"] <= 4096
                or type(pulse["lamp"]) is not str
                or pulse["lamp"] not in {"left", "right", "center"}):
            raise VerificationError("invalid golden pulse")
    return Counter((pulse["tick"], pulse["lamp"]) for pulse in pulses)


def validate_golden_vectors(data: Any, expected: Callable) -> dict[str, Any]:
    if (type(data) is not dict or data.keys() != {"schema_version", "origin", "vectors"}
            or data["schema_version"] != "1.0" or data["origin"] != "hand_worked"
            or type(data["vectors"]) is not list or not 1 <= len(data["vectors"]) <= 256):
        raise VerificationError("invalid, missing, or empty hand-worked golden evidence")
    names = set()
    total = 0
    for vector in data["vectors"]:
        if (type(vector) is not dict or vector.keys() != {"name", "case", "expected_pulses"}
                or type(vector["name"]) is not str or not 1 <= len(vector["name"]) <= 128):
            raise VerificationError("invalid golden vector fields")
        if vector["name"] in names:
            raise VerificationError("duplicate golden vector name")
        names.add(vector["name"])
        try:
            actual = _pulse_counter(expected(vector["case"]))
            declared = _pulse_counter(vector["expected_pulses"])
        except ValueError as error:
            raise VerificationError(f"invalid golden case: {error}") from error
        if actual != declared:
            raise VerificationError(f"hand-worked oracle mismatch: {vector['name']}")
        total += sum(actual.values())
    if total == 0:
        raise VerificationError("golden suite must include nonempty pulse obligations")
    return {"vector_count": len(names), "required_pulse_count": total,
            "comparison": "exact_multiset_against_independent_reference"}


def validate_continuations(data: Any, expected: Callable) -> dict[str, Any]:
    if type(data) is not list or not 1 <= len(data) <= 256:
        raise VerificationError("continuations must be a nonempty bounded case array")
    seen = set()
    total = 0
    for case in data:
        try:
            pulses = expected(case)
        except ValueError as error:
            raise VerificationError(f"invalid continuation: {error}") from error
        identity = case["case_id"]
        if identity in seen:
            raise VerificationError("duplicate continuation case identity")
        seen.add(identity)
        total += len(pulses)
    if total == 0:
        raise VerificationError("continuations cannot all have empty obligations")
    return {"case_count": len(data), "required_pulse_count": total}


def summarize_unittest(returncode: int, stdout: str, stderr: str) -> dict[str, Any]:
    summaries = re.findall(r"^Ran (\d+) tests? in ([0-9.]+)s\s*$", stderr, re.MULTILINE)
    tests_run = int(summaries[-1][0]) if summaries else 0
    skips = re.findall(r"skipped=(\d+)", stderr)
    skipped = int(skips[-1]) if skips else 0
    expected_failures = re.findall(r"expected failures=(\d+)", stderr)
    expected_failure_count = int(expected_failures[-1]) if expected_failures else 0
    has_ok = re.search(r"^OK(?:\s*\([^\n]*\))?\s*$", stderr, re.MULTILINE) is not None
    passed = returncode == 0 and tests_run > 0 and skipped == 0 and expected_failure_count == 0 and has_ok
    return {"passed": passed, "exit_code": returncode, "tests_run": tests_run,
            "skipped": skipped, "expected_failures": expected_failure_count,
            "stdout_tail": stdout[-4000:], "stderr_tail": stderr[-12000:]}


def _load_oracle(root: Path) -> Any:
    source = safe_file(root, "oracle/reference.py")
    specification = importlib.util.spec_from_file_location("handoff_reference_oracle", source)
    if specification is None or specification.loader is None:
        raise VerificationError("cannot load reference oracle")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    if not callable(getattr(module, "expected_pulses", None)):
        raise VerificationError("reference oracle lacks expected_pulses")
    return module


def _write_report(root: Path, report: dict[str, Any]) -> None:
    directory = root / "evidence"
    if not directory.resolve().is_relative_to(root):
        raise VerificationError("evidence directory resolves outside pack root")
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / "pack-verification.json"
    if target.is_symlink():
        raise VerificationError("report output must not be a symlink")
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=directory,
                                         prefix=".pack-verification-", delete=False) as output:
            temporary = Path(output.name)
            json.dump(report, output, indent=2, sort_keys=True, allow_nan=False)
            output.write("\n")
        os.replace(temporary, target)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def main(argv: list[str] | None = None) -> int:
    parser = FailClosedParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=PACK_ROOT)
    parser.add_argument("--manifest", type=Path, default=None)
    parser.add_argument("--expected-manifest-sha", default=None)
    try:
        args = parser.parse_args(argv)
        root = args.root.resolve(strict=True)
        if not root.is_dir():
            raise VerificationError("pack root is not a directory")
    except (VerificationError, OSError) as error:
        print(f"Starter verification FAILED: {error}", file=sys.stderr)
        return 1

    report = {
        "schema_version": "1.0", "scope": "handoff_starter_only",
        "product_verification": "not_assessed",
        "started_at_utc": datetime.now(timezone.utc).isoformat(),
        "python_version": sys.version.split()[0], "checks": {},
        "schema_validation_scope": "JSON parsing/document shape only; formal validation is product M0",
        "limitations": ["No application, browser, MCP, live-model, or human study was verified by this gate."],
    }
    checks = report["checks"]

    def check(name: str, operation: Callable) -> bool:
        try:
            detail = operation()
            checks[name] = {"status": "passed", **detail}
            return True
        except Exception as error:
            # Every failed check remains explicit; do not report success on an
            # unexpected exception or continue as though missing data were empty.
            checks[name] = {"status": "failed", "error_type": type(error).__name__, "detail": str(error)}
            return False

    required_ok = check("required_files", lambda: check_required_files(root))
    reference_ok = check("reference", lambda: verify_reference(root, args.manifest, args.expected_manifest_sha))

    if required_ok and reference_ok:
        def schemas() -> dict[str, Any]:
            for relative in SCHEMA_FILES:
                parsed = load_json(safe_file(root, relative))
                if type(parsed) is not dict or not parsed or type(parsed.get("$schema")) is not str:
                    raise VerificationError(f"expected a JSON Schema object declaring its dialect: {relative}")
            load_json(safe_file(root, "research/example_outcomes.json"))
            load_json(safe_file(root, "research/launch-config.example.json"))
            load_json(safe_file(root, "fixtures/continuation-policy.json"))
            return {"schema_documents_parsed": len(SCHEMA_FILES), "formal_schema_validation": "not_performed"}

        check("json_documents", schemas)
        try:
            oracle = _load_oracle(root)
        except Exception as error:
            checks["oracle_load"] = {"status": "failed", "detail": str(error)}
        else:
            check("golden_vectors", lambda: validate_golden_vectors(
                load_json(safe_file(root, "fixtures/golden.json")), oracle.expected_pulses))
            check("continuations", lambda: validate_continuations(
                load_json(safe_file(root, "fixtures/continuations.json")), oracle.expected_pulses))

        command = [sys.executable, "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py", "-v"]
        try:
            execution = subprocess.run(command, cwd=root, capture_output=True, text=True,
                                       encoding="utf-8", errors="replace",
                                       timeout=60, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
            summary = summarize_unittest(execution.returncode, execution.stdout, execution.stderr)
            checks["unittest"] = {"status": "passed" if summary["passed"] else "failed",
                                   "command": command, **summary}
        except subprocess.TimeoutExpired:
            checks["unittest"] = {"status": "failed", "command": command,
                                   "exit_code": None, "tests_run": None, "detail": "60-second timeout"}
        except OSError as error:
            checks["unittest"] = {"status": "failed", "command": command,
                                   "exit_code": None, "tests_run": None, "detail": str(error)}
    else:
        for name in ("json_documents", "golden_vectors", "continuations", "unittest"):
            checks[name] = {"status": "not_run", "detail": "Required files or reference verification failed."}

    report["passed"] = all(item["status"] == "passed" for item in checks.values())
    report["completed_at_utc"] = datetime.now(timezone.utc).isoformat()
    report["exit_code"] = 0 if report["passed"] else 1
    try:
        _write_report(root, report)
    except (OSError, VerificationError, ValueError) as error:
        print(f"Starter verification FAILED; could not write current evidence: {error}", file=sys.stderr)
        return 1
    unit = checks.get("unittest", {})
    status = "PASS" if report["passed"] else "FAIL"
    print(f"Handoff starter: {status}; tests={unit.get('tests_run', 'not_run')}; "
          f"test_exit={unit.get('exit_code', 'not_run')}; product=not_assessed.")
    if not report["passed"]:
        print("Incomplete checks: " + ", ".join(name for name, item in checks.items() if item["status"] != "passed"))
    print("Evidence: evidence/pack-verification.json")
    return report["exit_code"]


if __name__ == "__main__":
    raise SystemExit(main())
