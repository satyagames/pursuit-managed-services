import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { before, test } from 'node:test';
import { promisify } from 'node:util';
import { load } from 'cheerio';

const root = path.join(import.meta.dirname, '..');
const release = path.join(root, 'build-svelte', 'release');
const expected = ['admin.html', 'index.html', 'setup.html'];
const run = promisify(execFile);

// The release candidate is built with NO PMS_ value, whatever the environment of the person running this holds: these are the pages
// that go anywhere, and that find their site and their lists where they are opened (Phase 10b).
const { PMS_SITE_URL: _site, PMS_LIST_PREFIX: _prefix, PMS_LOGO_LIBRARY: _library, PMS_BATCH: _batch, PMS_SUPPORT_NAME: _name, PMS_SUPPORT_CONTACT: _contact, PMS_LABEL: _label, ...env } = process.env;

before(async () => {
  await run(process.execPath, [path.join(root, 'scripts/build-svelte-release.js')], { cwd: root, env });
});

test('Svelte release candidate contains three standalone pages and no folders', async () => {
  const files = await readdir(release, { withFileTypes: true });
  assert.deepEqual(files.map((file) => file.name).sort(), expected);
  assert.ok(files.every((file) => file.isFile()));

  for (const entry of expected) {
    const content = await readFile(path.join(release, entry), 'utf8');
    const html = load(content);
    const externalAssets = html('script[src], link[rel="stylesheet"], script[type="importmap"]');
    const moduleScripts = html('script[type="module"]');
    assert.equal(externalAssets.length, 0, `${entry} must be self-contained`);
    assert.equal(moduleScripts.length, 1, `${entry} must have one inlined module entry`);
    assert.ok(!content.includes('q-straight-talk-objective'), `${entry} must not embed private seed data`);
    // Until Phase 10b this line required the production host to be inside every page, so a page built for any other site failed it.
    // What matters now is the opposite: a release page names no site and no list prefix. It finds its site from its own address and its
    // lists from pms-config.txt beside it, and stops when nothing names them.
    assert.ok(!/deloitteonline\.com|sites\/CreativeExpCOE|tenant\.example/.test(content), `${entry} must not have a site built in`);
    assert.ok(!content.includes('__PMS_BUILT__'), `${entry}: the build's constant is written in, not left as a name`);
    assert.ok(!/listPrefix:[`"']PMS/.test(content), `${entry} must not have a list prefix built in`);
    assert.ok(content.includes('pms-config.txt'), `${entry} looks for its settings file`);
    assert.ok(content.includes('PMS-CFG-00'), `${entry} can say that it has not been set up`);
    assert.ok(content.includes('getbytitle('), `${entry} carries the SharePoint adapter`);
  }

  // The participant and admin pages stop with the short screen; Setup has the words in full.
  for (const entry of ['index.html', 'admin.html']) {
    const content = await readFile(path.join(release, entry), 'utf8');
    assert.ok(content.includes('This page cannot start'), `${entry}: the stop screen`);
    assert.ok(!content.includes('This copy of the app has not been set up yet'), `${entry} does not carry Setup's wording`);
  }

  const setupContent = await readFile(path.join(release, 'setup.html'), 'utf8');
  assert.ok(setupContent.includes('This copy of the app has not been set up yet'));
  assert.ok(setupContent.includes('<a href="admin.html">Admin</a>'));
  assert.ok(setupContent.includes('<a href="index.html">Participant</a>'));
});