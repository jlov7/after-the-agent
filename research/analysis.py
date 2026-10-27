#!/usr/bin/env python3
"""Strict binary-outcome summary for a declared two-arm document.

Python 3.11+, standard library only. This summarizes supplied outcomes; it does
not validate consent, assignment receipts, timing, or the repair oracle. The
research collector must establish those upstream. Synthetic input is always
labeled not human evidence. No participant identifiers appear in this output.

Schema: exact top-level keys schema_version='1.0', origin='synthetic'|'research',
records=[{participant_id, arm, outcome, reason}]. Arms are observation and
precommitment. outcome is integer 0/1 or null, never a boolean. Reasons are
recovered, failed, timeout, voluntary_stop, technical_unknown, with consistent
outcome mapping. Both assigned arms must be nonempty. No local/public imports.

Methods: Wilson score limits; Newcombe independent-proportion difference
interval; two-sided pooled proportion score test. Technical unknowns remain
in the assigned population and produce an imputation-corner sensitivity
envelope instead of an unidentified complete-case ITT estimate.
https://www.statsmodels.org/stable/generated/statsmodels.stats.proportion.proportion_confint.html
https://www.statsmodels.org/stable/generated/statsmodels.stats.proportion.confint_proportions_2indep.html
See docs/06_RESEARCH_PROTOCOL.md for estimands and limitations.
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
import math
from pathlib import Path
import re
from statistics import NormalDist

ARMS = ("observation", "precommitment")
REASONS = ("recovered", "failed", "timeout", "voluntary_stop", "technical_unknown")
_ID = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")


def _counts(successes: int, n: int) -> None:
    if type(n) is not int or n <= 0:
        raise ValueError("denominator must be a positive integer")
    if type(successes) is not int or not (0 <= successes <= n):
        raise ValueError("success count must be an integer in [0, n]")


def wilson_interval(successes: int, n: int, *, alpha: float = .05) -> tuple[float, float]:
    """Two-sided Wilson score interval, without continuity correction."""
    _counts(successes, n)
    if type(alpha) not in (int, float) or not math.isfinite(alpha) or not 0 < alpha < 1:
        raise ValueError("alpha must be finite and in (0, 1)")
    z = NormalDist().inv_cdf(1 - alpha / 2)
    p, z2 = successes/n, z*z
    denominator = 1 + z2/n
    center = (p + z2/(2*n)) / denominator
    radius = z*math.sqrt(p*(1-p)/n + z2/(4*n*n)) / denominator
    lower = 0.0 if successes == 0 else max(0.0, center-radius)
    upper = 1.0 if successes == n else min(1.0, center+radius)
    return lower, upper


def newcombe_interval(t_successes: int, t_n: int, c_successes: int, c_n: int,
                      *, alpha: float = .05) -> tuple[float, float]:
    """Independent risk difference (treatment minus control), Newcombe/Wilson."""
    lt, ut = wilson_interval(t_successes, t_n, alpha=alpha)
    lc, uc = wilson_interval(c_successes, c_n, alpha=alpha)
    pt, pc = t_successes/t_n, c_successes/c_n
    difference = pt-pc
    return (
        max(-1.0, difference-math.hypot(pt-lt, uc-pc)),
        min(1.0, difference+math.hypot(ut-pt, pc-lc)),
    )


def _comparison(xt: int, nt: int, xc: int, nc: int) -> dict:
    _counts(xt, nt)
    _counts(xc, nc)
    return {"risk_difference": xt/nt-xc/nc,
            "ci95": list(newcombe_interval(xt, nt, xc, nc))}


def _score_test(xt: int, nt: int, xc: int, nc: int) -> dict:
    pooled = (xt+xc)/(nt+nc)
    variance = pooled*(1-pooled)*(1/nt+1/nc)
    # If every observation is the same, both group rates are equal. Keep finite
    # descriptive output and retain the nonzero interval uncertainty elsewhere.
    z = (xt/nt-xc/nc)/math.sqrt(variance) if variance else 0.0
    return {"method": "two_sided_pooled_proportion_score",
            "z": z, "p_two_sided": math.erfc(abs(z)/math.sqrt(2))}


def _exact_keys(value: object, expected: set[str], name: str) -> None:
    if type(value) is not dict or set(value) != expected:
        raise ValueError(f"{name} must have exactly its declared schema keys")


def _validate(document: object) -> None:
    _exact_keys(document, {"schema_version", "origin", "records"}, "document")
    if document["schema_version"] != "1.0":
        raise ValueError("unsupported schema_version")
    if type(document["origin"]) is not str or document["origin"] not in ("synthetic", "research"):
        raise ValueError("origin must be synthetic or research; public/local exports are ineligible")
    records = document["records"]
    if type(records) is not list:
        raise ValueError("records must be a list")
    seen = set()
    assigned = Counter()
    for index, record in enumerate(records):
        _exact_keys(record, {"participant_id", "arm", "outcome", "reason"}, f"record {index}")
        pid = record["participant_id"]
        if type(pid) is not str or not _ID.fullmatch(pid):
            raise ValueError("participant_id must be 1–128 ASCII letters, digits, underscores or hyphens")
        if pid in seen:
            raise ValueError("duplicate participant_id")
        seen.add(pid)
        arm, outcome, reason = record["arm"], record["outcome"], record["reason"]
        if type(arm) is not str or arm not in ARMS:
            raise ValueError("unrecognized arm")
        if outcome is not None and (type(outcome) is not int or outcome not in (0, 1)):
            raise ValueError("outcome must be integer 0, integer 1, or null; booleans are invalid")
        if type(reason) is not str or reason not in REASONS:
            raise ValueError("unrecognized outcome reason")
        valid_reason = (
            (outcome is None and reason == "technical_unknown")
            or (outcome == 1 and reason == "recovered")
            or (outcome == 0 and reason in ("failed", "timeout", "voluntary_stop"))
        )
        if not valid_reason:
            raise ValueError("outcome and reason are inconsistent")
        assigned[arm] += 1
    if any(assigned[arm] == 0 for arm in ARMS):
        raise ValueError("both arms must contain at least one assigned participant")


def analyze_document(document: dict) -> dict:
    """Analyze exact schema input without changing or exporting its records."""
    _validate(document)
    counts = {}
    for arm in ARMS:
        rows = [r for r in document["records"] if r["arm"] == arm]
        reasons = Counter(r["reason"] for r in rows)
        unknown = reasons["technical_unknown"]
        counts[arm] = {
            "assigned": len(rows),
            "known_outcomes": len(rows)-unknown,
            "successes": reasons["recovered"],
            "observed_failures": sum(reasons[r] for r in ("failed", "timeout", "voluntary_stop")),
            "technical_unknowns": unknown,
            "reasons": {r: reasons[r] for r in REASONS},
        }
    c, t = counts["observation"], counts["precommitment"]
    complete = not (c["technical_unknowns"] or t["technical_unknowns"])
    primary = {"status": "complete" if complete else "technically_incomplete",
               "risk_difference": None, "ci95": None, "score_test": None}
    descriptive, sensitivity = None, None
    if complete:
        primary.update(_comparison(t["successes"], t["assigned"], c["successes"], c["assigned"]))
        primary["score_test"] = _score_test(t["successes"], t["assigned"], c["successes"], c["assigned"])
    else:
        if t["known_outcomes"] and c["known_outcomes"]:
            descriptive = {
                "label": "Observed-case descriptive comparison; not an ITT point estimate",
                **_comparison(t["successes"], t["known_outcomes"], c["successes"], c["known_outcomes"]),
            }
        corners = []
        for t_value in (0, 1):
            for c_value in (0, 1):
                comparison = _comparison(
                    t["successes"] + t_value*t["technical_unknowns"], t["assigned"],
                    c["successes"] + c_value*c["technical_unknowns"], c["assigned"],
                )
                corners.append({"treatment_unknown_as": t_value,
                                "control_unknown_as": c_value, **comparison})
        sensitivity = {
            "method": "all-unknown outcome imputation corners; approximate 95% interval envelope",
            "risk_difference_identified": [min(r["risk_difference"] for r in corners),
                                           max(r["risk_difference"] for r in corners)],
            "ci95_envelope": [min(r["ci95"][0] for r in corners), max(r["ci95"][1] for r in corners)],
            "imputation_corners": corners,
        }
    origin = document["origin"]
    return {
        "schema_version": "1.0",
        "origin": origin,
        "label": ("SYNTHETIC ARITHMETIC DEMONSTRATION — not human evidence" if origin == "synthetic"
                  else "DECLARED RESEARCH OUTCOMES — upstream provenance and study-validity checks are required"),
        "origin_is_declaration_not_proof": True,
        "unit": "assigned_participant_first_recovery_episode",
        "comparison": "precommitment_minus_observation",
        "interval_method": "Newcombe independent-proportion interval from Wilson score limits, 95%",
        "counts": counts,
        "primary": primary,
        "observed_case_descriptive": descriptive,
        "missingness_sensitivity": sensitivity,
    }


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON object key")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    raise ValueError("nonfinite JSON constants are invalid")


def load_document(path: str | Path) -> dict:
    """Strict JSON parser rejects duplicate keys and NaN/Infinity extensions."""
    document = json.loads(Path(path).read_text(encoding="utf-8"),
                          object_pairs_hook=_unique_object,
                          parse_constant=_reject_constant)
    _validate(document)
    return document


def main() -> int:
    parser = argparse.ArgumentParser(description="Summarize declared binary outcomes; synthetic data stays labeled.")
    parser.add_argument("input", type=Path, help="exact-schema JSON outcome document")
    args = parser.parse_args()
    try:
        report = analyze_document(load_document(args.input))
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
