#!/usr/bin/env python3
"""R038 three mage items: recipe arithmetic and isolated single-spell resource model.

Not the game engine or a hero/HB result. Exact rational event times; zero cast/
flight time, always hit, no enemy death/control/overkill. Same spell: 150 + AP,
60 mana, 6s cooldown, MR50. Each cast snapshots before post-cast buffs refresh.
"""

from fractions import Fraction as F
import json
from pathlib import Path
import re

TEXT = (Path(__file__).resolve().parents[1] / "EQUIPMENT-DESIGN.md").read_text()
ROWS = [[c.strip() for c in line.strip("|").split("|")]
        for line in TEXT.splitlines() if line.startswith("| ")]
IDS = dict(re.findall(r"^((?:white|blue|purple)_\w+)\s+(\S+)", TEXT, re.M))
NAME_IDS = {name: key for key, name in IDS.items()}
LABELS = {"ap": "法强", "haste": "技能急速", "mana": "法力(?:上限)?", "regen": "法力回复"}
PRICE_LABELS = {"ap": "法强每点", "haste": "技能急速每点", "mana": "法力每点", "regen": "每秒法力回复增加 1"}
PRICES = {k: F(next(r[1].split()[0] for r in ROWS if r[0] == label)) for k, label in PRICE_LABELS.items()}
NAMES = ["辉光法杖", "流转法典", "澄源法杖"]


def parse_stats(text):
    result = {}
    for key, label in LABELS.items():
        match = re.search(label + r"\s*\+([\d.]+)", text)
        if match:
            result[key] = F(match.group(1))
    return result


CATALOG = {}
for row in ROWS:
    kind = NAME_IDS.get(row[0], "").split("_")[0]
    if kind == "white" and len(row) == 5 and row[2].isdigit():
        CATALOG[row[0]] = {"stats": parse_stats(row[1]), "price": int(row[2])}
    elif kind == "blue" and len(row) == 5 and row[3].isdigit() and row[4].isdigit():
        CATALOG[row[0]] = {"stats": parse_stats(row[2]), "price": int(row[3])}
    elif row[0] in NAMES and len(row) == 7 and row[5].isdigit():
        CATALOG[row[0]] = {"stats": parse_stats(row[1]), "passive": row[2], "effect": row[3],
                           "materials": row[4].split("＋"), "price": int(row[5]), "fee": int(row[6])}


def effect(name, pattern):
    return F(re.search(pattern, CATALOG[name]["effect"]).group(1))


AP_BUFF = effect("流转法典", r"法强额外 \+([\d.]+)")
AP_DURATION = effect("流转法典", r"持续 ([\d.]+) 秒")
MANA_BUFF = effect("澄源法杖", r"回复额外 \+([\d.]+)/秒")
MANA_DURATION = effect("澄源法杖", r"持续 ([\d.]+) 秒")


def simulate(items=(), duration=40, base_regen=5, enable_passives=True, base_damage=150, ap_ratio=1):
    stats = {key: sum((CATALOG[name]["stats"].get(key, F(0)) for name in items), F(0)) for key in LABELS}
    max_mana = F(200) + stats["mana"]
    mana, start_mana = max_mana, max_mana  # Explicit full-mana test start, not a purchase heal.
    base_rate = F(base_regen) + stats["regen"]
    cost, cooldown, end = F(60), F(6) / (1 + stats["haste"] / 100), F(duration)
    t = ready = ap_until = mana_until = F(0)
    casts = buffed_casts = 0
    damage = recovered = bonus_recovered = spent = F(0)
    has_ap = enable_passives and "流转法典" in items  # Named passives once, base stats per copy.
    has_mana = enable_passives and "澄源法杖" in items
    while t < end:
        if t >= ready and mana >= cost:
            ap_bonus = AP_BUFF if has_ap and t < ap_until else F(0)
            damage += (F(base_damage) + F(ap_ratio) * (stats["ap"] + ap_bonus)) * F(2, 3)
            casts += 1
            buffed_casts += int(ap_bonus > 0)
            mana -= cost
            spent += cost
            ready = t + cooldown
            if has_ap:
                ap_until = t + AP_DURATION
            if has_mana:  # Fixture pays positive cost and completes release each time.
                mana_until = t + MANA_DURATION
        bonus_rate = MANA_BUFF if has_mana and t < mana_until else F(0)
        rate = base_rate + bonus_rate
        events = [end]
        if ready > t:
            events.append(ready)
        if mana_until > t:
            events.append(mana_until)
        if mana < cost and rate > 0:
            events.append(t + (cost - mana) / rate)
        next_t = min(events)
        assert next_t > t
        actual = min(max_mana - mana, rate * (next_t - t))
        mana += actual
        recovered += actual
        if rate:
            bonus_recovered += actual * bonus_rate / rate
        t = next_t
    assert start_mana + recovered - spent == mana
    assert 0 <= mana <= max_mana
    return {"casts": casts, "buffed_casts": buffed_casts, "dps": round(float(damage / end), 4),
            "passive_mana_received": round(float(bonus_recovered), 4), "end_mana": round(float(mana), 4)}


def main():
    budgets = []
    for name in NAMES:
        item = CATALOG[name]
        material_price = sum(CATALOG[m]["price"] for m in item["materials"])
        base_gold = sum(PRICES[k] * value for k, value in item["stats"].items())
        reserve = item["price"] - base_gold
        assert item["price"] == material_price + item["fee"]
        assert 1400 <= item["price"] <= 2200
        assert all(item["stats"].get(k, 0) >= sum(CATALOG[m]["stats"].get(k, 0) for m in item["materials"]) for k in LABELS)
        if item["passive"] == "—":
            assert reserve == 0
        else:
            assert 150 <= reserve <= 450 and F("0.1") <= reserve / item["price"] <= F("0.25")
        declaration = re.search(r"^" + NAME_IDS[name] + r" .*", TEXT, re.M).group(0)
        assert f"price={item['price']}; combineFee={item['fee']};" in declaration
        assert declaration.split(" = ")[1].split(";")[0].split(" + ") == [NAME_IDS[m] for m in item["materials"]]
        budgets.append({"item": name, "materials": material_price, "base_gold": float(base_gold),
                        "passive_budget": float(reserve), "fee": item["fee"], "price": item["price"]})
    assert [simulate(duration=t)["casts"] for t in (20, 40, 60)] == [4, 6, 8]
    scenarios = []
    for regen in (5, 12):
        for name in (None, *NAMES):
            for duration in (5, 10, 20, 40, 60, 180):
                items = (name,) if name else ()
                scenarios.append({"item": name or "裸装", "base_regen": regen, "seconds": duration,
                                  "with_passive": simulate(items, duration, regen),
                                  "without_passive": simulate(items, duration, regen, False)})
    coefficient_sensitivity = []
    for base_damage, ratio in ((300, F('0.5')), (100, F('1.5'))):
        for name in (None, *NAMES):
            for duration in (40, 180):
                coefficient_sensitivity.append({"item": name or "裸装", "base_damage": base_damage,
                    "ap_ratio": float(ratio), "base_regen": 12, "seconds": duration,
                    **simulate((name,) if name else (), duration, 12, base_damage=base_damage, ap_ratio=ratio)})
    print(json.dumps({"scope": "R038 single-spell design model, not hero/game/HB validation",
                      "budgets": budgets, "scenarios": scenarios,
                      "effect_gold": {"余韵": [float(AP_BUFF * u * PRICES['ap']) for u in (F('.5'), F('.7'), F('.9'), F(1))],
                                      "导流": [float(MANA_BUFF * u * PRICES['regen']) for u in (F('.6'), F('.8'), F(1))]},
                      "coefficient_sensitivity": coefficient_sensitivity,
                      "two_copies_40s": {name: simulate((name, name)) for name in NAMES},
                      "codex_and_staff_180s": {"with_passives": simulate(("流转法典", "澄源法杖"), 180),
                                                "without_passives": simulate(("流转法典", "澄源法杖"), 180, enable_passives=False)}}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
