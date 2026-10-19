"""岚牙 V0.2 独立木桩估算，不接入游戏引擎。python3 docs/heroes/lanya-dps.py

固定15级；20ms步长、零施法占用/零飞行时间、开场可行动，持续攻击不死木桩。
一组实验只升一个技能，其它技能保持1级；未分配点保留，不挪给其它技能。
输出同种子配对均值和标准误。蓝耗、命中、冷却、攻速装备计数均参与。
"""

import argparse
import importlib.util
import json
import math
from pathlib import Path
from random import Random
from statistics import mean, stdev


spec = importlib.util.spec_from_file_location('lanya_balance', Path(__file__).with_name('lanya-balance.py'))
balance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(balance)
PANEL = balance.stats(15)
DT = .02
CASES = {'all_1': (1, 1, 1, 1), 'skill_1_max': (4, 1, 1, 1),
         'skill_2_max': (1, 4, 1, 1), 'skill_3_max': (1, 1, 4, 1),
         'skill_4_max': (1, 1, 1, 3), 'all_max': (4, 4, 4, 3)}


def chance(accuracy, target_slot=3, evasion=0):
    return min(1, max(0, (accuracy - evasion - 2 * (3 + target_slot - 2)) / 100))


def simulate(ranks, seed, geared=False, unlimited=False, seconds=40, dt=DT, level=15):
    r1, r2, r3, r4 = ranks
    attack_rng, skill_rng = Random(seed), Random(seed + 1000000)
    panel = balance.stats(level)
    ad = panel['ad'] + (30 if geared else 0)
    mana = panel['mana']
    cooldown = (11 - r1, 16 - r2, 15 - r3, 62 - 7 * r4)
    cost = (26 + 2 * r1, 32 + 3 * r2, 36 + 4 * r3, 70 + 10 * r4)
    ready = [0.] * 4
    casts = [0] * 4
    charges = 0
    q_end = w_end = e_end = r_end = 0.
    spear_end = 0.
    spear_stacks = hit_count = attacks = 0
    next_attack = 0.
    primary = total = w_time = r_time = e_time = 0.
    spent = 0.
    snapshots = {}

    def can_cast(i, t):
        return ranks[i] > 0 and t + 1e-9 >= ready[i] and (unlimited or mana + 1e-9 >= cost[i])

    for tick in range(round(seconds / dt)):
        t = tick * dt
        if t + 1e-9 >= q_end:
            charges = 0
        if t + 1e-9 >= spear_end:
            spear_stacks = 0
        # 仅为零施法占用的木桩假设；不将此顺序当成当前游戏同帧契约。
        for i in (3, 1, 0, 2):
            ultimate = t < r_end - 1e-9
            if not can_cast(i, t):
                continue
            if (i == 3 and ultimate) or (i in (0, 1) and ultimate):
                continue
            if (i == 0 and charges) or (i == 1 and t < w_end - 1e-9):
                continue
            if not unlimited:
                mana -= cost[i]
            spent += cost[i]
            casts[i] += 1
            ready[i] = t + cooldown[i]
            if i == 3:
                r_end = t + 10
                charges = 0
                q_end = w_end = t
            elif i == 1:
                w_end = t + 5
            elif i == 0:
                charges, q_end = 5, t + 8
            else:
                e_end = t + 4
                arrow = balance.volley(r3, ad) / 1.5
                for slot in (3, 4, 5):
                    if skill_rng.random() < chance(95 + 3 + 3 * r3, slot):
                        total += arrow
                        if slot == 3:
                            primary += arrow

        ultimate = t < r_end - 1e-9
        w_active = r2 > 0 and (ultimate or t < w_end - 1e-9)
        e_active = t < e_end - 1e-9
        if t + 1e-9 >= next_attack:
            attack_speed = .91 * (1 + panel['growth_as'] + (.88 if geared else 0)
                                  + .04 * spear_stacks
                                  + (.10 + .15 * r2 if w_active else 0)) * 1.1
            # 间隔在发起攻击时锁定；本次命中后的穷追从下一次发起计算。
            next_attack = t + 1 / attack_speed
            attacks += 1
            q_active = r1 > 0 and (ultimate or charges > 0)
            if not ultimate and charges:
                charges -= 1  # 未命中也消耗。
            accuracy = 95 + (3 + 3 * r3 if e_active else 0)
            if attack_rng.random() < chance(accuracy):
                hit_count += 1
                damage = ad / 1.5 + level * (r4 + 1 if ultimate else 1)
                if q_active:
                    damage += (7 + 9 * r1 + .25 * ad) / 1.5
                if geared and hit_count % 3 == 0:
                    damage += .3 * ad / 1.5
                primary += damage
                total += damage
                if r2:
                    ready[1] = max(t, ready[1] - (.05 + .05 * r2))
                if geared:
                    spear_stacks = min(3, spear_stacks + 1)
                    spear_end = t + 3
        w_time += dt * w_active
        r_time += dt * ultimate
        e_time += dt * e_active
        if not unlimited:
            mana = min(panel['mana'], mana + panel['mana_regen'] * dt)
        elapsed = (tick + 1) * dt
        if any(abs(elapsed - boundary) < 1e-8 for boundary in (10, seconds)):
            snapshots[int(round(elapsed))] = dict(
                primary_dps=primary / elapsed, total_dps=total / elapsed,
                casts=casts.copy(), mana=mana, spent=spent, attacks=attacks,
                hits=hit_count, w_coverage=w_time / elapsed,
                r_coverage=r_time / elapsed, e_coverage=e_time / elapsed,
            )
        assert mana >= -1e-7
    return snapshots


def isolated():
    """连续速率近似，100%命中，双抗50；与离散随机模拟分开。"""
    ad, base_as = PANEL['ad'], PANEL['passive_as']
    q = [(16 + 9 * k + .25 * ad) / 1.5 for k in range(4)]
    w = [.91 * (1 + PANEL['growth_as'] + .25 + .15 * k) * 1.1 for k in range(4)]
    hit = ad / 1.5 + 15
    # 单独使用2，持续攻击，命中减冷却按连续速率推导：C = 5 + (CD - 5 - c*w*5)/(1+c*base_as)。
    cycles = [5 + max(0, (15-k) - 5 - (.1+.05*k)*speed*5) / (1 + (.1+.05*k)*base_as)
              for k, speed in enumerate(w)]
    return dict(q_per_hit=q, q_five_hits=[5*x for x in q],
                q_sustained_dps=[5*x/(10-k) for k,x in enumerate(q)],
                w_active_as=w, w_extra_hits_5s=[5*(x-base_as) for x in w],
                w_cycle=cycles, w_coverage=[5/x for x in cycles],
                w_sustained_total_dps=[(base_as+(speed-base_as)*5/cycle)*hit
                                       for speed,cycle in zip(w,cycles)],
                e_per_target=[balance.volley(k,ad)/1.5 for k in range(1,5)],
                e_three_target_dps=[balance.volley(k,ad)*2/(15-k) for k in range(1,5)],
                r_true_hit=[30,45,60], r_coverage=[10/55,10/48,10/41],
                r_extra_dps_with_full_2=(w[-1]*30))


def verify():
    balance.verify()
    # 无主动时总伤仅来自主目标；确定种子手工计数，验证计数不是附伤递归。
    bare = simulate((0,0,0,0), 7)[40]
    expected = bare['hits'] * (PANEL['ad']/1.5+15) / 40
    assert math.isclose(bare['total_dps'], expected)
    assert bare['total_dps'] == bare['primary_dps']
    assert bare['casts'] == [0,0,0,0]
    for ranks in CASES.values():
        result = simulate(ranks, 7)[40]
        assert result['casts'][3] == 1  # 41秒的满级大招也不能在40秒内第二次释放。
        assert math.isclose(result['r_coverage'], .25)
        assert result['spent'] <= PANEL['mana'] + 40*PANEL['mana_regen'] + 1e-7
    only_e = simulate((0,0,4,0), 7)[40]
    assert only_e['hits'] <= only_e['attacks']
    assert only_e['total_dps'] > only_e['primary_dps']
    assert isolated()['w_cycle'][3] < isolated()['w_cycle'][0]


def run(trials):
    verify()
    report = dict(trials=trials, dt=DT, isolated=isolated(), experiments={})
    for geared in (False, True):
        for unlimited in (False, True):
            key = ('three_items' if geared else 'naked') + ('_unlimited' if unlimited else '_mana')
            raw = {case: [simulate(ranks, seed, geared, unlimited) for seed in range(trials)]
                   for case, ranks in CASES.items()}
            summary = {}
            for case, runs in raw.items():
                summary[case] = {}
                for seconds in (10,40):
                    values = {}
                    for metric in runs[0][seconds]:
                        if metric == 'casts':
                            values[metric] = [mean(r[seconds][metric][i] for r in runs) for i in range(4)]
                        else:
                            values[metric] = mean(r[seconds][metric] for r in runs)
                    for metric in ('primary_dps','total_dps'):
                        paired = [r[seconds][metric]-b[seconds][metric]
                                  for r,b in zip(runs,raw['all_1'])]
                        values[metric+'_gain'] = mean(paired)
                        values[metric+'_gain_se'] = stdev(paired)/math.sqrt(trials)
                    summary[case][seconds] = values
            report['experiments'][key] = summary
    # 公平比较两条6级合法点法，各花6点；用于检验15级边际收益能否直接变成早期建议。
    early = {}
    for label,ranks in {'max_1': (4,1,0,1), 'max_2': (1,4,0,1)}.items():
        runs = [simulate(ranks, seed, level=6) for seed in range(trials)]
        early[label] = {seconds: mean(r[seconds]['primary_dps'] for r in runs)
                        for seconds in (10,40)}
    report['early_level6_naked'] = early
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--trials', type=int, default=256)
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    if args.trials < 2:
        parser.error('--trials must be >= 2')
    report = run(args.trials)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print('独立设计模型；并非游戏实测。', json.dumps(report['isolated'], ensure_ascii=False))
        for key, cases in report['experiments'].items():
            print(key)
            for case, windows in cases.items():
                short, long = windows[10], windows[40]
                print(f'{case}: 10s单体={short["primary_dps"]:.2f}; '
                      f'40s单体/三目标={long["primary_dps"]:.2f}/{long["total_dps"]:.2f}; '
                      f'增益={long["primary_dps_gain"]:.2f}/{long["total_dps_gain"]:.2f}; '
                      f'蓝={long["mana"]:.2f}; casts={long["casts"]}')
        print('6级裸装同为6点:', report['early_level6_naked'])
