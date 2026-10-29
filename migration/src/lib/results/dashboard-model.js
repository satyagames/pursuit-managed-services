// The Leadership dashboard's figures (Prompt 21, Phase 5; wireframe board 9): from the summaries a person may read and the clients, under the filters, the
// headline sentence, the six tiles, the index by client against 100 with each client's sessions, the trend by quarter, the priority index, the confidence
// steps Before and After, the Survey feedback themes and comments, and the report's CSV. Every number comes from lib/results/index-math.js (nothing is
// counted here but sums of the summaries' own counts); every word of a figure is lib/results/metric-words.js's. Plain JS with no DOM
// (scripts/test-leader-dashboard.js); admin/LeaderDashboard.svelte shows it.
//
// ASSUMED (docs/history/RELEASE-21E.md): the baseline "All-client average" is every client the person may read, in the same days; a person who holds one
// client sees its index against itself (100). The trend shows the four quarters up to the one in view, each against the mean over those quarters. The
// change of a client is its index now less its index in the quarter before (against that quarter's all-client average). The steps Before and After add up
// the sessions of the most common scale. Facilitator is who wrote the summary; an activity type keeps the sessions that asked one; a guest group keeps the
// sessions a guest of that group joined.

import { csvCell } from '../exports/leader-report.js';
import { periodOf } from '../admin/session-plan.js';
import {
  BASELINES, MIN_SAMPLE, baselineOf, change, clientIndex, firstChoiceShares, lowSample, meanAfterOf, movedOf, periodRange, periodsBetween, priorQuarter,
  priorityIndex, sessionIndex, shiftOf,
} from './index-math.js';
import { HIDE_NAMES_BY_DEFAULT } from './metric-words.js';

/** The period chips: the fiscal year, its four quarters, a month, or days of one's own. */
export const SPANS = Object.freeze([
  Object.freeze({ id: 'fy', label: 'FY' }), Object.freeze({ id: 'q1', label: 'Q1' }), Object.freeze({ id: 'q2', label: 'Q2' }), Object.freeze({ id: 'q3', label: 'Q3' }),
  Object.freeze({ id: 'q4', label: 'Q4' }), Object.freeze({ id: 'month', label: 'Month' }), Object.freeze({ id: 'custom', label: 'Custom' }),
]);

/** What each kind of question is called in the Activity type filter (the leader report's kinds). */
export const KIND_WORDS = Object.freeze({ graded: 'Quiz', choice: 'Poll', multi: 'Choose several', scale: 'Scale', ranking: 'Ranking', text: 'Survey feedback' });

/**
 * The filters a dashboard opens with: the quarter of `period` (else today's), against the all-client average, every client, names as the setting says.
 * @param {{ period?: string, today?: string, startMonth?: number }} [from]
 */
export function defaultFilters({ period, today = new Date().toISOString().slice(0, 10), startMonth = 6 } = {}) {
  const quarter = period || periodOf(today, startMonth);
  const [year, q] = quarter.split('-');
  return {
    period: quarter, year, span: q ? q.toLowerCase() : 'fy', month: today.slice(0, 7), from: '', to: '', compare: 'all', compareClient: '', clientIds: /** @type {string[]} */ ([]), industry: '',
    facilitator: '', kind: '', group: '', minSample: /** @type {number | null} */ (null), hideNames: HIDE_NAMES_BY_DEFAULT,
  };
}

const words = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const sum = (list, key) => list.reduce((total, each) => total + (Number(each[key]) || 0), 0);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = MONTHS.map((month) => month.slice(0, 3));
const dayText = (day) => { const [y, m, d] = day.split('-').map(Number); return `${d} ${SHORT[m - 1]} ${y}`; };
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const whole = (value) => (value === null || value === undefined ? '' : String(Math.round(value)));
const signed = (value) => (value === null ? '' : `${Math.round(value) > 0 ? '+' : ''}${Math.round(value)}%`);

/**
 * The days and quarters a choice of period covers: { from, to, periods, words }.
 * @param {any} filters @param {number} startMonth
 */
export function windowOf(filters, startMonth) {
  const year = /^FY\d{2}$/.test(filters.year ?? '') ? filters.year : String(filters.period ?? '').slice(0, 4);
  if (filters.span === 'month' && /^\d{4}-\d{2}$/.test(filters.month ?? '')) {
    const [y, m] = filters.month.split('-').map(Number);
    const from = `${filters.month}-01`;
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return { from, to, periods: periodsBetween(from, to, startMonth), words: `${MONTHS[m - 1]} ${y}` };
  }
  if (filters.span === 'custom' && filters.from && filters.to) {
    return { from: filters.from, to: filters.to, periods: periodsBetween(filters.from, filters.to, startMonth), words: `${dayText(filters.from)} to ${dayText(filters.to)}` };
  }
  const period = filters.span === 'fy' ? year : /^q[1-4]$/.test(filters.span ?? '') ? `${year}-Q${filters.span.slice(1)}` : filters.period;
  const range = periodRange(period, startMonth) ?? { from: '', to: '' };
  const periods = range.from ? periodsBetween(range.from, range.to, startMonth) : [];
  return { from: range.from, to: range.to, periods, words: String(period).replace('-', ' ') };
}

const inDays = (summary, window) => Boolean(window.from) && summary.sessionDate >= window.from && summary.sessionDate <= window.to.concat('T23:59:59');
const dayOf = (summary) => String(summary.sessionDate ?? '').slice(0, 10);

/** The sessions the filters keep, of those in the days. */
function filtered(list, filters, clientOf) {
  return list.filter((each) => {
    if (filters.clientIds?.length && !filters.clientIds.includes(each.clientId)) return false;
    if (filters.industry && words(clientOf.get(each.clientId)?.industry) !== filters.industry) return false;
    if (filters.facilitator && words(each.summary?.facilitator) !== filters.facilitator) return false;
    if (filters.kind && !(Number(each.summary?.kinds?.[filters.kind]) > 0)) return false;
    if (filters.group && !Object.keys(each.summary?.groups ?? {}).some((group) => words(group).toLowerCase() === filters.group.toLowerCase())) return false;
    return true;
  });
}

/** A session in the expanded row: "24 Oct 09:30 Morning workshop" (lib/access/scope.js pickerLabel's words, from the summary). */
const sessionWords = (each) => {
  const [, m, d] = dayOf(each).split('-').map(Number);
  return [m ? `${d} ${SHORT[m - 1]}` : '', words(each.summary?.startTime), words(each.summary?.title)].filter(Boolean).join(' ') || each.id;
};

/** The baseline's summaries for a choice: of every summary in reach, in the days in view (or the quarters a baseline moves to). */
function baselineFor(all, window, filters) {
  const kind = BASELINES.some((each) => each.id === filters.compare) ? filters.compare : 'all';
  if (kind === 'prior-quarter' || kind === 'last-year') return baselineOf(all, { kind, periods: window.periods });
  const days = all.filter((each) => inDays({ sessionDate: dayOf(each) }, window));
  return kind === 'client' ? days.filter((each) => each.clientId === filters.compareClient) : days;
}

const baselineWords = (filters, clientOf) => {
  if (filters.compare === 'prior-quarter') return 'the quarter before';
  if (filters.compare === 'last-year') return 'the same quarter last year';
  if (filters.compare === 'client') return words(clientOf.get(filters.compareClient)?.name) || 'the chosen client';
  return 'the all-client average';
};

/**
 * Everything the dashboard shows.
 * @param {{ summaries: any[], clients: any[], filters: any, startMonth?: number, minSample?: number | null, mayName?: boolean }} input
 */
export function dashboardOf({ summaries, clients, filters, startMonth = 6, minSample = null, mayName = true }) {
  const min = Number(filters.minSample) > 0 ? Number(filters.minSample) : Number(minSample) > 0 ? Number(minSample) : MIN_SAMPLE;
  const clientOf = new Map(clients.map((client) => [client.id, client]));
  const nameOf = (id) => words(clientOf.get(id)?.name) || id;
  const window = windowOf(filters, startMonth);
  const days = summaries.filter((each) => inDays({ sessionDate: dayOf(each) }, window));
  const segment = filtered(days, filters, clientOf);
  const baseline = baselineFor(summaries, window, filters);
  const index = clientIndex(segment, baseline);
  const afters = meanAfterOf(segment).n;
  const shift = shiftOf(segment);
  const moved = movedOf(segment);
  const guests = sum(segment, 'guests');
  const completed = sum(segment, 'completed');
  const tiles = [
    { id: 'sessions', value: segment.length, text: String(segment.length), n: segment.length, low: false },
    { id: 'guests', value: guests, text: String(guests), n: guests, low: false },
    { id: 'completion', value: guests ? (completed * 100) / guests : null, text: guests ? `${whole((completed * 100) / guests)}%` : 'None yet', n: guests, low: lowSample(guests, min) },
    { id: 'confidence-index', value: index, text: index === null ? 'Not measured' : whole(index), n: afters, low: index !== null && lowSample(afters, min) },
    { id: 'confidence-shift', value: shift.percent, text: shift.percent === null ? 'Not measured' : signed(shift.percent), n: shift.n, low: shift.percent !== null && lowSample(shift.n, min) },
    { id: 'moved', value: moved.percent, text: moved.percent === null ? 'Not measured' : `${whole(moved.percent)}%`, n: moved.started, low: moved.percent !== null && lowSample(moved.started, min) },
  ];

  // By client: each against the baseline, highest first, with the change since the quarter before and its sessions against its own average.
  const priorWindow = { periods: window.periods.map(priorQuarter).filter(Boolean) };
  const prior = summaries.filter((each) => priorWindow.periods.includes(each.period));
  const byClient = [...new Set(segment.map((each) => each.clientId))].map((clientId) => {
    const mine = segment.filter((each) => each.clientId === clientId);
    const own = clientIndex(mine, baseline);
    const before = clientIndex(prior.filter((each) => each.clientId === clientId), prior);
    return {
      clientId, name: nameOf(clientId), index: own, change: change(own, before), guests: sum(mine, 'guests'), low: own !== null && lowSample(meanAfterOf(mine).n, min),
      sessions: [...mine].sort((left, right) => dayOf(left).localeCompare(dayOf(right)) || words(left.summary?.startTime).localeCompare(words(right.summary?.startTime))).map((each) => ({
        id: each.id, label: sessionWords(each), date: dayOf(each), guests: Number(each.guests) || 0, completed: Number(each.completed) || 0, index: sessionIndex(each, mine),
        low: Number(each.afterCount) > 0 && lowSample(Number(each.afterCount), min),
      })),
    };
  }).sort((left, right) => (right.index ?? -1) - (left.index ?? -1) || left.name.localeCompare(right.name));

  // The trend: the four quarters up to the last one in view, each against the mean over them.
  const last = window.periods.at(-1) ?? '';
  const quarters = last ? [priorQuarter(priorQuarter(priorQuarter(last))), priorQuarter(priorQuarter(last)), priorQuarter(last), last] : [];
  const trendRows = filtered(summaries.filter((each) => quarters.includes(each.period)), filters, clientOf);
  const trend = quarters.map((period) => {
    const those = trendRows.filter((each) => each.period === period);
    const value = those.length ? clientIndex(those, trendRows) : null;
    return { period, index: value, low: value !== null && lowSample(meanAfterOf(those).n, min) };
  });

  // The priority index of what was chosen first most often, against the baseline's shares.
  const mine = firstChoiceShares(segment);
  const theirs = firstChoiceShares(baseline);
  const priority = mine.rows.slice(0, 6).map((row) => ({
    label: row.label, share: row.share * 100, baseShare: (theirs.rows.find((each) => each.key === row.key)?.share ?? 0) * 100, index: priorityIndex(row.label, segment, baseline),
    low: lowSample(mine.total, min),
  }));

  // The steps Before and After, over the sessions of the most common scale.
  const scales = segment.filter((each) => each.summary?.distribution && Number(each.summary.scaleMax) > 0);
  const common = [...scales.reduce((map, each) => map.set(each.summary.scaleMax, (map.get(each.summary.scaleMax) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
  let distribution = null;
  if (common !== null) {
    const add = (side) => Array.from({ length: common }, (_, at) => scales.filter((each) => each.summary.scaleMax === common).reduce((total, each) => total + (Number(each.summary.distribution[side]?.[at]) || 0), 0));
    const [before, after] = [add('before'), add('after')];
    const share = (list) => { const total = list.reduce((a, b) => a + b, 0); return list.map((value) => (total ? (value * 100) / total : 0)); };
    distribution = { scaleMax: common, before: share(before), after: share(after), beforeCount: before.reduce((a, b) => a + b, 0), afterCount: after.reduce((a, b) => a + b, 0) };
  }

  // Survey feedback: the themes of every session added up, and its comments, named as decision B says.
  const themeCounts = new Map();
  for (const each of segment) for (const theme of each.summary?.feedback?.themes ?? []) themeCounts.set(theme.word, (themeCounts.get(theme.word) ?? 0) + (Number(theme.count) || 0));
  const themes = [...themeCounts].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word)).slice(0, 8);
  const hide = Boolean(filters.hideNames) || !mayName;
  const quotes = segment.flatMap((each) => (each.summary?.feedback?.quotes ?? []).map((quote) => ({ ...quote, sessionId: each.id, clientId: each.clientId })))
    .slice(0, 12).map((quote, at) => ({ ...quote, name: hide ? `Guest ${at + 1}` : words(quote.name) || `Guest ${at + 1}` }));

  // The headline, from the numbers above.
  let headline;
  const clientCount = new Set(segment.map((each) => each.clientId)).size;
  if (!segment.length) headline = `No session in ${window.words} has a summary yet.`;
  else {
    const opening = `${plural(segment.length, 'session')} with ${plural(guests, 'guest')} at ${plural(clientCount, 'client')} in ${window.words}.`;
    const low = tiles[3].low ? ', low sample' : '';
    const against = baselineWords(filters, clientOf);
    let confidence = 'Confidence was not measured in these sessions';
    if (index !== null) {
      const away = Math.round(index) - 100;
      confidence = away === 0 ? `Confidence matched ${against} (index ${whole(index)}${low})` : `Confidence ran ${Math.abs(away)}% ${away > 0 ? 'above' : 'below'} ${against} (index ${whole(index)}${low})`;
    }
    const top = byClient.length > 1 && byClient[0].index !== null ? `; ${byClient[0].name} was highest at ${whole(byClient[0].index)}` : '';
    headline = `${opening} ${confidence}${top}.`;
  }
  return { headline, window, tiles, byClient, trend, priority, distribution, themes, quotes, minSample: min, empty: !segment.length, hideNames: hide };
}

/** What the filters offer: the years with summaries, the clients' industries, the facilitators, the guest groups and the kinds of question asked. */
export function filterOptions(summaries, clients) {
  const sorted = (values) => [...new Set(values.map(words).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const kinds = sorted(summaries.flatMap((each) => Object.keys(each.summary?.kinds ?? {})));
  return {
    years: sorted(summaries.map((each) => String(each.period ?? '').slice(0, 4))).filter((year) => /^FY\d{2}$/.test(year)),
    industries: sorted(clients.map((client) => client.industry ?? '')),
    facilitators: sorted(summaries.map((each) => each.summary?.facilitator ?? '')),
    groups: sorted(summaries.flatMap((each) => Object.keys(each.summary?.groups ?? {}))),
    kinds: kinds.map((id) => ({ id, label: KIND_WORDS[id] ?? id })),
  };
}

/** Export report: one row a session, by client in the dashboard's order, with the client's index and the session's (CSV, no cell a formula). @param {ReturnType<typeof dashboardOf>} board */
export function reportCsv(board) {
  const rows = [['Client', 'Session', 'Date', 'Guests', 'Completed', 'Confidence index', 'Session index', 'Low sample']];
  for (const client of board.byClient) {
    for (const each of client.sessions) rows.push([client.name, each.label, each.date, each.guests, each.completed, client.index === null ? '' : Math.round(client.index), each.index === null ? '' : Math.round(each.index), each.low ? 'Low sample' : '']);
  }
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
