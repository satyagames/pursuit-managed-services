import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';

// The unsupported-browser check (Phase 8; migration/src/unsupported/support-check.js) as plain logic: run the real script text in a bare
// context standing in for a browser, take away one thing the app needs at a time, and see what it decides. The browser side (the
// notice drawn, in three engines, on all three pages, and the nomodule and parse-error paths) is scripts/migration-tests/unsupported.spec.ts.

const here = (file) => new URL(`../migration/${file}`, import.meta.url);
const source = readFileSync(here('src/unsupported/support-check.js'), 'utf8');

/** A browser that has everything the app needs, optionally with some of it taken away by `remove(context)`. */
function browser(remove) {
  const page = { style: {} };
  const listeners = {};
  const sandbox = {
    fetch() {}, URL, URLSearchParams, AbortController, structuredClone() {}, HTMLDialogElement: function HTMLDialogElement() {},
    AbortSignal: { timeout() {} },
    CSS: { supports: () => true, registerProperty() {} },
    document: { documentElement: { attachShadow() {} }, getElementById: (id) => (id === 'pms-unsupported' ? page : null) },
    addEventListener(type, handler) { listeners[type] = handler; },
  };
  const context = vm.createContext(sandbox);
  vm.runInContext('globalThis.window = globalThis;', context);
  remove?.(context, sandbox);
  vm.runInContext(source, context);
  return { context, page, listeners, sandbox };
}

test('a browser with everything the app needs sees no notice', () => {
  const { page, context } = browser();
  assert.equal(page.style.display, undefined);
  assert.notEqual(context.__pmsUnsupported, true);
});

const MISSING = [
  ['AbortSignal.timeout', (_, box) => { box.AbortSignal = {}; }],
  ['AbortSignal altogether', (_, box) => { delete box.AbortSignal; }],
  ['structuredClone', (_, box) => { delete box.structuredClone; }],
  ['Array.prototype.at', (context) => vm.runInContext('delete Array.prototype.at', context)],
  ['<dialog> (HTMLDialogElement)', (_, box) => { delete box.HTMLDialogElement; }],
  ['CSS.registerProperty', (_, box) => { delete box.CSS.registerProperty; }],
  ['color-mix()', (_, box) => { box.CSS.supports = (rule) => !/color-mix/.test(rule); }],
  ['the CSS object', (_, box) => { delete box.CSS; }],
  ['CSS.supports', (_, box) => { box.CSS = { registerProperty() {} }; }],
  ['CSS.supports that throws', (_, box) => { box.CSS.supports = () => { throw new Error('nope'); }; }],
];

for (const [what, remove] of MISSING) {
  test(`without ${what} the notice is shown and the app is told to stop`, () => {
    const { page, context } = browser(remove);
    assert.equal(page.style.display, 'block');
    assert.equal(context.__pmsUnsupported, true);
  });
}

test('a script error before the app has mounted shows the notice (a module that cannot be parsed, or that throws at the top)', () => {
  const { page, listeners, context } = browser();
  assert.equal(typeof listeners.error, 'function');
  listeners.error({ message: 'SyntaxError' });
  assert.equal(page.style.display, 'block');
  assert.equal(context.__pmsUnsupported, true);
});

test('after the app has mounted an error is its own business and never shows the notice', () => {
  const { page, listeners, context } = browser();
  context.__pmsMounted = true;
  listeners.error({ message: 'TypeError in a handler' });
  assert.equal(page.style.display, undefined);
  assert.notEqual(context.__pmsUnsupported, true);
});

test('the script is plain ES5: no arrow, let, const, template, class, async or spread, so that an old browser can still run it', () => {
  const code = source.replace(/^\s*\/\/.*$/gm, '');
  for (const [what, pattern] of [['an arrow', /=>/], ['let', /\blet\s/], ['const', /\bconst\s/], ['a template string', /`/], ['a class', /\bclass\s/], ['async', /\basync\b/], ['await', /\bawait\b/], ['spread', /\.\.\./], ['optional chaining', /\?\./], ['nullish', /\?\?/]]) {
    assert.doesNotMatch(code, pattern, what);
  }
  // It really does parse as a classic script.
  assert.doesNotThrow(() => new vm.Script(source));
});

test('the notice says what the brief asks, with the app name and the Deloitte wordmark as text, and costs about a kilobyte', () => {
  const page = readFileSync(here('src/unsupported/page.html'), 'utf8');
  assert.match(page, /role="heading" aria-level="1">This page needs a recent browser\.</, 'a heading for a screen reader, and not an h1 element that a page-wide h1 selector would trip over');
  assert.match(page, />Please open it in the latest Safari, Chrome, Edge or Firefox\.</);
  assert.match(page, /Deloitte<span>\.<\/span><\/span> %APP_NAME%/);
  assert.match(page, /<script nomodule>/, 'a browser without module scripts shows it');
  assert.match(page, /<noscript>/, 'and so does one with scripting off');
  // (The build leaves out the script's comment lines.)
  const all = `${page}${source.replace(/^\s*\/\/.*\n/gm, '')}`;
  const size = gzipSync(all, { level: 9 }).length;
  assert.ok(size < 1_300, `the notice and its script are ${size} B gzip on their own, to stay well inside the 2 KB Phase 8 allowance`);
});
