// Phase 14: docs/MODULES.md is what scripts/build-modules-map.js writes from the code, and every folder of code has a purpose in it.
// To bring it up to date: npm run docs:modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MODULES_FILE, PURPOSE, foldersWithoutPurpose, modulesMap } from './build-modules-map.js';

test('docs/MODULES.md is what the generator writes: run npm run docs:modules after adding, moving or changing a module', async () => {
  const committed = (await readFile(MODULES_FILE, 'utf8')).replace(/\r\n/g, '\n');
  assert.ok(committed === modulesMap(), 'docs/MODULES.md is stale: run npm run docs:modules and commit it');
});

test('every folder with code says what it is for', () => {
  assert.deepEqual(foldersWithoutPurpose(), [], 'add a line for each to PURPOSE in scripts/build-modules-map.js');
});

test('a stale map is noticed: a changed purpose changes what it writes', () => {
  const before = modulesMap();
  const folder = 'migration/src/lib/data';
  const purpose = PURPOSE[folder];
  PURPOSE[folder] = 'Something else.';
  try { assert.notEqual(modulesMap(), before); } finally { PURPOSE[folder] = purpose; }
});
