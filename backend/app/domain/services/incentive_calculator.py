"""
Pure maths for the Targets, KPI & Incentive module.

No database, no clock, no I/O - every function takes plain numbers and
returns plain numbers, so the rules in the build brief can be tested
line by line. The engine (application/use_cases/kpi_recalculate.py) is the
only caller, and nothing else in the app calculates scores or money.

Units: money is integer PAISE, ratios are Decimal (1 = 100%). The final
incentive is rounded to the nearest rupee exactly once, at the last step
(half rounds up), and returned in paise as a multiple of 100.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal
from typing import Mapping, Optional, Sequence

PAISE_PER_RUPEE = 100
ZERO = Decimal(0)
ONE = Decimal(1)


@dataclass(frozen=True)
class Level:
    level: int
    sales_min_pct: Decimal
    sales_rate: Decimal
    coll_min_pct: Decimal
    coll_rate: Decimal


@dataclass(frozen=True)
class Rules:
    levels: Sequence[Level]
    entry_min_sales_pct: Decimal = Decimal("0.8")
    level_gap: int = 2
    score_factor_max: Decimal = Decimal("1.2")  # ceiling on score / 100

    def by_level(self, n: int) -> Optional[Level]:
        for lv in self.levels:
            if lv.level == n:
                return lv
        return None


# ---------------------------------------------------------------- score items


@dataclass(frozen=True)
class ItemResult:
    code: str
    weight: Decimal
    done: Decimal
    goal: Decimal
    pct: Optional[Decimal]      # done / goal, uncapped; None when skipped
    capped_pct: Optional[Decimal]
    marks: Decimal              # score earned from this item
    max_marks: Decimal          # weight after sharing skipped weights
    skipped: bool
    at_max: bool                # hit the cap - screens mark it "Max"


def _ratio(done: Decimal, goal: Decimal) -> Optional[Decimal]:
    if goal is None or goal <= 0:
        return None
    return Decimal(done) / Decimal(goal)


def score_items(
    items: Sequence[tuple[str, Decimal, Decimal, Decimal, Decimal]],
) -> tuple[Decimal, list[ItemResult]]:
    """items = [(code, weight, cap_pct, done, goal)].

    item marks = weight * min(done / goal, cap). An item with goal 0 is
    skipped and its weight is shared across the others in proportion, so
    the maximum score stays at (sum of weights) * cap. Returns
    (score, per-item results). Score is not rounded here.
    """
    total_weight = sum((Decimal(w) for _, w, _, _, _ in items), ZERO)
    live_weight = sum(
        (Decimal(w) for _, w, _, d, g in items if _ratio(Decimal(d), Decimal(g)) is not None), ZERO
    )
    scale = (total_weight / live_weight) if live_weight > 0 else ZERO
    results: list[ItemResult] = []
    score = ZERO
    for code, weight, cap, done, goal in items:
        weight, cap, done, goal = Decimal(weight), Decimal(cap), Decimal(done), Decimal(goal)
        pct = _ratio(done, goal)
        if pct is None:
            results.append(ItemResult(code, weight, done, goal, None, None, ZERO, ZERO, True, False))
            continue
        capped = min(pct, cap)
        shared_weight = weight * scale
        marks = shared_weight * capped
        score += marks
        results.append(ItemResult(code, weight, done, goal, pct, capped, marks, shared_weight, False, pct >= cap))
    return score, results


@dataclass(frozen=True)
class GradeBand:
    grade: str
    label: str
    min_score: Decimal


def grade_for(score: Decimal, bands: Sequence[GradeBand]) -> Optional[GradeBand]:
    for band in sorted(bands, key=lambda b: b.min_score, reverse=True):
        if score >= band.min_score:
            return band
    return None


# ---------------------------------------------------------- incentive levels


def level_for(pct: Optional[Decimal], minimums: Mapping[int, Decimal]) -> int:
    """Highest level whose minimum is met, else 0."""
    if pct is None:
        return 0
    best = 0
    for lv, minimum in minimums.items():
        if pct >= minimum and lv > best:
            best = lv
    return best


@dataclass(frozen=True)
class IncentiveResult:
    sales_pct: Optional[Decimal]
    collection_pct: Optional[Decimal]
    raw_sales_level: int
    raw_collection_level: int
    sales_level: int               # after entry rule and level match rule
    collection_level: int
    entry_rule_applied: bool       # sales % under the entry minimum
    level_match_applied: bool
    sales_incentive_paise: Decimal       # unrounded, for the step-by-step view
    collection_incentive_paise: Decimal
    level_incentive_paise: Decimal
    score_factor: Decimal
    final_paise: int               # rounded to the rupee, in paise


def _apply_level_match(sales_lv: int, coll_lv: int, gap: int) -> tuple[int, int, bool]:
    """If the levels are `gap` or more apart, the higher one drops by one. Once only."""
    if abs(sales_lv - coll_lv) >= gap:
        if sales_lv > coll_lv:
            return sales_lv - 1, coll_lv, True
        return sales_lv, coll_lv - 1, True
    return sales_lv, coll_lv, False


def compute_incentive(
    sales_paise: int,
    sales_goal_paise: int,
    collection_paise: int,
    collection_goal_paise: Optional[int],
    rules: Rules,
    score: Decimal,
) -> IncentiveResult:
    """Steps 1-8 of the brief, in order."""
    # 1. percentages. Collection goal falls back to the sales goal.
    coll_goal = collection_goal_paise if collection_goal_paise else sales_goal_paise
    sales_pct = _ratio(Decimal(sales_paise), Decimal(sales_goal_paise))
    coll_pct = _ratio(Decimal(collection_paise), Decimal(coll_goal))

    # 2. levels
    raw_s = level_for(sales_pct, {l.level: l.sales_min_pct for l in rules.levels})
    raw_c = level_for(coll_pct, {l.level: l.coll_min_pct for l in rules.levels})
    s_lv, c_lv = raw_s, raw_c

    # 3. entry rule
    entry = sales_pct is None or sales_pct < rules.entry_min_sales_pct
    match = False
    if entry:
        s_lv = c_lv = 0
    else:
        # 4. level match rule
        s_lv, c_lv, match = _apply_level_match(s_lv, c_lv, rules.level_gap)

    # 5-6. incentives (paise, unrounded)
    s_rule, c_rule = rules.by_level(s_lv), rules.by_level(c_lv)
    s_inc = Decimal(sales_paise) * s_rule.sales_rate if s_rule else ZERO
    c_inc = Decimal(collection_paise) * c_rule.coll_rate if c_rule else ZERO
    level_inc = s_inc + c_inc

    # 7. score factor (with the admin ceiling)
    factor = min(Decimal(score) / 100, rules.score_factor_max)
    if factor < 0:
        factor = ZERO

    # 8. final: round to the nearest rupee, only here
    rupees = (level_inc * factor / PAISE_PER_RUPEE).quantize(ONE, rounding=ROUND_HALF_UP)
    return IncentiveResult(
        sales_pct, coll_pct, raw_s, raw_c, s_lv, c_lv, entry, match,
        s_inc, c_inc, level_inc, factor, int(rupees) * PAISE_PER_RUPEE,
    )


# ------------------------------------------------------------- "what if" helper


@dataclass(frozen=True)
class WhatIf:
    next_sales_level: Optional[int]
    sales_needed_paise: Optional[int]
    sales_extra_paise: Optional[int]
    next_collection_level: Optional[int]
    collection_needed_paise: Optional[int]
    collection_extra_paise: Optional[int]
    collection_also_restores_sales: bool


def _round_up_rupee(paise: Decimal) -> int:
    return int((paise / PAISE_PER_RUPEE).to_integral_value(rounding=ROUND_CEILING)) * PAISE_PER_RUPEE


def what_if(
    sales_paise: int,
    sales_goal_paise: int,
    collection_paise: int,
    collection_goal_paise: Optional[int],
    rules: Rules,
    score: Decimal,
    current: IncentiveResult,
) -> WhatIf:
    """Money still needed to reach the next level, rounded UP to the rupee,
    and the extra incentive each would earn at today's score."""
    coll_goal = collection_goal_paise if collection_goal_paise else sales_goal_paise
    if sales_goal_paise <= 0:
        return WhatIf(None, None, None, None, None, None, False)

    def final_for(s: int, c: int) -> int:
        return compute_incentive(s, sales_goal_paise, c, coll_goal, rules, score).final_paise

    def next_target(raw_level: int, attr: str) -> Optional[Level]:
        higher = sorted((l for l in rules.levels if l.level > raw_level), key=lambda l: l.level)
        return higher[0] if higher else None

    # next SALES level
    s_next = next_target(current.raw_sales_level, "sales_min_pct")
    s_need = s_extra = None
    if s_next:
        s_need = _round_up_rupee(Decimal(sales_goal_paise) * s_next.sales_min_pct - Decimal(sales_paise))
        s_need = max(s_need, 0)
        s_extra = final_for(sales_paise + s_need, collection_paise) - current.final_paise

    # next COLLECTION level
    c_next = next_target(current.raw_collection_level, "coll_min_pct")
    c_need = c_extra = None
    restores = False
    if c_next and coll_goal > 0:
        c_need = _round_up_rupee(Decimal(coll_goal) * c_next.coll_min_pct - Decimal(collection_paise))
        c_need = max(c_need, 0)
        after = compute_incentive(sales_paise, sales_goal_paise, collection_paise + c_need, coll_goal, rules, score)
        c_extra = after.final_paise - current.final_paise
        restores = after.sales_level > current.sales_level
    return WhatIf(
        s_next.level if s_next else None, s_need, s_extra,
        c_next.level if c_next else None, c_need, c_extra, restores,
    )
