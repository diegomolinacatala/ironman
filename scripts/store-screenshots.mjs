#!/usr/bin/env node
/**
 * App Store screenshots (6.7"/6.9" iPhone, 1290 × 2796) from the demo build on the web.
 *
 *   1. npx expo start --web --port 8081         (no EXPO_PUBLIC_SUPABASE_* → demo mode)
 *   2. PLAYWRIGHT=<path to playwright's index.mjs> node scripts/store-screenshots.mjs
 *
 * Playwright is not a project dependency: install it anywhere (`npm i playwright` +
 * `npx playwright install chromium`) and point PLAYWRIGHT at it. Output: store/screenshots/NN-name.png,
 * uploaded by .github/workflows/app-store.yml.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = process.env.APP_URL ?? 'http://localhost:8081';
const OUT = new URL('../store/screenshots/', import.meta.url);
const VIEWPORT = { width: 430, height: 932 }; // × 3 = 1290 × 2796
const ONLY = process.argv.slice(2);

/** In order of the App Store gallery: `path` is opened after entering the demo, then `click` (if any). */
const SHOTS = [
  { name: '01-hoy', path: '/today' },
  { name: '02-plan', path: '/week' },
  { name: '03-entreno', path: '/week', click: /^Bici, Bici umbral/ },
  { name: '04-juntos', path: '/together' },
  { name: '05-general', path: '/week?view=general' },
  { name: '06-progreso', path: '/progress' },
];

async function loadPlaywright() {
  const spec = process.env.PLAYWRIGHT;
  const mod = await import(spec ? pathToFileURL(spec).href : 'playwright');
  return mod.chromium ?? mod.default.chromium;
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(1500);
}

async function enterDemo(page) {
  await page.goto(BASE);
  await settle(page);
  const demo = page.getByRole('button', { name: /Entrar en modo demo/ });
  if (await demo.count()) {
    await demo.first().click();
    await page.waitForURL((url) => !url.pathname.includes('sign-in'), { timeout: 30_000 }).catch(() => undefined);
    await settle(page);
  }
}

async function openShot(page, shot) {
  await page.goto(`${BASE}${shot.path}`);
  await settle(page);
  if (!shot.click) return;
  await page.getByRole('button', { name: shot.click }).first().click();
  await settle(page);
}

async function main() {
  const chromium = await loadPlaywright();
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    colorScheme: 'light',
  });
  const page = await context.newPage();
  await enterDemo(page);
  for (const shot of SHOTS.filter((s) => ONLY.length === 0 || ONLY.includes(s.name))) {
    await openShot(page, shot);
    const file = join(OUT.pathname.replace(/^\/([A-Za-z]:)/, '$1'), `${shot.name}.png`);
    await page.screenshot({ path: file });
    console.log(`✓ ${shot.name} (${page.url()})`);
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
