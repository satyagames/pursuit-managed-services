// An Art of the Possible question's numbers (Prompt 23): the ONLY place its formulas live. Results, the Live display, the exports, the summary and the dashboard
// all call this; none has a copy. Plain JS with JSDoc and no DOM, in the style of index-math.js (scripts/test-aop-math.js; scripts/oracle-results.js recounts them).
//
// For each row (a sub-process, with its people in scope) and criterion, over the guests' first answers (as the leader report counts):
//   n, counts { 1, 2, 3 }, mean            the ratings of that cell (Low 1, Medium 2, High 3)
//   aligned                                mean for a criterion that `favours`, 4 - mean for one `against`, left out for `none`
//   opportunity                            ((mean of aligned over the scored criteria) - 1) / 2 x 100
//   band                                   High when opportunity >= 200/3, Low when < 100/3, else Medium: on the unrounded number
//   agreement                              the mean over the scored criteria of (the largest count / n); `split` when it is under 60% (ASSUMED)
// Totals: fteInScope (the people of rows with at least one rating), fteHigh (of rows in the High band), shareHigh = fteHigh / fteInScope (null when 0), respondents.
//
// Worked by hand (the tests hold it). Criteria: Volume (favours), Compliance (against), Standardisation (favours). Three guests.
//   Row A (20 people): Volume H,H,M; Compliance L,M,L; Standardisation H,M,H. Means 2.667, 1.333, 2.667; aligned 2.667, 2.667, 2.667; opportunity 83.33, High;
//     agreement (2/3 + 2/3 + 2/3) / 3 = 66.7%.
//   Row B (10 people): Volume L,L,M; Compliance H,H,H; Standardisation M,L,M. Means 1.333, 3.000, 1.667; aligned 1.333, 1.000, 1.667; mean 1.3333; opportunity 16.67,
//     Low; agreement (2/3 + 3/3 + 2/3) / 3 = 77.8%.
//   Totals: fteInScope 30, fteHigh 20, shareHigh 66.7% (shown 67%).
//
// A cell counts its FIRST rating. A guest's first answer can only hold the rows and criteria the question had then, so a box it left empty (a row added since, which
// the guest was asked again) takes what their later answer gave it; a guest who never came back is not counted for it. ASSUMED: first answers only, as the brief says,
// so a guest who changes a rating they sent does not move the numbers. A criterion or row that was removed is never counted (`dropped` says how many ratings that was).

import { decodeAnswer } from '../participant/aop-answer.js';

/** High from here, on the unrounded opportunity. */
export const BAND_HIGH = 200 / 3;
/** Low under this. */
export const BAND_LOW = 100 / 3;
/** Agreement under this is a split (ASSUMED). */
export const SPLIT_UNDER = 0.6;
const EPSILON = 1e-9;

/** A row's people: its option's value as a number, blank or anything else 0. @param {unknown} value */
export const peopleOf = (value) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : 0; };

/** The band of an opportunity, on the unrounded number. @param {number | null} opportunity @returns {'High' | 'Medium' | 'Low' | null} */
export const bandOf = (opportunity) => (opportunity === null ? null : opportunity >= BAND_HIGH - EPSILON ? 'High' : opportunity < BAND_LOW - EPSILON ? 'Low' : 'Medium');

const mean = (values) => (values.length ? values.reduce((total, value) => total + value, 0) / values.length : null);

/**
 * A guest's cells as they count: the first answer's, then what the later answer gives the boxes it left empty.
 * @param {{ answer?: unknown, firstAnswer?: unknown }} response @param {{ rows: { id: string }[], criteria: { id: string }[] }} shape
 */
export function countedGrid(response, shape) {
  const first = decodeAnswer(response.firstAnswer === undefined ? response.answer : response.firstAnswer, shape);
  const later = decodeAnswer(response.answer, shape);
  const grid = structuredClone(first.grid);
  for (const [rowId, cells] of Object.entries(later.grid)) for (const [criterionId, level] of Object.entries(cells)) (grid[rowId] ??= {})[criterionId] ??= level;
  return { grid, dropped: first.dropped };
}

/**
 * Every number of a question.
 * @param {{ rows: { id: string, label?: string, value?: unknown }[], criteria: { id: string, label?: string, hint?: string, direction?: string }[], answers: { clientTrackId?: string | null, answer?: unknown, firstAnswer?: unknown }[] }} input
 */
export function aopResults({ rows, criteria, answers }) {
  const shape = { rows, criteria };
  let dropped = 0;
  const grids = answers.map((response) => { const counted = countedGrid(response, shape); dropped += counted.dropped; return { response, grid: counted.grid }; });
  const shown = rows.map((row, order) => {
    const cells = criteria.map((criterion) => {
      const levels = grids.map(({ grid }) => grid[row.id]?.[criterion.id]).filter((level) => level !== undefined);
      const counts = { 1: 0, 2: 0, 3: 0 };
      for (const level of levels) counts[level] += 1;
      const average = mean(levels);
      const aligned = average === null || criterion.direction === 'none' ? undefined : criterion.direction === 'against' ? 4 - average : average;
      return { id: criterion.id, label: criterion.label ?? '', direction: criterion.direction ?? 'none', n: levels.length, counts, mean: average, ...(aligned === undefined ? {} : { aligned }) };
    });
    const scored = cells.filter((cell) => cell.aligned !== undefined);
    const n = grids.filter(({ grid }) => Object.keys(grid[row.id] ?? {}).length > 0).length;
    const opportunity = scored.length ? ((mean(scored.map((cell) => cell.aligned)) - 1) / 2) * 100 : null;
    const agreement = scored.length ? mean(scored.map((cell) => Math.max(cell.counts[1], cell.counts[2], cell.counts[3]) / cell.n)) : null;
    return {
      id: row.id, label: row.label ?? '', people: peopleOf(row.value), order, n, inScope: n > 0, single: n === 1, criteria: cells, opportunity, band: bandOf(opportunity),
      agreement, split: agreement !== null && agreement < SPLIT_UNDER - EPSILON,
    };
  });
  const inScope = shown.filter((row) => row.inScope);
  const fteInScope = inScope.reduce((total, row) => total + row.people, 0);
  const fteHigh = inScope.filter((row) => row.band === 'High').reduce((total, row) => total + row.people, 0);
  const weighed = inScope.filter((row) => row.opportunity !== null && row.people > 0);
  const weight = weighed.reduce((total, row) => total + row.people, 0);
  return {
    rows: shown, fteInScope, fteHigh, shareHigh: fteInScope > 0 ? fteHigh / fteInScope : null,
    respondents: grids.filter(({ grid }) => Object.keys(grid).length > 0).length, rowsRated: inScope.length, dropped,
    // (Open question 5: the people-weighted mean opportunity / 100, shown second to the share.)
    opportunityIndex: weight > 0 ? weighed.reduce((total, row) => total + row.people * row.opportunity, 0) / weight / 100 : null,
    criteria: criteria.map((criterion) => ({ id: criterion.id, label: criterion.label ?? '', hint: criterion.hint ?? '', direction: criterion.direction ?? 'none' })),
  };
}

/**
 * Where to start: the rows in the High band by people, largest first, those guests agree on; the split ones apart. `line` is the sentence.
 * @param {ReturnType<typeof aopResults>} result
 */
export function whereToStart(result) {
  const high = result.rows.filter((row) => row.band === 'High').sort((left, right) => right.people - left.people || left.order - right.order);
  const percent = result.shareHigh === null ? null : Math.round(result.shareHigh * 100);
  return {
    start: high.filter((row) => !row.split), discuss: high.filter((row) => row.split),
    line: percent === null ? 'No people in scope yet' : `${result.fteHigh} of ${result.fteInScope} people (${percent}%) are in High-band sub-processes`,
  };
}

/**
 * The answers by a guest's group, for the Group filter: each group in the order first met, "No group" last.
 * @template {{ clientTrackId?: string | null }} A @param {A[]} answers @param {(key: string) => string | null | undefined} guestGroupOf
 * @returns {{ group: string, answers: A[] }[]}
 */
export function byGroup(answers, guestGroupOf) {
  const groups = new Map();
  for (const answer of answers) {
    const group = String(guestGroupOf(String(answer.clientTrackId ?? '')) ?? '').trim();
    groups.set(group, [...(groups.get(group) ?? []), answer]);
  }
  const named = [...groups].filter(([group]) => group).map(([group, list]) => ({ group, answers: list }));
  return groups.has('') ? [...named, { group: 'No group', answers: groups.get('') }] : named;
}

/** The mean of every criterion over every cell, to compare clients. @param {ReturnType<typeof aopResults>} result */
export function criterionProfile(result) {
  return result.criteria.map((criterion, at) => {
    const cells = result.rows.map((row) => row.criteria[at]);
    const n = cells.reduce((total, cell) => total + cell.n, 0);
    // (How far guests agree on it: the mean over its rated cells of the largest count / n, as a row's agreement is over its criteria.)
    const rated = cells.filter((cell) => cell.n > 0);
    const agreement = rated.length ? rated.reduce((total, cell) => total + Math.max(cell.counts[1], cell.counts[2], cell.counts[3]) / cell.n, 0) / rated.length : null;
    return { id: criterion.id, label: criterion.label, direction: criterion.direction, n, mean: n ? cells.reduce((total, cell) => total + (cell.mean ?? 0) * cell.n, 0) / n : null, agreement };
  });
}

/**
 * The dashboard's pooling. People in scope are a client's, so they must not be added twice: for each client its most recent session with the question gives
 * fteInScope, fteHigh and shareHigh, and across clients these add. A criterion's average pools by guests, each session weighed by its respondents (as shiftOf does),
 * by the criterion's name, since a client's copy has ids of its own. Null when no session has the question.
 * @param {{ id: string, clientId: string, sessionDate?: string, summary?: { startTime?: string, aop?: any } }[]} sessions
 */
export function poolAop(sessions) {
  const having = sessions.filter((each) => each.summary?.aop);
  if (having.length === 0) return null;
  const when = (each) => `${String(each.sessionDate ?? '').slice(0, 10)} ${each.summary?.startTime ?? ''}`;
  const latest = new Map();
  for (const each of having) if (!latest.has(each.clientId) || when(each) >= when(latest.get(each.clientId))) latest.set(each.clientId, each);
  const clients = [...latest.values()].map((each) => {
    const { fteInScope = 0, fteHigh = 0, shareHigh = null, opportunityIndex = null, top = [], respondents = 0 } = each.summary.aop;
    return { clientId: each.clientId, sessionId: each.id, fteInScope, fteHigh, shareHigh, opportunityIndex, top: top[0] ?? null, respondents };
  });
  const fteInScope = clients.reduce((total, client) => total + client.fteInScope, 0);
  const fteHigh = clients.reduce((total, client) => total + client.fteHigh, 0);
  const pools = new Map();
  for (const each of having) {
    const weight = Number(each.summary.aop.respondents) || 0;
    for (const criterion of each.summary.aop.criteria ?? []) {
      if (typeof criterion.mean !== 'number') continue;
      const key = String(criterion.label).trim().toLowerCase();
      const pool = pools.get(key) ?? { label: criterion.label, direction: criterion.direction, total: 0, weight: 0, agreed: 0 };
      pool.total += criterion.mean * weight;
      pool.agreed += (Number(criterion.agreement) || 0) * weight;
      pool.weight += weight;
      pools.set(key, pool);
    }
  }
  return {
    fteInScope, fteHigh, shareHigh: fteInScope > 0 ? fteHigh / fteInScope : null, clients, rowsRated: having.reduce((total, each) => total + (Number(each.summary.aop.rowsRated) || 0), 0),
    respondents: clients.reduce((total, client) => total + client.respondents, 0),
    criteria: [...pools.values()].map((pool) => ({ label: pool.label, direction: pool.direction, mean: pool.weight ? pool.total / pool.weight : null, agreement: pool.weight ? pool.agreed / pool.weight : null, n: pool.weight })),
  };
}
