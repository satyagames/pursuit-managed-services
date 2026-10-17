// Phase 10c-3, part F: text that SharePoint would refuse (the 10c-2b report, item 2). Run: node --test scripts/test-text-limits.js (part of `npm test`).
//
// A single line of text on SharePoint holds 255 characters. Two admin inputs had no limit: an answer's text (PMSAnswerOptions.Label, and OptionValue,
// which Content makes from it) and a client's name (PMSClients.Name, copied into Title). Over 255 SharePoint refused the save in its own words. Now each
// input takes the limit of pms-schema-meta.js (the admin page cannot carry that file, so its constants are held equal to it here), with a plain message
// at the limit; and the data layer refuses a longer single line before anything is sent, in both adapters, for every list. Every other single-line
// text a person types is checked against META's maximum below.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { LISTS } from '../migration/src/lib/schema/pms-schema.js';
import { META, columnsOf } from '../migration/src/lib/schema/pms-schema-meta.js';
import { MAX_ACTIVITY_TITLE, MAX_GUEST_NAME, MAX_IMAGE_URL, MAX_OPTION_TEXT, optionTextProblem, optionValueFrom } from '../migration/src/lib/admin/admin-content.js';
import { MAX_CLIENT_NAME, SLUG_MAX, clientProblems } from '../migration/src/lib/admin/admin-clients.js';
import { ADMIN_PIN } from '../migration/src/lib/setup/setup-admins.js';
import { freePort } from './free-port.js';
import { STRAYS, UNINDEXED, createSharePointFake } from './sharepoint-fake.js';

const ROOT = path.join(import.meta.dirname, '..');
const realFetch = globalThis.fetch;
let pages = 0;
const freshPage = async (settings) => {
  const ds = await import(`../migration/src/lib/data/dataService.js?text-limits=${pages += 1}`);
  ds.configure(settings);
  return ds;
};
const long = (length) => 'x'.repeat(length);

describe('the limits the admin\'s inputs take are the lists\' own (pms-schema-meta.js)', () => {
  it('an answer\'s text and a client\'s name: 255, as PMSAnswerOptions.Label and OptionValue and PMSClients.Name hold', () => {
    assert.equal(MAX_OPTION_TEXT, META.options.columns.Label.max);
    assert.equal(MAX_OPTION_TEXT, META.options.columns.OptionValue.max);
    assert.equal(MAX_CLIENT_NAME, META.clients.columns.Name.max);
    assert.equal(MAX_OPTION_TEXT, 255);
    assert.equal(MAX_CLIENT_NAME, 255);
  });

  it('every other single-line text a person types already had its limit, and it is META\'s', () => {
    assert.equal(MAX_ACTIVITY_TITLE, META.sections.columns.Title.max, 'an activity\'s title (PMSActivities.Title)');
    assert.equal(MAX_GUEST_NAME, META.visitorroster.columns.GuestName.max, 'a guest\'s name (PMSGuestList.GuestName)');
    assert.equal(MAX_IMAGE_URL, META.options.columns.ImageUrl.max, 'an answer\'s picture address (PMSAnswerOptions.ImageUrl)');
    assert.equal(SLUG_MAX, META.clients.columns.Slug.max, 'a client\'s short name (PMSClients.Slug)');
    assert.equal(META.adminusers.columns.Name.max, 255, 'an admin\'s name (PMSAdminUsers.Name), which Add an admin holds to it');
    assert.ok(ADMIN_PIN.max <= 12, 'a PIN is never stored, only its hash (64)');
  });

  it('an answer\'s text: refused over the limit in words; its value is made to fit, even with a number after it', () => {
    assert.equal(optionTextProblem(long(255)), '');
    assert.equal(optionTextProblem(long(256)), 'The text is 256 characters; an answer can hold 255.');
    assert.equal(optionValueFrom(long(255), new Set()).length <= 255, true);
    const taken = new Set([optionValueFrom(long(255), new Set())]);
    const second = optionValueFrom(long(255), taken);
    assert.ok(second.length <= 255 && second !== [...taken][0], second.slice(-6));
    assert.equal(optionValueFrom('Great Western Tea co.', new Set()), 'great-western-tea-co', 'a short one is what it always was');
    assert.equal(optionValueFrom('Great Western Tea co.', new Set(['great-western-tea-co'])), 'great-western-tea-co-2');
  });

  it('a client\'s name: refused over the limit in words', () => {
    const api = { slugify: (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') };
    assert.deepEqual(clientProblems({ name: long(255), slug: 'abc' }, { api, clients: [] }), {});
    assert.deepEqual(clientProblems({ name: long(256), slug: 'abc' }, { api, clients: [] }), { name: 'The name is 256 characters; a client\'s name can hold 255.' });
  });
});

describe('the data layer refuses a single line SharePoint would refuse, before anything is sent', () => {
  it('on SharePoint (mocked): an answer\'s text, its value and a client\'s name over 255 are refused with words, and nothing is sent', async () => {
    const fake = createSharePointFake();
    globalThis.fetch = fake.fetch;
    const ds = await freshPage({ sharePoint: fake.settings });
    fake.reset();
    for (const [what, call] of [
      ['Label', () => ds.createOption({ id: 'o-long', questionId: 'q', label: long(256), value: 'v' })],
      ['OptionValue', () => ds.createOption({ id: 'o-long', questionId: 'q', label: 'Fine', value: long(256) })],
      ['Name', () => ds.createClient({ id: 'c-long', name: long(256), slug: 'long' })],
      ['Name', () => ds.updateClient('c-long', { name: long(300) })],
      ['Label', () => ds.updateOption('o-long', { label: long(256) })],
    ]) {
      await assert.rejects(call(), (error) => error.status === 400 && error.code === 'too-long' && error.message.startsWith(`${what} can hold 255 characters at most`), what);
    }
    assert.equal(fake.count(), 0, 'nothing was sent');
    await ds.createOption({ id: 'o-fits', questionId: 'q', label: long(255), value: long(255) });
    assert.equal(fake.item('options', 'o-fits').Label.length, 255, '255 is kept');
  });

  it('several lines are several lines: a question\'s words and an activity\'s description may be longer', async () => {
    const fake = createSharePointFake();
    globalThis.fetch = fake.fetch;
    const ds = await freshPage({ sharePoint: fake.settings });
    await ds.createQuestion({ id: 'q-long', type: 'open-text-feedback', prompt: long(600), optionIds: [] });
    await ds.createSection({ id: 's-long', title: 'Long', clientId: 'c-x', description: long(400), questionIds: [] });
    assert.equal(fake.item('questions', 'q-long').Prompt.length, 600);
    assert.equal(fake.item('sections', 's-long').Description.length, 400);
    const several = Object.entries(LISTS).flatMap(([key, list]) => Object.values(list.fields).filter((field) => field.long).map((field) => `${key}.${field.column}`));
    assert.deepEqual(several, ['sections.Description', 'questions.Prompt'], 'the schema file marks them');
    for (const key of Object.keys(LISTS)) {
      for (const column of columnsOf(key)) {
        if (column.kind !== 'text') continue;
        const field = Object.values(LISTS[key].fields).find((each) => each.column === column.name);
        assert.equal(Boolean(field?.long), column.type === 'Note', `${key}.${column.name}: marked as several lines exactly when META keeps it as Note`);
      }
    }
  });

  describe('on the local server: the same refusals', () => {
    let server;
    let dataDir;
    after(async () => {
      server?.kill();
      globalThis.fetch = realFetch;
      if (dataDir) await rm(dataDir, { recursive: true, force: true });
    });
    it('refuses what SharePoint would refuse, and keeps 255', async () => {
      globalThis.fetch = realFetch;
      dataDir = await mkdtemp(path.join(os.tmpdir(), 'pms-limits-'));
      await cp(path.join(ROOT, 'server', 'data'), dataDir, { recursive: true });
      const port = await freePort();
      server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'inherit'] });
      await new Promise((resolve, reject) => {
        server.once('exit', (code) => reject(new Error(`server exited early (code ${code})`)));
        server.stdout.on('data', (chunk) => String(chunk).includes('running') && resolve());
      });
      const ds = await freshPage({ baseUrl: `http://localhost:${port}/api` });
      await assert.rejects(ds.createClient({ id: 'c-long', name: long(256), slug: 'long' }), (error) => error.code === 'too-long' && /^Name can hold 255 characters at most/.test(error.message));
      await assert.rejects(ds.createOption({ id: 'o-long', questionId: 'q', label: long(256), value: 'v' }), (error) => error.code === 'too-long');
      assert.equal(await ds.getClient('c-long'), null, 'nothing was written');
      const kept = await ds.createOption({ id: 'o-fits', questionId: 'q', label: long(255), value: 'v' });
      assert.equal(kept.label.length, 255);
    });
  });
});

describe('the suite', () => {
  it('no request of this suite reached a list that is not its own, and none filtered on a column the lists do not index', () => {
    assert.deepEqual(STRAYS, []);
    assert.deepEqual(UNINDEXED, []);
  });
});
