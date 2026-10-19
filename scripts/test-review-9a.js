// Phase 9a: the independent review's fixes, each held by a test that failed before its fix. Run: node --test scripts/test-review-9a.js
// (The counting fixes are held by scripts/test-oracle.js, the pager's by scripts/test-pager.js, and the data service's by
// scripts/test-participant-storage.js; this file has the rest.)

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { STRAYS, SUITE_PREFIX, UNINDEXED } from './sharepoint-fake.js';
import { isLocalAddress } from '../migration/src/lib/settings/address-check.js';
import { resolveSettings } from '../migration/src/lib/settings/deploy-settings.js';
import { csvCell as guestCell } from '../migration/src/lib/admin/admin-content.js';
import { csvCell as reportCell } from '../migration/src/lib/exports/leader-report.js';

const source = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const at = (href) => { const url = new URL(href); return { protocol: url.protocol, hostname: url.hostname, origin: url.origin }; };

// Phase 9a's finding D-1 was that a page opened at an address it was not built for fell back, without a word, to the developer's
// local server and told every participant "isn't live yet". Its fix was a message ("This page is not set up for ..."). Phase 10b
// removed the cause: a page is no longer built for one address. Its own address decides whether it is a SharePoint page, and a
// SharePoint page that cannot tell which lists are its own stops and says so (PMS-CFG-001, PMS-CFG-004). So what is held here now
// is that rule and that stop; the browser side is scripts/migration-tests/review-9a.spec.ts and settings-file.spec.ts.
describe('a page never falls back to the local server because of where it was opened (D-1, as Phase 10b has it)', () => {
  it('plain http and this computer are the local server; every other https address is SharePoint', () => {
    for (const href of ['http://192.168.1.20:3000/index.html', 'http://localhost:3000/admin.html', 'https://localhost:8443/index.html', 'https://127.0.0.1:8443/index.html', 'https://app.localhost/index.html']) {
      assert.equal(isLocalAddress(at(href)), true, href);
    }
    for (const href of ['https://americas.internal.deloitteonline.com/sites/x/p_cec_01/index.html', 'https://deloitte.sharepoint.com/sites/CreativeExpCOE/Shared%20Documents/p_cec_01/index.html',
      'https://americas.internal.deloitteonline.com:8443/sites/x/index.html', 'https://example.org/index.html']) {
      assert.equal(isLocalAddress(at(href)), false, href);
    }
  });

  it('an https address nobody set up is a problem with a code, at any host, and never "the local server"', () => {
    for (const pageUrl of ['https://deloitte.sharepoint.com/sites/CreativeExpCOE/Shared%20Documents/p_cec_01/index.html', 'https://americas.internal.deloitteonline.com:8443/sites/x/lib/index.html', 'https://example.org/index.html']) {
      const result = resolveSettings({ pageUrl });
      assert.equal(result.settings, null);
      assert.deepEqual(result.problems, [{ id: 'PMS-CFG-001' }], 'nothing names its lists: it stops');
      // Built for one site and opened from another: it says so, where it used to work on the first site's lists from the second's folder.
      assert.deepEqual(resolveSettings({ pageUrl, file: { listPrefix: '' }, built: { siteUrl: 'https://americas.internal.deloitteonline.com/sites/CreativeExpCOE' } }).problems, [{ id: 'PMS-CFG-004' }]);
    }
  });

  it('the participant page and the admin page settle it before they read anything: neither app is mounted, and no request is sent, until it is', async () => {
    const [app, admin, start, entry, adminEntry] = await Promise.all(['migration/src/App.svelte', 'migration/src/AdminApp.svelte', 'migration/src/lib/settings/start.ts', 'migration/src/main.ts', 'migration/src/admin-main.ts'].map(source));
    for (const text of [app, admin]) assert.doesNotMatch(text, /addressProblem|address-check/, 'the Phase 9a check is gone from the apps: start-up has already answered it');
    assert.match(entry, /void startPage\(target, App\)\.then\(mounted\);/);
    assert.match(adminEntry, /void startPage\(target, AdminApp\)\.then\(mounted\);/);
    assert.ok(start.indexOf('dataService.requireConfiguration();') < start.indexOf('export async function findSettings'), 'and a request made too early is refused (PMS-CFG-003)');
  });
});

describe('a CSV cell cannot start a formula, however it is opened (S-6)', () => {
  const NBSP = String.fromCharCode(0xA0);
  const ZWSP = String.fromCharCode(0x200B);
  const BOM = String.fromCharCode(0xFEFF);
  for (const [name, cell] of [['the leader report’s participant CSV', reportCell], ['the guest list CSV', guestCell]]) {
    it(`${name}: what was guarded before still is`, () => {
      assert.equal(cell('=1+1'), "'=1+1");
      assert.equal(cell('+1'), "'+1");
      assert.equal(cell('-1'), "'-1");
      assert.equal(cell('@x'), "'@x");
      assert.ok(cell('\t=1').startsWith("'"));
      assert.equal(cell('plain'), 'plain');
      assert.equal(cell('a,b'), '"a,b"');
      assert.equal(cell('say "hi"'), '"say ""hi"""');
      assert.equal(cell('two\nlines'), '"two\nlines"');
    });

    it(`${name}: white space in front of the sign does not get it through`, () => {
      for (const lead of [' ', '  ', NBSP, ZWSP, BOM, ' \t ']) {
        const made = cell(`${lead}=cmd|' /C calc'!A0`).replace(/^"|"$/g, '');
        for (const piece of [made, ...made.split(/[;\t]/)]) assert.doesNotMatch(piece, new RegExp(`^[\\s${ZWSP}]*[=+\\-@]`), `${JSON.stringify(lead)}: ${JSON.stringify(made)}`);
        assert.ok(made.includes("'"), 'the guard is an apostrophe');
      }
      assert.equal(cell(' just words'), ' just words', 'a leading space alone is left as it is');
      assert.equal(cell('2 - 1 = 1'), '2 - 1 = 1', 'a sign inside the words is left as it is');
    });

    it(`${name}: a semicolon or a tab inside the cell cannot begin a new one that is a formula (a spreadsheet set to split on them)`, () => {
      const made = cell("x;=cmd|' /C calc'!A0;y");
      for (const piece of made.replace(/^"|"$/g, '').split(';')) assert.doesNotMatch(piece, /^\s*[=+\-@]/, made);
      for (const piece of cell('a\t+SUM(1)').replace(/^"|"$/g, '').split('\t')) assert.doesNotMatch(piece, /^\s*[=+\-@]/);
      assert.equal(cell('one; two; three'), 'one; two; three', 'an ordinary semicolon is left as it is');
      assert.equal(cell('a;b'), 'a;b');
    });
  }

  it('a number stays a number in the report’s CSV', () => {
    assert.equal(reportCell(2), '2');
    assert.equal(reportCell(-1), '-1');
  });
});

describe('answers a failed Submit left on the device are sent when the server next answers, with no tap (F-3)', () => {
  it('after every try has failed nothing goes out by itself; the page’s next successful look sends it', async () => {
    const { createAnswerStore, SaveFailedError } = await import('../migration/src/lib/participant/answer-store.js');
    let down = true;
    const sent = [];
    const api = {
      getParticipantResponses: async () => null,
      saveParticipantResponses: async (input) => {
        if (down) throw Object.assign(new Error('SharePoint (503): busy'), { status: 503 });
        sent.push(input.responses.map((record) => record.questionId));
        return { ref: 1, responses: input.responses };
      },
      mergeAnswerRecords: (_held, incoming) => incoming,
      isUnreachable: (error) => error.status >= 500,
    };
    let clock = 1_000_000;
    const store = createAnswerStore({ api, now: () => clock, sleep: async (ms) => { clock += ms; } });
    const visit = { trackId: 't', sessionId: 's', clientId: 'c', restartedAt: null };
    await store.restore(visit, null);
    store.record(visit, 'sec', { questionId: 'q1', answer: 'a', firstAnswer: 'a', attempts: 1, correct: null });
    await assert.rejects(store.flush(visit, 'sec'), SaveFailedError);
    down = false; // the connection is back, and nobody touches the iPad
    clock += 10 * 60_000;
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    assert.deepEqual(sent, [], 'the store has no timer of its own: this is what used to leave a walked-away answer out of the results');
    assert.equal(store.hasPending(visit), true);
    store.resume(visit); // what App.svelte's check does after a look that reached the server
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    assert.deepEqual(sent, [['q1']]);
    assert.equal(store.hasPending(visit), false);
  });

  it('the participant page resumes saving after every look that reached the server', async () => {
    const [app, data] = await Promise.all([source('migration/src/App.svelte'), source('migration/src/lib/participant/participantData.ts')]);
    assert.match(data, /export function resumePendingSaves\(\): void \{\s*const visit = currentVisit\(\);\s*if \(visit\) store\.resume\(visit\);\s*\}/);
    const check = app.slice(app.indexOf('async function checkServer()'), app.indexOf('let pageTitle'));
    assert.match(check, /failedWatches = 0;\s*participant\.connectionLost = false;\s*participant\.signedOut = false;\s*resumePendingSaves\(\);/, 'straight after the look is known to have reached the server');
  });
});

describe('an answer tile whose picture is gone still says what the answer is (S-7)', () => {
  it('a tile falls back to its words when its picture cannot be loaded', async () => {
    const tile = await source('migration/src/components/LogoTile.svelte');
    assert.match(tile, /\{#key src\}\s*<img class="logo" \{src\} alt="" onerror=\{wordsInstead\} \/>\s*<span class="tile-words" style="display: none">\{label \|\| alt\}<\/span>\s*\{\/key\}/, 'the words wait beside the picture, and a new address is tried afresh');
    const swap = tile.slice(tile.indexOf('function wordsInstead('), tile.indexOf('</script>'));
    assert.match(swap, /picture\.style\.display = 'none';/);
    assert.match(swap, /words\.classList\.add\('text'\);\s*words\.style\.display = '';/, 'and become a text tile like any other');
    assert.doesNotMatch(tile, /\$state\(/, 'this component has a prop called state: a rune of that name would be read as a store');
  });

  // What "still shows it" means, and that it is found without a filter on the picture's address, is held on both adapters by
  // scripts/test-admin-content.js ("which pictures an answer still shows"). Here: that the editor asks before it removes.
  it('the question editor asks who else shows a picture before it removes the file, and leaves every file when it cannot tell', async () => {
    // (Phase 16: the editor moved out of ContentQuestions.svelte, which opens it in place, and its Cancel is discard().)
    const editor = await source('migration/src/admin/QuestionEditor.svelte');
    const tidy = editor.slice(editor.indexOf('async function tidy('), editor.indexOf('export function discard()'));
    assert.match(tidy, /const shown = await picturesStillShown\(dataService, candidates\);/);
    assert.ok(tidy.indexOf('picturesStillShown(') < tidy.indexOf('removeClientAsset'), 'asked first');
    assert.match(tidy, /if \(shown\) for \(const url of candidates\) \{\s*if \(shown\.has\(url\)\) continue;/, 'null is "cannot tell": nothing is removed');
    assert.doesNotMatch(tidy, /readLists|where:/, 'the editor sends no read of its own for this');
  });

  it('no screen asks a list for the rows with one picture address (Phase 10c-2a: that column has no index)', async () => {
    const { readdir } = await import('node:fs/promises');
    const files = (await readdir(new URL('../migration/src', import.meta.url), { recursive: true })).filter((file) => /\.(svelte|ts|js)$/.test(file));
    assert.ok(files.length > 100, 'the files were found');
    const asking = [];
    for (const file of files) if (/where:\s*\{[^}]*\bimageUrl\b/.test(await source(`migration/src/${file}`))) asking.push(file);
    assert.deepEqual(asking, []);
  });
});

describe('an expired sign-in is told from a lost connection, and the page says what to do (F-2)', () => {
  /** What the data service throws when SharePoint answers every request with `reply`. */
  async function thrownFor(reply) {
    const ds = await import(`../migration/src/lib/data/dataService.js?signin=${Math.random()}`);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => reply();
    try {
      ds.configure({ sharePoint: { siteUrl: 'https://tenant.example/sites/cec', listPrefix: SUITE_PREFIX } }); // (a stub of its own, not the fake: the settings are said here)
      await ds.readParticipantWatch({ sessionId: 's', trackId: 't' });
      return null;
    } catch (error) { return error; } finally { globalThis.fetch = realFetch; }
  }
  const html = () => new Response('<!DOCTYPE html><html><head><title>Sign in to your account</title></head><body></body></html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  const json = (status, message) => () => new Response(JSON.stringify({ error: { message: { value: message } } }), { status, headers: { 'Content-Type': 'application/json' } });

  it('a sign-in page in place of an answer, and a 401, are a sign-in that has run out', async () => {
    const { isSignedOut } = await import('../migration/src/lib/participant/sign-in.js');
    const page = await thrownFor(html);
    assert.equal(page.status, 401);
    assert.equal(isSignedOut(page), true, page.message);
    assert.equal(isSignedOut(await thrownFor(json(401, 'Unauthorized'))), true);
    assert.equal(isSignedOut(await thrownFor(() => new Response('<html>Forbidden</html>', { status: 403, headers: { 'Content-Type': 'text/html' } }))), true, 'a 403 that is a page, not an answer');
  });

  it('a refusal, a busy server and no connection are not', async () => {
    const { isSignedOut } = await import('../migration/src/lib/participant/sign-in.js');
    assert.equal(isSignedOut(await thrownFor(json(403, 'Access denied. You do not have permission to perform this action or access this resource.'))), false);
    assert.equal(isSignedOut(await thrownFor(json(503, 'The server is busy.'))), false);
    assert.equal(isSignedOut(await thrownFor(() => { throw new TypeError('Load failed'); })), false);
    assert.equal(isSignedOut(null), false);
    assert.equal(isSignedOut(new Error('anything else')), false);
  });

  it('the participant page shows it, from a look and from a save, and takes it down when a look gets through', async () => {
    const [app, pager, state] = await Promise.all([source('migration/src/App.svelte'), source('migration/src/pager/ActivityPager.svelte'), source('migration/src/lib/participant/session.svelte.ts')]);
    assert.match(state, /signedOut: boolean;/);
    assert.equal(app.match(/if \(isSignedOut\(cause\)\) participant\.signedOut = true;/g)?.length, 2, 'both places a look can fail');
    assert.match(app, /participant\.connectionLost = false;\s*participant\.signedOut = false;/);
    assert.match(app, /\{#if participant\.signedOut\}[\s\S]*Your sign-in has expired\. Reload this page to sign in again\. Your answers are kept on this device\.[\s\S]*\{:else if participant\.connectionLost\}/);
    assert.match(pager, /if \(isSignedOut\(\(cause as \{ cause\?: unknown \}\)\?\.cause\)\) participant\.signedOut = true;/);
  });
});

describe('a screen that could not be loaded says why in plain words and tries again in place (F-4)', () => {
  it('the words: the sign-in, the connection, or what the server said', async () => {
    const { loadFailureText } = await import('../migration/src/lib/participant/sign-in.js');
    const { isUnreachable } = await import('../migration/src/lib/data/dataService.js');
    assert.equal(loadFailureText(new TypeError('Load failed'), isUnreachable, 'Could not load.'), 'Can’t reach the server. Check the connection, then try again.');
    assert.equal(loadFailureText(Object.assign(new Error('x'), { name: 'TimeoutError' }), isUnreachable, 'Could not load.'), 'Can’t reach the server. Check the connection, then try again.');
    assert.match(loadFailureText(Object.assign(new Error('SharePoint returned a sign-in page or non-JSON response.'), { status: 401 }), isUnreachable, 'x'), /^Your sign-in has expired\./);
    assert.equal(loadFailureText(Object.assign(new Error('SharePoint (403): Access denied.'), { status: 403 }), isUnreachable, 'x'), 'SharePoint (403): Access denied.');
    assert.equal(loadFailureText('not an error', isUnreachable, 'Could not load your activities.'), 'Could not load your activities.');
  });

  it('the hub and the pager retry what failed; they no longer reload the whole page (which, offline, puts the browser’s own error in its place)', async () => {
    const [hub, pager] = await Promise.all([source('migration/src/routes/Agenda.svelte'), source('migration/src/pager/ActivityPager.svelte')]);
    for (const [name, text] of [['the hub', hub], ['the pager', pager]]) {
      assert.doesNotMatch(text, /location\.reload\(\)/, name);
      assert.match(text, /= loadFailure\(cause, 'Could not load /, name);
    }
    assert.match(hub, /<PillButton onclick=\{\(\) => tryAgain\(\)\}>Try again<\/PillButton>/);
    assert.match(pager, /<PillButton onclick=\{\(\) => start\(\)\}>Try again<\/PillButton>/);
  });
});

describe('a wait the server asks for is obeyed, within what a timer can hold (F-8)', () => {
  it('a Retry-After of an hour, or of a number no timer can count to, becomes the longest wait there is', async () => {
    const { POLL, adminDelay, nextDelay } = await import('../migration/src/lib/common/poll-schedule.js');
    assert.equal(POLL.maxRetryAfterMs, 15 * 60_000);
    for (const asked of [3_600_000, 99_999_999_000, Number.MAX_SAFE_INTEGER]) {
      for (const wait of [nextDelay({ retryAfterMs: asked, random: () => 1 }), nextDelay({ retryAfterMs: asked, local: true }), adminDelay({ retryAfterMs: asked }), adminDelay({ retryAfterMs: asked, local: true })]) {
        assert.ok(wait <= POLL.maxRetryAfterMs * (1 + POLL.jitter), `${asked} -> ${wait}`);
        assert.ok(wait < 2 ** 31, 'a timer set for longer than this fires at once');
      }
    }
    assert.equal(nextDelay({ retryAfterMs: 90_000, random: () => 0 }), 90_000, 'an ordinary one is still a floor');
    assert.equal(adminDelay({ retryAfterMs: 45_000 }), 45_000);
  });
});

describe('a read the first screen can do without does not stop it (F-11)', () => {
  it('the look for a staff member’s earlier visit, and the activities read ahead, may each fail: Welcome still comes up', async () => {
    const { bootParticipant } = await import('../migration/src/lib/participant/boot.js');
    const { createActivityContent } = await import('../migration/src/lib/participant/activity-content.js');
    const live = { status: 'live', reason: null, settings: { activeSessionId: 's1', activeClientId: 'c1' }, client: { id: 'c1' }, session: { id: 's1', clientId: 'c1', participationMode: 'staff' }, sections: [{ id: 'sec1', enabled: true, questionIds: ['q1'] }] };
    const asked = [];
    const base = {
      getAppSettings: async () => live.settings, getCurrentUser: async () => ({ id: '42', displayName: 'Casey' }), getLiveExperience: async () => live,
      getClientTrack: async () => null, getParticipantResponses: async () => null,
      listClientTracks: async () => [], getSectionQuestions: async (section) => { asked.push(section.questionIds); return [{ id: 'q1', options: [] }]; },
    };
    const warn = console.warn;
    console.warn = () => {};
    try {
      const noTracks = await bootParticipant({ ...base, listClientTracks: async () => { throw new TypeError('Load failed'); } }, { path: '/' });
      assert.equal(noTracks.experience.status, 'live');
      assert.equal(noTracks.accountChecked, false, 'Welcome looks for itself when it opens');
      // (Phase 10j: the boot reads no activity; the page reads them all once its first screen is up, lib/participant/activity-content.js.)
      const found = await bootParticipant(base, { path: '/' });
      assert.equal(found.accountChecked, true);
      assert.deepEqual(asked, [], 'no question is read before the first screen');
      const content = createActivityContent({ api: { ...base, getSectionQuestions: async () => { throw new TypeError('Load failed'); } } });
      await content.start(live.sections); // never rejects
      await assert.rejects(content.questionsOf(live.sections[0], live.sections), TypeError, 'the pager reads the activity when it is opened, and says so if that fails');
    } finally { console.warn = warn; }
    // What the first screen cannot do without still stops it, with the error.
    await assert.rejects(bootParticipant({ ...base, getAppSettings: async () => { throw new TypeError('Load failed'); } }, { path: '/' }), TypeError);
  });
});

describe('Results says "completed" only when every answer is final, as the participant’s own page and the report do (R-2)', () => {
  it('a wrong first answer that was never tried again is answered, and not completed', async () => {
    const { resultRows } = await import('../migration/src/lib/admin/admin-results.js');
    const answer = (trackId, questionId, extra = {}) => ({ questionId, clientTrackId: trackId, clientId: 'c', answer: 'o', firstAnswer: 'o', finalAnswer: 'o', attempts: 1, correct: null, timestamp: null, ...extra });
    const result = {
      session: { id: 's', sectionIds: ['sec'] },
      tracks: [{ id: 't-open', participantName: 'Open', createdAt: '2026-10-13T10:00:00Z' }, { id: 't-done', participantName: 'Done', createdAt: '2026-10-13T10:01:00Z' }, { id: 't-old', participantName: 'Older', createdAt: '2026-10-13T10:02:00Z' }],
      sections: [{ id: 'sec', enabled: true, questions: [
        { id: 'q1', responses: [answer('t-open', 'q1'), answer('t-done', 'q1'), answer('t-old', 'q1', { attempts: null })] },
        { id: 'q2', responses: [answer('t-open', 'q2', { attempts: 1, correct: false }), answer('t-done', 'q2', { attempts: 2, correct: false }), answer('t-old', 'q2', { attempts: null })] },
      ] }],
    };
    const rows = resultRows(result);
    assert.deepEqual(rows.map((row) => [row.name, row.answered, row.total, row.status]), [
      ['Open', 2, 2, 'in-progress'],   // both answered, one still waiting for its Retry
      ['Done', 2, 2, 'completed'],     // wrong twice: the answer was shown, that is final
      ['Older', 2, 2, 'completed'],    // an answer with no history (as an older page stored it) is final
    ]);
  });
});

// Phase 10b: every fake also holds the other set of lists (the prefixed ones; or the plain ones, when this suite is run a second time
// with PMS_TEST_LIST_PREFIX and its own lists are the prefixed ones). A request to them is answered, as a second copy's lists would
// answer on a real site, so nothing else in this suite would notice one: this does.
it('no request of this suite reached a list that is not its own', () => {
  assert.deepEqual(STRAYS.map((entry) => `${entry.method} ${entry.title}`), []);
  assert.deepEqual(UNINDEXED.map((entry) => `${entry.list}.${entry.unindexed}`), [], 'and none filtered on a column the schema does not index');
});
