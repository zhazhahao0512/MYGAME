// Pointer Events provide the same drag gesture for mouse, pen and touch.
// Only explicit handles disable touch scrolling; the rest of the page can scroll.
export function installPointerDrag({sourceFor, start, targetFor, drop, cancel}) {
  let gesture=null,frame=0,suppressUntil=0;
  const clear=()=>{
    cancelAnimationFrame(frame);frame=0;
    if(!gesture)return;
    const previous=gesture;gesture=null;
    previous.ghost?.remove();previous.target?.classList.remove('drop-hover');
    document.body.classList.remove('dragging');
    if(previous.handle.hasPointerCapture(previous.id))previous.handle.releasePointerCapture(previous.id);
    if(previous.active)suppressUntil=performance.now()+400;
  };
  const updateTarget=()=>{
    const g=gesture;if(!g?.active)return;
    const next=targetFor(document.elementFromPoint(g.x,g.y),g.source);
    if(g.target!==next){g.target?.classList.remove('drop-hover');next?.classList.add('drop-hover');g.target=next;}
    g.ghost.style.left=`${Math.min(innerWidth-145,Math.max(8,g.x+14))}px`;
    g.ghost.style.top=`${Math.min(innerHeight-70,Math.max(8,g.y-65))}px`;
  };
  const autoScroll=time=>{
    if(!gesture?.active)return;
    const elapsed=Math.min(32,time-(gesture.scrollTime||time));gesture.scrollTime=time;
    const edge=70, y=gesture.y;
    const speed=y<edge?-Math.ceil((edge-y)/5):y>innerHeight-edge?Math.ceil((y-innerHeight+edge)/5):0;
    if(speed)window.scrollBy(0,Math.max(-10,Math.min(10,speed))*elapsed/16);
    updateTarget();frame=requestAnimationFrame(autoScroll);
  };
  document.addEventListener('pointerdown',event=>{
    if(gesture||!event.isPrimary||event.button!==0)return;
    const handle=event.target.closest('[data-drag]');if(!handle)return;
    const source=sourceFor(handle);if(!source)return;
    gesture={handle,source,id:event.pointerId,x:event.clientX,y:event.clientY,originX:event.clientX,originY:event.clientY,active:false,target:null};
    handle.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointermove',event=>{
    const g=gesture;if(!g||event.pointerId!==g.id)return;
    g.x=event.clientX;g.y=event.clientY;
    if(!g.active&&Math.hypot(g.x-g.originX,g.y-g.originY)>8){
      g.active=true;start(g.source);
      g.ghost=document.createElement('div');g.ghost.className='drag-ghost';g.ghost.textContent=g.source.label;
      g.ghost.setAttribute('aria-hidden','true');document.body.append(g.ghost);document.body.classList.add('dragging');
      frame=requestAnimationFrame(autoScroll);
    }
    if(g.active){event.preventDefault();updateTarget();}
  },{passive:false});
  document.addEventListener('pointerup',event=>{
    const g=gesture;if(!g||event.pointerId!==g.id)return;
    const active=g.active;g.x=event.clientX;g.y=event.clientY;if(active)updateTarget();
    const target=g.target,source=g.source;clear();
    if(active){event.preventDefault();if(target)drop(source,target);else cancel();}
  });
  const abort=()=>{const active=gesture?.active;clear();if(active)cancel();};
  document.addEventListener('pointercancel',abort);
  document.addEventListener('lostpointercapture',event=>{if(gesture?.id===event.pointerId)abort();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')abort();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)abort();});
  window.addEventListener('blur',abort);
  document.addEventListener('click',event=>{
    // A real new press clears suppression; keyboard activation is never swallowed.
    if(event.detail&&performance.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();}
  },true);
  document.addEventListener('pointerdown',()=>{suppressUntil=0;},true);
  document.addEventListener('contextmenu',event=>{if(event.target.closest('[data-drag]'))event.preventDefault();});
  return {cancel:abort};
}
