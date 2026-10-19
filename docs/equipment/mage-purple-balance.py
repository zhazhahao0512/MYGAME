#!/usr/bin/env python3
"""R042 mage passive revision: recipe arithmetic and isolated resource model.

Not the game engine or a hero/HB result. Exact rational event times; zero cast/
flight time, always hit, no enemy death/control/overkill. Same spell: 150 + AP,
60 mana, 6s cooldown, MR50 by default. R038 mode retains the rejected passives
for controlled comparisons at identical base stats, not their historical price.
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


PROC_BASE = effect("流转法典", r"附加 ([\d.]+)＋")
PROC_RATIO = effect("流转法典", r"＋([\d.]+)% 法强") / 100
PROC_CD = effect("流转法典", r"独立冷却 ([\d.]+) 秒")
REFUND = effect("澄源法杖", r"恢复 ([\d.]+) 法力")


def simulate(items=(), duration=40, base_regen=5, mode="current", base_damage=150,
             ap_ratio=1, mana_cost=60, base_cooldown=6, extra_ap=0, targets=1,
             kill_times=(), kill_refund=None):
    assert mode in ("current", "r038", "off")
    assert duration > 0 and base_regen >= 0 and mana_cost >= 0 and base_cooldown > 0 and targets >= 1
    stats = {key: sum((CATALOG[name]["stats"].get(key, F(0)) for name in items), F(0)) for key in LABELS}
    stats["ap"] += F(extra_ap)
    max_mana = F(200) + stats["mana"]
    mana, start_mana = max_mana, max_mana  # Explicit full-mana test start, not a purchase heal.
    base_rate = F(base_regen) + stats["regen"]
    cost, cooldown, end = F(mana_cost), F(base_cooldown) / (1 + stats["haste"] / 100), F(duration)
    t = ready = ap_until = mana_until = F(0)
    proc_ready = F(0)  # One ready use at battle start, no charge banking.
    kills = sorted(F(x) for x in kill_times)
    assert all(x >= 0 for x in kills)
    kill_index = 0
    restore_amount = REFUND if kill_refund is None else F(kill_refund)
    assert restore_amount >= 0
    casts = buffed_casts = 0
    proc_times, refund_times = [], []
    damage = recovered = bonus_recovered = spent = F(0)
    proc_damage = refunded = F(0)
    has_proc = mode != "off" and "流转法典" in items  # Named passives once, base stats per copy.
    has_mana = mode != "off" and "澄源法杖" in items
    while t < end:
        # Exogenous credited deaths, before the next action. This does not model
        # kill/assist eligibility or damage-driven clear speed; all modes share timings.
        while kill_index < len(kills) and kills[kill_index] == t:
            if mode == "current" and has_mana:
                actual_refund = min(restore_amount, max_mana - mana)
                mana += actual_refund
                refunded += actual_refund
                refund_times.append(t)
            kill_index += 1
        if t >= ready and mana >= cost:
            ap_bonus = F(15) if mode == "r038" and has_proc and t < ap_until else F(0)
            damage += (F(base_damage) + F(ap_ratio) * (stats["ap"] + ap_bonus)) * F(2, 3) * targets
            casts += 1
            buffed_casts += int(ap_bonus > 0)
            mana -= cost
            spent += cost
            ready = t + cooldown
            if mode == "r038":
                if has_proc:
                    ap_until = t + 6
                if has_mana and cost > 0:
                    mana_until = t + 6
            elif mode == "current":
                if has_proc and t >= proc_ready:
                    extra_damage = (PROC_BASE + PROC_RATIO * stats["ap"]) * F(2, 3)
                    damage += extra_damage  # Only primary target, never multiplied by targets.
                    proc_damage += extra_damage
                    proc_times.append(t)
                    proc_ready = t + PROC_CD
        bonus_rate = F(1) if mode == "r038" and has_mana and t < mana_until else F(0)
        rate = base_rate + bonus_rate
        events = [end]
        if kill_index < len(kills):
            events.append(kills[kill_index])
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
    assert start_mana + recovered + refunded - spent == mana
    assert 0 <= mana <= max_mana
    assert all(b - a >= PROC_CD for a, b in zip(proc_times, proc_times[1:]))
    assert refunded <= restore_amount * len(refund_times)
    return {"casts": casts, "buffed_casts": buffed_casts, "dps": round(float(damage / end), 4),
            "proc_times": [round(float(x), 4) for x in proc_times],
            "proc_damage": round(float(proc_damage), 4),
            "kill_refund_times": [round(float(x), 4) for x in refund_times],
            "passive_mana_received": round(float(bonus_recovered + refunded), 4),
            "end_mana": round(float(mana), 4)}


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
            # R042 explicitly reviews a 500-gold reserve for stronger mana sustain.
            allowance = 500 if name == "澄源法杖" else 450
            assert 150 <= reserve <= allowance and F("0.1") <= reserve / item["price"] <= F("0.25")
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
                                  **{mode: simulate(items, duration, regen, mode) for mode in ("current", "r038", "off")}})
    coefficient_sensitivity = []
    for base_damage, ratio in ((300, F('0.5')), (100, F('1.5'))):
        for name in (None, *NAMES):
            for duration in (40, 180):
                coefficient_sensitivity.append({"item": name or "裸装", "base_damage": base_damage,
                    "ap_ratio": float(ratio), "base_regen": 12, "seconds": duration,
                    **simulate((name,) if name else (), duration, 12, base_damage=base_damage, ap_ratio=ratio)})
    pressure = []
    for cost in (40, 50, 60):
        for kills_count in (0, 4, 6, 8, 12):
            kills = [F(40 * i, kills_count + 1) for i in range(1, kills_count + 1)]
            common = dict(mana_cost=cost, base_cooldown=2, kill_times=kills)
            pressure.append({"cost": cost, "seconds": 40, "credited_kills": kills_count,
                **{mode: simulate(("澄源法杖",), mode=mode, **common) for mode in ("current", "r038", "off")},
                "proposed_30": simulate(("澄源法杖",), kill_refund=30, **common)})
    proc_gold = []
    for ap in (40, 100, 200, 300):
        for targets in (1, 3, 5):
            for duration in (40, 180):
                result = simulate(("流转法典",), duration, base_regen=12, extra_ap=ap-40, targets=targets)
                # Counterfactual flat AP has no item proc; all casts/targets share ratio 1 and MR50.
                gold = result["proc_damage"] / (result["casts"] * targets * 2/3) * float(PRICES['ap'])
                proc_gold.append({"ap": ap, "targets": targets, "seconds": duration, "gold": round(gold, 2)})
    assert simulate(("流转法典",), duration=12, base_cooldown=1, mana_cost=0)["proc_times"] == [0.0]
    assert len(simulate(("流转法典",), duration=13, base_cooldown=1, mana_cost=0)["proc_times"]) == 2
    assert simulate(("澄源法杖",), kill_times=())["passive_mana_received"] == 0
    assert simulate(("澄源法杖",), mana_cost=0, kill_times=(1,2))["passive_mana_received"] == 0
    assert simulate(("澄源法杖", "澄源法杖"), duration=2, kill_times=(1,))["passive_mana_received"] == float(REFUND)
    assert simulate(("澄源法杖",), duration=2, kill_times=(1,1))["passive_mana_received"] == float(REFUND * 2)
    assert simulate(("澄源法杖",), duration=2, kill_times=(2,))["passive_mana_received"] == 0
    print(json.dumps({"scope": "R042 single-spell design model, not hero/game/HB validation",
                      "budgets": budgets, "scenarios": scenarios,
                      "resource_pressure": pressure, "proc_gold": proc_gold,
                      "takedown_gold_no_overflow_40s": {str(kills): float(REFUND * kills / 40 * PRICES['regen'])
                                                       for kills in (0, 4, 6, 8, 12)},
                      "coefficient_sensitivity": coefficient_sensitivity,
                      "two_copies_40s": {name: simulate((name, name)) for name in NAMES},
                      "codex_and_staff_40s_8_kills": {mode: simulate(("流转法典", "澄源法杖"),
                          base_cooldown=2, mana_cost=50, kill_times=range(4,33,4), mode=mode)
                          for mode in ("current", "off")}}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
