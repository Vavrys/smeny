// Smoke test: appka se načte a ukáže přihlašovací obrazovku bez JS chyb.
// Žádné zápisy do Supabase — jen navigace a čtení DOM.
//
// Síťové console errory na Supabase (např. nedostupné testovací prostředí
// bez připojení) ignorujeme filtrem podle URL — appka s tím počítá a zobrazí
// vlastní chybovou hlášku, nejde o JS bug. Ostatní console error / pageerror
// test shazují.
const { test, expect } = require('@playwright/test');

const SUPABASE_HOST = 'supabase.co';

async function expectCleanLogin(page, viewport) {
  await page.setViewportSize(viewport);

  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const url = msg.location()?.url || '';
    if (url.includes(SUPABASE_HOST) || msg.text().includes(SUPABASE_HOST)) return;
    consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await page.locator('#login-email').waitFor({ state: 'visible' });
  await expect(page.locator('#login-btn')).toBeVisible();

  expect(pageErrors, pageErrors.join('\n')).toHaveLength(0);
  expect(consoleErrors, consoleErrors.join('\n')).toHaveLength(0);
}

test('přihlašovací obrazovka — desktop 1280×800', async ({ page }) => {
  await expectCleanLogin(page, { width: 1280, height: 800 });
});

test('přihlašovací obrazovka — mobil 390×844', async ({ page }) => {
  await expectCleanLogin(page, { width: 390, height: 844 });
});
