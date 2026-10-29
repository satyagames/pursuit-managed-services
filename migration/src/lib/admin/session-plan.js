// What the client's page decides about its sessions (Prompt 21, Phase 3; wireframe board 5): the period of a date from the fiscal-year start month,
// a planned session's id, the New session form's rules and what it plans, the day's sessions in order ("1 of 2 today"), the words Planned, Live and
// Ended for the existing Status values, and the one-live-session limit in plain words. Plain JS with JSDoc and no DOM (scripts/test-sessions-plan.js);
// the Clients workspace and Today import it. Reads nothing and writes nothing: the data layer's planSession() and startSession() do.
//
// A session's id is opaque everywhere: it is built here, once, and nothing reads a date or a time out of it.

import { effectiveSlug } from './admin-clients.js';
import { sessionLabel, sessionTitle } from '../access/people.js';

/** The fiscal-year start month when the setting is empty: June (ASSUMED until the manager confirms it; PMSAppSettings.FiscalYearStartMonth). */
export const DEFAULT_FISCAL_START = 6;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const text = (value) => (typeof value === 'string' ? value.trim() : '');
/** A real calendar date written YYYY-MM-DD. */
const isDay = (value) => DAY_PATTERN.test(value ?? '') && new Date(`${value}T00:00:00Z`).toISOString?.().slice(0, 10) === value;
const safeDay = (value) => { try { return isDay(value); } catch { return false; } };
/** The fiscal-year start month a setting gives: 1 to 12, else June. @param {unknown} month */
const startOf = (month) => (Number.isInteger(Number(month)) && Number(month) >= 1 && Number(month) <= 12 ? Number(month) : DEFAULT_FISCAL_START);

/**
 * The fiscal period of a day, like FY27-Q2: the year is the one the fiscal year ends in (a year that starts in January is the calendar year), and a
 * quarter is three months from the start month. '' for no date. ASSUMED: the firm names a fiscal year by the year it ends in (FY27 is June 2026 to
 * May 2027 with June as the start).
 * @param {string} date YYYY-MM-DD @param {unknown} [startMonth] PMSAppSettings.FiscalYearStartMonth
 */
export function periodOf(date, startMonth = DEFAULT_FISCAL_START) {
  if (!safeDay(String(date ?? '').slice(0, 10))) return '';
  const start = startOf(startMonth);
  const [year, month] = String(date).slice(0, 10).split('-').map(Number);
  const fiscalYear = start === 1 ? year : month >= start ? year + 1 : year;
  const quarter = Math.floor(((month - start + 12) % 12) / 3) + 1;
  return `FY${String(fiscalYear % 100).padStart(2, '0')}-Q${quarter}`;
}

/** A session's period as the screens show it: the one stored when it was planned, else its date's (a session made before version 6). */
export const periodLabel = (session, startMonth = DEFAULT_FISCAL_START) => text(session?.period) || periodOf(session?.date ?? '', startMonth);

/**
 * A planned session's id: the client's slug (or the name its session ids use), the date and the start time, `<slug>-<yyyy-mm-dd>-<hhmm>`. When
 * SharePoint refuses it as taken, the data layer tries -2, then -3 (planSession).
 * @param {{ slugify: (text: string) => string }} api @param {any} client @param {string} date @param {string} startTime HH:mm
 */
export const plannedSessionId = (api, client, date, startTime) => `${effectiveSlug(api, client)}-${date}-${String(startTime).replace(':', '')}`;

/** A client's sessions on one day, by start time (a session with none first), then id. @param {any[]} sessions @param {string} clientId @param {string} date */
export const daySessionsOf = (sessions, clientId, date) => sessions.filter((session) => session.clientId === clientId && session.date === date)
  .sort((a, b) => String(a.startTime ?? '').localeCompare(String(b.startTime ?? '')) || String(a.id).localeCompare(String(b.id)));

/**
 * The session a day's choice lands on: the one asked for when it is that client's on that day, else the first of the day that has not ended, else the
 * day's first; null when the client has none that day.
 * @param {any[]} sessions @param {string} clientId @param {string} date @param {string | null} [wanted]
 */
export function daySessionPick(sessions, clientId, date, wanted = null) {
  const day = daySessionsOf(sessions, clientId, date);
  return day.find((session) => session.id === wanted) ?? day.find((session) => session.status !== 'completed') ?? day[0] ?? null;
}

/** "1 of 2 today": a session's place in its client's day by start time; '' when it is the only one. @param {any} session @param {any[]} sessions */
export function sequenceWords(session, sessions) {
  const day = daySessionsOf(sessions, session.clientId, session.date);
  return day.length > 1 ? `${day.findIndex((entry) => entry.id === session.id) + 1} of ${day.length} today` : '';
}

/**
 * Planned, Live or Ended: words for the existing Status values (not-started, in-progress, completed), labels only. Live is the session
 * PMSAppSettings names (one at a time); a session that was visited and is no longer the live one, and not ended, reads Planned (ASSUMED).
 * @param {{ id: string, status?: string }} session @param {{ activeSessionId?: string | null } | null} settings
 * @returns {'Planned' | 'Live' | 'Ended'}
 */
export const stageOf = (session, settings) => (session.status === 'completed' ? 'Ended' : settings?.activeSessionId === session.id ? 'Live' : 'Planned');

/** The known limit of this release, as the screens say it. */
export const ONE_LIVE_LIMIT = 'One session can be live at a time: starting a session takes the place of the live one for participants, and ends nothing.';

/**
 * What Today says before going live with `target` while another session is live; '' when nothing else is live or `target` is it.
 * @param {{ live: boolean, session?: any, client?: { name: string } | null }} status @param {{ id: string } | null} target
 */
export function oneLiveWords(status, target) {
  if (!status?.live || !target || status.session?.id === target.id) return '';
  return `One session can be live at a time. Going live with this one takes the place of ${[status.client?.name, sessionLabel(status.session)].filter(Boolean).join(', ')} for participants; that session is not ended.`;
}

/**
 * What is wrong with the New session form, by field; {} when it can be planned. A title is needed when the client has another session that day.
 * @param {{ date: string, startTime: string, title: string }} form @param {{ sessions: any[], clientId: string }} context
 * @returns {{ date?: string, startTime?: string, title?: string }}
 */
export function planProblems(form, { sessions, clientId }) {
  /** @type {{ date?: string, startTime?: string, title?: string }} */
  const problems = {};
  if (!safeDay(form.date)) problems.date = 'Choose the date.';
  if (!TIME_PATTERN.test(form.startTime ?? '')) problems.startTime = 'Choose the start time.';
  if (!problems.date && !text(form.title) && daySessionsOf(sessions, clientId, form.date).length > 0) {
    problems.title = 'Give this session a title: the client has another session that day.';
  }
  return problems;
}

/**
 * What the New session form plans, for the data layer's planSession(): the id, the client, the day, the start time, the title, its place among the
 * client's sessions that day as planned (Sequence), its period, and when it was planned.
 * @param {{ slugify: (text: string) => string }} api @param {any} client @param {{ date: string, startTime: string, title: string }} form
 * @param {{ sessions: any[], fiscalStartMonth?: unknown, now?: Date }} context
 */
export function planSessionFor(api, client, form, { sessions, fiscalStartMonth = DEFAULT_FISCAL_START, now = new Date() }) {
  return {
    id: plannedSessionId(api, client, form.date, form.startTime), clientId: client.id, date: form.date, startTime: form.startTime, title: text(form.title),
    sequence: daySessionsOf(sessions, client.id, form.date).length + 1, period: periodOf(form.date, fiscalStartMonth), plannedDate: now.toISOString(),
  };
}

/**
 * The rows of a client's Sessions list, the latest day first and a day's sessions by start time: { session, when, sequence, title, period, stage }.
 * @param {any[]} sessions @param {{ clientId: string, settings: any, fiscalStartMonth?: unknown }} context
 */
export function sessionRows(sessions, { clientId, settings, fiscalStartMonth = DEFAULT_FISCAL_START }) {
  const own = sessions.filter((session) => session.clientId === clientId);
  return [...own].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || String(a.startTime ?? '').localeCompare(String(b.startTime ?? ''))
    || String(a.id).localeCompare(String(b.id)))
    .map((session) => ({
      session, when: sessionLabel({ date: session.date, startTime: session.startTime, id: session.id }), sequence: sequenceWords(session, own),
      title: sessionTitle(session), period: periodLabel(session, fiscalStartMonth), stage: stageOf(session, settings),
    }));
}

/**
 * A session as Today's session picker says it: its start time, its title, its place in the client's day and its label ("09:00, Morning, 2 of 3
 * today, Live"). A session made by Go live has no start time.
 * @param {any} session @param {any[]} sessions @param {{ activeSessionId?: string | null } | null} settings
 */
export const sessionChoiceWords = (session, sessions, settings) => [text(session.startTime) || 'No start time', sessionTitle(session), sequenceWords(session, sessions),
  stageOf(session, settings)].filter(Boolean).join(', ');
