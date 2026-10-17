import * as dataService from '../data/dataService.js';
import { sectionQueries } from '../data/read-groups.js';
import { buildResults } from './results-tally.js';

// What the Results screen and the three Live display exports read for ONE session (Phase 9b): the results tree
// ({ session, tracks, sections: [{ ...section, questions: [{ ...question, responses, respondents, options }] }] }), worked out by the
// arithmetic the Live display uses (lib/results/results-tally.js buildResults, held to a hand-worked tally by scripts/test-live-display.js
// on both adapters), plus `unreadable`: the answer items that could not be read and so are not counted (DI-6).
//
// It reads the activities' questions and options in groups of 20 (readActivityContent), so no address grows with the content, and one
// damaged item does not stop a session. (The legacy pages' reader of the same tree, dataService.getSessionResults, did neither; it left
// in Phase 10c-2a. lib/admin/adminData.ts exports this function under that older name, which the screens import.)
//
// Plain JS with JSDoc and no DOM, so scripts/test-live-display.js can hold it on both adapters.

/** @typedef {{ id: string, [key: string]: any }} Row */

/** @type {(queries: { list: string, where?: Record<string, unknown> }[]) => Promise<Row[][]>} */
const readLists = /** @type {any} */ (dataService).readLists;
/** @type {(sections: Row[]) => Promise<{ questions: Row[], options: Row[] }>} */
const readActivityContent = /** @type {any} */ (dataService).readActivityContent;
/** @type {(sessionId: string) => Promise<{ answers: any[], unreadable: { id: string, reason: string }[] }>} */
const readSessionResponsesChecked = /** @type {any} */ (dataService).readSessionResponsesChecked;

/**
 * A session's results, or null when there is no such session.
 * @param {string} sessionId
 */
export async function readSessionResults(sessionId) {
  const [session, tracks, checked] = await Promise.all([
    /** @type {Promise<Row | null>} */ (dataService.getSession(sessionId)), /** @type {Promise<Row[]>} */ (dataService.listClientTracks(sessionId)), readSessionResponsesChecked(sessionId),
  ]);
  if (!session) return null;
  const queries = sectionQueries(/** @type {string[]} */ (session.sectionIds ?? []));
  const sections = queries.length ? (await readLists(queries)).flat() : [];
  const { questions, options } = await readActivityContent(sections);
  return { ...buildResults({ session, tracks, sections, questions, options, answers: checked.answers }), unreadable: checked.unreadable };
}
