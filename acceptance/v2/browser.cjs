'use strict';
// Explicit operator QA only. Reuses the central runtime contract; never installs
// Playwright, changes policy, starts Docker or targets production.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const runtime = require('../lite-1b93f7c/browser/runtime.cjs');
const { credentials } = require('../lite-1b93f7c/browser/auth.cjs');
const results = [];
const required = ['desktop','mobile'].flatMap(view=>['load','directories','create','unchanged-save','filters-and-list','keyboard-review-persistence','pointer-done','layout','cleanup','console'].map(step=>view+'-'+step));
const evidence = fs.mkdtempSync(path.join(os.tmpdir(),'tasks-v2-browser-'));
fs.chmodSync(evidence,0o700);
async function run() {
  const base=process.env.E2E_BASE;
  if(!/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(base||'') || process.env.TASKS_DISPOSABLE_APPROVED!=='yes') throw new runtime.BlockedError('Approved isolated loopback stack required');
  if(process.env.V2_STACK_VERIFIED!=='yes') throw new runtime.BlockedError('Operator must verify current V2 stack ownership, revision, isolation and allowed port');
  const auth=credentials(process.env);
  const prepared=await runtime.prepare(process.env,{forbiddenRoots:[path.resolve(__dirname,'../..')]});
  runtime.writePrivate(path.join(evidence,'runtime.json'),JSON.stringify(prepared.evidence,null,2)+'\n');
  let browser;
  try { browser=await prepared.playwright.chromium.launch(runtime.LAUNCH_OPTIONS); }
  catch(error){throw new runtime.BlockedError('Chromium launch failed: '+String(error.message).split('\n')[0]);}
  const check=async(name,page,fn)=>{
    try{await fn();await page.screenshot({path:path.join(evidence,name+'.png'),fullPage:true});results.push({name,status:'PASS'});}
    catch(error){results.push({name,status:'FAIL',error:String(error.message)});await page.screenshot({path:path.join(evidence,name+'-FAIL.png'),fullPage:true}).catch(()=>{});throw error;}
  };
  try {
    for(const [name,width,height] of [['desktop',1672,941],['mobile',390,844]]) {
      const context=await browser.newContext({viewport:{width,height},isMobile:name==='mobile',hasTouch:name==='mobile',httpCredentials:auth});
      const page=await context.newPage();
      const consoleErrors=[],pageErrors=[],failedRequests=[];
      page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
      page.on('pageerror',e=>pageErrors.push(e.message));
      page.on('requestfailed',r=>failedRequests.push({url:r.url(),error:r.failure()?.errorText}));
      await context.tracing.start({snapshots:true,screenshots:true});
      const token='QA '+Date.now()+' '+name;
      const manage=async(kind)=>{
        if(width<900 && !(await page.locator('#kanban').getAttribute('class')||'').includes('menu-open'))await page.locator('#menu-toggle').click();
        await page.locator(`[data-manage="${kind}"]`).click();
      };
      const addDirectory=async(kind,label)=>{
        await manage(kind);await page.locator('#directory-form [name=name]').fill(label);await page.locator('#directory-form button.primary').click();
        await page.locator('#directory-list .directory-row').filter({hasText:label}).waitFor();await page.locator('#close-directory').click();
      };
      try {
        await check(name+'-load',page,async()=>{
          assert.equal((await page.goto(base)).status(),200);
          await page.locator('#profile-name').filter({hasText:auth.username}).waitFor();
          assert.equal(await page.locator('[data-column]').count(),4);
          assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(7, 14, 10)');
          assert.ok(await page.evaluate(()=>[...document.styleSheets].some(s=>s.href?.endsWith('/dist/style.css')&&s.cssRules.length)));
        });
        await check(name+'-directories',page,async()=>{
          await addDirectory('projects',token+' project');await addDirectory('assignees',token+' person');await addDirectory('categories',token+' label');
          if(width<900 && (await page.locator('#kanban').getAttribute('class')||'').includes('menu-open'))await page.locator('#menu-toggle').click();
        });
        await check(name+'-create',page,async()=>{
          await page.locator('[data-column=todo] .quick-add').click();
          await page.locator('#task-form [name=title]').fill(token+' task');
          for(const [field,label] of [['projectId',' project'],['assigneeId',' person'],['categoryId',' label']])await page.locator(`#task-form [name=${field}]`).selectOption({label:token+label});
          await page.locator('#task-form [name=dueDate]').fill('2026-11-20');
          await page.locator('#task-form [type=submit]').click();
          await page.getByRole('heading',{name:token+' task',exact:true}).waitFor();
        });
        const card=()=>page.locator('.board-card').filter({has:page.getByRole('heading',{name:token+' task',exact:true})});
        await check(name+'-unchanged-save',page,async()=>{
          let writes=0;const listener=r=>{if(r.method()==='PATCH')writes++;};page.on('request',listener);
          await card().locator('[data-edit]').click();await page.locator('#task-form [type=submit]').click();
          await page.locator('#task-dialog').waitFor({state:'hidden'});page.off('request',listener);assert.equal(writes,0);
        });
        await check(name+'-filters-and-list',page,async()=>{
          await page.locator('#project-filter').selectOption({label:token+' project'});
          await page.locator('#assignee-filter').selectOption({label:token+' person'});
          await page.locator('#category-filter').selectOption({label:token+' label'});
          await page.locator('#search').fill(token);assert.equal(await page.locator('.board-card').count(),1);
          await page.locator('[data-view=list]').click();assert.ok((await page.locator('.board-columns').getAttribute('class')).includes('list-view'));
          await page.locator('[data-view=board]').click();
        });
        await check(name+'-keyboard-review-persistence',page,async()=>{
          // Move through every intermediate column, retaining the all-board token.
          for(const status of ['in_progress','needs_review']) {
            await card().locator('[data-move]').focus();await page.keyboard.press('ArrowRight');
            await page.locator(`[data-column=${status}] .board-card`).filter({hasText:token+' task'}).waitFor();
          }
          await page.reload();await page.locator('[data-column=needs_review] .board-card').filter({hasText:token+' task'}).waitFor();
          await card().locator('[data-edit]').click();await page.locator('#task-form [name=description]').fill('QA saved description');
          await page.locator('#task-form [type=submit]').click();await card().filter({hasText:'QA saved description'}).waitFor();
        });
        await check(name+'-pointer-done',page,async()=>{
          const handle=card().locator('[data-move]');await handle.scrollIntoViewIfNeeded();const from=await handle.boundingBox();
          const target=page.locator('[data-column=done]');
          if(name==='mobile') {
            // Real Chromium touch input exercises Pointer Events and edge scrolling.
            const cdp=await context.newCDPSession(page);
            const touch=async(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1}]});
            await touch('touchStart',from.x+from.width/2,from.y+from.height/2);
            await touch('touchMove',from.x+from.width/2,height-20);
            await page.waitForFunction(()=>{const r=document.querySelector('[data-column=done] .column-heading').getBoundingClientRect();return r.top<innerHeight-70&&r.bottom>60;});
            const to=await target.locator('.column-heading').boundingBox();
            await touch('touchMove',to.x+to.width/2,to.y+to.height/2);await touch('touchEnd');await cdp.detach();
          } else {
            await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();
            await page.mouse.move(from.x+from.width/2+10,from.y+from.height/2,{steps:3});
            await target.scrollIntoViewIfNeeded();const to=await target.locator('.column-heading').boundingBox();
            await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:15});await page.mouse.up();
          }
          await target.locator('.board-card').filter({hasText:token+' task'}).waitFor();
          await page.locator('#show-done').uncheck();assert.equal(await card().count(),0);await page.locator('#show-done').check();await card().waitFor();
        });
        await check(name+'-layout',page,async()=>{
          await page.evaluate(()=>scrollTo(0,0));
          assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
        });
        await check(name+'-cleanup',page,async()=>{
          await card().locator('[data-edit]').click();page.once('dialog',d=>d.accept());await page.locator('#remove-task').click();await card().waitFor({state:'detached'});
          for(const [kind,suffix]of [['projects',' project'],['assignees',' person'],['categories',' label']]){
            await manage(kind);const row=page.locator('.directory-row').filter({hasText:token+suffix});page.once('dialog',d=>d.accept());await row.locator('[data-directory-delete]').click();await row.waitFor({state:'detached'});await page.locator('#close-directory').click();
          }
        });
        await check(name+'-console',page,async()=>{assert.deepEqual(consoleErrors,[]);assert.deepEqual(pageErrors,[]);assert.deepEqual(failedRequests,[]);});
      } finally {
        runtime.writePrivate(path.join(evidence,'console-'+name+'.json'),JSON.stringify({consoleErrors,pageErrors,failedRequests},null,2));
        await context.tracing.stop({path:path.join(evidence,'trace-'+name+'.zip')});await context.close();
      }
    }
  } finally { await browser.close(); }
}
run().then(()=>finish('PASS')).catch(error=>finish(error instanceof runtime.BlockedError?'BLOCKED':'FAIL',error));
function finish(status,error){
  for(const file of fs.readdirSync(evidence))fs.chmodSync(path.join(evidence,file),0o600);
  const scenarios=required.map(name=>results.find(r=>r.name===name)||{name,status:'NOT_RUN'});
  const passed=scenarios.filter(r=>r.status==='PASS').length;
  if(status==='PASS'&&passed!==required.length)status='FAIL';
  runtime.writePrivate(path.join(evidence,'summary.json'),JSON.stringify({status,scenarios,passed,expected:required.length,error:error?.message||null},null,2)+'\n');
  console.log(status+'; evidence '+evidence);process.exitCode=status==='PASS'?0:status==='BLOCKED'?3:1;
}
