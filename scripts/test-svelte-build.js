import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { before, test } from 'node:test';
import { load } from 'cheerio';
import { build } from 'vite';

const root = path.join(import.meta.dirname, '..');
const output = path.join(root, 'build-svelte', 'participant');

before(async () => {
  await build({ configFile: path.join(root, 'migration', 'vite.config.ts'), logLevel: 'silent' });
});

test('participant foundation builds to one self-contained HTML page', async () => {
  const files = await readdir(output, { withFileTypes: true });
  assert.deepEqual(files.map((file) => file.name), ['index.html']);
  assert.ok(files.every((file) => file.isFile()));

  const content = await readFile(path.join(output, 'index.html'), 'utf8');
  const html = load(content);
  assert.equal(html('script[src], link[rel="stylesheet"]').length, 0);
  assert.equal(html('script[type="module"]').length, 1);
  // The current participant copy (the pilot strings this used to look for are gone).
  assert.match(content, /Click here to begin/);
  assert.match(content, /Scan your visitor QR code/);
  assert.match(content, /Choose an activity to get started\./);
  assert.match(content, /Couldn(?:'|\\u2019|&#39;)t save, Retry/);
  assert.match(content, /This screen is being migrated in the next stage/);
  assert.ok(!content.includes('q-straight-talk-objective'), 'private seed content must not be bundled');
});