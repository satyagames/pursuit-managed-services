// Who owns what (Prompt 21, Phase 4): the write guard cannot tell from a write alone which client an item belongs to (a question names its activity, an
// option its question, a session's start names only the session), so the page remembers the owners of what it reads and writes: a session's client and
// date, an activity's client, a question's activity. The guard then (1) holds a write to the item's real client or session, and (2) checks every read of
// a scoped role (readProblem): a list that belongs to places is read only by naming places the person holds. An owner not known is nobody's: a scoped
// role never gets the benefit of the doubt; a global role does not need an owner. Plain JS with no DOM; lib/access/guard.js uses it.
import { inPeriod, reachOf } from './scope.js';

/** A client id no assignment names: the owner of an item whose owner is not known. */
export const UNKNOWN_OWNER = '?unknown';

/** Lists whose items belong to places, and so are read only by naming them. The others (app settings, the access lists) are read by everyone. */
const OWNED = new Set(['clients', 'sessions', 'sections', 'questions', 'options', 'tracks', 'uservisitlogs', 'qrtokens', 'visitorroster', 'responses']);
const BY_SESSION = new Set(['tracks', 'uservisitlogs', 'qrtokens', 'visitorroster', 'responses']);

/** The owners this page knows. */
export function newOwners() {
  const sessions = new Map();
  const sections = new Map();
  const questions = new Map();
  return {
    sessions, sections, questions,
    /** Remembers what a read found (decoded records). @param {string} list @param {any[]} rows */
    learn(list, rows) {
      for (const row of rows ?? []) {
        if (!row?.id) continue;
        if (list === 'sessions' && row.clientId) sessions.set(row.id, { clientId: row.clientId, date: row.date ?? '' });
        else if (list === 'sections' && row.clientId) {
          sections.set(row.id, row.clientId);
          for (const questionId of row.questionIds ?? []) if (!questions.has(questionId)) questions.set(questionId, row.id); // (an activity names its questions)
        }
        else if (list === 'questions' && row.sectionId) questions.set(row.id, row.sectionId);
      }
    },
    clientOfSession: (id) => sessions.get(id)?.clientId,
    clientOfSection: (id) => sections.get(id),
    clientOfQuestion: (id) => sections.get(questions.get(id)),
  };
}

const idsOf = (where, key) => (where?.[key] === undefined || where?.[key] === null ? null : [where[key]].flat().map(String));

/**
 * Whether a person with this access may read `list` by `where`: false when a scoped role would fetch a place it does not hold, or does not say which.
 * @param {ReturnType<typeof newOwners>} owners @param {any} access @param {string} list @param {Record<string, unknown> | undefined} where @param {{ now?: Date }} [options]
 */
export function mayRead(owners, access, list, where, options) {
  if (!OWNED.has(list)) return true;
  const reach = reachOf(access, options);
  if (reach.all) return true;
  const clientOk = (clientId) => reach.clientIds.has(clientId) || reach.sessionClients.has(clientId)
    || (reach.periods.length > 0 && [...owners.sessions.values()].some((entry) => entry.clientId === clientId && inPeriod(reach, entry.date)));
  const sessionOk = (id) => {
    const known = owners.sessions.get(id);
    return reach.sessionIds.has(id) || Boolean(known && (reach.clientIds.has(known.clientId) || inPeriod(reach, known.date)));
  };
  const every = (ids, test) => ids !== null && ids.every(test);
  if (list === 'clients') return every(idsOf(where, 'id'), clientOk) || (idsOf(where, 'id') === null && reach.periods.length > 0);
  if (list === 'sessions') {
    const byClient = idsOf(where, 'clientId');
    const byId = idsOf(where, 'id');
    if (byClient) return byClient.every((id) => reach.clientIds.has(id));
    if (byId) return byId.every((id) => reach.sessionIds.has(id) || Boolean(owners.sessions.get(id) && sessionOk(id)));
    return reach.periods.length > 0;
  }
  if (list === 'sections') {
    if (idsOf(where, 'clientId')) return every(idsOf(where, 'clientId'), clientOk);
    return every(idsOf(where, 'id'), (id) => owners.clientOfSection(id) !== undefined && clientOk(owners.clientOfSection(id)));
  }
  if (list === 'questions') {
    if (idsOf(where, 'sectionId')) return every(idsOf(where, 'sectionId'), (id) => owners.clientOfSection(id) !== undefined && clientOk(owners.clientOfSection(id)));
    return every(idsOf(where, 'id'), (id) => owners.clientOfQuestion(id) !== undefined && clientOk(owners.clientOfQuestion(id)));
  }
  if (list === 'options') return every(idsOf(where, 'questionId'), (id) => owners.clientOfQuestion(id) !== undefined && clientOk(owners.clientOfQuestion(id)));
  if (BY_SESSION.has(list)) return every(idsOf(where, 'sessionId'), sessionOk);
  return false;
}
