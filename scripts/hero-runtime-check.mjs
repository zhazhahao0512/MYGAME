import { readFile,mkdir,writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { runHeroBenchmark } from '../src/heroes/benchmark.js';
import { equipmentById } from '../src/equipment.js';
const config=JSON.parse(await readFile('docs/heroes/hero-benchmark-v1.json','utf8'));
const seeds=Number(process.env.HERO_BENCHMARK_SEEDS||16),reports=[];
for(const level of [5,15,20])for(const count of [1,3,5])for(const target of config.targets.filter(t=>!t.finite_hp_only))for(const mode of ['managed','auto']){
  const rows=Array.from({length:seeds},(_,seed)=>runHeroBenchmark({level,count,target,mode,seed}));
  assert.ok(rows.every(r=>Number.isFinite(r.dps)&&r.manaEnd>=0&&r.casts.length===4));
  reports.push({level,count,target:target.id,mode,seeds,meanDps:rows.reduce((n,r)=>n+r.dps,0)/seeds,minDps:Math.min(...rows.map(r=>r.dps)),maxDps:Math.max(...rows.map(r=>r.dps)),meanManaEnd:rows.reduce((n,r)=>n+r.manaEnd,0)/seeds,meanCasts:rows[0].casts.map((_,i)=>rows.reduce((n,r)=>n+r.casts[i],0)/seeds)});
}
const defense=[];
for(const count of [1,3,5])for(const attacker of config.attackers){
  const rows=Array.from({length:seeds},(_,seed)=>runHeroBenchmark({level:15,count,target:config.targets[1],attacker,seconds:180,seed}));
  defense.push({count,attacker:attacker.id,seeds,survival:rows.filter(r=>r.survived).length/seeds,meanObservedSeconds:rows.reduce((n,r)=>n+(r.deathTime??180),0)/seeds,rightCensored:rows.filter(r=>r.rightCensored).length});
}
const builds=[];
for(const ids of [[],['purple_gale_blades'],['purple_steel_greatsword'],['purple_radiant_staff'],['purple_gale_blades','purple_combo_bow','purple_battle_spear'],['purple_gale_blades','purple_watch_blades','purple_bloodpact_blade']])for(const count of [1,3,5]){
  const gear=ids.map((id,i)=>{const d=equipmentById(id);return {uid:`benchmark-${i}`,base:id,...d};});
  const rows=Array.from({length:seeds},(_,seed)=>runHeroBenchmark({level:15,count,target:config.targets[1],gear,seed}));
  builds.push({items:ids,spentGold:ids.reduce((n,id)=>n+equipmentById(id).price,0),count,seeds,meanDps:rows.reduce((n,r)=>n+r.dps,0)/seeds});
}
await mkdir('test-results/heroes',{recursive:true});
await writeFile('test-results/heroes/runtime-benchmark.json',JSON.stringify({standard:config.standard_id,implementation:'R048 actual Battle adapter',window:40,seedCount:seeds,limitations:['partial HB: potential output + synchronized fixed total pressure','no finite cohorts, T9 healing, support/control overlays or full equipment/hex matrix','prototype enemies and progression economy still require playtesting'],reports,defense,builds},null,2));
console.log(JSON.stringify({cases:reports.length,defenseCases:defense.length,seeds,baseline:reports.filter(r=>r.level===15&&r.target==='T1')},null,2));
