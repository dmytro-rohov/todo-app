import {test} from 'node:test';
import assert from 'node:assert/strict';
import {categoryRows,categoryWriter} from '../js/category-actions.js';
test('category create/update/delete each refresh board once after success',async()=>{
 const calls=[];let refresh=0;const write=categoryWriter(async()=>{refresh++;},async(url,options)=>calls.push([url,options.method]));
 await write(null,'POST',{name:'Test'});await write(1,'PUT',{name:'Changed'});await write(1,'DELETE');
 assert.deepEqual(calls,[['/api/categories','POST'],['/api/categories/1','PUT'],['/api/categories/1','DELETE']]);assert.equal(refresh,3);
});
for(const status of [400,401,403,404,409]) test(`category error ${status} does not refresh and allows retry`,async()=>{
 let refresh=0,calls=0;const write=categoryWriter(async()=>refresh++,async()=>{calls++;throw new Error(String(status));});
 await assert.rejects(write(1,'PUT',{}),new RegExp(String(status)));await assert.rejects(write(1,'PUT',{}));assert.equal(calls,2);assert.equal(refresh,0);
});
test('concurrent category submit sends only one request',async()=>{
 let resolve,calls=0;const write=categoryWriter(async()=>{},()=>{calls++;return new Promise(r=>resolve=r);});const first=write(null,'POST',{});assert.equal(await write(null,'POST',{}),false);resolve();await first;assert.equal(calls,1);
});
test('category list escapes XSS and normalizes attribute IDs',()=>{const html=categoryRows([{id:'1" onclick="x',name:'<img onerror="x">'}]);assert.ok(!html.includes('<img'));assert.ok(!html.includes('onclick='));assert.ok(html.includes('&lt;img'));});
