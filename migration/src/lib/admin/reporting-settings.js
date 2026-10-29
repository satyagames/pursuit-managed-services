// Reporting settings (Prompt 22, Part 2): the two settings the Leadership dashboard already reads, PMSAppSettings.FiscalYearStartMonth and MinSample, set
// by a Super admin (the matrix's settings.manage), written with updateAppSettings and to the audit list (who, the old value and the new). Plain JS with no
// DOM (scripts/test-reporting-settings.js); admin/ReportingSettings.svelte shows it. The values' rules are lib/access/field-values.js's, which the write
// guard asks again before anything is sent.
//
// What a new start month moves (found by reading the tree, docs/history/RELEASE-22.md): it is read when a page opens, so AT ONCE the dashboard's year and
// quarter chips, the days each covers (sessions are kept by their date), the all-client and one-client baselines (the same days), the tiles, the index and
// shift by client, and the quarter of every session planned from then on follow it. A session's Period is stored when it is planned and its summary copies
// it (session-summary.js prefers the stored one), so the trend by quarter, a client's change since the quarter before, the "quarter before" and "same
// quarter last year" baselines, the Fiscal year list, and the quarters a Leadership period reads summaries by KEEP the old quarters. The dashboard's
// Rebuild cannot move them: it writes only the missing summaries and takes the session's stored Period. So the screen offers to move the stored quarters
// (moveStoredPeriods), and only when the person confirms; nothing is moved behind them.

import { AccessDenied } from '../access/access-denied.js';
import { writeAudit } from '../access/audit.js';
import { can } from '../access/can.js';
import { fieldProblem, invalidValue } from '../access/field-values.js';
import { DEFAULT_FISCAL_START, periodOf } from './session-plan.js';
import { MIN_SAMPLE } from '../results/index-math.js';

/** The month names, January first: the screen's choices and the words of a change. */
export const MONTH_NAMES = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
const FIELDS = ['fiscalYearStartMonth', 'minSample'];

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const wholeOrNull = (value) => (Number.isInteger(Number(value)) && value !== null && value !== '' && value !== undefined ? Number(value) : null);
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const monthOf = (value) => MONTH_NAMES[(wholeOrNull(value) ?? DEFAULT_FISCAL_START) - 1] ?? MONTH_NAMES[DEFAULT_FISCAL_START - 1];
const monthWords = (value) => (wholeOrNull(value) === null ? `${monthOf(null)} (not set)` : monthOf(value));
const minWords = (value) => (wholeOrNull(value) === null ? `${MIN_SAMPLE} (not set)` : String(wholeOrNull(value)));

/** The two settings as they are stored (null when empty: the dashboard then reads June and 10). @param {{ getAppSettings: () => Promise<any> }} ds */
export async function readReportingSettings(ds) {
  const settings = await ds.getAppSettings();
  return { fiscalYearStartMonth: wholeOrNull(settings?.fiscalYearStartMonth), minSample: wholeOrNull(settings?.minSample) };
}

/**
 * What changed, in words, for the audit line: "Fiscal year starts in: June to July; Minimum sample: 10 to 3". '' when nothing did.
 * @param {Record<string, unknown>} before @param {Record<string, unknown>} changes
 */
export function settingsChangeWords(before, changes) {
  const parts = [];
  if ('fiscalYearStartMonth' in changes && wholeOrNull(changes.fiscalYearStartMonth) !== wholeOrNull(before.fiscalYearStartMonth)) {
    parts.push(`Fiscal year starts in: ${monthWords(before.fiscalYearStartMonth)} to ${monthWords(changes.fiscalYearStartMonth)}`);
  }
  if ('minSample' in changes && wholeOrNull(changes.minSample) !== wholeOrNull(before.minSample)) parts.push(`Minimum sample: ${minWords(before.minSample)} to ${minWords(changes.minSample)}`);
  return parts.join('; ');
}

/**
 * Saves what changed of the two settings and writes one audit line. Refused (AccessDenied, nothing sent) without settings.manage; a value out of range is
 * refused with its words before any request. Resolves to { changed, detail }.
 * @param {any} ds the data service @param {any} access @param {Record<string, unknown>} before readReportingSettings's
 * @param {Record<string, unknown>} changes @param {{ now?: Date }} [options]
 */
export async function saveReportingSettings(ds, access, before, changes, { now = new Date() } = {}) {
  if (!can(access, 'settings.manage', {}, { now })) throw new AccessDenied('settings.manage');
  const wanted = Object.fromEntries(FIELDS.filter((field) => field in changes).map((field) => [field, changes[field] === '' ? null : changes[field]]));
  for (const [field, value] of Object.entries(wanted)) {
    const words = fieldProblem('appsettings', field, value);
    if (words) throw invalidValue(words);
  }
  const diff = Object.fromEntries(Object.entries(wanted).filter(([field, value]) => wholeOrNull(value) !== wholeOrNull(before[field])));
  const detail = settingsChangeWords(before, diff);
  if (!detail) return { changed: false, detail: '' };
  await ds.updateAppSettings(diff);
  await writeAudit(ds, access, { action: 'settings', detail }, { now });
  return { changed: true, detail };
}

/**
 * The stored quarters a start month leaves behind: each session (by `date`) and summary (by `sessionDate`) whose stored Period is not its date's quarter
 * under `month`. One with no stored Period is left out: the screens work its quarter out from the date.
 * @param {any[]} sessions @param {any[]} summaries @param {number} month
 */
export function periodsToMove(sessions, summaries, month) {
  const moves = (rows, dateOf) => rows.flatMap((row) => {
    const from = text(row.period);
    const to = periodOf(String(dateOf(row) ?? '').slice(0, 10), month);
    return from && to && from !== to ? [{ id: String(row.id), from, to }] : [];
  });
  return { sessions: moves(sessions, (row) => row.date), summaries: moves(summaries, (row) => row.sessionDate) };
}

/**
 * The confirmation of a new start month: what follows it at once, and what keeps the quarters it was given (`sessions` and `summaries` are how many of
 * each periodsToMove found). @param {{ from: unknown, to: number, sessions: number, summaries: number }} input
 */
export function fiscalChangeWords({ from, to, sessions, summaries }) {
  const [old, next] = [monthOf(from), monthOf(to)];
  const now = `Start the fiscal year in ${next} instead of ${old}? At once, the dashboard's year and quarter choices, the days each one covers, and the quarter of every session planned from now on follow ${next}.`;
  if (!sessions && !summaries) return `${now} Nothing stored needs to move: every session and summary already has ${next}'s quarter.`;
  return `${now} ${plural(sessions, 'session')} and ${plural(summaries, 'summary', 'summaries')} keep the quarter they were given under ${old}, so the trend by quarter, `
    + 'each client\'s change since the quarter before, the comparisons with the quarter before and the same quarter last year, and the quarters a Leadership '
    + `period reads still use ${old}'s quarters until you move them. After saving you can move them.`;
}

/** The question before the stored quarters are moved. @param {{ sessions: number, summaries: number, month: number }} input */
export const moveQuestion = ({ sessions, summaries, month }) => `Move the stored quarters of ${plural(sessions, 'session')} and ${plural(summaries, 'summary', 'summaries')} `
  + `to a year that starts in ${monthOf(month)}? It writes ${plural(sessions + summaries, 'item')}, reads no answers and changes nothing else.`;

/**
 * Moves the stored quarters periodsToMove found: each session's Period, then each summary written again whole with its new Period (its figures as they
 * are; a summary is written by saveSessionSummary). A Super admin's alone; one audit line at the end. A write that fails is counted and the rest go on.
 * @param {any} ds @param {any} access @param {ReturnType<typeof periodsToMove>} moves
 * @param {{ month: number, now?: Date, onProgress?: (done: number, of: number) => void }} options
 * @returns {Promise<{ moved: number, failed: string[] }>}
 */
export async function moveStoredPeriods(ds, access, moves, { month, now = new Date(), onProgress }) {
  if (!can(access, 'settings.manage', {}, { now })) throw new AccessDenied('settings.manage');
  const of = moves.sessions.length + moves.summaries.length;
  let moved = 0;
  const failed = [];
  const step = async (id, write) => {
    try { await write(); moved += 1; } catch { failed.push(id); }
    onProgress?.(moved + failed.length, of);
  };
  for (const each of moves.sessions) await step(each.id, () => ds.updateSession(each.id, { period: each.to }));
  if (moves.summaries.length) {
    const items = new Map((await ds.readSessionSummaries({ sessionIds: moves.summaries.map((each) => each.id) })).map((item) => [String(item.id), item]));
    for (const each of moves.summaries) {
      await step(each.id, async () => {
        const item = items.get(each.id);
        if (!item) throw new Error('missing');
        await ds.saveSessionSummary({ ...item, period: each.to });
      });
    }
  }
  const detail = `Stored quarters moved to a year that starts in ${monthOf(month)}: ${plural(moves.sessions.length, 'session')}, ${plural(moves.summaries.length, 'summary', 'summaries')}`;
  await writeAudit(ds, access, { action: 'settings', detail: failed.length ? `${detail} (${failed.length} could not be moved)` : detail }, { now });
  return { moved, failed };
}
