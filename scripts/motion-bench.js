// Phase 15's micro-benchmark (RELEASE-15.md, "The benchmark and the decision"): two ways of bringing 12 answers in, in Chromium with the CPU four
// times slower. (a) what lib/motion/motion.ts does: a `data-motion` shape and four custom properties written on each element, the keyframes in
// lib/motion/motion-tokens.css; (b) one element.animate() per element with the same keyframes, timing and stagger. Each run mounts a fresh
// question (13 elements, as the pager's {#key} does), starts its motion in the same task, and measures until 800 ms later: script time, layouts
// and style recalculations (Performance.getMetrics) and the frame gaps.
//
//   node scripts/motion-bench.js [--runs 20]        prints the table and writes test-results/perf/motion-bench.json

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { TOKENS, motionRecipe, recipeEnd } from '../migration/src/lib/motion/motion-plan.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const runsAt = process.argv.indexOf('--runs');
const RUNS = runsAt > 0 ? Number(process.argv[runsAt + 1]) : 20;
const css = readFileSync(path.join(ROOT, 'migration/src/lib/motion/motion-tokens.css'), 'utf8');
const COUNT = 12;
const recipes = [motionRecipe({ role: 'question', type: 'single-select', direction: 'forward' }),
  ...Array.from({ length: COUNT }, (_, index) => motionRecipe({ role: 'options', type: 'single-select', index, count: COUNT, direction: 'forward' }))];
const longest = Math.max(...recipes.map(recipeEnd));

const PAGE = `<!doctype html><html><head><style>${css}
body { margin: 0; font: 16px/1.4 sans-serif; background: #045bcc; color: #fff; }
.q { margin: 24px; font-weight: 700; } .o { margin: 12px 24px; padding: 14px 20px; border: 1px solid #fff8; border-radius: 999px; background: #fff2; }
</style></head><body><main id="stage"></main></body></html>`;

/** Runs in the page: mounts a fresh question and starts its motion one way or the other. */
function mountAndMove({ way, recipes, tokens }) {
  const stage = document.getElementById('stage');
  stage.textContent = '';
  const nodes = recipes.map((_, index) => {
    const element = document.createElement(index === 0 ? 'h2' : 'div');
    element.className = index === 0 ? 'q' : 'o';
    element.innerHTML = index === 0 ? 'Which of these twelve would you pick first?' : `<button type="button">Answer ${index} of 12</button>`;
    return element;
  });
  stage.append(...nodes);
  if (way === 'attributes') {
    nodes.forEach((node, index) => {
      const recipe = recipes[index];
      node.style.setProperty('--m-duration', `var(--motion-duration-${recipe.duration})`);
      node.style.setProperty('--m-ease', `var(--motion-ease-${recipe.ease})`);
      node.style.setProperty('--m-delay', String(recipe.delay));
      node.style.setProperty('--m-distance', `var(--motion-distance-${recipe.distance})`);
      node.dataset.motion = recipe.shape;
    });
  } else {
    const distance = (name) => (name === 'far' ? 'clamp(1rem, 6vw, 2.5rem)' : 'clamp(0.5rem, 3vw, 1.25rem)');
    nodes.forEach((node, index) => {
      const recipe = recipes[index];
      const offset = recipe.shape === 'from-left' ? `translateX(calc(-1 * ${distance(recipe.distance)}))` : recipe.shape === 'from-right' ? `translateX(${distance(recipe.distance)})` : `translateY(${distance(recipe.distance)})`;
      node.animate([{ opacity: 0, transform: offset }, { opacity: 1, transform: 'none' }], {
        duration: tokens.duration[recipe.duration], delay: recipe.delay * tokens.stagger, easing: `cubic-bezier(${tokens.ease[recipe.ease].join(',')})`, fill: 'backwards',
      });
    });
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 820, height: 1180 } });
await page.setContent(PAGE);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((entry) => [entry.name, entry.value]));

const results = { attributes: [], animate: [] };
for (let run = 0; run < RUNS; run += 1) {
  for (const way of run % 2 ? ['attributes', 'animate'] : ['animate', 'attributes']) {
    const before = await metric();
    const frames = await page.evaluate(async ({ way, recipes, tokens, wait, source }) => {
      const move = new Function(`return (${source})`)();
      const gaps = [];
      let last = 0;
      const until = performance.now() + wait;
      const done = new Promise((resolve) => { const tick = (now) => { if (last) gaps.push(now - last); last = now; if (now < until) requestAnimationFrame(tick); else resolve(); }; requestAnimationFrame(tick); });
      const started = performance.now();
      move({ way, recipes, tokens });
      const setup = performance.now() - started;
      await done;
      return { gaps, setup };
    }, { way, recipes, tokens: TOKENS, wait: longest + 100, source: mountAndMove.toString() });
    const after = await metric();
    const sorted = [...frames.gaps].sort((a, b) => a - b);
    results[way].push({
      scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000, setupMs: frames.setup,
      layouts: after.LayoutCount - before.LayoutCount, styles: after.RecalcStyleCount - before.RecalcStyleCount,
      p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0, dropped: frames.gaps.filter((gap) => gap > 25).length,
    });
  }
}
await browser.close();

const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
const table = Object.fromEntries(Object.entries(results).map(([way, rows]) => [way, Object.fromEntries(Object.keys(rows[0]).map((key) => [key, Number(median(rows.map((row) => row[key]).filter(Number.isFinite)).toFixed(2))]))]));
console.log(`Bringing ${COUNT} answers and the question in (${longest} ms), median of ${RUNS} runs, 4x slower CPU:`);
console.table(table);
mkdirSync(path.join(ROOT, 'test-results', 'perf'), { recursive: true });
writeFileSync(path.join(ROOT, 'test-results', 'perf', 'motion-bench.json'), JSON.stringify({ runs: RUNS, count: COUNT, entranceMs: longest, median: table, all: results }, null, 2));
