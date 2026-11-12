// Prompt 41: the Deloitte green palette for the whole admin page (and Setup, which shares its tokens). Three things are held here:
//   1. The tokens exist with the brief's values (the six brand colours and what is derived from them), in styles/admin-tokens.css.
//   2. Every pair of words is 4.5:1 and every mark (an icon, a graph mark, a selected edge) 3:1 on the grounds it sits on. Each pair is printed;
//      the brand's own colours that fall under a floor are printed as REPORTED with the only way they may be used, and a rule of the sources
//      holds them to it (the accent is never words or behind words; the 60% neutral and the info/warn colours are never words).
//   3. No admin source writes a colour of its own: no hex, rgb() or hsl() in a style outside admin-tokens.css (the logo's [fill='#fff']
//      selectors excepted). A colour value a screen shows as data (a client's brand colour) is not a style, so only styles are read.
// Run: node --test scripts/test-admin-palette.js (also part of npm test)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrastRatio } from '../migration/src/lib/brand/theme.js';
import { resolver } from './admin-token-values.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS = 'migration/src/styles/admin-tokens.css';
const read = (file) => readFile(path.join(ROOT, file), 'utf8');

/** The brief's table (Prompt 41), with its alpha values as the solid colour they make on white. */
const PALETTE = {
  'adm-ink': '#222222', 'adm-neutral': '#7a7a7a', 'adm-neutral-strong': '#595959', 'adm-line': '#e9e9e9', 'adm-line-strong': '#d3d3d3',
  'adm-bg': '#f5f6f4', 'adm-surface': '#ffffff', 'adm-surface-2': '#fafaf9', 'adm-primary': '#26890d', 'adm-primary-hover': '#1f7009',
  'adm-primary-wash': '#eaf4e6', 'adm-accent': '#0df200', 'adm-on-accent': '#222222', 'adm-graph-1': '#0097a9', 'adm-graph-2': '#00a3e0',
  'adm-graph-3': '#75787b', 'adm-warn': '#b7791f', 'adm-warn-wash': '#fbf3e2', 'adm-danger': '#b4443a', 'adm-danger-wash': '#fbedeb',
  'adm-dark': '#222222', 'adm-ok': '#26890d', 'adm-info': '#0097a9', 'adm-live': '#0df200',
};

/** Words on their grounds: 4.5:1. [ink, ground, where] */
export const TEXT = [
  ['adm-ink', 'adm-bg', 'body text on the page'], ['adm-ink', 'adm-surface', 'body text on a card'], ['adm-ink', 'adm-surface-2', 'a stripe'],
  ['adm-ink', 'adm-primary-wash', 'a selected row, a group band'], ['adm-ink', 'adm-info-wash', 'an info banner'], ['adm-ink', 'adm-warn-wash', 'a warning banner'],
  ['adm-ink', 'adm-danger-wash', 'an error banner'], ['adm-ink', 'adm-graph-1-10', 'the lightest heat tile'], ['adm-ink', 'adm-graph-1', 'the deepest heat tile'],
  ['adm-ink', 'adm-graph-1-65', 'a heat tile'], ['adm-on-accent', 'adm-accent', 'a word on an accent fill'],
  ['adm-neutral-strong', 'adm-surface', 'secondary words on a card'], ['adm-neutral-strong', 'adm-bg', 'secondary words on the page'],
  ['adm-neutral-strong', 'adm-surface-2', 'a neutral chip'], ['adm-neutral-strong', 'adm-primary-wash', 'a hint in a selected row'],
  ['adm-on-primary', 'adm-primary', 'a primary button, a chip, Go live'], ['adm-on-primary', 'adm-primary-hover', 'a primary button, hovered'],
  ['adm-primary', 'adm-surface', 'a link on a card'], ['adm-primary-hover', 'adm-bg', 'a link on the page'], ['adm-primary-hover', 'adm-primary-wash', 'a word in a success chip'],
  ['adm-danger', 'adm-surface', 'a danger button'], ['adm-danger', 'adm-danger-wash', 'a word in a danger chip'], ['adm-warn-ink', 'adm-warn-wash', 'a word in a warning chip'],
  ['adm-on-primary', 'adm-dark', 'words on the dark wall, a tooltip'],
];
/** Marks that carry meaning: 3:1. */
export const MARKS = [
  ['adm-primary', 'adm-surface', 'an active icon, a switch that is on, the focus ring'], ['adm-primary', 'adm-bg', 'the focus ring on the page'],
  ['adm-primary', 'adm-primary-wash', 'the focus ring on a wash, a group band\'s badge'], ['adm-ok', 'adm-surface', 'check-circle'],
  ['adm-info', 'adm-surface', 'the info icon'], ['adm-info', 'adm-info-wash', 'the info icon on its wash'], ['adm-warn', 'adm-surface', 'alert-triangle'],
  ['adm-warn', 'adm-warn-wash', 'alert-triangle on its wash'], ['adm-danger', 'adm-danger-wash', 'alert-octagon on its wash'], ['adm-neutral', 'adm-surface', 'an icon at rest'],
  ['adm-graph-1', 'adm-surface', 'a series-1 mark'], ['adm-graph-3', 'adm-surface', 'a series-3 mark'],
  ['adm-graph-1', 'adm-dark', 'series 1 on the dark wall'], ['adm-graph-2', 'adm-dark', 'series 2 on the dark wall'], ['adm-graph-3', 'adm-dark', 'series 3 on the dark wall'],
  ['adm-accent', 'adm-dark', 'an accent line or dot on the dark wall'], ['adm-ink', 'adm-surface', 'a baseline marker'],
];
/** The brand's own colours under a floor: measured and printed, and held to the use the sources may make of them. */
export const REPORTED = [
  ['adm-accent', 'adm-surface', 1.6, 'decoration only (underline, edge, dot, glow): never words, never behind words'],
  ['adm-accent', 'adm-bg', 1.6, 'decoration only'],
  ['adm-neutral', 'adm-surface', 4.5, 'icons, placeholders and large figures; words use --adm-neutral-strong'],
  ['adm-primary', 'adm-bg', 4.5, 'words on the page use --adm-primary-hover'],
  ['adm-primary', 'adm-primary-wash', 4.5, 'words on a wash use --adm-primary-hover'],
  ['adm-graph-2', 'adm-surface', 3, 'a bar\'s value is always written beside it in --adm-ink'],
  ['adm-on-primary', 'adm-graph-1', 4.5, 'no white words on a heat tile: they are ink'],
];

export function pairReport(css) {
  const value = resolver(css);
  const lines = [];
  const failures = [];
  for (const [pairs, least] of [[TEXT, 4.5], [MARKS, 3]]) {
    for (const [ink, ground, where] of pairs) {
      if (!value(ink) || !value(ground)) { failures.push(`${ink} or ${ground} is not defined`); continue; }
      const ratio = contrastRatio(value(ink), value(ground));
      lines.push(`${ratio >= least ? 'pass' : 'FAIL'} ${ratio.toFixed(2)}:1 (${least}) ${ink} on ${ground}: ${where}`);
      if (ratio < least) failures.push(`${ink} on ${ground}: ${ratio.toFixed(2)} (needs ${least})`);
    }
  }
  for (const [ink, ground, under, use] of REPORTED) {
    const ratio = contrastRatio(value(ink), value(ground));
    lines.push(`REPORTED ${ratio.toFixed(2)}:1 ${ink} on ${ground}: ${use}`);
    if (ratio >= under) failures.push(`${ink} on ${ground} is ${ratio.toFixed(2)}: no longer under ${under}, move it to the pairs`);
  }
  return { lines, failures };
}

/** Every admin source with styles: the admin's components, the dev styleguide, the look and the sheets, Setup's sheet and the two apps. */
async function sources() {
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(rel);
      else if (/\.(svelte|css)$/.test(entry.name)) files.push(rel);
    }
  };
  await walk('migration/src/admin');
  // (Prompt 44: src/admin.css and src/admin-look.css are the sheets of styles/admin/ now, in their order.)
  await walk('migration/src/styles/admin');
  files.push('migration/src/AdminApp.svelte', 'migration/src/SetupApp.svelte',
    'migration/src/setup.css', 'migration/src/dev/AdminStyleguide.svelte');
  return files;
}

/** The style text of a file: a sheet whole, a component's <style> blocks and its style="" and style:x= values. Comments are dropped. */
export function styleText(file, text) {
  const body = file.endsWith('.css')
    ? text
    : [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
      + '\n' + [...text.matchAll(/\bstyle(?::[a-z-]+)?=(?:"([^"]*)"|\{([^}]*)\})/g)].map((m) => m[1] ?? m[2]).join('\n');
  return body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/:is\(path, rect\)\[fill='#fff'\]/g, '');
}

export const COLOUR = /#[0-9a-f]{3,8}\b|%23[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|:\s*(?:white|black)\s*[;}]/i;

/**
 * Prompt 44: the colours admin code writes as data, not as a style: each is marked in its file with a comment (`data colour: ...`) and listed
 * here with why it stays literal. Anything else in code is a token.
 */
export const DATA_COLOURS = [
  { file: 'migration/src/admin/BrandColours.svelte', value: '#ffffff', why: 'the accent picker\'s starting value when a client has no accent: a native colour input needs a literal #rrggbb, and it is the client\'s data, not the page\'s look' },
  { file: 'migration/src/lib/admin/live-view.js', value: '#0f172a', why: 'the Live display\'s stand-in for a client with no primary colour, passed to the exports as the client\'s colour (data, as Phase 11b had it)' },
  { file: 'migration/src/lib/admin/live-view.js', value: '#64748b', why: 'the stand-in for a client with no secondary colour, passed on as the client\'s colour (data)' },
  { file: 'migration/src/admin/ReportExports.svelte', value: '#000000', why: 'an SVG path with no fill of its own is black by the SVG rule; the PDF writer is given that literal for it, so the file draws what the screen does' },
];

/** Every admin file with code: the components' scripts and markup, lib/admin, and the two apps. */
async function codeSources() {
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(rel);
      else if (/\.(svelte|js|ts)$/.test(entry.name) && !entry.name.startsWith('.')) files.push(rel);
    }
  };
  await walk('migration/src/admin');
  await walk('migration/src/lib/admin');
  files.push('migration/src/AdminApp.svelte', 'migration/src/SetupApp.svelte');
  return files;
}

/** The hex colours written in a file's code, its comments, <style> blocks (the style lint's) and HTML entities left out. */
export function codeColours(text) {
  const code = text.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1').replace(/&#x?[0-9a-f]+;/gi, '');
  return [...code.matchAll(/['"`]\s*(#[0-9a-f]{3,8})\b/gi)].map((match) => match[1]);
}

describe('the Deloitte green palette (Prompt 41)', () => {
  it('every token of the brief exists with its value', async () => {
    const value = resolver(await read(TOKENS));
    for (const [name, hex] of Object.entries(PALETTE)) assert.equal(value(name), hex, `--${name}`);
    const css = await read(TOKENS);
    assert.match(css, /--adm-accent-glow: rgb\(13 242 0 \/ 0\.35\);/, 'the focus glow: the accent at 35%');
    assert.match(css, /--adm-shadow: 0 1px 2px rgb\(34 34 34 \/ 0\.05\), 0 8px 24px rgb\(34 34 34 \/ 0\.06\);/, 'the card shadow');
    for (const name of ['adm-grad-graph-1', 'adm-grad-graph-2', 'adm-grad-graph-3']) {
      const n = name.slice(-1);
      assert.match(css, new RegExp(`--${name}: linear-gradient\\(90deg, var\\(--adm-graph-${n}-45\\), var\\(--adm-graph-${n}\\)\\);`), name);
    }
  });

  it('the old palette is gone: no colour of Prompt 38 is left', async () => {
    const css = (await read(TOKENS)).toLowerCase();
    for (const old of ['#1f2a24', '#2f6b4f', '#a9cb6b', '#22513b', '#16231c', '#4b574f', '#3b7f8c', '#3f8f5a', '#e7ebe3', '#f6f7f3']) assert.ok(!css.includes(old), old);
  });

  it('the charts on the admin page draw with the three graph colours and their tints only', async () => {
    const css = await read(TOKENS);
    const value = resolver(css);
    const allowed = new Set(['#0097a9', '#00a3e0', '#75787b', '#e6f5f6', '#bfe5ea', '#a6dbe1', '#8cd0d8', '#66c1cb', '#59bbc7', '#26a7b6', '#a6dff4', '#8cd6f1', '#66c8ec', '#d6d7d7', '#cfd0d1', '#c1c2c4', '#acaeb0']);
    for (const name of ['viz-primary', 'viz-primary-tint', 'viz-secondary', 'viz-tertiary', 'viz-not-measured', ...[1, 2, 3, 4].map((n) => `viz-heat-${n}`),
      ...[1, 2, 3].map((n) => `viz-ramp-3-${n}`), ...[1, 2, 3, 4].map((n) => `viz-ramp-4-${n}`), ...[1, 2, 3, 4, 5].map((n) => `viz-ramp-5-${n}`)]) {
      assert.ok(allowed.has(value(name)), `--${name} is ${value(name)}, not a graph colour or its tint`);
    }
    assert.match(css, /--viz-bar: var\(--adm-grad-graph-1\);/);
    assert.equal(value('viz-correct'), '#26890d', 'Correct is the tick in the primary, not a bar colour');
    assert.equal(value('viz-heat-ink'), '#222222');
    // results-tokens.css (the paper files' palette) is loaded first, so the admin's names win on the page.
    const main = await read('migration/src/admin-main.ts');
    assert.ok(main.indexOf("'./styles/results-tokens.css'") < main.indexOf("'./styles/admin-tokens.css'"), 'admin-tokens.css after results-tokens.css');
  });

  it('words are 4.5:1 and marks 3:1; the brand colours under a floor are reported with their use', async () => {
    const { lines, failures } = pairReport(await read(TOKENS));
    console.log(lines.join('\n'));
    assert.deepEqual(failures, []);
  });

  it('the check fails when a word colour is set to 4.4:1', async () => {
    const css = await read(TOKENS);
    const weakened = css.replace(/--adm-neutral-strong:\s*#[0-9a-f]{6}/i, '--adm-neutral-strong: #787878');
    assert.notEqual(weakened, css);
    assert.ok(pairReport(weakened).failures.some((failure) => failure.startsWith('adm-neutral-strong on adm-surface: 4.4')));
  });

  it('the accent is never words or behind words, and the colours under 4.5:1 are never words', async () => {
    const offences = [];
    const accent = /var\(--adm-(?:accent|lime|live|accent-glow)\)/;
    const weak = /var\(--adm-(?:neutral|subtle|info|warn|ok|graph-[123]|sky)\)/;
    for (const file of await sources()) {
      const css = styleText(file, await read(file));
      for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = rule[1].trim();
        for (const decl of rule[2].matchAll(/(?:^|;)\s*(color|background(?:-color)?)\s*:\s*([^;]+)/g)) {
          const [, prop, val] = decl;
          if (prop === 'color' && accent.test(val)) offences.push(`${file}: ${selector}: accent words`);
          // An accent fill is allowed only on a mark: a dot, a bar's end, an edge, a rule, an initials badge (whose words are --adm-on-accent).
          if (prop.startsWith('background') && accent.test(val) && !/dot|mark|end|edge|rule|bar|badge|initials|line|step|track|::before|::after|__fill|live|underline/.test(selector)) offences.push(`${file}: ${selector}: accent fill behind words`);
          if (prop === 'color' && weak.test(val) && !/\.icon|icon\b|svg|__mark|__tick|__dot|::placeholder|figure|empty|art|glyph|Icon|chevron/i.test(selector)) offences.push(`${file}: ${selector}: a mark colour used for words`);
        }
      }
    }
    assert.deepEqual(offences, []);
  });

  it('no admin source writes a colour of its own (a lint over every admin style)', async () => {
    const offences = [];
    for (const file of await sources()) {
      const css = styleText(file, await read(file));
      for (const line of css.split('\n')) if (COLOUR.test(line)) offences.push(`${file}: ${line.trim()}`);
    }
    assert.deepEqual(offences, []);
  });

  it('no admin code writes a hex colour either, except the data colours listed with why (Prompt 44)', async () => {
    const offences = [];
    const seen = new Set();
    for (const file of await codeSources()) {
      for (const value of codeColours(await read(file))) {
        const listed = DATA_COLOURS.find((entry) => entry.file === file && entry.value === value.toLowerCase());
        if (listed) seen.add(`${file} ${value.toLowerCase()}`);
        else offences.push(`${file}: ${value} (a colour is a token of admin-tokens.css or results-tokens.css; a data colour is listed in DATA_COLOURS with why)`);
      }
    }
    assert.deepEqual(offences, []);
    assert.deepEqual(DATA_COLOURS.filter((entry) => !seen.has(`${entry.file} ${entry.value}`)).map((entry) => `${entry.file} ${entry.value}`), [], 'a listed data colour that is no longer there');
    for (const entry of DATA_COLOURS) assert.ok(entry.why.length > 20, `${entry.file} ${entry.value}: why it stays literal`);
    for (const entry of DATA_COLOURS) assert.match(await read(entry.file), /data colour: /, `${entry.file}: the colour is marked where it is written`);
    // The check can fail.
    assert.deepEqual(codeColours("const x = { fill: '#26890d' }; // '#ffffff' in a comment\n/* '#000' */"), ['#26890d']);
    assert.deepEqual(codeColours('<p>&#8226;</p><style>.x { color: #fff; }</style>'), []);
  });

  it('the lint can fail', () => {
    assert.ok(COLOUR.test(styleText('x.svelte', '<div></div><style>.x { color: #26890d; }</style>')));
    assert.ok(COLOUR.test(styleText('x.svelte', '<div style="color: rgb(0 0 0)"></div>')));
    assert.ok(COLOUR.test(styleText('x.css', ".x { background: url(\"data:image/svg+xml,%3Cpath stroke='%23334155'/%3E\"); }")));
    assert.ok(!COLOUR.test(styleText('x.css', ".shell__wordmark :is(path, rect)[fill='#fff'] { fill: var(--adm-ink); }")), 'the logo is allowed');
  });

  it('the focus ring is 2 px of the primary with the accent at 35% outside it; the active tab\'s underline is the accent', async () => {
    const admin = await read('migration/src/styles/admin/base.css');
    const ring = /:where\(a, button, input, select, textarea, summary, \[tabindex\]\):focus-visible \{([^}]*)\}/.exec(admin)?.[1] ?? '';
    assert.match(ring, /outline: 2px solid var\(--focus\);/);
    assert.match(ring, /box-shadow: 0 0 0 \d+px var\(--adm-accent-glow\);/);
    assert.equal(resolver(await read(TOKENS))('focus'), '#26890d');
    const look = (await Promise.all(['look-type-bar.css', 'look-surfaces.css', 'look-menus.css'].map((file) => read(`migration/src/styles/admin/${file}`)))).join(String.fromCharCode(10));
    assert.match(look, /border-bottom-color: var\(--adm-accent\);/);
  });
});
