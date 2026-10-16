import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { before, test } from 'node:test';
import { load } from 'cheerio';
import { build } from 'vite';

const root = path.join(import.meta.dirname, '..');
const output = path.join(root, 'build-svelte', 'setup');

before(async () => {
  await build({ configFile: path.join(root, 'migration', 'vite.setup.config.ts'), logLevel: 'silent' });
});

test('setup migration builds to one self-contained HTML page without private seed data', async () => {
  const files = await readdir(output, { withFileTypes: true });
  assert.deepEqual(files.map((file) => file.name), ['setup.html']);
  assert.ok(files.every((file) => file.isFile()));

  const content = await readFile(path.join(output, 'setup.html'), 'utf8');
  const html = load(content);
  assert.equal(html('script[src], link[rel="stylesheet"]').length, 0);
  assert.equal(html('script[type="module"]').length, 1);
  assert.match(content, /Check Lists/);
  assert.match(content, /Import Missing Records/);
  assert.ok(!content.includes('q-straight-talk-objective'), 'private seed content must not be bundled');
});