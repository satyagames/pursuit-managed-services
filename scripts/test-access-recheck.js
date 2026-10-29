// Prompt 21, Phase 6: a person turned off while the admin page is open. Run: node --test scripts/test-access-recheck.js
//
// The page reads its access once, at sign-in (lib/access/resolve.js). A Super admin may disable that person, or remove their last role, while the page is
// still open. The page reads the access again when the person opens a tab or comes back to the page, at most once every RECHECK_AFTER_MS (ASSUMED five
// minutes: so a normal visit sends no more requests than before), and when the new answer would not let them in, the page stops: every write is refused
// and No access says what happened in plain words. The site owner never loses access (decision I). Plain JS, no DOM, no request.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RECHECK_AFTER_MS, lostAccess, recheckDue, withoutGrants } from '../migration/src/lib/access/resolve.js';
import { noAccessWords } from '../migration/src/lib/access/access-words.js';
import { can } from '../migration/src/lib/access/can.js';

const NOW = new Date('2026-10-28T12:00:00Z');
const person = { key: 'x@deloitte.com', email: 'x@deloitte.com', name: 'X', loginName: '', id: 7 };
const grant = (role, more = {}) => ({ id: `x|${role}`, userKey: 'x@deloitte.com', role, scopeType: 'client', clientId: 'c-kroger', sessionId: '', extras: '', ...more });
const accessOf = (grants, user = { id: 'x@deloitte.com', status: 'Active' }, more = {}) => ({ person, owner: false, legacy: false, user, assignments: grants, ...more });

describe('A person turned off while the page is open', () => {
  it('reads the access again at most once every five minutes', () => {
    assert.equal(RECHECK_AFTER_MS, 5 * 60_000);
    const at = NOW.getTime();
    assert.equal(recheckDue(at, at + 60_000), false, 'a minute after the last read: no request');
    assert.equal(recheckDue(at, at + RECHECK_AFTER_MS), true);
  });

  it('says what was lost: disabled, or no current role; nothing while they may still enter', () => {
    assert.equal(lostAccess(accessOf([grant('Producer')]), { now: NOW }), null);
    assert.equal(lostAccess(accessOf([grant('Producer')], { id: 'x@deloitte.com', status: 'Disabled' }), { now: NOW }), 'turned-off');
    assert.equal(lostAccess(accessOf([]), { now: NOW }), 'role-removed');
    assert.equal(lostAccess(accessOf([grant('Producer', { validUntil: '2026-10-01T00:00:00Z' })]), { now: NOW }), 'role-removed', 'an end date that has passed');
    assert.equal(lostAccess(accessOf([], null), { now: NOW }), 'role-removed', 'their row has gone');
    assert.equal(lostAccess(accessOf([], { id: 'x@deloitte.com', status: 'Disabled' }, { owner: true }), { now: NOW }), null, 'the site owner is always a Super admin');
  });

  it('the stopped page refuses every write', () => {
    const stopped = withoutGrants(accessOf([grant('Producer')]));
    assert.equal(can(accessOf([grant('Producer')]), 'events.run', { clientId: 'c-kroger' }, { now: NOW }), true);
    assert.equal(can(stopped, 'events.run', { clientId: 'c-kroger' }, { now: NOW }), false);
    assert.equal(stopped.owner, false);
    assert.equal(stopped.legacy, false);
  });

  it('No access says it happened while the page was open, in plain words', () => {
    assert.deepEqual(noAccessWords('Pursuit Managed Services', 'turned-off'), {
      title: 'Your access to Pursuit Managed Services was turned off',
      line: 'This happened while the page was open, so nothing more can be changed here. What was saved before is kept. Ask a Super admin of Pursuit Managed Services if you need it again.',
    });
    assert.deepEqual(noAccessWords('Pursuit Managed Services', 'role-removed'), {
      title: 'Your access to Pursuit Managed Services has changed',
      line: 'You no longer have a role that opens this page, so nothing more can be changed here. What was saved before is kept. Ask a Super admin of Pursuit Managed Services if you need it.',
    });
    for (const reason of ['turned-off', 'role-removed']) assert.doesNotMatch(JSON.stringify(noAccessWords('PMS', reason)), /token|digest|FedAuth/i);
  });
});
