// Phase 14: the documents name only what is there (scripts/check-docs.js), and the check can fail on each kind of problem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkDocs, pathProblem, slug } from './check-docs.js';

const ROOT = path.join(import.meta.dirname, '..');

test('every document of the repository names only files, scripts, anchors and lists that exist', () => {
  assert.deepEqual(checkDocs(), []);
});

test('the check finds a dead path, a dead link, a missing anchor, an unknown script and an unknown list', async () => {
  const fixture = 'docs/.check-docs-fixture.md';
  await writeFile(path.join(ROOT, fixture), [
    '# A heading',
    'See `migration/src/lib/nowhere/gone.js` and `lib/results/results-tally.js` and `boot.js` and `nothing-called-this.js`.',
    'Links: [ok](../README.md), [dead](../NOT-HERE.md), [anchor](#a-heading), [no anchor](#no-such-heading).',
    'Run `npm run test:charts` and npm run not-a-script.',
    'The lists PMSClients and PMSNoSuchList.',
    'Named because it is gone: `public/config.js`. In git history at 7347c72: `Design-Docs/references/X.md`.',
    '```',
    'npm run inside-a-fence-is-still-checked',
    '```',
  ].join('\n'));
  try {
    const problems = checkDocs({ files: [fixture] }).map((line) => line.replace(/^[^:]+:\d+: /, ''));
    assert.deepEqual(problems.sort(), [
      'PMSNoSuchList is not a list or the library of the schema',
      'no tracked file is called nothing-called-this.js',
      'nothing in the repository is at migration/src/lib/nowhere/gone.js',
      'npm run inside-a-fence-is-still-checked is not a script of package.json',
      'npm run not-a-script is not a script of package.json',
      'the link #no-such-heading names no heading of docs/.check-docs-fixture.md',
      'the link ../NOT-HERE.md points at nothing',
    ].sort());
  } finally {
    await rm(path.join(ROOT, fixture), { force: true });
  }
});

test('what is a path and what is not', () => {
  assert.equal(pathProblem('lib/data/dataService.js'), null);
  assert.equal(pathProblem('src/admin/charts/'), null);
  assert.equal(pathProblem('res.status().json'), null);
  assert.equal(pathProblem('build-svelte/package/pms-<commit>/'), null);
  assert.match(pathProblem('lib/dataService.js'), /nothing in the repository/);
  assert.equal(slug('Rules from Phase 10c-2b (one schema file, the PMS list names, schema v2; keep them holding)'), 'rules-from-phase-10c-2b-one-schema-file-the-pms-list-names-schema-v2-keep-them-holding');
});
