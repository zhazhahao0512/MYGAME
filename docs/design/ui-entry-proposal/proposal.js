// Isolated UI proposal: no game imports, combat, storage or live save writes.
const heroes=[
  {name:'砺山',role:'承伤坦克',color:'#bda578',type:'近战',theme:'承伤化盾，稳住前线。',tags:['自身护盾','嘲讽保护'],hp:'1146.8',attack:'61.7',armor:'36.8',magic:'31.6',passive:'坚毅岩心',description:'受伤积累坚毅，释放护盾时消耗坚毅，抵挡后续伤害。',skills:['磐岩护体','截阵盾击','裂地回震','不动山关'],route:'生命、双抗与技能急速',caution:'承担前线压力，输出能力有限。'},
  {name:'岚牙',role:'攻击特效射手',color:'#87bec7',type:'远程',theme:'连续普攻，驱动攻击特效。',tags:['持续输出','普攻协同'],hp:'873',attack:'76.4',armor:'28.7',magic:'24.3',passive:'疾猎本能',description:'依靠连续普攻与强化箭矢持续输出，装备攻击特效能拓展构筑。',skills:['淬锋箭','疾弦','三向追猎','极限连射'],route:'攻速、攻击力与攻击特效',caution:'需要持续出手机会，注意前线保护。'},
  {name:'烬璃',role:'印记爆发法师',color:'#d7977e',type:'远程',theme:'叠加余烬，引爆群体伤害。',tags:['范围爆发','印记联动'],hp:'816.7',attack:'58.9',armor:'25.4',magic:'29.8',passive:'余烬印记',description:'伤害技能叠加余烬，三层时引爆；通过技能组合制造爆发窗口。',skills:['焰核迸裂','引火烙印','烬衣','天火坠落'],route:'法术强度、技能急速与法力',caution:'技能之间存在冷却与蓝量空档。'}
];
const app=document.querySelector('#proposal');
const params=new URLSearchParams(location.search);
let screen=params.get('screen')||'home',selected=0,readySelected=0;
const hasSave=params.get('saved')==='1';
const button=(label,attrs='',primary=false)=>`<button class="${primary?'primary':''}" ${attrs}>${label}</button>`;
const brand='<a class="brand" href="?screen=home">小队远征</a>';
const steps=active=>`<nav class="steps" aria-label="远征流程">${['选择同伴','战前准备','战斗','奖励与整备'].map((s,i)=>`<span ${i===active?'aria-current="step"':''}><i>${i+1}</i>${s}</span>`).join('<b>—</b>')}</nav>`;
const top=title=>`<header class="topbar">${brand}<span class="page-title">${title}</span><div class="top-end"><span class="draft">界面设计稿</span>${button('设置','data-notice="设置将沿用现有游戏设置，这里仅预览入口布局。"')}</div></header>`;
const portrait=(h,compact=false)=>`<div class="nameplate ${compact?'compact':''}" style="--hero:${h.color}"><span>${h.type} · ${h.role}</span><strong>${h.name}</strong><small>${h.theme}</small><i aria-hidden="true"></i></div>`;
const skillRow=h=>`<div class="skill-row">${h.skills.map((s,i)=>`<div class="${i===3?'ultimate':''}"><b>${i+1}</b><span>${s}</span></div>`).join('')}</div>`;
function renderHome(){
  const names=[['泠汐','续航辅助','#8bbeb4'],['烬璃','范围爆发','#d7977e'],['岚牙','持续输出','#87bec7'],['朔影','单体爆发','#b3a4ca'],['砺山','前线承伤','#bda578']];
  return `<main class="home">
    <div class="home-scene" aria-hidden="true"></div>
    ${top('')}
    <div class="home-layout">
      <section class="home-menu">
        <div class="title-rule"><span></span><small>单人 · 自动战斗 · 队伍构筑</small></div>
        <h1>小队远征</h1>
        <p class="home-subtitle">五人同行，深入二十层。</p>
        <p class="home-description">招募同伴，搭配装备。<br>用你的选择，决定队伍如何战斗。</p>
        <div class="menu-actions">
          ${hasSave?`${button('<span>继续远征<small>第 4 / 20 层 · 队伍等级 5</small></span><b>›</b>','data-go="ready"',true)}${button('开始新的远征','data-go="recruit"')}`:`${button('<span>开始远征<small>选择第一位同伴</small></span><b>›</b>','data-go="recruit"',true)}<p class="no-save">暂无进行中的远征</p>`}
          <div class="small-actions">${button('玩法说明','data-notice="选英雄 → 自动战斗 → 领取宝箱 → 商店整备。共20层；此设计稿不运行战斗。"')}${button('设置','data-notice="沿用音量、动效与显示设置。"')}</div>
        </div>
      </section>
      <section class="home-world" aria-label="远征队伍展示">
        <div class="world-caption"><span class="line"></span><p>城门之外<br><strong>每一步，都是新的选择。</strong></p></div>
        <div class="roster-teaser">${names.map(([name,role,color])=>`<div style="--hero:${color}"><span class="roster-diamond"></span><strong>${name}</strong><small>${role}</small></div>`).join('')}</div>
      </section>
    </div>
    <footer class="home-footer"><span>关卡进度自动保存在本机</span><span><a href="?screen=recruit">预览选人页</a><a href="?screen=ready">预览准备页</a><a href="?screen=home${hasSave?'':'&saved=1'}">${hasSave?'无存档状态':'有存档状态'}</a></span></footer>
  </main>`;
}
function renderRecruit(){
  const h=heroes[selected];
  return `<main class="entry-screen">
    ${top('选择初始英雄')}${steps(0)}
    <section class="page-intro"><div><h1>第一位同伴，由你决定。</h1><p>从本次候选中选择一位。前四层开始前，还能继续招募同伴。</p></div><span class="intro-note">候选 <b>3</b> 位 · 选择 <b>1</b> 位</span></section>
    <div class="recruit-layout">
      <section class="candidate-grid" aria-label="候选英雄">${heroes.map((hero,i)=>`<button class="candidate ${i===selected?'chosen':''}" data-select="${i}" aria-pressed="${i===selected}" style="--hero:${hero.color}">
        <div class="candidate-top"><span>${hero.role}</span><span class="select-mark">${i===selected?'✓ 已选择':'选择'}</span></div>
        ${portrait(hero)}
        <div class="candidate-copy"><h2>${hero.name}</h2><p>${hero.theme}</p><div class="tags">${hero.tags.map(t=>`<span>${t}</span>`).join('')}</div>
        <dl class="mini-stats"><div><dt>生命</dt><dd>${hero.hp}</dd></div><div><dt>攻击力</dt><dd>${hero.attack}</dd></div><div><dt>物理抗性</dt><dd>${hero.armor}</dd></div><div><dt>魔法抗性</dt><dd>${hero.magic}</dd></div></dl>
        <div class="passive-line"><span>被动</span><strong>${hero.passive}</strong></div></div>
      </button>`).join('')}</section>
      <aside class="hero-detail panel" aria-live="polite"><div class="detail-kicker">当前选择</div><h2>${h.name}<small>${h.role}</small></h2><p class="detail-description">${h.description}</p><h3>技能概览</h3>${skillRow(h)}<h3>构筑方向</h3><p>${h.route}</p><div class="tradeoff"><span>搭配时留意</span><p>${h.caution}</p></div><small class="detail-note">完整数值与技能效果可在详情中查看。</small></aside>
    </div>
    <section class="team-ribbon panel"><div><h3>当前队伍 <small>0 / 5</small></h3><p>第一位同伴加入后，开始组建阵容。</p></div><div class="mini-slots"><span class="prospective">${h.name}<small>待加入</small></span>${Array.from({length:4},()=>'<span class="empty">＋<small>待招募</small></span>').join('')}</div></section>
    <footer class="actionbar"><span>英雄加入后，本次远征不可替换。</span>${button(`确认选择 · ${h.name} <b>›</b>`,'data-notice="正式接入时，确认初始英雄后先进入第1层招募，再到战前准备。本设计稿只预览选择状态；可通过首页底部链接查看准备页。"',true)}</footer>
  </main>`;
}
function renderReady(){
  const party=[heroes[0],heroes[1]],h=party[readySelected];
  return `<main class="entry-screen ready-screen">
    ${top('准备出发')}${steps(1)}
    <section class="page-intro"><div><h1>队伍就位，准备迎战。</h1><p>第 1 / 20 层 · 队伍等级 1</p></div><div class="floor-mark"><small>本次远征</small><b>01 <span>/ 20</span></b></div></section>
    <div class="ready-layout">
      <section class="formation panel"><div class="section-head"><h2>出战阵容 <small>2 / 5</small></h2><span>后排 <b>→</b> 前排</span></div>
      <div class="formation-slots">${[4,3,2,1,0].map(i=>i<2?`<button class="formation-hero ${readySelected===i?'chosen':''}" data-ready-select="${i}" style="--hero:${party[i].color}"><span class="slot-number">${i+1} 号位</span>${portrait(party[i],true)}<strong>${party[i].name}</strong><span>${party[i].role}</span><small>Lv.1</small><em>1 技能点待分配</em></button>`:`<div class="formation-empty"><span class="slot-number">${i+1} 号位</span><div class="empty-shape">＋</div><strong>等待同伴</strong><small>第 ${i} 层开始前招募</small></div>`).join('')}</div>
      <p class="formation-note">装备与站位在战后商店调整，这里确认出战状态。</p></section>
      <aside class="briefing panel"><h2>本层目标</h2><div class="time-goal"><b>40</b><span>秒<br><small>坚持到停止出怪</small></span></div><p>倒计时结束后，清理场上剩余敌人。</p><hr><h3>本层收益</h3><ul><li>击败怪物获得金币</li><li>通关后领取宝箱奖励</li><li>进入商店整理装备</li></ul><div class="next-recruit">下一次招募<span>第 2 层开始前</span></div></aside>
    </div>
    <section class="ready-detail panel" aria-live="polite"><div class="ready-selected"><small>当前查看</small><h2>${h.name}</h2><p>${h.role}</p></div><div class="ready-skills"><span class="detail-kicker">技能概览</span>${skillRow(h)}</div><div class="growth-nudge"><span class="gold-dot"></span><p><b>还有 1 个技能点</b><small>可以先加点，也可以保留。</small></p>${button('查看成长','data-notice="正式接入时打开已有成长面板。这里仅展示入口位置，不更改技能或点数。"')}</div></section>
    <footer class="actionbar"><span>战斗自动进行，可随时暂停查看技能和装备。</span>${button('进入第 1 层 <b>›</b>','data-notice="已到达设计稿的战斗入口。正式接入时调用现有 start-battle，不增加新的确认步骤。"',true)}</footer>
  </main>`;
}
function render(){app.innerHTML=screen==='recruit'?renderRecruit():screen==='ready'?renderReady():renderHome();}
document.addEventListener('click',e=>{
  const target=e.target.closest('[data-go],[data-select],[data-ready-select],[data-notice]');
  if(!target)return;
  if(target.dataset.go){screen=target.dataset.go;history.replaceState(null,'',`?screen=${screen}`);render();window.scrollTo(0,0);}
  if(target.dataset.select!==undefined){selected=Number(target.dataset.select);render();app.querySelector(`[data-select="${selected}"]`).focus({preventScroll:true});}
  if(target.dataset.readySelect!==undefined){readySelected=Number(target.dataset.readySelect);render();app.querySelector(`[data-ready-select="${readySelected}"]`).focus({preventScroll:true});}
  if(target.dataset.notice){document.querySelector('#notice-copy').textContent=target.dataset.notice;document.querySelector('#notice').showModal();}
});
document.querySelector('#close-notice').onclick=()=>document.querySelector('#notice').close();
render();
