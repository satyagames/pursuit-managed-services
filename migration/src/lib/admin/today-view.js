// What the admin's Today screen works out for itself before it draws: the words of its status ("Live since"), of its Go live button and of
// the reason it is off, of its readiness line, which clients it offers, the order of the other sessions, and how a changed session joins the
// list. Plain JS with JSDoc and no DOM or Svelte (scripts/test-today-view.js). Phase 17 moved these out of AdminToday.svelte unchanged; the
// rules of readiness and going live stay in admin-today.js. Reads nothing and writes nothing.

import { localDate } from './admin-today.js';

/**
 * "Live since": the time on today's date, the date and time on another, "not recorded" when there is none or it cannot be read.
 * @param {string | null} iso @param {string} today the screen's date (localDate())
 */
export function sinceText(iso, today) {
  if (!iso) return 'not recorded';
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return 'not recorded';
  return localDate(moment) === today
    ? moment.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : moment.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** How many of the readiness rows are blockers and how many warnings. @param {{ level: string }[]} rows */
export const levelCounts = (rows) => ({
  blockers: rows.filter((row) => row.level === 'blocker').length,
  warnings: rows.filter((row) => row.level === 'warning').length,
});

/** The line under Readiness. @param {{ inputsBusy: boolean, blockers: number, warnings: number }} state */
export function readinessSummary({ inputsBusy, blockers, warnings }) {
  if (inputsBusy) return 'Checking...';
  if (blockers > 0) return `${blockers} blocker${blockers === 1 ? '' : 's'}${warnings ? `, ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}`;
  if (warnings > 0) return `Ready to go live, with ${warnings} warning${warnings === 1 ? '' : 's'}`;
  return 'Ready to go live';
}

/**
 * Why Go live cannot be pressed, in words ('' when it can, or before the screen has loaded). `reason` is blockedReason() of the rows.
 * @param {{ loaded: boolean, client: { name: string } | null, dateValid: boolean, inputsBusy: boolean, blockers: number, reason: string | null, alreadyLive: boolean, date: string }} state
 */
export const goLiveWhy = ({ loaded, client, dateValid, inputsBusy, blockers, reason, alreadyLive, date }) => (
  !loaded ? '' : !client ? 'Add a client first.' : !dateValid ? 'Choose a date.' : inputsBusy ? 'Checking that everything is ready...'
    : blockers > 0 ? (reason ?? '') : alreadyLive ? `${client.name} is already live for ${date}.` : ''
);

/** The Go live button's words. @param {{ goingLive: boolean, checking: boolean, alreadyLive: boolean }} state */
export const goLiveLabel = ({ goingLive, checking, alreadyLive }) => (goingLive ? 'Going live...' : checking ? 'Checking...' : alreadyLive ? 'Already live' : 'Go live');

/**
 * The clients the picker offers: those not archived, and the picked one even if it is, by name. A new list; `clients` is not reordered.
 * @template {{ id: string, name: string, status?: string }} C @param {C[]} clients @param {string} clientId @returns {C[]}
 */
export const pickableClients = (clients, clientId) => clients.filter((entry) => entry.status !== 'archived' || entry.id === clientId).sort((a, b) => a.name.localeCompare(b.name));

/**
 * The sessions of "All sessions": every session but the live one while it is live, the newest date first, then the later id.
 * @template {{ id: string, date?: string }} S @param {S[]} sessions @param {string | null | undefined} activeSessionId @param {boolean} live @returns {S[]}
 */
export const otherSessionsOf = (sessions, activeSessionId, live) => [...sessions].filter((session) => session.id !== activeSessionId || !live)
  .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.id.localeCompare(a.id));

/**
 * The sessions with `next` in its place (its fields merged into the entry with its id), or added at the end. A new list.
 * @template {{ id: string }} S @param {S[]} list @param {S} next @returns {S[]}
 */
export const upsertSession = (list, next) => list.some((item) => item.id === next.id) ? list.map((item) => item.id === next.id ? { ...item, ...next } : item) : [...list, next];

/** What a failure says on the screen: the error's own words, else `fallback`. @param {unknown} cause @param {string} fallback */
export const failureText = (cause, fallback) => cause instanceof Error ? cause.message : fallback;
