#!/usr/bin/env python3
"""R035 passive gold equivalents under declared design scenarios, not simulation.

Run from any directory. Current effect values and acquisition prices come from
EQUIPMENT-DESIGN.md via the existing parser. Scenario endpoints are illustrative,
not observed frequencies or universal bounds. Price is used only AFTER valuing
an effect, to compare against its reserved budget. No runtime content is changed.
"""

from fractions import Fraction as F
import importlib.util
import json
from pathlib import Path


spec = importlib.util.spec_from_file_location(
    "physical_purple", Path(__file__).with_name("physical-purple-balance.py")
)
design = importlib.util.module_from_spec(spec)
spec.loader.exec_module(design)
AD_PRICE = design.PRICES["attack"]
HP_PRICE = design.PRICES["health"]
REGEN_PRICE = F(next(
    row[1].split()[0].replace("／", "/")
    for row in design.ROWS if row[0] == "每秒生命回复增加 1"
))
CRIT_BONUS = F(str(design.CRIT_BONUS))
REGEN = F(str(design.REGEN))
LOW_ATTACK = F(str(design.LOW_HEALTH_ATTACK))
GUARD = F(str(design.GUARD))


def critical_gold(attack, crit):
    """Basic-body output equivalent; no AD skills, overkill, or healing feedback."""
    equivalent_attack = attack * CRIT_BONUS * crit / (1 + F(1, 2) * crit)
    return equivalent_attack * AD_PRICE


def regeneration_gold(coverage):
    """Constant-regen equivalent, injured throughout the reference window."""
    return REGEN * coverage * REGEN_PRICE


def low_health_gold(coverage):
    """Coverage weighted by output sensitivity to AD before adding the passive."""
    return LOW_ATTACK * coverage * AD_PRICE


def guard_gold(health, share):
    """HP equivalent at fixed incoming mix, no heals/shields/control/finite kills.

    share is measured after other mitigations but before this passive.
    """
    equivalent_health = health * (1 / (1 - GUARD * share) - 1)
    return equivalent_health * HP_PRICE


# Ordered: low endpoint, representative point, high endpoint.
SCENARIOS = [
    ("狠厉", "锐锋战刃", critical_gold,
     "total AD / equipped crit probability; base crit multiplier 1.5",
     [(F(150), F("0.20")), (F(180), F("0.30")), (F(220), F("0.40"))]),
    ("回流", "血契长刃", regeneration_gold,
     "trigger uptime, injured throughout",
     [(F("0.80"),), (F("0.90"),), (F(1),)]),
    ("背水", "征战重斧", low_health_gold,
     "low-health share weighted by AD-sensitive output, not clock time",
     [(F("0.35"),), (F("0.45"),), (F("0.55"),)]),
    ("卸力", "铁卫战刃", guard_gold,
     "equipped HP / eligible incoming share after other mitigations",
     [(F(1500), F("0.50")), (F(2000), F("0.75")), (F(2500), F("0.80"))]),
]


def rounded(value):
    return round(float(value), 2)


def main():
    results = []
    for passive, name, calculate, interpretation, scenarios in SCENARIOS:
        values = [calculate(*point) for point in scenarios]
        item = design.CATALOG[name]
        base_gold = sum(design.PRICES[key] * value for key, value in item["stats"].items())
        reserved = item["price"] - base_gold
        budget_share = F(reserved, item["price"])
        results.append({
            "passive": passive,
            "item": name,
            "input_meaning": interpretation,
            "scenario_inputs": [[float(value) for value in point] for point in scenarios],
            "gold_low_reference_high": [rounded(value) for value in values],
            "reserved_budget": rounded(reserved),
            "budget_share_percent": rounded(100 * budget_share),
            "within_proposed_purple_budget_band": 150 <= reserved <= 450 and F("0.10") <= budget_share <= F("0.25"),
            "item_price": item["price"],
            "base_gold_plus_reference_effect": rounded(base_gold + values[1]),
            "reference_item_value_to_price_percent": rounded(100 * (base_gold + values[1]) / item["price"]),
        })

    print(json.dumps({
        "scope": "R035 declared analytical scenarios, not observed combat balance",
        "source": "docs/EQUIPMENT-DESIGN.md, current values",
        "results": results,
        "sensitivity_examples": {
            "crit_single_item_AD124_crit10percent": rounded(critical_gold(F(124), F("0.10"))),
            "crit_hypothetical_AD300_crit60percent": rounded(critical_gold(F(300), F("0.60"))),
            "low_health_all_output_active": rounded(low_health_gold(F(1))),
            "guard_hypothetical_HP4000_all_eligible": rounded(guard_gold(F(4000), F(1))),
            "inactive_effect_increment": 0,
            "duplicate_named_passive_increment": 0,
        },
        "limitations": [
            "Scenario endpoints are not universal lower/upper bounds.",
            "No extra gold income, sell price, or additional purchase fee.",
            "No double valuation of base stats, lifesteal, armor, or total healing.",
            "Duplicate zero is the accepted design rule, not a runtime test.",
            "Hero skills, finite kills, survival, actual uptime and synergies need HB comparison.",
        ],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
