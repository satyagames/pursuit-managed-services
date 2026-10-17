// Phase 7: how often a page that stays open looks at the server, as numbers. The rules are in migration/src/lib/common/poll-schedule.js (no DOM),
// so every one of them is held here; the Playwright polling specs then count the real requests of the built page against the SharePoint fake.
//   Run: npm run test:polling
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { adminAddress, liveDisplayHash, liveDisplayOfHash } from '../migration/src/lib/common/admin-address.js';
import {
  ENDED_NOTICE_ROUTES, LIVE_DISPLAY, POLL, adminDelay, modeOf, nextDelay, sessionHasEnded, showsEndedNotice,
} from '../migration/src/lib/common/poll-schedule.js';
import { STRUCTURE_MAX_AGE_MS, structureChanged } from '../migration/src/lib/results/results-tally.js';

const ROOT = path.join(import.meta.dirname, '..');
/** A repeatable sequence in [0, 1): a small linear congruential generator, so a "random" test is the same every run. */
const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

describe('the wait between two looks at the server', () => {
  it('a page that is waiting looks every 20 seconds: 3 requests a minute, under the 4 allowed', () => {
    assert.equal(nextDelay({ mode: 'idle', random: () => 0.5 }), 20_000);
    assert.equal(60_000 / 20_000, POLL.idlePerMinute);
    assert.ok(POLL.idlePerMinute <= 4);
  });

  it('a page with a question on screen looks once a minute (saving answers is the traffic then)', () => {
    assert.equal(nextDelay({ mode: 'question', random: () => 0.5 }), 60_000);
    assert.equal(POLL.questionPerMinute, 1);
  });

  it('every wait is stretched or shortened by up to 20% at random, so iPads do not look together', () => {
    assert.equal(nextDelay({ mode: 'idle', random: () => 0 }), 16_000);
    assert.equal(nextDelay({ mode: 'idle', random: () => 1 }), 24_000);
    assert.equal(nextDelay({ mode: 'question', random: () => 0 }), 48_000);
    assert.equal(nextDelay({ mode: 'question', random: () => 1 }), 72_000);
    const random = seeded(7);
    const waits = Array.from({ length: 500 }, () => nextDelay({ mode: 'idle', random }));
    assert.ok(Math.min(...waits) >= 16_000 && Math.max(...waits) <= 24_000);
    assert.ok(new Set(waits).size > 100, 'the waits differ from one another');
    const mean = waits.reduce((sum, wait) => sum + wait, 0) / waits.length;
    assert.ok(Math.abs(mean - 20_000) < 600, `and average 20 s (${Math.round(mean)} ms)`);
  });

  it('ten iPads that opened at the same moment drift apart: after five minutes no two are in step', () => {
    const random = seeded(99);
    const clocks = Array.from({ length: 10 }, () => 0);
    for (let round = 0; round < 15; round += 1) for (let device = 0; device < clocks.length; device += 1) clocks[device] += nextDelay({ mode: 'idle', random });
    assert.equal(new Set(clocks).size, 10);
    assert.ok(Math.max(...clocks) - Math.min(...clocks) > 5_000, 'spread over several seconds');
  });

  it('a check that cost more than one request makes the next wait that much longer, so the rate stays the same', () => {
    assert.equal(nextDelay({ mode: 'idle', requests: 1, random: () => 0.5 }), 20_000);
    assert.equal(nextDelay({ mode: 'idle', requests: 3, random: () => 0.5 }), 60_000, 'three reads one by one (a site that cannot batch)');
    assert.equal(nextDelay({ mode: 'question', requests: 2, random: () => 0.5 }), 120_000);
    assert.equal(nextDelay({ mode: 'idle', requests: 0, random: () => 0.5 }), 20_000, 'never shorter than one');
  });

  it('a failed check backs off, doubling each time up to five minutes', () => {
    const waits = [0, 1, 2, 3, 4, 5, 8].map((failures) => nextDelay({ mode: 'idle', failures, random: () => 0.5 }));
    assert.deepEqual(waits, [20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000]);
  });

  it('a 429 or 503 Retry-After is a floor: the wait is never shorter, and its jitter only ever adds', () => {
    for (let draw = 0; draw <= 10; draw += 1) {
      const wait = nextDelay({ mode: 'idle', retryAfterMs: 90_000, random: () => draw / 10 });
      assert.ok(wait >= 90_000 && wait <= 108_000, `${wait}`);
    }
    // And a short Retry-After does not shorten the ordinary wait.
    assert.equal(nextDelay({ mode: 'idle', retryAfterMs: 2000, random: () => 0.5 }), 20_000);
    assert.ok(nextDelay({ mode: 'idle', retryAfterMs: Number.NaN, random: () => 0.5 }) === 20_000, 'an unreadable Retry-After is ignored');
  });

  it('the local server has no throttle: every 3 seconds, flat, with no jitter and no backoff (a Retry-After is still honoured)', () => {
    for (const mode of ['idle', 'question']) assert.equal(nextDelay({ mode, local: true, random: () => 0 }), 3000);
    assert.equal(nextDelay({ mode: 'idle', local: true, failures: 4, random: () => 1 }), 3000);
    assert.equal(nextDelay({ mode: 'idle', local: true, retryAfterMs: 8000 }), 8000);
  });

  it('over five minutes a waiting page makes at most 4 requests a minute, with every draw the jitter allows', () => {
    for (const draw of [0, 0.5, 1]) {
      let at = 0;
      let checks = 0;
      while (true) { // the worst case of the jitter: every wait as short as it can be
        at += nextDelay({ mode: 'idle', random: () => draw });
        if (at > 300_000) break;
        checks += 1;
      }
      assert.ok(checks / 5 <= 4, `${checks} checks in 5 minutes with every draw ${draw}`);
    }
  });

  it('ten waiting iPads for five minutes use under 10% of the 3,000 requests SharePoint allows one account', () => {
    const random = seeded(2026);
    let requests = 0;
    for (let device = 0; device < 10; device += 1) {
      let at = nextDelay({ mode: 'idle', random });
      while (at <= 300_000) { requests += 1; at += nextDelay({ mode: 'idle', random }); }
    }
    assert.ok(requests <= 150, `${requests} requests`);
    assert.ok(requests / 3000 < 0.1, `${((requests / 3000) * 100).toFixed(1)}% of 3,000`);
  });
});

describe('what kind of screen it is, and what the ended notice replaces', () => {
  it('a question or an activity completion screen is "question"; everything else a participant sees is "idle"', () => {
    for (const location of ['/quiz/sec-trivia', '/quiz/x', '/feedback/sec-feedback']) assert.equal(modeOf(location), 'question', location);
    for (const location of ['/', '/welcome', '/agenda', '/thank-you', '/master-results/x', '']) assert.equal(modeOf(location), 'idle', location);
  });

  it('the notice replaces Welcome and the hub, never an activity under way and never the finale', () => {
    assert.deepEqual([...ENDED_NOTICE_ROUTES], ['/', '/welcome', '/agenda']);
    for (const location of ['/', '/welcome', '/agenda', '/agenda?t=track-1', '/welcome?t=abc']) assert.equal(showsEndedNotice(location), true, location);
    for (const location of ['/quiz/a', '/feedback/a', '/thank-you', '/styleguide']) assert.equal(showsEndedNotice(location), false, location);
  });

  it('a session has ended when its status is completed, and Reopen takes it back to in progress or not started', () => {
    assert.equal(sessionHasEnded({ status: 'completed' }), true);
    for (const status of ['in-progress', 'not-started', undefined]) assert.equal(sessionHasEnded({ status }), false, String(status));
    assert.equal(sessionHasEnded(null), false);
  });
});

describe('the facilitator\'s screens', () => {
  it('the Live display refreshes every 12 s on SharePoint (5 a minute, one request each) and every 2 s locally, with no jitter', () => {
    assert.deepEqual({ ...LIVE_DISPLAY }, { sharePointMs: 12_000, localMs: 2000 });
    assert.equal(adminDelay({}), 12_000);
    assert.equal(adminDelay({ local: true }), 2000);
    assert.equal(60_000 / adminDelay({}), 5);
  });

  it('its structure (activities, questions, options) is read every 5 minutes, three requests, so the display stays under 6 a minute', () => {
    assert.equal(STRUCTURE_MAX_AGE_MS, 300_000);
    const perMinute = 60_000 / adminDelay({}) + 3 / 5;
    assert.ok(perMinute < 6, `${perMinute.toFixed(2)} requests a minute`);
  });

  it('it waits longer for a refresh that cost more, backs off on failure, and never answers a Retry-After early', () => {
    assert.equal(adminDelay({ requests: 4 }), 48_000);
    assert.deepEqual([1, 2, 3].map((failures) => adminDelay({ failures })), [24_000, 48_000, 96_000]);
    assert.equal(adminDelay({ failures: 20 }), POLL.maxBackoffMs);
    assert.equal(adminDelay({ retryAfterMs: 45_000 }), 45_000);
    assert.equal(adminDelay({ local: true, retryAfterMs: 9000 }), 9000);
  });

  it('a change in the activities is noticed from the feed; the questions\' own words wait for the 5-minute read', () => {
    const held = { session: { id: 's', sectionIds: ['a', 'b'] }, sections: [{ id: 'a', title: 'A', enabled: true, order: 1, questionIds: ['q1'] }, { id: 'b', title: 'B', enabled: false, order: 2, questionIds: ['q2'] }] };
    const same = { session: { id: 's', sectionIds: ['a', 'b'] }, sections: held.sections.map((section) => ({ ...section })) };
    assert.equal(structureChanged(held, same), false);
    assert.equal(structureChanged(held, { ...same, session: { id: 's', sectionIds: ['a', 'b', 'c'] } }), true, 'an activity joined the session');
    assert.equal(structureChanged(held, { ...same, sections: [{ ...held.sections[0], enabled: false }, held.sections[1]] }), true, 'an activity switched off');
    assert.equal(structureChanged(held, { ...same, sections: [{ ...held.sections[0], questionIds: ['q1', 'q3'] }, held.sections[1]] }), true, 'a question added');
    assert.equal(structureChanged(held, { ...same, sections: [{ ...held.sections[0], title: 'Renamed' }, held.sections[1]] }), true);
    assert.equal(structureChanged(held, { session: null, sections: null }), false, 'a session that is gone is not "changed"');
  });
});

describe('where the Live display is, as an address', () => {
  it('builds the hash and reads it back', () => {
    assert.equal(liveDisplayHash(), '#live-display');
    assert.equal(liveDisplayHash('kroger-2026-10-11'), '#live-display/kroger-2026-10-11');
    assert.equal(liveDisplayHash('a b/c'), '#live-display/a%20b%2Fc');
    assert.equal(liveDisplayOfHash('#live-display'), '');
    assert.equal(liveDisplayOfHash('#live-display/kroger-2026-10-11'), 'kroger-2026-10-11');
    assert.equal(liveDisplayOfHash('#live-display/a%20b%2Fc'), 'a b/c');
    for (const other of ['#today', '#results', '#print-guests', '', '#live-displayed']) assert.equal(liveDisplayOfHash(other), null, other);
  });

  it('finds admin.html in the same folder as the participant page, wherever it is hosted, and carries nothing of the participant\'s address', () => {
    const cases = [
      ['https://tenant.sharepoint.com/sites/cec/Shared%20Documents/p_cec_01/index.html#/master-results/kroger-2026-10-11', 'kroger-2026-10-11', 'https://tenant.sharepoint.com/sites/cec/Shared%20Documents/p_cec_01/admin.html#live-display/kroger-2026-10-11'],
      ['https://tenant.sharepoint.com/sites/cec/Shared%20Documents/p_cec_02/index.html?qr=SECRET&t=abc#/master-results/x', 'x', 'https://tenant.sharepoint.com/sites/cec/Shared%20Documents/p_cec_02/admin.html#live-display/x'],
      ['http://192.168.1.20:3000/#/master-results/a', 'a', 'http://192.168.1.20:3000/admin.html#live-display/a'],
      ['http://127.0.0.1:5188/p_cec_01/index.html#/master-results', '', 'http://127.0.0.1:5188/p_cec_01/admin.html#live-display'],
      ['http://localhost:3000/p_cec_01/#/master-results/a', 'a', 'http://localhost:3000/p_cec_01/admin.html#live-display/a'],
    ];
    for (const [from, sessionId, expected] of cases) assert.equal(adminAddress(from, sessionId), expected, from);
    assert.doesNotMatch(adminAddress(cases[1][0], 'x'), /SECRET|qr=|t=abc/);
  });
});

describe('the participant page keeps to those rules (read from its source, not guessed)', () => {
  it('has no timer of its own: the page watcher is the only one, and the hub no longer polls', async () => {
    const app = await readFile(path.join(ROOT, 'migration/src/App.svelte'), 'utf8');
    assert.doesNotMatch(app, /setInterval/, 'App.svelte has no interval');
    const agenda = await readFile(path.join(ROOT, 'migration/src/routes/Agenda.svelte'), 'utf8');
    assert.doesNotMatch(agenda, /setInterval|dataService/, 'the hub reads on arriving and then follows the page watcher');
    const watcher = await readFile(path.join(ROOT, 'migration/src/lib/common/page-watch.ts'), 'utf8');
    assert.doesNotMatch(watcher, /setInterval/, 'the watcher reschedules after each check, so every wait has its own jitter');
    assert.match(watcher, /window\.setTimeout/);
  });

  it('checks with ONE read (readParticipantWatch), and never reads the session, the track and AppSettings one by one', async () => {
    const app = await readFile(path.join(ROOT, 'migration/src/App.svelte'), 'utf8');
    const check = /async function checkServer\(\)[^{]*\{[\s\S]*?\n  \}\n/.exec(app)?.[0] ?? '';
    assert.match(check, /dataService\.readParticipantWatch\(/);
    assert.doesNotMatch(check, /dataService\.(getAppSettings|getClientTrack|getSession)\(/);
  });
});
