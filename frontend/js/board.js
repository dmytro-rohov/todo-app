import { icon } from './icons.js';
import { bindOrdering } from "./ordering.js";
import { request } from './api/http.js';
import { escapeHtml, safeColor } from './utils/helpers.js';
export const statuses = { todo: 'ToDo', in_progress: 'W realizacji', needs_review: 'Needs review', done: 'Zakończone' };
const statusIcons = { todo: 'circle', in_progress: 'play', needs_review: 'warning', done: 'done' };
const esc = escapeHtml;
export const SPACES = { work: 'Praca', private: 'Prywatne' };
export const spaceLabel = space => SPACES[space] || SPACES.private;
export function formatEstimate(minutes) {
  if (!Number.isInteger(minutes) || minutes < 1) return '';
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours ? `${hours} h${rest ? ` ${rest} min` : ''}` : `${rest} min`;
}
// "Today" is the user's calendar day in Warsaw (the product's time zone), as YYYY-MM-DD.
export const todayInWarsaw = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export const isOverdue = (task, today = todayInWarsaw()) => Boolean(task.dueDate) && task.dueDate < today && task.status !== 'done';
const options = items => items.map(item => `<option value="${Number(item.id)}">${esc(item.name)}</option>`).join('');
// Counters are computed from the real tasks. "overdue" and "today" are views over due dates, not statuses.
export function statCount(tasks, key, today = todayInWarsaw()) {
  if (key === 'all') return tasks.length;
  if (key === 'overdue') return tasks.filter(t => isOverdue(t, today)).length;
  if (key === 'today') return tasks.filter(t => t.dueDate === today && t.status !== 'done').length;
  return tasks.filter(t => t.status === key).length;
}
export function card(task, categories, projects = [], assignees = []) {
  const taskCategories = categories.filter(c => (task.labelIds || [task.categoryId]).includes(c.id));
  const project = projects.find(p => p.id === task.projectId);
  const assignee = assignees.find(a => a.id === task.assigneeId);
  const initials = assignee?.name.split(/\s+/).map(s => s[0]).slice(0,2).join('').toUpperCase();
  const date = task.dueDate ? new Intl.DateTimeFormat('pl', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(task.dueDate)) : 'Bez terminu';
  return `<article class="board-card" data-task="${Number(task.id)}" data-state="${esc(task.status)}">
    <div class="card-top"><span class="priority" data-priority="${esc(task.priority)}">${esc(task.priority)}</span><button class="card-edit" data-edit="${Number(task.id)}" aria-label="Edytuj zadanie ${esc(task.title)}">Edytuj</button></div>
    <h3>${esc(task.title)}</h3>${task.description ? `<p class="card-description">${esc(task.description)}</p>` : ''}
    <div class="card-tags"><span class="chip space-chip" data-space="${esc(task.space || 'private')}">${esc(spaceLabel(task.space))}</span>${project ? `<span class="chip project-chip">${icon('folder')}${esc(project.name)}</span>` : ''}${taskCategories.map(category=>`<span class="chip" data-category="${Number(category.id)}"><i></i>${esc(category.name)}</span>`).join('')}</div>
    <footer class="card-footer"><span class="avatar" title="${esc(assignee?.name || 'Nieprzypisane')}">${initials ? esc(initials) : icon('person')}</span><span class="card-date${isOverdue(task) ? ' is-overdue' : ''}">${icon('calendar')}${esc(date)}</span>${task.subtaskTotal ? `<span class="card-subtasks" title="Podzadania" data-subtasks="${Number(task.subtaskDone)}/${Number(task.subtaskTotal)}">${icon('check')}${Number(task.subtaskDone)}/${Number(task.subtaskTotal)}</span>` : ''}${formatEstimate(task.estimateMinutes) ? `<span class="card-estimate" title="Planowany czas">${esc(formatEstimate(task.estimateMinutes))}</span>` : ''}<button class="move-handle" data-move="${Number(task.id)}" aria-label="Przenieś zadanie: strzałki góra/dół zmieniają kolejność, lewo/prawo kolumnę">${icon(statusIcons[task.status])}</button></footer>
  </article>`;
}
export function filterTasks(tasks, filters, categories = [], projects = [], assignees = []) {
  const query = (filters.search || '').toLocaleLowerCase();
  return tasks.filter(task => (!filters.status || task.status === filters.status) && (!filters.space || (task.space || 'private') === filters.space) &&
    (!filters.priority || task.priority === filters.priority) && (!filters.categoryId || (task.labelIds || [task.categoryId]).includes(Number(filters.categoryId))) &&
    (!filters.projectId || task.projectId === Number(filters.projectId)) && (!filters.assigneeId || task.assigneeId === Number(filters.assigneeId)) &&
    (filters.showDone !== false || task.status !== 'done') &&
    [task.title, task.description, categories.filter(c=>(task.labelIds || [task.categoryId]).includes(c.id)).map(c=>c.name).join(' '), projects.find(p=>p.id===task.projectId)?.name, assignees.find(a=>a.id===task.assigneeId)?.name].join(' ').toLocaleLowerCase().includes(query));
}
function titleError(title) {
  return title.trim().length < 3 || title.length > 100 ? 'Tytuł musi mieć od 3 do 100 znaków.' : '';
}
export function validateTitleInput(input, originalTitle = null) {
  // Permit the unchanged legacy value, but validate every replacement as a new title.
  input.minLength = originalTitle === null ? 3 : Math.min(3, originalTitle.length);
  input.maxLength = Math.max(100, originalTitle?.length || 0);
  input.setCustomValidity(input.value === originalTitle ? '' : titleError(input.value));
}
export async function submitTaskForm(form, editing, send = request) {
  const data = new FormData(form);
  const payload = Object.fromEntries(data.entries());
  payload.categoryId = payload.categoryId ? Number(payload.categoryId) : null;
  for (const key of ['projectId', 'assigneeId']) if (key in payload) payload[key] = payload[key] ? Number(payload[key]) : null;
  if (form.elements?.labelIds) {
    payload.labelIds = [...new Set([payload.categoryId, ...data.getAll('labelIds').map(Number)].filter(Boolean))];
    payload.categoryId = payload.labelIds[0] ?? null;
  }
  payload.dueDate = payload.dueDate || null;
  if ('startDate' in payload) payload.startDate = payload.startDate || null;
  if ('estimateMinutes' in payload) payload.estimateMinutes = payload.estimateMinutes ? Number(payload.estimateMinutes) : null;
  if ('space' in payload && !['work', 'private'].includes(payload.space)) payload.space = 'private';
  payload.position = Number(payload.position);
  if (editing) {
    const original = {
      labelIds: editing.labelIds || (editing.categoryId ? [editing.categoryId] : []),
      projectId: editing.projectId,
      assigneeId: editing.assigneeId,
      title: editing.title,
      description: editing.description,
      status: editing.status,
      priority: editing.priority,
      categoryId: editing.categoryId,
      dueDate: editing.dueDate,
      space: editing.space,
      startDate: editing.startDate,
      estimateMinutes: editing.estimateMinutes,
      position: editing.position
    };
    const changed = Object.fromEntries(Object.entries(payload).filter(([key, value]) =>
      !Object.hasOwn(editing, key) || (key === 'labelIds' ? String([...(original[key] || [])].sort((a,b)=>a-b)) !== String([...value].sort((a,b)=>a-b)) : String(original[key] ?? '') !== String(value ?? ''))
    ));
    // Swapping the primary label must also rewrite the additional-label relation,
    // even when the overall set is unchanged.
    if ('categoryId' in changed && 'labelIds' in payload) changed.labelIds = payload.labelIds;
    if (!Object.keys(changed).length) return editing;
    if ('title' in changed && titleError(changed.title)) throw new Error(titleError(changed.title));
    return send(`/api/tasks/${editing.id}`, { method: 'PATCH', body: changed });
  }
  if (titleError(payload.title)) throw new Error(titleError(payload.title));
  return send('/api/tasks', { method: 'POST', body: { ...payload, date: new Date().toISOString().slice(0, 10) } });
}

export async function initBoard() {
  const root = document.querySelector('#kanban');
  let tasks = [], categories = [], projects = [], assignees = [], busy = false, editing = null, view = 'board';
  let directory = 'projects', directoryEditing = null;
  const directoryNames = { projects: 'Projekty', assignees: 'Wykonawcy', categories: 'Etykiety' };
  root.innerHTML = `
    <aside class="sidebar" id="sidebar" aria-label="Nawigacja główna">
      <a class="brand" href="#board"><span class="brand-mark">M</span><span>Mytko<small>TASKS</small></span></a>
      <nav><button class="nav-primary active" data-nav="board">${icon('check')}Tasks</button>
      <button data-nav="list">${icon('list')}Lista zadań</button>
      <div class="nav-caption">PRZESTRZEŃ</div>
      <div id="space-switch" class="space-switch" role="group" aria-label="Przestrzeń zadań"><button type="button" data-space="" class="active" aria-pressed="true">Wszystko</button><button type="button" data-space="work" aria-pressed="false">Praca</button><button type="button" data-space="private" aria-pressed="false">Prywatne</button></div>
      <div class="nav-caption">ORGANIZACJA</div>
      <button data-manage="projects">${icon('folder')}Projekty</button><button data-manage="assignees">${icon('person')}Wykonawcy</button><button data-manage="categories">${icon('tag')}Etykiety</button></nav>
      <div class="sidebar-bottom"><label>Projekt<select id="sidebar-project"><option value="">Wszystkie projekty</option></select></label>
      <div class="profile">${icon('person')}<div><strong id="profile-name">Mytko Tasks</strong><small>Przestrzeń zadań</small></div></div></div>
    </aside>
    <div class="workspace"><div class="topbar"><div class="breadcrumb"><button id="menu-toggle" aria-label="Otwórz menu" aria-controls="sidebar" aria-expanded="false">${icon('menu')}</button><span>Projekty</span><span>/</span><strong id="breadcrumb-project">Wszystkie</strong><span>/</span><strong>Tasks</strong></div>
      <label class="search-box">${icon('search')}<input id="search" type="search" aria-label="Szukaj zadań, osób lub etykiet" placeholder="Szukaj zadań, osób lub etykiet…"><kbd>Ctrl K</kbd></label></div>
    <header class="page-header"><div class="page-heading"><span class="page-mark">${icon('check')}</span><div><h1>Tasks</h1><p id="page-description">Zadania, prace i działania w Twoich projektach</p></div></div><div class="stats" id="task-stats"></div></header>
    <div class="viewbar"><div class="view-tabs" role="tablist" aria-label="Widok zadań"><button role="tab" id="board-tab" data-view="board" aria-selected="true" aria-controls="task-view">${icon('board')}Tablica</button><button role="tab" id="list-tab" data-view="list" tabindex="-1" aria-selected="false" aria-controls="task-view">${icon('list')}Lista</button></div><button class="primary" id="new-task">${icon('plus')}Nowe zadanie</button></div>
    <div class="board-tools"><select id="status-filter" aria-label="Status"><option value="">Wszystkie zadania</option>${Object.entries(statuses).map(([s,n])=>`<option value="${s}">${n}</option>`).join('')}</select><select id="project-filter" aria-label="Projekt"><option value="">Wszystkie projekty</option></select><select id="category-filter" aria-label="Etykieta"><option value="">Wszystkie etykiety</option></select><select id="assignee-filter" aria-label="Wykonawca"><option value="">Wszyscy wykonawcy</option></select><select id="priority-filter" aria-label="Priorytet"><option value="">Priorytet</option>${['P0','P1','P2','P3'].map(p=>`<option>${p}</option>`).join('')}</select><label class="toggle"><input id="show-done" type="checkbox" checked><span></span>Pokaż zakończone</label></div>
    <div class="feedback"><p id="board-message" role="status" aria-live="polite"></p><button id="retry" aria-label="Odśwież zadania">${icon('refresh')}</button></div>
    <div id="task-view" role="tabpanel" aria-labelledby="board-tab"><div class="board-columns"></div></div></div>
    <dialog id="task-dialog" aria-labelledby="task-dialog-title"><form id="task-form"><div class="dialog-heading"><h2 id="task-dialog-title">Nowe zadanie</h2><button type="button" id="cancel-task" aria-label="Zamknij">${icon('close')}</button></div><label>Tytuł<input name="title" required minlength="3" maxlength="100" placeholder="Co jest do zrobienia?"></label><label>Opis<textarea name="description" maxlength="5000" rows="3" placeholder="Szczegóły zadania"></textarea></label><div class="form-grid"><label>Status<select name="status">${Object.entries(statuses).map(([s,n])=>`<option value="${s}">${n}</option>`).join('')}</select></label><label>Priorytet<select name="priority">${['P0','P1','P2','P3'].map(p=>`<option>${p}</option>`).join('')}</select></label><label>Projekt<select name="projectId"></select></label><label>Wykonawca<select name="assigneeId"></select></label><label>Etykieta główna<select name="categoryId"></select></label><label>Dodatkowe etykiety<select name="labelIds" multiple size="3" aria-describedby="labels-help"></select><small id="labels-help">Ctrl / ⌘ pozwala wybrać kilka etykiet.</small></label><label>Przestrzeń<select name="space"><option value="private">Prywatne</option><option value="work">Praca</option></select></label><label>Start<input name="startDate" type="date"></label><label>Termin<input name="dueDate" type="date"></label><label>Planowany czas (min)<input name="estimateMinutes" type="number" min="1" max="10080" step="1" placeholder="np. 90"></label><label>Kolejność<input name="position" type="number" min="0" step="1" required></label></div><p id="form-error" role="alert"></p><div class="dialog-actions"><button type="button" id="remove-task" class="danger">Usuń</button><button type="submit" class="primary">Zapisz</button></div></form></dialog>
    <dialog id="directory-dialog" aria-labelledby="directory-title"><div class="dialog-heading"><h2 id="directory-title"></h2><button id="close-directory" aria-label="Zamknij">${icon('close')}</button></div><p class="muted" id="directory-hint"></p><form id="directory-form"><label>Nazwa<input name="name" required minlength="2" maxlength="80"></label><label id="directory-color">Kolor<input type="color" name="color" value="#a9e936"></label><div class="dialog-actions"><button type="button" id="cancel-directory-edit" hidden>Anuluj edycję</button><button class="primary">Dodaj</button></div></form><p id="directory-error" role="alert"></p><div id="directory-list"></div></dialog>`;
  const $ = selector => root.querySelector(selector);
  const form = $('#task-form'), dialog = $('#task-dialog');
  function filters() {
    return { search: $('#search').value, status: $('#status-filter').value, priority: $('#priority-filter').value, categoryId: $('#category-filter').value, projectId: $('#project-filter').value, assigneeId: $('#assignee-filter').value, showDone: $('#show-done').checked, space: $('#space-switch .active')?.dataset.space || '' };
  }
  function render() {
    const filtered = filterTasks(tasks, filters(), categories, projects, assignees);
    // Counters share search/project/label/person scope, independently of status visibility.
    const scope = filterTasks(tasks, { ...filters(), status: '', showDone: true }, categories, projects, assignees);
    $('#task-stats').innerHTML = [['all','Wszystkie','calendar'],['todo','Do zrobienia','circle'],['in_progress','W realizacji','play'],['needs_review','Needs review','warning'],['done','Zakończone','done'],['overdue','Zaległe','warning'],['today','Na dziś','calendar']].map(([s,n,i])=>`<button class="stat" data-stat="${s}" aria-pressed="${$('#status-filter').value === (s === 'all' ? '' : s)}">${icon(i)}<span><strong>${statCount(scope,s)}</strong><small>${n}</small></span></button>`).join('');
    $('.board-columns').classList.toggle('list-view', view === 'list');
    $('.board-columns').innerHTML = Object.entries(statuses).map(([status,name])=>{
      const column=filtered.filter(t=>t.status===status).sort((a,b)=>a.position-b.position||a.id-b.id);
      return `<section class="board-column" data-column="${status}" aria-label="${name}"><header class="column-heading"><h2>${icon(statusIcons[status])}${name}<span class="count">${column.length}</span></h2><button data-add="${status}" aria-label="Dodaj zadanie: ${name}">${icon('plus')}</button></header><div class="column-cards">${column.map(t=>card(t,categories,projects,assignees)).join('') || '<div class="empty-column">Brak zadań w tym widoku</div>'}</div><button class="quick-add" data-add="${status}">${icon('plus')}Dodaj zadanie</button></section>`;
    }).join('');
    root.querySelectorAll('[data-category]').forEach(el=>{ const c=categories.find(c=>c.id===Number(el.dataset.category)); el.style.setProperty('--label-color',safeColor(c?.color)); });
    const project=projects.find(p=>p.id===Number($('#project-filter').value));
    $('#breadcrumb-project').textContent=project?.name || 'Wszystkie';
    $('#page-description').textContent=project ? `Zadania, prace i działania w projekcie ${project.name}` : 'Zadania, prace i działania w Twoich projektach';
  }
  function fillSelect(selector, items, placeholder) {
    const el=$(selector), previous=el.value;
    el.innerHTML=`<option value="">${placeholder}</option>`+options(items);
    el.value=items.some(item=>String(item.id)===previous)?previous:'';
  }
  async function load() {
    $('#board-message').textContent='Ładowanie…';
    try {
      const next=await Promise.all(['/api/tasks','/api/categories','/api/projects','/api/assignees'].map(path=>request(path)));
      [tasks,categories,projects,assignees]=next;
      fillSelect('#project-filter',projects,'Wszystkie projekty'); fillSelect('#sidebar-project',projects,'Wszystkie projekty');
      fillSelect('#category-filter',categories,'Wszystkie etykiety'); fillSelect('#assignee-filter',assignees,'Wszyscy wykonawcy');
      for (const [key,items,placeholder] of [['categoryId',categories,'Bez etykiety'],['projectId',projects,'Bez projektu'],['assigneeId',assignees,'Nieprzypisane']]) {
        const field=form.elements[key], previous=field.value;
        field.innerHTML=`<option value="">${placeholder}</option>`+options(items); field.value=previous;
      }
      form.elements.labelIds.innerHTML=options(categories);
      $('#sidebar-project').value=$('#project-filter').value;
      render(); $('#board-message').textContent=tasks.length?'':'Dodaj pierwsze zadanie, aby rozpocząć.'; return true;
    } catch(error) { $('#board-message').textContent=error.message; return false; }
  }
  function open(task=null, status='todo') {
    editing=task; form.reset(); $('#form-error').textContent='';
    const values=task || { title:'',description:'',status,priority:'P2',categoryId:$('#category-filter').value,projectId:$('#project-filter').value,assigneeId:$('#assignee-filter').value,dueDate:'',startDate:'',estimateMinutes:'',space:$('#space-switch .active')?.dataset.space||'private',position:Math.max(0,...tasks.map(t=>Number(t.position)))+1 };
    for(const key of ['title','description','status','priority','categoryId','projectId','assigneeId','dueDate','startDate','estimateMinutes','space','position']) form.elements[key].value=values[key]??'';
    for(const option of form.elements.labelIds.options) option.selected=(task?.labelIds || []).includes(Number(option.value)) && Number(option.value)!==task?.categoryId;
    validateTitleInput(form.elements.title,task?.title??null);
    $('#task-dialog-title').textContent=task?'Edytuj zadanie':'Nowe zadanie'; $('#remove-task').hidden=!task;
    dialog.showModal(); form.elements.title.focus();
  }
  function changeView(next) {
    view=next;
    root.querySelectorAll('[data-view]').forEach(b=>{ b.setAttribute('aria-selected',String(b.dataset.view===view)); b.tabIndex=b.dataset.view===view?0:-1; });
    root.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===view));
    $('#task-view').setAttribute('aria-labelledby',view+'-tab'); render();
  }
  $('#new-task').onclick=()=>open(); $('#cancel-task').onclick=()=>dialog.close(); $('#retry').onclick=load;
  const mobileMenu=window.matchMedia('(max-width: 900px)');
  const syncMenu=()=>{ $('#sidebar').inert=mobileMenu.matches&&!root.classList.contains('menu-open'); };
  mobileMenu.addEventListener('change',syncMenu);syncMenu();
  $('.brand').onclick=e=>{e.preventDefault();changeView('board');root.classList.remove('menu-open');$('#menu-toggle').setAttribute('aria-expanded','false');syncMenu();};
  $('#menu-toggle').onclick=()=>{const shown=root.classList.toggle('menu-open'); $('#menu-toggle').setAttribute('aria-expanded',String(shown));syncMenu();};
  for (const selector of ['#search','#status-filter','#project-filter','#category-filter','#priority-filter','#assignee-filter','#show-done']) $(selector).addEventListener('input',()=>{
    $('#sidebar-project').value=$('#project-filter').value; render();
  });
  $('#sidebar-project').onchange=()=>{ $('#project-filter').value=$('#sidebar-project').value; render(); };
  root.querySelectorAll('[data-view],[data-nav]').forEach(b=>b.onclick=()=>{changeView(b.dataset.view||b.dataset.nav);root.classList.remove('menu-open');$('#menu-toggle').setAttribute('aria-expanded','false');syncMenu();});
  $('#task-stats').onclick=e=>{const b=e.target.closest('[data-stat]');if(b&&!['overdue','today'].includes(b.dataset.stat)){$('#status-filter').value=b.dataset.stat==='all'?'':b.dataset.stat; if(b.dataset.stat==='done')$('#show-done').checked=true;render();}};
  $('.board-columns').onclick=e=>{const edit=e.target.closest('[data-edit]'),add=e.target.closest('[data-add]');if(edit)open(tasks.find(t=>t.id===Number(edit.dataset.edit)));if(add)open(null,add.dataset.add);};
  root.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#search').focus();}
    if(e.key==='Escape'){root.classList.remove('menu-open');$('#menu-toggle').setAttribute('aria-expanded','false');syncMenu();}
    const tab=e.target.closest('[data-view]');
    if(tab && ['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
      e.preventDefault(); const next=e.key==='Home'?'board':e.key==='End'?'list':tab.dataset.view==='board'?'list':'board';
      changeView(next); root.querySelector(`[data-view="${next}"]`).focus();
    }
  });
  form.elements.title.oninput=()=>validateTitleInput(form.elements.title,editing?.title??null);
  form.onsubmit=async e=>{
    e.preventDefault();if(busy)return;busy=true;form.querySelector('[type=submit]').disabled=true;
    try { await submitTaskForm(form,editing);dialog.close();await load(); }
    catch(error){$('#form-error').textContent=error.message;}
    finally{busy=false;form.querySelector('[type=submit]').disabled=false;}
  };
  $('#remove-task').onclick=async()=>{
    if(busy||!editing||!confirm('Usunąć zadanie?'))return;busy=true;
    try{await request(`/api/tasks/${editing.id}`,{method:'DELETE'});dialog.close();await load();}catch(error){$('#form-error').textContent=error.message;}finally{busy=false;}
  };
  // Always retain the full authoritative snapshot, even when the view is filtered.
  bindOrdering(root,()=>tasks,load,message=>{$('#board-message').textContent=message;});
  function directoryItems(){return directory==='projects'?projects:directory==='assignees'?assignees:categories;}
  function resetDirectory(){directoryEditing=null;$('#directory-form').reset();$('#directory-form button[type=submit], #directory-form button.primary').textContent='Dodaj';$('#cancel-directory-edit').hidden=true;}
  function renderDirectory(){
    $('#directory-list').innerHTML=directoryItems().map(item=>`<div class="directory-row"><span>${esc(item.name)}</span><button data-directory-edit="${Number(item.id)}">Edytuj</button><button data-directory-delete="${Number(item.id)}" class="danger">Usuń</button></div>`).join('')||'<p class="empty-column">Brak wpisów. Dodaj pierwszy powyżej.</p>';
  }
  root.querySelectorAll('[data-manage]').forEach(b=>b.onclick=()=>{
    directory=b.dataset.manage;resetDirectory();$('#directory-title').textContent=directoryNames[directory];
    $('#directory-hint').textContent=directory==='assignees'?'Wykonawcy są osobami przypisywanymi do zadań, bez kont logowania.':'Usunięcie wpisu nie usuwa przypisanych zadań.';
    $('#directory-color').hidden=directory!=='categories';$('#directory-form').elements.name.maxLength=directory==='categories'?50:80;
    $('#directory-error').textContent='';renderDirectory();$('#directory-dialog').showModal();
  });
  $('#close-directory').onclick=()=>$('#directory-dialog').close();$('#cancel-directory-edit').onclick=resetDirectory;
  $('#directory-form').onsubmit=async e=>{
    e.preventDefault();if(busy)return;busy=true;const button=e.target.querySelector('button.primary');button.disabled=true;
    const body={name:e.target.elements.name.value};if(directory==='categories')body.color=e.target.elements.color.value;
    try{await request(`/api/${directory}${directoryEditing?'/'+directoryEditing:''}`,{method:directoryEditing?'PUT':'POST',body});if(await load()){resetDirectory();renderDirectory();$('#directory-error').textContent='';}else{$('#directory-error').textContent='Zapisano. Odśwież dane przed kolejną zmianą.';}}
    catch(error){$('#directory-error').textContent=error.message;}finally{busy=false;button.disabled=false;}
  };
  $('#directory-list').onclick=async e=>{
    const edit=e.target.closest('[data-directory-edit]'),del=e.target.closest('[data-directory-delete]');
    if(edit){const item=directoryItems().find(i=>i.id===Number(edit.dataset.directoryEdit));directoryEditing=item.id;$('#directory-form').elements.name.value=item.name;if(directory==='categories')$('#directory-form').elements.color.value=item.color;$('#directory-form button.primary').textContent='Zapisz';$('#cancel-directory-edit').hidden=false;return;}
    if(!del||busy||!confirm('Usunąć wpis? Zadania zostaną zachowane.'))return;busy=true;
    try{await request(`/api/${directory}/${Number(del.dataset.directoryDelete)}`,{method:'DELETE'});if(await load()){resetDirectory();renderDirectory();$('#directory-error').textContent='';}}
    catch(error){$('#directory-error').textContent=error.message;}finally{busy=false;}
  };
  await load();
  try{const me=await request('/api/me');$('#profile-name').textContent=me.name;}catch(error){$('#profile-name').textContent='Profil niedostępny';}
}
