import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const port=Number(process.env.EQUIPMENT_TEST_PORT||5198),url=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['scripts/server.mjs'],{env:{...process.env,PORT:String(port)},stdio:'pipe'});
let browser;const errors=[];
try {
  let ready=false;for(let n=0;n<100;n++){try{if((await fetch(url)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
  await mkdir('test-results/equipment',{recursive:true});
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const [label,viewport,touch] of [['desktop',{width:1920,height:1080},false],['phone',{width:390,height:844},true]]){
    const context=await browser.newContext({viewport,hasTouch:touch,isMobile:touch,deviceScaleFactor:1}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    const click=async selector=>{const el=page.locator(selector).first();if(touch)await el.tap();else await el.click();};
    const gear=(hero,slot)=>`[data-act="gear"][data-hero="${hero}"][data-slot="${slot}"]`;
    const save=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('squad-expedition.save.v1')));
    await page.goto(url);
    await page.evaluate(async()=>{
      const M=await import('/src/model.js');const r=M.createRun(8801);
      r.party=[{hero:'jinli',gear:['blue_duelist_blade','white_iron_sword','white_dagger'].map(id=>M.makeItem(r,id)).concat(null)},{hero:'lishan',gear:[M.makeItem(r,'white_iron_sword'),null,null,null]}];r.candidates=[];r.phase='ready';
      M.finishRound(r,{won:true,kills:20,gold:2000});r.chest.claimed=true;
      r.shop=['purple_flowing_codex','purple_clearwell_staff','purple_combo_bow','white_dagger'].map(id=>M.makeItem(r,id));localStorage.setItem(M.SAVE_KEY,JSON.stringify(r));
    });
    await page.reload();await click('[data-act="continue"]');
    assert.match(await page.locator('.shop-stock').innerText(),/余韵/);assert.match(await page.locator('.shop-stock').innerText(),/导流/);
    assert.match(await page.locator('.shop-stock').innerText(),/额外攻速.*\+8%/s);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:`test-results/equipment/${label}-shop.png`,fullPage:true});
    await click('[data-act="select-offer"][data-index="3"]');assert.match(await page.locator('#shop-guidance').innerText(),/合成去向.*迅捷双刃/s);await click('[data-act="cancel-selection"]');
    await click(gear(0,0));assert.match(await page.locator('.upgrade-routes').innerText(),/可合成/);
    await click('[data-act="preview-combine"][data-id="purple_battle_spear"]');
    assert.match(await page.locator('.combine-materials').innerText(),/烬璃.*决斗短刃/s);
    assert.equal(await page.locator('.combine-materials li').count(),3);
    const before=await save();assert.equal(before.gold,2000);
    await page.screenshot({path:`test-results/equipment/${label}-combine.png`,fullPage:false});
    const box=await page.locator('.shop-popover').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=viewport.width+1&&box.y>=0&&box.y+box.height<=viewport.height+1);
    await click('[data-act="confirm-combine"]');const after=await save();assert.equal(after.gold,1400);assert.equal(after.party[0].gear[0].base,'purple_battle_spear');assert.equal(after.party[0].gear[1],null);assert.equal(after.party[0].gear[2],null);assert.equal(after.party[1].gear[0].base,'white_iron_sword');
    await page.reload();await click('[data-act="continue"]');assert.equal((await save()).gold,1400);
    if(process.env.EQUIPMENT_DEBUG)await page.evaluate(()=>{
      document.addEventListener('scroll',e=>console.log('scroll',e.target===document,e.target.id,e.target.className,scrollY),true);
      new MutationObserver(()=>console.log('popover',document.querySelector('#shop-popover-root')?.children.length,scrollY)).observe(document.querySelector('#shop-popover-root'),{childList:true});
    });
    await click(gear(0,0));assert.match(await page.locator('.item-passive').last().innerText(),/穷追/);assert.match(await page.locator('.item-passive').last().innerText(),/同名被动/);
    await click('[data-act="close-popover"]');await click(gear(1,0));
    await click('[data-act="preview-combine"][data-id="blue_tempered_sword"]');assert.equal(await page.locator('[data-act="confirm-combine"]').isDisabled(),true);assert.match(await page.locator('.transaction-total').innerText(),/缺少/);
    await click('[data-act="close-popover"]');
    await click('[data-act="inspect-offer"][data-index="1"]');assert.match(await page.locator('.inspection-card').innerText(),/15 法力/);assert.match(await page.locator('.inspection-card').innerText(),/合成费 800/);
    // R064: alternate red recipes, explicit passive conversion and a new purple-to-red chain.
    await page.evaluate(async()=>{
      const M=await import('/src/model.js'),r=M.createRun(8802);
      const layouts=[['purple_bloodpact_blade','blue_swift_blades'],['purple_steel_greatsword','white_spiked_blade','white_spiked_blade'],['blue_vitality_staff','white_glimmer_wand','blue_vitality_staff']];
      r.party=layouts.map((ids,i)=>({hero:['jinli','lishan','lingxi'][i],gear:ids.map(id=>M.makeItem(r,id)).concat(Array(4-ids.length).fill(null))}));r.phase='ready';r.candidates=[];
      M.finishRound(r,{won:true,kills:20,gold:5000});r.chest.claimed=true;localStorage.setItem(M.SAVE_KEY,JSON.stringify(r));
    });
    await page.reload();await click('[data-act="continue"]');
    await click(gear(0,0));assert.match(await page.locator('.upgrade-routes').innerText(),/回流.*血性.*原被动不保留/s);
    await click('[data-act="preview-combine"][data-id="red_crimson_tide_blade"][data-recipe="1"]');
    assert.match(await page.locator('.shop-popover').innerText(),/当前路线 2.*回流.*血性/s);
    assert.match(await page.locator('.transaction-total').innerText(),/合成费 600/);
    await page.screenshot({path:`test-results/equipment/${label}-red-conversion.png`,fullPage:false});
    await click('[data-act="confirm-combine"]');assert.equal((await save()).gold,4400);
    await click(gear(1,0));await click('[data-act="preview-combine"][data-id="red_judgment_blade"][data-recipe="1"]');
    assert.equal(await page.locator('.combine-materials li').count(),3);await click('[data-act="confirm-combine"]');
    let state=await save();assert.equal(state.gold,3600);assert.equal(state.party[1].gear.filter(Boolean).length,1);
    await click(gear(2,0));await click('[data-act="preview-combine"][data-id="purple_abundant_staff"]');await click('[data-act="confirm-combine"]');
    assert.equal((await save()).gold,2900);await click(gear(2,0));
    await click('[data-act="preview-combine"][data-id="red_lifebloom_scepter"]');await click('[data-act="confirm-combine"]');
    state=await save();assert.equal(state.gold,2300);assert.deepEqual(state.party.map(m=>m.gear[0].base),['red_crimson_tide_blade','red_judgment_blade','red_lifebloom_scepter']);
    await page.reload();await click('[data-act="continue"]');await click(gear(1,0));
    assert.match(await page.locator('.item-passive').last().innerText(),/180%.*最高等级/s);
    assert.match(await page.locator('.shop-popover').innerText(),/路线 1.*合成费 650.*路线 2.*合成费 800/s);
    const redBox=await page.locator('.shop-popover').boundingBox();assert.ok(redBox.x>=0&&redBox.x+redBox.width<=viewport.width+1&&redBox.y>=0&&redBox.y+redBox.height<=viewport.height+1);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:`test-results/equipment/${label}-red-details.png`,fullPage:false});
    await context.close();console.log(`${label}: purple and alternate red crafting, passive conversion, duplicate materials, fixed fees, save reload and viewport passed`);
  }
  assert.deepEqual(errors,[]);
}finally{await browser?.close();server.kill();}
