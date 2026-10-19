// Actual Battle calibration, fixed floor curves; never scales enemies to player gear.
// --legacy reproduces the enemy stat curve and 20-kill level pace at 4639cd4.
import {writeFile,mkdir} from 'node:fs/promises';
import {Battle} from '../src/battle.js';
import * as M from '../src/model.js';
import {ENEMY_TYPES,CHALLENGE_TYPES} from '../src/combat/tactics.js';
import {recalculate} from '../src/combat/unit.js';
const legacy=process.argv.includes('--legacy'),count=Number(process.env.BALANCE_SEEDS||8);
class LegacyBattle extends Battle {
 spawn(slot,template=null){const u=super.spawn(slot,template),f=this.run.floor,t=template||ENEMY_TYPES.find(t=>t.positions[0]===slot)||ENEMY_TYPES.find(t=>t.positions.includes(slot));
  Object.assign(u.baseStats,{hp:u.boss?260+f*35:(100+f*10)*t.health,attack:u.boss?12+f*2:(4+f*1.1)*t.damage,armor:f*1.5,resist:f*1.5});recalculate(u);u.hp=u.stats.hp;return u;}
}
const Engine=legacy?LegacyBattle:Battle;
const rounded=n=>Number(n.toFixed(2));
function distribution(a){a=[...a].sort((x,y)=>x-y);return {n:a.length,median:a.length?rounded(a[Math.floor((a.length-1)*.5)]):null,p10:a.length?rounded(a[Math.floor((a.length-1)*.1)]):null,p90:a.length?rounded(a[Math.floor((a.length-1)*.9)]):null};}
function fight(run,{challenge=false}={}){
 const b=new Engine(run),seen=new Map();
 const track=u=>{seen.set(u.id,{kind:u.boss?'boss':u.challenge?'challenge':'normal',spawn:b.time,first:null,death:null,impacts:0,hp:u.stats.hp});return u;};b.enemies.forEach(track);
 const spawn=b.spawn.bind(b);b.spawn=(...args)=>track(spawn(...args));
 const damage=b.dealDamage.bind(b);b.dealDamage=(source,target,shot)=>{const hp=target.hp,shield=target.shield;damage(source,target,shot);const r=seen.get(target.id);if(r&&(target.hp<hp||target.shield<shield)){r.first??=b.time;r.impacts++;if(target.hp<=0)r.death=b.time;}};
 if(challenge)for(const [i,type] of CHALLENGE_TYPES.entries())b.pendingChallenges.push({id:`probe-${i}`,type});
 for(let i=0;i<9000&&['combat','cleanup'].includes(b.phase);i++)b.step();
 return {floor:run.floor,level:run.level,party:run.party.map(m=>m.hero),gear:run.party.map(m=>m.gear.filter(Boolean).map(g=>g.base)),...b.result(),phase:b.phase,survivors:b.living('hero').length,hpFraction:rounded(b.party.reduce((s,u)=>s+u.hp,0)/b.party.reduce((s,u)=>s+u.stats.hp,0)),enemies:[...seen.values()].map(r=>({...r,spawn:rounded(r.spawn),first:r.first===null?null:rounded(r.first),death:r.death===null?null:rounded(r.death),engagedSeconds:r.death===null?null:rounded(r.death-r.first)}))};
}
function equip(run,source,index){const item=M.getOffer(run,source,index);if(!item||source==='shop'&&run.gold<item.price)return false;for(const [i,m] of run.party.entries()){const slot=m.gear.indexOf(null);if(slot>=0){M.acquire(run,source,index,i,slot);return true;}}return false;}
const campaigns=[];
for(let seed=1;seed<=count;seed++){
 const run=M.createRun(seed);M.recruit(run,run.candidates[0]);const floors=[];
 for(let f=1;f<=20;f++){
  if(f<=4)M.recruit(run,run.candidates[0]);run.party.forEach((_,i)=>M.recommendSkills(run,i));
  const row=fight(run),previousLevel=run.level;floors.push(row);M.finishRound(run,row);
  if(legacy)run.level=Math.max(previousLevel,1+Math.floor(run.xp/20));
  if(!row.won)break;
  if(!equip(run,'chest',0))M.sellReward(run,0);for(let i=0;i<4;i++)equip(run,'shop',i);M.nextFloor(run);
 }
 campaigns.push({seed,phase:run.phase,level:run.level,kills:run.kills,earned:run.earned,floors});
}
// Controlled snapshots compare identical composition, skill ranks and purchasable gear.
const encounters=[];
for(const [floor,level] of [[1,1],[4,3],[8,6],[12,10],[20,15]])for(const build of ['bare','equipped'])for(let seed=1;seed<=count;seed++){
 const run=M.createRun(seed);run.floor=floor;run.level=level;run.phase='ready';
 run.party=['stone','lanya','ember','leaf','blade'].slice(0,Math.min(5,floor+1)).map(hero=>({hero,gear:[null,null,null,null]}));
 for(const [i,m] of run.party.entries()){
  M.recommendSkills(run,i);
  if(build==='equipped'){
   const items=floor<4?['white_iron_sword']:floor<10?['blue_duelist_blade','white_iron_sword']:['blue_duelist_blade','blue_tempered_sword','blue_swift_blades','white_vitality_pendant'];
   m.gear=items.map(id=>M.makeItem(run,id));while(m.gear.length<4)m.gear.push(null);
  }
 }
 encounters.push({seed,build,...fight(run,{challenge:floor>=4})});
}
function summary(rows){const enemies=rows.flatMap(r=>r.enemies);return {battles:rows.length,wins:rows.filter(r=>r.won).length,seconds:distribution(rows.map(r=>r.seconds)),kills:distribution(rows.map(r=>r.kills)),hpFraction:distribution(rows.map(r=>r.hpFraction)),categories:Object.fromEntries(['normal','challenge','boss'].map(k=>{const a=enemies.filter(e=>e.kind===k),dead=a.filter(e=>e.death!==null);return [k,{...distribution(dead.map(e=>e.engagedSeconds)),spawned:a.length,censored:a.length-dead.length,underOneSecond:dead.filter(e=>e.engagedSeconds<1).length,oneImpact:dead.filter(e=>e.impacts===1).length}];}))};}
const report={profile:legacy?'legacy-4639cd4':'current',seedCount:count,step:.02,limit:180,policy:'First recruit/reward; fill empty slots with affordable shop items, no refresh/combine/replacement. Recommend skills, default managed. Snapshots give fixed equipment, not earned gear.',campaigns,encounters,summary:{campaign:summary(campaigns.flatMap(c=>c.floors)),byFloor:Object.fromEntries([1,4,8,12,20].map(f=>[f,summary(campaigns.flatMap(c=>c.floors).filter(r=>r.floor===f))])),encounters:Object.fromEntries([1,4,8,12,20].flatMap(f=>['bare','equipped'].map(b=>[`${f}-${b}`,summary(encounters.filter(r=>r.floor===f&&r.build===b))]))),completed:campaigns.filter(c=>c.phase==='victory').length,endLevel:distribution(campaigns.map(c=>c.level)),earned:distribution(campaigns.map(c=>c.earned))}};
await mkdir('test-results/enemy-balance',{recursive:true});await writeFile(`test-results/enemy-balance/${report.profile}.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report.summary,null,2));
