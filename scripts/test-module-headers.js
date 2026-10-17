// Phase 14: every module under migration/src/lib says what it is for at its top, and lives in a folder by module (no file at lib/'s top).
// The header is the first thing after the imports: a comment of a full line or more, saying what the module owns, what it reads and writes,
// and what it must not do. docs/MODULES.md lists the folders; scripts/check-docs.js holds that list to the tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { headerOf } from './module-header.js';

const LIB = path.join(import.meta.dirname, '..', 'migration', 'src', 'lib');

test('every module under migration/src/lib has a header comment, and sits in a folder', async () => {
  const names = (await readdir(LIB, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile() && /\.(js|ts)$/.test(entry.name) && !entry.name.startsWith('.'));
  assert.ok(names.length > 90, `${names.length} modules`);
  const missing = [];
  const loose = [];
  for (const entry of names) {
    const file = path.join(entry.parentPath ?? entry.path, entry.name);
    const relative = path.relative(LIB, file).split(path.sep).join('/');
    if (!relative.includes('/')) loose.push(relative);
    const header = headerOf(await readFile(file, 'utf8'));
    if (header.replace(/[\s/*]/g, '').length < 60) missing.push(relative);
  }
  assert.deepEqual(loose, [], 'a module belongs in a folder of lib/ (docs/MODULES.md)');
  assert.deepEqual(missing, [], 'each of these needs a header comment saying what it owns, reads and writes, and must not do');
});

test('the header rule can fail', () => {
  assert.equal(headerOf("import x from 'y';\n\nexport type A = { a: 1 };\n"), '');
  assert.equal(headerOf('export const a = 1;\n// a comment further down\n'), '');
  assert.match(headerOf("// What this is for.\nimport x from 'y';\n"), /What this is for/);
  assert.match(headerOf("import x from 'y';\nimport {\n  a,\n  b,\n} from 'z';\n\n/**\n * What this is for.\n */\nexport const a = 1;\n"), /What this is for/);
});
