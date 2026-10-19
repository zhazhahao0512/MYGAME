// Run from repository root: node docs/design/ui-audit-20261020/capture.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const out='test-results/ui-audit-20261020',port=5214,url=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:String(port)},stdio:'pipe'});
let browser;const report=[];
try {
 await mkdir(out,{recursive:true});
 for(let i=0;i<100;i++){try{if((await fetch(url)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 for(const [width,height,pages] of [[1440,900,['home','initial','ready','recruit','shop','growth','chest','result','battle','settings']],[2560,1440,['battle']],[740,360,['battle']],[390,844,['shop','growth']]]) {
  for(const name of pages){
   if(process.argv[2]&&!process.argv[2].split(",").includes(name))continue;
   const ctx=await browser.newContext({viewport:{width,height},hasTouch:width<1000,isMobile:width<1000});const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const click=async(act,suffix='')=>page.locator(`[data-act="${act}"]${suffix}`).filter({visible:true}).first().click();
   await page.goto(url);await page.clock.install();
   if(['initial','ready'].includes(name)){await click('new');if(name==='ready'){await click('confirm-hero');await click('confirm-hero');}}
   else if(name==='settings'){await click('settings');}
   else if(name!=='home'){await click('preview-menu');await click('preview',`[data-page="${name==='growth'?'shop':name}"]`);if(name==='growth')await click('hero-growth');}
   if(name==='battle')await page.locator('#battle-canvas[data-engine="phaser"]').waitFor();
   await page.clock.runFor(name==='battle'?1600:300);await page.mouse.move(1,1);await page.evaluate(()=>document.fonts.ready);
   await page.screenshot({path:`${out}/${width}-${name}.png`,animations:"disabled",fullPage:!['growth','settings'].includes(name)});
   report.push({name,width,height,errors,...await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,text:document.body.innerText}))});
   console.log(`Captured ${width}x${height} ${name}`);await ctx.close();
  }
 }
 await writeFile(`${out}/observations${process.argv[2]?"-"+process.argv[2]:""}.json`,JSON.stringify(report,null,2));
}finally{await browser?.close();server.kill('SIGTERM');}
