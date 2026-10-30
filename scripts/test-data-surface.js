// Phase 17: what the data service offers (its public surface) is exactly what scripts/data-surface.json lists: each name, what it is, and
// how many parameters a function declares before its first default. The parts of lib/data behind it may move; this may not change unnoticed.
// A name added, taken away or renamed on purpose is a decision of its own: change data-surface.json AND the count in docs/DECISIONS.md
// ("The data layer"), in the same commit, and say why there. (scripts/test-participant-storage.js keeps its own list of the names too.)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as ds from '../migration/src/lib/data/dataService.js';

const ROOT = path.join(import.meta.dirname, '..');
const SURFACE = JSON.parse(await readFile(path.join(ROOT, 'scripts', 'data-surface.json'), 'utf8'));

/** One export as data-surface.json writes it. */
export function describeExport(name, value) {
  const kind = typeof value === 'function' ? (value.constructor.name === 'AsyncFunction' ? 'async function' : 'function') : typeof value;
  return { name, kind, ...(typeof value === 'function' ? { arity: value.length } : {}) };
}

/** The surface of a module namespace, sorted by name. */
export const surfaceOf = (namespace) => Object.keys(namespace).sort().map((name) => describeExport(name, namespace[name]));

/** What differs between two surfaces, in words: [] when they are the same. */
export function surfaceDifferences(expected, actual) {
  const want = new Map(expected.map((entry) => [entry.name, entry]));
  const have = new Map(actual.map((entry) => [entry.name, entry]));
  const problems = [];
  for (const name of want.keys()) if (!have.has(name)) problems.push(`${name} is gone`);
  for (const name of have.keys()) if (!want.has(name)) problems.push(`${name} is new`);
  for (const [name, entry] of want) {
    const now = have.get(name);
    if (now && JSON.stringify(now) !== JSON.stringify(entry)) problems.push(`${name} was ${JSON.stringify(entry)}, is ${JSON.stringify(now)}`);
  }
  return problems;
}

describe('the data service\'s public surface (Phase 17)', () => {
  it('is exactly what scripts/data-surface.json lists: every name, its kind and its arity', () => {
    assert.deepEqual(surfaceDifferences(SURFACE, surfaceOf(ds)), [], 'a change to the surface is a decision: data-surface.json and docs/DECISIONS.md change with it');
    assert.equal(SURFACE.length, 127); // (Prompt 23: matrixRowFields, uploadGuestPicture, removeGuestPicture. Phase 17: 107. Prompt 19: the page's SharePoint sign-in, five names of lib/data/session-calls.js. Prompt 21: access, five names; Phase 2: three more, lib/data/access-people.js; Phase 3: two, lib/data/planning.js; Phase 5: two, lib/data/summaries.js.)
  });

  it('docs/DECISIONS.md states the same number of names, so the surface cannot change without it', async () => {
    const decisions = await readFile(path.join(ROOT, 'docs', 'DECISIONS.md'), 'utf8');
    const row = decisions.split('\n').find((line) => line.includes('scripts/data-surface.json'));
    assert.ok(row, 'docs/DECISIONS.md has a row that names scripts/data-surface.json');
    assert.match(row, new RegExp(`\\b${SURFACE.length} names\\b`), `that row says "${SURFACE.length} names"`);
  });

  it('the comparison can fail: a name added, one taken away, one renamed, a changed arity or kind', () => {
    const now = surfaceOf(ds);
    assert.deepEqual(surfaceDifferences(SURFACE, [...now, { name: 'extra', kind: 'function', arity: 0 }]), ['extra is new']);
    assert.deepEqual(surfaceDifferences(SURFACE, now.filter((entry) => entry.name !== 'openQrScan')), ['openQrScan is gone']);
    assert.deepEqual(surfaceDifferences(SURFACE, now.map((entry) => (entry.name === 'beginVisit' ? { ...entry, name: 'startVisit' } : entry))), ['beginVisit is gone', 'startVisit is new']);
    assert.equal(surfaceDifferences(SURFACE, now.map((entry) => (entry.name === 'configure' ? { ...entry, arity: 2 } : entry))).length, 1);
    assert.equal(surfaceDifferences(SURFACE, now.map((entry) => (entry.name === 'configure' ? { ...entry, kind: 'async function' } : entry))).length, 1);
    assert.deepEqual(describeExport('x', async (a, b = 1) => a + b), { name: 'x', kind: 'async function', arity: 1 });
    assert.deepEqual(describeExport('y', 20), { name: 'y', kind: 'number' });
  });
});
