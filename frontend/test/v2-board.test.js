import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterTasks, card, submitTaskForm } from '../js/board.js';
const tasks = [
  { id:1,title:'Pierwsze',description:'Opis',status:'todo',priority:'P1',projectId:1,assigneeId:2,categoryId:3,labelIds:[3,4],position:0 },
  { id:2,title:'Drugie',description:'',status:'needs_review',priority:'P2',projectId:2,assigneeId:1,categoryId:4,labelIds:[4],position:0 },
  { id:3,title:'Trzecie',description:'',status:'done',priority:'P3',projectId:null,assigneeId:null,categoryId:null,labelIds:[],position:0 }
];
const categories=[{id:3,name:'Frontend',color:'#aabbcc'},{id:4,name:'UX',color:'#112233'}];
const projects=[{id:1,name:'Projekt alfa'},{id:2,name:'Projekt beta'}];
const assignees=[{id:1,name:'Anna Kowalska'},{id:2,name:'Jan Nowak'}];
const filter = f => filterTasks(tasks,f,categories,projects,assignees).map(t=>t.id);

test('V2 filters combine metadata, review status, priority and completed visibility',()=>{
  assert.deepEqual(filter({projectId:'1',assigneeId:'2',categoryId:'4',priority:'P1',status:'todo'}),[1]);
  assert.deepEqual(filter({categoryId:'4'}),[1,2]);
  assert.deepEqual(filter({status:'needs_review'}),[2]);
  assert.deepEqual(filter({showDone:false}),[1,2]);
  assert.deepEqual(filter({projectId:'1',assigneeId:'1'}),[]);
  assert.equal(tasks.length,3,'filtering must retain authoritative ordering snapshot');
});
test('search includes project, assignee and all category labels without case sensitivity',()=>{
  for(const [search,ids] of [['ALFA',[1]],['anna',[2]],['UX',[1,2]],['opis',[1]],['missing',[]]]) assert.deepEqual(filter({search}),ids);
});
test('cards expose actual metadata, all labels and escaped identity',()=>{
  const html=card({...tasks[0],title:'<script>',dueDate:'2026-11-03'},categories,projects,[{id:2,name:'<img src=x>'}]);
  assert.ok(html.includes('Frontend')&&html.includes('UX')&&html.includes('Projekt alfa'));
  assert.ok(html.includes('&lt;script&gt;')&&html.includes('&lt;img'));
  assert.ok(!html.includes('<img')&&!html.includes('<script>'));
  assert.match(html,/data-move="1"/); assert.match(html,/data-edit="1"/);
});
test('V2 form normalizes optional assignments and atomically submits multiple labels',async()=>{
  const Native=globalThis.FormData;
  const data={title:'A task',description:'',status:'needs_review',priority:'P2',categoryId:'',projectId:'2',assigneeId:'',dueDate:'',position:'0'};
  globalThis.FormData=class {entries(){return Object.entries(data);} getAll(){return ['4','3','4'];}};
  try{
    const calls=[];
    await submitTaskForm({elements:{labelIds:{}}},null,async(...args)=>calls.push(args));
    const body=calls[0][1].body;
    assert.equal(body.projectId,2);assert.equal(body.assigneeId,null);
    assert.deepEqual(body.labelIds,[4,3]);assert.equal(body.categoryId,4);
  }finally{globalThis.FormData=Native;}
});
test('unchanged V2 edits send nothing, while swapping primary label retains the complete set',async()=>{
  const Native=globalThis.FormData;
  const editing={...tasks[0],dueDate:null};
  const data={title:editing.title,description:editing.description,status:editing.status,priority:editing.priority,categoryId:'3',projectId:'1',assigneeId:'2',dueDate:'',position:'0'};
  let selected=['4'];
  globalThis.FormData=class {entries(){return Object.entries(data);}getAll(){return selected;}};
  const calls=[];
  try{
    await submitTaskForm({elements:{labelIds:{}}},editing,async(...args)=>calls.push(args));
    assert.equal(calls.length,0);
    data.categoryId='4';selected=['3'];
    await submitTaskForm({elements:{labelIds:{}}},editing,async(...args)=>calls.push(args));
    assert.deepEqual(calls[0][1].body,{categoryId:4,labelIds:[4,3]});
  }finally{globalThis.FormData=Native;}
});
