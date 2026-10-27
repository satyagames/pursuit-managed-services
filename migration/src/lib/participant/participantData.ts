/**
 * The one door between the participant screens and answer storage.
 *
 * Screens never call dataService for answers. They call `recordAnswer` as each answer is given and
 * `flushActivity` once, on the activity's last step.
 *
 * Since Phase 4 a participant's answers live in a Responses item of their own (its AppId is their
 * track id), written only by their own device:
 *  - `recordAnswer` keeps the answer in memory and in sessionStorage and starts saving it in the
 *    background. It never waits for the network, so Next is instant. For a graded question it is
 *    called at the FIRST pick, so a reload cannot hand out a fresh first try.
 *  - Each save is one request carrying the whole answer list. One request is in flight at a time
 *    and answers given meanwhile ride on the next. A failed save is retried with backoff, waiting
 *    at least as long as a Retry-After asks.
 *  - `flushActivity` waits until everything is saved. If the save fails every try it throws
 *    `SaveFailedError` and the answers stay exactly where they were, so the screen can offer
 *    "Retry" without losing anything.
 *  - `restoreAnswers` is the single indexed read, once per page load, that brings back what the
 *    server holds: after a reload, or on another device.
 * The mechanics are in lib/participant/answer-store.js (no DOM, unit-tested); this file binds them to the
 * current visit.
 */
import * as dataService from '../data/dataService.js';
import { SaveFailedError, createAnswerStore } from './answer-store.js';
import { currentActivities, experience, knownActivities, sessionCheck, type Activity } from './experience.svelte.js';
import { afterId, beforeId, isCheckActivity, nextStep, restartedIds, STEP_PATHS } from './confidence-check.js';
import { isRecordSettled } from './pager-logic.js';
import { participant } from './session.svelte.js';
import { loadFailureText } from './sign-in.js';

export { SaveFailedError };

export type Answer = string | string[];

/** What is kept for each answer. */
export type AnswerRecord = {
  questionId: string;
  /** The answer the participant is on (for a graded question that may be a wrong one). */
  answer: Answer;
  /** Their first pick. For a graded question this, not `answer`, is what counts, so results show first tries. */
  firstAnswer: Answer;
  attempts: number;
  /** Graded questions: was the FIRST try right. `null` for a question that is not graded. */
  correct: boolean | null;
  answeredAt: string;
};

type AnswerInput = Omit<AnswerRecord, 'answeredAt'>;

type Visit = { trackId: string; sessionId: string; clientId: string | null; restartedAt: string | null };
type SavedItem = { responses: AnswerRecord[]; ref: unknown } | null;

function sessionStore(): Storage | null {
  try { return globalThis.sessionStorage ?? null; } catch { return null; } // blocked storage: memory alone still works
}

const store = createAnswerStore({
  api: dataService as unknown as Parameters<typeof createAnswerStore>[0]['api'],
  storage: sessionStore(),
});

/** The visit this page is on, or null (Welcome before a visit starts, and the facilitator's preview). */
function currentVisit(): Visit | null {
  const { clientTrackId, sessionId, clientId, restartedAt } = participant;
  return clientTrackId && sessionId ? { trackId: clientTrackId, sessionId, clientId, restartedAt: restartedAt ?? null } : null;
}

// When the connection comes back, whatever is still waiting is sent without the participant doing anything.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    const visit = currentVisit();
    if (visit) store.resume(visit);
  });
}

/** The answer that counts for a record: the first try for a graded question. */
const countedAnswer = (record: AnswerRecord): Answer => (record.correct === null ? record.answer : record.firstAnswer);

// ---- Recording and saving --------------------------------------------------------------------

/**
 * Keeps one answer and starts saving it. Replaces the earlier record for the same question, but
 * never its first answer. Does nothing without a visit, which is what makes the admin preview
 * (no track) incapable of writing.
 */
export function recordAnswer(sectionId: string, input: AnswerInput): void {
  const visit = currentVisit();
  if (visit) store.record(visit, sectionId, input);
}

/**
 * The server answered a moment ago (the page's own look reached it): send whatever is still waiting. Without this, answers whose
 * save had failed every try stayed on the device until somebody tapped Retry, and a participant who had walked away was left out.
 */
export function resumePendingSaves(): void {
  const visit = currentVisit();
  if (visit) store.resume(visit);
}

/** What to say when a screen could not be loaded (lib/participant/sign-in.js), with the data service's own idea of "cannot be reached". */
export const loadFailure = (cause: unknown, fallback: string): string => loadFailureText(cause, dataService.isUnreachable as (error: unknown) => boolean, fallback);

/** The answers recorded for this activity that the server does not have yet. */
export function pendingAnswers(sectionId: string): AnswerRecord[] {
  const visit = currentVisit();
  return visit ? store.pending(visit, sectionId) as AnswerRecord[] : [];
}

/** What this device holds for a question, saved or not: how a half-answered graded question is put back after a reload. */
export function answerRecord(questionId: string): AnswerRecord | null {
  const visit = currentVisit();
  return visit ? store.recordFor(visit, questionId) as AnswerRecord | null : null;
}

/** Forgets everything held on this device for a track. The server's copy is not touched. */
export function discardPendingAnswers(trackId: string | null = participant.clientTrackId): void {
  if (trackId) store.discard(trackId);
}

/**
 * Waits until the visit's answers are all saved. Resolves with this activity's records (empty if
 * the device recorded none). Concurrent calls share one save.
 */
export function flushActivity(sectionId: string): Promise<AnswerRecord[]> {
  const visit = currentVisit();
  if (!visit || !visit.clientId) return Promise.reject(new SaveFailedError('There is no active visit to save to.'));
  return store.flush(visit, sectionId) as Promise<AnswerRecord[]>;
}

// ---- Reading ---------------------------------------------------------------------------------

/**
 * Reads the server's copy of the visit's answers: one request, once per page load. App.svelte
 * calls it during boot; pass the item when the boot sequence has read it already.
 */
export function restoreAnswers(preloaded?: SavedItem, visit: Visit | null = currentVisit()): Promise<void> {
  return visit ? store.restore(visit, preloaded) : Promise.resolve();
}

/** What the server has for this visit: questionId -> the answer that counts. Empty without a visit. */
export async function getSavedAnswers(): Promise<Map<string, Answer>> {
  const visit = currentVisit();
  if (!visit) return new Map();
  const saved = await store.saved(visit) as AnswerRecord[];
  return new Map(saved.filter(isRecordSettled).map((record) => [record.questionId, countedAnswer(record)]));
}

/**
 * Has this visit answered anything yet, saved or still waiting? Decides "Click here to begin" or
 * "Activities". Pass a visit to ask about one that is not the current one yet (a staff member's
 * earlier visit on Welcome).
 */
export async function hasAnyAnswer(visit: { sessionId: string; trackId: string; restartedAt?: string | null } | null = null): Promise<boolean> {
  const target = visit
    ? { trackId: visit.trackId, sessionId: visit.sessionId, clientId: participant.clientId, restartedAt: visit.restartedAt ?? null }
    : currentVisit();
  if (!target) return false;
  if (store.hasPending(target)) return true;
  return (await store.saved(target)).length > 0;
}

/**
 * The enabled activities in order, each flagged `complete` once this visit has a saved, final
 * answer to every one of its questions. `answeredQuestionIds` is what a screen that has just saved
 * already knows, so the next screen does not wait to show it. It reads the activities (one
 * request) and nothing else: the visit's answers are already on the device. `withSession` reads
 * the session beside them, for a hub that stays open (see experience.currentActivities).
 */
export async function getProgress(sessionId: string, clientTrackId: string, answeredQuestionIds: string[] | null = null, { withSession = false } = {}): Promise<{
  sections: { id: string; title: string; description?: string; complete: boolean; questionIds?: string[] }[];
  allComplete: boolean;
}> {
  const visit = currentVisit();
  const own = visit && visit.trackId === clientTrackId ? visit : { trackId: clientTrackId, sessionId, clientId: participant.clientId, restartedAt: null };
  const [{ sections }, saved] = await Promise.all([
    currentActivities({ withSession }),
    Array.isArray(answeredQuestionIds) ? Promise.resolve([] as AnswerRecord[]) : store.saved(own) as Promise<AnswerRecord[]>,
  ]);
  return progressOf(sections, Array.isArray(answeredQuestionIds) ? answeredQuestionIds : saved.filter(isRecordSettled).map((record) => record.questionId));
}

/**
 * getProgress() with no read at all: the activities as the page holds them (boot, the hub's last read, or the timer: experience.adoptWatch)
 * and this visit's answers from the device. The hub draws from this as it arrives (Phase 10j), and again when its read or the timer reports a
 * change. `answeredQuestionIds` is what a screen that has just saved already knows (as getProgress takes it).
 */
export async function getKnownProgress(sessionId: string, clientTrackId: string, answeredQuestionIds: string[] | null = null) {
  if (Array.isArray(answeredQuestionIds)) return progressOf(knownActivities(), answeredQuestionIds);
  const visit = currentVisit();
  const own = visit && visit.trackId === clientTrackId ? visit : { trackId: clientTrackId, sessionId, clientId: participant.clientId, restartedAt: null };
  const saved = await store.saved(own) as AnswerRecord[];
  return progressOf(knownActivities(), saved.filter(isRecordSettled).map((record) => record.questionId));
}

function progressOf(sections: Activity[], answeredQuestionIds: string[]) {
  const answered = new Set(answeredQuestionIds);
  // (The client's confidence check is never one of the guest's activities: Phase 20.)
  const enabled = sections
    .filter((section) => section.enabled === true && !isCheckActivity(section))
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
    .map((section) => {
      const questionIds = section.questionIds ?? [];
      return {
        id: section.id, title: section.title, description: section.description ?? undefined, questionIds,
        complete: questionIds.length > 0 && questionIds.every((id) => answered.has(id)),
      };
    });
  return { sections: enabled, allComplete: enabled.length > 0 && enabled.every((section) => section.complete) };
}

/**
 * getProgress() without asking the server: the activities as the page last read them. Only for
 * offering something (the completion screen's "Finish"); the finale checks properly before it shows.
 */
export const knownProgress = (answeredQuestionIds: string[]) => progressOf(knownActivities(), answeredQuestionIds);

/**
 * How many graded questions among `questionIds` this visit got right on the first try, from its
 * own saved answers. Each answer was graded when it was given, so no question has to be read again.
 */
export async function firstTrySummary(questionIds: string[]): Promise<{ right: number; total: number }> {
  const visit = currentVisit();
  if (!visit) return { right: 0, total: 0 };
  const wanted = new Set(questionIds);
  const graded = (await store.saved(visit) as AnswerRecord[]).filter((record) => wanted.has(record.questionId) && record.correct !== null && isRecordSettled(record));
  return { right: graded.filter((record) => record.correct === true).length, total: graded.length };
}

// ---- The confidence check, Before and After (Phase 20) ----------------------------------------

export type CheckPhase = 'before' | 'after';
type Step = ReturnType<typeof nextStep>;

/** The id a phase's answer is kept under: the check question's id with @before or @after. */
const checkIdOf = (phase: CheckPhase, questionId: string) => (phase === 'before' ? beforeId(questionId) : afterId(questionId));

/** Which of the check's two answers this device holds for the visit (saved or still waiting). */
function checkAnswerIds(): string[] {
  const check = sessionCheck();
  if (!check) return [];
  return [beforeId(check.questionId), afterId(check.questionId)].filter((id) => answerRecord(id) !== null);
}

/**
 * Where the visit goes next (lib/participant/confidence-check.js nextStep): from what the page holds, no request. `allDone` is what the
 * caller knows of the activities; `finishing` says the guest asked to finish. With the check off it is the hub, or Thank you, as before.
 */
export function visitStep({ allDone = false, finishing = false }: { allDone?: boolean; finishing?: boolean } = {}): Step {
  return nextStep({ check: sessionCheck(), answers: checkAnswerIds(), allDone, flow: experience.activityFlow, sessionEnded: experience.ended, finishing });
}

/** visitStep()'s screen. */
export const visitStepPath = (input: { allDone?: boolean; finishing?: boolean } = {}): string => STEP_PATHS[visitStep(input)];

/** The guest's answer to one phase of the check on this device: the option they chose, or null. */
export function checkAnswer(phase: CheckPhase): string | null {
  const check = sessionCheck();
  const held = check ? answerRecord(checkIdOf(phase, check.questionId)) : null;
  return held && typeof held.answer === 'string' ? held.answer : null;
}

const draftKey = (phase: CheckPhase) => `cec-check-pick:${participant.clientTrackId ?? 'none'}:${phase}`;

/** The card picked on a check screen and not yet confirmed, kept in this tab so a reload shows it picked; null if none. */
export function checkPick(phase: CheckPhase): string | null {
  try { return sessionStore()?.getItem(draftKey(phase)) ?? null; } catch { return null; }
}

/** Keeps (or, with null, forgets) the card picked on a check screen. Not an answer: nothing is saved until the guest confirms. */
export function setCheckPick(phase: CheckPhase, optionId: string | null): void {
  try {
    if (optionId) sessionStore()?.setItem(draftKey(phase), optionId);
    else sessionStore()?.removeItem(draftKey(phase));
  } catch { /* blocked storage: the pick lives on the screen alone */ }
}

/**
 * Keeps the guest's answer to the check and starts saving it, as any answer is kept (recordAnswer): it never waits for the network, so
 * Continue is instant, and a save that fails is kept on this iPad and retried. Does nothing without a visit or a check (the preview).
 */
export function recordCheckAnswer(phase: CheckPhase, optionId: string): void {
  const check = sessionCheck();
  if (!check) return;
  recordAnswer(check.section.id, { questionId: checkIdOf(phase, check.questionId), answer: optionId, firstAnswer: optionId, attempts: 1, correct: null });
  setCheckPick(phase, null);
}

/**
 * The ids a restart at an activity drops here: that activity's questions, and the check's After (asked again once the activity is done
 * again); Before stays.
 */
export const restartedQuestionIds = (questionIds: string[]): string[] => restartedIds(questionIds, sessionCheck());

// ---- Restart ---------------------------------------------------------------------------------

/**
 * The facilitator restarted this visit: all of it (`questionIds` null) or one activity's questions.
 * Call it with the track's new restartedAt BEFORE putting that on `participant`, so the answers in
 * scope are gone from this device, and from its server copy, by the time a screen looks.
 */
export function applyRestart(restartedAt: string | null, questionIds: string[] | null): Promise<void> {
  const visit = currentVisit();
  return visit ? store.restart({ ...visit, restartedAt }, questionIds) : Promise.resolve();
}
