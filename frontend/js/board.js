import { categoryRows, categoryWriter } from "./category-actions.js";
import { bindOrdering } from "./ordering.js";
import { request } from './api/http.js';
import { escapeHtml, safeColor } from './utils/helpers.js';
const labels = { todo: 'Do zrobienia', in_progress: 'W trakcie', done: 'Zrobione' };
export function card(task, categories) {
  const category = categories.find(c => c.id === task.categoryId);
  return `<article class="board-card" data-task="${Number(task.id)}"><button class="move-handle" data-move="${Number(task.id)}" aria-label="Przenieś zadanie: strzałki góra/dół zmieniają kolejność, lewo/prawo kolumnę">↕ Przenieś</button><h3>${escapeHtml(task.title)}</h3><p>${escapeHtml(task.description)}</p><p>${escapeHtml(task.priority)} · <span data-category="${Number(category?.id)}">${escapeHtml(category?.name || 'Bez kategorii')}</span></p><p>${task.dueDate ? `Termin: ${escapeHtml(task.dueDate)}` : 'Bez terminu'}</p><button data-edit="${Number(task.id)}">Edytuj</button></article>`;
}
export async function submitTaskForm(form, editing, send = request) {
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.categoryId = payload.categoryId ? Number(payload.categoryId) : null;
  payload.dueDate = payload.dueDate || null;
  payload.position = Number(payload.position);
  if (editing) {
    const original = {
      title: editing.title,
      description: editing.description,
      status: editing.status,
      priority: editing.priority,
      categoryId: editing.categoryId,
      dueDate: editing.dueDate,
      position: editing.position
    };
    const changed = Object.fromEntries(Object.entries(payload).filter(([key, value]) =>
      !Object.hasOwn(editing, key) || String(original[key] ?? '') !== String(value ?? '')
    ));
    return send(`/api/tasks/${editing.id}`, { method: 'PATCH', body: changed });
  }
  return send('/api/tasks', { method: 'POST', body: { ...payload, date: new Date().toISOString().slice(0, 10) } });
}

export async function initBoard() {
  const root = document.querySelector('#kanban');
  let tasks = [], categories = [], busy = false;
  root.innerHTML = `<header><h1>Mytko Tasks</h1><button id="new-task">Nowe zadanie</button></header><details><summary>Kategorie</summary><form id="category-form"><label>Nazwa <input name="name" required minlength="2" maxlength="50"></label><label>Kolor <input name="color" type="color" value="#4e45e4"></label><button>Zapisz kategorię</button></form><div id="category-list"></div></details><div class="board-tools"><label>Szukaj <input id="search" type="search"></label><label>Status <select id="status-filter"><option value="">Wszystkie</option>${Object.entries(labels).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label><label>Priorytet <select id="priority-filter"><option value="">Wszystkie</option>${['P0','P1','P2','P3'].map(p=>`<option>${p}</option>`).join('')}</select></label><label>Kategoria <select id="category-filter"><option value="">Wszystkie</option></select></label></div><p id="board-message" role="status" aria-live="polite"></p><button id="retry">Odśwież</button><div class="board-columns"></div><dialog id="task-dialog"><form id="task-form"><h2>Zadanie</h2><label>Tytuł <input name="title" required minlength="3" maxlength="255"></label><label>Opis <textarea name="description" maxlength="5000"></textarea></label><label>Status <select name="status">${Object.entries(labels).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label><label>Priorytet <select name="priority">${['P0','P1','P2','P3'].map(p=>`<option>${p}</option>`).join('')}</select></label><label>Kategoria <select name="categoryId"><option value="">Bez kategorii</option></select></label><label>Termin <input type="date" name="dueDate"></label><label>Kolejność <input type="number" min="0" step="1" name="position" required></label><p id="form-error" role="alert"></p><button type="submit">Zapisz</button><button type="button" id="remove-task">Usuń</button><button type="button" id="cancel-task">Anuluj</button></form></dialog>`;
  const $ = selector => root.querySelector(selector);
  const form = $('#task-form'), dialog = $('#task-dialog'); let editing = null;
  function render() {
    const query = $('#search').value.toLocaleLowerCase();
    const filtered = tasks.filter(t => (!$('#status-filter').value || t.status === $('#status-filter').value) && (!$('#priority-filter').value || t.priority === $('#priority-filter').value) && (!$('#category-filter').value || t.categoryId === Number($('#category-filter').value)) && `${t.title} ${t.description}`.toLocaleLowerCase().includes(query));
    $('.board-columns').innerHTML = Object.entries(labels).map(([status,label]) => {
      const column = filtered.filter(t=>t.status===status).sort((a,b)=>a.position-b.position || a.id-b.id);
      return `<section data-column="${status}" aria-label="${label}"><h2>${label} (${column.length})</h2>${column.map(t=>card(t,categories)).join('') || '<p>Brak zadań</p>'}</section>`;
    }).join('');
    root.querySelectorAll('[data-category]').forEach(el => { const c=categories.find(c=>c.id===Number(el.dataset.category)); el.style.borderColor=safeColor(c?.color); el.style.backgroundColor=`${safeColor(c?.color, '#cccccc')}22`; });
  }
  async function load() {
    $('#board-message').textContent='Ładowanie…';
    try {
      [tasks,categories] = await Promise.all([request('/api/tasks'),request('/api/categories')]);
      const options = categories.map(c=>`<option value="${Number(c.id)}">${escapeHtml(c.name)}</option>`).join('');
      const selected=$('#category-filter').value;
      $('#category-filter').innerHTML='<option value="">Wszystkie</option>'+options; $('#category-filter').value=selected;
      form.elements.categoryId.innerHTML='<option value="">Bez kategorii</option>'+options;
      $('#category-list').innerHTML=categoryRows(categories);
      render(); $('#board-message').textContent=''; return true;
    } catch(e) { $('#board-message').textContent=e.message; return false; }
  }
  function open(task = null) {
    editing=task; form.reset(); $('#form-error').textContent='';
    const values=task || { title:'', description:'', status:'todo', priority:'P2', categoryId:'', dueDate:'', position:Math.max(0,...tasks.map(t=>t.position))+1 };
    for(const key of ['title','description','status','priority','categoryId','dueDate','position']) form.elements[key].value=values[key] ?? '';
    $('#remove-task').hidden=!task; dialog.showModal(); form.elements.title.focus();
  }
  $('#new-task').onclick=()=>open(); $('#cancel-task').onclick=()=>dialog.close(); $('#retry').onclick=load;
  for(const selector of ['#search','#status-filter','#priority-filter','#category-filter']) $(selector).addEventListener('input',render);
  $('.board-columns').onclick=e=>{ const button=e.target.closest('[data-edit]'); if(button) open(tasks.find(t=>t.id===Number(button.dataset.edit))); };
  form.onsubmit=async e=>{
    e.preventDefault(); if(busy) return; busy=true; form.querySelector('[type=submit]').disabled=true;
    try {
      await submitTaskForm(form, editing);
      dialog.close(); await load();
    } catch(error) { $('#form-error').textContent=error.message; }
    finally { busy=false; form.querySelector('[type=submit]').disabled=false; }
  };
  $('#remove-task').onclick=async()=>{ if(busy || !editing || !confirm('Usunąć zadanie?')) return; busy=true; try { await request(`/api/tasks/${editing.id}`,{method:'DELETE'}); dialog.close(); await load(); } catch(e) { $('#form-error').textContent=e.message; } finally { busy=false; } };
  bindOrdering(root,()=>tasks,load,message=>{ $('#board-message').textContent=message; });
  const writeCategory=categoryWriter(load);
  let categoryEditing=null;
  $('#category-list').onclick=async e=>{
    const edit=e.target.closest('[data-category-edit]');
    if(edit) { const c=categories.find(c=>c.id===Number(edit.dataset.categoryEdit)); categoryEditing=c.id; $('#category-form').elements.name.value=c.name; $('#category-form').elements.color.value=c.color; return; }
    const del=e.target.closest('[data-category-delete]');
    if(!del || busy || !confirm('Usunąć kategorię? Zadania pozostaną bez kategorii.')) return;
    busy=true; try { await writeCategory(Number(del.dataset.categoryDelete),'DELETE'); } catch(error){ $('#board-message').textContent=error.message; } finally {busy=false;}
  };
  $('#category-form').onsubmit=async e=>{
    e.preventDefault(); if(busy) return; busy=true;
    const data=Object.fromEntries(new FormData(e.target));
    try { await writeCategory(categoryEditing,categoryEditing?'PUT':'POST',data); categoryEditing=null; e.target.reset(); }
    catch(error){ $('#board-message').textContent=error.message; } finally {busy=false;}
  };
  await load();
}
