// Prompt 38: the admin page's calm look. The palette's tokens exist with the brief's values; every pair of words is 4.5:1 and every mark 3:1; the
// look's stylesheet (migration/src/admin-look.css) writes no colour of its own and spaces only on the scale (4, 8, 12, 16, 24, 32, 48, and the 6 px
// between a label and its field). Run: node --test scripts/test-admin-look.js (also part of npm test)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrastRatio } from '../migration/src/lib/brand/theme.js';
import { resolver } from './admin-token-values.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tokens = () => readFile(path.join(ROOT, 'migration/src/styles/admin-tokens.css'), 'utf8');
const look = () => readFile(path.join(ROOT, 'migration/src/admin-look.css'), 'utf8');
// (Prompt 41: the names are aliases of the Deloitte green palette now, so a value follows its var() chain.)
const valueIn = (css) => resolver(css);

/** Prompt 38's names, on Prompt 41's Deloitte green palette, which replaced Prompt 38's colours (scripts/test-admin-palette.js holds the brief). */
const PALETTE = {
  'adm-bg': '#f5f6f4', 'adm-surface': '#ffffff', 'adm-surface-2': '#fafaf9', 'adm-line': '#e9e9e9', 'adm-line-strong': '#d3d3d3',
  'adm-ink': '#222222', 'adm-ink-2': '#595959', 'adm-subtle': '#7a7a7a', 'adm-primary': '#26890d', 'adm-primary-deep': '#1f7009',
  'adm-primary-wash': '#eaf4e6', 'adm-accent': '#0df200', 'adm-info': '#0097a9', 'adm-warn': '#b7791f', 'adm-danger': '#b4443a', 'adm-ok': '#26890d',
  'adm-info-wash': '#e6f5f6', 'adm-warn-wash': '#fbf3e2', 'adm-danger-wash': '#fbedeb', 'adm-ok-wash': '#eaf4e6', 'adm-dark1': '#222222',
};

/** Words on their grounds: 4.5:1. */
const TEXT = [
  ['adm-ink', 'adm-bg'], ['adm-ink', 'adm-surface'], ['adm-ink', 'adm-surface-2'], ['adm-ink-2', 'adm-bg'], ['adm-ink-2', 'adm-surface'],
  ['adm-ink-2', 'adm-surface-2'], ['adm-ink-2', 'adm-line'], ['adm-primary', 'adm-surface'], ['adm-primary-deep', 'adm-bg'], ['adm-primary-deep', 'adm-primary-wash'],
  ['adm-on-deep', 'adm-primary'], ['adm-on-deep', 'adm-primary-deep'], ['adm-ink', 'adm-accent'], ['adm-on-deep', 'adm-dark1'],
  ['adm-info-ink', 'adm-info-wash'], ['adm-warn-ink', 'adm-warn-wash'], ['adm-danger-ink', 'adm-danger-wash'], ['adm-ok-ink', 'adm-ok-wash'],
  ['adm-ink', 'adm-info-wash'], ['adm-ink', 'adm-warn-wash'], ['adm-ink', 'adm-danger-wash'], ['adm-ink', 'adm-ok-wash'], ['adm-idle-ink', 'adm-idle-bg'],
  ['adm-on-deep', 'adm-danger-ink'], ['adm-on-deep', 'adm-ink'],
];
/** Marks that carry meaning (an icon, a status shape): 3:1. */
const MARKS = [
  ['adm-subtle', 'adm-surface'], ['adm-primary', 'adm-surface'], ['adm-info', 'adm-surface'], ['adm-warn', 'adm-surface'], ['adm-danger', 'adm-surface'],
  ['adm-ok', 'adm-surface'], ['adm-info', 'adm-info-wash'], ['adm-warn', 'adm-warn-wash'], ['adm-danger', 'adm-danger-wash'], ['adm-ok', 'adm-ok-wash'],
  ['adm-ink-2', 'adm-surface'], ['adm-accent', 'adm-dark1'],
];

function pairFailures(css) {
  const value = valueIn(css);
  const failures = [];
  for (const [pairs, least] of [[TEXT, 4.5], [MARKS, 3]]) {
    for (const [ink, ground] of pairs) {
      if (!value(ink) || !value(ground)) { failures.push(`${ink} or ${ground} is not defined`); continue; }
      const ratio = contrastRatio(value(ink), value(ground));
      if (ratio < least) failures.push(`${ink} on ${ground}: ${ratio.toFixed(2)} (needs ${least})`);
    }
  }
  return failures;
}

const SCALE = new Set(['0', 'auto', '100%', '6px', '4px', '8px', '12px', '16px', '24px', '32px', '48px']);
/** Each padding, margin or gap value of `css` that is off the scale, as "selector: property value". */
function offScale(css) {
  const off = [];
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const rule of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const decl of rule[2].matchAll(/(?:^|;)\s*((?:padding|margin|gap|row-gap|column-gap)(?:-[a-z-]+)?)\s*:\s*([^;]+)/g)) {
      // A step of the scale, the gutter (24 or 16), the bars' heights and the page's padding and width (Prompt 39) are tokens; 100% is the window; env() is the device's safe area; calc(), max() and their
      // operators and plain multipliers only combine them. Whatever is left must be on the scale.
      const parts = decl[2]
        .replace(/var\(--adm-(?:s[1-7]|gutter|bar-height|bar-h|page-pad|page-max|inset|tab-pad|tab-gap|field-inset)\)/g, ' ')
        .replace(/env\([^()]*\)/g, ' ')
        .replace(/\b(?:calc|max|min)\(|[(),]|\s[+*/-]\s/g, ' ')
        .trim().split(/\s+/).filter((part) => part && !/^\d+$/.test(part));
      if (parts.some((part) => !SCALE.has(part))) off.push(`${rule[1].trim()}: ${decl[1]} ${decl[2].trim()}`);
    }
  }
  return off;
}

describe('the admin look (Prompt 38)', () => {
  it('every token of the brief exists with its value', async () => {
    const value = valueIn(await tokens());
    for (const [name, hex] of Object.entries(PALETTE)) assert.equal(value(name), hex, `--${name}`);
    const css = await tokens();
    for (const name of ['grad-green', 'grad-teal', 'grad-amber', 'grad-rose', 'grad-slate', 'grad-green-dark', 'grad-teal-dark', 'grad-amber-dark']) assert.match(css, new RegExp(`--adm-${name}: linear-gradient\\(90deg`), name);
    for (const step of [4, 8, 12, 16, 24, 32, 48]) assert.match(css, new RegExp(`--adm-s\\d: ${step}px;`), `the ${step} px step`);
    assert.match(css, /--adm-radius: 14px;/);
    // (Prompt 39: no 1,280 px cap; the page is the window wide, centred only past 1,920 px, and the bar 56 px.)
    assert.match(css, /--adm-page-max: 1920px;/);
    assert.match(css, /--adm-page-pad: clamp\(16px, 2vw, 32px\);/);
    assert.match(css, /--adm-bar-h: 56px;/);
    assert.doesNotMatch(css, /--adm-content-max/);
    assert.match(css, /--adm-bar-height: 64px;/);
    // (Prompt 40: the tabs' 14 px and the 4 + 1 + 4 px between them; a label's inset is the field's border and padding.)
    assert.match(css, /--adm-tab-pad: 14px;/);
    assert.match(css, /--adm-tab-gap: 9px;/);
    assert.match(css, /--adm-field-inset: 13px;/);
  });

  it('words are 4.5:1 and marks 3:1 on their grounds', async () => {
    assert.deepEqual(pairFailures(await tokens()), []);
  });

  it('the check fails when a word colour is set to 4.4:1', async () => {
    const css = await tokens();
    const weakened = css.replace(/--adm-neutral-strong:\s*#[0-9a-f]{6}/i, '--adm-neutral-strong: #787878');
    assert.ok(pairFailures(weakened).some((failure) => failure.startsWith('adm-ink-2 on adm-surface: 4.4')));
  });

  it('muted, warn and info are under 4.5:1 on white (ok is under it on the page), so they are never words: no rule of the look sets them as a colour of text', async () => {
    const value = valueIn(await tokens());
    for (const name of ['adm-subtle', 'adm-warn', 'adm-info']) assert.ok(contrastRatio(value(name), '#ffffff') < 4.5, name);
    assert.ok(contrastRatio(value('adm-ok'), value('adm-bg')) < 4.5, 'ok on the page');
    const css = (await look()).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/\.icon\b|> \.icon/.test(rule[1])) continue;
      assert.doesNotMatch(rule[2], /(?:^|;)\s*color:\s*var\(--adm-(?:subtle|warn|ok|info|neutral)\)/, `${rule[1].trim()}: a mark colour used for words`);
    }
  });

  it('the look writes no colour of its own (only tokens, currentColor and forced-colors\' system colours)', async () => {
    const css = (await look()).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\[fill='#fff'\]/g, '');
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|:\s*(?:white|black)\b/i);
  });

  it('padding, margins and gaps keep to the spacing scale', async () => {
    assert.deepEqual(offScale(await look()), []);
    assert.deepEqual(offScale('.x { padding: 10px; }'), ['.x: padding 10px'], 'the check can fail');
  });

  it('the admin page loads the look after admin.css; the participant page and Setup do not', async () => {
    const admin = await readFile(path.join(ROOT, 'migration/src/admin-main.ts'), 'utf8');
    assert.ok(admin.indexOf("'./admin-look.css'") > admin.indexOf("'./admin.css'"), 'after admin.css');
    for (const file of ['main.ts', 'setup-main.ts']) assert.doesNotMatch(await readFile(path.join(ROOT, 'migration/src', file), 'utf8'), /admin-look\.css/, file);
  });
});

describe('a side column sticks only while it fits (Prompt 39, lib/admin/sticky-fit.js)', () => {
  it('fits when the column, the 56 px bar, the bottom bar and 16 px above and below are no taller than the window', async () => {
    const { fitsWindow, STICKY_ROOM } = await import('../migration/src/lib/admin/sticky-fit.js');
    assert.equal(STICKY_ROOM, 88);
    assert.equal(fitsWindow(500, 652, 64), true, '500 + 88 + 64 = 652');
    assert.equal(fitsWindow(501, 652, 64), false, 'a pixel taller scrolls with the page');
    assert.equal(fitsWindow(700, 800), true, 'no bottom bar');
    assert.equal(fitsWindow(0, 800), false, 'a column not drawn yet does not stick');
  });
});

describe('the selected row is shown inside its own scrolling column (Prompt 40, lib/admin/sticky-fit.js)', () => {
  it('scrolls the column, not the page, by the least that shows the whole row', async () => {
    const { scrollToShow } = await import('../migration/src/lib/admin/sticky-fit.js');
    // A column 400 px high at scroll 0: a row from 100 to 160 is in view already.
    assert.equal(scrollToShow({ scrollTop: 0, height: 400 }, { top: 100, height: 60 }), 0);
    // A row from 600 to 660 (in the column's content): scrolled so its bottom is the column's.
    assert.equal(scrollToShow({ scrollTop: 0, height: 400 }, { top: 600, height: 60 }), 260);
    // Above what shows: scrolled so its top is the column's.
    assert.equal(scrollToShow({ scrollTop: 500, height: 400 }, { top: 120, height: 60 }), 120);
    // Taller than the column: its top.
    assert.equal(scrollToShow({ scrollTop: 0, height: 100 }, { top: 300, height: 200 }), 300);
  });
});
