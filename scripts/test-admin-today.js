// Phase 5: the admin's Today and Clients screens, below the browser. The rules (readiness, what is
// live, the confirmation, slugs, the stored theme) are plain functions; the requests are counted
// against the mocked SharePoint REST (scripts/sharepoint-fake.js) and the real local server on a
// scratch copy of server/data. Run: npm run test:admin (also part of npm test).
//
// Like the storage suite this proves the adapter sends the requests it should, in the numbers it
// should. It is not the real tenant: whether SharePoint accepts a batch of 12 column reads is what
// the browser tests against the fake can only assume (QA-TESTING.md section 9).
import './fresh-page.js';
import assert from 'node:assert/strict';
import { freePort } from './free-port.js';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import * as ds from '../migration/src/lib/data/dataService.js';
import {
  STAFF_MODE_WARNING, blockedReason, evaluateReadiness, goLive, isCalendarDate, liveStatus, loadReadinessInputs, loadToday, localDate, makeSessionLive,
  needsSwitchConfirmation, notLiveText, pollToday, startingClientId, switchDialog,
} from '../migration/src/lib/admin/admin-today.js';
import {
  SLUG_PATTERN, clientProblems, clientRows, clientUsage, createClientRecord, defaultEventTitle, effectiveSlug, formOf, isClientLive, recentCodes,
  setClientStatus, slugProblem, themeForSave, updateClientRecord,
} from '../migration/src/lib/admin/admin-clients.js';
import { resolveClientTheme } from '../migration/src/lib/brand/client-theme.js';
import { schemaSpecs } from '../migration/src/lib/setup/setup-checks.js';
import { contrastRatio, deriveTheme } from '../migration/src/lib/brand/theme.js';
import { samplePack } from '../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../migration/src/lib/setup/seed.js';
import { STRAYS, TITLE, UNINDEXED, createSharePointFake, plainTitles } from './sharepoint-fake.js';

/** The check-by-eye lines with the suite's prefix taken off the titles: they name the list as the site has it (see plainTitles). */

const ROOT = path.join(import.meta.dirname, '..');
const realFetch = globalThis.fetch;
const DAY = '2026-10-11';
const measured = [];
const shape = (entry) => `${entry.method} ${entry.list ?? entry.path.split('/_api')[1]}${entry.parts ? ` [${entry.parts.map((part) => part.list ?? part.path.split('/_api')[1]).join(', ')}]` : ''}`;

/** A page of its own: the data service as a separate module, so no write token or list metadata is shared between "admins". */
let pages = 0;
async function freshPage(settings) {
  const page = await import(`../migration/src/lib/data/dataService.js?admin-page=${pages += 1}`);
  page.configure(settings);
  return page;
}

async function site(options = {}) {
  const fake = createSharePointFake(options);
  fake.install();
  ds.configure({ sharePoint: fake.settings });
  await seedPack(ds, samplePack());
  return fake;
}

// ---- Phase 10c-2a, F3: what uses a client, and a session's newest codes, are read by session and never as whole lists ----

const EARLIER = '2026-10-10';
const idsOf = (rows) => rows.map((row) => row.id).sort();
/** Kroger: an earlier day with a visit, then today with a visit and two codes. Domino's, live last: a visit and a code. Acme: no session. */
async function usageScene(page) {
  await page.activateClient('c-kroger', EARLIER);
  await page.beginVisit(crypto.randomUUID(), `kroger-${EARLIER}`, 'c-kroger');
  await page.activateClient('c-kroger', DAY);
  await page.beginVisit(crypto.randomUUID(), `kroger-${DAY}`, 'c-kroger');
  await page.provisionQrToken('c-kroger');
  await page.provisionQrToken('c-kroger');
  await page.activateClient('c-dominos', DAY);
  await page.beginVisit(crypto.randomUUID(), `dominos-${DAY}`, 'c-dominos');
  await page.provisionQrToken('c-dominos');
  if (!(await page.getClient('c-acme'))) await page.createClient({ id: 'c-acme', name: 'Acme', slug: 'acme', status: 'active', logoUrl: '', primaryColor: '#045bcc', secondaryColor: '#64748b', createdAt: '2026-10-11T00:00:00.000Z' });
}
/** The same answer worked out the way the screen used to: every session, visit and code there is, picked through here. */
async function usageFromWholeLists(page, clientId) {
  const [sessions, tracks, tokens, settings] = await Promise.all([page.listSessions(), page.listClientTracks(), page.listQrTokens(), page.getAppSettings()]);
  const own = (row) => row.clientId === clientId;
  return { live: settings?.activeClientId === clientId, sessions: idsOf(sessions.filter(own)), tracks: idsOf(tracks.filter(own)), tokens: idsOf(tokens.filter(own)) };
}
const usageIds = (usage) => ({ live: usage.live, sessions: idsOf(usage.sessions), tracks: idsOf(usage.tracks), tokens: idsOf(usage.tokens) });
/** Every address a stretch of the log asked for, a batch's parts included, as list title and query. */
const addressesOf = (entries) => entries.flatMap((entry) => [entry, ...(entry.parts ?? [])]).filter((entry) => !entry.path.endsWith('/$batch')).map((entry) => `${entry.method} ${entry.list}${entry.query}`);
const wholeListReads = (addresses) => addresses.filter((address) => /^GET (Tracks|QRTokens)\b/.test(address) && !/SessionId eq /.test(address));

const client = (extra = {}) => ({ id: 'c-a', name: 'Alpha', slug: 'alpha', status: 'active', logoUrl: '/logo.svg', ...extra });
const section = (extra = {}) => ({ id: 'sec-1', title: 'History', clientId: 'c-a', enabled: true, questionIds: ['q-1'], ...extra });
const question = (extra = {}) => ({ id: 'q-1', type: 'single-select', prompt: 'Which year?', ...extra });
const option = (id, extra = {}) => ({ id, questionId: 'q-1', label: id, correct: null, ...extra });
const goodInput = (extra = {}) => ({
  client: client(), date: DAY, today: DAY, sections: [section(), section({ id: 'sec-2', title: 'Brands', questionIds: [] })], questions: [question()],
  options: [option('o-1', { correct: true }), option('o-2', { correct: false })], sessions: [], clients: [client()], target: null, roster: null, schema: null, ...extra,
});
const byId = (rows) => Object.fromEntries(rows.map((row) => [row.id, row]));

// ---- The rules --------------------------------------------------------------------------------------

describe('dates', () => {
  it("today is the browser's local calendar day, not the UTC one", () => {
    // 02:00 UTC on the 12th is still the evening of the 11th in New York.
    const evening = { getTime: () => Date.parse('2026-10-12T02:00:00Z'), getTimezoneOffset: () => 240 };
    assert.equal(localDate(evening), '2026-10-11');
    const morning = { getTime: () => Date.parse('2026-10-11T22:00:00Z'), getTimezoneOffset: () => -120 };
    assert.equal(localDate(morning), '2026-10-12');
  });

  it('accepts a real calendar date and nothing else', () => {
    for (const good of ['2026-10-11', '2028-02-29']) assert.equal(isCalendarDate(good), true, good);
    for (const bad of ['', '2026-13-01', '2026-02-30', '11/10/2026', '2026-1-1', undefined]) assert.equal(isCalendarDate(bad), false, String(bad));
  });
});

describe('what is live', () => {
  const clients = [client(), client({ id: 'c-b', name: 'Beta', status: 'archived' })];
  const session = (extra = {}) => ({ id: 'alpha-2026-10-11', clientId: 'c-a', status: 'in-progress', ...extra });

  it('follows the same rules as the participant page', () => {
    const live = liveStatus({ settings: { activeSessionId: 'alpha-2026-10-11', activeClientId: 'c-a', activatedAt: '2026-10-11T09:00:00Z' }, session: session(), clients });
    assert.equal(live.live, true);
    assert.equal(live.client.name, 'Alpha');
    assert.equal(live.since, '2026-10-11T09:00:00Z');
    const reasons = (settings, found) => liveStatus({ settings, session: found, clients }).reason;
    assert.equal(reasons(null, null), 'no-session');
    assert.equal(reasons({ activeSessionId: 'x' }, null), 'session-missing');
    assert.equal(reasons({ activeSessionId: 'x', activeClientId: 'c-a' }, session({ status: 'completed' })), 'session-ended');
    assert.equal(reasons({ activeSessionId: 'x', activeClientId: 'c-nobody' }, session()), 'client-missing');
    assert.equal(reasons({ activeSessionId: 'x', activeClientId: 'c-a' }, session({ clientId: 'c-b' })), 'client-missing', 'a session of another client than the one named');
    assert.equal(reasons({ activeSessionId: 'x', activeClientId: 'c-b' }, session({ clientId: 'c-b' })), 'client-archived');
    // No ActiveClientId: nothing is live. (Only the legacy admin wrote a session without its client; Go live writes both, and the
    // participant page says the same: scripts/test-participant-storage.js.)
    assert.equal(reasons({ activeSessionId: 'x' }, session()), 'client-missing');
    assert.equal(liveStatus({ settings: { activeSessionId: 'x' }, session: session(), clients }).client, null);
  });

  it('says in words what participants see when nothing is live', () => {
    assert.match(notLiveText({ reason: 'no-session' }), /opens the page sees "Today's experience isn't live yet"/);
    assert.match(notLiveText({ reason: 'session-ended', client: { name: 'Alpha' } }), /The Alpha session has ended.*opens or reloads the page sees "This session has ended\.".*already open shows it within about 25 seconds/);
    assert.match(notLiveText({ reason: 'client-archived', client: { name: 'Beta' } }), /Beta is archived/);
  });

  it('starts the picker on the asked-for client, else the live one, else the first active one by name', () => {
    const all = [client({ id: 'c-z', name: 'Zed' }), client({ id: 'c-b', name: 'Beta', status: 'archived' }), client({ id: 'c-a', name: 'Alpha' })];
    assert.equal(startingClientId(all, 'c-z', null), 'c-z');
    assert.equal(startingClientId(all, 'c-b', 'c-z'), 'c-z', 'an archived client cannot be the starting point');
    assert.equal(startingClientId(all, null, null), 'c-a');
    assert.equal(startingClientId([], null, null), null);
  });
});

describe('readiness', () => {
  it('a complete client is ready, with every row passing', () => {
    // Phase 9b (DI-1): a session that does not exist yet will be made in staff mode, so the staff-mode reminder is here on purpose.
    const rows = evaluateReadiness(goodInput());
    assert.deepEqual(rows.filter((row) => row.level !== 'pass').map((row) => row.id), ['empty-activity', 'staff-signin'], 'only the empty second activity and the staff-mode reminder are mentioned');
    assert.equal(blockedReason(rows), null);
    assert.ok(rows.every((row) => row.title && row.detail), 'every row says what it found');
  });

  it('Phase 9b, DI-1: staff mode warns that each person needs their own sign-in; guest mode does not; it never blocks', () => {
    const sentence = "Staff mode: every person needs their own sign-in. iPads that share one sign-in must use Guests scan a personal QR, or two people's answers will be mixed.";
    assert.equal(STAFF_MODE_WARNING, sentence);
    // Staff mode set on the session, set by default (no value stored), and a session that does not exist yet (Go live makes it staff).
    for (const target of [{ id: 'x', clientId: 'c-a', participationMode: 'staff' }, { id: 'x', clientId: 'c-a' }, null]) {
      const rows = evaluateReadiness(goodInput({ target }));
      const row = byId(rows)['staff-signin'];
      assert.equal(row?.level, 'warning', JSON.stringify(target));
      assert.equal(row.detail, sentence);
      assert.equal(blockedReason(rows), null, 'a warning never blocks Go live');
    }
    // Guest mode: the sentence is not on the screen at all.
    const guest = evaluateReadiness(goodInput({ target: { id: 'x', clientId: 'c-a', participationMode: 'client-visit' }, roster: [{ id: 'v1', enabled: true }] }));
    assert.equal(byId(guest)['staff-signin'], undefined);
    assert.ok(!JSON.stringify(guest).includes('own sign-in'));
  });

  it('blocks: an archived client', () => {
    const rows = byId(evaluateReadiness(goodInput({ client: client({ status: 'archived' }) })));
    assert.equal(rows.client.level, 'blocker');
    assert.match(rows.client.fix, /Restore/);
  });

  it('blocks: no live activity, whether there are none or none are switched on', () => {
    assert.equal(byId(evaluateReadiness(goodInput({ sections: [] }))).activities.level, 'blocker');
    const off = byId(evaluateReadiness(goodInput({ sections: [section({ enabled: false })] })));
    assert.equal(off.activities.level, 'blocker');
    assert.match(off.activities.detail, /1 activity, none switched on/);
    assert.match(off.activities.fix, /Content/);
  });

  it('blocks: a question with no answer options, but not an open-text question, which has none by design', () => {
    const bare = byId(evaluateReadiness(goodInput({ options: [] })));
    assert.equal(bare['no-options'].level, 'blocker');
    assert.match(bare['no-options'].detail, /"Which year\?" \(History\) has no answer options/);
    const open = byId(evaluateReadiness(goodInput({ questions: [question({ type: 'open-text-feedback' })], options: [] })));
    assert.equal(open['no-options'], undefined);
  });

  it('a poll is never a blocker: a single choice or true-or-false with no answer marked right, whether stored as null (locally) or No (SharePoint) (Phase 12, F-01)', () => {
    // SharePoint keeps a Yes/No column as No when the app writes null (spEncode: value === true), so a poll Content saved with no answer
    // marked right reads back with every answer `correct: false`. Content allows that for both types ("Leave Correct off for a poll";
    // "Optionally mark the correct answer"), and the pager runs it as a poll (isGraded), so there is nothing to fix.
    for (const type of ['single-select', 'true-false']) {
      for (const flag of [null, false]) {
        const checks = byId(evaluateReadiness(goodInput({ questions: [question({ type })], options: [option('o-1', { correct: flag }), option('o-2', { correct: flag })] })));
        assert.equal(checks['no-correct'], undefined, `${type} with every answer ${flag}`);
        assert.equal(checks.questions.level, 'pass', `${type} with every answer ${flag}`);
      }
    }
    assert.equal(byId(evaluateReadiness(goodInput({ questions: [question({ type: 'multi-select' })], options: [option('o-1', { correct: false }), option('o-2', { correct: false })] })))['no-correct'], undefined);
  });

  it('blocks: the session for that date has ended, and offers to reopen it', () => {
    const rows = byId(evaluateReadiness(goodInput({ target: { id: 'alpha-2026-10-11', clientId: 'c-a', status: 'completed' } })));
    assert.equal(rows['session-ended'].level, 'blocker');
    assert.equal(rows['session-ended'].go.action, 'reopen');
  });

  it('blocks on a missing SharePoint list or column, and only warns on a missing index', () => {
    const report = [{ list: TITLE.clients, ready: false, problems: [{ column: 'Slug', type: 'Single line of text', problem: 'Missing.', added: true }] }, { list: TITLE.tracks, ready: true, problems: [] }];
    const missing = byId(evaluateReadiness(goodInput({ schema: { report } })));
    assert.equal(missing.lists.level, 'blocker');
    assert.match(missing.lists.detail, new RegExp(`${TITLE.clients}\\.Slug \\(Single line of text\\): Missing\\.`));
    const noList = byId(evaluateReadiness(goodInput({ schema: { report: [{ list: TITLE.tracks, ready: false, problems: [{ column: null, type: null, problem: `The list "${TITLE.tracks}" does not exist.`, added: false }] }] } })));
    assert.equal(noList.lists.level, 'blocker');
    const slow = byId(evaluateReadiness(goodInput({ schema: { report: [{ list: TITLE.sections, ready: false, problems: [{ column: 'ClientId', type: 'Single line of text, indexed', problem: 'Not indexed.', added: true }] }] } })));
    assert.equal(slow.lists.level, 'warning');
    assert.equal(byId(evaluateReadiness(goodInput({ schema: { report: [] } }))).lists.level, 'pass');
    assert.equal(byId(evaluateReadiness(goodInput({ schema: { error: 'SharePoint (403): denied' } }))).lists.level, 'warning', 'a check that could not run is not a reason to stop');
  });

  it('warns, and still allows: no logo, guests mode without guests, one activity, another client the same day, a date that is not today', () => {
    const rows = byId(evaluateReadiness(goodInput({
      client: client({ logoUrl: '' }),
      sections: [section()],
      target: { id: 'alpha-2026-10-12', clientId: 'c-a', status: 'not-started', participationMode: 'client-visit' },
      roster: [],
      date: '2026-10-12',
      sessions: [{ id: 'beta-2026-10-12', clientId: 'c-b', date: '2026-10-12', status: 'in-progress' }],
      clients: [client(), client({ id: 'c-b', name: 'Beta' })],
    })));
    for (const id of ['logo', 'guests', 'one-activity', 'same-date', 'date']) assert.equal(rows[id]?.level, 'warning', id);
    assert.match(rows['same-date'].detail, /Beta already has a session on 2026-10-12/);
    assert.match(rows.date.detail, /not today \(2026-10-11\)/);
    assert.equal(blockedReason(Object.values(rows)), null, 'warnings never block');
    // A guest who is added, or a hero image, takes the warning away.
    const fixed = byId(evaluateReadiness(goodInput({ client: client({ logoUrl: '', theme: { assets: { hero: '/hero.png' } } }), target: { id: 'x', participationMode: 'client-visit' }, roster: [{ id: 'v1', enabled: true }] })));
    assert.equal(fixed.logo, undefined);
    assert.equal(fixed.guests, undefined);
  });

  it('lists blockers first and says why Go live is disabled', () => {
    const rows = evaluateReadiness(goodInput({ client: client({ status: 'archived', logoUrl: '' }), sections: [], date: '2026-10-12' }));
    assert.deepEqual(rows.map((row) => row.level), [...rows.map((row) => row.level)].sort((a, b) => ['blocker', 'warning', 'pass'].indexOf(a) - ['blocker', 'warning', 'pass'].indexOf(b)));
    assert.match(blockedReason(rows), /^Fix these first: .*Client.*Live activities/);
    assert.match(blockedReason(rows.filter((row) => row.id === 'client')), /^Fix this first: Client\.$/);
  });
});

describe('switching away from a live client', () => {
  const alpha = client();
  const beta = client({ id: 'c-b', name: 'Beta' });
  const live = { live: true, session: { id: 'alpha-2026-10-11', date: '2026-10-11', clientId: 'c-a' }, client: alpha };

  it('asks only when a different session is live and people have joined it', () => {
    assert.equal(needsSwitchConfirmation({ status: live, participants: 3, targetSessionId: 'beta-2026-10-11' }), true);
    assert.equal(needsSwitchConfirmation({ status: live, participants: 0, targetSessionId: 'beta-2026-10-11' }), false);
    assert.equal(needsSwitchConfirmation({ status: live, participants: 3, targetSessionId: 'alpha-2026-10-11' }), false, 'the same session again');
    assert.equal(needsSwitchConfirmation({ status: { live: false, session: null }, participants: 3, targetSessionId: 'beta-2026-10-11' }), false);
  });

  it('names the client and the count, and says what an open participant page does, no more', () => {
    const dialog = switchDialog({ from: alpha, to: beta, participants: 12, fromSession: live.session, date: '2026-10-11' });
    assert.equal(dialog.title, 'Switch from Alpha to Beta?');
    assert.equal(dialog.lead, 'Alpha is live now with 12 participants.');
    const text = dialog.points.join(' ');
    assert.match(text, /within about 25 seconds for someone on Welcome or the Activities hub/);
    assert.match(text, /within about a minute and a half for someone with a question on screen/);
    assert.match(text, /Beta Welcome screen, in that client's colours/);
    assert.match(text, /partway through an activity is taken out of it/);
    assert.match(text, /Answers already saved stay in the Alpha session and in its results/);
    assert.match(text, /not ended/);
    assert.match(text, /codes for Alpha that nobody has scanned yet stop working/);
    assert.match(switchDialog({ from: alpha, to: beta, participants: 1, fromSession: live.session, date: DAY }).lead, /1 participant\./);
    assert.equal(dialog.confirm, 'Switch to Beta');
    const sameClient = switchDialog({ from: alpha, to: alpha, participants: 2, fromSession: live.session, date: '2026-10-12' });
    assert.equal(sameClient.title, 'Switch Alpha to 2026-10-12?');
    assert.match(sameClient.lead, /The Alpha session for 2026-10-11 is live now with 2 participants/);
    assert.doesNotMatch(switchDialog({ from: client({ name: "Domino's" }), to: beta, participants: 1, fromSession: live.session, date: DAY }).points.join(' '), /'s's/, 'no doubled possessive');
  });

  it('the participant page really does what the confirmation says (read from its source, not guessed)', async () => {
    const app = await readFile(path.join(ROOT, 'migration/src/App.svelte'), 'utf8');
    // How often, and when not: lib/common/poll-schedule.js decides the wait, lib/common/page-watch.ts the rest, App.svelte what is checked.
    const schedule = await readFile(path.join(ROOT, 'migration/src/lib/common/poll-schedule.js'), 'utf8');
    assert.match(schedule, /idlePerMinute: 3,/, 'a waiting page checks 3 times a minute (every 20 seconds), so "within about 25 seconds" holds (20 s plus up to 20% jitter)');
    assert.match(schedule, /questionPerMinute: 1,/, 'a page with a question on screen checks once a minute, so "about a minute and a half" holds');
    assert.match(schedule, /jitter: 0\.2,/);
    assert.match(app, /createPageWatcher\(\{[\s\S]*mode: \(\) => modeOf\(router\.location\)/, 'the page watches through the one timer, by what is on screen');
    assert.match(app, /enabled: \(\) => !\(previewId \|\|/, 'a preview page, which shows no live session, never checks');
    const watcher = await readFile(path.join(ROOT, 'migration/src/lib/common/page-watch.ts'), 'utf8');
    assert.match(watcher, /document\.hidden/, 'a hidden page does not check');
    assert.match(watcher, /visibilitychange', onVisibility/, 'and checks as soon as it comes back');
    assert.match(app, /async function followFacilitator[\s\S]*clearTrack\(\);[\s\S]*navigateTo\('\/welcome'\)/, 'it drops the visit and lands on Welcome');
    assert.match(app, /settings\.activeSessionId !== track\.sessionId\) \{\s*await followFacilitator/, 'a visit is dropped when the active session is no longer its own');
    const cache = await readFile(path.join(ROOT, 'migration/src/lib/participant/experience.svelte.ts'), 'utf8');
    assert.match(cache, /export const isStale/, 'a page with no visit follows too');
  });
});

describe('clients', () => {
  const clients = [
    client({ id: 'c-kroger', name: 'Kroger', slug: 'kroger' }),
    client({ id: 'c-old', name: 'Older Co.', slug: undefined }), // no slug: sessionIdFor() falls back to the name
  ];

  it('a slug is a to z, 0 to 9 and single hyphens, and unique among every client, archived or not', () => {
    const check = (slug, editingId = null) => slugProblem(slug, { api: ds, clients, editingId });
    assert.equal(check('domino-s-2'), '');
    assert.equal(check('x'.repeat(40)), '');
    assert.match(check(''), /Enter a slug/);
    assert.match(check('x'.repeat(41)), /40 characters/);
    for (const bad of ['Kroger', 'kroger_2', '-kroger', 'kroger-', 'kro--ger', 'kro ger', "domino's", 'ünï']) assert.match(check(bad), /Use a to z/, bad);
    assert.match(check('kroger'), /Kroger already uses this slug/);
    assert.equal(check('kroger', 'c-kroger'), '', 'a client may keep its own slug');
    assert.match(check('older-co'), /Older Co\. already uses this slug/, 'a client with no slug uses the one its name makes');
    assert.equal(SLUG_PATTERN.test('a-b-c'), true);
    assert.equal(effectiveSlug(ds, clients[1]), 'older-co');
  });

  it('the form needs a name and a good slug', () => {
    const form = { name: 'Beta', slug: 'beta', eventTitle: '', eventSubtitle: '', welcomeLine: '' };
    assert.deepEqual(clientProblems(form, { api: ds, clients }), {});
    assert.match(clientProblems({ ...form, name: '  ' }, { api: ds, clients }).name, /Enter the client name/);
    assert.match(clientProblems({ ...form, slug: 'Bad Slug' }, { api: ds, clients }).slug, /Use a to z/);
    assert.equal(defaultEventTitle("Domino's"), "DOMINO'S TRIVIA NIGHT");
    assert.equal(defaultEventTitle('  '), '');
  });

  it('a new client gets the default palette in the Phase 4 shape, at ThemeVersion 1', () => {
    const { theme, themeVersion } = themeForSave(null, { name: 'Beta', slug: 'beta', eventTitle: 'BETA TRIVIA NIGHT', eventSubtitle: 'Sub', welcomeLine: '' });
    assert.equal(themeVersion, 1);
    assert.deepEqual(Object.keys(theme).sort(), ['accent', 'assets', 'copy', 'primary', 'tokens', 'version']);
    assert.equal(theme.version, 1);
    assert.equal(theme.primary, '#045BCC');
    assert.deepEqual(theme.tokens, deriveTheme('#045BCC').tokens, 'the default Deloitte blue, from deriveTheme');
    assert.deepEqual(theme.copy, { eventTitle: 'BETA TRIVIA NIGHT', eventSubtitle: 'Sub', welcomeLine: '', logoText: 'Beta' });
    const resolved = resolveClientTheme({ name: 'Beta', theme, themeVersion });
    assert.equal(resolved.source, 'stored');
    assert.equal(resolved.copy.eventTitle, 'BETA TRIVIA NIGHT');
    assert.equal(resolved.copy.welcomeLine, 'Welcome to the Beta experience.', 'an empty welcome line falls back to the default words');
  });

  it("an edit keeps the client's palette, accent and pictures, takes the new words, and bumps the version", () => {
    const existing = {
      name: 'Domino\'s', themeVersion: 3,
      theme: { version: 3, primary: '#0B648F', accent: '#E21737', tokens: {}, assets: { hero: null, logo: '/dom.png', background: null, tile: null }, copy: { eventTitle: 'OLD', eventSubtitle: '', welcomeLine: '', logoText: "Domino's" } },
    };
    const { theme, themeVersion } = themeForSave(existing, { name: "Domino's Pizza", slug: 'dominos', eventTitle: 'NEW', eventSubtitle: 'Sub', welcomeLine: 'Hello' });
    assert.equal(themeVersion, 4);
    assert.equal(theme.version, 4);
    assert.equal(theme.primary, '#0B648F');
    assert.equal(theme.accent, '#E21737');
    assert.equal(theme.assets.logo, '/dom.png');
    assert.deepEqual(theme.tokens, deriveTheme('#0B648F', '#E21737').tokens);
    assert.deepEqual(theme.copy, { eventTitle: 'NEW', eventSubtitle: 'Sub', welcomeLine: 'Hello', logoText: "Domino's Pizza" }, 'the plate text followed the name, because it was the name');
    const custom = themeForSave({ ...existing, theme: { ...existing.theme, copy: { ...existing.theme.copy, logoText: 'DOM' } } }, { name: 'X', slug: 'x', eventTitle: '', eventSubtitle: '', welcomeLine: '' });
    assert.equal(custom.theme.copy.logoText, 'DOM', 'a plate text somebody chose is left alone');
    assert.deepEqual(formOf(existing), { name: "Domino's", slug: '', eventTitle: 'OLD', eventSubtitle: '', welcomeLine: '' });
  });

  it('the list derives its columns from existing data: status, activities, last live date, live now, slug lock', () => {
    const rows = clientRows({
      clients: [client({ id: 'c-b', name: 'Beta', status: 'archived' }), client()],
      sessions: [{ id: 'a1', clientId: 'c-a', date: '2026-09-01' }, { id: 'a2', clientId: 'c-a', date: '2026-10-11' }],
      sections: [section(), section({ id: 's2', enabled: false }), section({ id: 's3', clientId: 'c-b' })],
      liveClientId: 'c-a',
    });
    assert.deepEqual(rows.map((row) => row.client.name), ['Alpha', 'Beta']);
    assert.deepEqual(rows[0], { client: rows[0].client, archived: false, activities: 2, liveActivities: 1, lastLive: '2026-10-11', liveNow: true, sessionCount: 2, slugLocked: true });
    assert.deepEqual([rows[1].archived, rows[1].activities, rows[1].lastLive, rows[1].liveNow, rows[1].slugLocked], [true, 1, null, false, false]);
  });
});

describe('colours', () => {
  it('every text pair on the admin page is at least 4.5:1', async () => {
    const css = await readFile(path.join(ROOT, 'migration/src/styles/admin-tokens.css'), 'utf8');
    const value = (name) => new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)?.[1];
    const pairs = [
      ['adm-ink', 'adm-bg'], ['adm-ink', 'adm-card'], ['adm-muted', 'adm-bg'], ['adm-muted', 'adm-card'],
      ['adm-ok-ink', 'adm-ok-bg'], ['adm-warn-ink', 'adm-warn-bg'], ['adm-bad-ink', 'adm-bad-bg'], ['adm-idle-ink', 'adm-idle-bg'],
    ];
    for (const [ink, ground] of pairs) {
      assert.ok(value(ink) && value(ground), `${ink} and ${ground} are defined`);
      assert.ok(contrastRatio(value(ink), value(ground)) >= 4.5, `${ink} on ${ground}: ${contrastRatio(value(ink), value(ground)).toFixed(2)}`);
    }
    // White text on the primary button, and on the navy bar.
    const action = deriveTheme('#045BCC').tokens['--action'];
    assert.ok(contrastRatio('#ffffff', action) >= 4.5, `white on ${action}`);
    assert.ok(contrastRatio('#ffffff', value('adm-bar')) >= 4.5);
  });
});

// ---- Requests: SharePoint (mocked) ----------------------------------------------------------------

describe('on SharePoint (mocked)', () => {
  after(() => { globalThis.fetch = realFetch; });

  it('Today loads in 4 requests: the write token and three batches, whether or not anything is live', async () => {
    const fake = await site();
    const page = await freshPage({ sharePoint: fake.settings });
    fake.reset();
    const idle = await loadToday(page, { date: DAY });
    assert.deepEqual(fake.requests.map(shape), [
      'POST /contextinfo',
      'POST /$batch [clients, sessions, sections, questions, options, tracks, qrtokens, appsettings, visitorroster, uservisitlogs, adminusers, responses]',
      'POST /$batch [appsettings, clients, sessions, sections]',
      'POST /$batch [questions, options]',
    ], 'the lists beside the column check, then the picked client\'s questions and options');
    assert.equal(idle.status.live, false);
    assert.equal(idle.pickedClientId, 'c-dominos', 'the first active client by name');
    assert.ok(idle.schema.report.every((entry) => entry.ready), 'the mocked site has every column');
    measured.push(['Today load, nothing live', fake.requests.length, 6]);

    await ds.activateClient('c-kroger', DAY);
    const other = await freshPage({ sharePoint: fake.settings });
    fake.reset();
    const live = await loadToday(other, { date: DAY });
    assert.equal(fake.requests.length, 4);
    assert.equal(fake.requests.at(-1).parts.map((part) => part.list).join(), 'questions,options,tracks', "the live session's tracks ride in the same batch");
    assert.equal(live.status.live, true);
    assert.equal(live.pickedClientId, 'c-kroger', 'the live client is picked');
    assert.equal(live.participants, 0);
    assert.equal(live.questions.length, 6, "the sample Kroger's two live activities' questions");
    measured.push(['Today load, a client live', fake.requests.length, 6]);
  });

  it('changing the picker costs one request; a date that needs no roster costs none', async () => {
    const fake = await site();
    const page = await freshPage({ sharePoint: fake.settings });
    const state = await loadToday(page, { date: DAY });
    fake.reset();
    const client = state.clients.find((entry) => entry.id === 'c-kroger');
    const inputs = await loadReadinessInputs(page, { client, date: DAY, sections: state.sections, sessions: state.sessions });
    assert.deepEqual(fake.requests.map(shape), ['POST /$batch [questions, options]']);
    assert.equal(inputs.questions.length, 6);
    measured.push(['Picking another client', fake.requests.length, '']);
  });

  it('a poll is ONE request, and two when something else became live: never the whole page again', async () => {
    const fake = await site();
    await ds.activateClient('c-kroger', DAY);
    const page = await freshPage({ sharePoint: fake.settings });
    const state = await loadToday(page, { date: DAY });
    fake.reset();
    let next = await pollToday(page, state);
    assert.deepEqual(fake.requests.map(shape), ['POST /$batch [appsettings, sessions, tracks]']);
    assert.equal(next.status.live, true);
    assert.equal(next.changed, false);
    measured.push(['Poll, nothing changed', fake.requests.length, 2]);
    // A participant joins; the next poll counts them.
    await ds.beginVisit(crypto.randomUUID(), `kroger-${DAY}`, 'c-kroger');
    fake.reset();
    next = await pollToday(page, state);
    assert.equal(next.participants, 1);
    assert.equal(fake.requests.length, 1);

    // Another admin switches client.
    await ds.activateClient('c-dominos', DAY);
    fake.reset();
    next = await pollToday(page, state);
    assert.deepEqual(fake.requests.map(shape), ['POST /$batch [appsettings, sessions, tracks]', 'POST /$batch [sessions, tracks, clients]']);
    assert.equal(next.changed, true);
    assert.equal(next.status.client.name, "Domino's");
    measured.push(['Poll, something else became live', fake.requests.length, 2]);

    // Nothing live at all: one small read.
    const empty = createSharePointFake();
    empty.install();
    const bare = await freshPage({ sharePoint: empty.settings });
    empty.reset();
    const quiet = await pollToday(bare, { settings: null, clients: [] });
    assert.equal(empty.requests.length, 1);
    assert.equal(quiet.status.reason, 'no-session');
  });

  it('Go live is activateClient and one read of AppSettings to prove it', async () => {
    const fake = await site();
    const page = await freshPage({ sharePoint: fake.settings });
    await loadToday(page, { date: DAY });
    fake.reset();
    const first = await goLive(page, { clientId: 'c-kroger', date: DAY });
    assert.equal(first.verified, true);
    assert.equal(first.settings.activeClientId, 'c-kroger');
    assert.equal(fake.requests.at(-1).method === 'GET' && fake.requests.at(-1).list === 'appsettings', true, 'the last request is the read-back');
    const writes = fake.requests.filter((entry) => entry.method !== 'GET' && entry.path !== '/_api/contextinfo' && !entry.path.endsWith('/contextinfo'));
    // (Since Phase 10c-2b the AppSettings item is there before the first Go live: Setup makes it with the lists' version. Go live updates it.)
    assert.deepEqual(writes.map(shape), ['POST sessions', 'MERGE appsettings'], 'a session, and the AppSettings item updated: nothing else is written');
    measured.push(['Go live, first of the day (new session, the AppSettings item updated)', fake.requests.length, '']);

    fake.reset();
    await goLive(page, { clientId: 'c-dominos', date: DAY });
    assert.equal(fake.item('appsettings', 'default').ActiveClientId, 'c-dominos');
    measured.push(['Go live, switching to another client (new session)', fake.requests.length, '']);

    fake.reset();
    const again = await goLive(page, { clientId: 'c-dominos', date: DAY });
    assert.equal(again.verified, true);
    assert.equal(fake.requests.filter((entry) => entry.method === 'POST' && entry.list === 'sessions').length, 0, 'pressing it again creates nothing');
    measured.push(['Go live, the same client and date again', fake.requests.length, '']);
  });

  it('a double click and a second admin end with one session and one AppSettings item', async () => {
    const fake = await site();
    const one = await freshPage({ sharePoint: fake.settings });
    const two = await freshPage({ sharePoint: fake.settings });
    fake.reset();
    // The same page twice (a double click) shares the first call's answer; the other page is a second admin.
    const results = await Promise.all([goLive(one, { clientId: 'c-kroger', date: DAY }), goLive(one, { clientId: 'c-kroger', date: DAY }), goLive(two, { clientId: 'c-kroger', date: DAY })]);
    assert.ok(results.every((result) => result.verified), 'all three read back the same settings');
    assert.equal(fake.lists.get('sessions').filter((row) => row.AppId === `kroger-${DAY}`).length, 1);
    assert.equal(fake.lists.get('appsettings').length, 1);
    assert.equal(fake.item('appsettings', 'default').ActiveSessionId, `kroger-${DAY}`);
    // The double click on one page was one run, not two: that page made one set of requests.
    assert.equal(results[0], results[1]);
  });

  it('read-back notices when another admin switched it a moment later', async () => {
    const fake = await site();
    const page = await freshPage({ sharePoint: fake.settings });
    // After this page's activation lands, another admin overwrites AppSettings before the read-back.
    fake.hooks.beforeMerge = null;
    const stand = { ...page, activateClient: async (...args) => {
      const result = await page.activateClient(...args);
      await ds.activateClient('c-dominos', DAY);
      return result;
    } };
    const result = await goLive(stand, { clientId: 'c-kroger', date: DAY });
    assert.equal(result.verified, false);
    assert.equal(result.settings.activeClientId, 'c-dominos');
  });

  it('refuses an archived client, and a session that has ended', async () => {
    const fake = await site();
    const page = await freshPage({ sharePoint: fake.settings });
    await ds.updateClient('c-dominos', { status: 'archived' });
    await assert.rejects(goLive(page, { clientId: 'c-dominos', date: DAY }), { code: 'client-archived' });
    await ds.activateClient('c-kroger', DAY);
    await ds.endSession(`kroger-${DAY}`);
    await assert.rejects(goLive(page, { clientId: 'c-kroger', date: DAY }), { code: 'session-ended' });
  });

  it('makes an existing session live whatever its id, naming its client, and retires the codes of the one it replaces', async () => {
    const fake = await site();
    await ds.createSession({ id: 's-legacy', clientId: 'c-dominos', date: '2026-09-18', sectionIds: [], status: 'in-progress' });
    const { session } = await ds.activateClient('c-kroger', DAY);
    const code = await ds.provisionQrToken('c-kroger', session.id);
    const page = await freshPage({ sharePoint: fake.settings });
    const result = await makeSessionLive(page, 's-legacy');
    assert.equal(result.verified, true);
    assert.deepEqual([fake.item('appsettings', 'default').ActiveSessionId, fake.item('appsettings', 'default').ActiveClientId], ['s-legacy', 'c-dominos']);
    assert.equal(fake.item('qrtokens', code.id).Used, true, "Kroger's unscanned code stopped working");
    const live = await ds.getLiveExperience();
    assert.equal(live.status, 'live', 'the participant page sees it as live (no stale ActiveClientId left behind)');
    assert.equal(live.client.id, 'c-dominos');
    await assert.rejects(makeSessionLive(page, 's-nobody'), { code: 'session-missing' });
  });

  it('readLists answers like queryItems, batches reads, and falls back to plain reads where $batch is refused', async () => {
    const fake = await site();
    const page = await freshPage({ sharePoint: fake.settings });
    const queries = [{ list: 'sections', where: { clientId: 'c-kroger' } }, { list: 'clients', where: { id: ['c-dominos', 'c-kroger'] } }, { list: 'tracks', where: { sessionId: [] } }, { list: 'sessions' }];
    fake.reset();
    const [sections, clients, none, sessions] = await page.readLists(queries);
    assert.deepEqual(fake.requests.map(shape), ['POST /contextinfo', 'POST /$batch [sections, clients, sessions]'], 'an empty filter sends nothing');
    assert.deepEqual(sections.map((entry) => entry.id).sort(), (await ds.listClientSections('c-kroger')).map((entry) => entry.id).sort());
    assert.deepEqual(clients.map((entry) => entry.id).sort(), ['c-dominos', 'c-kroger']);
    assert.deepEqual([none, sessions], [[], []]);
    await assert.rejects(page.readLists([{ list: 'responses' }]), /Unsupported list/);
    await assert.rejects(page.readLists([{ list: 'sections', where: { nonsense: 'x' } }]), /Unsupported filter/);

    // A site that refuses $batch costs requests, never an answer.
    const plain = await freshPage({ sharePoint: fake.settings });
    fake.failNext({ status: 400, when: (entry) => entry.path.endsWith('/$batch'), times: 5 });
    fake.reset();
    const [again] = await plain.readLists(queries.slice(0, 2));
    assert.deepEqual(again.map((entry) => entry.id).sort(), sections.map((entry) => entry.id).sort());
    assert.ok(fake.requests.some((entry) => entry.list === 'sections'), 'the same reads, one by one');
    fake.clearFaults();
  });

  it('a read longer than one page follows the next link, batched or not', async () => {
    const fake = await site();
    for (let index = 0; index < 230; index += 1) await ds.createSection({ id: `bulk-${index}`, title: `Bulk ${index}`, order: 100 + index, enabled: false, industryTags: [], questionIds: [], clientId: 'c-kroger' });
    const page = await freshPage({ sharePoint: fake.settings });
    const [sections, clients] = await page.readLists([{ list: 'sections' }, { list: 'clients' }]);
    assert.equal(sections.length, (await ds.listSections()).length, 'every section came back, across the page boundary');
    assert.ok(sections.length > 230);
    assert.equal(clients.length, 2);
  });

  it('the schema check can read every list\'s columns in one batch, and reports the same thing either way', async () => {
    const without = ['clients.Slug', 'sections.ClientId', 'uservisitlogs'];
    const fake = createSharePointFake({ without });
    fake.install();
    const page = await freshPage({ sharePoint: fake.settings });
    fake.reset();
    const batched = await page.checkSharePointSchema({ batch: true });
    assert.deepEqual(fake.requests.map(shape).filter((entry) => !/contextinfo/.test(entry)), [
      'POST /$batch [clients, sessions, sections, questions, options, tracks, qrtokens, appsettings, visitorroster, uservisitlogs, adminusers, responses]',
      'GET uservisitlogs', // the one list that is missing: its part failed, so it is asked for alone to learn why
    ], 'one request carries every list\'s columns');
    fake.reset();
    const plain = await page.checkSharePointSchema();
    assert.ok(fake.requests.length >= 12, 'one read per list without the batch');
    assert.deepEqual(batched, plain);
    assert.deepEqual(plainTitles(batched).flatMap((entry) => entry.problems.map((problem) => `${entry.list}.${problem.column ?? '(list)'}`)).sort(), [`${TITLE.clients}.Slug`, `${TITLE.sections}.ClientId`, `${TITLE.uservisitlogs}.(list)`].sort());
  });

  // ---- Phase 9b, DEP-1: "Please check by eye" ----------------------------------------------------------------------------
  // Until Phase 10c-2b Check Lists tested strictly only AppId, the JSON text columns and the 13 added columns, and listed the other original
  // columns' types and the indexes PROVISIONING.md asked for "by eye", as warnings that never changed a row's Ready. Schema v2 checks every
  // column strictly, in Setup (pms-schema-meta.js handed in) and on Today (the names file's kinds and indexes). These are the sites those
  // tests made, read the same number of times. Against the mocked REST only: whether the real tenant reports the same TypeAsString and
  // Indexed is a thing to see on the test site.
  describe('Phase 10c-2b: every column is checked strictly, by Setup and by Today', () => {
    const strictSite = async (change = () => {}, options = {}) => {
      const fake = createSharePointFake(options);
      change(fake);
      fake.install();
      return { fake, page: await freshPage({ sharePoint: fake.settings }) };
    };
    const field = (fake, list, column) => fake.fields.get(list).find((entry) => entry.InternalName === column);
    const problems = (report) => plainTitles(report).flatMap((entry) => entry.problems.map((problem) => `${entry.list}.${problem.column}: ${problem.problem}`));

    it('a site made from the schema has nothing to fix, by Setup\'s check or Today\'s', async () => {
      const { page } = await strictSite();
      const today = await page.checkSharePointSchema();
      assert.ok(today.every((entry) => entry.ready));
      const setup = await page.checkSharePointSchema({ specs: schemaSpecs });
      assert.deepEqual(setup.map((entry) => entry.list), today.map((entry) => entry.list));
      assert.ok(setup.every((entry) => entry.ready));
    });

    it('names a Yes/No made as text, a Choice where Yes/No is wanted, a date made as text, a single-line Prompt and the indexes that are missing', async () => {
      const { fake, page } = await strictSite((made) => {
        const set = (list, column, change) => Object.assign(made.fields.get(list).find((entry) => entry.InternalName === column), change);
        set('sections', 'Enabled', { TypeAsString: 'Text' });
        set('options', 'Correct', { TypeAsString: 'Choice', Choices: { results: ['Yes', 'No'] } });
        set('sessions', 'SessionDate', { TypeAsString: 'Text' });
        set('questions', 'Prompt', { TypeAsString: 'Text' });
        for (const [list, column] of [['tracks', 'SessionId'], ['options', 'QuestionId'], ['questions', 'SectionId'], ['responses', 'SessionId'], ['sessions', 'ClientId']]) set(list, column, { Indexed: false });
      });
      const report = await page.checkSharePointSchema({ specs: schemaSpecs });
      assert.deepEqual([...problems(report)].sort(), [
        `${TITLE.options}.Correct: Wrong type: it is Choice.`,
        `${TITLE.options}.QuestionId: Not indexed.`,
        `${TITLE.questions}.Prompt: Wrong type: it is Single line of text.`,
        `${TITLE.responses}.SessionId: Not indexed.`,
        `${TITLE.sections}.Enabled: Wrong type: it is Single line of text.`,
        `${TITLE.sessions}.ClientId: Not indexed.`,
        `${TITLE.sessions}.SessionDate: Wrong type: it is Single line of text.`,
        `${TITLE.tracks}.SessionId: Not indexed.`,
      ].sort(), 'Questions.SectionId is not indexed in schema v2: nothing filters on it');
      assert.equal(report.find((entry) => plainTitles(entry.list) === TITLE.sections).ready, false, 'a wrong type is no longer a warning');
      assert.equal(field(fake, 'sections', 'Enabled').TypeAsString, 'Text', 'and it only read: nothing was changed');
    });

    it('accepts a Number that SharePoint calls Integer and an extra index, and refuses a column of words made as a Choice', async () => {
      const { page } = await strictSite((made) => {
        const set = (list, column, change) => Object.assign(made.fields.get(list).find((entry) => entry.InternalName === column), change);
        set('tracks', 'JoinedVia', { TypeAsString: 'Choice' });
        set('sessions', 'ParticipationMode', { TypeAsString: 'Text' });
        set('sections', 'SortOrder', { TypeAsString: 'Integer' });
        set('tracks', 'ParticipantName', { Indexed: true });
      });
      assert.deepEqual(problems(await page.checkSharePointSchema({ specs: schemaSpecs })), [`${TITLE.tracks}.JoinedVia: Wrong type: it is Choice.`]);
    });

    it('a column called Order0, or SharePoint\'s own hidden Order, is not one of the app\'s: the order is SortOrder, and nothing is said of them', async () => {
      const { page } = await strictSite((made) => {
        made.fields.get('sections').push({ InternalName: 'Order0', TypeAsString: 'Number', Indexed: false, EnforceUniqueValues: false, RichText: false, AppendOnly: false, Required: false, ReadOnlyField: false });
        made.fields.get('questions').push({ InternalName: 'Order', TypeAsString: 'Number', Hidden: true, Indexed: false, EnforceUniqueValues: false, RichText: false, AppendOnly: false, Required: false, ReadOnlyField: false });
      });
      const report = await page.checkSharePointSchema({ specs: schemaSpecs });
      assert.ok(report.every((entry) => entry.ready));
      assert.deepEqual(problems(report), []);
    });

    it('a list that is missing is named; the batched read gives the same report as the plain one', async () => {
      const { fake, page } = await strictSite((made) => {
        Object.assign(made.fields.get('sections').find((entry) => entry.InternalName === 'Enabled'), { TypeAsString: 'Text' });
      }, { without: ['uservisitlogs'] });
      const plain = await page.checkSharePointSchema({ specs: schemaSpecs });
      assert.ok(plain.some((entry) => plainTitles(entry.list) === TITLE.uservisitlogs && !entry.ready));
      assert.deepEqual(problems(plain), [`${TITLE.sections}.Enabled: Wrong type: it is Single line of text.`, `${TITLE.uservisitlogs}.null: The list "${TITLE.uservisitlogs}" does not exist.`]);
      fake.reset();
      const batched = await page.checkSharePointSchema({ specs: schemaSpecs, batch: true });
      assert.deepEqual(problems(batched), problems(plain));
      assert.ok(fake.requests.filter((entry) => entry.parts).length >= 1, 'it still reads every list in one batch');
    });

    it('Today blocks on a type that is wrong, and only warns on a missing index', async () => {
      const fake = createSharePointFake();
      Object.assign(fake.fields.get('sections').find((entry) => entry.InternalName === 'Enabled'), { TypeAsString: 'Text' });
      Object.assign(fake.fields.get('tracks').find((entry) => entry.InternalName === 'SessionId'), { Indexed: false });
      fake.install();
      ds.configure({ sharePoint: fake.settings });
      await seedPack(ds, samplePack());
      const today = await loadToday(ds, { date: DAY });
      assert.deepEqual(problems(today.schema.report), [`${TITLE.sections}.Enabled: Wrong type: it is Single line of text.`, `${TITLE.tracks}.SessionId: Not indexed.`]);
      const rows = evaluateReadiness({ ...goodInput(), schema: today.schema });
      assert.equal(rows.find((row) => row.id === 'lists').level, 'blocker');
      assert.match(rows.find((row) => row.id === 'lists').detail, new RegExp(`${TITLE.sections}\\.Enabled: Wrong type`));
    });
  });

  // (Until Phase 10c-2b a test here counted the 13 columns added in Phase 4. There is no such thing as an added column in schema v2:
  // scripts/test-schema.js holds the schema file to the snapshot of the tables it replaced and to this phase's list of changes.)

  it('a new client is stored the way a seeded one is, and its slug cannot be taken twice', async () => {
    const fake = await site();
    const page = await freshPage({ sharePoint: fake.settings });
    const form = { name: 'Beta Co', slug: 'beta-co', eventTitle: 'BETA CO TRIVIA NIGHT', eventSubtitle: '', welcomeLine: '' };
    const created = await createClientRecord(page, form);
    assert.equal(created.id, 'c-beta-co');
    const row = fake.item('clients', 'c-beta-co');
    assert.deepEqual([row.Slug, row.Status, row.ThemeVersion], ['beta-co', 'active', 1]);
    assert.equal(JSON.parse(row.ThemeJson).copy.eventTitle, 'BETA CO TRIVIA NIGHT');
    await assert.rejects(createClientRecord(page, form), { code: 'slug-taken' });
    // An edit bumps the version and leaves the slug alone while it is locked.
    const edited = await updateClientRecord(page, created, { ...form, name: 'Beta Company', slug: 'changed' }, { slugLocked: true });
    assert.equal(edited.slug, 'beta-co');
    assert.equal(fake.item('clients', 'c-beta-co').ThemeVersion, 2);
    assert.equal(JSON.parse(fake.item('clients', 'c-beta-co').ThemeJson).version, 2);
    const unlocked = await updateClientRecord(page, edited, { ...form, slug: 'beta-two' }, { slugLocked: false });
    assert.equal(unlocked.slug, 'beta-two');
  });

  it('a live client cannot be archived, a client that is not live can, and restoring works', async () => {
    const fake = await site();
    const page = await freshPage({ sharePoint: fake.settings });
    await ds.activateClient('c-kroger', DAY);
    assert.equal(await isClientLive(page, 'c-kroger'), true);
    assert.equal(await isClientLive(page, 'c-dominos'), false);
    await assert.rejects(setClientStatus(page, { id: 'c-kroger', name: 'Kroger' }, 'archived'), { code: 'client-live' });
    await setClientStatus(page, { id: 'c-dominos', name: "Domino's" }, 'archived');
    assert.equal(fake.item('clients', 'c-dominos').Status, 'archived');
    await setClientStatus(page, { id: 'c-dominos', name: "Domino's" }, 'active');
    assert.equal(fake.item('clients', 'c-dominos').Status, 'active');
    // An ended session no longer holds its client live.
    await ds.endSession(`kroger-${DAY}`);
    assert.equal(await isClientLive(page, 'c-kroger'), false);
    await setClientStatus(page, { id: 'c-kroger', name: 'Kroger' }, 'archived');
  });

  // Phase 10c-2a, F3. Deleting a client used to read EVERY session, EVERY visit and EVERY QR code there is (three whole lists, which
  // only grow) to find the few that are this client's, and showing a check-in code read every code there is to list six.
  it('what uses a client: its sessions, then their visits and codes by session, in two requests; a client with no session costs one', async () => {
    const fake = await site();
    const page = await freshPage({ sharePoint: fake.settings });
    await usageScene(page);
    for (const [clientId, what, budget] of [['c-kroger', 'a client with two sessions', 2], ['c-dominos', 'the live client', 2], ['c-acme', 'a client with no session', 1]]) {
      const expected = await usageFromWholeLists(page, clientId);
      fake.reset();
      const usage = await clientUsage(page, clientId);
      const addresses = addressesOf(fake.requests);
      assert.deepEqual(usageIds(usage), expected, `${what}: the same sessions, visits and codes as the whole lists hold for it`);
      assert.deepEqual(wholeListReads(addresses), [], `${what}: no visit or code is read except by its session`);
      assert.equal(fake.count(), budget, `${what}: ${addresses.join(' | ')}`);
      measured.push([`what uses ${what} (was 4 requests, three of them whole lists that grow with every session)`, fake.count(), String(budget)]);
    }
    const kroger = usageIds(await clientUsage(page, 'c-kroger'));
    assert.deepEqual([kroger.live, kroger.sessions, kroger.tracks.length, kroger.tokens.length], [false, [`kroger-${EARLIER}`, `kroger-${DAY}`], 2, 2]);
    assert.deepEqual(usageIds(await clientUsage(page, 'c-acme')), { live: false, sessions: [], tracks: [], tokens: [] });
    assert.equal((await clientUsage(page, 'c-dominos')).live, true);
  });

  it('what uses a client with many sessions: still two requests, 15 sessions to a read, and no address over 1,500 characters', async () => {
    const fake = await site();
    const page = await freshPage({ sharePoint: fake.settings });
    await usageScene(page);
    // 45 more days, with the longest ids a session gets (a 40-letter slug and a date), and a visit on the last of them.
    const slug = 'k'.repeat(40);
    const days = Array.from({ length: 45 }, (_unused, index) => `${slug}-2026-${String(1 + Math.floor(index / 28)).padStart(2, '0')}-${String(1 + (index % 28)).padStart(2, '0')}`);
    for (const id of days) await page.createSession({ id, clientId: 'c-kroger', date: id.slice(-10), sectionIds: [], status: 'completed' });
    fake.add('tracks', { AppId: 'track-old', SessionId: days.at(-1), ClientId: 'c-kroger', JoinedVia: 'manual', CreatedAt: '2026-02-17T10:00:00.000Z', ResumeCount: 0 });
    const expected = await usageFromWholeLists(page, 'c-kroger');
    fake.reset();
    const usage = usageIds(await clientUsage(page, 'c-kroger'));
    assert.deepEqual(usage, expected);
    assert.equal(usage.sessions.length, 47);
    assert.ok(usage.tracks.includes('track-old'), 'a visit of the 47th session is found');
    assert.equal(fake.count(), 2);
    const parts = fake.requests.flatMap((entry) => entry.parts ?? []);
    assert.equal(parts.filter((part) => part.list === 'tracks').length, 4, '47 sessions are four reads of the visits');
    assert.equal(parts.filter((part) => part.list === 'qrtokens').length, 4);
    const longest = Math.max(...parts.map((part) => part.url.length));
    assert.ok(longest <= 1500, `the longest address is ${longest} characters`);
    measured.push(['what uses a client with 47 sessions (longest address, characters)', longest, '1500']);
  });

  it("a session's newest codes: one read by the session, newest first, six at most, and only that session's", async () => {
    const fake = await site();
    const page = await freshPage({ sharePoint: fake.settings });
    await usageScene(page);
    await page.activateClient('c-kroger', DAY);
    const made = [];
    for (let count = 0; count < 5; count += 1) made.push((await page.provisionQrToken('c-kroger')).id);
    const all = (await page.listQrTokens()).filter((token) => token.sessionId === `kroger-${DAY}`).map((token) => token.id);
    assert.equal(all.length, 7, 'two from before and five now');
    fake.reset();
    const shown = await recentCodes(page, `kroger-${DAY}`, 'c-kroger');
    assert.deepEqual(shown.map((token) => token.id), all.reverse().slice(0, 6));
    assert.equal(shown[0].id, made.at(-1), 'newest first');
    assert.equal(fake.count(), 1);
    assert.deepEqual(wholeListReads(addressesOf(fake.requests)), []);
    measured.push(["a session's newest check-in codes (was the whole QRTokens list)", fake.count(), '1']);
    assert.deepEqual(await recentCodes(page, `dominos-${DAY}`, 'c-kroger'), [], "another client's session holds none of this client's codes");
  });
});

// ---- The local server ----------------------------------------------------------------------------

describe('on the local server', () => {
  let server;
  let dataDir;

  before(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'cec-admin-'));
    await cp(path.join(ROOT, 'server', 'data'), dataDir, { recursive: true });
    const port = await freePort();
    server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((resolve, reject) => {
      server.once('exit', (code) => reject(new Error(`server exited early (code ${code})`)));
      server.stdout.on('data', (chunk) => String(chunk).includes('running') && resolve());
    });
    globalThis.fetch = realFetch;
    ds.configure({ baseUrl: `http://localhost:${port}/api` });
  });

  after(async () => {
    server?.kill();
    ds.configure({ baseUrl: '/api' });
    await rm(dataDir, { recursive: true, force: true });
  });

  it('readLists answers the same as the single reads, with array filters and empty filters', async () => {
    const [sections, clients, none] = await ds.readLists([{ list: 'sections', where: { clientId: 'c-kroger' } }, { list: 'clients', where: { id: ['c-dominos', 'c-kroger'] } }, { list: 'tracks', where: { sessionId: [] } }]);
    assert.deepEqual(sections.map((entry) => entry.id), (await ds.listClientSections('c-kroger')).map((entry) => entry.id));
    assert.deepEqual(clients.map((entry) => entry.id).sort(), ['c-dominos', 'c-kroger']);
    assert.deepEqual(none, []);
  });

  it('loads Today, goes live, polls and switches, on the same code path as SharePoint', async () => {
    const before = await loadToday(ds, { date: DAY });
    assert.equal(before.status.live, false);
    assert.equal(before.schema, null, 'there are no SharePoint lists to check locally');
    const result = await goLive(ds, { clientId: 'c-kroger', date: DAY });
    assert.equal(result.verified, true);
    const poll = await pollToday(ds, before);
    assert.equal(poll.changed, true);
    assert.equal(poll.status.client.name, 'Kroger');
    await ds.beginVisit(crypto.randomUUID(), `kroger-${DAY}`, 'c-kroger');
    const state = await loadToday(ds, { date: DAY });
    assert.equal(state.participants, 1);
    assert.equal(state.pickedClientId, 'c-kroger');
    await goLive(ds, { clientId: 'c-dominos', date: DAY });
    assert.equal((await pollToday(ds, state)).status.client.name, "Domino's");
    // Switching away did not end the first session or touch its participant.
    assert.equal((await ds.getSession(`kroger-${DAY}`)).status, 'in-progress');
    assert.equal((await ds.listClientTracks(`kroger-${DAY}`)).length, 1);
  });

  it('a session whose id is not <slug>-<date> is made live with its client named, so that participants see it', async () => {
    await ds.createSession({ id: 's-older', clientId: 'c-kroger', date: '2026-09-18', sectionIds: [], status: 'in-progress' });
    await makeSessionLive(ds, 's-older');
    const live = await ds.getLiveExperience();
    assert.equal(live.status, 'live');
    assert.equal(live.session.id, 's-older');
  });

  it('what uses a client, and a session\'s newest codes, are the same on the local server (Phase 10c-2a, F3)', async () => {
    await usageScene(ds);
    for (const clientId of ['c-kroger', 'c-dominos', 'c-acme']) assert.deepEqual(usageIds(await clientUsage(ds, clientId)), await usageFromWholeLists(ds, clientId), clientId);
    const kroger = usageIds(await clientUsage(ds, 'c-kroger'));
    assert.ok(kroger.sessions.includes(`kroger-${EARLIER}`) && kroger.sessions.includes(`kroger-${DAY}`) && kroger.sessions.includes('s-kroger-kickoff'), 'the seeded session and the two made here');
    assert.ok(kroger.tracks.length >= 8 && kroger.tokens.length >= 4, 'the seeded visits and codes are found by their session too');
    assert.deepEqual(usageIds(await clientUsage(ds, 'c-acme')), { live: false, sessions: [], tracks: [], tokens: [] });
    const codes = (await ds.listQrTokens()).filter((token) => token.sessionId === `kroger-${DAY}`).map((token) => token.id);
    assert.deepEqual((await recentCodes(ds, `kroger-${DAY}`, 'c-kroger')).map((token) => token.id), codes.reverse().slice(0, 6));
  });

  it('prints what was measured', () => {
    if (!measured.length) return;
    console.log('\nMeasured against the mocked SharePoint REST:');
    for (const [what, count, budget] of measured) console.log(`  ${String(count).padStart(3)}  ${budget ? `(budget ${budget})`.padEnd(13) : ''.padEnd(13)} ${what}`);
  });
});

// Phase 10b: every fake also holds the other set of lists (the prefixed ones; or the plain ones, when this suite is run a second time
// with PMS_TEST_LIST_PREFIX and its own lists are the prefixed ones). A request to them is answered, as a second copy's lists would
// answer on a real site, so nothing else in this suite would notice one: this does.
it('no request of this suite reached a list that is not its own', () => {
  assert.deepEqual(STRAYS.map((entry) => `${entry.method} ${entry.title}`), []);
  assert.deepEqual(UNINDEXED.map((entry) => `${entry.list}.${entry.unindexed}`), [], 'and none filtered on a column the schema does not index');
});
