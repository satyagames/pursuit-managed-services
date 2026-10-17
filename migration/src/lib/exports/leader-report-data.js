import * as dataService from '../data/dataService.js';
import { sectionQueries } from '../data/read-groups.js';

// What the leader report and the participant CSV read for one session, with the calls the admin screens already use (nothing was
// added to dataService.js): the session; then, side by side in ONE $batch on SharePoint, its activities, its client, its tracks,
// its visit log (where a staff sign-in name is kept) and its guest roster; then the activities' questions and options (one more
// batch) beside every answer, through readSessionResponses(), the one reader that sees both ways answers are stored. Four requests
// on SharePoint for a session of about 60 people; one more, only when an answer points at a question that is no longer in any of
// the session's activities, to see whether that question still exists somewhere.
//
// Plain JS with JSDoc and no DOM, so scripts/test-leader-report.js can run it on both adapters.

/** @typedef {import('./leader-report.js').ReportRecords} ReportRecords */
/** @typedef {{ id: string, [key: string]: any }} Row */

/** @type {(queries: { list: string, where?: Record<string, unknown> }[]) => Promise<Row[][]>} */
const readLists = /** @type {any} */ (dataService).readLists;
/** @type {(sections: Row[]) => Promise<{ questions: Row[], options: Row[] }>} */
const readActivityContent = /** @type {any} */ (dataService).readActivityContent;
/** @type {(sessionId: string) => Promise<{ answers: any[], unreadable: { id: string, reason: string }[] }>} */
const readSessionResponsesChecked = /** @type {any} */ (dataService).readSessionResponsesChecked;

const CHUNK = 20; // ids to a read, as readActivityContent() does

/**
 * Everything buildLeaderReport() needs for a session, or null when there is no such session.
 * @param {string} sessionId
 * @returns {Promise<ReportRecords | null>}
 */
export async function readLeaderReportRecords(sessionId) {
  const session = /** @type {Row | null} */ (await dataService.getSession(sessionId));
  if (!session) return null;
  // (The activities in groups of 20 ids to an address, Phase 9b: still the one request on SharePoint.)
  const sectionReads = sectionQueries(/** @type {string[]} */ (session.sectionIds ?? []));
  const read = await readLists([
    ...sectionReads,
    { list: 'clients', where: { id: session.clientId } },
    { list: 'tracks', where: { sessionId } },
    { list: 'uservisitlogs', where: { sessionId } },
    { list: 'visitorroster', where: { sessionId } },
  ]);
  const sections = read.slice(0, sectionReads.length).flat();
  const [clients, tracks, visits, roster] = read.slice(sectionReads.length);
  // An answer item that cannot be read leaves that person out of the figures and is named (Phase 9b, DI-6); the rest are counted as ever.
  const [{ questions, options }, { answers, unreadable }] = await Promise.all([readActivityContent(sections), readSessionResponsesChecked(sessionId)]);

  const placed = new Set(questions.map((question) => String(question.id)));
  const strayIds = [...new Set(answers.map((answer) => String(answer.questionId)).filter((id) => !placed.has(id)))];
  let strayQuestions = /** @type {Row[]} */ ([]);
  let strayOptions = /** @type {Row[]} */ ([]);
  if (strayIds.length > 0) {
    const groups = [];
    for (let index = 0; index < strayIds.length; index += CHUNK) groups.push(strayIds.slice(index, index + CHUNK));
    const found = await readLists([
      ...groups.map((ids) => ({ list: 'questions', where: { id: ids } })),
      ...groups.map((ids) => ({ list: 'options', where: { questionId: ids } })),
    ]);
    strayQuestions = found.slice(0, groups.length).flat();
    strayOptions = found.slice(groups.length).flat();
  }
  return { session, client: clients[0] ?? null, tracks, sections, questions, options, answers, visits, roster, strayQuestions, strayOptions, unreadable };
}
