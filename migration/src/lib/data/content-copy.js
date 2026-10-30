// Content per client and copying activities (dataService.js section 6; Phase 17 cut it out unchanged): an activity's questions and
// options in the fewest reads, the plan of a copy, copying, duplicating and deleting activities, and adding activities to the live
// session. Reads and writes activities, questions and options, paced (common.js runPaced).

import { READ_CHUNK, chunked, distinct } from './encoding.js';
import { createItem, deleteItem, getItem, getItems, queryItems, updateItem } from './core.js';
import { PACE, runPaced } from './common.js';
import { failure, getAppSettings } from './records.js';
import { readLists } from './today-clients.js';
import { COPIED_FROM } from '../schema/aop-rules.js';
/** @typedef {import('./common.js').PaceOptions} PaceOptions */

// ============================================================================
// 6. Content per client, copying activities, and guests in bulk
// ============================================================================
// Added for Phase 5b (migration/src/admin/AdminContent.svelte and AdminGuests.svelte, through
// migration/src/lib/admin/admin-content.js). No SharePoint column is used beyond the thirteen of Phase 4: an activity's order is
// Sections.Order, which has always been there; an activity's client is Sections.ClientId; a
// question's layout and an option's picture are Questions.Layout and Options.ImageUrl.
//
// Every function below is built from the generic list calls both adapters implement (createItem,
// updateItem, deleteItem, queryItems, readLists), so the local Express adapter and SharePoint take
// the same path; scripts/test-admin-content.js runs each one against both and compares.
//
// Bulk work is paced: `runPaced` keeps a few writes in flight, spaces them on SharePoint, and the
// adapter itself already waits out a 429 or 503 for as long as Retry-After asks.

/** @typedef {{ id: string, title: string, order?: number, enabled?: boolean, questionIds?: string[], clientId?: string | null, description?: string | null, industryTags?: string[] }} SectionRecord */
/** @typedef {{ id: string, type: string, prompt: string, sectionId?: string, optionIds?: string[], order?: number, layout?: string | null, criteria?: unknown[] }} QuestionRecord */
/** @typedef {{ id: string, questionId: string, label: string, value?: any, correct?: boolean | null, imageUrl?: string | null }} OptionRecord */
/** @typedef {{ sections: SectionRecord[], questions: QuestionRecord[], options: OptionRecord[] }} ActivityContent */

/**
 * The questions and options of some activities, in the fewest reads: one $batch on SharePoint
 * (questions and options side by side, 20 ids to a read), plain parallel reads locally. `sections`
 * are the activity records already in hand. Resolves to { questions, options }, unordered; an
 * activity's own order is section.questionIds and each question's optionIds.
 * @param {SectionRecord[]} sections
 * @returns {Promise<{ questions: QuestionRecord[], options: OptionRecord[] }>}
 */
export async function readActivityContent(sections) {
  const questionIds = distinct(sections.flatMap((section) => section.questionIds ?? []));
  if (questionIds.length === 0) return { questions: [], options: [] };
  const groups = chunked(questionIds, READ_CHUNK);
  const answers = await readLists([
    ...groups.map((ids) => ({ list: 'questions', where: { id: ids } })),
    ...groups.map((ids) => ({ list: 'options', where: { questionId: ids } })),
  ]);
  return { questions: answers.slice(0, groups.length).flat(), options: answers.slice(groups.length).flat() };
}

// ---- Copying and duplicating activities ----------------------------------------------------------

/** What joins an id to the client it was copied for: `sec-trivia~c-dominos`. A copy of a copy starts again from the original's id. */
export const COPY_SEPARATOR = '~';
/** The id a copy of `sourceId` gets in `toClientId`. The same every time, so copying twice cannot make two. */
export const copyIdFor = (sourceId, toClientId) => `${String(sourceId).split(COPY_SEPARATOR)[0]}${COPY_SEPARATOR}${toClientId}`;

const titleKey = (title) => String(title ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

/** `Title (copy)`, then `Title (copy 2)`, ... the first that is not among `taken`. */
export function copyTitle(title, taken) {
  const used = new Set([...taken].map(titleKey));
  for (let number = 1; ; number += 1) {
    const candidate = `${title} (copy${number === 1 ? '' : ` ${number}`})`;
    if (!used.has(titleKey(candidate))) return candidate;
  }
}

/**
 * What copying would do, worked out without a single request, so the screen can show it and the
 * copy then does exactly that. `sections` are the activities to copy in the order they should land;
 * `questions` and `options` are everything those activities hold (readActivityContent). `targetSections`
 * are what the destination client has now.
 *
 *   ids: 'derived'  each record's id comes from its source's and the client (copyIdFor), so a second
 *                   copy meets the first and does nothing more. An activity is skipped when the client
 *                   already has one with that title, or one that was copied from it before (it may
 *                   have been renamed since).
 *   ids: 'random'   a duplicate: new ids, and `retitle` gives it the title `X (copy)`.
 *
 * Copies start NOT live, are appended after the client's last activity in the order given, and keep
 * their questions in the order they had. A question's layout, an option's picture and an activity's
 * description travel only when they have a value, so a site whose list lacks that column is never asked
 * to store one. Resolves to { items, skipped, totals }, where an item is
 * { source, section, questions, options } holding the records to create.
 * @param {ActivityContent & { toClientId: string, targetSections?: SectionRecord[], ids?: 'derived' | 'random', retitle?: boolean, makeId?: () => string, fromClientName?: string, toClientName?: string }} plan
 */
export function planCopy({ sections, questions, options, toClientId, targetSections = [], ids = 'derived', retitle = false, makeId = () => crypto.randomUUID(), fromClientName = '', toClientName = '' }) {
  const questionIndex = new Map(questions.map((question) => [question.id, question]));
  const optionsOf = new Map();
  for (const option of options) optionsOf.set(option.questionId, [...(optionsOf.get(option.questionId) ?? []), option]);
  const takenTitles = new Set(targetSections.map((section) => titleKey(section.title)));
  const takenIds = new Set(targetSections.map((section) => section.id));
  let order = Math.max(0, ...targetSections.map((section) => Number(section.order) || 0));
  const items = [];
  const skipped = [];
  const notices = new Set();
  const newId = (sourceId) => (ids === 'random' ? makeId() : copyIdFor(sourceId, toClientId));

  for (const source of sections) {
    const sectionId = newId(source.id);
    const title = retitle ? copyTitle(source.title, [...takenTitles]) : source.title;
    if (!retitle && takenTitles.has(titleKey(title))) {
      skipped.push({ source, reason: 'title-exists', message: `"${source.title}" is already one of this client's activities.` });
      continue;
    }
    if (ids === 'derived' && takenIds.has(sectionId)) {
      skipped.push({ source, reason: 'already-copied', message: `"${source.title}" was copied here before (it may have been renamed since).` });
      continue;
    }
    takenTitles.add(titleKey(title));
    takenIds.add(sectionId);
    order += 1;

    const copiedOptions = [];
    const copiedQuestions = [];
    for (const questionId of source.questionIds ?? []) {
      const question = questionIndex.get(questionId);
      if (!question) continue; // the activity lists a question that is gone: nothing to copy
      const copiedQuestionId = newId(question.id);
      const ordered = (question.optionIds ?? []).map((id) => (optionsOf.get(question.id) ?? []).find((option) => option.id === id)).filter(Boolean);
      const copiedIds = [];
      for (const option of ordered) {
        const copiedId = newId(option.id);
        copiedIds.push(copiedId);
        copiedOptions.push({
          id: copiedId, questionId: copiedQuestionId, label: option.label, value: option.value, correct: option.correct ?? null,
          ...(typeof option.imageUrl === 'string' && option.imageUrl.trim() ? { imageUrl: option.imageUrl } : {}),
        });
      }
      copiedQuestions.push({
        id: copiedQuestionId, sectionId, type: question.type, prompt: question.prompt, optionIds: copiedIds, order: question.order ?? copiedQuestions.length + 1,
        ...(question.layout ? { layout: question.layout } : {}),
        // (Prompt 23: an Art of the Possible question's criteria travel, and so do its rows, which are its options, so the Designer starts from something. Rows copied to
        // another client are that client's only once they are saved there: the copy's Layout, which this type has no other use for, says whose they are until then.)
        ...(Array.isArray(question.criteria) && question.criteria.length ? { criteria: question.criteria } : {}),
        ...(question.type === 'art-of-the-possible' && ids === 'derived' ? { layout: `${COPIED_FROM}${String(fromClientName).slice(0, 200)}` } : {}),
      });
      if (question.type === 'art-of-the-possible' && ids === 'derived') notices.add(`This list is ${fromClientName || 'another client'}'s. Replace the sub-processes before using it${toClientName ? ` for ${toClientName}` : ''}.`);
    }
    items.push({
      source,
      section: {
        id: sectionId, title, order, enabled: false, industryTags: [...(source.industryTags ?? [])], questionIds: copiedQuestions.map((question) => question.id),
        clientId: toClientId,
        ...(typeof source.description === 'string' && source.description.trim() ? { description: source.description } : {}),
      },
      questions: copiedQuestions,
      options: copiedOptions,
    });
  }
  return {
    items,
    skipped,
    notices: [...notices],
    totals: {
      activities: items.length,
      questions: items.reduce((sum, item) => sum + item.questions.length, 0),
      options: items.reduce((sum, item) => sum + item.options.length, 0),
    },
  };
}

/** Creates a record, or, if its id is taken (a failed earlier run that could not clean up), writes the same content over it. */
async function createOrOverwrite(list, record) {
  try {
    await createItem(list, record);
  } catch (error) {
    if (error.status !== 409) throw error;
    const { id, ...fields } = record;
    await updateItem(list, id, fields);
  }
}

/**
 * Makes the activities of a client part of the live session's tally. Results are counted over
 * session.sectionIds, which Go live fills; an activity made while its client is already live would
 * otherwise show no results. Does nothing when another client (or none) is live. Resolves to the
 * session, or null.
 */
export async function addSectionsToLiveSession(clientId, sectionIds) {
  const settings = await getAppSettings();
  if (!settings?.activeSessionId) return null;
  const session = await getItem('sessions', settings.activeSessionId);
  if (!session || session.clientId !== clientId || session.status === 'completed') return null;
  const missing = sectionIds.filter((id) => !(session.sectionIds ?? []).includes(id));
  return missing.length ? updateItem('sessions', session.id, { sectionIds: [...(session.sectionIds ?? []), ...missing] }) : session;
}

/**
 * Admin: copies activities, with their questions and options, to `toClientId`. See planCopy() for
 * what a copy is. Each activity is written options first, then questions, then the activity record
 * itself, so nothing refers to a record that is not there yet and the activity appears to
 * participants and in the admin only when it is whole. If any write of an activity fails, what that
 * activity had written is deleted again: a failed copy leaves no half-built activity. A run that
 * stops (two activities in a row failed, or `signal` was aborted) leaves the rest not attempted.
 * Running it again copies only what is missing: activities that are whole are skipped, the others
 * are written again.
 *
 * Pass `content` ({ sections, questions, options }, as the screen showed it) to copy exactly that;
 * otherwise `sectionIds` are read. `onProgress({ written, total, activity, activityIndex, activities })`
 * is called after each record.
 * @param {{ toClientId: string, sectionIds?: string[], content?: ActivityContent | null, ids?: 'derived' | 'random', retitle?: boolean, fromClientName?: string, onProgress?: (step: { written: number, total: number, activity: string, activityIndex: number, activities: number }) => void } & PaceOptions} options
 * Resolves to
 *   { client, copied: [{ source, section, questions, options }], skipped, failed: [{ source, error }],
 *     notAttempted: [source], totals, stopped, liveSessionSynced }, where liveSessionSynced is true when the
 * client is live and its session now counts the copies, null when there was nothing to do (it is not live), and
 * false when the session could not be updated.
 */
export async function copyActivities({
  toClientId, sectionIds = [], content = null, ids = 'derived', retitle = false, fromClientName = '',
  concurrency = PACE.concurrency, gapMs = null, onProgress = () => {}, signal = null,
} = {}) {
  const client = await getItem('clients', toClientId);
  if (!client) throw failure('client-missing', 'That client no longer exists.');
  if (client.status === 'archived') throw failure('client-archived', `${client.name} is archived. Restore it before adding activities.`);
  let source = content;
  if (!source) {
    const sections = await getItems('sections', sectionIds);
    source = { sections, ...(await readActivityContent(sections)) };
  }
  const targetSections = await queryItems('sections', { clientId: toClientId });
  const plan = planCopy({ ...source, toClientId, targetSections, ids, retitle, fromClientName, toClientName: client.name });
  const copied = [];
  const failed = [];
  let stopped = null;
  let streak = 0;
  let written = 0;
  const total = plan.totals.activities + plan.totals.questions + plan.totals.options;

  for (const [position, item] of plan.items.entries()) {
    if (signal?.aborted) { stopped = 'aborted'; break; }
    const made = [];
    const tick = (list, record) => {
      made.push([list, record.id]);
      written += 1;
      onProgress({ written, total, activity: item.section.title, activityIndex: position + 1, activities: plan.items.length });
    };
    try {
      for (const [list, records] of [['options', item.options], ['questions', item.questions]]) {
        const { results } = await runPaced(records, async (record) => { await createOrOverwrite(list, record); tick(list, record); }, { concurrency, gapMs, stopAfterFailures: 1, signal });
        const bad = results.find((result) => result && !result.ok);
        if (bad) throw bad.error;
        if (results.some((result) => result === undefined)) throw failure('copy-stopped', 'The copy was stopped.');
      }
      try {
        await createItem('sections', item.section);
      } catch (error) {
        if (error.status !== 409) throw error;
        // The activity is already there whole (another admin, or an earlier run that was not told): nothing to undo.
        written -= made.length;
        made.length = 0;
        plan.skipped.push({ source: item.source, reason: 'already-copied', message: `"${item.source.title}" was copied here a moment ago.` });
        continue;
      }
      tick('sections', item.section);
      copied.push(item);
      streak = 0;
    } catch (error) {
      for (const [list, id] of made.reverse()) await deleteItem(list, id).catch(() => {});
      written -= made.length;
      if (error.code === 'copy-stopped') { stopped = 'aborted'; break; }
      failed.push({ source: item.source, error });
      streak += 1;
      if (streak >= 2) { stopped = 'failures'; break; }
    }
  }
  const attempted = new Set([...copied, ...failed].map((entry) => entry.source.id));
  const notAttempted = plan.items.map((item) => item.source).filter((entry) => !attempted.has(entry.id)
    && !plan.skipped.some((skip) => skip.source.id === entry.id));
  let liveSessionSynced = null;
  if (copied.length) {
    try { liveSessionSynced = (await addSectionsToLiveSession(toClientId, copied.map((item) => item.section.id))) ? true : null; } catch { liveSessionSynced = false; }
  }
  return { client, copied, skipped: plan.skipped, failed, notAttempted, totals: plan.totals, stopped, liveSessionSynced };
}

/**
 * Admin: a copy of one of a client's activities in the same client, titled `X (copy)` and not live. Resolves like copyActivities().
 * @param {string} sectionId
 * @param {PaceOptions & { onProgress?: (step: { written: number, total: number, activity: string, activityIndex: number, activities: number }) => void }} [options]
 */
export async function duplicateActivity(sectionId, options = {}) {
  const section = await getItem('sections', sectionId);
  if (!section) throw failure('activity-missing', 'That activity no longer exists.');
  if (!section.clientId) throw failure('activity-unassigned', 'Give this activity a client before duplicating it.');
  return copyActivities({ ...options, toClientId: section.clientId, sectionIds: [sectionId], ids: 'random', retitle: true });
}

/**
 * Admin: deletes an activity, its questions and their options. The activity record goes first, so
 * participants stop seeing it at once; the questions and options follow. Anything that could not be
 * deleted is reported in `leftovers` (nothing refers to it, and it does no harm). Recorded answers
 * are not touched. Pass `content` ({ questions, options }) when the screen already holds it.
 * Resolves to { deleted: { questions, options }, leftovers: [{ list, id }] }.
 * @param {string} sectionId
 * @param {{ content?: { questions: QuestionRecord[], options: OptionRecord[] } | null } & PaceOptions} [options]
 */
export async function deleteActivity(sectionId, { content = null, concurrency = PACE.concurrency, gapMs = null } = {}) {
  const section = await getItem('sections', sectionId);
  if (!section) return { deleted: { questions: 0, options: 0 }, leftovers: [] };
  const held = content ?? await readActivityContent([section]);
  const questions = held.questions.filter((question) => (section.questionIds ?? []).includes(question.id));
  const options = held.options.filter((option) => questions.some((question) => question.id === option.questionId));
  await deleteItem('sections', sectionId);
  const leftovers = [];
  const counts = { questions: 0, options: 0 };
  for (const [list, records] of [['options', options], ['questions', questions]]) {
    const { results } = await runPaced(records, (record) => deleteItem(list, record.id), { concurrency, gapMs, stopAfterFailures: records.length || 1 });
    records.forEach((record, index) => {
      if (results[index]?.ok) counts[list] += 1;
      else leftovers.push({ list, id: record.id });
    });
  }
  if (section.clientId) {
    // The live session no longer counts it.
    const settings = await getAppSettings();
    const session = settings?.activeSessionId ? await getItem('sessions', settings.activeSessionId) : null;
    if (session?.clientId === section.clientId && (session.sectionIds ?? []).includes(sectionId)) {
      await updateItem('sessions', session.id, { sectionIds: session.sectionIds.filter((id) => id !== sectionId) }).catch(() => {});
    }
  }
  return { deleted: counts, leftovers };
}
