"""岚牙 V0.2 设计算式；非游戏模拟、非实战测试。运行：python3 docs/heroes/lanya-balance.py"""

from math import isclose


BASE = dict(hp=873.0, hp_regen=1.72, mana=196.8, mana_regen=3.26,
            ad=76.4, armor=28.7, mr=24.3)
GROWTH = dict(hp=63.4, hp_regen=0.13, mana=9.6, mana_regen=0.12,
              ad=3.18, armor=2.35, mr=1.45)
PRICE = dict(hp=2, hp_regen=250 / 3, mana=3, mana_regen=250,
             ad=37.5, armor=35, mr=35)
ORDER = (1, 2, 1, 1, 4, 1, 3, 2, 2, 4, 2, 3, 3, 3, 4)


def can_rank_up(level, learned, skill):
    """设计检查：当前等级、已学四技能等级、欲升级技能编号；每点单独检查。"""
    if level < 1 or skill not in (1, 2, 3, 4):
        return False
    if sum(learned) >= min(level, 15):
        return False
    rank = learned[skill - 1]
    if skill == 4:
        return rank < 3 and level >= (5, 10, 15)[rank]
    if rank >= 4 or (level < 6 and rank >= 3):
        return False
    # 二级前不得重复点同技能；存点不会使二级同技能二级合法。
    return level > 2 or rank == 0


def volley(rank, ad, ap=0, old=False):
    """单箭减免前伤害；新版本 AP 不影响技能3，old 仅供历史比较。"""
    assert 1 <= rank <= 4
    if old:
        return 36 + 18 * (rank - 1) + .55 * ad + .45 * ap
    return 50 + 30 * (rank - 1) + .90 * ad


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
    learned = [0, 0, 0, 0]
    for level, skill in enumerate(ORDER, 1):
        assert can_rank_up(level, learned, skill)
        learned[skill - 1] += 1
    for skill in (1, 2, 3):
        one = [0, 0, 0, 0]
        one[skill - 1] = 1
        assert not can_rank_up(2, one, skill)
        assert can_rank_up(2, one, skill % 3 + 1)
        assert can_rank_up(3, one, skill)
        three = [0, 0, 0, 0]
        three[skill - 1] = 3
        assert not can_rank_up(5, three, skill)
        assert can_rank_up(6, three, skill)
        three[skill - 1] = 4
        assert not can_rank_up(20, three, skill)
    for rank, gate in enumerate((5, 10, 15)):
        assert not can_rank_up(gate - 1, [0, 0, 0, rank], 4)
        assert can_rank_up(gate, [0, 0, 0, rank], 4)
    assert not can_rank_up(20, [4, 4, 4, 3], 4)
    assert not can_rank_up(3, [1, 1, 1, 0], 1)  # 无点不能升级。
    assert isclose(volley(4, 120.92), 248.828)
    assert volley(4, 120.92, ap=300) == volley(4, 120.92)
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
    old_arrow = volley(4, s['ad'], old=True)
    new_arrow = volley(4, s['ad'])
    print(f'L15 满级3/零AP 单箭：旧={old_arrow:.3f}，新={new_arrow:.3f}，'
          f'增幅={(new_arrow / old_arrow - 1) * 100:.2f}%')
    print(f'3个不同目标全部命中：减免前总伤={new_arrow * 3:.3f}；'
          f'护甲50时每目标={new_arrow / 1.5:.3f}，总伤={new_arrow * 2:.3f}')
