// Real Battle campaign comparison. Run before/after code changes with distinct --label values.
import {Battle} from '../src/battle.js';
import * as M from '../src/model.js';
import {mkdir,writeFile} from 'node:fs/promises';
const labelIndex=process.argv.indexOf('--label'),label=labelIndex<0?'current':process.argv[labelIndex+1];if(!/^[a-z0-9-]+$/.test(label))throw new Error('Invalid report label');
const seeds=Number(process.env.PACING_SEEDS||8),campaigns=[];
function equip(r,source,i){const item=M.getOffer(r,source,i);if(!item||(source==='shop'&&r.gold<item.price))return false;for(const [h,m] of r.party.entries()){const slot=m.gear.indexOf(null);if(slot>=0){M.acquire(r,source,i,h,slot);return true;}}return false;}
for(const challenge of [false,true])for(let seed=1;seed<=(challenge?2:seeds);seed++){
 const run=M.createRun(seed);M.recruit(run,run.candidates[0]);const floors=[];
 for(let floor=1;floor<=20;floor++){
  if(floor<=4)M.recruit(run,run.candidates[0]);run.party.forEach((_,i)=>M.recommendSkills(run,i));
  const b=new Battle(run),seen=new Map();let ticks=0,alone=0,empty=0,population=0,accepted=false;
  const track=u=>{seen.set(u.id,{kind:u.challenge?'challenge':u.boss?'boss':'normal',first:null,death:null});return u;};b.enemies.forEach(track);const spawn=b.spawn.bind(b);b.spawn=(...a)=>track(spawn(...a));
  const damage=b.dealDamage.bind(b);b.dealDamage=(s,t,shot)=>{const hp=t.hp,shield=t.shield;damage(s,t,shot);const r=seen.get(t.id);if(r&&(hp>t.hp||shield>t.shield)){r.first??=b.time;if(t.hp<=0)r.death=b.time;}};
  while(['combat','cleanup'].includes(b.phase)&&b.tick<12000){
   if(b.phase==='combat'){const n=b.living('enemy').length;ticks++;population+=n;alone+=n===1;empty+=n===0;if(challenge&&floor>=4&&!accepted&&n<5)accepted=b.acceptChallenge(b.challengeOffers[0].id);}
   b.step();
  }
  const row={floor,level:run.level,...b.result(),hpFraction:b.party.reduce((n,u)=>n+u.hp,0)/b.party.reduce((n,u)=>n+u.stats.hp,0),ticks,population,alone,empty,accepted,enemies:[...seen.values()]};floors.push(row);M.finishRound(run,b.result());if(!row.won)break;
  if(!equip(run,'chest',0))M.sellReward(run,0);for(let i=0;i<4;i++)equip(run,'shop',i);M.nextFloor(run);
 }
 campaigns.push({seed,challenge,phase:run.phase,level:run.level,kills:run.kills,earned:run.earned,floors});
}
const quantile=a=>{a=a.sort((a,b)=>a-b);return {n:a.length,p10:a[Math.floor((a.length-1)*.1)]??null,median:a[Math.floor((a.length-1)*.5)]??null,p90:a[Math.floor((a.length-1)*.9)]??null};};
function summarize(cs){const rows=cs.flatMap(c=>c.floors),total=key=>rows.reduce((n,r)=>n+r[key],0),enemies=rows.flatMap(r=>r.enemies);return {campaigns:cs.length,victories:cs.filter(c=>c.phase==='victory').length,battles:rows.length,averageEnemies:total('population')/total('ticks'),soloPercent:100*total('alone')/total('ticks'),emptyPercent:100*total('empty')/total('ticks'),seconds:quantile(rows.map(r=>r.seconds)),hpFraction:quantile(rows.map(r=>r.hpFraction)),endLevels:cs.map(c=>c.level),income:quantile(cs.map(c=>c.earned)),categories:Object.fromEntries(['normal','boss','challenge'].map(k=>{const es=enemies.filter(e=>e.kind===k),dead=es.filter(e=>e.death!==null);return [k,{...quantile(dead.map(e=>e.death-e.first)),censored:es.length-dead.length}];}))};}
const summary={ordinary:summarize(campaigns.filter(c=>!c.challenge)),optionalChallenge:summarize(campaigns.filter(c=>c.challenge))};
await mkdir('test-results/encounter-pacing',{recursive:true});await writeFile(`test-results/encounter-pacing/${label}.json`,JSON.stringify({label,seeds,policy:'first recruits/rewards, recommended skills, affordable empty slots; challenge cases accept one first offer each floor >=4 at first vacancy',summary,campaigns},null,2));console.log(JSON.stringify(summary,null,2));
