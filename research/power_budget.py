#!/usr/bin/env python3
"""Planning-only binary sample sizes and participant/platform budgets.

Python 3.11+, standard library only. Equal independent arms; two-sided normal
approximation; no continuity correction. Not exact power, an expected effect,
a recruitment instruction, or a complete study budget. Formula and limitations
are explained in docs/06_RESEARCH_PROTOCOL.md.

Related primary software documentation:
https://www.statsmodels.org/stable/generated/statsmodels.stats.proportion.samplesize_proportions_2indep_onetail.html
Current platform assumptions checked 2026-10-11:
https://researcher-help.prolific.com/en/articles/445239-what-is-your-pricing
"""

from __future__ import annotations

import argparse
from decimal import Decimal, ROUND_HALF_UP
import json
import math
from statistics import NormalDist


def _number(value: object, name: str) -> float:
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number, not a boolean")
    return float(value)


def required_per_arm(p0: float, p1: float, *, alpha: float = .05,
                     power: float = .8) -> int:
    """Normal-approximation n, rounded up; p0/p1 are control/treatment rates."""
    p0, p1 = _number(p0, "p0"), _number(p1, "p1")
    alpha, power = _number(alpha, "alpha"), _number(power, "power")
    if not (0 <= p0 <= 1 and 0 <= p1 <= 1):
        raise ValueError("p0 and p1 must be probabilities in [0, 1]")
    if p0 == p1:
        raise ValueError("zero effect: no finite sample detects equal rates")
    if not (0 < alpha < 1 and .5 < power < 1):
        raise ValueError("require 0 < alpha < 1 and .5 < power < 1")
    normal = NormalDist()
    pbar = (p0 + p1) / 2
    za, zb = normal.inv_cdf(1 - alpha / 2), normal.inv_cdf(power)
    numerator = (
        za * math.sqrt(2 * pbar * (1 - pbar))
        + zb * math.sqrt(p0 * (1 - p0) + p1 * (1 - p1))
    ) ** 2
    return max(1, math.ceil(numerator / (p1 - p0) ** 2))


def participant_budget(n: int, *, minutes: float = 30,
                       hourly_rate: float = 15,
                       platform_fee: float = .42857) -> dict:
    """USD scenario; rounded monetary amounts, fee is added to rewards."""
    if type(n) is not int or n <= 0:
        raise ValueError("n must be a positive integer, not a boolean")
    for name, value in (("minutes", minutes), ("hourly_rate", hourly_rate),
                        ("platform_fee", platform_fee)):
        _number(value, name)
    if minutes <= 0 or hourly_rate <= 0 or platform_fee < 0:
        raise ValueError("duration/rate must be positive and fee nonnegative")
    reward = Decimal(n) * Decimal(str(minutes)) * Decimal(str(hourly_rate)) / 60
    fee = reward * Decimal(str(platform_fee))

    def money(value: Decimal) -> float:
        return float(value.quantize(Decimal(".01"), rounding=ROUND_HALF_UP))

    return {
        "participants": n,
        "minutes": minutes,
        "hourly_rate_usd": hourly_rate,
        "platform_fee_fraction": platform_fee,
        "participant_rewards_usd": money(reward),
        "platform_fee_usd": money(fee),
        "total_usd": money(reward + fee),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Planning-only sample size and USD budget.")
    parser.add_argument("--p0", type=float, default=.5, help="control success probability")
    parser.add_argument("--p1", type=float, default=.7, help="treatment success probability")
    parser.add_argument("--alpha", type=float, default=.05)
    parser.add_argument("--power", type=float, default=.8)
    parser.add_argument("--recruits", type=int, default=224, help="budget headcount; not automatic sample target")
    parser.add_argument("--hourly-rate", type=float, default=15)
    parser.add_argument("--platform-fee", type=float, default=.42857)
    args = parser.parse_args()
    try:
        n = required_per_arm(args.p0, args.p1, alpha=args.alpha, power=args.power)
        report = {
            "label": "PLANNING SCENARIO — not exact power or spending authorization",
            "method": "equal-arm independent binary normal approximation, two-sided, no continuity correction",
            "assumptions": {"p0": args.p0, "p1": args.p1, "alpha": args.alpha, "power": args.power},
            "sample_size": {"per_arm": n, "total_analyzed": 2*n},
            "budget_scenarios": [participant_budget(args.recruits, minutes=m,
                hourly_rate=args.hourly_rate, platform_fee=args.platform_fee) for m in (30, 45)],
            "limits": [
                "Unknown true effects and baseline rates; confirm assumptions before preregistration.",
                "Approximation can be poor near boundary probabilities or small expected counts.",
                "Budget headcount is independent of calculated sample size; no implicit adequacy claim.",
                "Excludes pilot, review, taxes, screening, extra compensation, publication and infrastructure.",
                "Corporate fee assumption 0.42857 checked 2026-10-11; verify current quote before launch."
            ],
        }
    except (ValueError, OverflowError) as exc:
        parser.error(str(exc))
    print(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
