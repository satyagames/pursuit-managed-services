import * as dataService from '../data/dataService.js';

// "Delete session..." on Admin → Results (Phase 16): what deleting a session's data removes, in which order, what it refuses, and the words the screen,
// the tests and the documents use. Plain JS with JSDoc and no DOM; the requests are the data service's (dataService.listItemKeys and deleteByKey,
// which every page carries, so they are two small generic calls and the rules are here, below the screen, where only the admin page carries them).
//
// The delete is permanent (the owner's decision, 19 Oct 2026): no soft delete, archive or undo. It removes every item keyed by the session's id in
// the lists of SESSION_OWNED and nothing else: the client, its activities, questions, options and their pictures, Brand settings, the admins and the
// settings item are never touched, and a report somebody downloaded is theirs. The picture files of the session's guests go too (Prompt 23: a face is personal data). A session id is `<client>-<date>`, so Today can make the same id
// again the same day: everything keyed by it goes, and a session made again under it starts empty.

/**
 * The lists that hold a session's data, in the order they are deleted, and the field each is keyed by. Children first, the session item last: a
 * delete that stops part way leaves the session on Results, where it can be deleted again (only what is left is removed), instead of items
 * nobody can see that fill the lists and count against SharePoint's list-view limits. scripts/test-session-delete.js fails if a list with a
 * session id column is neither here nor in KEPT.
 */
export const SESSION_OWNED = Object.freeze([
  Object.freeze({ list: 'responses', key: 'sessionId', what: 'answers' }),
  Object.freeze({ list: 'uservisitlogs', key: 'sessionId', what: 'visit log' }),
  Object.freeze({ list: 'tracks', key: 'sessionId', what: 'iPads' }),
  Object.freeze({ list: 'visitorroster', key: 'sessionId', what: 'guest list' }),
  Object.freeze({ list: 'qrtokens', key: 'sessionId', what: 'guest codes' }),
  // (Prompt 21, Phase 5: the session's summary for the dashboard, keyed by the session's id, holds its totals and a few comments with their author.)
  Object.freeze({ list: 'sessionsummary', key: 'id', what: 'dashboard summary' }),
  Object.freeze({ list: 'sessions', key: 'id', what: 'the session' }),
]);

/** The lists that name a session and are never changed by a delete, and why. */
export const KEPT = Object.freeze([
  Object.freeze({ list: 'appsettings', field: 'activeSessionId', why: 'It names the live session, which is refused; it is read, never written.' }),
  // (Prompt 21) who was given a session, and the audit list, are not the session's data: decision J keeps every line of the audit list.
  Object.freeze({ list: 'roleassignments', field: 'sessionId', why: 'A role given for a session is access, not the session\'s data; a role for a deleted session matches nothing.' }),
  Object.freeze({ list: 'auditlog', field: 'sessionId', why: 'The audit list only grows (decision J): its lines are kept whatever is deleted.' }),
]);

/** A delete of a session's data: what the screen says, in one place. */
export const DELETE_SESSION = Object.freeze({
  button: 'Delete session...',
  title: "Delete this session's data permanently?",
  confirm: 'Delete permanently',
  cancel: 'Cancel',
  retry: 'Try again',
  keepFirst: 'Download the leader report first if you want to keep the results:',
  kept: 'The client, its activities and questions are kept.',
  inProgress: 'This session was never ended, but it is not the live one, so it can be deleted.',
  live: 'This session is live. End it in Today first.',
  missing: 'This session is already gone.',
});

/** A refusal: an Error with a code the screen can tell apart, and the words it shows. */
const failure = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * What the warning counts, in words: "4 iPads, 34 answers, 6 guest codes".
 * @param {{ ipads: number, answers: number, codes: number }} counts
 */
export const countsText = ({ ipads, answers, codes }) => `${plural(ipads, 'iPad')}, ${plural(answers, 'answer')}, ${plural(codes, 'guest code')}`;

/**
 * The warning, built from the session (never typed in per client): the dialog's lead and its points.
 * @param {{ clientName: string, date?: string, status?: string }} session
 * @param {{ ipads: number, answers: number, codes: number }} counts
 */
export function deleteSessionWarning(session, counts) {
  const name = [session.clientName, session.date].filter(Boolean).join(', ');
  return {
    lead: `You are about to delete all data of ${name} from the SharePoint lists: ${countsText(counts)}. This is permanent and cannot be undone.`,
    points: [
      DELETE_SESSION.kept,
      'Its visit log, guest list, guests\' pictures and guest codes go too. A printed guest code of this session stops working.',
      ...(session.status === 'in-progress' ? [DELETE_SESSION.inProgress] : []),
    ],
  };
}

/** The words when the numbers changed while the dialog was open. @param {{ ipads: number, answers: number, codes: number }} counts */
export const changedText = (counts) => `Something changed while this was open: there are now ${countsText(counts)}. Check the numbers, then press ${DELETE_SESSION.confirm} again.`;
/** Progress, in a status region. @param {{ done: number, total: number }} step */
export const progressText = ({ done, total }) => `Deleting ${done} of ${total}...`;
/** A delete that stopped part way. @param {number} left */
export const stoppedText = (left) => `Stopped: ${plural(left, 'item')} ${left === 1 ? 'is' : 'are'} left. The session stays on Results: press ${DELETE_SESSION.retry} to remove what is left.`;
/** An account that may not delete in a list (403). @param {string} title */
export const refusedText = (title) => `Your account may not delete items in ${title}, so the delete stopped there. Ask a site owner for Contribute on that list, then try again. The session stays on Results.`;
/** The toast. @param {{ clientName: string, date?: string }} session */
export const deletedText = (session) => `${[session.clientName, session.date].filter(Boolean).join(' ')} deleted`;

/**
 * The numbers the warning shows, from what a Results card already holds (no read): its iPads, the answers on its charts and its codes.
 * @param {{ results: { tracks: unknown[], sections: { questions: { responses: unknown[] }[] }[] }, codes: unknown[] }} card
 */
export const cardCounts = (card) => ({
  ipads: card.results.tracks.length,
  answers: card.results.sections.reduce((sum, section) => sum + section.questions.reduce((inner, question) => inner + question.responses.length, 0), 0),
  codes: card.codes.length,
});

/**
 * Everything a delete of `sessionId` would remove, read now: each list's items, the numbers the warning shows, and whether the session is live.
 * One read per list (more for a list of over 200 items), one for the answers, and the settings item last, just before anything is removed.
 * @param {string} sessionId
 * @param {{ data?: any }} [options]
 */
export async function planSessionDelete(sessionId, { data = dataService } = {}) {
  /** @type {Record<string, { id: string, key: unknown }[]>} */
  const items = {};
  for (const { list, key } of SESSION_OWNED) items[list] = await data.listItemKeys(list, { [key]: sessionId });
  const { answers } = await data.readSessionResponsesChecked(sessionId);
  const settings = await data.getAppSettings();
  const counts = { ipads: items.tracks.length, answers: answers.length, codes: items.qrtokens.length };
  const total = Object.values(items).reduce((sum, found) => sum + found.length, 0);
  return { items, counts, total, live: settings?.activeSessionId === sessionId, exists: items.sessions.length > 0 };
}

const same = (/** @type {Record<string, number>} */ a, /** @type {Record<string, number>} */ b) => a.ipads === b.ipads && a.answers === b.answers && a.codes === b.codes;

/**
 * Deletes everything of the session `sessionId` in the lists of SESSION_OWNED, in that order, paced (dataService.runPaced). It reads it all again
 * first and refuses, in words: the live session ('session-live'; the settings item is read last, just before the first delete), and numbers that
 * are not the ones the person saw (`expected`; 'session-changed', with the new `counts`). It stops at the first list where something could not
 * be deleted, and the session item is deleted only when everything else is gone, so a stopped delete can be run again and removes only what is
 * left. An item already gone is deleted. Resolves to { deleted: { list: count }, total, leftovers: [{ list, id }], left, refused, pictures: { removed, missing, failed } }, where `left`
 * is what is still there and `refused` the title of a list the account may not delete in (403), or null.
 * @param {string} sessionId
 * @param {{ expected?: { ipads: number, answers: number, codes: number } | null, onProgress?: (step: { done: number, total: number }) => void, concurrency?: number, gapMs?: number | null, data?: any }} [options]
 */
export async function deleteSessionData(sessionId, { expected = null, onProgress = () => {}, concurrency, gapMs = null, data = dataService } = {}) {
  console.info('Results: delete session, reading what it holds', sessionId);
  const plan = await planSessionDelete(sessionId, { data });
  if (plan.live) throw failure('session-live', DELETE_SESSION.live);
  if (plan.total === 0) return { deleted: {}, total: 0, leftovers: [], left: 0, refused: null };
  if (expected && !same(expected, plan.counts)) throw failure('session-changed', changedText(plan.counts), { counts: plan.counts });
  /** @type {Record<string, number>} */
  const deleted = {};
  // (Prompt 23) The guests' picture files, while their rows still say whose they are, paced like the rest. A file already gone is fine; one that could not be removed stops the delete
  // here, with nothing else touched, so that a row is never left gone with its face still stored.
  const pictures = { removed: 0, missing: 0, failed: 0 };
  const faces = plan.items.visitorroster.filter((/** @type {{ pictureUrl?: string }} */ guest) => guest.pictureUrl);
  if (faces.length > 0) {
    console.info('Results: delete session, guest pictures', faces.length);
    await data.runPaced(faces, async (/** @type {{ id: string, pictureUrl: string }} */ guest) => {
      const gone = await data.removeGuestPicture(guest.pictureUrl, guest);
      if (gone.removed) pictures.removed += 1; else if (gone.missing) pictures.missing += 1; else pictures.failed += 1;
    }, { ...(concurrency ? { concurrency } : {}), gapMs });
    if (pictures.failed > 0) return { deleted, total: plan.total, leftovers: [], left: plan.total, refused: null, pictures };
  }
  /** @type {{ list: string, id: string }[]} */
  const leftovers = [];
  let done = 0;
  let refused = null;
  onProgress({ done, total: plan.total });
  for (const { list } of SESSION_OWNED) {
    const found = plan.items[list];
    if (found.length === 0) continue;
    console.info(`Results: delete session, ${list}`, found.length);
    const { results } = await data.runPaced(found, async (/** @type {{ key: unknown }} */ item) => {
      await data.deleteByKey(list, item.key);
      done += 1;
      onProgress({ done, total: plan.total });
    }, { ...(concurrency ? { concurrency } : {}), gapMs });
    deleted[list] = 0;
    found.forEach((/** @type {{ id: string }} */ item, index) => {
      const result = results[index];
      if (result?.ok) deleted[list] += 1;
      else {
        leftovers.push({ list, id: item.id });
        if (result && /** @type {any} */ (result).error?.status === 403) refused = data.sharePointListTitles()[list];
      }
    });
    if (leftovers.length > 0) break;
  }
  const left = plan.total - done;
  console.info('Results: delete session, done', { sessionId, deleted, left });
  return { deleted, total: plan.total, leftovers, left, refused, pictures };
}
