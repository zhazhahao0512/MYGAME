import { HEROES, heroById, BASE, RULES, RARITIES, PRIMARY, SECONDARY, STAT_LABELS, statText } from './data.js';
import * as M from './model.js';
import { Battle, STEP } from './battle.js';
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
let settings={motion:!matchMedia('(prefers-reduced-motion: reduce)').matches};
try{saved=M.parseSave(localStorage.getItem(M.SAVE_KEY));const stored=JSON.parse(localStorage.getItem('squad.settings')||'null');if(stored&&typeof stored.motion==='boolean')settings.motion=stored.motion;}catch{}
function toast(message){const el=document.querySelector('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),3400);}
function save(){if(!run||preview)return;try{localStorage.setItem(M.SAVE_KEY,JSON.stringify(run));saved=M.parseSave(JSON.stringify(run));}catch{toast('浏览器存储不可用，本次进度无法保存。');}}
function persistSettings(){try{localStorage.setItem('squad.settings',JSON.stringify(settings));}catch{}document.body.classList.toggle('reduce-motion',!settings.motion);}
function portrait(def,cls=''){return `<span class="portrait ${cls}" style="--hero:${def.color}"><span class="portrait-corner">${escape(def.role)}</span><b>${escape(def.mark)}</b><small>${escape(def.name)}</small></span>`;}
function statGrid(stats,page=attributePage){return `<div class="stat-grid ${page==='secondary'?'secondary':''}">${(page==='primary'?PRIMARY:SECONDARY).map(key=>`<div title="${STAT_LABELS[key]}：当前最终值"><span>${STAT_LABELS[key]}</span><b data-stat="${key}">${statText(key,stats[key])}</b></div>`).join('')}</div>`;}
function itemBox(item,cls=''){const rarity=RARITIES.find(r=>r.id===item.rarity);return `<span class="item-box ${cls}" style="--rarity:${rarity.color}"><b>${escape(item.mark)}</b><small>${rarity.name}</small></span>`;}
function itemInfo(item){const effect=item.rarity==='orange'?(EQUIPMENT_EFFECTS[item.base]?.description||item.effect):null;const rarity=RARITIES.find(r=>r.id===item.rarity);return `<div class="item-details" style="--rarity:${rarity.color}">${itemBox(item)}<div><span class="rarity">${rarity.name}${item.rarity==='orange'?' · 橙装':''}</span><h3>${escape(item.name)}</h3><div class="item-stats">${Object.entries(item.stats).map(([k,v])=>`<span>${STAT_LABELS[k]} <b>+${statText(k,v)}</b></span>`).join('')}</div>${effect?`<small class="muted">${escape(effect)} · 每人限 1 件</small>`:''}</div></div>`;}
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
function skillButtons(member,index,combat=false){return `<div class="skills"><button class="skill passive" data-act="passive" data-hero="${index}" title="被动技能占位"><b>被</b><small>被动</small></button>${skillsFor(member.hero).map((s,n)=>`<button class="skill ${n===3?'ultimate':''}" data-act="skill" data-hero="${index}" data-skill="${n}" ${combat?`data-cooldown="${index}-${n}"`:''} aria-label="${heroById(member.hero).name} ${s.key} ${s.name}"><b>${s.key}</b><small>${combat?'就绪':s.name}</small><i class="cool-mask"></i></button>`).join('')}</div>`;}
function gearButtons(member,index){return `<div class="gear-row"><span>装备</span>${member.gear.map((item,slot)=>`<button class="gear-slot ${item?'filled':''}" data-act="gear" data-hero="${index}" data-slot="${slot}" ${item?`style="--rarity:${RARITIES.find(r=>r.id===item.rarity).color}"`:''} title="${item?escape(item.name):'空装备槽'}" aria-label="${heroById(member.hero).name} 装备槽 ${slot+1}${item?' '+escape(item.name):' 空'}">${item?escape(item.mark):'＋'}</button>`).join('')}</div>`;}
function heroPanels(shop=false){return Array.from({length:5},(_,i)=>4-i).map(index=>{
  const m=run.party[index];if(!m)return `<div class="hero-panel vacant"><span>0${index+1}</span><b>等待同伴</b><small>前四层开始前招募</small></div>`;
  const h=heroById(m.hero);return `<article data-unit="${index}" class="hero-panel ${selectedUnit===index?'selected':''}" style="--hero:${h.color}"><div class="hero-panel-heading"><button data-act="select-unit" data-hero="${index}" class="hero-name"><b>${h.name}</b><small>Lv.${run.level}</small></button>${shop?`<span class="orange-count">橙装 ${m.gear.filter(i=>i?.rarity==='orange').length}/1</span>`:`<button class="auto-toggle ${m.auto?'on':''}" data-act="auto" data-hero="${index}" aria-pressed="${m.auto}">R <i></i><span>${m.auto?'自动':'手动'}</span></button>`}</div>${skillButtons(m,index,!shop&&screen==='battle')}${gearButtons(m,index)}${statGrid(screen==='battle'?battle.party[index].stats:M.statsFor(m,run.level,run.augments))}${screen==='battle'?`<div class="unit-statuses" data-statuses="${index}" aria-label="${h.name}当前状态"></div>`:''}${shop?`<small class="gear-hint">点击装备查看 · 转移 · 出售</small>`:''}</article>`;
  }).join('');}
function renderBattle(){return `<div class="battle-shell">${topbar(`第 ${run.floor} <span class="muted">/ 20 层</span>`,'演示战斗',`${gold(run.gold+battle.gold)}${(run.augments||[]).length?btn('强化','augment-info','quiet small'):''}${btn(icon('pause'),'pause','icon-btn','aria-label="暂停战斗"')}`)}<div class="battle-info"><div><span class="eyebrow">HOLD YOUR GROUND</span><b id="battle-phase">限时战斗</b></div><div class="battle-clock" id="battle-clock">00:25</div><div class="battle-kills">本关击败 <b id="battle-kills">0</b><small>击杀获得金币</small></div></div><div id="battle-canvas" class="phaser-arena" role="group" aria-label="自动战斗场景"></div><div class="battle-footnote"><span id="battle-event">战斗开始</span><span>时间结束后停止补位，清理剩余敌人</span></div><section class="squad-section"><div class="section-heading"><div><h2>小队面板</h2><span>${attributePage==='primary'?'主要属性':'次要属性'}</span></div>${btn(`切换：${attributePage==='primary'?'次要':'主要'}属性 ${icon('swap')}`,'attributes','small quiet')}</div><div class="hero-panels">${heroPanels()}</div></section></div>`;}
async function ensureRenderer(){
  if(!battle||screen!=='battle'||renderer?.battle===battle||loadingBattle===battle)return;
  const expected=battle;loadingBattle=expected;
  try{
    const {PhaserBattleRenderer}=await import('./renderer/PhaserBattleRenderer.ts');
    if(screen!=='battle'||battle!==expected)return;
    renderer=new PhaserBattleRenderer(document.querySelector('#battle-canvas'),expected,{
      advance:advanceBattle,selected:()=>selectedUnit,select:index=>{selectedUnit=index;render();},
      motion:()=>settings.motion,paused:()=>!!modal||document.hidden||paused,
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
  document.querySelector('#battle-clock').textContent=battle.phase==='cleanup'?'清场中':`00:${Math.ceil(battle.remaining).toString().padStart(2,'0')}`;
  document.querySelector('#battle-phase').textContent=battle.phase==='cleanup'?'停止补位 · 清理剩余敌人':'限时战斗';
  document.querySelector('#battle-kills').textContent=battle.kills;
  const goldLabel=app.querySelector('.topbar-actions .gold');if(goldLabel)goldLabel.lastChild.textContent=run.gold+battle.gold;
  document.querySelector('#battle-event').textContent=battle.feed[0]?.text||'';
  for(const [index,unit] of battle.party.entries()) {
    const panel=document.querySelector(`[data-unit="${index}"]`);
    for(const label of panel.querySelectorAll('[data-stat]')) {
      const value=statText(label.dataset.stat,unit.stats[label.dataset.stat]);if(label.textContent!==value)label.textContent=value;
    }
    const statusElement=panel.querySelector('[data-statuses]');
    const statuses=[...unit.statuses.values()];
    const text=statuses.length?statuses.map(s=>`${s.definition.name}${s.stacks>1?` ×${s.stacks}`:''} ${Math.max(0,(s.expiresAt-battle.tick)*STEP).toFixed(1)}s`).join(' · '):'无临时状态';
    if(statusElement.textContent!==text){statusElement.textContent=text;statusElement.title=text;}
  }
  for(const [i,unit]of battle.party.entries())for(let n=0;n<4;n++){
    const button=document.querySelector(`[data-cooldown="${i}-${n}"]`);if(!button)continue;
    const reason=battle.skillReason(unit,n);button.querySelector('small').textContent=reason;button.classList.toggle('ready',reason==='就绪');
    const skill=battle.getSkill(unit,n);const total=Math.max(1,Math.ceil(skill.cooldown/(1+unit.stats.haste/100)/STEP));button.querySelector('.cool-mask').style.height=`${Math.max(0,Math.min(100,100*(unit.ready[n]-battle.tick)/total))}%`;
    button.title=`${skill.name}：${skill.description} 当前：${reason}`;
  }

}
function offerCard(item,index){if(!item)return `<div class="offer sold"><span>${icon('check')}</span><h3>已购入</h3><p>刷新可补充商品</p></div>`;return `<article class="offer" style="--rarity:${RARITIES.find(r=>r.id===item.rarity).color}">${itemInfo(item)}<div class="offer-bottom">${gold(item.price)}${btn(`选择装备 ${icon('arrow')}`,'buy','small',`data-index="${index}"`)}</div></article>`;}
function renderShop(){return `<div class="shop-shell">${topbar('战后商店',`第 ${run.floor} 层已完成 · ${run.floor===20?'远征终点':`下一层 ${run.floor+1} / 20`}`,gold(run.gold))}<div class="shop-summary"><span>${icon('check')} 第 ${run.floor} 层通关</span><span>击败 <b>${run.lastRound?.kills||0}</b> 个敌人</span><span>获得 ${gold(run.lastRound?.gold||0)}</span><span>队伍等级 <b>Lv.${run.level}</b></span></div><section class="shop-stock"><div class="section-heading"><div><h2>旅途补给</h2><span>每一件装备，都是新的可能。</span></div>${btn(`${icon('refresh')} 刷新 ${gold(M.refreshCost(run))}`,'refresh-shop','small',run.gold<M.refreshCost(run)?'disabled title="金币不足"':'')}</div><div class="offer-grid">${run.shop.map(offerCard).join('')}</div></section><section class="shop-party"><div class="section-heading"><div><h2>我的队伍</h2><span>每名英雄 4 个装备槽 · 最多 1 件橙装</span></div><div>${btn(`${icon('swap')} 调整站位`,'formation','small quiet')}${btn(`切换：${attributePage==='primary'?'次要':'主要'}属性`,'attributes','small quiet')}</div></div><div class="hero-panels">${heroPanels(true)}</div></section><footer class="shop-footer"><div class="chest-entry ${run.chest.claimed?'claimed':''}"><span class="chest-symbol">${icon(run.chest.claimed?'check':'chest')}</span><div><b>${run.chest.claimed?'本层奖励已领取':'本层宝箱 · 等待开启'}</b><small>${run.chest.claimed?'准备好就继续出发吧。':'装备三选一 · 可刷新一个选项一次'}</small></div>${!run.chest.claimed?btn('开启宝箱','chest','primary small'):''}</div><span class="shop-rule">没有背包<br><small>获得装备后直接穿戴或出售</small></span>${btn(`${run.floor===20?'完成远征':`进入第 ${run.floor+1} 层`} ${icon('arrow')}`,'next','primary',run.chest.claimed?'':'disabled title="请先处理宝箱奖励"')}</footer></div>`;}
function renderResult(){const won=run.phase==='victory';return `<div class="page-shell result-shell">${topbar('远征记录','每一段旅途，都有自己的答案。')}<section class="result-content"><div class="result-emblem ${won?'won':''}">${icon(won?'flag':'chest')}</div><span class="eyebrow">${won?'EXPEDITION COMPLETE':'UNTIL NEXT TIME'}</span><h2>${won?'远征，圆满落幕。':'这次，就走到这里。'}</h2><p>${won?'二十层挑战已完成。带着这次的经验，再试一种不同的组合吧。':'同伴们暂时倒下了。下一次选择，也许会带来新的可能。'}</p><div class="result-stats"><div><small>到达层数</small><b>${run.floor}<span> / 20</span></b></div><div><small>击败敌人</small><b>${run.kills}</b></div><div><small>击杀金币</small><b>${run.earned}</b></div><div><small>队伍等级</small><b>${run.level}</b></div></div><div class="result-party">${run.party.map(m=>portrait(heroById(m.hero))).join('')}</div><div class="result-actions">${btn('返回首页','home','quiet')}${btn(`再次远征 ${icon('arrow')}`,'new','primary')}</div></section></div>`;}

function openModal(value){previousFocus=document.activeElement;modal=value;renderModal();app.inert=true;}
function closeModal(){modal=null;modalRoot.innerHTML='';app.inert=false;previousFocus?.isConnected&&previousFocus.focus();lastFrame=performance.now();accumulator=0;renderer?.syncPause();}
function modalFrame(title,body,footer='',cls=''){return `<div class="modal-backdrop"><section class="modal ${cls}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><div><span class="eyebrow">SQUAD EXPEDITION</span><h2 id="modal-title">${title}</h2></div>${btn(icon('cross'),'close','icon-btn','aria-label="关闭弹窗"')}</header><div class="modal-body">${body}</div>${footer?`<footer class="modal-footer">${footer}</footer>`:''}</section></div>`;}
function acquisitionModal(){
  const {source,index,hero,slot}=modal,item=M.getOffer(run,source,index);
  const chosen=!!run.party[hero]&&Number.isInteger(slot);
  const quote=chosen?M.previewAcquisition(run,source,index,hero,slot):null;
  const slots=run.party.map((member,h)=>`<div><b>${heroById(member.hero).name}<small>橙装 ${member.gear.filter(i=>i?.rarity==='orange').length}/1</small></b><div>${member.gear.map((old,s)=>{
    const option=M.previewAcquisition(run,source,index,h,s);
    return `<button data-act="pick-slot" data-hero="${h}" data-slot="${s}" class="destination-slot ${hero===h&&slot===s?'selected':''} ${option.reason?'unavailable':''}" aria-pressed="${hero===h&&slot===s}" title="${escape(option.reason||'选择此槽位')}" ${old?`style="--rarity:${RARITIES.find(r=>r.id===old.rarity).color}"`:''}>${old?escape(old.mark):'＋'}<small>${old?escape(old.name):'空槽'}</small>${option.reason?'<span class="slot-warning">需调整</span>':''}</button>`;
  }).join('')}</div></div>`).join('');
  const comparison=quote?`<section class="loadout-preview" aria-label="穿戴效果预览"><div class="comparison"><div><small>原装备 · ${quote.old?`出售获得 ${quote.refund} 金币`:'空槽'}</small>${quote.old?itemInfo(quote.old):'<b>无需替换</b>'}</div><span>${icon('arrow')}</span><div><small>新装备 · ${source==='shop'?`购买花费 ${quote.cost} 金币`:'宝箱奖励'}</small>${itemInfo(item)}</div></div><h4>${heroById(run.party[hero].hero).name} · 穿戴后属性</h4><div class="stat-changes">${quote.changes.length?quote.changes.map(change=>`<div class="${change.after>change.before?'increase':'decrease'}"><span>${STAT_LABELS[change.key]}</span><span>${statText(change.key,change.before)} <i>→</i> <b>${statText(change.key,change.after)}</b></span></div>`).join(''):'<p class="muted">基础属性不变</p>'}</div><p class="transaction-total">当前 ${run.gold} · 旧装备 +${quote.refund} · 购买 −${quote.cost}<br>交易后金币 <b>${quote.goldAfter}</b></p>${quote.reason?`<p class="transaction-warning" role="status">${quote.reason}${quote.goldAfter<0?`，还差 ${-quote.goldAfter} 金币`:''}</p>`:''}</section>`:'<p class="destination-prompt">选择下方槽位后，可预览属性和金币变化。</p>';
  const actions=(source==='chest'?btn('返回三选一','back-to-chest','quiet')+btn(`直接出售 +${M.salePrice(item)} 金币`,'sell-reward','quiet'):btn('取消','close','quiet'))+btn(source==='shop'?'确认购买并穿戴':'确认穿戴','confirm-acquire','primary',quote&&!quote.reason?'':'disabled');
  return modalFrame('选择装备去向',`${itemInfo(item)}<p class="muted">点选英雄的装备槽。替换时，旧装备会自动出售；确认前不会扣款。</p>${!chosen?comparison:''}<div class="destination-grid">${slots}</div>${chosen?comparison:''}`,actions,'wide');
}
function renderModal(){
  let html='';
  if(modal.type==='augment'){
    const augment=AUGMENTS[0],active=(run.augments||[]).includes(augment.id);
    html=modalFrame('旅途强化',`<div class="augment-detail"><span class="badge">${active?'已启用':'示例强化'}</span><h3>${augment.name}</h3><p>${augment.description}</p><small class="muted">作用于本次远征的所有英雄，后招募的同伴同样生效。名称与数值后续可调整。</small></div>`,active?btn('返回','close','primary'):btn('暂不选择','close','quiet')+btn('启用本次远征','choose-augment','primary',`data-id="${augment.id}" ${run.phase==='shop'&&run.floor===1&&run.chest.claimed?'':'disabled'}`));
  }
  if(modal.type==='settings')html=modalFrame('设置',`<p class="muted">偏好设置会保存在当前浏览器。</p><div class="setting-row"><div><b>界面与战斗动效</b><small>关闭后减少过渡动画和弹道效果，结算保持不变。</small></div><button class="switch ${settings.motion?'on':''}" data-act="toggle-motion" role="switch" aria-checked="${settings.motion}" aria-label="界面与战斗动效"><i></i></button></div><div class="setting-info"><b>存档方式</b><p>关卡之间自动保存。若在战斗中退出，继续游戏会从该关开战前恢复。</p><b>显示方式</b><p>电脑横屏优先；英雄、技能与装备均使用文字占位。平板布局后续适配。</p></div>`,btn('完成','close','primary'));
  if(modal.type==='help')html=modalFrame('远征手册',`<ol class="help-steps"><li><b>组建小队</b><p>选择初始英雄，第 1–4 层开始前各三选一招募一位。队伍最多五人，英雄不能替换。</p></li><li><b>坚守与清场</b><p>限时自动战斗。敌人倒下后 2 秒补位；时间到后停止补位，消灭余敌即可通关。金币来自击杀。</p></li><li><b>领取与搭配</b><p>战后宝箱三选一，允许刷新其中一个选项一次。商店可购买、刷新、出售和转移装备。没有背包，每人四槽、最多一件橙装。</p></li><li><b>再出发</b><p>通向二十层终点。原型中的英雄技能、属性、装备和价格是演示配置，后续再正式设计。</p></li></ol>`,btn('准备好了','close','primary'));
  if(modal.type==='preview-menu')html=modalFrame('浏览界面',`<p class="muted">载入独立演示数据，不会覆盖你的远征存档。</p><div class="preview-grid">${[['recruit','英雄招募','随机候选 · 三选一'],['battle','战斗界面','五对五 · 演示自动战斗'],['shop','战后商店','购买 · 装备 · 站位'],['chest','宝箱奖励','三选一 · 单项刷新'],['result','远征结算','结束记录 · 再次出发']].map(([id,name,desc])=>`<button data-act="preview" data-page="${id}"><b>${name} ${icon('arrow')}</b><small>${desc}</small></button>`).join('')}</div>`);
  if(modal.type==='confirm-new')html=modalFrame('开始新的远征？','<p>当前进行中的远征存档会被替换。</p>',btn('取消','close','quiet')+btn('开始新远征','force-new','primary'));
  if(modal.type==='pause')html=modalFrame('稍作休整',`<div class="pause-message"><b>第 ${run.floor} 层 · ${Math.ceil(battle.remaining)} 秒</b><p>战斗已暂停。可以继续战斗，或返回首页。</p><small class="muted">返回首页后，本关将从开战前重新开始。</small></div>`,btn('返回首页','leave-battle','quiet')+btn(`${icon('play')} 继续战斗`,'close','primary'));
  if(modal.type==='chest')html=modalFrame('打开，下一种可能。',`<div class="chest-modal-intro"><span class="chest-symbol">${icon('chest')}</span><div><b>第 ${run.floor} 层通关 · 宝箱三选一</b><p>击败 ${run.lastRound?.kills||0} 个敌人 · 击杀金币 +${run.lastRound?.gold||0}</p><p>选一件装备穿戴，或者直接出售。没有背包。</p></div><span class="badge">单项刷新 ${run.chest.refreshUsed?'0':'1'} / 1</span></div><div class="chest-choices">${run.chest.options.map((item,i)=>`<article class="reward-card" style="--rarity:${RARITIES.find(r=>r.id===item.rarity).color}">${itemInfo(item)}${btn('选择这件','take-reward','primary small',`data-index="${i}"`)}${btn(`${icon('refresh')} 刷新此项`,'refresh-chest','quiet small',`data-index="${i}" ${run.chest.refreshUsed?'disabled':''}`)}</article>`).join('')}</div><p class="muted small-text">仅替换所选装备及其随机品级，另外两件保持不变。结果即时保存。</p>`,'','wide');
  if(modal.type==='acquire')html=acquisitionModal();
  if(modal.type==='gear'){
    const item=run.party[modal.hero].gear[modal.slot];
    html=modalFrame('装备详情',itemInfo(item)+`<p class="muted">穿戴者：${heroById(run.party[modal.hero].hero).name} · 第 ${modal.slot+1} 槽</p>`,screen==='shop'?btn('转移 / 交换','transfer','quiet')+btn(`出售 +${M.salePrice(item)} 金币`,'sell-gear','primary'):btn('关闭','close','quiet'));
  }
  if(modal.type==='transfer')html=modalFrame('转移或交换装备',`<p class="muted">点击目标槽位。若已有装备，则交换双方装备；不会产生背包物品。</p><div class="destination-grid">${run.party.map((m,h)=>`<div><b>${heroById(m.hero).name}</b><div>${m.gear.map((it,s)=>`<button data-act="transfer-to" data-hero="${h}" data-slot="${s}" class="destination-slot">${it?escape(it.mark):'＋'}<small>${it?escape(it.name):'空槽'}</small></button>`).join('')}</div></div>`).join('')}</div>`,'','wide');
  if(modal.type==='formation')html=modalFrame('调整站位',`<p class="muted">1 号位最靠近敌人。仅交换站位，不会替换或移除英雄。</p><div class="formation-editor">${run.party.map((m,i)=>`<div><span class="badge">${i+1} 号位</span>${portrait(heroById(m.hero))}<b>${heroById(m.hero).name}</b><span>${i===0?'前排':i===run.party.length-1?'后排':''}</span>${btn('前移','move','small quiet',`data-hero="${i}" data-direction="-1" ${i===0?'disabled':''}`)}${btn('后移','move','small quiet',`data-hero="${i}" data-direction="1" ${i===run.party.length-1?'disabled':''}`)}</div>`).join('')}</div>`,btn('完成调整','close','primary'));
  if(modal.type==='info')html=modalFrame(modal.title,`<p class="info-copy">${escape(modal.text)}</p>`,btn('明白了','close','primary'));
  modalRoot.innerHTML=html;app.inert=true;renderer?.syncPause();queueMicrotask(()=>modalRoot.querySelector('button:not(:disabled)')?.focus());
}
function beginNew(){closeModal();preview=false;run=M.createRun();selectedHero=null;battle=null;save();route();render();}
function goHome(){closeModal();battle=null;paused=false;run=null;preview=false;screen='home';render();}
function startBattle(){run.phase='battle';save();battle=new Battle(run);screen='battle';paused=false;accumulator=0;lastFrame=performance.now();render();}
function previewPage(page){
  closeModal();preview=true;run=M.createRun(70891);M.recruit(run,run.candidates[0]);M.recruit(run,run.candidates[0]);
  if(page==='recruit'){run.floor=2;run.phase='recruit';run.candidates=M.sample(run,HEROES.map(h=>h.id).filter(id=>!run.party.some(h=>h.hero===id)),3);selectedHero=null;route();render();return;}
  for(const h of HEROES)if(run.party.length<5&&!run.party.some(m=>m.hero===h.id))run.party.push({hero:h.id,gear:[null,null,null,null],auto:true});
  run.floor=4;run.level=3;run.party.forEach((h,i)=>{h.gear[0]=M.makeItem(run,i%4);h.gear[1]=M.makeItem(run,1);});
  if(page==='battle'){run.augments=[AUGMENTS[0].id];for(const [hero,base] of [['stone','rune'],['wind','clock'],['shade','armor']]){const member=run.party.find(m=>m.hero===hero);if(member)member.gear[0]=M.makeItem(run,5,base);}startBattle();return;}
  M.finishRound(run,{won:true,gold:128,kills:42,seconds:25});
  if(page==='result'){run.floor=20;run.phase='victory';}
  route();render();if(page==='chest')openModal({type:'chest'});
}
function act(event){const target=event.target.closest('[data-act]');if(!target||target.disabled)return;const a=target.dataset.act,h=Number(target.dataset.hero),s=Number(target.dataset.slot),i=Number(target.dataset.index);
  try{
    switch(a){
      case 'settings':openModal({type:'settings'});break;
      case 'toggle-motion':settings.motion=!settings.motion;persistSettings();renderModal();break;
      case 'help':openModal({type:'help'});break;
      case 'preview-menu':openModal({type:'preview-menu'});break;
      case 'preview':previewPage(target.dataset.page);break;
      case 'new':if(saved&&!['victory','defeat'].includes(saved.phase))openModal({type:'confirm-new'});else beginNew();break;
      case 'force-new':beginNew();break;
      case 'continue':run=structuredClone(saved);preview=false;selectedHero=null;route();render();if(run.phase==='shop'&&!run.chest.claimed)openModal({type:'chest'});break;
      case 'home':if(screen==='battle')openModal({type:'pause'});else goHome();break;
      case 'leave-battle':goHome();break;
      case 'close':closeModal();break;
      case 'choose-hero':selectedHero=target.dataset.id;render();break;
      case 'confirm-hero':M.recruit(run,selectedHero||run.candidates[0]);selectedHero=null;save();route();render();break;
      case 'start-battle':startBattle();break;
      case 'retry-engine':renderer?.destroy();renderer=null;render();break;
      case 'pause':openModal({type:'pause'});break;
      case 'attributes':attributePage=attributePage==='primary'?'secondary':'primary';render();break;
      case 'select-unit':selectedUnit=h;render();break;
      case 'auto':run.party[h].auto=!run.party[h].auto;if(battle)battle.party[h].auto=run.party[h].auto;save();render();break;
      case 'skill':{const n=Number(target.dataset.skill),skill=skillsFor(run.party[h].hero)[n];if(screen==='battle'&&n===3&&!battle.party[h].auto){if(!battle.cast(battle.party[h],n))toast(battle.skillReason(battle.party[h],n));updateBattle();}else openModal({type:'info',title:skill.name,text:`${skill.description} 基础冷却 ${skill.cooldown} 秒，消耗 ${skill.cost} 点法力。${run.party[h].hero==='stone'?'示例技能已生效，数值待调整。':'当前为通用演示技能。'}`});break;}
      case 'passive':openModal({type:'info',title:run.party[h].hero==='stone'?STONE_PASSIVE.name:'被动技能',text:run.party[h].hero==='stone'?STONE_PASSIVE.description:'当前角色的专属被动尚未设计，磐石已接入示例被动。'});break;
      case 'augment-info':openModal({type:'augment'});break;
      case 'choose-augment':M.chooseAugment(run,target.dataset.id);save();closeModal();render();toast('坚韧共鸣已启用，本次远征持续生效');break;
      case 'refresh-shop':M.refreshShop(run);save();render();toast('商店已刷新');break;
      case 'buy':openModal({type:'acquire',source:'shop',index:i});break;
      case 'chest':if(!run.chest.claimed)openModal({type:'chest'});break;
      case 'refresh-chest':M.refreshChest(run,i);save();renderModal();break;
      case 'take-reward':modal={type:'acquire',source:'chest',index:i};renderModal();break;
      case 'back-to-chest':modal={type:'chest'};renderModal();break;
      case 'pick-slot':modal.hero=h;modal.slot=s;renderModal();break;
      case 'confirm-acquire':M.acquire(run,modal.source,modal.index,modal.hero,modal.slot);save();closeModal();render();toast('装备已穿戴');break;
      case 'sell-reward':M.sellReward(run,modal.index);save();closeModal();render();toast('宝箱奖励已出售');break;
      case 'gear':if(run.party[h].gear[s])openModal({type:'gear',hero:h,slot:s});else toast(screen==='shop'?'先选择一件商品或宝箱装备，再选择这个空槽。':'空装备槽，可在商店购买或领取装备。');break;
      case 'sell-gear':M.sellGear(run,modal.hero,modal.slot);save();closeModal();render();toast('装备已出售');break;
      case 'transfer':modal.type='transfer';renderModal();break;
      case 'transfer-to':M.transferGear(run,modal.hero,modal.slot,h,s);save();closeModal();render();toast('装备位置已更新');break;
      case 'formation':openModal({type:'formation'});break;
      case 'move':M.moveHero(run,h,Number(target.dataset.direction));save();render();break;
      case 'next':M.nextFloor(run);selectedHero=null;save();route();render();break;
    }
  }catch(error){toast(error.message);}
}
document.addEventListener('click',act);
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){if(modal)closeModal();else if(screen==='battle')openModal({type:'pause'});}
  if(event.key==='Tab'&&modal){const items=[...modalRoot.querySelectorAll('button:not(:disabled),[tabindex="0"]')];const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){last.focus();event.preventDefault();}else if(!event.shiftKey&&document.activeElement===last){first.focus();event.preventDefault();}}
});
document.addEventListener('visibilitychange',()=>{accumulator=0;if(document.hidden&&screen==='battle'&&!modal)openModal({type:'pause'});renderer?.syncPause();});
function advanceBattle(deltaMs){
  if(screen!=='battle'||!battle||modal||paused||document.hidden)return;
  accumulator+=Math.min(deltaMs/1000,.1);
  while(accumulator>=STEP){
    battle.step();accumulator-=STEP;
    if(['won','lost'].includes(battle.phase)){M.finishRound(run,battle.result());save();battle=null;route();render();if(run.phase==='shop')openModal({type:'chest'});return;}
  }
  drawAt+=deltaMs;
  if(drawAt>=40){updateBattle();drawAt=0;}
}
render();
