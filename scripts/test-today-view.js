// Phase 17: what the admin's Today screen works out for itself before it draws (lib/admin/today-view.js): the words of its status, its Go live
// button and its readiness line, the clients it offers, the order of its other sessions, and how a changed session joins the list. These were
// written inside AdminToday.svelte until Phase 17 moved them out unchanged; each case here is what that screen showed.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  failureText, goLiveLabel, goLiveWhy, levelCounts, otherSessionsOf, pickableClients, readinessSummary, sinceText, upsertSession,
} from '../migration/src/lib/admin/today-view.js';
import { localDate } from '../migration/src/lib/admin/admin-today.js';

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

  it('the readiness line: checking, blockers (and warnings), ready with warnings, ready', () => {
    assert.equal(readinessSummary({ inputsBusy: true, blockers: 2, warnings: 1 }), 'Checking...');
    assert.equal(readinessSummary({ inputsBusy: false, blockers: 1, warnings: 0 }), '1 blocker');
    assert.equal(readinessSummary({ inputsBusy: false, blockers: 2, warnings: 1 }), '2 blockers, 1 warning');
    assert.equal(readinessSummary({ inputsBusy: false, blockers: 3, warnings: 2 }), '3 blockers, 2 warnings');
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
