// Prompt 38: the admin page's thin outline icons (migration/src/admin/icons.js, drawn by admin/Icon.svelte). One shared 24 grid, a 1.75 stroke in
// currentColor, round caps, no fill; each icon has one meaning and no two share a path; every name a screen asks for is in the table.
// Run: node --test scripts/test-admin-icons.js (also part of npm test)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN = path.join(ROOT, 'migration/src/admin');
const icons = async () => ({ ...(await import('../migration/src/admin/icons.js')), ...(await import('../migration/src/admin/icon-meanings.js')) });

/** The brief's meaning map: each word, the icon it is drawn with. */
const BRIEF = {
  Today: 'calendar-check', Clients: 'building', Content: 'layers', 'Guests and QR': 'qr', Results: 'bar-chart', People: 'users', identity: 'user',
  'Go live': 'broadcast', End: 'stop', Reopen: 'refresh', 'Participant link': 'link', Copy: 'copy', Open: 'external', Wall: 'screen',
  Confidence: 'gauge', 'Give access': 'key', 'Turn off': 'power', History: 'clock', Add: 'plus', Edit: 'pencil', Delete: 'trash', Hide: 'eye-off',
  Show: 'eye', Print: 'printer', Download: 'download', Upload: 'upload', 'Restart a guest': 'rotate-left', Filters: 'sliders', Brand: 'palette',
  Pictures: 'image', 'Single select': 'radio', 'Multi select': 'checks', 'True or false': 'toggle', 'Confidence question': 'slider', Ranked: 'podium',
  'Open text': 'message', 'Art of the Possible': 'matrix', 'Move up': 'arrow-up', 'Move down': 'arrow-down', Blocker: 'alert-octagon',
  Warning: 'alert-triangle', Ready: 'check-circle', Info: 'info', Setup: 'database', 'Sign in': 'lock',
  // Prompt 43: Session settings' chips.
  'Staff sign in': 'badge', Sequential: 'steps', 'Open flow': 'grid',
};

async function namesAsked() {
  const asked = new Set();
  const files = [...(await readdir(ADMIN)).map((file) => path.join(ADMIN, file)), path.join(ROOT, 'migration/src/AdminApp.svelte')];
  for (const file of files.filter((file) => file.endsWith('.svelte'))) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/<Icon\s+name="([a-z-]+)"/g)) asked.add(match[1]);
    for (const match of source.matchAll(/\bicon=["']([a-z-]+)["']/g)) asked.add(match[1]);
    for (const match of source.matchAll(/\bicon: '([a-z-]+)'/g)) asked.add(match[1]);
  }
  // (The lists of views and of tabs name their icons: Prompt 44 moved the tabs' out of AdminApp.svelte into lib/admin/tabs.js.)
  for (const list of ['migration/src/lib/admin/admin-content-views.js', 'migration/src/lib/admin/tabs.js']) {
    for (const match of (await readFile(path.join(ROOT, list), 'utf8')).matchAll(/icon: '([a-z-]+)'/g)) asked.add(match[1]);
  }
  return asked;
}

describe('admin icons (Prompt 38)', () => {
  it('every word of the meaning map has its icon in the table', async () => {
    const { PATHS, MEANING } = await icons();
    for (const [word, name] of Object.entries(BRIEF)) {
      assert.ok(PATHS[name], `${word}: no "${name}" path`);
      assert.ok(MEANING[name], `${name} says what it means`);
    }
  });

  it('each icon has one meaning, no two meanings are the same and no two icons share a path', async () => {
    const { PATHS, MEANING } = await icons();
    assert.deepEqual(Object.keys(MEANING).sort(), Object.keys(PATHS).sort(), 'every icon has a meaning, every meaning an icon');
    const meanings = Object.values(MEANING);
    assert.equal(new Set(meanings).size, meanings.length, 'a meaning written twice');
    const paths = Object.values(PATHS);
    assert.equal(new Set(paths).size, paths.length, 'two icons with the same path');
    for (const [name, d] of Object.entries(PATHS)) assert.match(d, /^M[\d.\s,MmLlHhVvCcSsQqTtAaZz-]+$/, `${name}: a path only`);
  });

  it('every icon a screen asks for is in the table', async () => {
    const { PATHS } = await icons();
    for (const name of await namesAsked()) assert.ok(PATHS[name], `a screen asks for "${name}"`);
  });

  it('Icon.svelte draws them with a 1.75 stroke in currentColor, round caps and joins, no fill, and keeps its API', async () => {
    const source = await readFile(path.join(ADMIN, 'Icon.svelte'), 'utf8');
    assert.match(source, /from '\.\/icons\.js'/);
    assert.match(source, /stroke-width="1\.75"/);
    assert.match(source, /stroke="currentColor"/);
    assert.match(source, /stroke-linecap="round"/);
    assert.match(source, /stroke-linejoin="round"/);
    assert.match(source, /fill="none"/);
    assert.match(source, /export type IconName/);
    assert.match(source, /\{ name, size = 20 \}/);
  });

  it('the status icons differ by shape: blocker, warning, ready and info share no path', async () => {
    const { PATHS } = await icons();
    const shapes = ['alert-octagon', 'alert-triangle', 'check-circle', 'info'].map((name) => PATHS[name]);
    assert.equal(new Set(shapes).size, 4);
  });
});
