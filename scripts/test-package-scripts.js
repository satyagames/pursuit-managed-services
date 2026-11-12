// Prompt 44: package.json's scripts, and the test manifest npm test runs.
//   1. No key of `scripts` is written twice. JSON.parse keeps the last of two and says nothing, so a second "perf" quietly replaces the
//      first: the check reads the file's text.
//   2. Every scripts/test-*.js is in a group of scripts/tests.manifest.json or in its `excluded` list with a reason, so no test is forgotten and a
//      new one cannot be added without saying where it runs; every file the manifest names exists; a file is in one group at most.
//   3. npm test and the per-area scripts (test:report, test:charts...) run through scripts/run-tests.js, from the manifest.
// Run: node --test scripts/test-package-scripts.js (also part of npm test)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageText = readFileSync(path.join(ROOT, 'package.json'), 'utf8');

/**
 * The keys of one object of a JSON text, in order and with repeats, found by walking the text (strings and nesting understood), so that a key
 * written twice is seen. `at` is the path of keys to the object, e.g. ['scripts'].
 */
export function keysOf(text, at) {
  let index = 0;
  const space = () => { while (/\s/.test(text[index])) index += 1; };
  const string = () => {
    let out = '';
    index += 1;
    while (text[index] !== '"') {
      if (text[index] === '\\') { out += text.slice(index, index + 2); index += 2; } else { out += text[index]; index += 1; }
    }
    index += 1;
    return JSON.parse(`"${out}"`);
  };
  /** Reads one value; returns the keys of the object at `want` when it reaches it. */
  const value = (trail) => {
    space();
    if (text[index] === '{') {
      index += 1;
      const keys = [];
      let found = null;
      space();
      if (text[index] === '}') { index += 1; return { keys, found }; }
      for (;;) {
        space();
        const key = string();
        keys.push(key);
        space();
        index += 1; // (the colon)
        const inner = value([...trail, key]);
        found ??= inner.found;
        space();
        if (text[index] === ',') { index += 1; continue; }
        index += 1; // (the closing brace)
        break;
      }
      return { keys, found: found ?? (trail.length === at.length && trail.every((key, n) => key === at[n]) ? keys : null) };
    }
    if (text[index] === '[') {
      index += 1;
      let found = null;
      space();
      if (text[index] === ']') { index += 1; return { keys: [], found }; }
      for (;;) {
        found ??= value(trail).found;
        space();
        if (text[index] === ',') { index += 1; continue; }
        index += 1;
        break;
      }
      return { keys: [], found };
    }
    if (text[index] === '"') { string(); return { keys: [], found: null }; }
    while (index < text.length && !/[,}\]\s]/.test(text[index])) index += 1;
    return { keys: [], found: null };
  };
  return value([]).found ?? [];
}

/** The keys written more than once. */
export const repeated = (keys) => [...new Set(keys.filter((key, at) => keys.indexOf(key) !== at))];

describe('package.json', () => {
  it('writes no key of "scripts" twice', () => {
    assert.deepEqual(repeated(keysOf(packageText, ['scripts'])), [], 'a key written twice: JSON keeps only the last');
  });

  it('the check can fail: a key written twice is found, and one written once is not', () => {
    const text = '{ "name": "x", "scripts": { "perf": "a", "b": "{\\"perf\\": 1}", "perf": "a" }, "other": { "perf": 1, "perf": 2 } }';
    assert.deepEqual(keysOf(text, ['scripts']), ['perf', 'b', 'perf']);
    assert.deepEqual(repeated(keysOf(text, ['scripts'])), ['perf']);
    assert.deepEqual(repeated(keysOf('{ "scripts": { "a": "1", "b": "2" } }', ['scripts'])), []);
  });
});

/** What package.json's hand-written `test` ran when Prompt 44 began (pms-43, 842d9e4), by name: npm test must still run each of them. */
const BEFORE_44 = `reply-format fewer-calls paging sign-in-again sessions store sharepoint session theme foundation pager effects confetti-plan hub-moment
hub-look participant-storage participant-waits seeds admin-today admin-icons admin-look admin-palette admin-defaults today-view
admin-content admin-content-views admin-results session-delete brand brand-studio-view brand-studio-embedded brand-storage bundle-budget
polling live-display live-view leader-report leader-report-pdf participant-names unsupported oracle review-9a review-9b site-override
third-party-notices request-baseline deploy-settings list-namespace settings-file setup-deployment schema-baseline schema list-keys
schema-version lists-reference named-reads duplicates shown-names column-names schema-upgrade fake-site provision provision-prefix
site-ready setup-admins text-limits sample-pictures release-docs results-chart-model results-palette participant-contrast results-wall
results-chart-fit present-fit page-watch results-export leader-report-charts ux-12 export-summary leader-report-glance results-pack
results-csv module-headers check-docs data-surface data-modules modules-map project-map motion-plan aop-motion finale-motion motion-engine
motion-switch confidence-check access users sessions-plan scope guest-group index-math session-summary leader-dashboard hide-names
access-recheck hardening reporting-settings aop-math aop-view aop-editor aop-results guest-picture site-access-words site-access site-sync
access-message`.split(/\s+/).map((name) => `scripts/test-${name}.js`);
/** The tests Prompt 44 added to npm test. */
const ADDED_44 = ['scripts/test-package-scripts.js', 'scripts/test-boundaries.js', 'scripts/test-admin-router.js', 'scripts/test-unused-exports.js']
  .filter((file) => existsSync(path.join(ROOT, file)));

describe('the test manifest (scripts/tests.manifest.json)', async () => {
  const { allFiles, filesFor, readManifest } = await import('./run-tests.js');
  const manifest = readManifest();
  const grouped = Object.values(manifest.groups).flat();
  const onDisk = readdirSync(path.join(ROOT, 'scripts')).filter((name) => /^test-.*\.js$/.test(name)).map((name) => `scripts/${name}`);

  it('has the ten groups the brief names', () => {
    assert.deepEqual(Object.keys(manifest.groups), ['schema', 'data', 'admin', 'results', 'exports', 'brand', 'setup', 'motion', 'participant', 'release']);
  });

  it('puts every scripts/test-*.js in one group, or in excluded with a reason', () => {
    const nowhere = onDisk.filter((file) => !grouped.includes(file) && !(file in manifest.excluded));
    assert.deepEqual(nowhere, [], 'a test file in no group: add it to a group of scripts/tests.manifest.json, or to excluded with why');
    const twice = grouped.filter((file, at) => grouped.indexOf(file) !== at);
    assert.deepEqual(twice, [], 'a file in two groups');
    const both = grouped.filter((file) => file in manifest.excluded);
    assert.deepEqual(both, [], 'a file both run and excluded');
    for (const [file, why] of Object.entries(manifest.excluded)) assert.ok(typeof why === 'string' && why.length > 20, `${file}: say why it is excluded`);
  });

  it('names only files that exist', () => {
    const named = [...grouped, ...Object.values(manifest.suites).flat(), ...Object.keys(manifest.excluded)];
    assert.deepEqual(named.filter((file) => !existsSync(path.join(ROOT, file))), []);
  });

  it('runs, as npm test, exactly what the hand-written list ran, and the tests Prompt 44 added', () => {
    assert.deepEqual([...allFiles(manifest)].sort(), [...BEFORE_44, ...ADDED_44].sort());
  });

  it('gives every per-area npm script its suite, made of files the manifest knows, and package.json runs them all through scripts/run-tests.js', () => {
    const scripts = JSON.parse(packageText).scripts;
    assert.equal(scripts.test, 'node scripts/run-tests.js');
    for (const [name, files] of Object.entries(manifest.suites)) {
      assert.equal(scripts[name], `node scripts/run-tests.js --suite ${name}`, `npm run ${name} reads its suite`);
      for (const file of files) assert.ok(grouped.includes(file) || file in manifest.excluded, `${name}: ${file} is in a group or excluded`);
      assert.deepEqual(filesFor(['--suite', name], manifest), files);
    }
    const handWritten = Object.entries(scripts).filter(([, command]) => /node --test /.test(command)).map(([name]) => name);
    assert.deepEqual(handWritten, [], 'a script with its own list of test files: give it a suite in the manifest');
  });

  it('the check can fail: a file in no group, and one in two, are found', () => {
    const broken = { ...manifest, groups: { ...manifest.groups, admin: manifest.groups.admin.slice(1), release: [...manifest.groups.release, manifest.groups.schema[0]] } };
    const lost = manifest.groups.admin[0];
    const flat = Object.values(broken.groups).flat();
    assert.ok(!flat.includes(lost) && !(lost in broken.excluded), 'the first admin file is in no group');
    assert.ok(flat.filter((file) => file === manifest.groups.schema[0]).length === 2, 'the first schema file is in two');
  });
});
