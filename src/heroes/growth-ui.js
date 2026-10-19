import { HERO_PROFILES,CORE_STATS,heroBudget } from './foundation.js';
import { progressionSummary,rankReason,growthOffers,SKILL_CAPS } from './progression.js';
const labels={hp:'生命',hpRegen:'生命回复/秒',mana:'法力',manaRegen:'法力回复/秒',attack:'攻击力',attackSpeed:'基础攻速',armor:'护甲',resist:'魔抗'};
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>Number(n.toFixed(3));
export function growthButton(member,level,index){
  const s=progressionSummary(member,level);
  return `<button class="btn small hero-growth-button" data-act="hero-growth" data-hero="${index}">成长${s.points||s.choices?` · 技能 ${s.points} / 属性 ${s.choices}`:''}</button>`;
}
export function skillDetails(skill){
  if(!skill.id?.startsWith('lanya-'))return skill.description||'';
  const i=Number(skill.id.at(-1))-1;
  const rank=Math.max(1,skill.rank||1),s={...skill,...skill.ranks?.[rank-1]};
  const amount=i===0?`${s.bonus}＋25%攻击力＋30%法强 魔法附伤`:i===1?`${number(s.speed*100)}%额外攻速；主命中减冷却${number(s.refund)}秒`:i===2?`${s.effects[0].amount}＋90%攻击力 物理伤害/目标；精准+${s.accuracy}，闪避+${s.evasion}`:`被动真伤×${s.multiplier}；持续10秒`;
  return `${amount}。${skill.description}`;
}
export function renderGrowth(run,index,hero,definitions){
  const member=run.party[index],p=HERO_PROFILES[member.hero],s=progressionSummary(member,run.level),budget=heroBudget(member.hero,run.level);
  return `<section class="hero-growth" data-growth-hero="${index}">
    <p class="growth-identity">${esc(p.role)} · ${p.subtypes.map(esc).join(' / ')} · Lv.${run.level}</p>
    <p>${esc(hero.description)} 可选路线：${p.routes.map(esc).join('、')}。</p>
    ${s.choices?`<div class="growth-heading"><b>额外属性 · 待选 ${s.choices} 次</b><small>固定成长仍然继续</small></div><div class="growth-choices">${growthOffers(member).map(o=>`<button class="btn" data-act="choose-growth" data-hero="${index}" data-id="${o.id}"><b>${o.name}</b><span>+${o.stat==='bonusAttackSpeed'?`${o.value*100}%`:o.value}${['hpRegen','manaRegen'].includes(o.stat)?'/秒':''}</span></button>`).join('')}</div>`:''}
    <div class="growth-heading"><b>可用技能点 ${s.points}</b><button class="btn small" data-act="recommend-skills" data-hero="${index}" ${s.points?'':'disabled'}>按推荐补点</button></div>
    <p class="growth-rule">普通技能最高4级，6级前最多3级；2级须学习不同技能。大招5 / 10 / 15级解锁。</p>
    <div class="growth-skills">${definitions.map((base,i)=>{
      const rank=s.ranks[i],skill={...base,...base.ranks?.[Math.max(0,rank-1)],rank},next={...base,...base.ranks?.[rank],rank:rank+1},reason=rankReason(s.ranks,run.level,i);
      return `<article><span class="growth-number">${i+1}</span><div><h3>${esc(base.name)} <small>${rank} / ${SKILL_CAPS[i]}</small></h3><p>${esc(skillDetails(skill))}</p><small>${rank?'当前':'学习后'}：耗蓝 ${skill.cost} · 冷却 ${skill.cooldown}s${rank>0&&rank<SKILL_CAPS[i]?`；升级后耗蓝 ${next.cost} · 冷却 ${next.cooldown}s`:''}</small></div><button class="btn small" data-act="upgrade-skill" data-hero="${index}" data-skill="${i}" ${reason?'disabled':''} title="${esc(reason||'升级此技能')}" aria-label="升级${esc(base.name)}">${reason||'升级'}</button></article>`;
    }).join('')}</div>
    <p class="growth-rule">固定成长一直继续；16级起每级额外三选一，不增加法强或突破技能等级。</p>
    <details><summary>基础属性、每级成长与金币参考</summary><div class="growth-table-wrap"><table><thead><tr><th>属性</th><th>1级基础</th><th>每级成长</th></tr></thead><tbody>${CORE_STATS.map(key=>`<tr><td>${labels[key]}</td><td>${p.base[key]}</td><td>+${key==='attackSpeed'?`${number(p.growth[key]*100)}%额外攻速`:p.growth[key]}</td></tr>`).join('')}</tbody></table></div><p>已定价基础 ${number(budget.base)} 金，每级 ${number(budget.growth)} 金。基础频率、技能、被动和协同未计价；这不是售价或实战强度。法强初始和成长为0，只由装备增加。</p></details>
  </section>`;
}
