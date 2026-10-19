"""从实际模型JSON生成岚牙报告与SVG，不手填成绩。需要matplotlib用于绘图。"""
import json
import os
from pathlib import Path
from statistics import mean,stdev
from math import sqrt

ROOT=Path(__file__).parent
DATA=json.loads((ROOT/'lanya-benchmark-results.json').read_text())
R={r['case']['id']:r for r in DATA['results']}


def val(id,key='total_dps',w=40):
    x=R[id]['summary'][str(w)][key]
    return x['mean'] if x else None


def fmt(x):return '—' if x is None else f'{x:.1f}'
def pct(x):return f'{100*x:.1f}%'
def paired(a,b,key='total_dps',w=40):
    xs=R[a]['paired_samples'][str(w)][key];ys=R[b]['paired_samples'][str(w)][key]
    ds=[x-y for x,y in zip(xs,ys)];m=mean(ds);e=1.96*stdev(ds)/sqrt(len(ds))
    return f'{m:+.1f} [{m-e:+.1f}, {m+e:+.1f}]'


lines=['# 岚牙 V0.2 · HB首轮模型测试报告', '',
'2026-10-19，R033。用户接受统一方案并要求测试岚牙；本轮保持英雄/装备数值不变。', '',
'**这是依照HB场景运行的独立设计模型估算，尚非游戏引擎实测，也不是完整HB合格报告。** 英雄施法/弹道尚未定稿，本报告保留假设和敏感性，不给跨英雄强弱排名。', '',
f'实际运行 **{DATA["scenario_count"]}组 × {DATA["seeds"]}种子 = {DATA["trial_count"]:,}场**。参数与每组统计、配对样本见 [JSON](lanya-benchmark-results.json)，模型见 [脚本](lanya-benchmark.py)，标准见 [HB-1.0](HERO-BENCHMARK.md)。', '',
'复现：`python3 docs/heroes/lanya-benchmark.py --run --workers 4`；生成本报告与图：`MPLCONFIGDIR=/tmp/lanya-mpl python3 docs/heroes/lanya-benchmark-report.py`。', '',
'![岚牙测试曲线](lanya-benchmark.svg)', '',
'## 条件与限制', '',
'- 默认15级、4/4/4/3、满血蓝、英雄3号位；目标布局严格使用HB的[3]/[2,3,4]/[1,2,3,4,5]。锁定3号，失效后选最小槽位并保持到失效，3补选邻近目标。',
'- 主表暂定每技能吟唱占用0.2秒、弹道0.2秒；技能开始付费/启动冷却，完成后获得增益/发射，施法时不能发起普攻；普攻间隔在发射时锁定。此时序是实验假设，不写回英雄。零占用敏感性仍有最多一帧20ms调度延迟。',
'- 模型使用20ms、独立攻击/各目标技能/各压力源随机流，均值及配对差值仅代表该模型的随机误差。发射命中与附伤共用Q001候选；血潮低血吸血在发射读取，也是未定稿分支。所有附伤不递归、三箭不携带特效。',
'- 先处理到达弹道，再处理敌方脉冲，再让英雄行动；英雄死亡后不再计在途输出。攻击期间穷追不追溯改变已锁定间隔。跨目标旧弹道不能恢复已经清掉的旧目标层数。',
'- O1为潜在输出、不产生吸血；O2有限击杀、O3补靶；D1压力源每根行动后恢复生命且不触发击杀，D2敌人可杀。D0关闭回复和全部技能。D1伤害不能当实际击杀输出。',
'- 不支持正式引擎适配、最终行动时序、全局触发候选的全部分支、正式海克斯、队伍辅助陪测、全装备最优搜索与正式关卡经济。固定属性选择仅为受控假设，不保证随机三选一实际每次刷出该属性。未支持项目不填0。',
'- JSON是本模型统计格式，未实现HB全部逐事件字段；空指标用null。死亡/清场的条件均值只在部分试验发生事件时可用，正文优先用限制均值和发生率，不能把删失样本当真实事件时间。', '',
'## 1. 单体与群体潜在DPS', '',
'均衡木桩3000生命/双抗50；以下无敌方反击。每格是全部目标合计，不能把三目标合计当Boss伤害。', '',
'| 构筑 | 目标数 | 5秒 | 10秒 | 40秒 | 180秒 |', '| --- | ---: | ---: | ---: | ---: | ---: |']
for b in ('bare','as1500','as3000','onhit6000'):
    for n in (1,3,5):
        id=f'output_{b}_{n}';lines.append(f'| {b} | {n} | '+' | '.join(fmt(val(id,w=w)) for w in (5,10,40,180))+' |')
lines+=['','三目标和五目标在O1下相同：3技能只打主目标及其最近两个邻位，额外两只不会增加箭数。有限清场则需要额外转火和普攻，结果见下表。','',
'## 2. 各类防御与实际清场', '',
'裸装15级。潜在DPS看40秒；清场用180秒观察，限制均值=平均min(清场时间,180)，只有清场率100%时才等于平均实际清场时间。回复桩不做O1。','',
'| 类型 | 单体潜在DPS | 1只清场秒/成功率 | 3只清场秒/成功率 | 5只清场秒/成功率 |', '| --- | ---: | ---: | ---: | ---: |']
names=['零抗','均衡','高血','高护甲','高魔抗','双抗','减伤','护盾','闪避','回复']
for i,name in enumerate(names):
    p=f'T{i}';id='output_bare_1' if i==1 else f'target_{p}_1'
    d='—' if i==9 else fmt(val(id))
    cells=[f'{fmt(val(f"kill_{p}_{n}","clear_rmst",180))} / {pct(val(f"kill_{p}_{n}","clear_rate",180))}' for n in (1,3,5)]
    lines.append(f'| {name} | {d} | '+' | '.join(cells)+' |')
lines+=['','护盾潜在总DPS含实际盾伤；高魔抗桩护甲只有30，故岚牙总伤可略高于双抗50的均衡桩，不是魔抗提高伤害。回复只看有限生命测试，不把回复后再次扣血算成虚假伤害。混合木桩的3/5种循环布局与补靶结果均保存在JSON，每布局等样本。','',
'## 3. 承伤', '',
'裸装15级、40秒窗口。表中为限制平均存活秒数RMST(40)，未死只算观察到40秒；所有单源格若存活率0%，数值就是平均实际死亡时间。总压为所有来源合计200原始DPS，集火为每个来源200。','',
'| 压力类型 | 静态1源 | 完整技能1源 | 完整技能3源/总压 | 完整技能5源/总压 | 完整技能3源/集火 | 完整技能5源/集火 |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |']
for a,name in zip(('A1','A2','A3','A4','A5','A6','A7','A8'),('物理普攻','高频物理','重击物理','持续魔法','魔法爆发','物魔混合','真实','破魔')):
    keys=[f'defense_{a}_D0_1_total']+[f'defense_{a}_D1_{n}_{m}' for n,m in ((1,'total'),(3,'total'),(5,'total'),(3,'each'),(5,'each'))]
    lines.append(f'| {name} | '+' | '.join(fmt(val(k,'rmst')) for k in keys)+' |')
lines+=['','等总压的不同人数仍有小幅差异：站位影响命中，高频/同步脉冲、回复间隙和最后一击溢出不同。D0/D1差异包含自然回复和3技能闪避，不能全部归功于3。','',
'## 4. 装备增幅与生存', '',
'手工候选，不声称最优出装。均遵守4槽；材料价格已含在成品总价中。','',
'| 构筑ID | 装备 | 花费/预算 | 40秒单体DPS | 较裸装 | 每千金增加DPS | 180秒DPS | 混伤D1存活秒RMST(180) |', '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |']
baseline=val('build_bare')
for b,(budget,items) in DATA['builds'].items():
    spent=sum(DATA['items'][i][1] for i in items);label='＋'.join(DATA['items'][i][0] for i in items) or '无'
    d=val(f'build_{b}');lines.append(f'| {b} | {label} | {spent}/{budget} | {fmt(d)} | {pct(d/baseline-1)} | {fmt(1000*(d-baseline)/spent) if spent else "—"} | {fmt(val(f"build_{b}",w=180))} | {fmt(val(f"build_defense_{b}","rmst",180))} |')
lines+=['','sustain6000实际花5700、余300；其余候选花费恰等预算。AP路线只有1技能吃法强，3不吃；不因路线可选就假定已经等强。生存成绩不含“杀死压力源”的减压。','',
'实际边打边承伤，敌人均衡有限生命、A6合计200原始DPS；40秒死后输出计0。下表用于区分“木桩打得快”与“实际活着打出伤害”。','',
'| 构筑 | 敌人数 | 有效总DPS | 40秒存活率 | 40秒清场率 |', '| --- | ---: | ---: | ---: | ---: |']
for b in ('bare','as3000','def3000','onhit6000'):
    for n in (1,3,5):
        k=f'combat_{b}_{n}';lines.append(f'| {b} | {n} | {fmt(val(k))} | {pct(val(k,"survival"))} | {pct(val(k,"clear_rate"))} |')
lines+=['','## 5. 自然成长', '',
'采用英雄稿主1副2合法点法，15级后固定成长继续、此表额外属性点暂不分配。固定尺为15级木桩；同级尺为H=600+160L、双抗=20+2L。D1同级压力=80+8L。','',
'| 等级 | 技能等级 | 固定尺40秒DPS | 同级尺40秒DPS | 同级混伤RMST(40) |', '| --- | --- | ---: | ---: | ---: |']
for level in (1,2,3,5,6,10,15,16,20,25,30):
    k=f'growth_{level}_fixed';r=R[k]['case'].get('ranks')
    order=[1,2,1,1,4,1,3,2,2,4,2,3,3,3,4];r=[order[:min(15,level)].count(x) for x in range(1,5)]
    lines.append(f'| {level} | {"/".join(map(str,r))} | {fmt(val(k))} | {fmt(val(f"growth_{level}_same"))} | {fmt(val(f"growth_defense_{level}_same","rmst"))} |')
lines+=['','额外选择受控对照：16级起每次固定选+8个百分点额外攻速（每次300金工作价），不代表随机升级一定可选到。','',
'| 等级 | 纯自然成长DPS | 加固定攻速选择DPS | 增幅 |', '| --- | ---: | ---: | ---: |']
for level in (16,20,25,30):
    a=val(f'growth_{level}_fixed');b=val(f'choice_{level}');lines.append(f'| {level} | {fmt(a)} | {fmt(b)} | {pct(b/a-1)} |')
lines+=['','## 6. 单技能升满边际', '',
'固定15级裸装，基线四技能各1级，未分配点暂存；普通技能多花3点，大招多花2点。配对95%区间是随机采样区间，不覆盖时序假设误差。','',
'| 配置 | 单体40秒DPS | 相对各1级差值[95%区间] | 三目标40秒DPS | 每点单体收益 |', '| --- | ---: | --- | ---: | ---: |']
for name in ('all1','max1','max2','max3','max4'):
    k=f'skills_{name}_1';delta=val(k)-val('skills_all1_1');points=2 if name=='max4' else 3
    lines.append(f'| {name} | {fmt(val(k))} | {paired(k,"skills_all1_1")} | {fmt(val(f"skills_{name}_3"))} | {fmt(delta/points) if name!="all1" else "—"} |')
lines+=['','## 7. 时序敏感性与强化扰动', '',
'每种时序同时改变施法占用与弹道；默认0.2秒。不是已经定稿的英雄动作参数。','',
'| 占用/飞行 | 单体40秒DPS | 三目标40秒DPS |', '| --- | ---: | ---: |']
for timing in (0,.2,.4):
    keys=[f'output_bare_{n}' if timing==.2 else f'timing_{timing}_{n}' for n in (1,3)]
    lines.append(f'| {timing}秒 | '+' | '.join(fmt(val(k)) for k in keys)+' |')
lines+=['','X1为额外攻速+50个百分点，X2为技能急速+30，X3只放大被动真伤/1魔法附伤/连击额外伤害×1.5；不增加普攻或三箭、计数、盾量。这是压力扰动，不是正式海克斯。','',
'| 扰动 | 裸装单体DPS | 6000金特效构筑DPS |', '| --- | ---: | ---: |']
for name in ('none','as','haste','onhit','as_onhit'):
    lines.append(f'| {name} | {fmt(val(f"probe_{name}_bare"))} | {fmt(val(f"probe_{name}_onhit6000"))} |')
for b in ('bare','onhit6000'):
    interaction=val(f'probe_as_onhit_{b}')-val(f'probe_as_{b}')-val(f'probe_onhit_{b}')+val(f'probe_none_{b}')
    lines.append(f'\n{b}的攻速×附伤交互量：{interaction:+.1f} DPS；正交互需要纳入预算，不自动判失衡。')
lines+=['','## 8. 自动施法与法力保留', '',
'默认策略为4→2→1→3：大招蓝不够就继续检查较便宜的技能，可能长期无法攒到100蓝。补测reserve_r：普通技能支付后，剩余法力加上到大招冷却结束前的自然回蓝，必须够下一次大招；否则暂缓该普通技能。是预先明确的候选策略，不改英雄数值、不声称最优。', '',
'| 构筑 | 默认40秒DPS | 留蓝40秒DPS | 默认180秒DPS | 留蓝180秒DPS | 默认/留蓝180秒大招次数 |', '| --- | ---: | ---: | ---: | ---: | ---: |']
for b in ('bare','as3000','onhit6000'):
    a=f'output_{b}_1';r=f'reserve_{b}_1'
    ca=R[a]['summary']['180']['casts'][3]['mean'];cr=R[r]['summary']['180']['casts'][3]['mean']
    lines.append(f'| {b} | {fmt(val(a))} | {fmt(val(r))} | {fmt(val(a,w=180))} | {fmt(val(r,w=180))} | {ca:.1f}/{cr:.1f} |')
lines+=['','留蓝牺牲部分当下技能，换取后续大招；不能把180秒更优直接当作40秒关卡更优。正式自动策略应结合战斗剩余时长，当前游戏尚未接入此英雄或留蓝策略。','',
'## 首轮判断', '',
'- 岚牙在本模型呈现单体持续/开场爆发取向，三箭补少量群伤；3→5目标不增加潜在DPS，有限清场明显变慢。没有证据需要把3扩成五目标。',
'- 同预算纯攻击力候选略胜纯攻速；加入连击/穷追后特效构筑收益上升。职业方向不等于只能买攻速；目前没有完整装备池搜索或其它英雄对照。',
'- 防御装木桩DPS低于纯输出装，但在五敌反击中能靠存活提高有效输出；这符合多路线取舍。法强候选明显落后于物理候选，暂不能称为成熟的等强分支。',
'- 升2的单体边际高于升1；升3的三目标收益突出。需结合早期合法加点和技能职责继续评审，不据此自动改技能数值。',
'- 180秒默认策略存在低费技能抢蓝，优先明确资源策略再判长期数值强弱；攻击速度与附伤存在正协同，未来海克斯须继续做组合测试。','']
lines+=['','## 验证与解释边界', '',
'- 专项时步与结算检查见 [检查结果](lanya-benchmark-checks.json)，复现 `python3 docs/heroes/lanya-benchmark-check.py`；32种子对比六组20ms/10ms，不把随机区间当模型精度。',
'- 每场核对生命、法力、承伤分账及伤害来源之和；专项检查覆盖真实吃盾/破魔绕盾、实际生命封顶、三箭目标数、有限死亡、装备槽位/预算与合法加点。',
'- 各组是同种子配对；JSON提供均值、标准差、P10/P50/P90及均值区间（生存/清场概率使用Wilson区间），并保留关键配对样本。事件未发生用null，存活/清场另有发生率及限制均值。',
'- 首轮仅岚牙，不能凭这些数字证明比其他英雄强弱。需要后续英雄在相同模型版本和条件下比较，并用实际引擎验证。',
'- 旧R029简化结果保留；本轮变化来自新布局/动作占用/有限目标/承伤等模型边界，不是英雄技能被暗改。Page待同步；游戏源码未修改。','']
(ROOT/'LANYA-BENCHMARK.md').write_text('\n'.join(lines))

os.environ.setdefault('MPLCONFIGDIR','/tmp/lanya-mpl')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties
font=FontProperties(fname='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')
plt.rcParams['font.family']=font.get_name();plt.rcParams['axes.unicode_minus']=False
fig,axes=plt.subplots(2,2,figsize=(13,8),layout='constrained')
fig.suptitle('岚牙 V0.2｜HB首轮模型估算（非游戏实测）',fontsize=18)
a=axes[0,0]
for b,label in [('bare','裸装'),('as3000','3000金攻速'),('onhit6000','6000金特效')]:
    a.plot([1,3,5],[val(f'output_{b}_{n}') for n in (1,3,5)],marker='o',label=label)
a.set(title='均衡木桩 · 40秒潜在总DPS',xlabel='目标数量',ylabel='DPS',xticks=[1,3,5]);a.legend()
a=axes[0,1];levels=[1,2,3,5,6,10,15,16,20,25,30]
for scale,label in [('fixed','固定15级木桩'),('same','同级木桩')]:a.plot(levels,[val(f'growth_{l}_{scale}') for l in levels],marker='.',label=label)
a.set(title='裸装自然成长 · 单体40秒DPS',xlabel='英雄等级（不设成长上限）',ylabel='DPS');a.legend()
a=axes[1,0];labels=['物理','高频','重击','魔法','爆发','混合','真实','破魔']
a.bar(labels,[val(f'defense_A{i}_D1_1_total','rmst') for i in range(1,9)],color='#5685b5')
a.set(title='裸装 · 单来源200原始DPS下的生存',ylabel='限制平均存活秒数 RMST(40)')
a=axes[1,1];bs=['bare','as3000','ad3000','mana3000','def3000','regen3000','onhit6000'];labels=['裸装','攻速3k','攻击3k','回蓝3k','防御3k','回复3k','特效6k']
a.bar(labels,[val(f'build_{b}') for b in bs],color='#438c75')
a.set(title='候选装备 · 单体40秒潜在DPS',ylabel='DPS')
for a in axes.flat:a.grid(axis='y',alpha=.18);a.spines[['top','right']].set_visible(False)
fig.savefig(ROOT/'lanya-benchmark.svg')
svg=ROOT/'lanya-benchmark.svg'
svg.write_text('\n'.join(line.rstrip() for line in svg.read_text().splitlines())+'\n')
fig.savefig('/tmp/lanya-benchmark-preview.png',dpi=120)
print('Generated LANYA-BENCHMARK.md and lanya-benchmark.svg')
