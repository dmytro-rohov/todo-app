const {test}=require('node:test');const assert=require('node:assert/strict');
const {startApp,SAME_ORIGIN_JSON}=require('./support');
test('category HTTP CRUD, duplicate names allowed, normalized values and missing IDs',async()=>{
 let rows=[],next=1;const pool={async query(sql,p=[]){
 if(sql.includes('__drizzle_migrations'))return {rows:[]};
 if(sql.includes('INSERT INTO categories')){const row={id:next++,name:p[0],color:p[1]};rows.push(row);return {rows:[row],rowCount:1};}
 if(sql.includes('UPDATE categories')){const row=rows.find(r=>r.id===p[2]);if(row)Object.assign(row,{name:p[0],color:p[1]});return {rows:row?[row]:[],rowCount:row?1:0};}
 if(sql.includes('DELETE FROM categories')){const old=rows.length;rows=rows.filter(r=>r.id!==p[0]);return {rows:[],rowCount:old-rows.length};}
 return {rows,rowCount:rows.length};}};
 const ctx=await startApp({pool});const call=(method,path,body,extra={})=>ctx.request('/api/categories'+path,{method,headers:SAME_ORIGIN_JSON,...(body?{body:JSON.stringify(body)}:{}),...extra});
 try {
 assert.equal((await call('GET','')).status,200);
 for(let i=0;i<2;i++)assert.equal((await call('POST','',{name:' Same ',color:'#AABBCC'})).status,201);
 const edit=await call('PUT','/1',{name:'Changed',color:'#112233'});assert.equal(edit.status,200);assert.equal((await edit.json()).name,'Changed');
 for(const method of ['PUT','DELETE']){assert.equal((await call(method,'/bad',{name:'Ok',color:'#112233'})).status,400);assert.equal((await call(method,'/999',{name:'Ok',color:'#112233'})).status,404);assert.equal((await call(method,'/1',{name:'Ok',color:'#112233'},{auth:null})).status,401);assert.equal((await call(method,'/1',{name:'Ok',color:'#112233'},{headers:{...SAME_ORIGIN_JSON,'sec-fetch-site':'cross-site'}})).status,403);}
 for(const body of [{name:'',color:'#112233'},{name:'Ok',color:'red'}])assert.equal((await call('POST','',body)).status,400);
 assert.equal((await call('DELETE','/1')).status,200);assert.equal((await (await call('GET','')).json()).length,1);
 }finally{await ctx.close();}
});
