// Phase 17: the shape of the data layer since dataService.js was cut into parts (docs/DECISIONS.md, "The data layer"):
//   - its state lives in ONE module, lib/data/core.js: a page (the facade and every part) is one instance, and configure() through any door is
//     seen by all of them; no other part keeps state or calls fetch();
//   - the facade, dataService.js, holds no code: it passes on the public names of the parts and nothing else, and no file of the app imports a
//     part directly;
//   - nothing under migration/src imports in a cycle, and core.js imports no part that uses it;
//   - no part is over MAX_LINES, and every part has its header;
//   - scripts/fresh-page.js gives each tagged import (`dataService.js?page=2`) its own copy of every part.
import './fresh-page.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { headerOf } from './module-header.js';
import { tagged } from './fresh-page-hook.js';

const ROOT = path.join(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'migration', 'src');
const DATA = path.join(SRC, 'lib', 'data');
const DATA_URL = new URL('../migration/src/lib/data/', import.meta.url);
/** The longest a part of lib/data may be: a reader (or a model) loads only the part they change, and 600 lines is one sitting (Phase 17). */
export const MAX_LINES = 600;
/** The files of lib/data that are not parts of the data service: read-groups.js is a helper the admin's reads import (Phase 9b). */
const NOT_PARTS = ['read-groups.js'];

const text = (file) => readFile(file, 'utf8').then((value) => value.replace(/\r\n/g, '\n'));
const parts = async () => (await readdir(DATA)).filter((name) => name.endsWith('.js') && name !== 'dataService.js' && !NOT_PARTS.includes(name)).sort();
const withoutComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
/** The names a module exports: `export function x`, `export const x`, `export { a, b }`. */
function exportsOf(code) {
  const names = new Set();
  for (const [, name] of code.matchAll(/^export (?:async )?(?:function\*?|const|let|class) (\w+)/gm)) names.add(name);
  for (const [, list] of code.matchAll(/^export \{([^}]*)\}(?! from)/gm)) for (const name of list.split(',').map((part) => part.trim()).filter(Boolean)) names.add(name);
  return names;
}
/** { from: names[] } of a module's static imports of other parts of lib/data. */
function partImportsOf(code) {
  const out = {};
  for (const [, list, from] of code.matchAll(/^import \{([^}]*)\} from '\.\/([\w-]+\.js)';/gm)) out[from] = list.split(',').map((part) => part.trim()).filter(Boolean);
  return out;
}

describe('the data layer is a facade over parts, with its state in core.js (Phase 17)', () => {
  it('a page is one instance: the facade and a part imported with the same tag share their state, and configure() through either is seen by both', async () => {
    const page = await import(new URL('dataService.js?modules=1', DATA_URL).href);
    const core = await import(new URL('core.js?modules=1', DATA_URL).href);
    const records = await import(new URL('records.js?modules=1', DATA_URL).href);
    assert.equal(page.configure, core.configure, 'the facade hands out core.js\'s own configure()');
    assert.equal(page.getAppSettings, records.getAppSettings);
    const settings = { siteUrl: 'https://contoso.sharepoint.com/sites/pms' };
    page.configure({ sharePoint: settings });
    assert.equal(core.sharePoint, settings, 'configured through the facade, seen in core.js');
    assert.equal(page.isSharePointMode(), true);
    core.configure({ baseUrl: '/api' });
    assert.equal(page.isSharePointMode(), false, 'configured through core.js, seen through the facade');
    assert.equal(core.sharePoint, null);
  });

  it('two pages are two instances: another tag is another core.js, as it was another dataService.js', async () => {
    const one = await import(new URL('dataService.js?modules=2', DATA_URL).href);
    const two = await import(new URL('dataService.js?modules=3', DATA_URL).href);
    assert.notEqual(one.configure, two.configure);
    one.configure({ sharePoint: { siteUrl: 'https://contoso.sharepoint.com/sites/pms' } });
    two.configure({ baseUrl: '/api' });
    assert.equal(one.isSharePointMode(), true);
    assert.equal(two.isSharePointMode(), false, 'one page\'s settings are not the other\'s');
  });

  it('the hook tags only lib/data\'s own imports, and only from a tagged module', () => {
    const data = (name, query = '') => `file:///repo/migration/src/lib/data/${name}${query}`;
    assert.equal(tagged(data('core.js'), data('dataService.js', '?page=3')), data('core.js', '?page=3'));
    assert.equal(tagged(data('core.js'), data('dataService.js')), data('core.js'), 'no tag, nothing to hand on');
    assert.equal(tagged('file:///repo/migration/src/lib/schema/pms-schema.js', data('core.js', '?page=3')), 'file:///repo/migration/src/lib/schema/pms-schema.js', 'the schema is one module, as it always was');
    assert.equal(tagged(data('core.js'), 'file:///repo/migration/src/lib/admin/session-delete.js?x=1'), data('core.js'), 'a tagged admin module does not tag the data layer');
    assert.equal(tagged(data('core.js', '?own=1'), data('dataService.js', '?page=3')), data('core.js', '?own=1'));
    assert.equal(tagged('node:fs', data('core.js', '?page=3')), 'node:fs');
  });

  it('only core.js keeps state and calls fetch(); no other part declares a variable or a cache at its top', async () => {
    const offenders = [];
    for (const name of await parts()) {
      const code = withoutComments(await text(path.join(DATA, name)));
      if (name === 'core.js') continue;
      if (/\bfetch\(/.test(code)) offenders.push(`${name} calls fetch()`);
      for (const [line] of code.matchAll(/^(?:let|var) .*$/gm)) offenders.push(`${name}: ${line}`);
      for (const [line] of code.matchAll(/^(?:export )?const \w+ = new (?:Weak)?(?:Map|Set)\(.*$/gm)) offenders.push(`${name}: ${line}`);
    }
    assert.deepEqual(offenders, []);
    const core = withoutComments(await text(path.join(DATA, 'core.js')));
    assert.match(core, /^let sharePoint\b/m, 'and core.js does hold the state (so the check above looks at the right thing)');
    assert.ok(/\bfetch\(/.test(core));
    // The check can fail.
    assert.match('let cache = null;', /^(?:let|var) .*$/m);
    assert.match('const seen = new WeakMap();', /^(?:export )?const \w+ = new (?:Weak)?(?:Map|Set)\(.*$/m);
  });

  it('the facade holds no code: it passes on each part\'s public names and nothing else, each from the part that declares it', async () => {
    const facade = await text(path.join(DATA, 'dataService.js'));
    const statements = withoutComments(facade).replace(/export \{[^}]*\} from '\.\/[\w-]+\.js';/g, '').trim();
    assert.equal(statements, '', 'nothing in dataService.js but comments and `export { ... } from` its parts');
    const passed = new Map();
    for (const [, list, from] of facade.matchAll(/export \{([^}]*)\} from '\.\/([\w-]+\.js)';/g)) {
      for (const name of list.split(',').map((part) => part.trim()).filter(Boolean)) {
        assert.ok(!passed.has(name), `${name} is passed on twice`);
        passed.set(name, from);
      }
    }
    const surface = JSON.parse(await readFile(path.join(ROOT, 'scripts', 'data-surface.json'), 'utf8')).map((entry) => entry.name);
    assert.deepEqual([...passed.keys()].sort(), surface.sort(), 'exactly the public surface');
    const imported = new Set();
    const exported = {};
    for (const name of await parts()) {
      const code = await text(path.join(DATA, name));
      exported[name] = exportsOf(code);
      for (const names of Object.values(partImportsOf(code))) for (const used of names) imported.add(used);
    }
    for (const [name, from] of passed) assert.ok(exported[from]?.has(name), `${from} exports ${name}`);
    // Every other export of a part is there because another part imports it: none is public by accident, none is left over.
    const stray = [];
    for (const [file, names] of Object.entries(exported)) for (const name of names) if (!passed.has(name) && !imported.has(name)) stray.push(`${file}: ${name}`);
    assert.deepEqual(stray, []);
  });

  it('no file of the app imports a part of lib/data directly: the facade is the door', async () => {
    const offenders = [];
    for (const file of await sourceFiles(SRC)) {
      if (path.dirname(file) === DATA) continue;
      const code = await text(file);
      for (const [, target] of code.matchAll(/from ['"]([^'"]*lib\/data\/[\w-]+\.js|\.\.?\/(?:\.\.\/)*data\/[\w-]+\.js)['"]/g)) {
        const name = path.basename(target);
        if (name !== 'dataService.js' && !NOT_PARTS.includes(name)) offenders.push(`${path.relative(ROOT, file).split(path.sep).join('/')} imports ${target}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it('nothing under migration/src imports in a cycle, and core.js imports nothing of the parts that use it', async () => {
    const graph = await importGraph();
    assert.ok(graph.size > 140, `${graph.size} files read`);
    assert.deepEqual(cyclesOf(graph), []);
    const coreImports = Object.keys(partImportsOf(await text(path.join(DATA, 'core.js'))));
    assert.deepEqual(coreImports, ['encoding.js'], 'core.js imports only the part with no state');
    // The cycle check can fail.
    assert.equal(cyclesOf(new Map([['a', ['b']], ['b', ['c']], ['c', ['a']]])).length, 1);
    assert.deepEqual(cyclesOf(new Map([['a', ['b']], ['b', []]])), []);
  });

  it(`no part of lib/data is over ${MAX_LINES} lines, and each has a header saying what it owns`, async () => {
    const problems = [];
    for (const name of [...await parts(), 'dataService.js']) {
      const code = await text(path.join(DATA, name));
      const lines = code.split('\n').length;
      if (lines > MAX_LINES) problems.push(`${name} is ${lines} lines`);
      if (headerOf(code).replace(/[\s/*]/g, '').length < 60) problems.push(`${name} has no header`);
    }
    assert.deepEqual(problems, []);
    assert.ok((await parts()).length >= 10, 'the parts are there');
  });
});

async function sourceFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') out.push(...await sourceFiles(file)); }
    else if (/\.(js|ts|svelte)$/.test(entry.name)) out.push(file);
  }
  return out;
}

/** file -> the files it imports statically (dynamic import() is left out: it is lazy on purpose and cannot make a cycle at load). */
async function importGraph() {
  const graph = new Map();
  for (const file of await sourceFiles(SRC)) {
    const code = withoutComments(await text(file));
    const targets = [];
    for (const [, spec] of code.matchAll(/(?:^|[\s;])(?:import|export)\s(?:[^'"`;]*?\sfrom\s)?['"]([^'"]+)['"]/g)) {
      if (!spec.startsWith('.')) continue;
      const base = path.resolve(path.dirname(file), spec.replace(/\?.*$/, ''));
      const found = [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, `${base}.js`, path.join(base, 'index.ts')].find((candidate) => existsSync(candidate) && /\.(js|ts|svelte)$/.test(candidate));
      if (found) targets.push(found);
    }
    graph.set(file, targets);
  }
  return graph;
}

/** Each cycle of a graph (file -> files), once, as the files on it. */
export function cyclesOf(graph) {
  const cycles = [];
  const state = new Map(); // undefined: not seen; 1: on the path; 2: done
  const stack = [];
  const visit = (node) => {
    state.set(node, 1);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (state.get(next) === 1) cycles.push(stack.slice(stack.indexOf(next)).map((file) => path.relative(ROOT, file).split(path.sep).join('/')));
      else if (!state.has(next)) visit(next);
    }
    stack.pop();
    state.set(node, 2);
  };
  for (const node of graph.keys()) if (!state.has(node)) visit(node);
  return cycles;
}
