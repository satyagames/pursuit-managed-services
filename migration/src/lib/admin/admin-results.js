import * as dataService from '../data/dataService.js';
import { MAX_WRONG_TRIES, isRecordSettled } from '../participant/pager-logic.js';
import { nameParticipants } from '../results/participant-names.js';

// What Admin → Results works out for each iPad of a session: the name it shows, and where it has got to. Plain JS with JSDoc and no
// DOM, so scripts/test-participant-names.js can hold the screen's names equal to the leader report's, on both adapters.
//
// The NAME is lib/results/participant-names.js, the one rule the leader report (the PDF and the CSV) names people by. It needs the session's
// visit log (where a staff sign-in name is kept) and its guest roster, which a track does not carry, so the screen reads them with
// readNameSources(): ONE `$batch` on SharePoint for up to 20 sessions, and only for sessions that have a track with no name of its
// own (a guest's QR name is on the track, so a guest session needs no read at all).

/** @typedef {{ id: string, [key: string]: any }} Row */
/** @typedef {{ visits: Row[], roster: Row[] }} NameSources What the naming rule reads besides the tracks. */
/** @typedef {import('./adminData.js').SessionResults} SessionResults */

/** @type {(queries: { list: string, where?: Record<string, unknown> }[]) => Promise<Row[][]>} */
const readLists = /** @type {any} */ (dataService).readLists;
const responseOwner = /** @type {(response: any) => string | null} */ (/** @type {any} */ (dataService).responseOwner);

const CHUNK = 20; // session ids to a read, as readActivityContent() does for activities
const EMPTY = Object.freeze({ visits: [], roster: [] });
/** A page records a staff sign-in a moment after it draws its first screen, so someone who joined a moment ago may not be in the visit log yet. */
const RECENT_MS = 120_000;
/** How many times a person's name is looked for in all: when the session is read, and once more on the next refresh. */
const MAX_LOOKS = 2;

/** What Results asks before it removes a visit (Phase 9b, DI-9), and says when an answer arrived first. The data service refuses in the same words. */
export const REMOVE_VISIT_CONFIRM = "Remove this visit? It has no answers. If it was made by a guest's code, that code stays used: issue a replacement code if the guest needs to start again.";
export const REMOVE_VISIT_REFUSED = 'This visit now has answers, so it was not removed.';

/**
 * May Results offer Remove for this row? Only a visit with no answers (its status is "not started"), and never on a session that has ended: a
 * past report must not change silently. Somebody whose saved answers cannot be read is not "empty", so that row never gets it either.
 * @param {{ status: string }} row @param {{ status?: string } | null | undefined} session
 */
export const canRemoveVisit = (row, session) => row.status === 'not-started' && session?.status !== 'completed';

/** True when a track carries no name of its own: the visit log or the roster may still have one. @param {{ participantName?: string | null }} track */
export const hasOwnName = (track) => typeof track.participantName === 'string' && track.participantName.trim() !== '';

/** The ids of the sessions among `results` with at least one track that has no name of its own. @param {SessionResults[]} results */
export const sessionsNeedingNames = (results) => results.filter((result) => result.tracks.some((track) => !hasOwnName(track))).map((result) => result.session.id);

/**
 * The visit log and the roster of each session, by session id. One request on SharePoint for up to 20 sessions (two lists side by side
 * in one `$batch`), none for no sessions.
 * @param {string[]} sessionIds
 * @returns {Promise<Map<string, NameSources>>}
 */
export async function readNameSources(sessionIds) {
  const ids = [...new Set(sessionIds.map(String))];
  const held = /** @type {Map<string, NameSources>} */ (new Map(ids.map((id) => [id, { visits: [], roster: [] }])));
  if (ids.length === 0) return held;
  const groups = [];
  for (let at = 0; at < ids.length; at += CHUNK) groups.push(ids.slice(at, at + CHUNK));
  const found = await readLists(groups.flatMap((group) => [{ list: 'uservisitlogs', where: { sessionId: group } }, { list: 'visitorroster', where: { sessionId: group } }]));
  groups.forEach((_group, index) => {
    for (const visit of found[index * 2]) /** @type {NameSources} */ (held.get(String(visit.sessionId)))?.visits.push(visit);
    for (const visitor of found[index * 2 + 1]) /** @type {NameSources} */ (held.get(String(visitor.sessionId)))?.roster.push(visitor);
  });
  return held;
}

// What Admin → Results has read of each session's visit log and roster in this page, kept for the page's life (in memory, never stored). The Live
// display names people with lib/results/participant-names.js too, and reads no visit log of its own (Phase 11a: no new request), so it takes them from here:
// a guest's QR name is on the visit anyway, and a staff sign-in name is known when Results has read it in this tab.
/** @type {Map<string, NameSources>} */
const heldSources = new Map();

/** Keeps what was read, session by session. @param {Map<string, NameSources>} sources */
export function holdNameSources(sources) {
  for (const [sessionId, found] of sources) heldSources.set(String(sessionId), found);
}

/** What Results read for this session in this page, or null. @param {string} sessionId @returns {NameSources | null} */
export const heldNameSources = (sessionId) => heldSources.get(String(sessionId)) ?? null;

/**
 * One row for each iPad of a session, in the order they joined: the track, the name the report would print, whether that name is
 * the "Unnamed participant N" it falls back on, and how many of the live questions it has answered.
 * @param {SessionResults} result
 * @param {NameSources} [sources]
 */
export function resultRows(result, sources = EMPTY) {
  const people = nameParticipants({ tracks: result.tracks, visits: sources.visits, roster: sources.roster });
  // A visit whose saved answers could not be read (Phase 9b, DI-6) is "unreadable", not "not started": nobody knows what it holds.
  const damaged = new Set((result.unreadable ?? []).map((entry) => String(entry.id)));
  const responses = result.sections.flatMap((section) => section.questions.flatMap((question) => question.responses));
  const expected = new Set(result.sections.filter((section) => result.session.sectionIds?.includes(section.id) && section.enabled).flatMap((section) => section.questions.map((question) => question.id)));
  return people.map(({ track, name, unnamed }) => {
    const mine = /** @type {NonNullable<typeof track>} */ (track);
    const own = responses.filter((response) => responseOwner(response) === mine.id && expected.has(response.questionId));
    const answered = new Set(own.map((response) => response.questionId));
    // "Completed" is what the participant's own page calls finished: a final answer to every question. A wrong first answer whose
    // Retry was never used is answered, and not final (isRecordSettled; an answer with no history, from the older shared item, is final).
    const final = new Set(own.filter((response) => isRecordSettled({ correct: response.correct ?? null, attempts: response.attempts ?? MAX_WRONG_TRIES })).map((response) => response.questionId));
    const status = damaged.has(String(mine.id)) ? 'unreadable' : answered.size === 0 ? 'not-started' : final.size === expected.size ? 'completed' : 'in-progress';
    return { track: /** @type {import('./adminData.js').SessionTrack} */ (mine), name, unnamed, status, answered: answered.size, total: expected.size };
  });
}

// ---- The order of the screen (Phase 16) ---------------------------------------------------------------------------------------
// Results shows the newest session first, and in each session the newest joiner first, so the session of today and who just arrived are at
// the top. Only Results: the leader report, the CSVs, the Live display and the oracle keep their own order (scripts/test-admin-results.js).

/** The order of the sessions on Results: by date, newest first; a tie by the latest visit, then by the later item of the list. */
export const SESSION_ORDER = 'newest-first';
/** The order of the iPads in a session: 'newest-first' (the latest joiner at the top), or 'join-order' as it was before Phase 16. */
export const ROW_ORDER = 'newest-first';

const DAY = /^\d{4}-\d{2}-\d{2}/;
/** A time as a number to compare, or -Infinity for a missing or unreadable one (it sorts last). @param {unknown} value */
const instant = (value) => {
  const time = typeof value === 'string' && value !== '' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
};
/** A session's day, from its `date` (its first ten characters: a date with a time is its day). @param {unknown} value */
const dayOf = (value) => (typeof value === 'string' && DAY.test(value) ? instant(value.slice(0, 10)) : Number.NEGATIVE_INFINITY);
/** The latest `createdAt` of a session's visits. @param {{ tracks?: { createdAt?: unknown }[] }} result */
const latestVisit = (result) => Math.max(Number.NEGATIVE_INFINITY, ...(result.tracks ?? []).map((track) => instant(track?.createdAt)));
/** Newer first: the larger number first; two missing ones are equal. @param {number} a @param {number} b */
const newer = (a, b) => (a === b ? 0 : b > a ? 1 : -1);

/**
 * The sessions newest first (SESSION_ORDER): by `session.date`; on the same day, by the most recent visit in the session; then by the later item
 * of `list` (a later item is newer). A missing or unreadable date sorts last. A new array: `list` is not changed.
 * @template T
 * @param {T[]} list
 * @param {(item: T) => { session?: { date?: unknown }, tracks?: { createdAt?: unknown }[] }} [resultOf] what each item's session is read from
 * @returns {T[]}
 */
export function newestFirst(list, resultOf = (item) => /** @type {any} */ (item)) {
  return list
    .map((item, index) => {
      const result = resultOf(item) ?? {};
      return { item, index, day: dayOf(result.session?.date), latest: latestVisit(result) };
    })
    .sort((a, b) => newer(a.day, b.day) || newer(a.latest, b.latest) || b.index - a.index)
    .map((entry) => entry.item);
}

/**
 * The newly read cards in the order the screen already shows them (Phase 16): a card on the screen keeps its place, however a new visit
 * would sort it now, so a refresh never moves a card under the person's hands; a session that newly appears is put at its sorted place; one that
 * has gone is dropped. `sorted` is newestFirst()'s order; `shown` the ids on the screen, in their order.
 * @template T
 * @param {string[]} shown
 * @param {T[]} sorted
 * @param {(item: T) => { session: { id: string } }} resultOf
 * @returns {T[]}
 */
export function keepShownOrder(shown, sorted, resultOf) {
  const idOf = (/** @type {T} */ item) => String(resultOf(item).session.id);
  const place = new Map(shown.map((id, index) => [String(id), index]));
  const rank = new Map(sorted.map((item, index) => [idOf(item), index]));
  /** @type {T[]} */
  const out = sorted.filter((item) => place.has(idOf(item))).sort((a, b) => /** @type {number} */ (place.get(idOf(a))) - /** @type {number} */ (place.get(idOf(b))));
  for (const item of sorted) {
    if (place.has(idOf(item))) continue;
    const before = out.findIndex((other) => /** @type {number} */ (rank.get(idOf(other))) > /** @type {number} */ (rank.get(idOf(item))));
    out.splice(before === -1 ? out.length : before, 0, item);
  }
  return out;
}

/**
 * A session's iPad rows in ROW_ORDER: newest joiner first (by the track's `createdAt`; a tie or a missing time by the later row of the join
 * order), or the join order resultRows() gives. A new array.
 * @template {{ track: { createdAt?: unknown } }} R
 * @param {R[]} rows in the order they joined
 * @param {string} [order]
 * @returns {R[]}
 */
export function rowsInOrder(rows, order = ROW_ORDER) {
  if (order !== 'newest-first') return [...rows];
  return rows
    .map((row, index) => ({ row, index, joined: instant(row.track?.createdAt) }))
    .sort((a, b) => newer(a.joined, b.joined) || b.index - a.index)
    .map((entry) => entry.row);
}

/**
 * The rows whose name is worth looking for again on a refresh of the live session: a person with no recorded name who joined in the last
 * two minutes (their sign-in may not be written yet) and has been looked for fewer than twice. Anyone else with no name has none to find.
 * @param {ReturnType<typeof resultRows>} rows
 * @param {Map<string, number>} lookedFor how many times each track's name has been looked for
 * @param {number} [now]
 */
export const rowsToLookForAgain = (rows, lookedFor, now = Date.now()) => rows.filter((row) => {
  const joined = Date.parse(String(row.track.createdAt ?? ''));
  return row.unnamed && (lookedFor.get(row.track.id) ?? 0) < MAX_LOOKS && Number.isFinite(joined) && now - joined < RECENT_MS;
});

/** Forgets what was read for a session that has been deleted (Phase 16): the Live display must not name anyone from it. @param {string} sessionId */
export function forgetNameSources(sessionId) {
  heldSources.delete(String(sessionId));
}
