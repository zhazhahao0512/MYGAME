#!/usr/bin/env python3
"""R060 red-item accounting, conditional marginal value and short-window diagnostics.

Run from any directory; --json prints inputs/results. No Battle simulation, no
runtime writes, no random seeds or measured coverage are claimed. Existing white,
blue and accepted purple data remain unchanged. Reserved price never enters the
valuation functions. Every item is valued with its own base stats held fixed.
"""
import argparse
from collections import Counter
from fractions import Fraction as F
import importlib.util
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('purple_r053', HERE / 'purple-survival-support-balance.py')
purple = importlib.util.module_from_spec(spec)
spec.loader.exec_module(purple)
CATALOG = {key:item for key,item in purple.CATALOG.items() if item['rarity'] in ('white','blue','purple')}
CATALOG.update({i['id']: {**i, 'rarity':'purple'} for i in purple.ITEMS})
PRICES = purple.PRICES
ITEMS = json.loads((HERE / 'red-equipment-r060.json').read_text())['items']
EFFECT_NAMES = {key:quoted or single for key,quoted,single in re.findall(
    r"""^\s*(\w+): \{[^\n]*?(?:"name":\s*"([^"]+)"|name:'([^']+)')""", purple.SOURCE, re.M)}
EFFECT_NAMES.update({i['effectId']:i['passive'] for i in purple.ITEMS if i.get('effectId')})


def base_gold(item):
    return sum(PRICES[k]*F(str(v)) for k,v in item['stats'].items())


def check_catalog():
    assert len(CATALOG)==59 and len(ITEMS)==19
    assert Counter(i['group'] for i in ITEMS)=={'物理':7,'法系':5,'防御':4,'辅助':3}
    assert len({i['id'] for i in ITEMS})==len({i['name'] for i in ITEMS})==19
    effects=[i['effectId'] for i in ITEMS if i.get('effectId')]
    assert len(effects)==len(set(effects))==18
    roots, recipes, rows = [], [], []
    for item in ITEMS:
        live = purple.CATALOG.get(item['id'])
        if live:
            for key in ('name','stats','price','recipes','effectId','effectRank','parameters'):
                assert live.get(key)==item.get(key), (item['id'],key)
        assert item['id'] not in CATALOG
        assert item['name'] not in {i['name'] for i in CATALOG.values()}
        assert 2600<=item['price']<=3600
        assert base_gold(item)+item['effectBudget']==item['price'], item['name']
        if item['effectBudget']:
            assert 400<=item['effectBudget']<=750
            assert F('.1')<=F(item['effectBudget'],item['price'])<=F('.25')
            assert item['effectRank']==2
            assert EFFECT_NAMES[item['effectId']]==item['passive']
        for route in item['recipes']:
            materials = [CATALOG[x] for x in route['materials']]
            tiers = sorted(m['rarity'] for m in materials)
            assert tiers in [['blue','purple'],['purple','white','white']]
            assert sum(m['price'] for m in materials)+route['fee']==item['price']
            sums = {}
            for m in materials:
                for stat,value in m['stats'].items():
                    sums[stat] = sums.get(stat,F(0))+F(str(value))
            assert all(F(str(item['stats'].get(k,0)))>=v for k,v in sums.items()), item['name']
            old = next(m for m in materials if m['rarity']=='purple')
            roots.append(old['id'])
            old_effect = old.get('effectId')
            if old_effect and old_effect!=item.get('effectId'):
                assert route.get('replacesPassive')==EFFECT_NAMES[old_effect]
            else:
                assert 'replacesPassive' not in route
            base_delta = base_gold(item)-sum(base_gold(m) for m in materials)
            effect_delta = item['effectBudget']-sum(m['price']-base_gold(m) for m in materials)
            assert base_delta>=0 and base_delta+effect_delta==route['fee']
            recipes.append({'red':item['name'],'purple':old['name'],'fee':route['fee'],
                            'base_increment':base_delta,'effect_budget_increment':effect_delta,
                            'converted_from':route.get('replacesPassive')})
        rows.append({'name':item['name'],'price':item['price'],'base_gold':base_gold(item),
                     'effect_budget':item['effectBudget']})
    assert len(recipes)==26 and len(set(roots))==26
    assert set(roots)=={i['id'] for i in CATALOG.values() if i['rarity']=='purple'}
    assert len([r for r in recipes if r['converted_from']])==3
    return rows,recipes


def hp_equivalent(hp, prevented_fraction):
    assert 0<=prevented_fraction<1
    return hp*(1/(1-prevented_fraction)-1)*PRICES['hp']


def spell_schedule(window, haste, max_mana=300, regen=5, cost=50):
    """One instant active; rational CD/mana events. Not a real hero rotation."""
    time, last, mana = F(0),F(0),F(max_mana)
    cd=F(6)/(1+F(haste,100))
    casts=[]
    while time<window:
        mana=min(F(max_mana),mana+(time-last)*regen)
        last=time
        if mana<cost:
            time+=(cost-mana)/regen
            continue
        casts.append(time)
        mana-=cost
        time+=cd
    return casts


def echo_value(item, window=40, extra_power=80, targets=1):
    p=item['parameters']; ap=item['stats']['power']+extra_power
    casts=spell_schedule(window,item['stats']['haste'])
    ready=F(0); procs=0
    for t in casts:
        if t>=ready:
            procs+=1; ready=t+p['cooldown']
    bonus=procs*(p['baseDamage']+F(str(p['powerRatio']))*ap)
    # The base spell deals 150 + 1 AP to every target; echo hits only one.
    gold=bonus/(len(casts)*targets)*PRICES['power'] if casts else F(0)
    # A shared hit probability and common magic mitigation cancel in AP eq.
    expected_damage=(len(casts)*(150+ap)*targets+bonus)*F('.8')*F(2,3)
    return {'casts':len(casts),'procs':procs,'gold':gold,
            'expected_damage':expected_damage,'targets':targets,
            'seconds':window,'extra_power':extra_power}


def crit_coverage(rate, crit, duration):
    """Steady uptime for regular successful attacks with independent crits.

    Use current total successful-attack rate as an external input. Does not
    solve self-acceleration feedback, initial cold start or targeting downtime.
    """
    span=rate*duration; whole=int(span); part=span-whole
    return 1-(1-crit)**whole*(1-part*crit)


def values(item):
    name=item.get('passive'); p=item.get('parameters',{})
    if not name: return '纯属性', [F(0)]*3
    if name=='穷追':
        return '等效满层覆盖40%/70%/90%，含叠层与转火损失', [
            F(str(p['perStack']))*p['maxStacks']*c*PRICES['attackSpeed'] for c in map(F,['.4','.7','.9'])]
    if name in ('三重打击','狠厉'):
        cases=[(160,F('.2'),F('1.2'),F('.6')),(220,F('.3'),F('1.8'),F('1.2')),(320,F('.5'),F('2.5'),F(2))]
        result=[]
        for attack,crit,rate,skill_slope in cases:
            derivative=rate*(1+F('.5')*crit)+skill_slope
            bonus=(attack*F(str(p['attackRatio']))*rate/p['every'] if name=='三重打击'
                   else attack*F(str(p['critMultiplierBonus']))*crit*rate)
            result.append(bonus/derivative*PRICES['attack'])
        return 'AD/暴击/合格普攻每秒/物理AD技能每秒系数：(160,.2,1.2,.6)/(220,.3,1.8,1.2)/(320,.5,2.5,2)',result
    if name=='乘风':
        return '稳态成功普攻每秒/总暴击：(1.2,.2)/(1.8,.3)/(2.5,.5)，无开场/转火损失', [
            F(str(p['attackSpeed']))*PRICES['attackSpeed']*crit_coverage(r,c,p['duration'])
            for r,c in [(F('1.2'),F('.2')),(F('1.8'),F('.3')),(F('2.5'),F('.5'))]]
    if name=='血性':
        return '低血吸血有效兑现联合覆盖30%/55%/80%', [
            F(str(p['lifeSteal']))*PRICES['lifeSteal']*c for c in map(F,['.3','.55','.8'])]
    if name=='背水':
        return '按AD输出收益加权的低血覆盖35%/55%/80%', [
            p['attack']*PRICES['attack']*c for c in map(F,['.35','.55','.8'])]
    if name=='战意护盾':
        cases=[(1800,F('1.2'),F('.4'),250),(3000,F(2),F('.8'),250),(4000,F('2.5'),F('.9'),200)]
        return 'HP/合格命中每秒/盾有效率/减免后DPS：(1800,1.2,.4,250)/(3000,2,.8,250)/(4000,2.5,.9,200)；平均流近似', [
            hp_equivalent(hp,F(p['shield'])*rate/p['every']*eff/dps) for hp,rate,eff,dps in cases]
    if name=='余韵':
        return '40秒有限蓝单技能，装备外AP0/80/200，单目标', [echo_value(item,40,ap)['gold'] for ap in [0,80,200]]
    if name=='导流':
        return '40秒合格参与击杀2/6/12个，有效法力50%/75%/90%', [
            n*p['mana']*eff/40*PRICES['manaRegen'] for n,eff in [(2,F('.5')),(6,F('.75')),(12,F('.9'))]]
    if name in ('滋养','援手','济能'):
        return '40秒；相关施法14/6/4秒间隔；兑现50%/80%(济能75%)/90%', [
            purple.resource_gold(item,40,c,e)['gold'] for c,e in
            [(14,F('.5')),(6,F('.75') if name=='济能' else F('.8')),(4,F('.9'))]]
    if name=='应战':
        return '按AP收益加权的触发覆盖40%/65%/90%，无回溯快照', [p['power']*c*PRICES['power'] for c in map(F,['.4','.65','.9'])]
    if name in ('回春','均势'):
        shares=['.3','.5','.7'] if name=='回春' else ['.4','.7','1']
        return '条件与有效缺血的联合覆盖'+ '/'.join(shares), [p['hpRegen']*F(c)*PRICES['hpRegen'] for c in shares]
    if name=='坚忍':
        cases=[(2500,F(1),300),(3500,F('1.5'),250),(5000,F(2),250)]
        return 'HP/合格普攻每秒/减免后DPS：(2500,1,300)/(3500,1.5,250)/(5000,2,250)，每击至少12', [
            hp_equivalent(hp,F(p['block'])*rate/dps) for hp,rate,dps in cases]
    if name=='魔障':
        return 'HP2500/3500/5000，各魔伤段超出8%HP的部分占总承伤15%/25%/40%，非命中次数', [
            hp_equivalent(h,F(str(p['reduction']))*share) for h,share in [(2500,F('.15')),(3500,F('.25')),(5000,F('.4'))]]
    if name=='应援':
        return '40秒触发1/2/3次、吸收50%/75%/90%，按有效吸收/秒折回复价', [
            p['shield']*n*eff/40*PRICES['hpRegen'] for n,eff in [(1,F('.5')),(2,F('.75')),(3,F('.9'))]]
    raise ValueError(name)


def diagnostics():
    echo=next(i for i in ITEMS if i.get('passive')=='余韵')
    resources=[]
    for item in ITEMS:
        if item.get('passive') in ('滋养','援手','济能'):
            for window in [5,10,40,180]:
                for cadence in [4,6,14]:
                    resources.append({'name':item['name'],'seconds':window,'cast_interval':cadence,
                        **purple.resource_gold(item,window,cadence,F('.75') if item['passive']=='济能' else F('.8'))})
    return {'resource_windows':resources,
            'echo_windows':[echo_value(echo,w,ap,n) for w in [5,10,40,180] for ap in [0,80,200] for n in [1,3,5]]}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument('--json',action='store_true'); args=parser.parse_args()
    rows,routes=check_catalog()
    for row,item in zip(rows,ITEMS):
        meaning,amounts=values(item)
        row.update(scenario=meaning,three_reference_gold=amounts)
    if args.json:
        print(json.dumps({'scope':'独立条件估值；非真实Battle、最终平衡或游戏实现','items':rows,'recipes':routes,**diagnostics()},
                         ensure_ascii=False,indent=2,default=lambda x:round(float(x),2)))
    else:
        print('19件红装、26配方；覆盖26紫装，3条被动转换，材料属性不缩水、价格/预算核验通过。')
        for r in rows:
            v='/'.join(f'{float(x):.2f}' for x in r['three_reference_gold'])
            print(f"{r['name']}: 属性{float(r['base_gold']):g}+效果预留{r['effect_budget']}={r['price']}; 条件等价 {v}")
