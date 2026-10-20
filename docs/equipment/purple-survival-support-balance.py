#!/usr/bin/env python3
"""R053 design accounting and conditional equivalents, NOT a Battle simulation.

Reads the formal materials without modifying runtime or historical reports.
Run from any directory. --json prints declared scenarios and window diagnostics.
The reserved budget is compared AFTER valuing effects, never used as an input.
"""
import argparse
from collections import Counter
from fractions import Fraction as F
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SOURCE = (ROOT / 'src/equipment.js').read_text()
# The runtime array is JSON except for its final trailing comma.
array = SOURCE.split('export const EQUIPMENT = [', 1)[1].split('\n];', 1)[0]
MATERIALS = json.loads('[' + array.rstrip().removesuffix(',') + ']')
CATALOG = {x['id']: x for x in MATERIALS}
ITEMS = json.loads((HERE / 'purple-survival-support-r053.json').read_text())['items']
PRICES = {}
for item in MATERIALS:
    if item['rarity'] == 'white':
        stat, value = next(iter(item['stats'].items()))
        PRICES[stat] = F(item['price']) / F(str(value))


def proc_times(window, cadence, cooldown, first=0):
    """Successful relevant casts are EXOGENOUS inputs, not unlimited-mana claims."""
    ready = F(0)
    time = F(first)
    result = []
    while time < window:
        if time >= ready:
            result.append(time)
            ready = time + cooldown
        time += cadence
    return result


def resource_gold(item, window=40, cadence=6, efficiency=F('0.8')):
    p = item['parameters']
    own = item['passive'] == '滋养'
    times = proc_times(window, cadence, p['cooldown'], first=0 if own else 2)
    # Self mend spends its opening trigger at full HP; it does not bank a charge.
    useful = len(times) - int(own and bool(times))
    amount = p.get('heal', p.get('mana')) * useful * efficiency
    stat = 'manaRegen' if 'mana' in p else 'hpRegen'
    return {'triggers': len(times), 'effective_resource': amount,
            'gold': amount / window * PRICES[stat]}


def passive_values(item):
    """Three declared examples, NOT min/max over all builds or a confidence band."""
    name, p = item.get('passive'), item.get('parameters', {})
    if not name:
        return '纯属性，无被动', [F(0)] * 3
    if name in ('滋养', '援手', '济能'):
        eff = F('0.75') if name == '济能' else F('0.8')
        scenarios = [(40, 14, F('0.5')), (40, 6, eff), (40, 4, F('0.9'))]
        return '40秒；施法间隔14/6/4秒，有效兑现率50%/80%(济能75%)/90%', [
            resource_gold(item, w, c, e)['gold'] for w, c, e in scenarios]
    if name == '应战':
        return 'AP收益加权覆盖率40%/65%/90%，不是受击时间比例', [
            p['power'] * x * PRICES['power'] for x in map(F, ['0.4','0.65','0.9'])]
    if name == '隔魔':
        return '装备后生命1500/2000/2500；魔法占比50%/75%/85%；静态无回复', [
            h * (1/(1-F(str(p['reduction']))*share)-1) * PRICES['hp']
            for h, share in [(1500,F('.5')),(2000,F('.75')),(2500,F('.85'))]]
    if name in ('回春', '均势'):
        shares = ['.3','.5','.7'] if name == '回春' else ['.4','.7','1']
        return '低血/混伤触发与缺血兑现的联合覆盖率'+ '/'.join(shares), [
            p['hpRegen'] * F(s) * PRICES['hpRegen'] for s in shares]
    if name == '坚忍':
        # All inputs after other reductions. Every eligible hit is >= block.
        cases = [(1500,F('.75'),250),(2000,F('1.5'),200),(2500,F(2),200)]
        return '生命/合格物理普攻每秒命中/总承压：(1500,.75,250)/(2000,1.5,200)/(2500,2,200)', [
            h*(1/(1-F(p['block'])*hits/dps)-1)*PRICES['hp'] for h,hits,dps in cases]
    if name == '魔障':
        # Only the excess portion of EACH hit is eligible, not the whole hit.
        return '生命1500/2000/2500；各魔法段超出8%生命的部分占全部承伤20%/35%/50%；静态无回复', [
            h*(1/(1-F(str(p['reduction']))*share)-1)*PRICES['hp']
            for h,share in [(1500,F('.2')),(2000,F('.35')),(2500,F('.5'))]]
    if name == '应援':
        return '40秒有效触发1/2/3次、吸收率50%/75%/90%；以有效吸收/秒折回复，非最大生命', [
            p['shield'] * n * eff / 40 * PRICES['hpRegen']
            for n,eff in [(1,F('.5')),(2,F('.75')),(3,F('.9'))]]
    raise ValueError(name)


def check_catalog():
    assert Counter(i['group'] for i in ITEMS) == {'法系生存':3, '防御':6, '辅助':3}
    assert len({i['id'] for i in ITEMS}) == 12
    assert len({i['name'] for i in ITEMS}) == 12
    ids = [i['effectId'] for i in ITEMS if 'effectId' in i]
    names = [i['passive'] for i in ITEMS if 'passive' in i]
    assert len(ids) == len(set(ids)) == len(set(names)) == 10
    rows = []
    for item in ITEMS:
        # R064 implements these designs. Check the live definition when present,
        # while retaining the same historical scenario inputs and valuations.
        live = CATALOG.get(item['id'])
        if live:
            for key in ('name', 'stats', 'price', 'recipe', 'combineFee', 'effectId', 'parameters'):
                assert live.get(key) == item.get(key), (item['id'], key)
        assert not any(m['name'] == item['name'] and m['id'] != item['id'] for m in MATERIALS)
        materials = [CATALOG[x] for x in item['recipe']]
        tiers = sorted(m['rarity'] for m in materials)
        assert tiers in [['blue','white'],['blue','blue'],['blue','white','white']]
        material_cost = sum(m['price'] for m in materials)
        assert material_cost + item['combineFee'] == item['price']
        material_stats = Counter()
        for m in materials:
            material_stats.update(m['stats'])
        assert all(F(str(item['stats'].get(k,0))) >= F(str(v)) for k,v in material_stats.items()), item['name']
        base = sum(PRICES[k] * F(str(v)) for k,v in item['stats'].items())
        assert base + item['effectBudget'] == item['price'], item['name']
        assert 1400 <= item['price'] <= 2200
        if item['effectBudget']:
            assert 150 <= item['effectBudget'] <= 450
            assert F('.1') <= F(item['effectBudget'],item['price']) <= F('.25')
        meaning, values = passive_values(item)
        rows.append({'name':item['name'],'base_gold':base,'materials':material_cost,
                     'fee':item['combineFee'],'reserved':item['effectBudget'],
                     'scenario':meaning,'three_reference_gold':values})
    return rows


def diagnostics():
    out = []
    for item in ITEMS:
        if item.get('passive') not in ('滋养','援手','济能'):
            continue
        for w in [5,10,40,180]:
            for cadence in [4,6,14]:
                out.append({'name':item['name'],'seconds':w,'cast_interval':cadence,
                            **resource_gold(item,w,cadence,F('.75') if item['passive']=='济能' else F('.8'))})
    return out


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    rows = check_catalog()
    if args.json:
        print(json.dumps({'scope':'独立预算/条件算式；不是游戏或完整HB实测',
                          'items':rows,'cast_windows':diagnostics()}, ensure_ascii=False,
                         indent=2, default=lambda x: round(float(x),2)))
    else:
        print('12件方案：材料、基础属性保留、价格闭合、10个唯一命名及预算检查通过。')
        for r in rows:
            values = '/'.join(f'{float(x):.2f}' for x in r['three_reference_gold'])
            print(f"{r['name']}: 面板{float(r['base_gold']):g} + 被动预留{r['reserved']}; 三场景等价 {values}")
