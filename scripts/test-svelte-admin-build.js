import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { before, test } from 'node:test';
import { load } from 'cheerio';
import { build } from 'vite';

const root = path.join(import.meta.dirname, '..');
const output = path.join(root, 'build-svelte', 'admin');

before(async () => {
  await build({ configFile: path.join(root, 'migration', 'vite.admin.config.ts'), logLevel: 'silent' });
});

test('admin migration builds to one self-contained standalone HTML page', async () => {
  const files = await readdir(output, { withFileTypes: true });
  assert.deepEqual(files.map((file) => file.name), ['admin.html']);
  assert.ok(files.every((file) => file.isFile()));

  const content = await readFile(path.join(output, 'admin.html'), 'utf8');
  const html = load(content);
  assert.equal(html('script[src], link[rel="stylesheet"]').length, 0);
  assert.equal(html('script[type="module"]').length, 1);
  assert.match(content, /Pursuit Managed Services Admin/);
  assert.match(content, /SharePoint permissions control data access/);
  assert.ok(!content.includes('q-straight-talk-objective'), 'private seed content must not be bundled');
});