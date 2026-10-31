import { request } from './api/http.js';
export function bindOrdering(root, getTasks, reload, announce) {
  let saving=false, drag=null;
  async function move(id,status,beforeId) {
    if(saving) return;
    saving=true; root.setAttribute('aria-busy','true'); announce('Zapisywanie kolejności…');
    try {
      await request('/api/tasks/move',{method:'POST',body:{id,status,beforeId,expected:getTasks().map(({id,status,position})=>({id,status,position:Number(position)}))}});
      await reload(); announce('Zmieniono położenie zadania.');
      root.querySelector(`[data-move="${id}"]`)?.focus();
    } catch(error) { announce(error.message); } // Pessimistic UI: never mutate local order before success.
    finally { saving=false; root.setAttribute('aria-busy','false'); }
  }
  root.addEventListener('keydown', e=>{
    const handle=e.target.closest('[data-move]'); if(!handle || saving) return;
    const id=Number(handle.dataset.move), task=getTasks().find(t=>t.id===id);
    if(!task) return;
    const statuses=['todo','in_progress','done'];
    const column=getTasks().filter(t=>t.status===task.status).sort((a,b)=>a.position-b.position||a.id-b.id);
    const index=column.findIndex(t=>t.id===id);
    if(e.key==='ArrowUp' && index>0) { e.preventDefault(); move(id,task.status,column[index-1].id); }
    if(e.key==='ArrowDown' && index<column.length-1) { e.preventDefault(); move(id,task.status,column[index+2]?.id??null); }
    if(['ArrowLeft','ArrowRight'].includes(e.key)) { const target=statuses[statuses.indexOf(task.status)+(e.key==='ArrowLeft'?-1:1)]; if(target) { e.preventDefault(); move(id,target,null); } }
  });
  root.addEventListener('pointerdown',e=>{
    const handle=e.target.closest('[data-move]'); if(!handle || saving || e.button!==0) return;
    e.preventDefault(); handle.setPointerCapture(e.pointerId);
    drag={id:Number(handle.dataset.move),handle,x:e.clientX,y:e.clientY,moved:false,target:null};
  });
  root.addEventListener('pointermove',e=>{
    if(!drag) return;
    if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<8 && !drag.moved) return;
    drag.moved=true; drag.handle.classList.add('moving');
    root.querySelectorAll('.drop-indicator').forEach(el=>el.classList.remove('drop-indicator'));
    const el=document.elementFromPoint(e.clientX,e.clientY);
    const section=el?.closest('[data-column]');
    const card=el?.closest('[data-task]');
    drag.target=section?{status:section.dataset.column,beforeId:card?Number(card.dataset.task):null}:null;
    (card||section)?.classList.add('drop-indicator');
  });
  function clear() { if(drag) drag.handle.classList.remove('moving'); root.querySelectorAll('.drop-indicator').forEach(el=>el.classList.remove('drop-indicator')); drag=null; }
  root.addEventListener('pointercancel',clear);
  root.addEventListener('pointerup',()=>{ const current=drag; clear(); if(current?.moved && current.target && current.target.beforeId!==current.id) move(current.id,current.target.status,current.target.beforeId); });
}
