// Phase 15's filmstrips: screenshots cannot show motion, so this photographs it. On the local PCOE site (VJR's dataset and pictures), in the
// `?preview=<client>` page (read-only, with Next and Back), it opens each of Kroger's activities, and for the first entrance (from the hub), a Next
// and a Back it holds every animation still (Web Animations: pause, then set each one's currentTime) and photographs the screen every 50 ms from 0
// to 750 ms, at the iPhone portrait and iPad landscape sizes, with motion on and with ?motion=off. Each strip is one PNG of its frames side by side
// in ux-review/<date>/filmstrips/ (git-ignored), with index.html to look at them.
//
//   node scripts/local-site/filmstrip.js [--package build-svelte/release] [--date YYYY-MM-DD]
//
// It runs in Chromium only (the local site reaches WebKit through page.route, which is too slow to hold a frame still); a person judges the feel
// on a real iPhone and iPad (QA-TESTING.md).

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startLocalSite } from './server.js';
import { HOST, pageUrl } from './site-shape.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
const option = (name) => { const at = args.indexOf(`--${name}`); return at === -1 ? null : args[at + 1]; };
const OUT = path.join(ROOT, 'ux-review', option('date') ?? new Date().toISOString().slice(0, 10), 'filmstrips');
const SIZES = { 'iphone-portrait': { width: 390, height: 844, scale: 2 }, 'ipad-landscape': { width: 1180, height: 820, scale: 1 } };
const TIMES = Array.from({ length: 16 }, (_, index) => index * 50);
const strips = [];

/** Holds every animation of the page at `ms` after the moment began. */
const hold = (page, ms) => page.evaluate((at) => {
  for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = at; }
}, ms);

async function film(page, name, sizeKey, act) {
  await page.waitForTimeout(900);
  await act();
  await page.evaluate(() => { for (const animation of document.getAnimations()) animation.pause(); });
  const frames = [];
  for (const ms of TIMES) {
    await hold(page, ms);
    frames.push(await page.screenshot({ type: 'png' }));
  }
  await page.evaluate(() => { for (const animation of document.getAnimations()) animation.play(); });
  const file = `${name}--${sizeKey}.png`;
  // One picture per frame, numbered; the index puts them side by side.
  const dir = path.join(OUT, name.replace(/[^a-z0-9-]+/gi, '-'), sizeKey);
  mkdirSync(dir, { recursive: true });
  frames.forEach((frame, index) => writeFileSync(path.join(dir, `${String(TIMES[index]).padStart(3, '0')}ms.png`), frame));
  strips.push({ name, size: sizeKey, dir: path.relative(OUT, dir).split(path.sep).join('/'), file });
  process.stdout.write('.');
}

const running = await startLocalSite({ port: 0, latency: 'none', scenario: 'event-day', persist: false, packageDir: option('package') ?? path.join(ROOT, 'build-svelte', 'release') });
const kroger = running.site.fake.lists.get('clients').find((row) => /kroger/i.test(row.Title))?.AppId;
const browser = await chromium.launch({ args: running.browserArgs });
try {
  for (const [sizeKey, size] of Object.entries(SIZES)) {
    for (const search of ['', '&motion=off']) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale, ignoreHTTPSErrors: true, isMobile: sizeKey.startsWith('iphone'), hasTouch: true });
      await context.addCookies([{ name: 'pms-local-persona', value: 'admin', domain: HOST, path: '/', secure: true }]);
      const page = await context.newPage();
      await page.goto(`${pageUrl('index.html')}?preview=${kroger}${search}`);
      await page.getByRole('button', { name: /Click here to begin|Begin|Start/ }).first().click();
      const titles = await page.locator('.pms-activities button .label').allInnerTexts();
      const mode = search ? 'motion off' : 'motion on';
      await film(page, `hub, ${mode}`, sizeKey, async () => {});
      for (const title of titles) {
        await film(page, `${title}, from the hub, ${mode}`, sizeKey, () => page.getByRole('button', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first().click());
        const next = page.getByRole('button', { name: 'Next', exact: true });
        if (await next.isEnabled().catch(() => false)) {
          await film(page, `${title}, Next, ${mode}`, sizeKey, () => next.click());
          await film(page, `${title}, Back, ${mode}`, sizeKey, () => page.getByRole('button', { name: 'Back', exact: true }).click());
        }
        await page.getByRole('button', { name: 'Back to activities' }).click();
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  await running.close();
}

const escape = (text) => String(text).replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`);
writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>PMS motion filmstrips</title><style>
body{font-family:system-ui,sans-serif;margin:16px}h2{font-size:1rem;margin:24px 0 6px}.strip{display:flex;gap:4px;overflow-x:auto}.strip figure{margin:0}.strip img{height:300px;border:1px solid #ccc}figcaption{font-size:.7rem}
</style></head><body><h1>Motion filmstrips (every 50 ms, ${escape(running.site.pages.name)})</h1>
${strips.map((strip) => `<h2>${escape(strip.name)} · ${escape(strip.size)}</h2><div class="strip">${TIMES.map((ms) => `<figure><img loading="lazy" src="${escape(strip.dir)}/${String(ms).padStart(3, '0')}ms.png" alt="${ms} ms"><figcaption>${ms} ms</figcaption></figure>`).join('')}</div>`).join('\n')}
</body></html>`);
console.log(`\n${strips.length} strips in ${OUT}`);
