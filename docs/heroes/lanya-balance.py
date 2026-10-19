"""岚牙 V0.1 设计算式；非游戏模拟、非实战测试。运行：python3 docs/heroes/lanya-balance.py"""

from math import isclose


BASE = dict(hp=873.0, hp_regen=1.72, mana=196.8, mana_regen=3.26,
            ad=76.4, armor=28.7, mr=24.3)
GROWTH = dict(hp=63.4, hp_regen=0.13, mana=9.6, mana_regen=0.12,
              ad=3.18, armor=2.35, mr=1.45)
PRICE = dict(hp=2, hp_regen=250 / 3, mana=3, mana_regen=250,
             ad=37.5, armor=35, mr=35)
ORDER = (1, 2, 3, 1, 4, 2, 1, 3, 1, 4, 2, 3, 2, 3, 4)


def ranks(level):
    return [ORDER[:min(level, 15)].count(i) for i in range(1, 5)]


def stats(level):
    steps = level - 1
    result = {k: BASE[k] + GROWTH[k] * steps for k in BASE}
    result['growth_as'] = steps * 0.026
    result['passive_as'] = 0.91 * (1 + result['growth_as']) * 1.1
    return result


def burst(level, gear_ad=0, gear_as=0, combo=False):
    """100% 命中、双抗 50、无盾无减伤的瞬时稳态 DPS；三重打击按每击 1/3 摊销。

    不计技能3、弹道/起手、有限攻击次数、目标死亡、空档、蓝耗或其它技能循环。
    gear_as 输入小数；大招期间使用已学的技能1/2等级，不凭空升满。
    """
    panel = stats(level)
    r1, r2, _, r4 = ranks(level)
    assert r4 > 0
    ad = panel['ad'] + gear_ad
    speed = 0.91 * (1 + panel['growth_as'] + gear_as +
                    (0.25 + (r2 - 1) * 0.15 if r2 else 0)) * 1.1
    magic = 16 + (r1 - 1) * 9 + 0.25 * ad if r1 else 0
    true = level * (r4 + 1)
    per_hit = (ad + magic + (ad * 0.3 / 3 if combo else 0)) / 1.5 + true
    return speed, per_hit, speed * per_hit


def verify():
    assert ranks(15) == [4, 4, 4, 3]
    for level, skill in enumerate(ORDER, 1):
        rank = ranks(level)[skill - 1]
        gates = (5, 10, 15) if skill == 4 else (1, 3, 6, 9)
        assert level >= gates[rank - 1]
    assert isclose(stats(15)['hp'], 1760.6)
    assert isclose(stats(15)['passive_as'], 1.365364)
    assert isclose(stats(16)["hp"] - stats(15)["hp"], GROWTH["hp"])
    assert stats(100)["passive_as"] > stats(16)["passive_as"]  # 固定成长不封顶。
    assert burst(16)[1] > burst(15)[1]
    assert isclose(0.91 * (1 + .364 + .70) * 1.10, burst(15)[0])


if __name__ == '__main__':
    verify()
    print('设计算式检查通过；不是游戏战斗测试。')
    base_value = sum(BASE[k] * PRICE[k] for k in BASE)
    growth_value = sum(GROWTH[k] * PRICE[k] for k in GROWTH) + 2.6 * 37.5
    print(f'已定价基础属性 {base_value:.2f} 金；每级固定成长 {growth_value:.2f} 金')
    print(f'15级累计已定价面板 {base_value + 14 * growth_value:.2f} 金')
    print('以上均不含基础频率、精准、被动、技能及协同价值。')
    for level in (1, 5, 10, 15):
        s = stats(level)
        print(f'L{level}: ranks={ranks(level)}, HP={s["hp"]:.2f}, '
              f'MP={s["mana"]:.2f}, AD={s["ad"]:.2f}, AS={s["passive_as"]:.6f}')
    for level in (5, 10, 15):
        speed, hit, dps = burst(level)
        print(f'L{level} 裸装大招: AS={speed:.6f}, 单击={hit:.3f}, DPS={dps:.3f}')
    for label, ad, speed, combo in (
        ('疾风双刃/1500金', 0, .4, False),
        ('疾风+连击+鏖战（穷追满层）/5150金，空余1槽', 30, 1.0, True),
    ):
        result = burst(15, ad, speed, combo)
        print(f'L15 {label}: AS={result[0]:.6f}, 单击均值={result[1]:.3f}, DPS={result[2]:.3f}')
    s = stats(15)
    print(f'L15 裸装无主动技能: {s["passive_as"] * (s["ad"] / 1.5 + 15):.3f} DPS')
    print(f'L15 首次4+3蓝耗=152；初始蓝={s["mana"]:.1f}；10秒理论回蓝={s["mana_regen"] * 10:.1f}')
