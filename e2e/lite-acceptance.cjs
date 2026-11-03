// Requires operator-provided Playwright + browser; no runtime dependency added.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async()=>{
  if(process.env.TASKS_DISPOSABLE_APPROVED!=='yes' || process.env.E2E_BASE!=='http://127.0.0.1:3101') throw Error('Disposable loopback acceptance target required');
  const browser=await chromium.launch();
  try {
    for(const viewport of [{width:1440,height:900},{width:390,height:844}]) {
      const context=await browser.newContext({viewport,httpCredentials:{username:'owner',password:'test-only-password'}});
      const page=await context.newPage();const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
      await page.goto(process.env.E2E_BASE);
      await page.getByText('Kategorie',{exact:true}).click();
      const categoryName=`QA category ${viewport.width}`;
      await page.locator('#category-form [name=name]').fill(categoryName);
      await page.locator('#category-form button').click();
      const categoryRow=page.locator('#category-list p').filter({hasText:categoryName});
      await categoryRow.waitFor();assert.equal(await categoryRow.count(),1);
      await categoryRow.getByRole('button',{name:'Edytuj'}).click();
      await page.locator('#category-form [name=name]').fill(categoryName+' updated');
      await page.locator('#category-form button').click();
      await page.getByRole('button',{name:'Nowe zadanie'}).click();
      await page.locator('[name=title]').fill('E2E disposable task');
      await page.locator('#task-form [name=categoryId]').selectOption({label:categoryName+' updated'});
      await page.getByRole('button',{name:'Zapisz',exact:true}).click();
      const card=page.locator('.board-card').filter({hasText:'E2E disposable task'});
      await card.waitFor();assert.equal(await card.count(),1);
      await card.locator('[data-move]').focus(); await page.keyboard.press('ArrowRight');
      await page.locator('[data-column=in_progress]').getByText('E2E disposable task',{exact:true}).waitFor();
      // Simulate conflict: UI must retain persisted column, announce failure, no retry.
      await page.route('**/api/tasks/move',route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:'QA conflict'})}),{times:1});
      await card.locator('[data-move]').focus();await page.keyboard.press('ArrowRight');
      await page.getByText('QA conflict',{exact:true}).waitFor();
      assert.equal(await page.locator('[data-column=in_progress]').locator('.board-card').filter({hasText:'E2E disposable task'}).count(),1);
      await page.reload();await page.locator('[data-column=in_progress]').getByText('E2E disposable task',{exact:true}).waitFor();
      // Real mouse Pointer Events, same production handlers as touch pointers.
      const handle=await card.locator('[data-move]').boundingBox();
      const destination=await page.locator('[data-column=done]').boundingBox();
      assert.ok(handle && destination);
      await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
      await page.mouse.down();
      await page.mouse.move(destination.x+destination.width/2,destination.y+10,{steps:15});
      await page.mouse.up();
      await page.locator('[data-column=done]').getByText('E2E disposable task',{exact:true}).waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      page.once('dialog',d=>d.accept());await card.getByRole('button',{name:'Edytuj'}).click();await page.getByRole('button',{name:'Usuń',exact:true}).click();
      await card.waitFor({state:'detached'});
      page.once('dialog',d=>d.accept());
      await page.locator('#category-list p').filter({hasText:categoryName+' updated'}).getByRole('button',{name:'Usuń'}).click();
      await page.locator('#category-list p').filter({hasText:categoryName+' updated'}).waitFor({state:'detached'});
      // Expected injected HTTP 409 can produce a browser resource error.
      assert.deepEqual(errors.filter(message=>!message.includes('409')),[]);
      await context.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
