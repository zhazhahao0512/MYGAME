// One non-modal inspection card. Querying content must be read-only.
export function installInspection({contentFor, changed, allowed=()=>true}) {
  const root=document.createElement('div');root.id='inspection-root';document.body.append(root);
  let anchor=null,pinned=false,openTimer,closeTimer,keyboard=false,suppressFocus=false;
  const clearTimers=()=>{clearTimeout(openTimer);clearTimeout(closeTimer);};
  const candidate=target=>target instanceof Element?target.closest('[data-inspect]'):null;
  function position(){
    if(!anchor?.isConnected){close();return;}
    const card=root.firstElementChild;if(!card)return;
    const a=anchor.getBoundingClientRect(),panel=anchor.closest('.screen-battle .hero-panel');
    // Keep the current hero's controls reachable, including manual R while reading it.
    const above=panel?.getBoundingClientRect().top;
    const ceiling=panel?document.querySelector('.battle-shell .topbar').getBoundingClientRect().bottom+8:8;
    const reserveControls=above-ceiling>=140;
    card.style.maxHeight=`${reserveControls?Math.min(innerHeight-16,above-ceiling-8):innerHeight-16}px`;
    const r=card.getBoundingClientRect();
    card.style.left=`${Math.max(8,Math.min(innerWidth-r.width-8,a.left))}px`;
    card.style.top=`${reserveControls?above-r.height-8:Math.max(8,Math.min(innerHeight-r.height-8,a.top-r.height-8>=8?a.top-r.height-8:a.bottom+8))}px`;
  }
  function close(restore=false){
    clearTimers();const previous=anchor,wasOpen=!!anchor;
    anchor?.removeAttribute('aria-describedby');anchor=null;pinned=false;root.innerHTML='';
    if(wasOpen)changed(false);
    if(restore&&previous?.isConnected){suppressFocus=true;previous.focus({preventScroll:true});suppressFocus=false;}
  }
  function show(element,fix=false){
    clearTimers();if(!element?.isConnected||!allowed())return;
    const content=contentFor(element);if(!content)return;
    anchor?.removeAttribute('aria-describedby');anchor=element;pinned=fix;
    root.innerHTML=`<section class="inspection-card" id="inspection-card" role="dialog" aria-modal="false" aria-label="详情"><header><b>技能与装备说明</b><button class="btn icon-btn" data-inspection-close aria-label="关闭说明">×</button></header><div class="inspection-copy">${content}</div></section>`;
    anchor.setAttribute('aria-describedby','inspection-card');position();changed(true);
  }
  document.addEventListener('pointerdown',event=>{
    keyboard=false;
    if(!root.contains(event.target)&&!candidate(event.target))close();
  },true);
  document.addEventListener('keydown',event=>{
    if(event.key==='Tab')keyboard=true;
    if(event.key==='Escape'&&anchor){close(true);event.preventDefault();event.stopImmediatePropagation();}
  },true);
  document.addEventListener('focusin',event=>{if(keyboard&&!suppressFocus){const el=candidate(event.target);if(el)show(el,true);}});
  document.addEventListener('pointerover',event=>{
    if(event.pointerType!=='mouse'||pinned)return;
    if(root.contains(event.target)){clearTimers();return;}
    const el=candidate(event.target);if(!el||el.contains(event.relatedTarget))return;
    clearTimers();if(el===anchor)return;
    if(anchor){show(el);return;}
    openTimer=setTimeout(()=>show(el),400);
  });
  document.addEventListener('pointerout',event=>{
    if(event.pointerType!=='mouse'||pinned)return;
    const el=candidate(event.target),next=event.relatedTarget;
    if(el&&el.contains(next)||root.contains(event.target)&&root.contains(next))return;
    clearTimeout(openTimer);
    if(anchor||root.contains(event.target))closeTimer=setTimeout(()=>close(),150);
  });
  root.addEventListener('click',event=>{if(event.target.closest('[data-inspection-close]'))close(true);});
  window.addEventListener('resize',()=>{clearTimers();if(anchor)position();});
  document.addEventListener('scroll',event=>{if(anchor&&!root.contains(event.target))position();},true);
  return {show,close,get active(){return !!anchor;}};
}
