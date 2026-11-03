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
      await page.goto(process.env.E2E_BASE); await page.getByRole('button',{name:'Nowe zadanie'}).click();
      await page.locator('[name=title]').fill('E2E disposable task');
      await page.getByRole('button',{name:'Zapisz',exact:true}).click();
      const card=page.locator('.board-card').filter({hasText:'E2E disposable task'});
      await card.waitFor();assert.equal(await card.count(),1);
      await card.locator('[data-move]').focus(); await page.keyboard.press('ArrowRight');
      await page.locator('[data-column=in_progress]').getByText('E2E disposable task',{exact:true}).waitFor();
      await page.reload();await page.locator('[data-column=in_progress]').getByText('E2E disposable task',{exact:true}).waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      page.once('dialog',d=>d.accept());await card.getByRole('button',{name:'Edytuj'}).click();await page.getByRole('button',{name:'Usuń',exact:true}).click();
      await card.waitFor({state:'detached'});assert.deepEqual(errors,[]);
      await context.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
