// Phase 16, Part 1: the order of Admin → Results. Sessions newest first (by date, then by their latest visit, then by the later item of the
// list), the iPads of a session newest joiner first, and a refresh that never moves a card already on the screen. Plain functions of
// migration/src/lib/admin/admin-results.js, so the rule is held here and the screen only applies it. The leader report, the CSVs, the Live
// display and the oracle do not use it: their order is checked below to be what it was. Run: node --test scripts/test-admin-results.js.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ROW_ORDER, SESSION_ORDER, keepShownOrder, newestFirst, rowsInOrder } from '../migration/src/lib/admin/admin-results.js';

const ROOT = path.join(import.meta.dirname, '..');
/** A session's results, as getSessionResults() gives them, with only what the order reads. */
const result = (id, date, joined = []) => ({ session: { id, clientId: 'c', ...(date === undefined ? {} : { date }) }, tracks: joined.map((at, index) => ({ id: `${id}-t${index}`, createdAt: at })), sections: [] });
const ids = (list) => list.map((entry) => entry.session.id);

describe('Results: sessions newest first (Phase 16)', () => {
  it('orders by session date, newest first', () => {
    const list = [result('kroger-2026-10-01', '2026-10-01'), result('dominos-2026-10-15', '2026-10-15'), result('acme-2026-10-09', '2026-10-09')];
    assert.deepEqual(ids(newestFirst(list)), ['dominos-2026-10-15', 'acme-2026-10-09', 'kroger-2026-10-01']);
  });

  it('breaks a tie on the date by the most recent visit in the session', () => {
    const list = [
      result('dominos-2026-10-15', '2026-10-15', ['2026-10-15T09:00:00.000Z', '2026-10-15T09:20:00.000Z']),
      result('kroger-2026-10-15', '2026-10-15', ['2026-10-15T08:00:00.000Z', '2026-10-15T10:05:00.000Z']),
    ];
    assert.deepEqual(ids(newestFirst(list)), ['kroger-2026-10-15', 'dominos-2026-10-15'], 'the screenshot: Kroger had the later visit');
  });

  it('then by the later item of the list (the newer one), when the visits do not tell them apart', () => {
    const list = [result('a-2026-10-15', '2026-10-15'), result('b-2026-10-15', '2026-10-15'), result('c-2026-10-15', '2026-10-15')];
    assert.deepEqual(ids(newestFirst(list)), ['c-2026-10-15', 'b-2026-10-15', 'a-2026-10-15']);
    const visited = [result('x', '2026-10-15', ['2026-10-15T09:00:00.000Z']), result('y', '2026-10-15', ['2026-10-15T09:00:00.000Z'])];
    assert.deepEqual(ids(newestFirst(visited)), ['y', 'x']);
  });

  it('a session with a visit comes before one with none on the same day', () => {
    assert.deepEqual(ids(newestFirst([result('empty', '2026-10-15'), result('used', '2026-10-15', ['2026-10-15T08:00:00.000Z'])].reverse())), ['used', 'empty']);
    assert.deepEqual(ids(newestFirst([result('used', '2026-10-15', ['2026-10-15T08:00:00.000Z']), result('empty', '2026-10-15')])), ['used', 'empty']);
  });

  it('puts a missing or unreadable date last, and never throws', () => {
    const list = [result('none', undefined), result('bad', 'next week'), result('null', null), result('ok', '2026-10-02'), result('empty', ''), result('nonsense', '2026-13-45')];
    const order = ids(newestFirst(list));
    assert.equal(order[0], 'ok');
    assert.deepEqual(order.slice(1).sort(), ['bad', 'empty', 'none', 'nonsense', 'null']);
    assert.deepEqual(order.slice(1), ['nonsense', 'empty', 'null', 'bad', 'none'], 'among themselves: the later item first');
    assert.doesNotThrow(() => newestFirst([{ session: {} }, { session: { date: 42 } }, { session: { date: '2026-10-01' }, tracks: [{ createdAt: 'garbage' }, {}] }]));
  });

  it('compares dates as dates, not as words in a locale (a date with a time is its day)', () => {
    const list = [result('later', '2026-10-15T00:00:00.000Z'), result('earlier', '2026-09-30'), result('ten', '2026-10-10')];
    assert.deepEqual(ids(newestFirst(list)), ['later', 'ten', 'earlier']);
  });

  it('is stable and does not change the list it is given', () => {
    const list = [result('a', '2026-10-01'), result('b', '2026-10-03'), result('c', '2026-10-02')];
    const copy = structuredClone(list);
    const sorted = newestFirst(list);
    assert.notEqual(sorted, list);
    assert.deepEqual(list, copy, 'the input is unchanged');
    assert.deepEqual(ids(newestFirst(sorted)), ids(sorted), 'sorting the sorted list changes nothing');
  });

  it('sorts cards through what they hold: a card is ordered by its results', () => {
    const cards = [{ results: result('a', '2026-10-01') }, { results: result('b', '2026-10-05') }];
    assert.deepEqual(newestFirst(cards, (card) => card.results).map((card) => card.results.session.id), ['b', 'a']);
  });

  it('says its order in one named place', () => {
    assert.equal(SESSION_ORDER, 'newest-first');
  });
});

describe('Results: a refresh never moves a card that is on the screen (Phase 16)', () => {
  const card = (id, date, joined) => ({ results: result(id, date, joined) });
  const of = (entry) => entry.results;
  const cardIds = (list) => list.map((entry) => entry.results.session.id);

  it('keeps the cards shown in their place, even when a new visit would now sort them differently', () => {
    const shown = newestFirst([card('dominos', '2026-10-15', ['2026-10-15T09:00:00.000Z']), card('kroger', '2026-10-15', ['2026-10-15T08:00:00.000Z']), card('acme', '2026-10-01')], of);
    assert.deepEqual(cardIds(shown), ['dominos', 'kroger', 'acme']);
    // Somebody joins Kroger: sorted afresh it would jump above Domino's.
    const fresh = newestFirst([card('dominos', '2026-10-15', ['2026-10-15T09:00:00.000Z']), card('kroger', '2026-10-15', ['2026-10-15T08:00:00.000Z', '2026-10-15T09:30:00.000Z']), card('acme', '2026-10-01')], of);
    assert.deepEqual(cardIds(fresh), ['kroger', 'dominos', 'acme']);
    assert.deepEqual(cardIds(keepShownOrder(cardIds(shown), fresh, of)), ['dominos', 'kroger', 'acme']);
  });

  it('puts a session that newly appears at its sorted place, and drops one that has gone', () => {
    const shown = ['b-2026-10-10', 'a-2026-10-01'];
    const fresh = newestFirst([card('a-2026-10-01', '2026-10-01'), card('c-2026-10-20', '2026-10-20'), card('m-2026-10-05', '2026-10-05')], of);
    assert.deepEqual(cardIds(keepShownOrder(shown, fresh, of)), ['c-2026-10-20', 'm-2026-10-05', 'a-2026-10-01']);
  });

  it('with nothing shown yet it is the sorted order, and it does not change its input', () => {
    const fresh = newestFirst([card('a', '2026-10-01'), card('b', '2026-10-02')], of);
    const copy = structuredClone(fresh);
    assert.deepEqual(cardIds(keepShownOrder([], fresh, of)), ['b', 'a']);
    assert.deepEqual(fresh, copy);
  });
});

describe('Results: the iPads of a session, newest joiner first (Phase 16)', () => {
  const row = (id, createdAt) => ({ track: { id, ...(createdAt === undefined ? {} : { createdAt }) }, name: id });

  it('puts the latest joiner at the top, by the time each joined', () => {
    const rows = [row('first', '2026-10-15T09:00:00.000Z'), row('second', '2026-10-15T09:05:00.000Z'), row('third', '2026-10-15T09:01:00.000Z')];
    assert.deepEqual(rowsInOrder(rows).map((entry) => entry.name), ['second', 'third', 'first']);
  });

  it('a tie, or a missing time, keeps them newest first by the order they joined in (the later row first); never throws', () => {
    const rows = [row('a', '2026-10-15T09:00:00.000Z'), row('b', '2026-10-15T09:00:00.000Z'), row('c'), row('d', 'later')];
    assert.deepEqual(rowsInOrder(rows).map((entry) => entry.name), ['b', 'a', 'd', 'c']);
  });

  it('is one constant to flip back to join order, and does not change its input', () => {
    assert.equal(ROW_ORDER, 'newest-first');
    const rows = [row('a', '2026-10-15T09:00:00.000Z'), row('b', '2026-10-15T09:05:00.000Z')];
    const copy = structuredClone(rows);
    assert.deepEqual(rowsInOrder(rows, 'join-order').map((entry) => entry.name), ['a', 'b']);
    rowsInOrder(rows);
    assert.deepEqual(rows, copy);
  });
});

describe('Results order stays on Results (Phase 16)', () => {
  it('the leader report, the CSVs, the Live display and the oracle do not use it', async () => {
    const files = [
      'migration/src/lib/exports/leader-report.js', 'migration/src/lib/exports/leader-report-data.js', 'migration/src/lib/exports/resultsExport.js',
      'migration/src/lib/results/export-summary.js', 'migration/src/lib/results/results-chart-model.js', 'migration/src/lib/results/results-tally.js',
      'migration/src/admin/LiveDisplay.svelte', 'scripts/oracle-results.js',
    ];
    for (const file of files) {
      const source = await readFile(path.join(ROOT, file), 'utf8');
      assert.doesNotMatch(source, /newestFirst|rowsInOrder|keepShownOrder/, `${file} keeps its own order`);
    }
  });

  it('the screen applies the order where it builds its cards and its rows', async () => {
    const screen = await readFile(path.join(ROOT, 'migration/src/admin/AdminResults.svelte'), 'utf8');
    assert.match(screen, /newestFirst\(/);
    assert.match(screen, /keepShownOrder\(/);
    assert.match(screen, /rowsInOrder\(/);
  });
});
