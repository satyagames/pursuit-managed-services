// Prompt 38: the admin's smart defaults (migration/src/lib/admin/admin-defaults.js), each pre-filled and always editable: a new session's name, date and
// start time; the QR sheet's page; what was last chosen, remembered per signed-in person in this browser (and nothing breaks when storage throws);
// and each role's one line (lib/access/access-matrix.js ROLE_SUMMARY), said from the matrix's cells.
// Run: node --test scripts/test-admin-defaults.js (also part of npm test)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, nextFreeDate, pageSizeFor, prefsKeyOf, recall, remember, sessionNameFor,
} from '../migration/src/lib/admin/admin-defaults.js';
import { MATRIX, ROLES, ROLE_SUMMARY } from '../migration/src/lib/access/access-matrix.js';

/** A Storage stand-in. */
const store = () => {
  const map = new Map();
  return { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), map };
};
const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };

describe('smart defaults (Prompt 38)', () => {
  it('the brief\'s defaults, in one place', () => {
    assert.deepEqual(DEFAULTS, {
      identification: 'client-visit', flow: 'sequential', confidence: false, questionType: 'single', answers: 4, layout: 'list',
      role: 'Producer', exportFormat: 'pdf', perPage: 6, resultsSort: 'newest', leadershipFilter: 'latest', startTime: '09:00',
    });
  });

  it('a new session is named "{Client} · {date}"', () => {
    assert.equal(sessionNameFor('Kroger', '2026-11-12'), 'Kroger · 12 Nov 2026');
    assert.equal(sessionNameFor('  Kroger  ', ''), 'Kroger');
  });

  it('the date is the next day from today the client has no session on', () => {
    const sessions = [{ clientId: 'c1', date: '2026-11-08' }, { clientId: 'c1', date: '2026-11-09' }, { clientId: 'c2', date: '2026-11-10' }];
    assert.equal(nextFreeDate(sessions, 'c1', '2026-11-08'), '2026-11-10');
    assert.equal(nextFreeDate(sessions, 'c2', '2026-11-08'), '2026-11-08');
    assert.equal(nextFreeDate([], 'c1', '2026-12-31'), '2026-12-31');
    assert.equal(nextFreeDate([{ clientId: 'c1', date: '2026-12-31' }], 'c1', '2026-12-31'), '2027-01-01');
  });

  it('the QR sheet is A4, or US Letter where Letter is the paper', () => {
    for (const locale of ['en-GB', 'en-IN', 'de-DE', 'fr-FR', 'en-AU', '']) assert.equal(pageSizeFor(locale), 'A4', locale);
    for (const locale of ['en-US', 'en-CA', 'es-MX', 'fr-CA', 'en-PH']) assert.equal(pageSizeFor(locale), 'Letter', locale);
  });

  it('a last choice is remembered per person, read back, and the default stands when there is none or storage fails', () => {
    const storage = store();
    const key = prefsKeyOf({ key: 'u-1', email: 'jordan@example.com' });
    assert.match(key, /^pms\.prefs\.[0-9a-z]+$/);
    assert.doesNotMatch(key, /jordan|example/, 'never the email itself');
    assert.notEqual(prefsKeyOf({ key: 'u-2' }), key);
    assert.equal(recall(storage, key, 'exportFormat'), 'pdf');
    remember(storage, key, 'exportFormat', 'pptx');
    assert.equal(recall(storage, key, 'exportFormat'), 'pptx');
    assert.equal(recall(storage, prefsKeyOf({ key: 'u-2' }), 'exportFormat'), 'pdf', 'another person keeps the default');
    assert.equal(recall(broken, key, 'exportFormat'), 'pdf');
    assert.doesNotThrow(() => remember(broken, key, 'exportFormat', 'csv'));
    assert.equal(recall(null, key, 'perPage'), 6);
    storage.setItem(key, '{not json');
    assert.equal(recall(storage, key, 'exportFormat'), 'pdf', 'a spoiled entry is ignored');
  });

  it('each role has one line, and each line says what the matrix allows', () => {
    assert.deepEqual(Object.keys(ROLE_SUMMARY), [...ROLES]);
    const yes = (action, role) => MATRIX[action][role] === 'yes';
    assert.ok(yes('results.delete', 'Super admin') && /deleting results/.test(ROLE_SUMMARY['Super admin']));
    assert.ok(yes('clients.manage', 'Admin') && MATRIX['users.manage'].Admin === 'option' && /may also add people/.test(ROLE_SUMMARY.Admin));
    assert.ok(yes('events.run', 'Producer') && yes('guests.manage', 'Producer') && /sessions, guests, QR codes/.test(ROLE_SUMMARY.Producer));
    assert.ok(yes('brand.edit', 'Designer') && MATRIX['content.edit'].Designer === 'option' && /may also edit activities/.test(ROLE_SUMMARY.Designer));
    assert.ok(yes('results.view', 'Leadership') && !yes('content.edit', 'Leadership') && /Results/.test(ROLE_SUMMARY.Leadership));
  });
});
