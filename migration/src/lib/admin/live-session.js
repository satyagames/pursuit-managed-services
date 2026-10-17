import * as dataService from '../data/dataService.js';
import { sectionQueries } from '../data/read-groups.js';
import { buildResults, structureChanged, STRUCTURE_MAX_AGE_MS } from '../results/results-tally.js';

// What the Live display holds and how it keeps up. A session's STRUCTURE (its activities, their questions and options, and its
// client) changes rarely, so it is read once (three requests on SharePoint) and again when the feed says it changed or it is
// five minutes old. Everything else, the tracks and the answers, is ONE request every few seconds (dataService.readLiveFeed),
// and the tally is worked out here (lib/results/results-tally.js, the same arithmetic as getSessionResults).
//
// Plain JS with JSDoc and no DOM, so scripts/test-live-display.js can hold it on both adapters.

/**
 * @typedef {{ id: string, [key: string]: any }} Row
 * @typedef {{ session: Row, sections: Row[], questions: Row[], options: Row[], client: Row | null, readAt: number }} LiveStructure
 * @typedef {{ gone: false, structure: LiveStructure, results: import('./adminData.js').SessionResults, requests: number } | { gone: true, requests: number }} LiveRead
 */

/** @type {(queries: { list: string, where?: Record<string, unknown> }[]) => Promise<Row[][]>} */
const readLists = /** @type {any} */ (dataService).readLists;
/** @type {(sections: Row[]) => Promise<{ questions: Row[], options: Row[] }>} */
const readActivityContent = /** @type {any} */ (dataService).readActivityContent;
/** @type {(sessionId: string, options?: { sectionIds?: string[], tolerant?: boolean }) => Promise<{ session: Row | null, tracks: Row[], answers: Row[], sections: Row[] | null, unreadable: { id: string, reason: string }[], requests: number }>} */
const readLiveFeed = /** @type {any} */ (dataService).readLiveFeed;

/**
 * What a session is made of: the session, its activities, their questions and options, and its client. Null when there is no such session.
 * @param {string} sessionId @param {number} [now]
 * @returns {Promise<LiveStructure | null>}
 */
export async function loadLiveStructure(sessionId, now = Date.now()) {
  const session = /** @type {Row | null} */ (await dataService.getSession(sessionId));
  if (!session) return null;
  const ids = /** @type {string[]} */ (session.sectionIds ?? []);
  // The activities and the client side by side (one request), then every question and option of those activities (one more).
  // (The activities in groups of 20 ids to an address, Phase 9b: still one request on SharePoint, and no address grows with the session.)
  const queries = sectionQueries(ids);
  const answered = await readLists([...queries, { list: 'clients', where: { id: session.clientId } }]);
  const owners = answered[queries.length];
  const found = answered.slice(0, queries.length).flat();
  const byId = new Map(found.map((section) => [String(section.id), section]));
  const sections = ids.map((id) => byId.get(String(id))).filter((section) => Boolean(section));
  const { questions, options } = await readActivityContent(/** @type {Row[]} */ (sections));
  return { session, sections: /** @type {Row[]} */ (sections), questions, options, client: owners[0] ?? null, readAt: now };
}

/**
 * One refresh: ONE request for the tracks, the answers, the session and its activities, plus a new structure only when it must be.
 * `requests` is what the refresh itself cost (the number the timer scales by); a structure read is three more, once in a while.
 * @param {LiveStructure} held @param {number} [now]
 * @returns {Promise<LiveRead>}
 */
export async function readLive(held, now = Date.now()) {
  // `tolerant`: an answer item that cannot be read is named in `results.unreadable` and left out, where it used to stop the display (Phase 9b, DI-6).
  const feed = await readLiveFeed(held.session.id, { sectionIds: /** @type {string[]} */ (held.session.sectionIds ?? []), tolerant: true });
  if (!feed.session) return { gone: true, requests: feed.requests };
  let structure = held;
  if (structureChanged(held, feed) || now - held.readAt > STRUCTURE_MAX_AGE_MS) {
    const fresh = await loadLiveStructure(held.session.id, now);
    if (!fresh) return { gone: true, requests: feed.requests };
    structure = fresh;
  } else {
    structure = { ...held, session: feed.session };
  }
  const results = { ...buildResults({ session: structure.session, tracks: feed.tracks, sections: structure.sections, questions: structure.questions, options: structure.options, answers: feed.answers }), unreadable: feed.unreadable ?? [] };
  return { gone: false, structure, results: /** @type {any} */ (results), requests: feed.requests };
}
