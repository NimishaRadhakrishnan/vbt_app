"""The pure incentive rules from the build brief, line by line."""
from decimal import Decimal as D

from app.domain.services.incentive_calculator import (
    GradeBand, Level, Rules, compute_incentive, grade_for, score_items, what_if,
)

RULES = Rules(levels=[
    Level(1, D("0.8"), D("0.0015"), D("0.85"), D("0.0125")),
    Level(2, D("1.0"), D("0.0025"), D("1.1"), D("0.015")),
    Level(3, D("1.2"), D("0.005"), D("1.4"), D("0.0175")),
])
RUPEE = 100
GOAL = 1_015_205 * RUPEE


def run(sales_pct, coll_pct, score="100", sales_goal=GOAL):
    s = int(D(sales_goal) * D(sales_pct))
    c = int(D(sales_goal) * D(coll_pct))
    return compute_incentive(s, sales_goal, c, None, RULES, D(score))


def test_worked_check_gives_1561_rupees():
    r = compute_incentive(GOAL, GOAL, 600_000 * RUPEE, None, RULES, D("102.5"))
    assert r.raw_sales_level == 2 and r.raw_collection_level == 0
    assert (r.sales_level, r.collection_level, r.level_match_applied) == (1, 0, True)
    assert r.sales_incentive_paise == D("152280.75")          # 1,522.81 rupees
    assert r.collection_incentive_paise == 0
    assert r.final_paise == 1561 * RUPEE


def test_sales_under_80_percent_pays_nothing():
    r = run("0.799", "1.5", "110")
    assert r.entry_rule_applied and (r.sales_level, r.collection_level) == (0, 0)
    assert r.final_paise == 0


def test_levels_3_and_1_drops_the_higher_one():
    r = run("1.25", "0.9")
    assert (r.raw_sales_level, r.raw_collection_level) == (3, 1)
    assert (r.sales_level, r.collection_level) == (2, 1) and r.level_match_applied


def test_levels_3_and_0_drops_once_only():
    r = run("1.25", "0.5")
    assert (r.raw_sales_level, r.raw_collection_level) == (3, 0)
    assert (r.sales_level, r.collection_level) == (2, 0)      # not 1


def test_levels_one_apart_are_left_alone():
    r = run("1.0", "0.9")
    assert (r.sales_level, r.collection_level, r.level_match_applied) == (2, 1, False)


def test_rounds_to_the_rupee_only_at_the_end():
    r = run("1.0", "1.1", "100")
    # 0.25% of sales + 1.5% of collection, unrounded until the last step
    assert r.final_paise % RUPEE == 0
    expected = (D(GOAL) * D("0.0025") + int(D(GOAL) * D("1.1")) * D("0.015")) / RUPEE
    assert r.final_paise == int(expected.quantize(D(1), rounding="ROUND_HALF_UP")) * RUPEE


def test_collection_goal_falls_back_to_sales_goal():
    a = compute_incentive(GOAL, GOAL, GOAL, None, RULES, D("100"))
    b = compute_incentive(GOAL, GOAL, GOAL, GOAL, RULES, D("100"))
    assert a.final_paise == b.final_paise


def test_score_factor_has_a_ceiling():
    hi = compute_incentive(GOAL, GOAL, GOAL, None, RULES, D("150"))
    at_cap = compute_incentive(GOAL, GOAL, GOAL, None, RULES, D("120"))
    assert hi.final_paise == at_cap.final_paise


def test_item_over_120_percent_is_capped_and_marked_max():
    # focus products 300% -> 18 of 15; dealers 130% -> 12 of 10 (the sheet)
    score, items = score_items([
        ("focus", D(15), D("1.2"), D(300), D(100)),
        ("dealers", D(10), D("1.2"), D(130), D(100)),
    ])
    by = {i.code: i for i in items}
    assert by["focus"].marks == D(18) and by["focus"].at_max
    assert by["dealers"].marks == D(12) and by["dealers"].at_max
    assert score == D(30)


def test_goal_of_zero_is_skipped_and_weight_is_shared():
    score, items = score_items([
        ("a", D(20), D("1.2"), D(10), D(10)),
        ("b", D(20), D("1.2"), D(5), D(0)),      # skipped
    ])
    assert items[1].skipped and items[1].marks == 0
    assert score == D(40)                          # a carries both weights: 40 * 100%


def test_officer_with_no_work_scores_zero_without_dividing_by_zero():
    score, items = score_items([("a", D(20), D("1.2"), D(0), D(10)), ("b", D(80), D("1.2"), D(0), D(10))])
    assert score == 0 and not any(i.skipped for i in items)


def test_everything_skipped_scores_zero():
    score, _ = score_items([("a", D(20), D("1.2"), D(1), D(0))])
    assert score == 0


def test_grade_bands():
    bands = [GradeBand("A", "Outstanding", D(90)), GradeBand("B", "Good", D(75)),
             GradeBand("C", "Average", D(60)), GradeBand("D", "Needs support", D(0))]
    assert [grade_for(D(x), bands).grade for x in ("95", "90", "89.9", "60", "10")] == ["A", "A", "B", "C", "D"]


def test_what_if_matches_the_brief_example():
    r = compute_incentive(GOAL, GOAL, 600_000 * RUPEE, None, RULES, D("102.5"))
    w = what_if(GOAL, GOAL, 600_000 * RUPEE, None, RULES, D("102.5"), r)
    assert w.next_collection_level == 1
    assert w.collection_needed_paise == 262_925 * RUPEE            # rounded UP
    assert w.collection_also_restores_sales is True
    assert r.final_paise + w.collection_extra_paise == 13_658 * RUPEE
