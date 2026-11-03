import { request } from './api/http.js';

async function snapshotToken(tasks) {
  const snapshot = tasks
    .map(({ id, status, position }) => [Number(id), status, Number(position)])
    .sort((a, b) => a[0] - b[0]);
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function bindOrdering(root, getTasks, reload, announce) {
  let saving=false, drag=null, scrollFrame=0;
  async function move(id,status,beforeId) {
    if(saving) return;
    saving=true; root.setAttribute('aria-busy','true'); announce('Zapisywanie kolejności…');
    try {
      await request('/api/tasks/move',{method:'POST',body:{id,status,beforeId,expected:await snapshotToken(getTasks())}});
      if (await reload() === false) { announce('Zapisano zmianę, ale odczyt tablicy nie powiódł się. Odśwież dane.'); return; } announce('Zmieniono położenie zadania.');
      root.querySelector(`[data-move="${id}"]`)?.focus();
    } catch(error) { announce(error.message); } // Pessimistic UI: never mutate local order before success.
    finally { saving=false; root.setAttribute('aria-busy','false'); }
  }
  root.addEventListener('keydown', async e=>{
    const handle=e.target.closest('[data-move]'); if(!handle || saving) return;
    const id=Number(handle.dataset.move), task=getTasks().find(t=>t.id===id);
    if(!task) return;
    const statuses=['todo','in_progress','needs_review','done'];
    const column=getTasks().filter(t=>t.status===task.status).sort((a,b)=>a.position-b.position||a.id-b.id);
    const index=column.findIndex(t=>t.id===id);
    if(e.key==='ArrowUp' && index>0) { e.preventDefault(); await move(id,task.status,column[index-1].id); }
    if(e.key==='ArrowDown' && index<column.length-1) { e.preventDefault(); await move(id,task.status,column[index+2]?.id??null); }
    if(['ArrowLeft','ArrowRight'].includes(e.key)) { const target=statuses[statuses.indexOf(task.status)+(e.key==='ArrowLeft'?-1:1)]; if(target) { e.preventDefault(); await move(id,target,null); } }
  });
  root.addEventListener('pointerdown',e=>{
    const handle=e.target.closest('[data-move]'); if(!handle || saving || e.button!==0) return;
    e.preventDefault(); handle.setPointerCapture(e.pointerId);
    drag={id:Number(handle.dataset.move),handle,x:e.clientX,y:e.clientY,moved:false,target:null};
  });
  function updateTarget() {
    if(!drag?.moved) return;
    root.querySelectorAll('.drop-indicator').forEach(el=>el.classList.remove('drop-indicator'));
    const el=document.elementFromPoint(drag.clientX,drag.clientY);
    const section=el?.closest('[data-column]');
    const card=el?.closest('[data-task]');
    drag.target=section && root.contains(section)?{status:section.dataset.column,beforeId:card?Number(card.dataset.task):null}:null;
    if(drag.target) (card||section)?.classList.add('drop-indicator');
  }
  function edgeScroll() {
    if(!drag?.moved) return;
    // Pointer capture + touch-action:none disable native scrolling during a
    // touch drag. Scroll the viewport at its edges so stacked columns remain reachable.
    const edge=60;
    const delta=drag.clientY<edge?-12:drag.clientY>window.innerHeight-edge?12:0;
    if(delta) window.scrollBy(0,delta);
    updateTarget();
    scrollFrame=requestAnimationFrame(edgeScroll);
  }
  root.addEventListener('pointermove',e=>{
    if(!drag) return;
    if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<8 && !drag.moved) return;
    drag.moved=true; drag.clientX=e.clientX; drag.clientY=e.clientY; drag.handle.classList.add('moving');
    updateTarget();
    if(!scrollFrame) scrollFrame=requestAnimationFrame(edgeScroll);
  });
  function clear() { if(scrollFrame)cancelAnimationFrame(scrollFrame);scrollFrame=0;if(drag) drag.handle.classList.remove('moving'); root.querySelectorAll('.drop-indicator').forEach(el=>el.classList.remove('drop-indicator')); drag=null; }
  root.addEventListener('pointercancel',clear);
  root.addEventListener('lostpointercapture',clear);
  root.addEventListener('pointerup',()=>{ const current=drag; clear(); if(current?.moved && current.target && current.target.beforeId!==current.id) move(current.id,current.target.status,current.target.beforeId); });
}
