import { HEROES, heroById, BASE, RULES, RARITIES, PRIMARY, SECONDARY, STAT_LABELS, statText } from './data.js';
import * as M from './model.js';
import { installInspection } from './inspection.js';
import { TARGET_MODES } from './combat/tactics.js';
import { Battle, STEP, cooldown } from './battle.js';
import { installPointerDrag } from './pointer-drag.js';
import { skillsFor, STONE_PASSIVE, AUGMENTS, EQUIPMENT_EFFECTS } from './combat/content.js';

const app=document.querySelector('#app'),modalRoot=document.querySelector('#modal-root');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={arrow:'M5 12h14m-6-6 6 6-6 6',back:'M19 12H5m6-6-6 6 6 6',cross:'m6 6 12 12M6 18 18 6',refresh:'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',pause:'M8 5v14M16 5v14',play:'m8 5 11 7-11 7z',coin:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v10m-3-8h5m-5 6h5',swap:'M4 7h16l-4-4M20 17H4l4 4',chest:'M3 10h18v10H3zM3 10V6l3-3h12l3 3v4M10 10v5h4v-5',check:'m5 12 4 4L19 6',info:'M12 11v6m0-10v1M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',flag:'M5 21V3l14 3-14 6'};
const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[name]||icons.info}"/></svg>`;
const btn=(text,act,cls='',extra='')=>`<button class="btn ${cls}" data-act="${act}" ${extra}>${text}</button>`;
const gold=n=>`<span class="gold">${icon('coin')}${n}</span>`;
const roleName={front:'最前方',slot3:'优先三号位',random:'随机目标',weakest:'最低生命'};
let saved=null,run=null,screen='home',preview=false,battle=null,paused=false,modal=null,selectedHero=null,attributePage='primary',selectedUnit=0,lastFrame=0,accumulator=0,drawAt=0,toastTimer,previousFocus;
let renderer=null,loadingBattle=null,renderedBattle=null;
let shopSelection=null,shopPopover=null;
let commandArmed=false,selectedEnemy=0,challengeRevision=-1;
let inspecting=false,orientationPaused=false,mobileView='loadout';
const compactBattle=matchMedia('(max-width: 1100px) and (max-height: 600px), (max-width: 600px)');
const portraitBattle=()=>compactBattle.matches&&innerHeight>innerWidth;
const battlePaused=()=>!!modal||document.hidden||paused||inspecting||orientationPaused;
function syncPause(){accumulator=0;lastFrame=performance.now();renderer?.syncPause();const notice=document.querySelector('#battle-pause-note');if(notice){notice.hidden=!inspecting;notice.textContent='查看说明 · 战斗已暂停';}}
const inspection=installInspection({contentFor:inspectionContent,allowed:()=>!modal&&!shopPopover&&!document.body.classList.contains('dragging'),changed:open=>{inspecting=open;syncPause();if(open)updateBattle();}});
const popoverRoot=document.createElement('div');popoverRoot.id='shop-popover-root';document.body.append(popoverRoot);
let settings={motion:!matchMedia('(prefers-reduced-motion: reduce)').matches};
try{saved=M.parseSave(localStorage.getItem(M.SAVE_KEY));const stored=JSON.parse(localStorage.getItem('squad.settings')||'null');if(stored&&typeof stored.motion==='boolean')settings.motion=stored.motion;}catch{}
function toast(message){const el=document.querySelector('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),3400);}
function save(){if(!run||preview)return;try{localStorage.setItem(M.SAVE_KEY,JSON.stringify(run));saved=M.parseSave(JSON.stringify(run));}catch{toast('浏览器存储不可用，本次进度无法保存。');}}
function persistSettings(){try{localStorage.setItem('squad.settings',JSON.stringify(settings));}catch{}document.body.classList.toggle('reduce-motion',!settings.motion);}
function portrait(def,cls=''){return `<span class="portrait ${cls}" style="--hero:${def.color}"><span class="portrait-corner">${escape(def.role)}</span><b>${escape(def.mark)}</b><small>${escape(def.name)}</small></span>`;}
function statGrid(stats,page=attributePage){return `<div class="stat-grid ${page==='secondary'?'secondary':''}">${(page==='primary'?PRIMARY:SECONDARY).map(key=>`<div title="${STAT_LABELS[key]}：当前最终值"><span>${STAT_LABELS[key]}</span><b data-stat="${key}">${statText(key,stats[key])}</b></div>`).join('')}</div>`;}
function itemBox(item,cls=''){const rarity=RARITIES.find(r=>r.id===item.rarity);return `<span class="item-box ${cls}" style="--rarity:${rarity.color}"><b>${escape(item.mark)}</b><small>${rarity.name}</small></span>`;}
function itemInfo(item){const effect=item.rarity==='orange'?(EQUIPMENT_EFFECTS[item.base]?.description||item.effect):null;const rarity=RARITIES.find(r=>r.id===item.rarity);return `<div class="item-details" style="--rarity:${rarity.color}">${itemBox(item)}<div><span class="rarity">${rarity.name}${item.rarity==='orange'?' · 橙装':''}</span><h3>${escape(item.name)}</h3><div class="item-stats">${Object.entries(item.stats).map(([k,v])=>`<span>${STAT_LABELS[k]} <b>+${statText(k,v)}</b></span>`).join('')}</div>${effect?`<small class="muted">${escape(effect)} · 每人限 1 件</small>`:''}</div></div>`;}
function inspectionContent(anchor){
  const {inspect,hero,skill,slot,source,index}=anchor.dataset,h=Number(hero),member=run?.party[h];
  const pauseNote=screen==='battle'?'<p class="inspection-pause">查看说明 · 战斗已暂停</p>':'';
  if(inspect==='gear'||inspect==='offer'){
    const item=inspect==='gear'?member?.gear[Number(slot)]:M.getOffer(run,source,Number(index));if(!item)return null;
    const vamp=(item.stats.lifeSteal||item.stats.omni)?'<p>吸血只作用于普攻；全能吸血作用于普攻和伤害技能，两者可叠加。按实际生命损失计算，护盾吸收、过量伤害不计入；受治疗增强影响。</p>':'';
    return itemInfo(item)+vamp+(screen==='shop'?`<p>购买 ${item.price} 金币 · 出售 ${M.salePrice(item)} 金币</p>`:'')+pauseNote;
  }
  if(inspect==='enemy-skill'){const u=battle?.find(anchor.dataset.enemyId),skill=u?.skills[Number(anchor.dataset.skill)];return skill?`<h3>${escape(u.name)} · ${escape(skill.name)}</h3><p>法力消耗 ${skill.cost} · 冷却 ${skill.cooldown}s · 施法 ${skill.castTime}s</p><p>对敌方目标释放伤害技能。</p>${pauseNote}`:null;}
  if(!member)return null;
  if(inspect==='passive')return `<h3>${member.hero==='stone'?STONE_PASSIVE.name:'被动技能'}</h3><p>${member.hero==='stone'?STONE_PASSIVE.description:'专属被动尚未设计，当前占位。'}</p>${pauseNote}`;
  const n=Number(skill),unit=screen==='battle'?battle.party[h]:null,definition=unit?battle.getSkill(unit,n):skillsFor(member.hero)[n];
  if(!definition)return null;
  const stats=unit?.stats||M.statsFor(member,run.level,run.augments);
  const targets={self:'自身',enemy:unit?.tactics?'敌方 · 沿用当前锁定 / 英雄选敌策略':`敌方 · ${roleName[heroById(member.hero).attackRule]||'最前方'}`,allEnemies:'所有存活敌人',allAllies:'所有存活友军',allyWeakest:'生命比例最低的受伤友军'};
  return `<h3>${definition.key} · ${escape(definition.name)}</h3><p>${escape(definition.description)}</p><dl><div><dt>目标</dt><dd>${targets[definition.target]}</dd></div><div><dt>法力消耗</dt><dd>${definition.cost}</dd></div><div><dt>当前冷却</dt><dd>${cooldown(definition.cooldown,stats.haste).toFixed(2)} 秒</dd></div><div><dt>施法时间</dt><dd>${definition.castTime||0} 秒</dd></div>${unit?`<div><dt>当前状态</dt><dd>${battle.skillReason(unit,n)}</dd></div>`:''}</dl><p>吸血 ${statText('lifeSteal',stats.lifeSteal)} · 全能吸血 ${statText('omni',stats.omni)}。吸血按实际生命伤害恢复，不计护盾吸收；伤害技能仅触发全能吸血。</p><small>${member.hero==='stone'?'示例技能已生效，数值待调整。':'通用演示技能，专属技能待设计。'}</small>${pauseNote}`;
}
function topbar(title,subtitle='',right=''){
  return `<header class="topbar"><button class="brand-mini" data-act="home" aria-label="返回首页"><span class="brand-symbol">远</span><span>小队远征</span></button><div class="topbar-title"><h1>${title}</h1>${subtitle?`<span>${subtitle}</span>`:''}</div><div class="topbar-actions">${preview?'<span class="badge preview-badge">界面预览</span>':''}${right}${btn(icon('settings'),'settings','icon-btn','aria-label="设置"')}</div></header>`;
}
function route(){if(!run){screen='home';return;}if(['initial','recruit'].includes(run.phase))screen='recruit';else if(run.phase==='shop')screen='shop';else if(['victory','defeat'].includes(run.phase))screen='result';else if(run.phase==='battle')screen='battle';else screen='ready';}
function journeyStrip(){
  const stage=screen==='recruit'?0:screen==='ready'?1:run.chest.claimed?3:2;
  const steps=[run.floor<=4?'招募同伴':'队伍就位','迎战敌人','领取宝箱','商店整备'];
  const hint=screen==='recruit'?(run.phase==='initial'?'先选择初始英雄，再招募第一位同伴':'选定后进入本层准备'):screen==='ready'?'本层目标：坚持到计时结束，再清理余敌':run.chest.claimed?(run.floor===20?'本层奖励已处理，可以完成远征':'购买或调整装备后，继续下一层'):'先从宝箱选一件装备，穿戴或出售';
  return `<div class="journey-strip"><ol aria-label="本层流程">${steps.map((label,index)=>`<li class="${index===stage?'current':index<stage?'complete':''}" ${index===stage?'aria-current="step"':''}><span>${index<stage?'✓':index+1}</span>${label}</li>`).join('')}</ol><p>${hint}</p></div>`;
}
function augmentStrip(){
  const active=AUGMENTS.find(a=>(run.augments||[]).includes(a.id));
  if(active)return `<div class="augment-strip"><div><span class="badge">旅途强化</span><b>${active.name}</b><small>本次远征持续生效</small></div>${btn('查看效果','augment-info','quiet small')}</div>`;
  if(screen!=='shop'||run.floor!==1)return '';
  return `<div class="augment-strip"><div><span class="badge">旅途强化</span><b>坚韧共鸣</b><small>${run.chest.claimed?'可选示例 · 全队生命与施法防护':'处理宝箱后可领取'}</small></div>${btn('查看并选择','augment-info','small',run.chest.claimed?'':'disabled')}</div>`;
}
function render(){
  inspection.close();closeShopPopover();
  if(screen!=='shop')shopSelection=null;
  const previousHost=screen==='battle'&&renderedBattle===battle?document.querySelector('#battle-canvas'):null;
  if(renderer&&(screen!=='battle'||renderer.battle!==battle)){renderer.destroy();renderer=null;}
  persistSettings();app.className=`app screen-${screen}`;
  const views={home:renderHome,recruit:renderRecruit,ready:renderReady,battle:renderBattle,shop:renderShop,result:renderResult};
  app.innerHTML=views[screen]();
  if(['recruit','ready','shop'].includes(screen))app.querySelector('.topbar').insertAdjacentHTML('afterend',journeyStrip());
  if(screen==='shop')app.querySelector('.shop-summary').insertAdjacentHTML('afterend',augmentStrip());
  if(screen==='ready')app.querySelector('.journey-strip').insertAdjacentHTML('afterend',augmentStrip());
  if(screen==='battle'){
    if(previousHost)document.querySelector('#battle-canvas').replaceWith(previousHost);
    renderedBattle=battle;ensureRenderer();renderer?.resize();updateBattle();
  }else renderedBattle=null;
  if(screen==='shop')markShopTargets();
  if(modal)renderModal();
}
function renderHome(){
  const members=[HEROES[3],HEROES[2],HEROES[1],HEROES[4],HEROES[0]];
  return `<div class="home-shell"><header class="home-top"><div class="wordmark"><span class="brand-symbol">远</span><b>小队远征</b><span class="edition">EARLY EXPEDITION</span></div><div class="home-top-right"><span class="build-label"><i></i> 基础试玩 · 0.2</span>${btn(icon('settings'),'settings','icon-btn','aria-label="设置"')}</div></header>
    <section class="home-content"><div class="home-copy"><span class="eyebrow"><i></i> 一支小队，二十层未知。</span><h1>小队<span>远征<span class="title-star">✦</span></span></h1><p class="home-intro">挑选你的同伴，拼出自己的打法。<br>每一次选择，都是下一场胜利的开始。</p>
      <div class="home-menu">${btn(`<span><small>NEW EXPEDITION</small>开始远征</span>${icon('arrow')}`,'new','primary start-button')}
        ${btn(`<span>继续远征 <small>${saved&&!['victory','defeat'].includes(saved.phase)?`第 ${saved.floor} / 20 层 · ${saved.party.length} 位同伴`:'暂无进行中的远征'}</small></span>${icon('play')}`,'continue','continue-button',saved&&!['victory','defeat'].includes(saved.phase)?'':'disabled')}
        <div class="home-secondary">${btn(`${icon('flag')} 浏览界面`,'preview-menu','quiet')}${btn(`${icon('info')} 玩法说明`,'help','quiet')}</div>
      </div><div class="home-note"><span class="note-line"></span>单人 · 自动战斗 · 队伍构筑</div></div>
      <div class="home-art" aria-label="五名英雄的文字占位卡片"><div class="art-orbit orbit-one"></div><div class="art-orbit orbit-two"></div><span class="art-cross cross-a">＋</span><span class="art-cross cross-b">＋</span><div class="art-caption"><span>YOUR NEXT PARTY</span><b>五种可能，一支队伍。</b></div><div class="hero-fan">${members.map((h,i)=>`<div class="fan-card fan-${i}" style="--hero:${h.color};--i:${i}"><span class="fan-number">0${i+1}</span>${portrait(h)}<div class="fan-bottom"><span>${h.role}</span><b>${h.name}</b><i></i></div></div>`).join('')}</div><div class="art-ground"></div><div class="route-track"><span>01</span>${Array.from({length:20},(_,i)=>`<i class="${i<4?'lit':''}"></i>`).join('')}<span>20</span></div><div class="art-note"><span class="tiny-diamond"></span>招募 · 装备 · 再出发</div></div></section>
    <footer class="home-footer"><span><i class="status-dot"></i> 全程本地运行 · 自动保存关卡进度</span><span>头像 / 技能 / 装备采用文字占位 <span class="footer-divider">/</span> 电脑横屏优先</span></footer></div>`;
}
function recruitCards(){return run.candidates.map((id,i)=>{const h=heroById(id),active=(selectedHero||run.candidates[0])===id;return `<button class="recruit-card ${active?'selected':''}" data-act="choose-hero" data-id="${id}" style="--hero:${h.color}"><div class="recruit-card-top"><span>候选 0${i+1}</span><span class="choice-check">${active?icon('check'):'＋'}</span></div>${portrait(h,'large')}<span class="hero-role">${h.role}</span><h2>${h.name}</h2><p>${h.description}</p><div class="tags">${h.tags.map(t=>`<span>${t}</span>`).join('')}</div><div class="candidate-stats"><span>攻击 <b>${h.stats.attack||BASE.attack}</b></span><span>法强 <b>${h.stats.power||BASE.power}</b></span><span>生命 <b>${h.stats.hp||BASE.hp}</b></span></div><div class="placeholder-skills">被动 <span>Q</span><span>W</span><span>E</span><span>R</span></div><small class="muted">${h.id==='stone'?'示例角色 · 被动与四个技能已生效':'演示角色 · 专属技能待正式设计'}</small></button>`;}).join('');}
function renderRecruit(){const initial=run.phase==='initial';return `<div class="page-shell">${topbar(initial?'选择初始英雄':'新的同伴',initial?'远征准备 / 01':`第 ${run.floor} 层准备 · 招募 ${run.floor} / 4`)}<section class="recruit-intro"><span class="eyebrow">${initial?'FIRST COMPANION':'BUILD YOUR PARTY'}</span><h2>${initial?'远征，从一位同伴开始。':'下一段路，一起走。'}</h2><p>${initial?'选择你的初始英雄。进入前四层时，还能各招募一名同伴。':'从三个随机候选中选择一位加入。英雄一旦加入，本次远征不可替换。'}</p></section><div class="recruit-grid">${recruitCards()}</div><footer class="page-bottom"><div class="party-mini"><span>当前队伍 <b>${run.party.length}/5</b></span>${run.party.map(m=>`<span class="mini-name" style="--hero:${heroById(m.hero).color}">${heroById(m.hero).name}</span>`).join('')}${!run.party.length?'<small class="muted">等待第一位同伴</small>':''}</div>${btn(`确认选择 · ${heroById(selectedHero||run.candidates[0]).name} ${icon('arrow')}`,'confirm-hero','primary')}</footer></div>`;}
function renderReady(){return `<div class="page-shell">${topbar('准备出发',`第 ${run.floor} / 20 层` ,gold(run.gold))}<section class="ready-intro"><span class="eyebrow">EXPEDITION ${String(run.floor).padStart(2,'0')}</span><h2>${run.floor%5===0?'前方，有守门人在等待。':'队伍就位，准备迎战。'}</h2><p>坚守 ${RULES.roundSeconds} 秒，随后清理场上剩余敌人。击败怪物获得金币。</p></section><div class="ready-party">${[...run.party].reverse().map((m,i)=>{const h=heroById(m.hero);return `<div class="ready-hero" style="--hero:${h.color}"><span class="slot-label">${run.party.length-i} 号位</span>${portrait(h,'large')}<h3>${h.name}</h3><span>${h.role} · Lv.${run.level}</span></div>`;}).join('')}</div><div class="ready-direction">后排 <span>──────────────────────</span> 前排 →</div><div class="ready-actions"><span class="muted">装备和站位只能在战后商店调整</span>${btn(`进入第 ${run.floor} 层 ${icon('arrow')}`,'start-battle','primary large-button')}</div><p class="prototype-note">磐石已接入示例技能，其余英雄暂用通用技能，数值后续调整。</p></div>`;}
function skillButtons(member,index,combat=false){return `<div class="skills"><button class="skill passive" data-inspect="passive" data-act="passive" data-hero="${index}"><b>被</b><small>被动</small></button>${skillsFor(member.hero).map((s,n)=>`<button class="skill ${n===3?'ultimate':''}" data-inspect="skill" data-act="skill" data-hero="${index}" data-skill="${n}" ${combat?`data-cooldown="${index}-${n}"`:''} aria-label="${heroById(member.hero).name} ${s.key} ${s.name}"><b>${s.key}</b><small>${combat?'就绪':s.name}</small><i class="cool-mask"></i></button>`).join('')}</div>`;}
function gearButtons(member,index){return `<div class="gear-row"><span>装备</span>${member.gear.map((item,slot)=>`<button class="gear-slot ${item?'filled':''}" ${screen==='shop'&&item?'data-drag="gear"':''} ${item?'data-inspect="gear"':''} data-act="gear" data-hero="${index}" data-slot="${slot}" ${item?`style="--rarity:${RARITIES.find(r=>r.id===item.rarity).color}"`:''} aria-label="${heroById(member.hero).name} 装备槽 ${slot+1}${item?' '+escape(item.name):' 空'}">${item?escape(item.mark):'＋'}</button>`).join('')}</div>`;}
function heroPanels(shop=false){return (screen==='battle'?[selectedUnit]:Array.from({length:5},(_,i)=>4-i)).map(index=>{
  const m=run.party[index];if(!m)return `<div class="hero-panel vacant"><span>0${index+1}</span><b>等待同伴</b><small>前四层开始前招募</small></div>`;
  const h=heroById(m.hero);return `<article data-unit="${index}" class="hero-panel ${selectedUnit===index?'selected':''}" style="--hero:${h.color}"><div class="hero-panel-heading">${screen==='battle'?`<span class="detail-portrait" aria-hidden="true">${escape(h.name)}</span><span class="detail-position">${index+1} 号位 · ${h.role}</span>`:''}<button ${shop?'data-drag="hero"':''} data-act="select-unit" data-hero="${index}" class="hero-name"><b>${h.name}</b><small>Lv.${run.level}</small></button>${screen==='battle'?`<p class="hero-description">${escape(h.description)}</p>`:''}${shop?`<span class="orange-count">${index+1} 号位 · 橙装 ${m.gear.filter(i=>i?.rarity==='orange').length}/1</span>`:`<button class="auto-toggle ${m.auto?'on':''}" data-act="auto" data-hero="${index}" aria-pressed="${m.auto}">R <i></i><span>${m.auto?'自动':'手动'}</span></button>`}${screen==='battle'?`<button class="btn cast-ultimate" data-act="cast-ultimate" data-hero="${index}" ${m.auto?'hidden':''}>释放大招</button>`:''}</div>${screen==='battle'?`<div class="mobile-resources" data-resources="${index}"></div>`:''}${skillButtons(m,index,!shop&&screen==='battle')}${gearButtons(m,index)}${statGrid(screen==='battle'?battle.party[index].stats:M.statsFor(m,run.level,run.augments))}${screen==='battle'?`<div class="attribute-control">${btn(`${attributePage==='primary'?'主要':'次要'}属性 ${icon('swap')}`,'attributes','small quiet attribute-toggle')}</div>`:''}${screen==='battle'?`<div class="unit-statuses" data-statuses="${index}" aria-label="${h.name}当前状态"></div>`:''}${shop?`<small class="gear-hint">拖动名字换位 · 点击装备查看</small>`:''}</article>`;
  }).join('');}
function selectBattleHero(index){
  if(!battle?.party[index])return;
  selectedUnit=index;commandArmed=battle.party[index].hp>0;mobileView='loadout';render();
}
function selectBattleEnemy(index){
  const unit=battle?.enemies[index];if(!unit)return;
  selectedEnemy=index;if(compactBattle.matches)mobileView='enemy';
  if(commandArmed&&unit.hp>0&&!battlePaused()){
    if(battle.commandTarget(selectedUnit,unit.id)){save();toast(`优先 ${index+1} 号及邻位 · 已保存`);}
    commandArmed=false;
  }
  render();
}
function tacticsPanel(){
  const unit=battle.party[selectedUnit],t=unit.tactics,p=t.preferredSlot;
  const neighbors=p===null?[]:[p-1,p+1].filter(n=>n>=0&&n<5).map(n=>n+1);
  return `<div class="tactics"><span>攻击优先级</span><div class="target-modes" role="group" aria-label="选敌策略">${TARGET_MODES.map(m=>btn(m.name,'target-mode','small',`data-mode="${m.id}" aria-pressed="${t.mode===m.id}" ${unit.hp<=0?'disabled':''}`)).join('')}</div><div class="target-preference"><span id="target-preference">${p===null?'全场自动选敌':`优先位置 ${p+1} · 邻近 ${neighbors.join(' / ')}`}</span><span id="actual-target"></span>${btn('清除偏好','clear-target','small quiet',p===null?'disabled':'')}</div></div>`;
}
function enemyDetail(){
  const unit=battle.enemies[selectedEnemy];
  return `<section class="enemy-detail" aria-label="敌人详情"><header><span class="enemy-portrait" id="enemy-portrait" aria-hidden="true"></span><div><span class="eyebrow">敌方情报</span><h2 id="enemy-name"></h2></div>${btn('仅查看','inspect-enemy','small quiet','aria-label="取消下令，仅查看敌人"')}</header><nav class="enemy-selector" aria-label="查看或指定敌位">${battle.enemies.map((u,i)=>btn(`${i+1} 号`,'select-enemy','small',`data-index="${i}" aria-pressed="${i===selectedEnemy}"`)).join('')}</nav><div id="enemy-resources"></div><div id="enemy-stats"></div><div class="enemy-bottom"><div id="enemy-skills"></div><div class="enemy-reward"><small>击杀奖励</small><b id="enemy-reward"></b></div></div><small id="enemy-note"></small></section>`;
}
function renderBattle(){
  if(!battle.party[selectedUnit])selectedUnit=0;
  challengeRevision=-1;
  return `<div class="battle-shell battle-v2" data-mobile-view="${mobileView}">${topbar(`第 ${run.floor} <span class="muted">/ 20 层</span>`,'小队战术',`<span class="battle-clock" id="battle-clock"></span>${gold(run.gold+battle.gold)}${(run.augments||[]).length?btn('强化','augment-info','quiet small'):''}${btn(`${icon('pause')}<span class="pause-label">暂停</span>`,'pause','icon-btn','aria-label="暂停战斗"')}`)}
  <section class="challenge-strip" aria-label="挑战传送带"><div class="challenge-heading"><span class="eyebrow">可选挑战</span><h2>挑战传送带</h2><small>点击加入后续刷新</small><b id="spawn-countdown"></b></div><div id="challenge-offers" class="challenge-offers"></div><div class="challenge-queue"><header>待入场 <span id="queue-count"></span></header><div id="challenge-queue"></div></div></section>
  <span id="battle-pause-note" role="status" hidden></span><div class="portrait-battle"><b>请横屏查看完整战场</b><p>战斗已暂停，横屏后点击继续。</p></div>${orientationPaused?btn('继续战斗','resume-orientation','orientation-resume primary',portraitBattle()?'disabled':''):''}
  <div id="battle-canvas" class="phaser-arena" role="group" aria-label="自动战斗场景"></div>
  <div class="battle-footnote"><span id="battle-event"></span><span><b id="battle-phase"></b> · 击败 <b id="battle-kills"></b></span></div>
  <div class="battle-details"><section class="squad-section"><nav class="hero-selector" aria-label="选择英雄">${Array.from({length:5},(_,i)=>4-i).map(i=>run.party[i]?`<button data-act="select-unit" data-hero="${i}" aria-pressed="${i===selectedUnit}">${heroById(run.party[i].hero).name}<small data-r-ready="${i}">R</small></button>`:`<span>等待同伴</span>`).join('')}</nav>
  <div class="detail-tools"><span id="command-hint" role="status">${commandArmed?'请点击敌人指定优先位置 · Esc 取消':'点击英雄，再点击敌人指定优先位置'}</span><div class="mobile-detail-tabs">${btn('技能 / 装备','detail-loadout','small',`aria-pressed="${mobileView==='loadout'}"`)}${btn('属性','detail-stats','small',`aria-pressed="${mobileView==='stats'}"`)}${btn('战术','detail-tactics','small')}${btn('敌人','detail-enemy','small')}</div></div>
  <div class="hero-panels">${heroPanels()}</div>${tacticsPanel()}</section>${enemyDetail()}</div></div>`;
}
function updateChallenges(){
  const active=battle.phase==='combat';
  document.querySelector('#spawn-countdown').textContent=active?`下次补怪 ${Math.max(0,(battle.nextSpawn-battle.tick)*STEP).toFixed(1)}s`:'已停止补怪';
  if(challengeRevision!==battle.challengeRevision){
    challengeRevision=battle.challengeRevision;
    document.querySelector('#challenge-offers').innerHTML=battle.challengeOffers.map(o=>`<article class="challenge-card"><div class="challenge-mark">${escape(o.type.name)}</div><div><b>${o.type.name}</b><small>${o.type.role} · ${o.type.positions.map(n=>n+1).join('/')} 位</small><span>击杀 +${o.type.reward} 金币</span></div><button class="btn small" data-act="accept-challenge" data-id="${o.id}" aria-label="加入挑战 ${o.type.name}">加入</button><small data-offer-time="${o.id}"></small></article>`).join('')||'<p class="queue-empty">清场中 · 不再接受挑战</p>';
    document.querySelector('#challenge-queue').innerHTML=battle.pendingChallenges.map(o=>`<div class="queued-challenge"><span class="queue-mark" aria-hidden="true">${o.type.mark}</span><span><b>${o.type.name}</b><small>${o.type.positions.map(n=>n+1).join('/')} 位 · 等待补怪/空位</small></span>${btn('×','cancel-challenge','quiet small',`data-id="${o.id}" aria-label="取消 ${o.type.name}"`)}</div>`).join('')||'<span class="queue-empty">暂无挑战 · 可自由选择</span>';
  }
  document.querySelector('#queue-count').textContent=`${battle.pendingChallenges.length}/${battle.tuning.queueLimit}`;
  for(const offer of battle.challengeOffers){const label=document.querySelector(`[data-offer-time="${offer.id}"]`);if(label)label.textContent=`${Math.max(0,(offer.expiresAt-battle.tick)*STEP).toFixed(0)}s 后离开`;}
  for(const button of document.querySelectorAll('[data-act="accept-challenge"]'))button.disabled=!active||battle.pendingChallenges.length>=battle.tuning.queueLimit;
}
function updateEnemyDetail(){
  const unit=battle.enemies[selectedEnemy],alive=unit.hp>0;
  document.querySelector('#enemy-portrait').textContent=alive?unit.name:'空位';
  document.querySelector('#enemy-name').textContent=`${unit.slot+1} 号位 · ${alive?unit.name:'空位'}`;
  document.querySelector('#enemy-resources').innerHTML=alive?`<div class="enemy-resource-row"><span>生命</span><i class="detail-meter health"><i style="width:${Math.max(0,Math.min(100,unit.hp/unit.stats.hp*100))}%"></i></i><b>${Math.ceil(unit.hp)} / ${Math.round(unit.stats.hp)}</b><span class="detail-shield">护盾 ${Math.ceil(unit.shield)}</span></div><div class="enemy-resource-row"><span>法力</span><i class="detail-meter mana"><i style="width:${Math.max(0,Math.min(100,unit.mana/Math.max(1,unit.stats.mana)*100))}%"></i></i><b>${Math.floor(unit.mana)} / ${Math.round(unit.stats.mana)}</b></div>`:'死亡留空 · 等待推荐位置相符的怪物';
  document.querySelector('#enemy-stats').innerHTML=alive?['attack','attackSpeed','armor','resist'].map(k=>`<span>${STAT_LABELS[k]} <b>${statText(k,unit.stats[k])}</b></span>`).join(''):'';
  const markup=alive?(unit.skills.length?unit.skills.map((skill,i)=>`<button class="skill" data-act="enemy-skill" data-inspect="enemy-skill" data-enemy-id="${unit.id}" data-skill="${i}"><b>${skill.key}</b><small>${escape(skill.name)}</small></button>`).join(''):'<span class="muted">普通攻击</span>'):'';
  const skillRoot=document.querySelector('#enemy-skills');if(skillRoot.dataset.unit!==`${unit.id}:${alive}`){skillRoot.innerHTML=markup;skillRoot.dataset.unit=`${unit.id}:${alive}`;}
  document.querySelector('#enemy-reward').textContent=alive?`+${unit.reward} 金币`:'—';
  document.querySelector('#enemy-note').textContent=commandArmed?'下次点击敌人会保存优先位置；“仅查看”可取消下令。':alive?`${unit.def.role} · ${unit.challenge?'已接受的挑战':'常规敌人'} · 查看技能说明会暂停`:'编号不变，存活怪物不会向前移动。';
  for(const button of document.querySelectorAll('.enemy-selector button')){const u=battle.enemies[Number(button.dataset.index)];button.textContent=`${u.slot+1}${u.hp<=0?' 空':' 号'}`;}
  const hero=battle.party[selectedUnit],target=battle.find(hero.targetId);
  document.querySelector('#actual-target').textContent=`当前目标 ${target?.hp>0?target.slot+1:'—'}`;
}
async function ensureRenderer(){
  if(!battle||screen!=='battle'||renderer?.battle===battle||loadingBattle===battle)return;
  const expected=battle;loadingBattle=expected;
  try{
    const [{PhaserBattleRenderer}]=await Promise.all([import('./renderer/PhaserBattleRenderer.ts'),document.fonts.load('20px "Expedition Serif"'),document.fonts.load('700 20px "Expedition Serif"')]);
    if(screen!=='battle'||battle!==expected)return;
    renderer=new PhaserBattleRenderer(document.querySelector('#battle-canvas'),expected,{
      advance:advanceBattle,selected:()=>selectedUnit,select:selectBattleHero,selectedEnemy:()=>selectedEnemy,selectEnemy:selectBattleEnemy,cancelCommand:()=>{if(commandArmed){commandArmed=false;render();}},
      motion:()=>settings.motion,paused:battlePaused,compact:()=>compactBattle.matches,
    });
  }catch(error){
    if(screen==='battle'&&battle===expected){
      const host=document.querySelector('#battle-canvas');host.dataset.error='true';
      host.innerHTML=`<div class="engine-error"><p>战场未能载入，请重试。</p>${btn('重新载入战场','retry-engine','primary')}</div>`;
      toast('战场引擎载入失败，关卡进度尚未推进。');console.error(error);
    }
  }finally{if(loadingBattle===expected)loadingBattle=null;}
}
function updateBattle(){
  if(!battle||screen!=='battle')return;
  document.querySelector('#battle-clock').textContent=battle.phase==='cleanup'?'清场中':`${Math.floor(battle.remaining/60).toString().padStart(2,'0')}:${Math.ceil(battle.remaining%60).toString().padStart(2,'0')}`;
  document.querySelector('#battle-phase').textContent=battle.phase==='cleanup'?'停止补位 · 清理剩余敌人':'限时战斗';
  document.querySelector('#battle-kills').textContent=battle.kills;
  const goldLabel=app.querySelector('.topbar-actions .gold');if(goldLabel)goldLabel.lastChild.textContent=run.gold+battle.gold;
  const hint=document.querySelector('#command-hint');hint.textContent=commandArmed?'请点击敌人指定优先位置 · Esc 取消':'点击英雄，再点击敌人指定优先位置';
  for(const button of document.querySelectorAll('[data-act="target-mode"]'))button.disabled=battle.party[selectedUnit].hp<=0;
  updateChallenges();updateEnemyDetail();
  document.querySelector('#battle-event').textContent=battle.feed[0]?.text||'';
  for(const [index,unit] of battle.party.entries()) {
    const panel=document.querySelector(`[data-unit="${index}"]`);
    const r=document.querySelector(`[data-r-ready="${index}"]`);if(r)r.textContent=`R ${battle.skillReason(unit,3)}`;
    if(!panel)continue;
    for(const label of panel.querySelectorAll('[data-stat]')) {
      const value=statText(label.dataset.stat,unit.stats[label.dataset.stat]);if(label.textContent!==value)label.textContent=value;
    }
    const resources=panel.querySelector('[data-resources]');
    if(resources)resources.textContent=`生命 ${Math.ceil(unit.hp)}/${Math.round(unit.stats.hp)} +${Number((unit.stats.hpRegen*(1+unit.stats.healing)).toFixed(1))}/s · 法力 ${Math.floor(unit.mana)}/${Math.round(unit.stats.mana)} +${Number(unit.stats.manaRegen.toFixed(1))}/s · 盾 ${Math.ceil(unit.shield)}`;
    const cast=panel.querySelector('[data-act="cast-ultimate"]'),reason=battle.skillReason(unit,3);
    cast.hidden=unit.auto;cast.disabled=reason!=='就绪';cast.textContent=reason==='就绪'?'释放大招':`R · ${reason}`;

    const statusElement=panel.querySelector('[data-statuses]');
    const statuses=[...unit.statuses.values()];
    const text=statuses.length?statuses.map(s=>`${s.definition.name}${s.stacks>1?` ×${s.stacks}`:''} ${Math.max(0,(s.expiresAt-battle.tick)*STEP).toFixed(1)}s`).join(' · '):'无临时状态';
    if(statusElement.textContent!==text){statusElement.textContent=text;statusElement.title=text;}
  }
  for(const [i,unit]of battle.party.entries())for(let n=0;n<4;n++){
    const button=document.querySelector(`[data-cooldown="${i}-${n}"]`);if(!button)continue;
    const reason=battle.skillReason(unit,n);button.querySelector('small').textContent=reason;button.classList.toggle('ready',reason==='就绪');
    const skill=battle.getSkill(unit,n);const total=Math.max(1,Math.ceil(skill.cooldown/(1+unit.stats.haste/100)/STEP));button.querySelector('.cool-mask').style.height=`${Math.max(0,Math.min(100,100*(unit.ready[n]-battle.tick)/total))}%`;

  }

}
function offerCard(item,index,source='shop'){
  if(!item)return `<div class="offer sold"><span>${icon('check')}</span><h3>已购入</h3><p>刷新可补充商品</p></div>`;
  const selected=shopSelection?.type==='offer'&&shopSelection.source===source&&shopSelection.uid===item.uid;
  return `<article class="offer ${selected?'chosen':''}" data-offer="${item.uid}" style="--rarity:${RARITIES.find(r=>r.id===item.rarity).color}"><button class="offer-select" data-inspect="offer" data-act="select-offer" data-source="${source}" data-index="${index}" aria-pressed="${selected}">${itemInfo(item).replace('class="item-box ',`data-drag="offer" data-source="${source}" data-index="${index}" class="item-box `)}</button><div class="offer-bottom">${btn(icon('info'),'inspect-offer','icon-btn offer-info',`data-inspect="offer" data-source="${source}" data-index="${index}" aria-label="查看 ${escape(item.name)}"`)}${source==='shop'?gold(item.price):'<span class="badge">免费 · 三选一</span>'}${source==='chest'?btn(`${icon('refresh')} 刷新此项`,'refresh-chest','quiet small',`data-index="${index}" ${run.chest.refreshUsed?'disabled':''}`):'<small class="muted">点击选择 · 拖动图标穿戴</small>'}</div></article>`;
}
function selectionHint(){
  if(!shopSelection)return '点击装备后选择槽位，或拖动装备图标；拖动英雄名字交换站位。';
  if(shopSelection.type==='hero')return `已选择 ${heroById(run.party[shopSelection.hero].hero).name} · 点击另一位英雄的名字交换站位`;
  const item=shopSelection.type==='offer'?M.getOffer(run,shopSelection.source,shopSelection.index):run.party[shopSelection.hero].gear[shopSelection.slot];
  return `已选择 ${item.name} · 点击或拖到装备槽${shopSelection.type==='gear'?'，占用槽可交换':'，占用槽先预览替换'}`;
}
function renderShop(){
  const chest=!run.chest.claimed;
  return `<div class="shop-shell">${topbar(chest?'领取宝箱':'战后商店',`第 ${run.floor} 层已完成 · ${run.floor===20?'远征终点':`下一层 ${run.floor+1} / 20`}`,gold(run.gold))}<div class="shop-summary"><span>${icon('check')} 第 ${run.floor} 层通关</span><span>击败 <b>${run.lastRound?.kills||0}</b> 个敌人</span><span>获得 ${gold(run.lastRound?.gold||0)}</span><span>队伍等级 <b>Lv.${run.level}</b></span></div><section class="shop-stock"><div class="section-heading"><div><h2>${chest?'宝箱 · 三选一':'旅途补给'}</h2><span>${chest?'选一件，直接交给下方英雄':'点击选择，也可以拖动装备图标'}</span></div>${chest?`<span class="badge">单项刷新 ${run.chest.refreshUsed?0:1} / 1</span>`:btn(`${icon('refresh')} 刷新 ${gold(M.refreshCost(run))}`,'refresh-shop','small',run.gold<M.refreshCost(run)?'disabled title="金币不足"':'')}</div><div class="offer-grid ${chest?'chest-choices':''}">${(chest?run.chest.options:run.shop).map((item,i)=>offerCard(item,i,chest?'chest':'shop')).join('')}</div></section><div class="selection-toolbar"><p id="shop-guidance" role="status" aria-live="polite">${escape(selectionHint())}</p><div>${shopSelection?btn('取消选择','cancel-selection','quiet small'):''}${shopSelection?.type==='offer'&&shopSelection.source==='chest'?btn(`出售所选 +${M.salePrice(M.getOffer(run,'chest',shopSelection.index))} 金币`,'sell-reward','small'):''}</div></div><section class="shop-party"><div class="section-heading"><div><h2>我的队伍</h2><span>后排 → 前排 · 每人四槽，最多一件橙装</span></div><div>${btn('交换站位','formation','small quiet')}${btn(`切换：${attributePage==='primary'?'次要':'主要'}属性`,'attributes','small quiet')}</div></div><div class="hero-panels">${heroPanels(true)}</div></section><footer class="shop-footer"><div class="chest-entry ${chest?'':'claimed'}"><span class="chest-symbol">${icon(chest?'chest':'check')}</span><div><b>${chest?'选择本层宝箱奖励':'本层奖励已领取'}</b><small>${chest?'穿戴或出售后进入商店':'整备完成后，继续出发'}</small></div></div>${btn(`${run.floor===20?'完成远征':`进入第 ${run.floor+1} 层`} ${icon('arrow')}`,'next','primary',chest?'disabled title="请先处理宝箱奖励"':'')}</footer></div>`;
}
function closeShopPopover(restore=false){
  const anchor=shopPopover?.anchor;shopPopover=null;popoverRoot.innerHTML='';
  if(restore)document.querySelector(anchor)?.focus();
}
function clearShopSelection(){shopSelection=null;closeShopPopover();}
function selectOffer(source,index){
  const item=M.getOffer(run,source,index);shopSelection={type:'offer',source,index,uid:item.uid};render();
}
function validSelection(){
  if(screen!=='shop'||run.phase!=='shop'||!shopSelection)return false;
  if(shopSelection.type==='offer')return M.getOffer(run,shopSelection.source,shopSelection.index).uid===shopSelection.uid;
  if(shopSelection.type==='gear')return run.party[shopSelection.hero]?.gear[shopSelection.slot]?.uid===shopSelection.uid;
  return run.party[shopSelection.hero]?.hero===shopSelection.id;
}
function slotReason(hero,slot){
  if(!shopSelection||shopSelection.type==='hero')return '';
  try{return shopSelection.type==='offer'?M.previewAcquisition(run,shopSelection.source,shopSelection.index,hero,slot).reason:M.previewTransfer(run,shopSelection.hero,shopSelection.slot,hero,slot).reason;}catch{return '装备已变化，请重新选择';}
}
function markShopTargets(){
  if(screen!=='shop')return;
  for(const button of app.querySelectorAll('.gear-slot')){
    const active=shopSelection&&shopSelection.type!=='hero',reason=active?slotReason(Number(button.dataset.hero),Number(button.dataset.slot)):'';
    button.classList.toggle('can-receive',!!active&&!reason);button.classList.toggle('cannot-receive',!!active&&!!reason);
    button.dataset.blocked=reason;button.setAttribute('aria-disabled',String(!!reason));
    if(active)button.title=reason||'空槽直接穿戴；占用槽显示对比';
  }
  for(const panel of app.querySelectorAll('.hero-panel[data-unit]'))panel.classList.toggle('formation-target',shopSelection?.type==='hero');
  for(const offer of app.querySelectorAll('[data-offer]'))offer.classList.toggle('chosen',shopSelection?.type==='offer'&&offer.dataset.offer===shopSelection.uid);
  const hint=document.querySelector('#shop-guidance');if(hint)hint.textContent=selectionHint();
}
function completeShopAction(message){clearShopSelection();save();render();toast(message);}
function statChanges(changes){return `<div class="stat-changes">${changes.length?changes.map(c=>`<div class="${c.after>c.before?'increase':'decrease'}"><span>${STAT_LABELS[c.key]}</span><span>${statText(c.key,c.before)} → <b>${statText(c.key,c.after)}</b></span></div>`).join(''):'<small class="muted">属性不变</small>'}</div>`;}
function showShopPopover(value,title,body,footer){
  inspection.close();closeShopPopover();shopPopover={...value,anchor:`[data-act="gear"][data-hero="${value.hero}"][data-slot="${value.slot}"]`};
  popoverRoot.innerHTML=`<section class="shop-popover ${value.type==='compare'?'compare-popover':''}" role="dialog" aria-modal="false" aria-label="${title}"><header><b>${title}</b>${btn(icon('cross'),'close-popover','icon-btn','aria-label="关闭装备窗口"')}</header><div class="popover-content">${body}</div><footer>${footer}</footer></section>`;
  const el=popoverRoot.firstElementChild,anchor=document.querySelector(shopPopover.anchor).getBoundingClientRect(),rect=el.getBoundingClientRect();
  el.style.left=`${Math.max(8,Math.min(innerWidth-rect.width-8,anchor.left))}px`;
  el.style.top=`${Math.max(8,Math.min(innerHeight-rect.height-8,anchor.top-rect.height-10>=8?anchor.top-rect.height-10:anchor.bottom+10))}px`;
  el.querySelector('button').focus({preventScroll:true});
}
function showGear(hero,slot){
  const item=run.party[hero].gear[slot];if(!item){toast('选择上方装备，或将装备图标拖到这里');return;}
  showShopPopover({type:'gear',hero,slot,uid:item.uid},'装备详情',itemInfo(item)+`<small class="muted">${heroById(run.party[hero].hero).name} · 第 ${slot+1} 槽</small>`,btn('转移 / 交换','transfer','quiet small')+btn(`出售 +${M.salePrice(item)} 金币`,'sell-gear','small'));
}
function placeSelection(hero,slot){
  if(!validSelection())throw new Error('请选择有效装备');
  const selection={...shopSelection};if(selection.type==='hero')return;
  if(selection.type==='gear'&&selection.hero===hero&&selection.slot===slot){clearShopSelection();render();return;}
  const quote=selection.type==='offer'?M.previewAcquisition(run,selection.source,selection.index,hero,slot):M.previewTransfer(run,selection.hero,selection.slot,hero,slot);
  if(quote.reason){toast(quote.reason);return;}
  if(quote.old){
    const changes=selection.type==='offer'?statChanges(quote.changes):quote.changes.map(c=>`<p>${heroById(c.hero).name}</p>${statChanges(c.stats)}`).join('');
    const totals=selection.type==='offer'?`<p class="transaction-total">旧装备 +${quote.refund} · 购买 −${quote.cost}<br>交易后金币 <b>${quote.goldAfter}</b></p>`:'<p class="muted">双方装备交换，不消耗金币。</p>';
    showShopPopover({type:'compare',hero,slot,selection,oldUid:quote.old.uid},selection.type==='offer'?'确认替换装备':'确认交换装备',`<div class="comparison"><div><small>原装备</small>${itemInfo(quote.old)}</div><span>→</span><div><small>${selection.type==='offer'?'新装备':'移入装备'}</small>${itemInfo(quote.item)}</div></div>${changes}${totals}`,btn('取消','close-popover','quiet small')+btn('确认','confirm-acquire','primary small'));
  }else commitPlacement(selection,hero,slot);
}
function commitPlacement(selection,hero,slot){
  shopSelection=selection;if(!validSelection())throw new Error('装备已变化，请重新选择');
  if(selection.type==='offer')M.acquire(run,selection.source,selection.index,hero,slot);
  else M.transferGear(run,selection.hero,selection.slot,hero,slot);
  completeShopAction(selection.type==='offer'?'装备已穿戴':'装备位置已更新');
}
function chooseHeroPosition(hero){
  if(shopSelection?.type==='hero'&&validSelection()){
    const from=shopSelection.hero;M.swapHeroes(run,from,hero);selectedUnit=hero;completeShopAction(from===hero?'已取消换位':'英雄站位已交换');
  }else {shopSelection={type:'hero',hero,id:run.party[hero].hero};render();}
}
function renderResult(){const won=run.phase==='victory';return `<div class="page-shell result-shell">${topbar('远征记录','每一段旅途，都有自己的答案。')}<section class="result-content"><div class="result-emblem ${won?'won':''}">${icon(won?'flag':'chest')}</div><span class="eyebrow">${won?'EXPEDITION COMPLETE':'UNTIL NEXT TIME'}</span><h2>${won?'远征，圆满落幕。':'这次，就走到这里。'}</h2><p>${won?'二十层挑战已完成。带着这次的经验，再试一种不同的组合吧。':'同伴们暂时倒下了。下一次选择，也许会带来新的可能。'}</p><div class="result-stats"><div><small>到达层数</small><b>${run.floor}<span> / 20</span></b></div><div><small>击败敌人</small><b>${run.kills}</b></div><div><small>击杀金币</small><b>${run.earned}</b></div><div><small>队伍等级</small><b>${run.level}</b></div></div><div class="result-party">${run.party.map(m=>portrait(heroById(m.hero))).join('')}</div><div class="result-actions">${btn('返回首页','home','quiet')}${btn(`再次远征 ${icon('arrow')}`,'new','primary')}</div></section></div>`;}

function openModal(value){closeShopPopover();previousFocus=document.activeElement;modal=value;inspection.close();renderModal();app.inert=true;}
function closeModal(){const retainPause=paused&&modal?.type!=='pause';if(modal?.type==='pause')paused=false;modal=null;modalRoot.innerHTML='';app.inert=false;previousFocus?.isConnected&&previousFocus.focus();syncPause();if(retainPause&&screen==='battle')openModal({type:'pause'});}
function modalFrame(title,body,footer='',cls=''){return `<div class="modal-backdrop"><section class="modal ${cls}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><div><span class="eyebrow">SQUAD EXPEDITION</span><h2 id="modal-title">${title}</h2></div>${btn(icon('cross'),'close','icon-btn','aria-label="关闭弹窗"')}</header><div class="modal-body">${body}</div>${footer?`<footer class="modal-footer">${footer}</footer>`:''}</section></div>`;}
function renderModal(){
  let html='';
  if(modal.type==='augment'){
    const augment=AUGMENTS[0],active=(run.augments||[]).includes(augment.id);
    html=modalFrame('旅途强化',`<div class="augment-detail"><span class="badge">${active?'已启用':'示例强化'}</span><h3>${augment.name}</h3><p>${augment.description}</p><small class="muted">作用于本次远征的所有英雄，后招募的同伴同样生效。名称与数值后续可调整。</small></div>`,active?btn('返回','close','primary'):btn('暂不选择','close','quiet')+btn('启用本次远征','choose-augment','primary',`data-id="${augment.id}" ${run.phase==='shop'&&run.floor===1&&run.chest.claimed?'':'disabled'}`));
  }
  if(modal.type==='settings')html=modalFrame('设置',`<p class="muted">偏好设置会保存在当前浏览器。</p><div class="setting-row"><div><b>界面与战斗动效</b><small>关闭后减少过渡动画和弹道效果，结算保持不变。</small></div><button class="switch ${settings.motion?'on':''}" data-act="toggle-motion" role="switch" aria-checked="${settings.motion}" aria-label="界面与战斗动效"><i></i></button></div><div class="setting-info"><b>存档方式</b><p>关卡之间自动保存。若在战斗中退出，继续游戏会从该关开战前恢复。</p><b>显示方式</b><p>电脑与手机横屏战斗；英雄、技能与装备均使用文字占位。手机竖屏请旋转后继续。</p></div>`,btn('完成','close','primary'));
  if(modal.type==='help')html=modalFrame('远征手册',`<ol class="help-steps"><li><b>组建小队</b><p>选择初始英雄，第 1–4 层开始前各三选一招募一位。队伍最多五人，英雄不能替换。</p></li><li><b>坚守与清场</b><p>限时自动战斗。敌人倒下后 2 秒补位；时间到后停止补位，消灭余敌即可通关。金币来自击杀。</p></li><li><b>领取与搭配</b><p>战后宝箱三选一，允许刷新其中一个选项一次。商店可购买、刷新、出售和转移装备。没有背包，每人四槽、最多一件橙装。</p></li><li><b>再出发</b><p>通向二十层终点。原型中的英雄技能、属性、装备和价格是演示配置，后续再正式设计。</p></li></ol>`,btn('准备好了','close','primary'));
  if(modal.type==='preview-menu')html=modalFrame('浏览界面',`<p class="muted">载入独立演示数据，不会覆盖你的远征存档。</p><div class="preview-grid">${[['recruit','英雄招募','随机候选 · 三选一'],['battle','战斗界面','五对五 · 演示自动战斗'],['shop','战后商店','购买 · 装备 · 站位'],['chest','宝箱奖励','三选一 · 单项刷新'],['result','远征结算','结束记录 · 再次出发']].map(([id,name,desc])=>`<button data-act="preview" data-page="${id}"><b>${name} ${icon('arrow')}</b><small>${desc}</small></button>`).join('')}</div>`);
  if(modal.type==='confirm-new')html=modalFrame('开始新的远征？','<p>当前进行中的远征存档会被替换。</p>',btn('取消','close','quiet')+btn('开始新远征','force-new','primary'));
  if(modal.type==='pause')html=modalFrame('稍作休整',`<div class="pause-message"><b>第 ${run.floor} 层 · ${Math.ceil(battle.remaining)} 秒</b><p>战斗已暂停。可以继续战斗，或返回首页。</p><small class="muted">返回首页后，本关将从开战前重新开始。</small></div>`,btn('返回首页','leave-battle','quiet')+btn(`${icon('play')} 继续战斗`,'close','primary'));
  if(modal.type==='gear')html=modalFrame('装备详情',itemInfo(run.party[modal.hero].gear[modal.slot]),btn('关闭','close','quiet'));
  if(modal.type==='info')html=modalFrame(modal.title,`<p class="info-copy">${escape(modal.text)}</p>`,btn('明白了','close','primary'));
  modalRoot.innerHTML=html;app.inert=true;renderer?.syncPause();queueMicrotask(()=>modalRoot.querySelector('button:not(:disabled)')?.focus());
}
function beginNew(){closeModal();preview=false;run=M.createRun();selectedHero=null;battle=null;save();route();render();}
function goHome(){closeModal();battle=null;paused=false;run=null;preview=false;screen='home';render();}
function startBattle(){commandArmed=false;selectedEnemy=0;selectedUnit=0;mobileView='loadout';orientationPaused=portraitBattle();run.phase='battle';save();battle=new Battle(run);screen='battle';paused=false;accumulator=0;lastFrame=performance.now();render();}
function previewPage(page){
  clearShopSelection();closeModal();preview=true;run=M.createRun(70891);M.recruit(run,run.candidates[0]);M.recruit(run,run.candidates[0]);
  if(page==='recruit'){run.floor=2;run.phase='recruit';run.candidates=M.sample(run,HEROES.map(h=>h.id).filter(id=>!run.party.some(h=>h.hero===id)),3);selectedHero=null;route();render();return;}
  for(const h of HEROES)if(run.party.length<5&&!run.party.some(m=>m.hero===h.id))run.party.push({hero:h.id,gear:[null,null,null,null],auto:true});
  run.floor=4;run.level=3;run.party.forEach((h,i)=>{h.gear[0]=M.makeItem(run,i%4);h.gear[1]=M.makeItem(run,1);});
  if(page==='battle'){run.augments=[AUGMENTS[0].id];for(const [hero,base] of [['stone','rune'],['wind','clock'],['shade','armor']]){const member=run.party.find(m=>m.hero===hero);if(member)member.gear[0]=M.makeItem(run,5,base);}startBattle();return;}
  M.finishRound(run,{won:true,gold:128,kills:42,seconds:25});
  if(page==='result'){run.floor=20;run.phase='victory';}
  if(page==='shop')run.chest.claimed=true;
  route();render();
}
function act(event){const target=event.target.closest('[data-act]');if(!target||target.disabled)return;const a=target.dataset.act,h=Number(target.dataset.hero),s=Number(target.dataset.slot),i=Number(target.dataset.index);
  try{
    if(screen==='battle'&&!['select-unit','select-enemy'].includes(a))commandArmed=false;
    switch(a){
      case 'settings':openModal({type:'settings'});break;
      case 'toggle-motion':settings.motion=!settings.motion;persistSettings();renderModal();break;
      case 'help':openModal({type:'help'});break;
      case 'preview-menu':openModal({type:'preview-menu'});break;
      case 'preview':previewPage(target.dataset.page);break;
      case 'new':if(saved&&!['victory','defeat'].includes(saved.phase))openModal({type:'confirm-new'});else beginNew();break;
      case 'force-new':beginNew();break;
      case 'continue':run=structuredClone(saved);preview=false;selectedHero=null;route();render();break;
      case 'home':if(screen==='battle')openModal({type:'pause'});else goHome();break;
      case 'leave-battle':goHome();break;
      case 'close':closeModal();break;
      case 'choose-hero':selectedHero=target.dataset.id;render();break;
      case 'confirm-hero':M.recruit(run,selectedHero||run.candidates[0]);selectedHero=null;save();route();render();break;
      case 'start-battle':startBattle();break;
      case 'retry-engine':renderer?.destroy();renderer=null;render();break;
      case 'pause':openModal({type:'pause'});break;
      case 'detail-loadout':mobileView='loadout';render();break;
      case 'detail-stats':if(mobileView==='stats')attributePage=attributePage==='primary'?'secondary':'primary';mobileView='stats';render();break;
      case 'detail-tactics':mobileView='tactics';render();break;
      case 'detail-enemy':mobileView='enemy';render();break;
      case 'resume-orientation':if(!portraitBattle()){orientationPaused=false;render();syncPause();}break;
      case 'attributes':attributePage=attributePage==='primary'?'secondary':'primary';render();break;
      case 'select-unit':if(screen==='shop')chooseHeroPosition(h);else if(screen==='battle')selectBattleHero(h);else{selectedUnit=h;render();}break;
      case 'select-enemy':selectBattleEnemy(i);break;
      case 'inspect-enemy':commandArmed=false;render();break;
      case 'target-mode':if(battle.setTactics(selectedUnit,{mode:target.dataset.mode})){save();render();}break;
      case 'clear-target':if(battle.setTactics(selectedUnit,{preferredSlot:null})){save();render();}break;
      case 'accept-challenge':if(battle.acceptChallenge(target.dataset.id))updateBattle();break;
      case 'cancel-challenge':if(battle.cancelChallenge(target.dataset.id))updateBattle();break;
      case 'enemy-skill':inspection.show(target,true);break;
      case 'auto':run.party[h].auto=!run.party[h].auto;if(battle)battle.party[h].auto=run.party[h].auto;save();render();break;
      case 'skill':case 'passive':case 'inspect-offer':inspection.show(target,true);break;
      case 'cast-ultimate':inspection.close();if(!battlePaused()&&!battle.party[h].auto){if(!battle.cast(battle.party[h],3))toast(battle.skillReason(battle.party[h],3));updateBattle();}break;
      case 'augment-info':openModal({type:'augment'});break;
      case 'choose-augment':M.chooseAugment(run,target.dataset.id);save();closeModal();render();toast('坚韧共鸣已启用，本次远征持续生效');break;
      case 'refresh-shop':M.refreshShop(run);clearShopSelection();save();render();toast('商店已刷新');break;
      case 'select-offer':selectOffer(target.dataset.source,i);break;
      case 'cancel-selection':clearShopSelection();render();break;
      case 'close-popover':closeShopPopover(true);break;
      case 'refresh-chest':M.refreshChest(run,i);clearShopSelection();save();render();break;
      case 'confirm-acquire':{const pending=shopPopover;if(!pending||pending.type!=='compare')break;if(run.party[pending.hero]?.gear[pending.slot]?.uid!==pending.oldUid)throw new Error('目标装备已变化，请重新选择');commitPlacement(pending.selection,pending.hero,pending.slot);break;}
      case 'sell-reward':if(shopSelection?.type==='offer'&&shopSelection.source==='chest'&&validSelection()){M.sellReward(run,shopSelection.index);completeShopAction('宝箱奖励已出售');}break;
      case 'gear':if(screen==='shop'){if(shopSelection&&shopSelection.type!=='hero')placeSelection(h,s);else showGear(h,s);}else if(run.party[h].gear[s])inspection.show(target,true);break;
      case 'sell-gear':{const p=shopPopover;if(p?.type==='gear'&&run.party[p.hero]?.gear[p.slot]?.uid===p.uid){M.sellGear(run,p.hero,p.slot);completeShopAction('装备已出售');}break;}
      case 'transfer':{const p=shopPopover;if(p?.type==='gear'){shopSelection={type:'gear',hero:p.hero,slot:p.slot,uid:p.uid};render();}break;}
      case 'formation':clearShopSelection();render();toast('拖动英雄名字，或依次点击两位英雄的名字交换站位');break;
      case 'next':M.nextFloor(run);selectedHero=null;save();route();render();break;
    }
  }catch(error){toast(error.message);}
}
document.addEventListener('click',act);
document.addEventListener('click',event=>{
  if(shopPopover&&!popoverRoot.contains(event.target))closeShopPopover();
},true);
window.addEventListener('resize',()=>{closeShopPopover();if(screen==='battle'){if(portraitBattle())orientationPaused=true;inspection.close();render();syncPause();}});
document.addEventListener('scroll',event=>{if(event.target===document)closeShopPopover();},true);
installPointerDrag({
  sourceFor(handle){
    if(screen!=='shop'||modal||run.phase!=='shop')return null;
    const hero=Number(handle.dataset.hero),slot=Number(handle.dataset.slot);
    if(handle.dataset.drag==='hero')return {type:'hero',hero,id:run.party[hero].hero,label:`交换站位 · ${heroById(run.party[hero].hero).name}`};
    if(handle.dataset.drag==='gear'){
      const item=run.party[hero]?.gear[slot];return item?{type:'gear',hero,slot,uid:item.uid,label:item.name}:null;
    }
    const source=handle.dataset.source,index=Number(handle.dataset.index),item=M.getOffer(run,source,index);
    return {type:'offer',source,index,uid:item.uid,label:item.name};
  },
  start(source){inspection.close();closeShopPopover();shopSelection=source;markShopTargets();},
  targetFor(element,source){return source.type==='hero'?element?.closest('.shop-party .hero-panel[data-unit]'):element?.closest('.shop-party .gear-slot');},
  drop(source,target){
    try{
      shopSelection=source;
      if(!validSelection())throw new Error('拖动对象已变化，请重新选择');
      if(source.type==='hero'){M.swapHeroes(run,source.hero,Number(target.dataset.unit));selectedUnit=Number(target.dataset.unit);completeShopAction('英雄站位已交换');}
      else {const hero=Number(target.dataset.hero),slot=Number(target.dataset.slot);render();placeSelection(hero,slot);}
    }catch(error){clearShopSelection();render();toast(error.message);}
  },
  cancel(){if(screen==='shop'){clearShopSelection();render();}},
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){if(modal)closeModal();else if(shopPopover)closeShopPopover(true);else if(shopSelection){clearShopSelection();render();}else if(screen==='battle'&&commandArmed){commandArmed=false;render();}else if(screen==='battle')openModal({type:'pause'});}
  if(event.key==='Tab'&&modal){const items=[...modalRoot.querySelectorAll('button:not(:disabled),[tabindex="0"]')];const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){last.focus();event.preventDefault();}else if(!event.shiftKey&&document.activeElement===last){first.focus();event.preventDefault();}}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&screen==='battle'){paused=true;inspection.close();if(!modal)openModal({type:'pause'});}else if(screen==='battle'&&paused&&!modal)openModal({type:'pause'});syncPause();});
function advanceBattle(deltaMs){
  if(screen!=='battle'||!battle||battlePaused())return;
  accumulator+=Math.min(deltaMs/1000,.1);
  while(accumulator>=STEP){
    battle.step();accumulator-=STEP;
    if(['won','lost'].includes(battle.phase)){M.finishRound(run,battle.result());save();battle=null;route();render();return;}
  }
  drawAt+=deltaMs;
  if(drawAt>=40){updateBattle();drawAt=0;}
}
render();
