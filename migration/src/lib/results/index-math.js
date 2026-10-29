// The Leadership dashboard's arithmetic (Prompt 21, Phase 5; wireframe boards 9 and 12): the one place an index, a baseline, a change or a pooled shift
// is worked out. The dashboard (lib/results/dashboard-model.js) shows what this gives and never counts again. Plain JS with JSDoc, no DOM and no I/O;
// scripts/test-index-math.js holds it to cases worked out by hand and to properties, and scripts/oracle-results.js recounts it by rules of its own.
//
// It reads session summaries (PMSSessionSummary, lib/results/session-summary.js), never answers. The rules (docs/RULES.md, "The Leadership dashboard"):
//   Index            = segment / baseline x 100 (null when the baseline is nothing: zero, missing, not a number). A ratio, ASSUMED (open item 3).
//   Confidence index = the mean After of a group's sessions (each session weighed by its Afters) / the baseline's, x 100
//   Session index    = a session's mean After / its client's mean After, x 100 (against the client's own average)
//   Priority index   = an option's share of the first choices in the group / its share in the baseline, x 100 (options grouped by their label)
//   Change           = now - then, in index points
//   Low sample       = fewer than the minimum (PMSAppSettings.MinSample, else 10)
//   Pooled shift     = over every paired guest of every session, (After - Before) as a share of that session's scale, x 100
// Baselines: the average of all clients in reach for the same periods (the default), the quarter before, the same quarter a year before, one chosen client.

import { MIN_SAMPLE as CHECK_MIN_SAMPLE } from './confidence-shift.js';
import { periodOf } from '../admin/session-plan.js';

/** The fewest answers a figure is shown for without a "low sample" mark when PMSAppSettings.MinSample is empty (ASSUMED 10, open item 3). */
export const MIN_SAMPLE = CHECK_MIN_SAMPLE;

/** The baselines "Compare with" offers, in its order. The first is the default. */
export const BASELINES = Object.freeze([
  Object.freeze({ id: 'all', label: 'All-client average' }),
  Object.freeze({ id: 'prior-quarter', label: 'The quarter before' }),
  Object.freeze({ id: 'last-year', label: 'Same quarter last year' }),
  Object.freeze({ id: 'client', label: 'One client' }),
]);

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** segment / baseline x 100; null when either is not a number or the baseline is not above zero. @param {unknown} segment @param {unknown} baseline */
export function indexOf(segment, baseline) {
  if (!finite(segment) || !finite(baseline) || /** @type {number} */ (baseline) <= 0) return null;
  return (/** @type {number} */ (segment) / /** @type {number} */ (baseline)) * 100;
}

/** now - then; null without both. @param {number | null | undefined} now @param {number | null | undefined} then */
export const change = (now, then) => (finite(now) && finite(then) ? /** @type {number} */ (now) - /** @type {number} */ (then) : null);

/** Fewer than the minimum? A minimum that is not a whole number above zero reads as MIN_SAMPLE. @param {number} n @param {unknown} [min] */
export const lowSample = (n, min = MIN_SAMPLE) => n < (Number.isInteger(Number(min)) && Number(min) > 0 ? Number(min) : MIN_SAMPLE);

/**
 * @typedef {object} Summary A session's summary (lib/results/session-summary.js), as the dashboard reads it.
 * @property {string} id the session's id
 * @property {string} clientId
 * @property {string} period FY27-Q2
 * @property {number} afterCount
 * @property {number | null} meanAfter
 * @property {number} pairedCount
 * @property {any} summary its SummaryJson
 */

/**
 * The mean After of some sessions, each weighed by its Afters, and how many Afters it rests on. A session with no After adds nothing.
 * @param {Summary[]} summaries @returns {{ mean: number | null, n: number }}
 */
export function meanAfterOf(summaries) {
  let total = 0; let n = 0;
  for (const each of summaries) {
    const count = Number(each.afterCount) || 0;
    if (count <= 0 || !finite(each.meanAfter)) continue;
    total += count * /** @type {number} */ (each.meanAfter);
    n += count;
  }
  return { mean: n ? total / n : null, n };
}

/** A client's (or any group's) confidence index against the baseline's summaries. @param {Summary[]} group @param {Summary[]} baseline */
export const clientIndex = (group, baseline) => indexOf(meanAfterOf(group).mean, meanAfterOf(baseline).mean);

/** A session's index against its client's own average (all the client's sessions in view). @param {Summary} session @param {Summary[]} clientSessions */
export const sessionIndex = (session, clientSessions) => indexOf(Number(session.afterCount) > 0 ? session.meanAfter : null, meanAfterOf(clientSessions).mean);

/** An option's label as the priority index groups it: trimmed, its spaces single, in lower case. */
const labelKey = (label) => String(label ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The first choices of some sessions, by option label (the first spelling seen is the one shown), most chosen first, with each one's share.
 * @param {Summary[]} summaries
 * @returns {{ total: number, rows: { key: string, label: string, count: number, share: number }[] }}
 */
export function firstChoiceShares(summaries) {
  const byKey = new Map();
  let total = 0;
  for (const each of summaries) {
    for (const question of each.summary?.firstChoices ?? []) {
      for (const option of question.options ?? []) {
        const count = Number(option.count) || 0;
        const key = labelKey(option.label);
        if (!key || count <= 0) continue;
        const row = byKey.get(key) ?? { key, label: String(option.label).trim(), count: 0 };
        row.count += count;
        byKey.set(key, row);
        total += count;
      }
    }
  }
  const rows = [...byKey.values()].map((row) => ({ ...row, share: total ? row.count / total : 0 }));
  rows.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  return { total, rows };
}

/**
 * The priority index of one option: its share of the group's first choices over its share of the baseline's, x 100. Null when the baseline never chose
 * it or the group chose nothing.
 * @param {string} label @param {Summary[]} group @param {Summary[]} baseline
 */
export function priorityIndex(label, group, baseline) {
  const key = labelKey(label);
  const mine = firstChoiceShares(group);
  const theirs = firstChoiceShares(baseline);
  if (!mine.total) return null;
  const share = (shares) => shares.rows.find((row) => row.key === key)?.share ?? 0;
  return indexOf(share(mine), share(theirs) || null);
}

/**
 * The confidence shift over every paired guest of the sessions: each session's (paired After - paired Before) as a percent of its own scale, weighed by
 * its paired guests (confidence-shift.js shiftDivisor: the top of the scale). Null with nobody paired.
 * @param {Summary[]} summaries @returns {{ percent: number | null, n: number }}
 */
export function shiftOf(summaries) {
  let total = 0; let n = 0;
  for (const each of summaries) {
    const paired = Number(each.pairedCount) || 0;
    const { scaleMax, pairedBefore, pairedAfter } = each.summary ?? {};
    if (paired <= 0 || !finite(scaleMax) || scaleMax <= 0 || !finite(pairedBefore) || !finite(pairedAfter)) continue;
    total += paired * (((pairedAfter - pairedBefore) * 100) / scaleMax);
    n += paired;
  }
  return { percent: n ? total / n : null, n };
}

/** Moved to confident over the sessions: of every paired guest who started not confident, the share who ended confident. @param {Summary[]} summaries */
export function movedOf(summaries) {
  let started = 0; let moved = 0;
  for (const each of summaries) {
    started += Number(each.summary?.moved?.started) || 0;
    moved += Number(each.summary?.moved?.moved) || 0;
  }
  return { percent: started ? (moved * 100) / started : null, started, moved };
}

const PERIOD = /^FY(\d{2})(?:-Q([1-4]))?$/;
const two = (value) => String(((value % 100) + 100) % 100).padStart(2, '0');

/** The quarter before a quarter: FY27-Q1 gives FY26-Q4. '' for anything else. @param {string} period */
export function priorQuarter(period) {
  const match = PERIOD.exec(String(period ?? ''));
  if (!match?.[2]) return '';
  const [year, quarter] = [Number(match[1]), Number(match[2])];
  return quarter === 1 ? `FY${two(year - 1)}-Q4` : `FY${two(year)}-Q${quarter - 1}`;
}

/** The same quarter a year before: FY27-Q2 gives FY26-Q2. '' for anything else. @param {string} period */
export function sameQuarterLastYear(period) {
  const match = PERIOD.exec(String(period ?? ''));
  return match?.[2] ? `FY${two(Number(match[1]) - 1)}-Q${match[2]}` : '';
}

/**
 * The first and last day of a fiscal year (FY27) or quarter (FY27-Q2), from the start month (lib/admin/session-plan.js periodOf names a year by the year it
 * ends in, ASSUMED). FY years are read as 20xx. Null for anything else.
 * @param {string} period @param {number} startMonth 1 to 12
 * @returns {{ from: string, to: string } | null}
 */
export function periodRange(period, startMonth) {
  const match = PERIOD.exec(String(period ?? ''));
  if (!match) return null;
  const start = Number.isInteger(startMonth) && startMonth >= 1 && startMonth <= 12 ? startMonth : 6;
  const endsIn = 2000 + Number(match[1]);
  const firstYear = start === 1 ? endsIn : endsIn - 1;
  const quarter = match[2] ? Number(match[2]) : null;
  const firstMonth = start - 1 + (quarter ? (quarter - 1) * 3 : 0);
  const months = quarter ? 3 : 12;
  const day = (year, monthIndex) => new Date(Date.UTC(year, monthIndex, 1)).toISOString().slice(0, 10);
  const from = day(firstYear, firstMonth);
  const to = new Date(Date.UTC(firstYear, firstMonth + months, 0)).toISOString().slice(0, 10);
  return { from, to };
}

/**
 * The fiscal quarters a range of days touches, in order: what a Leadership role "for a period" reads its summaries by (PMSSessionSummary.Period). None for a
 * range that ends before it starts or a day that is not one.
 * @param {string} from YYYY-MM-DD @param {string} to YYYY-MM-DD @param {number} startMonth
 */
export function periodsBetween(from, to, startMonth) {
  const [first, last] = [String(from ?? '').slice(0, 10), String(to ?? '').slice(0, 10)];
  let period = periodOf(first, startMonth);
  if (!period || !periodOf(last, startMonth) || first > last) return [];
  const found = [];
  while (period && found.length < 400) {
    const range = periodRange(period, startMonth);
    if (!range || range.from > last) break;
    found.push(period);
    const [, year, quarter] = /** @type {RegExpExecArray} */ (PERIOD.exec(period)).map(Number);
    period = quarter === 4 ? `FY${two(year + 1)}-Q1` : `FY${two(year)}-Q${quarter + 1}`;
  }
  return found;
}

/**
 * The summaries a baseline is made of. `periods` are the quarters in view (null: every period); `clientId` is the one client a "One client" baseline names.
 * The quarter before and the same quarter last year shift each period in view (a period that is not a quarter shifts to nothing). An unknown kind is "all".
 * @param {Summary[]} summaries every summary in reach
 * @param {{ kind: string, periods: string[] | null, clientId?: string }} choice
 */
export function baselineOf(summaries, { kind, periods, clientId }) {
  const within = (wanted) => (wanted === null ? summaries : summaries.filter((each) => wanted.includes(each.period)));
  if (kind === 'prior-quarter') return within((periods ?? []).map(priorQuarter).filter(Boolean));
  if (kind === 'last-year') return within((periods ?? []).map(sameQuarterLastYear).filter(Boolean));
  if (kind === 'client') return within(periods).filter((each) => each.clientId === clientId);
  return within(periods);
}
