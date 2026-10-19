#!/usr/bin/env python3
"""R025 design arithmetic, not a game simulation or a runtime test suite.

Run from any directory with Python 3; reads the repository equipment design.
Assumes continuous successful basic hits, a living target, no overkill/shields,
no skills, and full uptime for the regeneration observation. Damage examples
use the existing reference crit multiplier 1.5. Fraction keeps gold exact.
"""

from fractions import Fraction
from itertools import product
import json
from pathlib import Path
import re


DOC = Path(__file__).resolve().parents[1] / "EQUIPMENT-DESIGN.md"
TEXT = DOC.read_text(encoding="utf-8")
ROWS = [
    [cell.strip() for cell in line.strip("|").split("|")]
    for line in TEXT.splitlines() if line.startswith("| ")
]
IDS = dict(re.findall(r"^((?:white|blue|purple)_\w+)\s+(\S+)", TEXT, re.M))
NAME_TO_ID = {name: item_id for item_id, name in IDS.items()}
STAT_LABELS = {
    "attack": "攻击", "crit": "暴击率", "lifesteal": "普攻吸血",
    "health": "生命上限|生命", "armor": "物抗|护甲", "attack_speed": "额外攻速|攻速",
}
UNIT_LABELS = {
    "attack": "攻击每点", "crit": "暴击率每个百分点",
    "lifesteal": "普攻吸血每个百分点", "health": "生命每点",
    "armor": "物抗每点", "attack_speed": "额外攻速每个百分点",
}
PRICES = {
    stat: Fraction(next(row[1].split()[0] for row in ROWS if row[0] == label))
    for stat, label in UNIT_LABELS.items()
}
NAMES = ["精钢重剑", "锐锋战刃", "血契长刃", "征战重斧", "铁卫战刃"]


def stats(text):
    result = {}
    for stat, label in STAT_LABELS.items():
        match = re.search(r"(?:" + label + r")\s*\+([\d.]+)", text)
        if match:
            result[stat] = Fraction(match.group(1))
    return result


CATALOG = {}
for row in ROWS:
    name = row[0]
    item_id = NAME_TO_ID.get(name, "")
    if item_id.startswith("white_") and len(row) == 5 and row[2].isdigit():
        CATALOG[name] = {"stats": stats(row[1]), "price": int(row[2])}
    elif item_id.startswith("blue_") and len(row) == 5 and row[3].isdigit() and row[4].isdigit():
        CATALOG[name] = {"stats": stats(row[2]), "price": int(row[3])}
    elif item_id.startswith("purple_") and len(row) == 7 and row[5].isdigit():
        CATALOG[name] = {
            "stats": stats(row[1]), "passive": row[2], "effect": row[3],
            "materials": row[4].split("＋"), "price": int(row[5]), "fee": int(row[6]),
        }


def effect_number(name, pattern):
    return float(re.search(pattern, CATALOG[name]["effect"]).group(1))


CRIT_BONUS = effect_number("锐锋战刃", r"增加 ([\d.]+)")
REGEN = effect_number("血契长刃", r"回复 \+([\d.]+)／秒")
REGEN_SECONDS = effect_number("血契长刃", r"持续 ([\d.]+) 秒")
LOW_HEALTH_ATTACK = effect_number("征战重斧", r"额外攻击 \+([\d.]+)")
GUARD = effect_number("铁卫战刃", r"降低 ([\d.]+)%") / 100


def dps(name, attack=100, crit=0, frequency=1, target_armor=50, low=False, copies=1):
    item = CATALOG[name]["stats"] if name else {}
    total_attack = attack + float(item.get("attack", 0)) * copies
    if name == "征战重斧" and low:
        total_attack += LOW_HEALTH_ATTACK  # Named passive once, regardless of copies.
    total_crit = min(1, (crit + float(item.get("crit", 0)) * copies) / 100)
    multiplier = 1.5 + (CRIT_BONUS if name == "锐锋战刃" else 0)
    return total_attack * frequency * (1 + total_crit * (multiplier - 1)) * 100 / (100 + target_armor)


def effective_health(name, physical_basic_share, copies=1):
    item = CATALOG[name]["stats"]
    hp = 1000 + float(item.get("health", 0)) * copies
    armor = 50 + float(item.get("armor", 0)) * copies
    physical = 100 / (100 + armor) * (1 - GUARD if name == "铁卫战刃" else 1)
    magic = 100 / 150
    return hp / (physical_basic_share * physical + (1 - physical_basic_share) * magic)


def main():
    budgets, recipes, shapes = [], set(), []
    for name in NAMES:
        item = CATALOG[name]
        assert not item["stats"].get("attack_speed", 0), name
        assert 1400 <= item["price"] <= 2200, name
        recipe = tuple(sorted(item["materials"]))
        assert recipe not in recipes, name
        recipes.add(recipe)
        material_cost = sum(CATALOG[m]["price"] for m in item["materials"])
        material_stats = {}
        for material in item["materials"]:
            for key, value in CATALOG[material]["stats"].items():
                material_stats[key] = material_stats.get(key, 0) + value
        assert all(item["stats"].get(k, 0) >= v for k, v in material_stats.items()), name
        budget = sum(PRICES[k] * v for k, v in item["stats"].items())
        reserve = item["price"] - budget
        assert item["price"] == material_cost + item["fee"], name
        assert reserve >= 0 and item["fee"] >= 0, name
        assert budget - material_cost + reserve == item["fee"], name
        assert (item["passive"] == "—") == (reserve == 0), name
        declaration = re.search(r"^" + NAME_TO_ID[name] + r" .*", TEXT, re.M).group(0)
        assert f"price={item['price']}; combineFee={item['fee']};" in declaration, name
        assert declaration.split(" = ")[1].split(";")[0].split(" + ") == [
            NAME_TO_ID[m] for m in item["materials"]
        ], name
        shapes.append(tuple(sorted(NAME_TO_ID[m].split("_")[0] for m in item["materials"])))
        budgets.append({"name": name, "price": item["price"], "materials": material_cost,
                        "base_budget": float(budget), "effect_budget": float(reserve), "fee": item["fee"]})
    assert shapes.count(("blue", "white")) == 3
    assert shapes.count(("blue", "blue")) == 1
    assert shapes.count(("blue", "white", "white")) == 1
    sensitivity_cases = 0
    for attack, crit, frequency, armor in product((60, 100, 200, 300), (0, 30, 80, 100), (0.7, 1, 1.3), (0, 50, 150)):
        baseline = dps(None, attack, crit, frequency, armor)
        for name in NAMES:
            assert dps(name, attack, crit, frequency, armor) >= baseline
            sensitivity_cases += 1
    reference = [{"name": name, "base_dps": round(dps(name), 4),
                  "low_health_dps": round(dps(name, low=True), 4),
                  "growth_dps": round(dps(name, 200, 30, 1.5, 100), 4)} for name in NAMES]
    lifesteal = float(CATALOG["血契长刃"]["stats"]["lifesteal"]) / 100
    report = {
        "scope": "R025 design analysis; no game engine or deployment verification",
        "budgets": budgets, "reference": reference,
        "regeneration": {"per_second": REGEN, "duration_seconds": REGEN_SECONDS,
                         "full_uptime_injured_healing_per_second": round(dps("血契长刃") * lifesteal + REGEN, 4)},
        "effective_health": {name: {str(share): round(effective_health(name, share), 4)
                                   for share in (1, 0.5, 0)} for name in ("征战重斧", "铁卫战刃")},
        "sensitivity_case_count": sensitivity_cases,
        "status": "PASS: recipes, costs, retained material attributes, and analytical scenarios",
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
