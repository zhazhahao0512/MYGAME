"""独立运行模型专项核验与10ms时步敏感性；不修改游戏。"""
import importlib.util
import json
from pathlib import Path
from statistics import mean

ROOT=Path(__file__).parent
spec=importlib.util.spec_from_file_location('hb',ROOT/'lanya-benchmark.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.verify()
checks=[]
for case in [dict(id='bare',n=1),dict(id='three',n=3),dict(id='geared',build='onhit6000'),
             dict(id='finite',mode='O2',n=3),dict(id='pressure',mode='D1',attacker='A6'),
             dict(id='combat',mode='D2',attacker='A6',n=5,build='def3000')]:
    rows=[]
    for dt in (.02,.01):
        data=[m.run_one(dict(case,dt=dt),seed)['40'] for seed in range(32)]
        rows.append({k:mean(x[k] for x in data) for k in ('total_dps','rmst','clear_rmst','survival')})
    checks.append(dict(case=case,dt20=rows[0],dt10=rows[1],
        relative_dps_change=rows[1]['total_dps']/rows[0]['total_dps']-1))
    print(case['id'],rows,flush=True)
# Same seed reproduces each stochastic path and aggregate exactly.
a=m.run_one({'n':5,'mode':'D2','attacker':'A6','build':'def3000'},17)
assert a==m.run_one({'n':5,'mode':'D2','attacker':'A6','build':'def3000'},17)
# Weapon choice/guard only on main attack; volley alone cannot supply additional main hit counts.
for n in (1,3,5):
    row=m.run_one({'n':n,'build':'def3000'},5)['40']
    assert row['hits']<=row['attacks']
# Defense distinction: only shields change magic vs shield-piercing magic, not armor formula.
for seed in range(8):
    a=m.run_one({'mode':'D1','attacker':'A4'},seed)['40']
    b=m.run_one({'mode':'D1','attacker':'A8'},seed)['40']
    assert a==b
    a=m.run_one({'mode':'D1','attacker':'A4','build':'def3000'},seed)['40']
    b=m.run_one({'mode':'D1','attacker':'A8','build':'def3000'},seed)['40']
    assert a['shield_absorbed']>0 and b['shield_absorbed']==0
    assert a['rmst']>=b['rmst']
Path(ROOT/'lanya-benchmark-checks.json').write_text(json.dumps(dict(seeds=32,checks=checks),ensure_ascii=False,indent=2)+'\n')
print('PASS: reproducibility, main-hit counts, shield-piercing, six 20/10ms comparisons.')
