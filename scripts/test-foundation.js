import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

// Source-level guards for the Phase 1 design foundation. The built-page behaviour (fonts in the
// browser, kiosk events, no styleguide) is checked by scripts/migration-tests/foundation.spec.ts.

const root = path.join(import.meta.dirname, '..');
const read = (...parts) => readFile(path.join(root, ...parts), 'utf8');

async function files(dir, extensions) {
  const found = [];
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await files(relative, extensions));
    else if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(relative);
  }
  return found;
}

/** Class names a stylesheet targets, ignoring comments. */
function selectorClasses(css) {
  return new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((match) => match[1]));
}

test('component class names never collide with the global stylesheets the participant page loads', async () => {
  // Svelte scopes a component's own CSS, but it cannot stop a global rule from matching the
  // component's markup. A wrapper called .option once became a second pill that way.
  const global = new Set();
  for (const sheet of ['public/css/app.css', 'public/css/vfx.css', 'migration/src/app.css', 'migration/src/styles/base.css']) {
    for (const name of selectorClasses(await read(sheet))) global.add(name);
  }
  const shared = new Set(['sr-only']); // defined once in base.css on purpose
  const collisions = [];
  for (const file of [...await files('migration/src/components', ['.svelte']), ...await files('migration/src/dev', ['.svelte'])]) {
    const markup = (await read(file)).split('<style>')[0];
    const used = new Set();
    for (const match of markup.matchAll(/\bclass(?::([\w-]+))?\s*=\s*"([^"]*)"/g)) {
      if (match[1]) used.add(match[1]);
      for (const name of match[2].split(/\s+/)) if (name && !name.includes('{')) used.add(name);
    }
    for (const name of used) if (global.has(name) && !shared.has(name)) collisions.push(`${file}: .${name}`);
  }
  assert.deepEqual(collisions, [], 'rename these (a pms- prefix is the convention) so no global rule restyles them');
});

test('the Svelte app shows the product name from one constant and no longer shows the old one', async () => {
  assert.match(await read('migration/src/lib/app-name.ts'), /export const APP_NAME = 'Pursuit Managed Services';/);
  const stale = [];
  for (const file of [...await files('migration/src', ['.svelte', '.ts', '.js', '.css']), 'migration/index.html', 'migration/admin.html', 'migration/setup.html']) {
    const text = await read(file);
    // "Pursuits CEC" and a bare "CEC" are the old visible name. cec-, CEC_ and p_cec_ are internal
    // identifiers (storage keys, globals, deployment folders) and stay.
    for (const pattern of [/Pursuits?[ -]CEC/i, /\bCEC\b/]) if (pattern.test(text)) stale.push(`${file} matches ${pattern}`);
  }
  assert.deepEqual(stale, []);
  for (const page of ['index.html', 'admin.html', 'setup.html']) {
    assert.match(await read('migration', page), /<title>%APP_NAME%/, `${page} title comes from APP_NAME`);
  }
  assert.match(await read('migration/index.html'), /apple-mobile-web-app-title" content="%APP_NAME%"/);
});

test('the shared export code still defaults to the old product name, and the Live display passes its own', async () => {
  // The Live display (admin) passes brand.appName. The default was for the legacy callers, which left in Phase 10c-1; it is not changed here.
  const source = await read('public/js/resultsExport.js');
  // (Phase 11b: the writers take their library as an argument, so a node test can run them; the default is where it was.)
  assert.match(source, /export function pdfBytes\(pages, report, \{ jsPDF, producer = 'Pursuits CEC' \}\)/);
  assert.match(source, /export async function pptxFile\(pages, report, \{ PptxGenJS, producer = 'Pursuits CEC', outputType = 'blob' \}\)/);
  assert.match(source, /creator: producer/);
  assert.match(source, /pptx\.company = producer;/);
  assert.match(await read('migration/src/admin/LiveDisplay.svelte'), /appName: APP_NAME/);
});

test('the HTML shells no longer block zoom', async () => {
  for (const page of ['index.html', 'admin.html', 'setup.html']) {
    const viewport = /<meta name="viewport" content="([^"]*)"/.exec(await read('migration', page))?.[1] ?? '';
    assert.match(viewport, /width=device-width/, page);
    assert.doesNotMatch(viewport, /maximum-scale|user-scalable/i, `${page} must let people pinch-zoom`);
  }
});

test('the entries use the gated kiosk module, and the always-on script of the legacy pages is gone', async () => {
  for (const entry of ['main.ts', 'admin-main.ts', 'setup-main.ts']) {
    const source = await read('migration/src', entry);
    assert.doesNotMatch(source, /public\/js\/kiosk/, `${entry} must not import the always-on kiosk script`);
    assert.match(source, /import \{ installKiosk \} from '\.\/lib\/kiosk\.js';/, entry);
    assert.match(source, /\binstallKiosk\(\);/, `${entry} must call it`);
  }
  // Phase 10c-1: the legacy app left the branch (it is in the tag legacy-final), and its script with it.
  await assert.rejects(stat(path.join(root, 'public/js/kiosk.js')), { code: 'ENOENT' });
});

test('Open Sans ships as six small WOFF2 faces with the Apache licence beside them', async () => {
  const dir = path.join(root, 'migration/src/assets/fonts');
  const expected = ['open-sans-300', 'open-sans-400', 'open-sans-600', 'open-sans-700', 'open-sans-800', 'open-sans-800-italic'];
  const css = (await read('migration/src/styles/fonts.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  let total = 0;
  for (const name of expected) {
    const bytes = await readFile(path.join(dir, `${name}.woff2`));
    assert.equal(bytes.subarray(0, 4).toString('latin1'), 'wOF2', `${name} is a WOFF2 file`);
    total += bytes.length;
    assert.ok(css.includes(`../assets/fonts/${name}.woff2`), `fonts.css references ${name}`);
  }
  assert.ok(total <= 110_000, `fonts total ${total} bytes; the budget keeps the inlined fonts well under 150 KB`);
  assert.equal((css.match(/@font-face/g) ?? []).length, 6);
  assert.equal((css.match(/font-display:\s*swap/g) ?? []).length, 6, 'every face swaps in');
  assert.doesNotMatch(css, /url\(\s*['"]?https?:/i, 'no CDN');
  assert.match(await read('migration/src/assets/fonts/LICENSE-OpenSans-Apache-2.0.txt'), /Apache License[\s\S]*Version 2\.0/);
  const tokens = await read('migration/src/styles/tokens.css');
  assert.match(tokens, /--font-sans:\s*'Open Sans',[^;]*sans-serif;/, 'system fallback stack follows Open Sans');
});

test('type sizes scale with clamp() and body and option text never drop below 16px', async () => {
  const tokens = await read('migration/src/styles/tokens.css');
  for (const name of ['title', 'greeting', 'description', 'question', 'option', 'button', 'body']) {
    const value = new RegExp(`--fs-${name}:\\s*clamp\\(([^;]+)\\);`).exec(tokens)?.[1];
    assert.ok(value, `--fs-${name} uses clamp()`);
    const floor = value.split(',')[0].trim();
    assert.match(floor, /^[\d.]+rem$/, `--fs-${name} floor is in rem`);
    assert.ok(parseFloat(floor) * 16 >= 16, `--fs-${name} floor ${floor} is under 16px`);
  }
  assert.ok(parseFloat(/--fs-title:\s*clamp\(([\d.]+)rem/.exec(tokens)[1]) * 16 >= 32, 'titles are at least 32px on a phone');
});

test('a heading is focused by script only through lib/focus.ts, and only base.css says what that looks like', async () => {
  // The ring round a scripted heading focus is decided in one place (pointer or touch: nothing;
  // keyboard: the green ring). A screen that focused its own heading, or styled its own heading's
  // :focus, is how a black box came to sit round "Today's experience isn't live yet".
  const offenders = [];
  let focused = 0;
  for (const file of await files('migration/src', ['.svelte', '.ts'])) {
    const name = file.split(path.sep).join('/');
    if (name.startsWith('migration/src/dev/') || name.endsWith('lib/focus.ts')) continue;
    const text = (await read(file)).replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const headings = [...text.matchAll(/<h[1-6]\b[^>]*\btabindex="-1"[^>]*>/g)];
    if (headings.length > 0) {
      focused += 1;
      // (From inside lib/ itself the import is './focus.js': the stop screen of lib/start.ts, Phase 10b.)
      if (!/import \{ focusHeading \} from '(?:[^']*lib\/|\.\/)focus\.js'/.test(text)) offenders.push(`${name} has a focusable heading but does not use focusHeading`);
      if (/\bheading\??\.focus\(/.test(text)) offenders.push(`${name} focuses its heading itself`);
      const style = text.split('<style>')[1] ?? '';
      if (/(?:^|[\s,}])(?:h[1-6]|\.pms-question)[^{}]*:focus/.test(style)) offenders.push(`${name} styles its own heading's focus`);
    }
  }
  assert.deepEqual(offenders, []);
  assert.equal(focused, 8, 'NotLive, ThankYou, ActivityComplete, ActivityPager, (Phase 8) Welcome, the hub (Agenda) and the admin shell, and (Phase 10b) the stop screen of lib/start.ts; add a new one to scripts/migration-tests/focus.spec.ts and keyboard.spec.ts');
  const base = await read('migration/src/styles/base.css');
  assert.match(base, /:where\(h1, h2, h3, h4, h5, h6\)\[tabindex='-1'\]:focus \{\s*outline: none;\s*box-shadow: none;\s*\}/);
  assert.match(base, /\[tabindex='-1'\]\[data-keyboard-focus\]:focus \{\s*outline: 3px solid var\(--focus\);/);
  assert.match(await read('migration/src/lib/focus.ts'), /export const KEYBOARD_FOCUS = 'data-keyboard-focus'/);
});
