import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.ENGINE_TEST_PORT || 5189);
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['scripts/server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: 'pipe' });
const browsers = [];
const errors = [];
try {
  let online = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) { online = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(online, 'test server starts');
  await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  browsers.push(browser);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  const click = (action, suffix = '') => page.locator(`[data-act="${action}"]${suffix}`).first().click();
  const ready = () => page.locator('#battle-canvas[data-engine="phaser"]').waitFor();
  for (let n = 0; n < 3; n++) {
    await click('preview-menu'); await click('preview', '[data-page="battle"]'); await ready();
    assert.equal(await page.locator('canvas').count(), 1);
    const canvas = await page.locator('canvas').elementHandle();
    if (n === 0) {
      // Verify real Phaser hit areas, not DOM stand-ins: first visible hero is slot 5.
      const bounds = await page.locator('canvas').boundingBox();
      await page.mouse.click(bounds.x + bounds.width * .435 / 10 + 10, bounds.y + bounds.height * .5);
      assert.equal(await page.locator('.hero-panel.selected .hero-name').getAttribute('data-hero'), '4');
      await click('auto', '[data-hero="4"]'); await click('attributes');
      assert.equal(await canvas.evaluate(el => el.isConnected), true, 'controls retain the same game');
      await page.waitForTimeout(1300);
      await click('pause');
      const before = await page.locator('#battle-canvas').evaluate(el => ({ ...el.dataset }));
      await page.waitForTimeout(400);
      const after = await page.locator('#battle-canvas').evaluate(el => ({ ...el.dataset }));
      assert.equal(after.tick, before.tick); assert.equal(after.particles, before.particles);
      await click('close');
      await page.setViewportSize({ width: 2560, height: 1440 });
      await page.waitForFunction(() => {
        const host = document.querySelector('#battle-canvas'); return host.querySelector('canvas').width === host.clientWidth;
      });
      await page.screenshot({ path: new URL('../test-results/phaser-battle-2k.png', import.meta.url).pathname });
      assert.equal(await canvas.evaluate(el => el.isConnected), true, 'resize retains the same game');
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await click('pause'); await click('leave-battle');
    assert.equal(await page.locator('canvas').count(), 0, 'leaving removes the owned canvas');
  }

  // A separate test-only harness drives the real renderer with a high-frequency battle.
  // No debug controls are added to the application or its production bundle.
  await page.evaluate(async () => {
    const [{ Battle, STEP }, { createRun }, { HEROES }, { PhaserBattleRenderer }, { setSource }] = await Promise.all([
      import('/src/battle.js'), import('/src/model.js'), import('/src/data.js'), import('/src/renderer/PhaserBattleRenderer.ts'), import('/src/combat/unit.js'),
    ]);
    document.body.innerHTML = '<div id="stress-stage" style="width:1400px;height:650px"></div>';
    const run = createRun(8811);
    run.party = HEROES.slice(0, 5).map(h => ({ hero: h.id, gear: [null, null, null, null], auto: true }));
    run.phase = 'ready';
    const battle = new Battle(run, { duration: 120 });
    for (const unit of [...battle.party, ...battle.enemies]) {
      setSource(unit, 'stress', { modifiers: Object.entries({ attackSpeed: 10, hp: 1e8, manaRegen: 1000, haste: 1400 }).map(([stat, value]) => ({ id: stat, stat, op: 'override', value, priority: 100 })) }); unit.hp = unit.stats.hp;
    }
    const harness = { battle, renderer: null, accumulator: 0, frames: 0, samples: [], maxParticles: 0, maxPopups: 0, maxProjectiles: 0, maxObjects: 0, minObjects: Infinity, paused: false };
    const host = document.querySelector('#stress-stage');
    harness.renderer = new PhaserBattleRenderer(host, battle, {
      advance(delta) {
        const start = performance.now();
        harness.accumulator += delta / 1000;
        while (harness.accumulator >= STEP && battle.tick < 400) { battle.step(); harness.accumulator -= STEP; }
        harness.samples.push(performance.now() - start); harness.frames++;
        if (host.dataset.tick) {
          harness.maxParticles = Math.max(harness.maxParticles, Number(host.dataset.particles));
          harness.maxPopups = Math.max(harness.maxPopups, Number(host.dataset.popups));
          harness.maxProjectiles = Math.max(harness.maxProjectiles, Number(host.dataset.projectiles));
          harness.maxObjects = Math.max(harness.maxObjects, Number(host.dataset.displayObjects));
          harness.minObjects = Math.min(harness.minObjects, Number(host.dataset.displayObjects));
        }
        if (battle.tick >= 400) { harness.paused = true; harness.renderer.syncPause(); }
      },
      selected: () => 0, select: () => {}, motion: () => true, paused: () => harness.paused,
    });
    window.__engineHarness = harness;
  });
  await page.waitForFunction(() => window.__engineHarness.battle.tick >= 400, { }, { timeout: 45000 });
  const metrics = await page.evaluate(() => {
    const h = window.__engineHarness, sorted = [...h.samples].sort((a, b) => a - b);
    return { renderer: document.querySelector('#stress-stage').dataset.renderer, simulatedSeconds: h.battle.time, frames: h.frames,
      simulationP95Ms: sorted[Math.floor(sorted.length * .95)], simulationMaxMs: sorted.at(-1),
      maxParticles: h.maxParticles, maxPopups: h.maxPopups, maxProjectiles: h.maxProjectiles,
      minObjects: h.minObjects, maxObjects: h.maxObjects, visualEvents: h.battle.effects.length, emittedEvents: h.battle.effectSerial,
      actualFps: h.renderer.game.loop.actualFps };
  });
  assert.ok(metrics.maxParticles > 0 && metrics.maxParticles <= 720, 'real bounded particle emitters ran');
  assert.ok(metrics.maxPopups > 0 && metrics.maxPopups <= 36);
  assert.ok(metrics.maxProjectiles > 0 && metrics.maxProjectiles <= 96);
  assert.equal(metrics.minObjects, metrics.maxObjects, 'scene objects are reused under load');
  assert.ok(metrics.visualEvents <= 256);
  assert.ok(metrics.emittedEvents > 500, 'stress case exercises frequent actual damage');
  await page.screenshot({ path: new URL('../test-results/phaser-stress.png', import.meta.url).pathname });
  await writeFile(new URL('../test-results/engine-metrics.json', import.meta.url), JSON.stringify(metrics, null, 2));
  await page.evaluate(() => window.__engineHarness.renderer.destroy());

  // Verify Phaser's Canvas fallback on a browser with WebGL deliberately unavailable.
  const fallback = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-webgl'] });
  browsers.push(fallback);
  const fallbackPage = await fallback.newPage({ viewport: { width: 1440, height: 900 } });
  fallbackPage.on('pageerror', e => errors.push(e.message));
  await fallbackPage.goto(url);
  await fallbackPage.click('[data-act="preview-menu"]'); await fallbackPage.click('[data-page="battle"]');
  await fallbackPage.locator('#battle-canvas[data-engine="phaser"]').waitFor();
  assert.equal(await fallbackPage.locator('#battle-canvas').getAttribute('data-renderer'), 'canvas');
  await fallbackPage.waitForFunction(() => Number(document.querySelector('#battle-canvas').dataset.tick) > 25);
  assert.deepEqual(errors, []);
  console.log('Engine checks passed: WebGL, Canvas fallback, real pointer selection, retained scene, resize, pause, cleanup and bounded high-frequency effects.');
  console.log(JSON.stringify(metrics));
} finally {
  for (const browser of browsers) await browser.close();
  server.kill('SIGTERM');
}
