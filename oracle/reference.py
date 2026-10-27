"""Independent, bounded expected-trace oracle for the restricted light board.

This module uses only the immutable nominal cue schedule and authoritative world
history.  It does not import a production simulator or trust a candidate queue,
clock configuration, claimed final state, or claimed score.

The digest encoding is deliberately narrow: validated JSON data, sorted ASCII
keys, compact separators, ensure_ascii=True, and no floating-point numbers.  It
is NOT a general implementation of RFC 8785 or a provider-authentication scheme.

CLI: python3 oracle/reference.py CASES.json OBSERVATIONS.json
Exit codes: 0 = every case passes; 1 = valid evidence mismatches; 2 = invalid input.
"""

from __future__ import annotations

from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any


MAX_TICK = 4096
MAX_CASES = 256
MAX_PULSES = 16384
MAX_INPUT_BYTES = 8 * 1024 * 1024
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}", re.ASCII)
SHA256 = re.compile(r"[a-f0-9]{64}", re.ASCII)
LAMPS = frozenset(("left", "right", "center"))

CASE_FIELDS = frozenset((
    "schema_version", "case_id", "handover_tick", "enqueue_until_tick",
    "initial_world", "transitions",
))
WORLD_FIELDS = frozenset(("scene_id", "active"))
TRANSITION_FIELDS = frozenset(("tick", "scene_id", "active"))
OBSERVATION_FIELDS = frozenset((
    "schema_version", "case_id", "case_sha256", "candidate_sha256", "status",
    "terminal_reason", "handover_tick", "observed_through_tick",
    "budget_exhausted", "reset_during_attempt", "pulses",
))
PULSE_FIELDS = frozenset(("tick", "lamp"))


class InvalidEvidence(ValueError):
    """Evidence is malformed, incomplete, inconsistent, or outside its bounds."""


def _fields(value: Any, expected: frozenset[str], where: str) -> None:
    if type(value) is not dict or value.keys() != expected:
        raise InvalidEvidence(
            f"{where}: expected an object with exactly {sorted(expected)}"
        )


def _integer(value: Any, minimum: int, maximum: int, where: str) -> None:
    # bool is an int subclass; accepting it here would blur the wire contract.
    if type(value) is not int or not minimum <= value <= maximum:
        raise InvalidEvidence(f"{where}: expected integer in [{minimum}, {maximum}]")


def _identifier(value: Any, where: str) -> None:
    if type(value) is not str or IDENTIFIER.fullmatch(value) is None:
        raise InvalidEvidence(f"{where}: expected bounded ASCII identifier")


def _sha256(value: Any, where: str) -> None:
    if type(value) is not str or SHA256.fullmatch(value) is None:
        raise InvalidEvidence(f"{where}: expected lowercase SHA-256 hex digest")


def _world(value: Any, where: str, *, transition: bool = False) -> None:
    _fields(value, TRANSITION_FIELDS if transition else WORLD_FIELDS, where)
    _identifier(value["scene_id"], f"{where}.scene_id")
    if type(value["active"]) is not bool:
        raise InvalidEvidence(f"{where}.active: expected boolean")


def _validate_case(case: Any) -> None:
    _fields(case, CASE_FIELDS, "case")
    if type(case["schema_version"]) is not str or case["schema_version"] != "1.0":
        raise InvalidEvidence("case.schema_version: unsupported version")
    _identifier(case["case_id"], "case.case_id")
    _integer(case["enqueue_until_tick"], 1, MAX_TICK - 2, "case.enqueue_until_tick")
    end = case["enqueue_until_tick"]
    _integer(case["handover_tick"], 0, end - 1, "case.handover_tick")
    _world(case["initial_world"], "case.initial_world")
    transitions = case["transitions"]
    if type(transitions) is not list or len(transitions) > MAX_TICK:
        raise InvalidEvidence("case.transitions: expected a bounded array")
    previous_tick = 0
    for index, change in enumerate(transitions):
        where = f"case.transitions[{index}]"
        _world(change, where, transition=True)
        _integer(change["tick"], 1, end + 2, f"{where}.tick")
        if change["tick"] <= previous_tick:
            raise InvalidEvidence("case.transitions: ticks must be strictly increasing")
        previous_tick = change["tick"]


def _digest_validated_case(case: dict[str, Any]) -> str:
    canonical = json.dumps(
        case, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
        allow_nan=False,
    ).encode("ascii")
    return hashlib.sha256(canonical).hexdigest()


def case_digest(case: Any) -> str:
    """Commit to the exact validated task and full world schedule."""
    _validate_case(case)
    return _digest_validated_case(case)


def _expected_validated(case: dict[str, Any]) -> list[dict[str, Any]]:
    """Direct world-history predicate, independent of the plant implementation."""
    end = case["enqueue_until_tick"]
    handover = case["handover_tick"]
    changes = {change["tick"]: change for change in case["transitions"]}
    scene = case["initial_world"]["scene_id"]
    active = case["initial_world"]["active"]
    epoch = 1
    world_at: list[tuple[int, bool]] = []

    for tick in range(end + 3):
        change = changes.get(tick)
        if change is not None:
            if change["scene_id"] != scene or change["active"] != active:
                epoch += 1
            scene, active = change["scene_id"], change["active"]
        world_at.append((epoch, active))

    pulses: list[dict[str, Any]] = []
    for enqueue in range(4, end + 1, 4):
        delivery = enqueue + 2
        if delivery <= handover:
            continue
        enqueue_epoch, enqueue_active = world_at[enqueue]
        if not enqueue_active or enqueue_epoch != world_at[delivery][0]:
            continue
        ordinal = enqueue // 4
        pulses.append({"tick": delivery, "lamp": "left" if ordinal % 2 else "right"})
        if ordinal % 4 == 0:
            pulses.append({"tick": delivery, "lamp": "center"})
    return pulses


def expected_pulses(case: Any) -> list[dict[str, Any]]:
    """Return owed outputs after handover, including pending and final-drain work."""
    _validate_case(case)
    return _expected_validated(case)


def _validate_observation(case: dict[str, Any], observed: Any) -> None:
    _fields(observed, OBSERVATION_FIELDS, "observation")
    if type(observed["schema_version"]) is not str or observed["schema_version"] != "1.0":
        raise InvalidEvidence("observation.schema_version: unsupported version")
    _identifier(observed["case_id"], "observation.case_id")
    if observed["case_id"] != case["case_id"]:
        raise InvalidEvidence("observation.case_id: does not match assigned case")
    _sha256(observed["case_sha256"], "observation.case_sha256")
    if observed["case_sha256"] != _digest_validated_case(case):
        raise InvalidEvidence("observation.case_sha256: does not match assigned case")
    _sha256(observed["candidate_sha256"], "observation.candidate_sha256")
    if type(observed["status"]) is not str or observed["status"] != "complete":
        raise InvalidEvidence("observation.status: evidence must be complete")
    if type(observed["terminal_reason"]) is not str or observed["terminal_reason"] != "submitted":
        raise InvalidEvidence("observation.terminal_reason: attempt was not submitted")
    if observed["budget_exhausted"] is not False:
        raise InvalidEvidence("observation.budget_exhausted: must be false")
    if observed["reset_during_attempt"] is not False:
        raise InvalidEvidence("observation.reset_during_attempt: must be false")
    _integer(observed["handover_tick"], 0, MAX_TICK, "observation.handover_tick")
    if observed["handover_tick"] != case["handover_tick"]:
        raise InvalidEvidence("observation.handover_tick: does not match assigned case")
    _integer(observed["observed_through_tick"], 0, MAX_TICK, "observation.observed_through_tick")
    if observed["observed_through_tick"] != case["enqueue_until_tick"] + 2:
        raise InvalidEvidence("observation.observed_through_tick: must include exact final drain")

    pulses = observed["pulses"]
    if type(pulses) is not list or len(pulses) > MAX_PULSES:
        raise InvalidEvidence("observation.pulses: expected a bounded array")
    for index, pulse in enumerate(pulses):
        where = f"observation.pulses[{index}]"
        _fields(pulse, PULSE_FIELDS, where)
        _integer(
            pulse["tick"], case["handover_tick"] + 1,
            case["enqueue_until_tick"] + 2, f"{where}.tick",
        )
        if type(pulse["lamp"]) is not str or pulse["lamp"] not in LAMPS:
            raise InvalidEvidence(f"{where}.lamp: unsupported lamp")


def _counted_difference(counter: Counter[tuple[int, str]]) -> list[dict[str, Any]]:
    return [
        {"tick": tick, "lamp": lamp, "count": count}
        for (tick, lamp), count in sorted(counter.items())
        if count > 0
    ]


def evaluate_case(case: Any, observed: Any) -> dict[str, Any]:
    """Validate evidence, then compare exact output multiplicities, not ordering."""
    _validate_case(case)
    _validate_observation(case, observed)
    expected = _expected_validated(case)
    expected_counts = Counter((pulse["tick"], pulse["lamp"]) for pulse in expected)
    observed_counts = Counter((pulse["tick"], pulse["lamp"]) for pulse in observed["pulses"])
    missing = _counted_difference(expected_counts - observed_counts)
    extra = _counted_difference(observed_counts - expected_counts)
    return {
        "case_id": case["case_id"],
        "case_sha256": _digest_validated_case(case),
        "candidate_sha256": observed["candidate_sha256"],
        "passed": not missing and not extra,
        "expected_count": len(expected),
        "observed_count": len(observed["pulses"]),
        "missing": missing,
        "extra": extra,
    }


def evaluate_suite(cases: Any, observations: Any) -> dict[str, Any]:
    """Bind complete evidence to one candidate, world prefix and evaluation cut."""
    if type(cases) is not list or not 1 <= len(cases) <= MAX_CASES:
        raise InvalidEvidence(f"cases: expected array of 1..{MAX_CASES} cases")
    if type(observations) is not list or len(observations) != len(cases):
        raise InvalidEvidence("observations: exactly one result per assigned case is required")

    assigned: dict[str, dict[str, Any]] = {}
    common_boundary: int | None = None
    common_prefix: tuple[Any, ...] | None = None
    for case in cases:
        _validate_case(case)
        case_id = case["case_id"]
        if case_id in assigned:
            raise InvalidEvidence("cases: duplicate case identity")
        boundary = case["handover_tick"]
        # Equal candidate labels cannot legitimize incompatible inherited states.
        # Compare complete authoritative input prefixes, not only their current
        # active/scene values: earlier transitions determine pending obligations.
        prefix = (
            case["initial_world"]["scene_id"],
            case["initial_world"]["active"],
            tuple(
                (change["tick"], change["scene_id"], change["active"])
                for change in case["transitions"] if change["tick"] <= boundary
            ),
        )
        if common_boundary is None:
            common_boundary, common_prefix = boundary, prefix
        elif boundary != common_boundary:
            raise InvalidEvidence("cases: one candidate requires one settled boundary")
        elif prefix != common_prefix:
            raise InvalidEvidence("cases: one candidate requires one authoritative world prefix")
        assigned[case_id] = case

    by_case: dict[str, dict[str, Any]] = {}
    candidate: str | None = None
    for observed in observations:
        _fields(observed, OBSERVATION_FIELDS, "observation")
        _identifier(observed["case_id"], "observation.case_id")
        case_id = observed["case_id"]
        if case_id not in assigned:
            raise InvalidEvidence("observations: unassigned case identity")
        if case_id in by_case:
            raise InvalidEvidence("observations: duplicate case identity")
        _validate_observation(assigned[case_id], observed)
        if candidate is None:
            candidate = observed["candidate_sha256"]
        elif observed["candidate_sha256"] != candidate:
            raise InvalidEvidence("observations: mixed candidate identities")
        by_case[case_id] = observed
    if by_case.keys() != assigned.keys():
        raise InvalidEvidence("observations: assigned case coverage is incomplete")

    results = [evaluate_case(case, by_case[case["case_id"]]) for case in cases]
    if sum(result["expected_count"] for result in results) == 0:
        raise InvalidEvidence("cases: suite must include at least one required pulse")
    return {
        "passed": all(result["passed"] for result in results),
        "case_count": len(results),
        "candidate_sha256": candidate,
        "results": results,
        "missing": [
            {"case_id": result["case_id"], **item}
            for result in results for item in result["missing"]
        ],
        "extra": [
            {"case_id": result["case_id"], **item}
            for result in results for item in result["extra"]
        ],
    }


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise InvalidEvidence("JSON contains a duplicate object key")
        result[key] = value
    return result


def _reject_json_number(_: str) -> Any:
    raise InvalidEvidence("JSON floating-point and nonfinite numbers are forbidden")


def _load_json(path: str) -> Any:
    try:
        with Path(path).open("rb") as source:
            raw = source.read(MAX_INPUT_BYTES + 1)
        if len(raw) > MAX_INPUT_BYTES:
            raise InvalidEvidence("input file exceeds 8 MiB limit")
        return json.loads(
            raw.decode("utf-8"), object_pairs_hook=_unique_object,
            parse_float=_reject_json_number, parse_constant=_reject_json_number,
        )
    except InvalidEvidence:
        raise
    except (OSError, UnicodeError, ValueError, RecursionError) as error:
        raise InvalidEvidence(f"cannot read valid bounded JSON input: {error}") from error


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 2:
        print("usage: python3 oracle/reference.py CASES.json OBSERVATIONS.json", file=sys.stderr)
        return 2
    try:
        verdict = evaluate_suite(_load_json(args[0]), _load_json(args[1]))
    except InvalidEvidence as error:
        print(json.dumps({"error": "invalid_evidence", "detail": str(error)}, ensure_ascii=True))
        return 2
    print(json.dumps(verdict, sort_keys=True, separators=(",", ":"), ensure_ascii=True))
    return 0 if verdict["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
