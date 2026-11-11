// Phase 17: what the admin's Today screen works out for itself before it draws (lib/admin/today-view.js): the words of its status, its Go live
// button and its readiness line, the clients it offers, the order of its other sessions, and how a changed session joins the list. These were
// written inside AdminToday.svelte until Phase 17 moved them out unchanged; each case here is what that screen showed.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  failureText, goLiveLabel, goLiveWhy, levelCounts, otherSessionsOf, pickableClients, readinessSummary, settingsChips, sinceText, staffNotice, upsertSession,
} from '../migration/src/lib/admin/today-view.js';
import { STAFF_MODE_WARNING, localDate } from '../migration/src/lib/admin/admin-today.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe("the admin's Today screen, worked out before it draws (Phase 17)", () => {
  it('"Live since": a time today, a date and time on another day, "not recorded" when there is none or it cannot be read', () => {
    const now = new Date(2026, 9, 22, 9, 5);
    const today = localDate(now);
    assert.equal(sinceText(now.toISOString(), today), now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    const earlier = new Date(2026, 9, 20, 14, 30);
    assert.equal(sinceText(earlier.toISOString(), today), earlier.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
    assert.equal(sinceText(null, today), 'not recorded');
    assert.equal(sinceText('not a date', today), 'not recorded');
  });

  it('Prompt 43: the three settings are three chips, icon first then a short word, for all eight combinations; an unset mode is staff sign-in', () => {
    assert.deepEqual(settingsChips(null), []);
    const words = (session) => settingsChips(session).map((chip) => `${chip.icon} ${chip.text}`);
    assert.deepEqual(words({}), ['badge Staff sign in', 'steps Sequential', 'gauge Confidence off']);
    const table = [
      ['staff', 'sequential', false, ['badge Staff sign in', 'steps Sequential', 'gauge Confidence off']],
      ['staff', 'sequential', true, ['badge Staff sign in', 'steps Sequential', 'gauge Confidence on']],
      ['staff', 'open', false, ['badge Staff sign in', 'grid Open', 'gauge Confidence off']],
      ['staff', 'open', true, ['badge Staff sign in', 'grid Open', 'gauge Confidence on']],
      ['client-visit', 'sequential', false, ['qr Guests scan QR', 'steps Sequential', 'gauge Confidence off']],
      ['client-visit', 'sequential', true, ['qr Guests scan QR', 'steps Sequential', 'gauge Confidence on']],
      ['client-visit', 'open', false, ['qr Guests scan QR', 'grid Open', 'gauge Confidence off']],
      ['client-visit', 'open', true, ['qr Guests scan QR', 'grid Open', 'gauge Confidence on']],
    ];
    for (const [participationMode, activityFlow, confidenceCheck, expected] of table) {
      const chips = settingsChips({ participationMode, activityFlow, confidenceCheck });
      assert.deepEqual(chips.map((chip) => `${chip.icon} ${chip.text}`), expected, `${participationMode} ${activityFlow} ${confidenceCheck}`);
      assert.deepEqual(chips.map((chip) => chip.group), ['mode', 'flow', 'check'], 'one chip per group, in the order of the panel');
    }
  });

  it('Prompt 43: a chip changed from the default (staff sign-in, sequential, confidence off) is marked, so a leader sees what is non-standard', () => {
    const changed = (session) => settingsChips(session).map((chip) => chip.changed);
    assert.deepEqual(changed({}), [false, false, false]);
    assert.deepEqual(changed({ participationMode: 'staff', activityFlow: 'sequential', confidenceCheck: false }), [false, false, false]);
    assert.deepEqual(changed({ participationMode: 'client-visit', activityFlow: 'sequential', confidenceCheck: false }), [true, false, false]);
    assert.deepEqual(changed({ participationMode: 'staff', activityFlow: 'open', confidenceCheck: false }), [false, true, false]);
    assert.deepEqual(changed({ participationMode: 'staff', activityFlow: 'sequential', confidenceCheck: true }), [false, false, true]);
    assert.deepEqual(changed({ participationMode: 'client-visit', activityFlow: 'open', confidenceCheck: true }), [true, true, true]);
  });

  it('Prompt 43: the staff-mode notice only while Staff sign in is chosen (and the session has not ended); the Identification chip carries it as a marker', () => {
    assert.equal(staffNotice(null), '');
    assert.equal(staffNotice({}), STAFF_MODE_WARNING);
    assert.equal(staffNotice({ participationMode: 'staff' }), STAFF_MODE_WARNING);
    assert.equal(staffNotice({ participationMode: 'client-visit' }), '');
    assert.equal(staffNotice({ participationMode: 'staff', status: 'completed' }), '');
    assert.equal(settingsChips({ participationMode: 'staff' })[0].warning, STAFF_MODE_WARNING);
    assert.equal(settingsChips({ participationMode: 'client-visit' })[0].warning, '');
    assert.ok(settingsChips({}).slice(1).every((chip) => chip.warning === ''), 'only the Identification chip carries it');
  });

  it('Prompt 43: without events.run for the session shown, the chips are not buttons and there is no toggle or panel; the toggle never says Done', async () => {
    const read = (file) => readFile(path.join(ROOT, 'migration/src/admin', file), 'utf8');
    const [controls, today] = await Promise.all([read('TodayControls.svelte'), read('AdminToday.svelte')]);
    assert.match(today, /mayChange=\{!access \|\| can\(access, 'events\.run', \{ clientId: controlSession\?\.clientId \}\)\}/, 'AdminToday asks can() for the session shown');
    const markup = controls.slice(controls.indexOf('</script>'), controls.indexOf('<style>'));
    const chipsAt = markup.indexOf('{#each chips as chip');
    const chipBlock = markup.slice(chipsAt, markup.indexOf('{/each}', chipsAt));
    assert.match(chipBlock, /this=\{mayChange \? 'button' : 'span'\}/, 'a button only when the person may change it, else a plain chip');
    assert.match(controls, /button\.chip \{[^}]*cursor: pointer/, 'the pointer and the hover only on a chip that is a button');
    assert.match(chipBlock, /onclick=\{mayChange \? /, 'a plain chip opens nothing');
    assert.equal((markup.match(/\{#if mayChange\}/g) ?? []).length, 2, 'the toggle and the panel each behind mayChange');
    assert.ok(!/>\s*Done\s*</.test(markup) && !/'Done'/.test(controls), 'no Done in the card');
    assert.match(markup, />Change<\/span><span[^>]*>Hide<\/span>/, 'both words, one shown');
  });

  it('the readiness line: checking, blockers (and warnings), ready with warnings, ready', () => {
    assert.equal(readinessSummary({ inputsBusy: true, blockers: 2, warnings: 1 }), 'Checking...');
    assert.equal(readinessSummary({ inputsBusy: false, blockers: 1, warnings: 0 }), '1 thing to fix');
    assert.equal(readinessSummary({ inputsBusy: false, blockers: 2, warnings: 1 }), '2 things to fix, 1 warning');
    assert.equal(readinessSummary({ inputsBusy: false, blockers: 3, warnings: 2 }), '3 things to fix, 2 warnings');
    assert.equal(readinessSummary({ inputsBusy: false, blockers: 0, warnings: 1 }), 'Ready to go live, with 1 warning');
    assert.equal(readinessSummary({ inputsBusy: false, blockers: 0, warnings: 4 }), 'Ready to go live, with 4 warnings');
    assert.equal(readinessSummary({ inputsBusy: false, blockers: 0, warnings: 0 }), 'Ready to go live');
  });

  it('the counts of blockers and warnings among the rows', () => {
    assert.deepEqual(levelCounts([{ level: 'blocker' }, { level: 'warning' }, { level: 'blocker' }, { level: 'pass' }]), { blockers: 2, warnings: 1 });
    assert.deepEqual(levelCounts([]), { blockers: 0, warnings: 0 });
  });

  it('why Go live is off: nothing before loading, then client, date, checking, the first blocker, already live; nothing when it can go', () => {
    const base = { loaded: true, client: { name: 'Kroger' }, dateValid: true, inputsBusy: false, blockers: 0, reason: null, alreadyLive: false, date: '2026-10-22' };
    assert.equal(goLiveWhy({ ...base, loaded: false }), '');
    assert.equal(goLiveWhy({ ...base, client: null }), 'Add a client first.');
    assert.equal(goLiveWhy({ ...base, dateValid: false }), 'Choose a date.');
    assert.equal(goLiveWhy({ ...base, inputsBusy: true }), 'Checking that everything is ready...');
    assert.equal(goLiveWhy({ ...base, blockers: 1, reason: 'Kroger has no activity switched on.' }), 'Kroger has no activity switched on.');
    assert.equal(goLiveWhy({ ...base, blockers: 1, reason: null }), '');
    assert.equal(goLiveWhy({ ...base, alreadyLive: true }), 'Kroger is already live for 2026-10-22.');
    assert.equal(goLiveWhy(base), '');
  });

  it("the Go live button's words", () => {
    assert.equal(goLiveLabel({ goingLive: true, checking: true, alreadyLive: true }), 'Going live...');
    assert.equal(goLiveLabel({ goingLive: false, checking: true, alreadyLive: true }), 'Checking...');
    assert.equal(goLiveLabel({ goingLive: false, checking: false, alreadyLive: true }), 'Already live');
    assert.equal(goLiveLabel({ goingLive: false, checking: false, alreadyLive: false }), 'Go live');
  });

  it('the clients offered: not archived (but the picked one is kept), by name', () => {
    const clients = [{ id: 'b', name: 'Beta' }, { id: 'a', name: 'alpha' }, { id: 'z', name: 'Zed', status: 'archived' }, { id: 'y', name: 'Yonder', status: 'archived' }];
    assert.deepEqual(pickableClients(clients, '').map((entry) => entry.id), ['a', 'b']);
    assert.deepEqual(pickableClients(clients, 'z').map((entry) => entry.id), ['a', 'b', 'z']);
    assert.equal(clients[0].id, 'b', 'the list it was given is not reordered');
  });

  it('the other sessions: newest date first, then the later id; the live one left out only while it is live', () => {
    const sessions = [{ id: 's1', date: '2026-10-20' }, { id: 's3', date: '2026-10-22' }, { id: 's2', date: '2026-10-22' }, { id: 's0' }];
    assert.deepEqual(otherSessionsOf(sessions, 's3', true).map((s) => s.id), ['s2', 's1', 's0']);
    assert.deepEqual(otherSessionsOf(sessions, 's3', false).map((s) => s.id), ['s3', 's2', 's1', 's0']);
    assert.deepEqual(otherSessionsOf(sessions, null, true).map((s) => s.id), ['s3', 's2', 's1', 's0']);
    assert.equal(sessions[0].id, 's1', 'the list it was given is not reordered');
  });

  it('a changed session replaces its own entry (its fields merged), and a new one is added at the end', () => {
    const list = [{ id: 'a', status: 'not-started', date: 'x' }, { id: 'b' }];
    assert.deepEqual(upsertSession(list, { id: 'a', status: 'in-progress' }), [{ id: 'a', status: 'in-progress', date: 'x' }, { id: 'b' }]);
    assert.deepEqual(upsertSession(list, { id: 'c' }), [...list, { id: 'c' }]);
    assert.deepEqual(list[0], { id: 'a', status: 'not-started', date: 'x' }, 'and the list it was given is not changed');
  });

  it("what a failure says: the error's own words, else the screen's", () => {
    assert.equal(failureText(new Error('SharePoint (403): Access denied.'), 'Could not go live.'), 'SharePoint (403): Access denied.');
    assert.equal(failureText('a string', 'Could not go live.'), 'Could not go live.');
    assert.equal(failureText(undefined, 'Could not refresh.'), 'Could not refresh.');
  });
});
