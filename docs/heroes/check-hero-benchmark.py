"""核验 HB-1.0 参数、伤害关系与等压时序；不是战斗模拟器或游戏测试。"""

import json
from fractions import Fraction
from math import isclose
from pathlib import Path


DATA = json.loads(Path(__file__).with_name('hero-benchmark-v1.json').read_text())


def reference(level):
    h, p = DATA['target_scaling'], DATA['pressure_scaling']
    return (h['hp_intercept'] + h['hp_per_level'] * level,
            h['resist_intercept'] + h['resist_per_level'] * level,
            p['raw_dps_intercept'] + p['raw_dps_per_level'] * level)


def mitigated(amount, damage_type, armor=50, mr=50, reduction=.2, shield=1000):
    if damage_type == 'true':
        after = amount
    else:
        resist = armor if damage_type == 'physical' else mr
        after = amount * 100 / (100 + resist) * (1 - reduction)
    absorbed = 0 if damage_type == 'shield_piercing_magic' else min(shield, after)
    return after - absorbed, absorbed


def planned_damage(profile, sources, window=40, fixed_total=True, synchronized=False):
    """按计划到达时刻计算原始压力；不含命中/控制/伤害减免。"""
    interval = Fraction(str(profile['period_seconds']))
    pressure = Fraction(reference(15)[2])
    packet = pressure * interval / (sources if fixed_total else 1)
    total = Fraction(0)
    for i in range(sources):
        t = interval / 2 if synchronized else interval * Fraction(2*i+1, 2*sources)
        while t < window:
            total += packet
            t += interval
    return total


def verify():
    assert reference(15) == (3000, 50, 200)
    assert DATA['level_samples'] == sorted(set(DATA['level_samples']))
    assert all(x in DATA['level_samples'] for x in (1,2,5,6,10,15,16,30))
    assert set(DATA['layouts']) == {'1','3','5'}
    for count, slots in DATA['layouts'].items():
        assert len(slots) == len(set(slots)) == int(count)
        assert 3 in slots and all(1 <= n <= 5 for n in slots)
    targets = {t['id']: t for t in DATA['targets']}
    assert len(targets) == len(DATA['targets']) == 10
    assert len({p['id'] for p in DATA['attackers']}) == 8
    for t in targets.values():
        assert t['hp_factor'] > 0 and t['armor_factor'] >= 0 and t['mr_factor'] >= 0
        assert 0 <= t['reduction'] < 1 and t['evasion'] >= 0
    for count, ids in DATA['mixed_targets'].items():
        assert len(ids) == int(count) and all(i in targets for i in ids)
    for p in DATA['attackers']:
        assert isclose(sum(c['share'] for c in p['components']), 1)
        assert all(c['type'] in ('physical','magic','true','shield_piercing_magic') for c in p['components'])
        for n in (1,3,5):
            for sync in (False,True):
                assert planned_damage(p,n,synchronized=sync) == 8000
                assert planned_damage(p,n,fixed_total=False,synchronized=sync) == 8000*n
    assert mitigated(300,'true') == (0,300)  # 真实不减免，但吃盾。
    life, shield = mitigated(300,'shield_piercing_magic')
    assert isclose(life,160) and shield == 0  # 破魔吃魔抗/减伤、绕盾。
    life, shield = mitigated(300,'physical')
    assert life == 0 and isclose(shield,160)
    assert 'not_supported' in DATA['report_required'] and 'right_censored' in DATA['report_required']
    assert len(DATA['report_required']) == len(set(DATA['report_required']))
    assert DATA['gear_slots'] == 4 and DATA['max_orange_items'] == 1
    assert DATA['windows_seconds'] == [5,10,40,180]
    for p in DATA['attackers']:
        assert p['period_seconds'] > DATA['attacker_defaults']['hit_delay_seconds']
    print('HB-1.0 配置检查通过；10类受击木桩、8类压力源、1/3/5布局。')
    print('96组等压/饱和时序通过；40秒基础原始压力8000，饱和按来源数增长。')
    print('真实吃盾、破魔吃魔抗/减伤且绕盾的参考关系通过。非游戏实测。')
    for level in (1,6,15,30):
        hp, resist, dps = reference(level)
        print(f'L{level}: 参考HP={hp}, 双抗={resist}, 原始压力DPS={dps}')


if __name__ == '__main__':
    verify()
