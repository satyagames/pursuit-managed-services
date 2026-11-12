// Prompt 44: the architecture's boundaries, from the import graph of migration/src (every `import ... from`, `export ... from` and `import()`
// of a relative path). It fails, and prints each one, on:
//   1. a layer importing a higher one. The layers, low to high (docs/RULES.md, "Architecture"):
//        lib/schema -> lib/data -> lib/common, lib/settings, lib/access -> lib/participant, lib/results, lib/brand, lib/effects, lib/motion
//        -> lib/admin, lib/exports, lib/setup -> components/, pager/, routes/, admin/, setup/, preview/ -> the apps -> the entries.
//      styles/, assets/ and unsupported/ hold no code of the layers and anyone may use them;
//   2. the participant page reaching the admin's code: nothing reachable from main.ts is in admin/, lib/admin, lib/exports or lib/setup;
//   3. the admin's screens (admin/) importing components/, pager/ or routes/ other than through the door, preview/index.ts;
//   4. a file outside lib/data importing a part of it: only dataService.js, and the two helpers with no state that are not parts
//      (read-groups.js, session.js: docs/DECISIONS.md, "The data layer");
//   5. an import cycle;
//   6. a .js or .ts module without the header comment scripts/module-header.js reads.
// Exceptions are in ALLOWED below, each with its reason; a listed exception that no longer happens fails too, so the list only shrinks.
// Run: node --test scripts/test-boundaries.js (also part of npm test)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { headerOf } from './module-header.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'migration/src';

/** The layers, low to high: a file may import its own layer and those below. */
export const LAYERS = [
  ['lib/schema'],
  ['lib/data'],
  ['lib/common', 'lib/settings', 'lib/access'],
  ['lib/participant', 'lib/results', 'lib/brand', 'lib/effects', 'lib/motion'],
  ['lib/admin', 'lib/exports', 'lib/setup'],
  ['components', 'pager', 'routes', 'admin', 'setup', 'preview'],
  ['App.svelte', 'AdminApp.svelte', 'SetupApp.svelte', 'dev'],
  ['main.ts', 'admin-main.ts', 'setup-main.ts'],
];
/** Folders of no layer: what they hold is not code of the app's layers (sheets, fonts, pictures, the old-browser notice), so anyone may use them. */
export const LEAVES = ['styles', 'assets', 'unsupported'];
/** What the participant page must never carry. */
export const ADMIN_ONLY = ['admin', 'lib/admin', 'lib/exports', 'lib/setup'];
/** The participant's own pieces, which the admin reaches only through preview/. */
export const PARTICIPANT_UI = ['components', 'pager', 'routes'];
/** What a file outside lib/data may import from it. */
export const DATA_DOORS = ['lib/data/dataService.js', 'lib/data/read-groups.js', 'lib/data/session.js'];

/**
 * The exceptions, each one an edge `from -> to` (paths under migration/src) and why it is allowed. Each is a module placed in a higher layer than
 * the code that needs it; moving it is a structural change for its own commit (see docs/REFACTOR-44.md, "Chosen not to do").
 */
export const ALLOWED = [
  ['lib/data/pictures.js', 'lib/brand/asset-names.js', 'the data layer names an uploaded picture by the brand\'s naming rule (sha-256 and slot); the rule has no state and no other import but asset-specs.js'],
  ['lib/data/planning.js', 'lib/participant/confidence-check.js', 'a planned session carries the confidence check; the check\'s record ids (@before, @after) are defined with its flow'],
  ['lib/data/responses.js', 'lib/participant/confidence-check.js', 'the answer readers tell a check\'s records (@before, @after) from an activity\'s'],
  ['lib/data/today.js', 'lib/participant/confidence-check.js', 'Go live adds the client\'s confidence check to the session'],
  ['lib/data/responses.js', 'lib/participant/aop-answer.js', 'the answer readers decode an Art of the Possible answer by the format the pager stores'],
  ['lib/results/dashboard-model.js', 'lib/exports/leader-report.js', 'the dashboard counts exactly as the leader report does (COUNTING_RULES, decision of Prompt 21 Phase 5)'],
  ['lib/results/dashboard-model.js', 'lib/admin/session-plan.js', 'the fiscal period of a session (periodOf) is defined with the session plan'],
  ['lib/results/index-math.js', 'lib/admin/session-plan.js', 'the fiscal period of a session (periodOf) is defined with the session plan'],
  ['lib/results/session-summary.js', 'lib/admin/session-plan.js', 'the fiscal period of a session (periodOf) is defined with the session plan'],
  ['lib/setup/setupData.ts', 'setup/sample-picture-data.ts', 'the sample pictures are data (generated), kept beside Setup\'s screens by Phase 10f'],
  ['App.svelte', 'dev/Styleguide.svelte', 'the styleguide is a development page: App.svelte imports it only under import.meta.env.DEV, so no build carries it'],
];

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = path.join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : [full];
});
const posix = (file) => file.split(path.sep).join('/');
/** A file's place under migration/src. */
const under = (file) => posix(path.relative(path.join(ROOT, SRC), file));

/** The source text without comments (a comment that names an import is not one). Strings are kept. */
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

/** Every source file, and its relative imports as files under migration/src: { file -> [{ to, dynamic }] }. */
export function importGraph() {
  const files = walk(path.join(ROOT, SRC)).filter((file) => /\.(svelte|js|ts)$/.test(file) && !file.endsWith('.d.ts'));
  const graph = new Map();
  for (const file of files) {
    const code = withoutComments(readFileSync(file, 'utf8'));
    const edges = [];
    const add = (spec, dynamic) => {
      if (!spec.startsWith('.')) return;
      const base = path.resolve(path.dirname(file), spec.replace(/\?.*$/, ''));
      const found = [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, `${base}.js`, `${base}.svelte`, path.join(base, 'index.ts'), path.join(base, 'index.js')]
        .find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
      edges.push({ to: under(found ?? base), dynamic });
    };
    for (const [, spec] of code.matchAll(/(?:^|[\s;])(?:import|export)\s(?:[^'"`;]*?\sfrom\s)?['"]([^'"]+)['"]/g)) add(spec, false);
    for (const [, spec] of code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) add(spec, true);
    graph.set(under(file), edges);
  }
  return graph;
}

/** The area a file belongs to: `lib/<folder>`, a top folder, or a file at migration/src's top. */
export function areaOf(file) {
  const parts = file.split('/');
  if (parts[0] === 'lib') return `lib/${parts[1]}`;
  return parts.length === 1 ? parts[0] : parts[0];
}
const layerOf = (file) => {
  const area = areaOf(file);
  if (LEAVES.includes(area) || /\.css$/.test(file)) return null;
  const at = LAYERS.findIndex((layer) => layer.includes(area));
  return at === -1 ? undefined : at;
};
const isAllowed = (from, to) => ALLOWED.some(([a, b]) => a === from && b === to);

/** The breaches of rules 1 to 4, as words, and the allowed edges that were seen. */
export function breaches(graph) {
  const found = [];
  const used = new Set();
  const note = (from, to, why) => {
    if (isAllowed(from, to)) { used.add(`${from} -> ${to}`); return; }
    found.push(`${from} -> ${to}: ${why}`);
  };
  for (const [from, edges] of graph) {
    const own = layerOf(from);
    if (own === undefined) found.push(`${from}: in no layer (add its folder to LAYERS or LEAVES in scripts/test-boundaries.js)`);
    for (const { to } of edges) {
      const theirs = layerOf(to);
      if (theirs === undefined) found.push(`${from} -> ${to}: imports a file in no layer`);
      if (own != null && theirs != null && theirs > own) note(from, to, `a lower layer (${areaOf(from)}) imports a higher one (${areaOf(to)})`);
      if (areaOf(from) === 'admin' && PARTICIPANT_UI.includes(areaOf(to))) note(from, to, 'the admin reaches the participant\'s pieces only through preview/index.ts');
      if (to.startsWith('lib/data/') && !from.startsWith('lib/data/') && !DATA_DOORS.includes(to)) note(from, to, 'only lib/data/dataService.js is the data layer\'s door');
    }
  }
  // 2. What main.ts reaches, statically or by import().
  const seen = new Set();
  const visit = (file, trail) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (ADMIN_ONLY.includes(areaOf(file))) found.push(`the participant page reaches ${file} (${trail.join(' -> ')})`);
    for (const { to } of graph.get(file) ?? []) {
      if (isAllowed(file, to) && areaOf(to) === 'dev') { used.add(`${file} -> ${to}`); continue; }
      visit(to, [...trail, to]);
    }
  };
  visit('main.ts', ['main.ts']);
  return { found, used };
}

/** Each cycle of the static graph, once, as the files on it. */
export function cyclesOf(graph) {
  const cycles = [];
  const state = new Map();
  const stack = [];
  const visit = (node) => {
    state.set(node, 1);
    stack.push(node);
    for (const { to, dynamic } of graph.get(node) ?? []) {
      if (dynamic) continue;
      if (state.get(to) === 1) cycles.push(stack.slice(stack.indexOf(to)).join(' -> '));
      else if (!state.has(to)) visit(to);
    }
    stack.pop();
    state.set(node, 2);
  };
  for (const node of graph.keys()) if (!state.has(node)) visit(node);
  return cycles;
}

describe('the boundaries of migration/src', () => {
  const graph = importGraph();

  it('reads the whole source tree', () => {
    assert.ok(graph.size > 300, `${graph.size} files`);
    assert.ok(graph.has('preview/index.ts'), 'the preview door is there');
  });

  it('no layer imports a higher one; the participant page reaches none of the admin\'s code; the admin reaches the participant\'s pieces only through preview/; only dataService.js opens the data layer', () => {
    const { found } = breaches(graph);
    assert.deepEqual(found, [], `${found.length} breach(es):\n  ${found.join('\n  ')}\n`);
  });

  it('every exception of ALLOWED still happens and says why (the list only shrinks)', () => {
    const { used } = breaches(graph);
    const stale = ALLOWED.filter(([from, to]) => !used.has(`${from} -> ${to}`)).map(([from, to]) => `${from} -> ${to}`);
    assert.deepEqual(stale, [], 'an exception that no longer happens: take it out of ALLOWED');
    for (const [, , why] of ALLOWED) assert.ok(why.length > 30, 'each exception says why');
  });

  it('nothing imports in a cycle', () => {
    assert.deepEqual(cyclesOf(graph), []);
  });

  it('every .js and .ts module of migration/src has its header comment', () => {
    const missing = [...graph.keys()].filter((file) => /\.(js|ts)$/.test(file) && !file.startsWith('assets/'))
      .filter((file) => headerOf(readFileSync(path.join(ROOT, SRC, file), 'utf8')).replace(/[\s/*]/g, '').length < 60);
    assert.deepEqual(missing, [], 'each needs a header comment saying what it owns (scripts/module-header.js)');
  });

  it('the checks can fail', () => {
    const fake = new Map([
      ['lib/data/core.js', [{ to: 'lib/admin/admin-today.js', dynamic: false }]],
      ['admin/AdminToday.svelte', [{ to: 'routes/Quiz.svelte', dynamic: false }, { to: 'lib/data/core.js', dynamic: false }]],
      ['main.ts', [{ to: 'App.svelte', dynamic: false }]],
      ['App.svelte', [{ to: 'lib/exports/resultsExport.js', dynamic: true }]],
      ['lib/admin/admin-today.js', []],
      ['routes/Quiz.svelte', []],
      ['lib/exports/resultsExport.js', []],
    ]);
    const { found } = breaches(fake);
    assert.equal(found.length, 4, found.join('\n'));
    assert.match(found.join('\n'), /lib\/data\/core\.js -> lib\/admin\/admin-today\.js: a lower layer/);
    assert.match(found.join('\n'), /admin\/AdminToday\.svelte -> routes\/Quiz\.svelte: the admin reaches/);
    assert.match(found.join('\n'), /admin\/AdminToday\.svelte -> lib\/data\/core\.js: only lib\/data\/dataService\.js/);
    assert.match(found.join('\n'), /the participant page reaches lib\/exports\/resultsExport\.js/);
    assert.equal(cyclesOf(new Map([['a', [{ to: 'b' }]], ['b', [{ to: 'a' }]]])).length, 1);
    assert.equal(cyclesOf(new Map([['a', [{ to: 'b', dynamic: true }]], ['b', [{ to: 'a' }]]])).length, 0, 'an import() makes no cycle at load');
  });
});
