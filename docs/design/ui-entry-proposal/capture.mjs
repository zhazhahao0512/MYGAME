// From repository root: node docs/design/ui-entry-proposal/capture.mjs
import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const port=5227,url=`http://127.0.0.1:${port}/docs/design/ui-entry-proposal/`,out='test-results/ui-entry-proposal';
const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:String(port)},stdio:'pipe'});
let browser;const report=[];
try{
  for(let i=0;i<100;i++){try{if((await fetch(url)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  await mkdir(out,{recursive:true});
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const [width,height]of [[1440,900],[2560,1440],[390,844]]){
    const context=await browser.newContext({viewport:{width,height},hasTouch:width<600,isMobile:width<600});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    for(const screen of ['home','recruit','ready']){
      await page.goto(`${url}?screen=${screen}`);await page.evaluate(()=>document.fonts.ready);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
      const imageLoaded=await page.evaluate(async()=>{const i=new Image();i.src='/art/gothic-courtyard.png';await i.decode();return i.naturalWidth>0;});
      assert.ok(imageLoaded);
      const metrics=await page.evaluate(()=>{const c=document.querySelector('.actionbar .primary')?.getBoundingClientRect();return{width:innerWidth,height:innerHeight,documentHeight:document.documentElement.scrollHeight,actionBottom:c?.bottom};});
      if(metrics.actionBottom)assert.ok(metrics.actionBottom<=height,'primary action remains visible in the viewport');
      await page.screenshot({path:`${out}/${width}-${screen}.png`,fullPage:true});
      report.push({screen,...metrics,errors:[...errors]});
      if(screen==='recruit'){
        await page.locator('[data-select="1"]').click();
        assert.match(await page.locator('.hero-detail h2').innerText(),/岚牙/);
        assert.equal(await page.locator('[data-select="1"]').getAttribute('aria-pressed'),'true');
      }
      if(screen==='ready'){
        await page.locator('[data-ready-select="1"]').click();
        assert.match(await page.locator('.ready-selected h2').innerText(),/岚牙/);
        await page.locator('.growth-nudge button').click();assert.ok(await page.locator('dialog').isVisible());await page.keyboard.press('Escape');
      }
      assert.equal(await page.evaluate(()=>localStorage.length),0,'proposal never creates a live save');
    }
    await page.goto(`${url}?screen=home&saved=1`);await page.evaluate(()=>document.fonts.ready);
    assert.match(await page.locator('.menu-actions .primary').innerText(),/继续远征/);
    await page.screenshot({path:`${out}/${width}-home-saved.png`,fullPage:true});
    assert.deepEqual(errors,[]);await context.close();
  }
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser?.close();server.kill('SIGTERM');}
