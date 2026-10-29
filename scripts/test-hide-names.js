// Prompt 21, Phase 6: the Hide names switch (decision B) in every Results surface and export. Run: node --test scripts/test-hide-names.js
//
// The dashboard hid names since Phase 5 (scripts/test-leader-dashboard.js). This holds the rest to the same words: with names hidden, every person of a
// session is "Guest 1", "Guest 2" ..., numbered in the order they joined (the order of lib/results/participant-names.js), on Results' Sessions view (the
// rows and each chart's names), in the leader report (its pages, comments and notes) and in the participant CSV. No recorded name is left anywhere.
// With the switch off, everything is as it was. The fixture is the leader report's Harbour session (scripts/leader-report-fixtures.js): seven visits, a
// guest named from the QR code, staff from the visit log, a guest from the roster, two with no name, and the same guest twice.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HARBOUR_PEOPLE, harbourRecords } from './leader-report-fixtures.js';
import { NAMES_HIDDEN_NOTE, buildLeaderReport, participantAnswersCsv } from '../migration/src/lib/exports/leader-report.js';
import { nameParticipants, withNamesHidden } from '../migration/src/lib/results/participant-names.js';
import { namesFor } from '../migration/src/lib/results/results-chart-model.js';
import { resultRows } from '../migration/src/lib/admin/admin-results.js';
import { makeReport } from './leader-report-node.js';
import { inspectPdf, squash } from './pdf-inspect.js';

const OPTIONS = { generatedAt: '2026-10-12T09:30:00.000Z', timeZone: 'UTC' };
const REAL = ['José Álvarez', 'Zoë Brontë', 'Søren Kjær', 'Łukasz Żółć'];
const GUESTS = ['Guest 1', 'Guest 2', 'Guest 3', 'Guest 4', 'Guest 5', 'Guest 6', 'Guest 7'];

describe('Hide names: one rule, "Guest N" in the order they joined', () => {
  it('withNamesHidden numbers everyone, named or not, and keeps who is who', () => {
    const people = nameParticipants(harbourRecords());
    const hidden = withNamesHidden(people);
    assert.deepEqual(hidden.map((person) => person.name), GUESTS);
    assert.deepEqual(hidden.map((person) => person.key), people.map((person) => person.key), 'the same people, in the same order');
    assert.ok(hidden.every((person) => person.unnamed === false), 'a hidden list does not tell who had no name');
    assert.deepEqual(people.map((person) => person.name).slice(0, 2), ['José Álvarez', 'Zoë Brontë'], 'the list given is not changed');
  });

  it('the names on the charts (namesFor) follow the switch', () => {
    const records = harbourRecords();
    const shown = namesFor({ tracks: records.tracks, answers: records.answers, visits: records.visits, roster: records.roster }, { hide: true });
    assert.deepEqual([...shown.values()], GUESTS);
    const open = namesFor({ tracks: records.tracks, answers: records.answers, visits: records.visits, roster: records.roster });
    assert.equal(open.get('t-jose'), 'José Álvarez', 'off, the names are as before');
  });

  it('the rows of Results (resultRows) follow the switch', () => {
    const records = harbourRecords();
    const result = { session: records.session, tracks: records.tracks, sections: [], unreadable: [] };
    const rows = resultRows(result, { visits: records.visits, roster: records.roster }, { hide: true });
    assert.deepEqual(rows.map((row) => row.name), GUESTS);
    assert.equal(resultRows(result, { visits: records.visits, roster: records.roster })[0].name, 'José Álvarez');
  });
});

describe('Hide names: the leader report and its CSV', () => {
  const hidden = () => buildLeaderReport(harbourRecords(), { ...OPTIONS, hideNames: true });

  it('names every participant Guest N and says so in the notes', () => {
    const report = hidden();
    assert.deepEqual(report.participants.map((person) => person.name), GUESTS);
    assert.ok(report.notes.includes(NAMES_HIDDEN_NOTE));
    assert.equal(NAMES_HIDDEN_NOTE, 'Names are hidden: each person is shown as Guest 1, Guest 2 … in the order they joined.');
    assert.equal(report.meta.namesHidden, true);
  });

  it('names the comments and the answers to removed questions the same way', () => {
    const report = hidden();
    const commenters = report.comments.flatMap((question) => question.entries.map((entry) => entry.name));
    assert.ok(commenters.length > 0);
    assert.ok(commenters.every((name) => GUESTS.includes(name)), commenters.join(', '));
    const strays = report.strays.flatMap((stray) => stray.entries.map((entry) => entry.name));
    assert.ok(strays.every((name) => GUESTS.includes(name)), strays.join(', '));
  });

  it('leaves no recorded name in the report or the participant CSV', () => {
    const report = hidden();
    const text = JSON.stringify({ ...report, at: null });
    const csv = participantAnswersCsv(report);
    for (const name of REAL) {
      assert.ok(!text.includes(name), `the report holds ${name}`);
      assert.ok(!csv.includes(name), `the CSV holds ${name}`);
    }
    assert.match(csv, /Guest 1/);
  });

  it('the PDF holds no recorded name, and its written answers say how people are shown', async () => {
    const { bytes } = await makeReport(harbourRecords(), { hideNames: true });
    const text = squash((await inspectPdf(bytes)).pages.map((sheet) => sheet.text).join(' '));
    // (The counting rules, a fixed page, still explain "Unnamed participant 1, 2 ...": that names nobody.)
    for (const name of REAL) assert.ok(!text.includes(squash(name)), `the PDF holds ${name}`);
    assert.ok(text.includes(squash('Every written answer, word for word, with the person who wrote it as Guest 1, Guest 2 … (names are hidden).')));
    assert.ok(text.includes(squash(NAMES_HIDDEN_NOTE)));
  });

  it('with the switch off the report is as it was', () => {
    const report = buildLeaderReport(harbourRecords(), OPTIONS);
    assert.equal(report.participants[0].name, HARBOUR_PEOPLE[0].name);
    assert.ok(!report.notes.includes(NAMES_HIDDEN_NOTE));
    assert.equal(report.meta.namesHidden, false);
  });
});
