import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { compositeOver, contrastRatio, deriveTheme } from '../migration/src/lib/brand/theme.js';
import { SAMPLE_PILLS } from '../migration/src/lib/brand/brand-sample.js';

// Prompt 24, Part 2: the four looks, from the source and the colour maths. Text on every state at 4.5:1 and every icon and ring at 3:1, on the sample
// brand colours, Kroger's seed blue, a pale and a saturated client, and a sweep of every hue. Pixels are measured in contrast.spec.ts and hub-states.spec.ts.
// ASSUMED: the manager's Kroger blue is the seed's #0060A9: the screenshots of the live hub are not in the repo.

const root = path.join(import.meta.dirname, '..');
const pill = () => readFile(path.join(root, 'migration/src/components/ActivityPill.svelte'), 'utf8');
const WHITE = '#FFFFFF';

const toHex = (hue, sat, light) => {
  const k = (n) => (n + hue / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const part = (n) => Math.round(255 * (light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))).toString(16).padStart(2, '0');
  return `#${part(0)}${part(8)}${part(4)}`.toUpperCase();
};
const PRIMARIES = ['#045BCC', '#0060A9', '#0B648F', '#E31837', '#86BC25', '#FFD100', '#F1D6FF', '#FAFAFA', '#111111', '#00FF66', '#FF00AA'];
for (let hue = 0; hue < 360; hue += 30) for (const sat of [0.4, 1]) for (const light of [0.2, 0.5, 0.85]) PRIMARIES.push(toHex(hue, sat, light));

/** The share of the success green in the done fill, read from the stylesheet so this holds what ships. */
async function doneShare() {
  const match = /\[data-state='done'\]\s*\{\s*background:\s*color-mix\(in srgb, var\(--success\) (\d+)%, var\(--bg-top\)\)/.exec(await pill());
  assert.ok(match, 'the done fill is the success green mixed into --bg-top');
  return Number(match[1]) / 100;
}

test('text on every state reads at 4.5:1, for every client colour, with no adjustment beyond those deriveTheme already makes', async () => {
  const share = await doneShare();
  for (const primary of PRIMARIES) {
    const { tokens } = deriveTheme(primary);
    const done = compositeOver(tokens['--success'], share, tokens['--bg-top']);
    assert.ok(contrastRatio(WHITE, done) >= 4.5, `done on ${primary}`);
    assert.ok(contrastRatio(WHITE, tokens['--action']) >= 4.5, `locked on ${primary}`);
    for (const ground of [tokens['--bg-mid'], tokens['--bg-bottom']]) {
      assert.ok(contrastRatio(WHITE, compositeOver(WHITE, 0.14, ground)) >= 4.5 - 1e-9, `ready and in progress on ${primary}`);
    }
  }
});

test('every icon and ring reads at 3:1 against its own fill', async () => {
  const share = await doneShare();
  for (const primary of PRIMARIES) {
    const { tokens } = deriveTheme(primary);
    assert.ok(contrastRatio(tokens['--on-success'], tokens['--success']) >= 3, 'the check on its badge');
    const done = compositeOver(tokens['--success'], share, tokens['--bg-top']);
    assert.ok(contrastRatio(tokens['--success'], done) >= 3, `the badge on the done fill, ${primary}`);
    assert.ok(contrastRatio(tokens['--progress'], tokens['--bg-top']) >= 3, 'the ring on its own disc');
    assert.ok(contrastRatio(WHITE, tokens['--action']) >= 3, `the closed padlock, ${primary}`);
    assert.ok(contrastRatio(WHITE, compositeOver(WHITE, 0.14, tokens['--bg-mid'])) >= 3, `the open padlock, ${primary}`);
  }
});

test('the look: no new colour token, no red, no colour-only state, the padlock in two parts', async () => {
  const code = await pill();
  const style = /<style>([\s\S]*)<\/style>/.exec(code)[1];
  const used = new Set([...style.matchAll(/var\((--[a-z-]+)/g)].map((match) => match[1]).filter((name) => !/^--(motion|fs|fw|font|pill)/.test(name)));
  assert.deepEqual([...used].sort(), ['--action', '--action-border', '--bg-mid', '--bg-top', '--on-success', '--progress', '--success', '--surface', '--surface-border', '--text']);
  assert.doesNotMatch(style, /--danger/);
  assert.doesNotMatch(style, /#[0-9a-f]{3,8}\b/i, 'no literal colours');
  assert.match(code, /class="shackle"/);
  assert.match(code, /class="body"/);
  for (const word of ['Done', 'Ready', 'Locked', 'In progress ·', 'Up next ·']) assert.ok(code.includes(word), word);
  assert.match(code, /aria-disabled=\{locked/);
  assert.match(code, /id=\{captionId\}/);
  assert.match(code, /min-height: var\(--pill-h\)/);
  assert.match(code, /flex-wrap: wrap/);
  // The accessible names of the brief.
  for (const pattern of ['`${label}, done`', '`${label}, in progress, ${answered} of ${questions(total)}`', '`${label}, locked. ${lockedCaption}`', '`${label}, ready`']) assert.ok(code.includes(pattern), pattern);
});

test('movement is transform and opacity only, but for the check, which draws; nothing loops', async () => {
  const code = await pill();
  const agenda = await readFile(path.join(root, 'migration/src/routes/Agenda.svelte'), 'utf8');
  for (const source of [code, agenda]) {
    for (const match of source.matchAll(/@keyframes ([\w-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
      const properties = new Set([...match[2].matchAll(/([a-z-]+)\s*:/g)].map((entry) => entry[1]));
      const allowed = match[1] === 'pill-tick' ? ['stroke-dashoffset'] : ['transform', 'opacity'];
      assert.deepEqual([...properties].filter((name) => !allowed.includes(name)), [], match[1]);
    }
    assert.doesNotMatch(source, /infinite/);
  }
});

test('Brand Studio\'s hub preview shows all four states; the old state word is gone', async () => {
  assert.deepEqual(SAMPLE_PILLS.map((sample) => sample.state), ['done', 'progress', 'ready', 'locked']);
  const code = await pill();
  assert.doesNotMatch(code, /state = 'default'/);
  const types = await readFile(path.join(root, 'migration/src/components/types.ts'), 'utf8');
  assert.match(types, /export type ActivityState = 'done' \| 'progress' \| 'ready' \| 'locked';/);
});
