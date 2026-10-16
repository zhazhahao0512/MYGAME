import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

// Run from GitHub's runner, outside the deployment server's network.
const base = new URL(process.env.MYGAME_PUBLIC_URL);
assert.ok(['http:', 'https:'].includes(base.protocol));
assert.ok(!base.username && !base.password, 'Public URL must not contain credentials');
assert.ok(process.env.MYGAME_RELEASE_ID && process.env.GITHUB_SHA);
async function get(path) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15000), cache: 'no-store' });
  assert.equal(response.status, 200, `Public request failed: ${path}`);
  return response;
}
assert.deepEqual(await (await get('_health')).json(), { status: 'ok' });
const version = await (await get('_version')).json();
assert.equal(version.releaseId, process.env.MYGAME_RELEASE_ID);
assert.equal(version.commit, process.env.GITHUB_SHA);
const html = await (await get('')).text();
assert.match(html, /id="app"/);
const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(match => match[1]);
assert.ok(assets.some(path => path.endsWith('.js')) && assets.some(path => path.endsWith('.css')));
for (const path of assets) {
  assert.equal(new URL(path, base).origin, base.origin, 'Unexpected external asset');
  const response = await get(path);
  assert.match(response.headers.get('content-type'), path.endsWith('.js') ? /javascript/ : /text\/css/);
  assert.ok((await response.arrayBuffer()).byteLength > 0);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  // A fresh browser context never modifies a player's existing save.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base.href, { waitUntil: 'networkidle' });
  await page.locator('[data-act="new"]').click();
  await page.locator('[data-act="confirm-hero"]').click();
  await page.locator('[data-act="confirm-hero"]').click();
  await page.locator('[data-act="start-battle"]').click();
  await page.waitForFunction(() => Number(document.querySelector('#battle-canvas')?.dataset.tick) > 125, null, { timeout: 30000 });
  assert.equal(await page.locator('#battle-canvas canvas').count(), 1);
  await page.locator('[data-act="pause"]').click();
  const tick = await page.locator('#battle-canvas').getAttribute('data-tick');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#battle-canvas').getAttribute('data-tick'), tick);
  const saved = await page.evaluate(() => localStorage.getItem('squad-expedition.save.v1'));
  assert.ok(saved);
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.evaluate(() => localStorage.getItem('squad-expedition.save.v1')), saved);
  await page.locator('[data-act="continue"]').click();
  // Battle saves intentionally resume at the pre-battle checkpoint.
  await page.locator('[data-act="start-battle"]').click();
  await page.waitForFunction(() => Number(document.querySelector('#battle-canvas')?.dataset.tick) > 25, null, { timeout: 30000 });
  assert.deepEqual(errors, []);
  console.log(`Public deployment verified: ${base.href} ${version.releaseId}; health, commit, JS/CSS, battle, pause and saved-game reload passed.`);
} finally {
  await browser.close();
}
