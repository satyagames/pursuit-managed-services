import * as dataService from '../../../public/js/dataService.js';
import { MAX_WRONG_TRIES, isRecordSettled } from './pager-logic.js';
import { nameParticipants } from './participant-names.js';

// What Admin → Results works out for each iPad of a session: the name it shows, and where it has got to. Plain JS with JSDoc and no
// DOM, so scripts/test-participant-names.js can hold the screen's names equal to the leader report's, on both adapters.
//
// The NAME is lib/participant-names.js, the one rule the leader report (the PDF and the CSV) names people by. It needs the session's
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
export const RECENT_MS = 120_000;
/** How many times a person's name is looked for in all: when the session is read, and once more on the next refresh. */
export const MAX_LOOKS = 2;

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
