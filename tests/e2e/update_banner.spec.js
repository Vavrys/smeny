// R-00: banner nové verze. Appka porovnává svůj stamp s /version.json.
// Stamp simulujeme přepsáním __BUILD_SHA__ v odpovědi na index.html.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const TEXT = 'Je k dispozici nová verze aplikace.';

async function setup(page, { stamp, versionHandler }) {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = { versionRequests: 0, warnings: [], errors: [] };
  page.on('console', msg => {
    if (msg.text().startsWith('[version]')) {
      (msg.type() === 'error' ? state.errors : state.warnings).push(msg.text());
    }
  });
  if (stamp) {
    await page.route('**/', route => route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: HTML.split('__BUILD_SHA__').join(stamp),
    }));
  }
  await page.route('**/version.json*', route => {
    state.versionRequests++;
    return versionHandler(route);
  });
  await page.clock.install();
  await page.goto('/');
  await page.locator('#login-email').waitFor({ state: 'visible' });
  return state;
}

const json = sha => route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ build: sha }) });
const tick = page => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

test('(a) jiný build → banner se ukáže', async ({ page }) => {
  await setup(page, { stamp: SHA_A, versionHandler: json(SHA_B) });
  await tick(page);
  await expect(page.locator('#update-banner')).toBeVisible();
  await expect(page.locator('#update-banner')).toContainText(TEXT);
  await expect(page.locator('#update-banner button.btn-accent')).toBeInViewport({ ratio: 1 });
});

test('(b) ✕ skryje banner, po >30 s se vrátí', async ({ page }) => {
  await setup(page, { stamp: SHA_A, versionHandler: json(SHA_B) });
  await tick(page);
  await expect(page.locator('#update-banner')).toBeVisible();
  await page.locator('#update-banner button[title="Zavřít"]').click();
  await expect(page.locator('#update-banner')).toBeHidden();
  await page.clock.fastForward(31000);
  await tick(page);
  await expect(page.locator('#update-banner')).toBeVisible();
});

test('(c) stejný build → banner skrytý', async ({ page }) => {
  const state = await setup(page, { stamp: SHA_A, versionHandler: json(SHA_A) });
  await tick(page);
  await expect.poll(() => state.versionRequests).toBe(1);
  await page.waitForTimeout(200);
  await expect(page.locator('#update-banner')).toBeHidden();
});

test('(d) bez stampu → žádný request na version.json', async ({ page }) => {
  const state = await setup(page, { versionHandler: json(SHA_B) });
  await tick(page);
  await page.clock.fastForward(11 * 60 * 1000);
  await tick(page);
  await page.waitForTimeout(200);
  expect(state.versionRequests).toBe(0);
});

test('(e) 404 → bez banneru a bez console.error', async ({ page }) => {
  const state = await setup(page, {
    stamp: SHA_A,
    versionHandler: route => route.fulfill({ status: 404, body: 'nenalezeno' }),
  });
  await tick(page);
  await expect.poll(() => state.warnings.length).toBeGreaterThan(0);
  await expect(page.locator('#update-banner')).toBeHidden();
  expect(state.errors).toHaveLength(0);
});
