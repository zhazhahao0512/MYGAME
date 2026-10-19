"""岚牙 HB-1.0 设计模型。独立于游戏；20ms；候选时序/共用命中，非引擎验收。
运行 --check 或 --run --workers 4；结果/图表可复现，不修改英雄数值。
"""
import argparse
import hashlib
import heapq
import importlib.util
import json
import math
import os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from random import Random
from statistics import mean, stdev

ROOT = Path(__file__).parent
spec = importlib.util.spec_from_file_location('panel', ROOT / 'lanya-balance.py')
panel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(panel)
HB = json.loads((ROOT / 'hero-benchmark-v1.json').read_text())
TARGETS = {v['id']: v for v in HB['targets']}
ATTACKERS = {v['id']: v for v in HB['attackers']}
# 当前装备稿完整购买价，属性相加，同名被动只启用一次。
ITEMS = {
 'wind': ('疾风双刃',1500,{'as':.4}), 'bow':('连击长弓',1700,{'ad':10,'as':.24}),
 'spear':('鏖战长枪',1950,{'ad':20,'as':.24}), 'campaign':('征战长剑',850,{'ad':12,'hp':200}),
 'sword':('淬炼长剑',750,{'ad':20}), 'staff':('学徒法杖',800,{'ap':40}),
 'mana_staff':('储能法杖',700,{'ap':20,'mana':100}),
 'orb':('回魔宝珠',700,{'mana':150,'mana_regen':1}),
 'tome':('咏唱法典',800,{'ap':20,'haste':5}),
 'guard':('守望双刃',2000,{'as':.2,'hp':400}),
 'armor':('铁甲',350,{'armor':10}), 'cloak':('抗魔斗篷',350,{'mr':10}),
 'hp':('生命吊坠',300,{'hp':150}), 'regrowth':('复苏护符',750,{'hp':250,'hp_regen':3}),
 'blood':('血潮双刃',1950,{'ad':12,'as':.2,'lifesteal':.03}),
 'charm':('凝神符',250,{'mana_regen':1}),
}
BUILDS = {'bare':(0,[]),'as1500':(1500,['wind']), 'ad1500':(1500,['sword']*2),
 'as3000':(3000,['wind']*2),'ad3000':(3000,['sword']*4),
 'ap3000':(3000,['staff']*2+['mana_staff']*2),
 'mana3000':(3000,['wind','orb','tome']),
 'def3000':(3000,['guard','armor','cloak','hp']),
 'regen3000':(3000,['regrowth']*4),
 'as6000':(6000,['wind']*4),
 'onhit6000':(6000,['wind','bow','spear','campaign']),
 'sustain6000':(6000,['blood','guard','wind','charm'])}


def hero_stats(level, build, choices=False, probes=()):
    s = panel.stats(level)
    s.update({'as':0.,'ap':0.,'haste':0.,'lifesteal':0.})
    for item in BUILDS[build][1]:
        for key, value in ITEMS[item][2].items(): s[key] += value
    if choices: s['as'] += max(0,level-15)*.08
    if 'X1' in probes: s['as'] += .5
    if 'X2' in probes: s['haste'] += 30
    return s


def probability(accuracy=95, source=3, target=3, evasion=0):
    return max(0,min(1,(accuracy-evasion-2*(source+target-2))/100))


def reduce_damage(raw, kind, armor, mr, reduction=0):
    return raw if kind=='true' else raw*100/(100+(armor if kind=='physical' else mr))*(1-reduction)


def absorb(amount, kind, hp, shield, potential=False):
    used = 0 if kind=='shield_piercing_magic' else min(shield,amount)
    rest = amount-used
    lost = rest if potential else min(hp,rest)
    return lost,used,max(0,rest-lost)


def run_one(case, seed):
    level=case.get('level',15); ranks=case.get('ranks',panel.ranks(level)); r1,r2,r3,r4=ranks
    build=case.get('build','bare'); items=BUILDS[build][1]; probes=case.get('probes',[])
    s=hero_stats(level,build,case.get('choices',False),probes)
    mode=case.get('mode','O1'); n=case.get('n',1); slots=HB['layouts'][str(n)]
    dt=case.get('dt',.02); horizon=case.get('seconds',40); ticks=round(horizon/dt)
    qt=lambda sec: math.ceil(sec/dt-1e-9)
    cast_ticks=qt(case.get('cast',.2)); flight_ticks=qt(case.get('flight',.2))
    hero_slot=case.get('hero_slot',3)
    enemy_level=case.get('enemy_level',15)
    h=600+160*enemy_level; resist=20+2*enemy_level
    names=case.get('profiles',[case.get('profile','T1')]*n)
    enemies=[]
    for i,slot in enumerate(slots):
        p=TARGETS[names[i]]
        enemies.append(dict(id=i,slot=slot,maxhp=h*p['hp_factor'],hp=h*p['hp_factor'],
            armor=resist*p['armor_factor'],mr=resist*p['mr_factor'],reduction=p['reduction'],
            evade=p['evasion'],shield=0.,shield_at=0,profile=p,respawn=-1))
    arng=Random(seed); srng=[Random(seed+1000000+10000*slot) for slot in slots]
    erng=[Random(seed+2000000+10000*slot) for slot in slots]
    crng=Random(seed+3000000)
    hp=s['hp']; mana=s['mana']; hero_shield=0.; shield_end=0
    ready=[0]*4; cds=[11-r1,16-r2,15-r3,62-7*r4]; costs=[26+2*r1,32+3*r2,36+4*r3,70+10*r4]
    end=[0]*4; charges=0; next_attack=0; casting=None; queue=[]; serial=0
    locked=None; spear_target=None; stacks=0; stack_end=0; hit_count=0
    death=None; first_kill=None; clear=None; kills=0; stun_end=0
    dmg=shield_dmg=overkill=primary=healed=shield_absorbed=received=enemy_healed=0.
    incoming_raw=incoming_miss=incoming_mitigated=incoming_overkill=0.
    spent=regained=0.; attacks=hits=0; casts=[0]*4; blocked=[0]*4
    by_type={'physical':0.,'magic':0.,'true':0.,'shield_piercing_magic':0.}
    by_source={'basic':0.,'passive':0.,'skill1':0.,'skill3':0.,'bow':0.}
    by_target={str(x):0. for x in slots}
    coverage=[0]*4; snapshots={}; last_t=0
    pressure=ATTACKERS.get(case.get('attacker'))
    is_pressure=pressure is not None
    period=pressure['period_seconds'] if pressure else 1
    schedule=[period*(.5 if case.get('phase')=='sync' else (i+.5)/n) for i in range(n)]
    fixed_total=case.get('pressure_mode','total')=='total'
    raw_p=(80+8*enemy_level)*case.get('tier',1)
    packet=raw_p*period/(n if fixed_total else 1)
    finite=mode in ('O2','O3','D2'); potential=mode=='O1'
    healing_mult=.6 if case.get('overlay')=='C2' else 1.

    def snapshot(boundary):
        # Once a finite cohort is cleared, no new foes arrive; natural resources still recover.
        rest=max(0,boundary-last_t) if finite and mode!='O3' and clear is not None and death is None else 0
        hp_extra=min(s['hp']-hp,s['hp_regen']*healing_mult*rest)
        mp_extra=min(s['mana']-mana,s['mana_regen']*rest)
        return dict(hp_dps=dmg/boundary if not potential else None,
            potential_dps=(dmg+shield_dmg)/boundary if potential else None,
            total_dps=(dmg+shield_dmg)/boundary,primary_dps=primary/boundary,
            shield_dps=shield_dmg/boundary,overkill=overkill,hp=hp+hp_extra,shield=hero_shield if boundary<shield_end*dt else 0.,
            healing=healed+hp_extra,shield_absorbed=shield_absorbed,received=received,
            incoming_raw=incoming_raw,incoming_miss=incoming_miss,incoming_mitigated=incoming_mitigated,incoming_overkill=incoming_overkill,
            mana=mana+mp_extra,mana_spent=spent,mana_regained=regained+mp_extra,attacks=attacks,hits=hits,
            casts=casts.copy(),oom_checks=blocked.copy(),kills=kills,
            first_kill=first_kill,clear_time=clear,death_time=death,
            survival=float(death is None),rmst=death if death is not None else boundary,
            clear_rmst=clear if clear is not None else boundary,
            clear_rate=float(clear is not None),enemy_hp=sum(e['hp'] for e in enemies),enemy_healing=enemy_healed,
            coverage=[x*dt/boundary for x in coverage],damage_by_type=by_type.copy(),
            damage_by_source=by_source.copy(),damage_by_slot=by_target.copy())

    for tick in range(ticks):
        t=tick*dt
        # [0,T): save before processing T events. Dead/cleared trials are carried to remaining windows below.
        if tick and any(abs(t-w)<dt/3 for w in HB['windows_seconds']): snapshots[str(round(t))]=snapshot(t)
        elapsed=t-last_t; last_t=t
        if tick:
            if mode!='D0':
                gain=min(s['hp']-hp,s['hp_regen']*healing_mult*elapsed);hp+=gain;healed+=gain
            gain=min(s['mana']-mana,s['mana_regen']*elapsed);mana+=gain;regained+=gain
        if tick>=shield_end: hero_shield=0.
        if tick>=end[0]: charges=0
        if tick>=stack_end: stacks=0
        for e in enemies:
            if e['hp']<=0 and mode=='O3' and tick>=e['respawn']:
                e['id']+=n;e['hp']=e['maxhp'];e['shield']=0;e['shield_at']=tick
            if e['hp']<=0: continue
            p=e['profile']
            if p.get('shield_hp_factor') and tick>=e['shield_at']:
                e['shield']=p['shield_hp_factor']*h;e['shield_at']=tick+qt(10)
            if finite and p.get('regen_hp_fraction_per_second'):
                gain=min(e['maxhp']-e['hp'],p['regen_hp_fraction_per_second']*h*elapsed)
                e['hp']+=gain;enemy_healed+=gain
        # Arrivals bind target ID. On-hit effects share launch hit candidate; secondary damage cannot recurse.
        while queue and queue[0][0]<=tick:
            _,_,idx,uid,hit,parts,basic,ls=heapq.heappop(queue);e=enemies[idx]
            if e['id']!=uid or e['hp']<=0 or not hit:continue
            if basic:
                hits+=1;hit_count+=1
                if r2: ready[1]=max(tick,ready[1]-qt(.05+.05*r2))
                if 'spear' in items:
                    # Late projectile to an old target must not restore its stacks after a target switch.
                    if spear_target==uid: stacks=min(3,stacks+1);stack_end=tick+qt(3)
                if 'guard' in items and mode!='D0':
                    if hit_count%4==0:hero_shield=30.;shield_end=tick+qt(3)
                if 'bow' in items and hit_count%3==0:
                    parts=parts+[('physical',.3*s['ad']*(1.5 if 'X3' in probes else 1),'bow')]
            for kind,raw,source in parts:
                if e['hp']<=0:break
                amount=reduce_damage(raw,kind,e['armor'],e['mr'],e['reduction'])
                lost,used,extra=absorb(amount,kind,e['hp'],e['shield'],potential)
                e['shield']-=used
                if not potential:e['hp']-=lost
                dmg+=lost;shield_dmg+=used;overkill+=extra
                by_type[kind]+=lost+used;by_source[source]+=lost+used;by_target[str(e['slot'])]+=lost+used
                if e['slot']==3:primary+=lost+used
                if source=='basic' and not potential and mode!='D0':
                    gain=min(s['hp']-hp,lost*ls*healing_mult);hp+=gain;healed+=gain
            if mode=='D1': e['hp']=e['maxhp']  # root completion reset, not healing or kill
            elif finite and e['hp']<=0:
                kills+=1
                if first_kill is None:first_kill=t
                e['respawn']=tick+qt(HB['replacement_delay_seconds'])
                if all(x['hp']<=0 for x in enemies) and clear is None:clear=t
        # Incoming pulse sequences keep equal planned raw pressure, independently rolling mixed components.
        if pressure:
            for idx,e in enumerate(enemies):
                if t+1e-9<schedule[idx]:continue
                schedule[idx]+=period
                if e['hp']<=0:continue
                evade=(1+2*r3) if tick<end[2] and r3 else 0
                for part in pressure['components']:
                    raw=packet*part['share'];incoming_raw+=raw
                    if erng[idx].random()>=probability(source=e['slot'],target=hero_slot,evasion=evade):
                        incoming_miss+=raw;continue
                    amount=reduce_damage(raw,part['type'],s['armor'],s['mr'])
                    incoming_mitigated+=raw-amount
                    lost,used,extra=absorb(amount,part['type'],hp,hero_shield)
                    incoming_overkill+=extra
                    hp-=lost;hero_shield-=used;received+=lost;shield_absorbed+=used
                    if hp<=0:death=t;break
                if death is not None:break
        if death is not None:break  # no posthumous damage credited in fixed-window report
        if finite and mode!='O3' and all(e['hp']<=0 for e in enemies):break
        if case.get('overlay')=='C1' and tick>=qt(4) and (tick-qt(4))%qt(8)==0:
            if crng.random()<probability(evasion=(1+2*r3 if tick<end[2] and r3 else 0)):
                stun_end=tick+qt(1);casting=None  # spent cost/CD retained on interruption
        for i in range(4):
            coverage[i]+=int((tick<end[i] and (i!=0 or charges>0)) or (i in (0,1) and ranks[i] and tick<end[3]))
        if tick<stun_end or mode=='D0':continue
        live=[i for i,e in enumerate(enemies) if e['hp']>0]
        if not live:continue
        if locked not in live:
            locked=next((i for i in live if enemies[i]['slot']==3),min(live,key=lambda i:enemies[i]['slot']))
        target=enemies[locked]
        if spear_target!=target['id']:spear_target=target['id'];stacks=0
        if casting and tick>=casting[1]:
            k,_,chosen=casting;casting=None
            if k==3:end[3]=tick+qt(10);end[0]=end[1]=tick;charges=0
            elif k==1:end[1]=tick+qt(5)
            elif k==0:charges=5;end[0]=tick+qt(8)
            else:
                end[2]=tick+qt(4)
                for idx,uid in chosen:
                    e=enemies[idx]
                    if e['id']!=uid or e['hp']<=0:continue
                    hit=srng[idx].random()<probability(98+3*r3,hero_slot,e['slot'],e['evade'])
                    serial+=1;heapq.heappush(queue,(tick+flight_ticks,serial,idx,uid,hit,
                        [('physical',panel.volley(r3,s['ad']),'skill3')],False,0))
        if casting:continue
        # Start at most one cast per step; a zero-cast sensitivity releases on the following step (<=20ms).
        ult=tick<end[3]
        for k in (3,1,0,2):
            if not ranks[k] or tick<ready[k]:continue
            if (k in (0,1,3) and ult) or (k==0 and charges) or (k==1 and tick<end[1]):continue
            if mana+1e-9<costs[k]:blocked[k]+=1;continue
            if case.get('policy')=='reserve_r' and k!=3 and r4 and not ult:
                # Candidate strategy: do not spend the mana needed for the next ultimate deadline.
                affordable_at_r=mana-costs[k]+max(0,ready[3]-tick)*dt*s['mana_regen']
                if affordable_at_r+1e-9<costs[3]:continue
            mana-=costs[k];spent+=costs[k];casts[k]+=1
            ready[k]=tick+qt(cds[k]/(1+s['haste']/100))
            chosen=sorted(live,key=lambda i:(0 if i==locked else 1,abs(enemies[i]['slot']-target['slot']),enemies[i]['slot']))[:3]
            casting=(k,tick+cast_ticks,[(i,enemies[i]['id']) for i in chosen]);break
        if not casting and tick>=next_attack:
            ult=tick<end[3];w=r2 and (ult or tick<end[1]);eactive=tick<end[2]
            speed=.91*(1+s['growth_as']+s['as']+.04*stacks+(.10+.15*r2 if w else 0))*1.1
            next_attack=tick+qt(1/speed);attacks+=1
            hit=arng.random()<probability(95+(3+3*r3 if eactive else 0),hero_slot,target['slot'],target['evade'])
            factor=1.5 if 'X3' in probes else 1
            parts=[('physical',s['ad'],'basic'),('true',level*(r4+1 if ult else 1)*factor,'passive')]
            if r1 and (ult or charges):
                parts.append(('magic',(7+9*r1+.25*s['ad']+.3*s['ap'])*factor,'skill1'))
                if not ult:charges-=1
            ls=s['lifesteal']+(.03 if 'blood' in items and hp<s['hp']*.5 else 0)
            serial+=1;heapq.heappush(queue,(tick+flight_ticks,serial,locked,target['id'],hit,parts,True,ls))
    # Fixed windows carry damage after death/clear; natural regen after clear is handled in snapshot.
    for w in HB['windows_seconds']:
        if w<=horizon and str(w) not in snapshots:snapshots[str(w)]=snapshot(w)
    assert -1e-6<=hp<=s['hp']+1e-6 and -1e-6<=mana<=s['mana']+1e-6
    assert abs(s['hp']+healed-received-hp)<1e-5
    assert abs(s['mana']+regained-spent-mana)<1e-5
    assert abs(incoming_raw-incoming_miss-incoming_mitigated-incoming_overkill-received-shield_absorbed)<1e-5
    assert abs(sum(by_type.values())-dmg-shield_dmg)<1e-5
    assert abs(sum(by_source.values())-dmg-shield_dmg)<1e-5
    return snapshots


def summary(values):
    data=sorted(v for v in values if v is not None)
    if not data:return None
    def pct(q):
        i=(len(data)-1)*q;a=int(i);return data[a]+(data[min(a+1,len(data)-1)]-data[a])*(i-a)
    m=mean(data);sd=stdev(data) if len(data)>1 else 0
    return dict(mean=m,sd=sd,p10=pct(.1),p50=pct(.5),p90=pct(.9),ci95=[m-1.96*sd/math.sqrt(len(data)),m+1.96*sd/math.sqrt(len(data))],observed=len(data))


def aggregate(rows, name=None):
    if isinstance(rows[0],dict):return {k:aggregate([r[k] for r in rows],k) for k in rows[0]}
    if isinstance(rows[0],list):return [aggregate([r[k] for r in rows]) for k in range(len(rows[0]))]
    result=summary(rows)
    if name in ('survival','clear_rate'):
        result['ci95']=wilson(result['mean'],result['observed'])
    return result


def wilson(p,n):
    z=1.96;denom=1+z*z/n
    center=(p+z*z/(2*n))/denom
    half=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/denom
    return [max(0,center-half),min(1,center+half)]


def cases():
    result=[]
    def add(id,**kw): result.append(dict(id=id,**kw))
    for n in (1,3,5):
        for b in ('bare','as1500','as3000','onhit6000'):
            add(f'output_{b}_{n}',build=b,n=n,seconds=180)
        for p in TARGETS:
            if p!='T9' and p!='T1':add(f'target_{p}_{n}',profile=p,n=n)
            add(f'kill_{p}_{n}',profile=p,n=n,mode='O2',seconds=180)
        add(f'replace_{n}',n=n,mode='O3',seconds=180)
        for b in ('bare','as3000','def3000','onhit6000'):
            add(f'combat_{b}_{n}',n=n,build=b,mode='D2',attacker='A6')
        for cast in (0,.4):add(f'timing_{cast}_{n}',n=n,cast=cast,flight=cast)
    for b in BUILDS:
        add(f'build_{b}',build=b,seconds=180)
        add(f'build_defense_{b}',build=b,mode='D1',attacker='A6',seconds=180)
    for a in ATTACKERS:
        for mode in ('D0','D1'):
            for n,pm in ((1,'total'),(3,'total'),(5,'total'),(3,'each'),(5,'each')):
                add(f'defense_{a}_{mode}_{n}_{pm}',attacker=a,mode=mode,n=n,pressure_mode=pm)
    for n in (1,3,5):
        for tier in (.5,2):add(f'pressure_{tier}_{n}',attacker='A6',mode='D1',n=n,tier=tier,seconds=180)
        add(f'sync_{n}',attacker='A6',mode='D1',n=n,phase='sync')
    for a in ('A7','A8'):
        add(f'shield_{a}',attacker=a,mode='D1',build='def3000')
    for overlay in ('C1','C2'):add(f'overlay_{overlay}',mode='D1',attacker='A6',overlay=overlay)
    for level in HB['level_samples']:
        for scale in ('fixed','same'):
            enemy=15 if scale=='fixed' else level
            add(f'growth_{level}_{scale}',level=level,enemy_level=enemy)
            add(f'growth_defense_{level}_{scale}',level=level,enemy_level=enemy,attacker='A6',mode='D1')
        if level>15:
            add(f'choice_{level}',level=level,choices=True)
    ranks={'all1':[1,1,1,1],'max1':[4,1,1,1],'max2':[1,4,1,1],'max3':[1,1,4,1],'max4':[1,1,1,3]}
    for name,r in ranks.items():
        for n in (1,3,5):add(f'skills_{name}_{n}',ranks=r,n=n)
    for name,probes in (('none',[]),('as',['X1']),('haste',['X2']),('onhit',['X3']),('as_onhit',['X1','X3'])):
        for b in ('bare','onhit6000'):add(f'probe_{name}_{b}',probes=probes,build=b)
    for n in (3,5):
        mixed=HB['mixed_targets'][str(n)]
        for rotation in range(n):add(f'mixed_{n}_{rotation}',n=n,profiles=mixed[rotation:]+mixed[:rotation],mode='O2',seconds=180)
    for slot in (1,5):add(f'position_{slot}',hero_slot=slot)
    for b in ('bare','as3000','onhit6000'):
        for n in (1,3):add(f'reserve_{b}_{n}',build=b,n=n,policy='reserve_r',seconds=180)
    return result


def batch(job):
    case,seeds=job
    data=[run_one(case,s) for s in range(seeds)]
    # Per-seed primary endpoint retained for paired changes. Full distribution can be regenerated.
    vectors={w:{k:[v[w][k] for v in data] for k in ('total_dps','rmst','clear_rmst','survival','clear_rate')} for w in data[0]}
    return dict(case=case,summary=aggregate(data),paired_samples=vectors)


def verify():
    panel.verify()
    assert absorb(300,'true',1000,1000)==(0,300,0)
    assert absorb(160,'shield_piercing_magic',1000,1000)==(160,0,0)
    assert absorb(500,'physical',100,100)==(100,100,300)
    assert probability()==.87
    assert len({c['id'] for c in cases()})==len(cases())
    for budget,items in BUILDS.values():assert len(items)<=4 and sum(ITEMS[i][1] for i in items)<=budget
    c={'ranks':[0,0,0,0],'cast':0,'flight':0,'seconds':40}
    row=run_one(c,7)['40'];expected=row['hits']*(panel.stats(15)['ad']/1.5+15)
    assert abs(row['total_dps']*40-expected)<1e-6
    assert row['damage_by_slot']['3']==row['total_dps']*40
    for mode in ('O1','O2','O3','D0','D1','D2'):
        case={'mode':mode,'n':3,'seconds':40}
        if mode.startswith('D'):case['attacker']='A6'
        for seed in (0,1,7):run_one(case,seed)
    # Three arrows stop at three targets. Added 1/5 slots cannot add damage in the potential fixture.
    for seed in range(8):
        a=run_one({'n':3},seed)['40'];b=run_one({'n':5},seed)['40']
        assert abs(a['total_dps']-b['total_dps'])<1e-7
        finite=run_one({'mode':'O2'},seed)['40']
        assert finite['hp_dps']*40<=3000+1e-6
    # Static no-evade source expected hit-packet count is independent of hero offense.
    d=run_one({'mode':'D0','attacker':'A7'},0)['40']
    assert d['healing']==0 and d['attacks']==0 and d['death_time'] is not None
    print(f'PASS: damage/shield/capping, conservation, modes, targeting, builds; {len(cases())} scenarios.')


def main():
    p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');p.add_argument('--run',action='store_true')
    p.add_argument('--seeds',type=int,default=256);p.add_argument('--workers',type=int,default=4)
    p.add_argument('--output',default=str(ROOT/'lanya-benchmark-results.json'));args=p.parse_args()
    verify()
    if not args.run:return
    jobs=cases(); results=[]
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for i,r in enumerate(pool.map(batch,[(c,args.seeds) for c in jobs]),1):
            results.append(r)
            if i%20==0:print(f'{i}/{len(jobs)} scenarios complete',flush=True)
    payload=dict(model='LANYA-HB-model-0.1',standard=HB['standard_id'],engine='independent_python_not_game',
      hero_version='LANYA-0.2',seeds=args.seeds,scenario_count=len(jobs),trial_count=len(jobs)*args.seeds,
      model_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
      config_sha256=hashlib.sha256((ROOT/'hero-benchmark-v1.json').read_bytes()).hexdigest(),
      items=ITEMS,builds=BUILDS,
      assumptions=['20ms grid; regen to current instant before events; windows [0,T)',
       'candidate cast .2s and flight .2s; sensitivity 0/.4; zero casts actually >=one step',
       'attack interval snapshotted at launch; no attack-progress rescale',
       'Q001 shared hit; blood threshold at launch; modifiers snapshotted',
       'arrivals before incoming pulses before hero actions; no post-death output credited',
       'incoming_raw counts emitted components until death, not all preplanned pulses',
       'D1 root reset; first target 3 then persistent lock until invalid then lowest slot',
       'skill costs/CD at cast start; buffs and projectiles at completion; no overkill proc transfer'],
      not_supported=['real_game_adapter','final_action_timing','unresolved_global_proc_branches',
       'actual_hex_content','campaign_economy','support_team_fixture','whole_equipment_pool_optimum',
       'post15_random_choice_distribution','full_HB_required_field_export'],results=results)
    Path(args.output).write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n')
    print(f'Wrote {args.output}',flush=True)

if __name__=='__main__':main()
