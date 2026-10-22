// Phase 9b: the decided fixes from the independent review, the parts that are plain rules or source guards. Run: node --test scripts/test-review-9b.js
// (The counting and storage parts are held by test-admin-today.js, test-participant-storage.js, test-admin-content.js, test-oracle.js and
// test-seeds.js; the browser side is in scripts/migration-tests. Nothing here ran on a real tenant or a real iPad.)

import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { UNREADABLE_FIX, namesByVisit, unreadableNotice } from '../migration/src/lib/results/unreadable.js';
import { REMOVE_VISIT_CONFIRM, REMOVE_VISIT_REFUSED, canRemoveVisit } from '../migration/src/lib/admin/admin-results.js';
import { visitGoneNotice } from '../migration/src/lib/participant/visit-notice.js';
import { isRetiredLogo, withoutRetiredLogo } from '../migration/src/lib/brand/retired-logos.js';
import { SAMPLE_NOTICE, SAMPLE_ORIGINS, SAMPLE_REPORT_LINE, confirmedLine, confirmedTheme, isSampleClient, needsConfirmation, sampleState } from '../migration/src/lib/admin/sample-notice.js';
import { buildClientTheme, resolveClientTheme, reviseClientTheme } from '../migration/src/lib/brand/client-theme.js';
import { changesForSave, draftFromClient } from '../migration/src/lib/brand/brand-studio.js';
import { evaluateReadiness } from '../migration/src/lib/admin/admin-today.js';
import { samplePack } from '../migration/src/lib/setup/sample-clients.js';
import { SAMPLE_PICTURES } from '../migration/src/lib/setup/sample-pictures.js';
import { NO_ANSWERS, buildLeaderReport, participantAnswersCsv } from '../migration/src/lib/exports/leader-report.js';
import { harbourRecords } from './leader-report-fixtures.js';
import { makeReport } from './leader-report-node.js';
import { inspectPdf, squash } from './pdf-inspect.js';
import { TITLE } from './sharepoint-fake.js';

const ROOT = new URL('../', import.meta.url);
const source = (file) => readFile(new URL(file, ROOT), 'utf8');

async function walk(dir) {
  const entries = await readdir(new URL(dir, ROOT), { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => (entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`])));
  return files.flat();
}

describe('SEC-1: the ?preview=<clientId> address does not carry the answer key (B)', () => {
  it('only the PIN-gated Content preview may ask for the right answers to be marked', async () => {
    const files = (await walk('migration/src')).filter((file) => /\.(svelte|ts|js)$/.test(file));
    const asking = [];
    for (const file of files) {
      const text = await source(file);
      // A caller that turns the key on: `showKey: true`, `showKey={true}`, or a bare `{showKey}` / `showKey` attribute given a value.
      if (/showKey\s*:\s*true|showKey=\{true\}|\bshowKey\b(?=\s*(?:\/?>|\s[a-z{]))/.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))) asking.push(file);
    }
    // Quiz.svelte only passes a value on; ActivityPreview.svelte is the one place that decides it.
    assert.deepEqual(asking.filter((file) => !/QuestionOptions\.svelte$|ActivityPager\.svelte$|Quiz\.svelte$/.test(file)), ['migration/src/admin/ActivityPreview.svelte']);
  });

  it('the route and its pager default to no marks, and the route never passes the key', async () => {
    const [route, pager, options, quiz] = await Promise.all([
      source('migration/src/routes/PreviewRoot.svelte'), source('migration/src/pager/ActivityPager.svelte'),
      source('migration/src/pager/QuestionOptions.svelte'), source('migration/src/routes/Quiz.svelte'),
    ]);
    assert.doesNotMatch(route, /showKey/);
    assert.match(route, /<ActivityPager sectionId=\{screen\} preview \/>/);
    assert.match(pager, /showKey = false/);
    assert.match(options, /showKey = false/);
    assert.match(options, /showKey && question\.options\.find/);
    assert.match(quiz, /showKey = false/);
  });

  it("Brand Studio's device preview draws the neutral sample questions, never the client's own", async () => {
    const stage = await source('migration/src/admin/BrandPreviewStage.svelte');
    assert.match(stage, /SAMPLE_ACTIVITY/);
    assert.match(stage, /<ActivityPager sectionId="sample" demo=/);
    assert.doesNotMatch(stage, /<ActivityPager[^>]*\bpreview\b/);
    assert.doesNotMatch(stage, /getSectionContent|listClientSections/);
  });
});

describe('DI-6: answers that could not be read are said so, in the same words, on every screen and in the report (C)', () => {
  it('the notice names who, says they are not counted, and what to do', () => {
    assert.equal(unreadableNotice([]), '');
    assert.equal(unreadableNotice(null), '');
    assert.equal(UNREADABLE_FIX, `Correct or delete the damaged item in the ${TITLE.responses} list, then reload.`);
    assert.equal(
      unreadableNotice([{ id: 'v-1', reason: 'its saved answers are not a list' }], new Map([['v-1', 'Asha Rao']])),
      `1 participant's answers could not be read and are not counted: Asha Rao. Correct or delete the damaged item in the ${TITLE.responses} list, then reload.`,
    );
    // A visit with no name is shown by its visit id; several are listed, in the order given.
    assert.equal(
      unreadableNotice([{ id: 'v-1', reason: 'x' }, { id: 'v-2', reason: 'x' }, { id: 'v-3', reason: 'x' }], new Map([['v-1', 'Asha Rao']])),
      `3 participants' answers could not be read and are not counted: Asha Rao, v-2, v-3. Correct or delete the damaged item in the ${TITLE.responses} list, then reload.`,
    );
  });

  it('a long list is cut after eight names, with how many more', () => {
    const many = Array.from({ length: 12 }, (_unused, index) => ({ id: `v-${index + 1}`, reason: 'x' }));
    const notice = unreadableNotice(many);
    assert.match(notice, /^12 participants' answers could not be read and are not counted: v-1, v-2, v-3, v-4, v-5, v-6, v-7, v-8 and 4 more\./);
    assert.ok(!notice.includes('v-9'));
  });

  it('names come from the rows a screen already has', () => {
    assert.deepEqual([...namesByVisit([{ track: { id: 't-1' }, name: 'Asha' }, { key: 't-2', name: 'Ben' }, { id: 't-3', name: '' }])], [['t-1', 'Asha'], ['t-2', 'Ben']]);
  });

  /** Harbour with Søren's saved answers unreadable: his answers are not in what was read, and the item is named. */
  function damagedHarbour() {
    const records = harbourRecords();
    records.answers = records.answers.filter((answer) => answer.clientTrackId !== 't-soren');
    records.unreadable = [{ id: 't-soren', reason: 'its saved answers are not valid JSON' }];
    return records;
  }
  const SOREN_NOTICE = `1 participant's answers could not be read and are not counted: Søren Kjær. Correct or delete the damaged item in the ${TITLE.responses} list, then reload.`;

  it('the report model carries it: who, the notice, a flag on that person, and nothing changes when nothing is damaged', () => {
    const report = buildLeaderReport(damagedHarbour(), { generatedAt: '2026-10-12T09:30:00.000Z', timeZone: 'UTC' });
    assert.deepEqual(report.unreadable.map((entry) => [entry.id, entry.name]), [['t-soren', 'Søren Kjær']]);
    assert.equal(report.meta.unreadableNotice, SOREN_NOTICE);
    assert.equal(report.participants.find((person) => person.key === 't-soren').unreadable, true);
    assert.equal(report.participants.filter((person) => person.unreadable).length, 1);
    assert.ok(report.notes.some((note) => note.includes('could not be read')), 'and the notes on the last page say it too');
    const clean = buildLeaderReport(harbourRecords(), { generatedAt: '2026-10-12T09:30:00.000Z', timeZone: 'UTC' });
    assert.deepEqual(clean.unreadable, []);
    assert.equal(clean.meta.unreadableNotice, '');
    assert.ok(!clean.participants.some((person) => person.unreadable));
    assert.ok(!clean.notes.some((note) => note.includes('could not be read')));
  });

  it('the CSV needs no extra row: it has the same rows as the report would without the notice', () => {
    const damaged = buildLeaderReport(damagedHarbour(), { generatedAt: '2026-10-12T09:30:00.000Z', timeZone: 'UTC' });
    const rowsOf = (report) => participantAnswersCsv(report).split('\r\n').filter(Boolean);
    const without = buildLeaderReport({ ...damagedHarbour(), unreadable: [] }, { generatedAt: '2026-10-12T09:30:00.000Z', timeZone: 'UTC' });
    assert.deepEqual(rowsOf(damaged), rowsOf(without));
    assert.ok(!participantAnswersCsv(damaged).includes('could not be read'));
  });

  it('the PDF says it on the cover, in bold, right under the line about whether the session had ended; the person\'s block says why it is empty', async () => {
    const made = await makeReport(damagedHarbour());
    const read = await inspectPdf(made.bytes);
    const cover = read.pages[0];
    assert.ok(squash(cover.text).includes(squash(SOREN_NOTICE)), 'page 1 has the whole sentence');
    const status = cover.items.find((item) => squash(item.text).startsWith(squash('This session had ended when')));
    const first = cover.items.find((item) => squash(item.text).startsWith(squash("1 participant's answers")));
    assert.ok(status && first, 'both lines are on the cover');
    assert.ok(first.y > status.y && first.y - status.y < 9, `it follows the status line (${status.y.toFixed(1)} then ${first.y.toFixed(1)} mm)`);
    assert.deepEqual(cover.items.filter((item) => item.y > status.y + 0.01 && item.y < first.y - 0.01), [], 'nothing between them');
    assert.equal(first.font, 'OpenSans-Bold', 'bold');
    const everything = squash(read.pages.map((page) => page.text).join(''));
    assert.ok(everything.includes(squash('Saved answers could not be read, so none are counted here.')), 'the person\'s block');
    // Søren's block does not say that nothing was recorded (that would be untrue); Łukasz-style people with really none still do.
    const noneRecorded = read.pages.flatMap((page) => page.items).filter((item) => item.text === `${NO_ANSWERS}.`).length;
    const clean = await inspectPdf((await makeReport(harbourRecords())).bytes);
    const cleanNone = clean.pages.flatMap((page) => page.items).filter((item) => item.text === `${NO_ANSWERS}.`).length;
    assert.equal(noneRecorded, cleanNone, 'Soren had answers in the clean report, so the count of "No answers recorded" is not larger because of the damage');
    // A clean report carries none of it.
    assert.ok(!squash(clean.pages.map((page) => page.text).join('')).includes(squash('could not be read')));
  });
});

describe('DI-9: a visit with no answers can be removed from Results, and a page that holds it is told what to do (D)', () => {
  it('asks first, in these words, and says the same when an answer arrived', () => {
    assert.equal(REMOVE_VISIT_CONFIRM, "Remove this visit? It has no answers. If it was made by a guest's code, that code stays used: issue a replacement code if the guest needs to start again.");
    assert.equal(REMOVE_VISIT_REFUSED, 'This visit now has answers, so it was not removed.');
  });

  it('only a visit with no answers (status "not started") gets Remove, and never on a session that has ended', () => {
    const live = { status: 'in-progress' };
    assert.equal(canRemoveVisit({ status: 'not-started' }, live), true);
    assert.equal(canRemoveVisit({ status: 'not-started' }, { status: 'not-started' }), true);
    assert.equal(canRemoveVisit({ status: 'not-started' }, undefined), true);
    for (const status of ['in-progress', 'completed', 'unreadable']) assert.equal(canRemoveVisit({ status }, live), false, status);
    assert.equal(canRemoveVisit({ status: 'not-started' }, { status: 'completed' }), false, 'a past report must not change silently');
  });

  it('a page that holds a removed visit says what to do next: a member of staff starts again, a guest asks the facilitator', () => {
    assert.equal(visitGoneNotice(false), 'This visit is no longer on record. Press the button below to start again.');
    assert.equal(visitGoneNotice(true), 'This visit is no longer on record. Ask your facilitator for a new code.');
    for (const guest of [true, false]) assert.doesNotMatch(visitGoneNotice(guest), /undefined|null|Error|select your client/i);
  });

  it('the page uses those words where a visit is gone: a page that was open, and a link opened afresh', async () => {
    const [app, boot] = await Promise.all([source('migration/src/App.svelte'), source('migration/src/lib/participant/boot.js')]);
    assert.match(app, /participant\.notice = visitGoneNotice\(guest\)/);
    assert.match(boot, /result\.notice = visitGoneNotice\(/);
    for (const text of [app, boot]) assert.doesNotMatch(text, /select your client (below )?to start again|Select your client to start again/i, 'the old words pointed at a client list that is not on Welcome any more');
  });

  it('Results offers it only through canRemoveVisit, and removes through removeEmptyVisit alone (never deleteClientTrack, which also unlinks the QR code)', async () => {
    const [results, data] = await Promise.all([source('migration/src/admin/AdminResults.svelte'), source('migration/src/lib/admin/adminData.ts')]);
    assert.match(results, /\{#if canRemoveVisit\(row, session\)\}/);
    assert.match(results, /removeEmptyVisit\(row\.track\.id\)/);
    assert.doesNotMatch(results, /deleteClientTrack/);
    assert.match(data, /dataService\.removeEmptyVisit/);
  });
});

describe('SAM-1: Kroger has no logo until a real one is uploaded, on a fresh site and on one seeded before (E)', () => {
  const OLD = '/assets/images/clients/kroger-logo.svg';
  const krogerPack = () => samplePack().clients.find((client) => client.id === 'c-kroger');

  it('the pack draws no logo for Kroger, like Domino\'s; since Phase 10f the seeds bring VJR\'s real logo FILE; and the stand-in is in no Svelte page', async () => {
    assert.equal(krogerPack().logoUrl, null, 'the pack itself has no picture');
    assert.equal(samplePack().clients.find((client) => client.id === 'c-dominos').logoUrl, null);
    // Phase 10f (VJR's decision): the sample clients are seeded with their real logos, supplied by VJR as files (lib/setup/sample-pictures.js). A file,
    // never a drawing: the local server's data points at it, and it is not the retired stand-in.
    const stored = JSON.parse(await source('server/data/clients.json')).find((client) => client.id === 'c-kroger');
    assert.equal(stored.logoUrl, `/assets/images/clients/${SAMPLE_PICTURES['c-kroger'].logo.name}`);
    assert.equal(isRetiredLogo(stored.logoUrl), false);
    // Until Phase 10c-1 the pages embedded every picture under public/assets/images with a glob, and this file was taken out of it. The
    // file left the branch with the legacy app, and so did the three modules that did the embedding: no page takes a picture from the
    // repository any more (scripts/test-bundle-budget.js still fails if the stand-in is in a built page).
    await assert.rejects(stat(new URL('public/assets/images/clients/kroger-logo.svg', ROOT)), { code: 'ENOENT' });
    const sources = (await readdir(new URL('migration/src/', ROOT), { recursive: true })).filter((name) => /\.(ts|js|svelte)$/.test(name));
    assert.ok(sources.length > 100);
    for (const file of sources) assert.doesNotMatch(await source(`migration/src/${file.split(path.sep).join('/')}`), /import\.meta\.glob\([^)]*public\/assets/, `${file} embeds files from public/assets`);
  });

  it('the old address counts as no logo, wherever it is written, and nothing else does', () => {
    for (const url of [OLD, ` ${OLD} `, `https://tenant.example/sites/x/Shared%20Documents/p_cec_01${OLD}`, `${OLD}?v=2`, '/Assets/Images/Clients/Kroger-Logo.svg']) assert.equal(isRetiredLogo(url), true, url);
    for (const url of ['/assets/images/clients/acme-logo.svg', 'https://x/kroger-logo-0123456789.png', '/assets/images/clients/kroger-logo.png', '', null, undefined, 7]) assert.equal(isRetiredLogo(url), false, String(url));
    assert.equal(withoutRetiredLogo(OLD), null);
    assert.equal(withoutRetiredLogo('/a.png'), '/a.png');
    assert.equal(withoutRetiredLogo(null), null);
  });

  it('a seeded site\'s Kroger shows no logo: not on Welcome, not in the draft Brand Studio opens, and readiness warns', () => {
    const seeded = { ...krogerPack(), logoUrl: OLD }; // what Setup wrote on a site seeded earlier
    assert.equal(resolveClientTheme(seeded).assets.logo, null);
    assert.equal(resolveClientTheme({ ...seeded, theme: { ...seeded.theme, assets: { ...seeded.theme.assets, logo: OLD } } }).assets.logo, null, 'a theme that stored it is the same');
    assert.equal(draftFromClient(seeded).assets.logo, null);
    const rows = evaluateReadiness({
      client: seeded, date: '2026-10-11', today: '2026-10-11', sections: [{ id: 's', title: 'A', clientId: 'c-kroger', enabled: true, questionIds: ['q'] }], questions: [{ id: 'q', type: 'single-select', prompt: 'P' }],
      options: [{ id: 'o', questionId: 'q', label: 'x', correct: true }, { id: 'o2', questionId: 'q', label: 'y', correct: false }], sessions: [], clients: [seeded], target: null, roster: null, schema: null,
    });
    assert.equal(rows.find((row) => row.id === 'logo')?.level, 'warning');
    // A real logo, in the older field or in the theme, is a logo.
    for (const real of [{ ...seeded, logoUrl: '/assets/images/clients/acme-logo.png' }, { ...seeded, theme: { ...seeded.theme, assets: { ...seeded.theme.assets, logo: 'https://x/kroger-logo-0123456789.png' } } }]) {
      assert.equal(evaluateReadiness({ client: real, date: '2026-10-11', today: '2026-10-11', sections: [], questions: [], options: [], sessions: [], clients: [real], target: null, roster: null, schema: null }).some((row) => row.id === 'logo'), false);
    }
  });

  it('uploading a real logo replaces it as normal: the theme holds the new picture and the older field is rewritten', () => {
    const seeded = { ...krogerPack(), logoUrl: OLD };
    const saved = draftFromClient(seeded);
    const chosen = { ...saved, assets: { ...saved.assets, logo: 'https://x/kroger-logo-0123456789.png' } };
    const changes = changesForSave(seeded, chosen, saved);
    assert.equal(changes.theme.assets.logo, 'https://x/kroger-logo-0123456789.png');
    assert.equal(changes.logoUrl, 'https://x/kroger-logo-0123456789.png', 'so the old address is gone from LogoUrl too');
    assert.equal(resolveClientTheme({ ...seeded, ...changes }).assets.logo, 'https://x/kroger-logo-0123456789.png');
    // Saving something else (a colour) while there is no logo leaves LogoUrl alone, and the screen still shows none.
    const recoloured = changesForSave(seeded, { ...saved, primary: '#123456' }, saved);
    assert.equal(recoloured.theme.assets.logo, null);
    assert.equal(Object.hasOwn(recoloured, 'logoUrl'), false);
    assert.equal(resolveClientTheme({ ...seeded, ...recoloured }).assets.logo, null);
  });

  it('the Live display and the Clients list read a client\'s logo through the same rule', async () => {
    for (const file of ['migration/src/lib/admin/live-view.js', 'migration/src/admin/AdminClients.svelte', 'migration/src/lib/admin/master-brand.ts', 'migration/src/lib/admin/admin-today.js', 'migration/src/lib/brand/client-theme.js', 'migration/src/lib/brand/brand-studio.js']) {
      assert.match(await source(file), /withoutRetiredLogo|isRetiredLogo/, file);
    }
  });
});

describe('SAM-2: sample clients say so until somebody confirms them (E)', () => {
  const krogerPack = () => samplePack().clients.find((client) => client.id === 'c-kroger');

  it('both sample clients carry the marker, and the seeds\' id and creation date are what older sites are recognised by', () => {
    for (const client of samplePack().clients) {
      assert.ok(client.theme.sample, `${client.id} carries the marker`);
      assert.equal(client.theme.sample.source, 'Seed sample clients');
      assert.equal(client.theme.sample.confirmedAt, undefined, 'and is not confirmed');
      assert.equal(client.createdAt, SAMPLE_ORIGINS[client.id], `${client.id}: SAMPLE_ORIGINS is what the seeds write`);
      assert.deepEqual(sampleState(client), { confirmed: false });
      assert.equal(needsConfirmation(client), true);
    }
    assert.deepEqual(Object.keys(SAMPLE_ORIGINS).sort(), samplePack().clients.map((client) => client.id).sort());
  });

  it('a site seeded before the marker existed is recognised by those two facts, and a client made by hand is not, whatever it is called', () => {
    const before = krogerPack();
    delete before.theme.sample;
    assert.equal(isSampleClient(before), true);
    assert.deepEqual(sampleState(before), { confirmed: false });
    // (What the Clients screen writes for a new client: its own id from the slug, and the moment it was made.)
    const byHand = { id: 'c-kroger', name: 'Kroger', slug: 'kroger', status: 'active', createdAt: '2026-10-13T09:00:00.000Z', themeVersion: 1, theme: buildClientTheme({ primary: '#045BCC' }) };
    assert.equal(isSampleClient(byHand), false, 'same id, but it was made on another day');
    assert.equal(sampleState(byHand), null);
    assert.equal(needsConfirmation(byHand), false);
    assert.equal(isSampleClient(null), false);
    // SharePoint hands a DateTime back without the milliseconds: the same instant is the same creation date.
    assert.equal(isSampleClient({ ...before, createdAt: '2026-09-18T00:00:00Z' }), true);
    assert.equal(isSampleClient({ ...before, createdAt: '2026-09-18T00:00:01Z' }), false);
    assert.equal(isSampleClient({ ...before, createdAt: null }), false);
    assert.equal(isSampleClient({ ...before, createdAt: 'not a date' }), false);
    assert.equal(isSampleClient({ id: 'c-acme', createdAt: '2026-09-18T00:00:00.000Z' }), false);
  });

  it('confirming records who and when, keeps everything else in the theme, and the notice goes', () => {
    const client = krogerPack();
    const theme = confirmedTheme(client.theme, { by: 'Casey Example', at: '2026-10-13T09:30:00.000Z' });
    assert.deepEqual(theme.sample, { source: 'Seed sample clients', confirmedBy: 'Casey Example', confirmedAt: '2026-10-13T09:30:00.000Z' });
    assert.deepEqual({ ...theme, sample: undefined }, { ...client.theme, sample: undefined }, 'nothing else changed');
    const confirmed = { ...client, theme };
    assert.deepEqual(sampleState(confirmed), { confirmed: true, by: 'Casey Example', at: '2026-10-13T09:30:00.000Z' });
    assert.equal(needsConfirmation(confirmed), false);
    assert.equal(confirmedLine({ by: 'Casey Example', at: '2026-10-13T09:30:00.000Z' }), 'Confirmed by Casey Example on October 13, 2026.');
    assert.equal(SAMPLE_NOTICE, 'Sample content: confirm with the client team before real use');
  });

  it('an edit never wipes the marker: Brand Studio\'s save and the Clients edit carry it over, and the look does not read it', () => {
    const client = krogerPack();
    const confirmed = { ...client, theme: confirmedTheme(client.theme, { by: 'Casey', at: '2026-10-13T09:30:00.000Z' }) };
    const saved = draftFromClient(confirmed);
    const brand = changesForSave(confirmed, { ...saved, primary: '#123456' }, saved);
    assert.deepEqual(brand.theme.sample, confirmed.theme.sample, 'Brand Studio');
    const words = reviseClientTheme(confirmed.theme, { version: 2, copy: { eventTitle: 'New title' } });
    assert.deepEqual(words.sample, confirmed.theme.sample, 'the Clients edit');
    assert.equal(Object.hasOwn(buildClientTheme({ primary: '#045BCC' }), 'sample'), false, 'a theme with no marker gets none');
    assert.equal(Object.hasOwn(reviseClientTheme({ primary: '#045BCC' }, { version: 2, copy: {} }), 'sample'), false);
    // The colours and words the page uses are the same with or without it.
    const plain = { ...confirmed, theme: { ...confirmed.theme, sample: undefined } };
    assert.deepEqual(resolveClientTheme(confirmed), resolveClientTheme(plain));
  });

  it('the report\'s cover carries one line until the client is confirmed, and only for a sample client', () => {
    const base = harbourRecords();
    const at = { generatedAt: '2026-10-12T09:30:00.000Z', timeZone: 'UTC' };
    assert.equal(buildLeaderReport(base, at).meta.sampleNotice, '', 'a client that is not a sample: nothing');
    const sample = { ...base, client: { ...base.client, id: 'c-kroger', createdAt: SAMPLE_ORIGINS['c-kroger'], theme: { ...base.client.theme, sample: { source: 'Seed sample clients' } } } };
    assert.equal(buildLeaderReport(sample, at).meta.sampleNotice, SAMPLE_REPORT_LINE);
    assert.equal(SAMPLE_REPORT_LINE, 'Sample content, not yet confirmed with the client.');
    const confirmed = { ...sample, client: { ...sample.client, theme: confirmedTheme(sample.client.theme, { by: 'Casey', at: '2026-10-13T09:30:00.000Z' }) } };
    assert.equal(buildLeaderReport(confirmed, at).meta.sampleNotice, '', 'confirmed: nothing');
  });

  it('the report\'s cover prints it, in bold, under the session status; a confirmed or ordinary client\'s cover does not', async () => {
    const base = harbourRecords();
    const sample = { ...base, client: { ...base.client, id: 'c-kroger', createdAt: SAMPLE_ORIGINS['c-kroger'], theme: { ...base.client.theme, sample: { source: 'Seed sample clients' } } } };
    const read = await inspectPdf((await makeReport(sample)).bytes);
    const cover = read.pages[0];
    assert.ok(squash(cover.text).includes(squash(SAMPLE_REPORT_LINE)));
    const line = cover.items.find((item) => squash(item.text).startsWith(squash('Sample content, not yet')));
    assert.equal(line.font, 'OpenSans-Bold');
    const status = cover.items.find((item) => squash(item.text).startsWith(squash('This session had ended when')));
    assert.ok(line.y > status.y && line.y - status.y < 9, 'right under the status line');
    for (const records of [base, { ...sample, client: { ...sample.client, theme: confirmedTheme(sample.client.theme, { by: 'Casey', at: '2026-10-13T09:30:00.000Z' }) } }]) {
      const other = await inspectPdf((await makeReport(records)).bytes);
      assert.ok(!squash(other.pages.map((page) => page.text).join('')).includes(squash('Sample content')));
    }
  });
});
