// One participant's answers on this device, and the saving of them. No DOM and no Svelte, so
// scripts/test-participant-storage.js can drive it with `node --test` against the mocked
// SharePoint REST and against the local server. lib/participantData.ts is the only importer in
// the app: it binds this to the current visit and to sessionStorage.
//
// How answers are stored (PMS-IMPLEMENTATION-PLAN.md 4.3, in git history at 7347c72): one Responses item per participant,
// whose AppId is their track id. This device is its only writer, so:
//   - the first save creates the item (and falls back to an update if the unique AppId says it
//     is there already);
//   - every later save is ONE request: the whole answer list, written blind, with no read and no
//     version check;
//   - saves are coalesced: one request in flight, and answers given meanwhile ride on the next;
//   - a save that fails is retried with backoff, waiting at least as long as a Retry-After asks;
//   - recording an answer never waits for the network (Next stays instant), and `flush()` is how
//     a screen waits for everything to be saved.
//
// What is held where: `records` is every answer known for the visit, saved or not. `dirty` names
// the ones the server does not have yet, and only those are mirrored to storage (the key
// `cec-answers:<track>`), so a reload can finish saving them. The server's copy is read once per
// page load (`restore`), on the indexed TrackId.

import { MAX_TEXT_LENGTH } from './pager-logic.js';

/** @typedef {string | string[]} Answer */
/** @typedef {{ questionId: string, answer: Answer, firstAnswer: Answer, attempts: number, correct: boolean | null, answeredAt: string }} AnswerRecord */
/** @typedef {{ trackId: string, sessionId: string, clientId: string | null, restartedAt?: string | null }} Visit */
/**
 * @typedef {object} AnswerApi The three dataService functions this needs.
 * @property {(trackId: string) => Promise<{ responses: AnswerRecord[], ref: unknown } | null>} getParticipantResponses
 * @property {(input: { trackId: string, sessionId: string, clientId: string | null, responses: AnswerRecord[] }, ref?: unknown) => Promise<{ ref: unknown, responses: AnswerRecord[] }>} saveParticipantResponses
 * @property {(existing: AnswerRecord[], incoming: AnswerRecord[]) => AnswerRecord[]} mergeAnswerRecords
 * @property {(error: unknown) => boolean} [isUnreachable]
 */

export const STORAGE_PREFIX = 'cec-answers:';
/** Tries per save, counting the first. */
export const SAVE_ATTEMPTS = 3;
/** Waits before the 2nd and 3rd try. A Retry-After that asks for longer wins. */
export const BACKOFF_MS = [400, 1200];
/** After a save has failed every try, a new answer does not start another round sooner than this. */
export const COOL_DOWN_MS = 5000;
/** The longest a Retry-After is obeyed for; a longer one is treated as this. */
export const MAX_RETRY_AFTER_MS = 30_000;

/** Every attempt to save failed. The answers are still held; `flush()` again to retry. */
export class SaveFailedError extends Error {
  /** @param {string} [message] @param {{ cause?: unknown }} [options] */
  constructor(message = "Couldn't save your answers.", options) {
    super(message, options);
    this.name = 'SaveFailedError';
  }
}

const strip = ({ questionId, answer, firstAnswer, attempts, correct, answeredAt }) => ({ questionId, answer, firstAnswer, attempts, correct, answeredAt });
const capText = (value) => (typeof value === 'string' && value.length > MAX_TEXT_LENGTH ? value.slice(0, MAX_TEXT_LENGTH) : value);

/**
 * @param {object} options
 * @param {AnswerApi} options.api
 * @param {{ getItem(key: string): string | null, setItem(key: string, value: string): void, removeItem(key: string): void } | null} [options.storage]
 * @param {() => number} [options.now]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export function createAnswerStore({ api, storage = null, now = () => Date.now(), sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }) }) {
  /**
   * @typedef {object} State
   * @property {Visit} visit
   * @property {string | null} restartedAt
   * @property {Map<string, AnswerRecord & { sectionId: string | null }>} records
   * @property {Set<string>} dirty
   * @property {unknown} ref
   * @property {boolean} loaded
   * @property {Promise<void> | null} loading
   * @property {Promise<void> | null} draining
   * @property {boolean} rewrite  The server copy must be rewritten even with nothing new (after a restart).
   * @property {number} retryAt   No save at all before this time: the server asked for the wait (Retry-After).
   * @property {number} quietUntil No background save before this time: the last round failed every try.
   */
  /** @type {Map<string, State>} */
  const states = new Map();

  // ---- Storage: only what the server does not have yet ---------------------------------------

  /** @param {string} trackId */
  function readStored(trackId) {
    try {
      const parsed = JSON.parse(storage?.getItem(`${STORAGE_PREFIX}${trackId}`) ?? 'null');
      if (parsed && typeof parsed === 'object' && parsed.sections && typeof parsed.sections === 'object') return parsed;
    } catch {
      // Blocked or damaged storage: this tab's memory still works.
    }
    return null;
  }

  /** @param {State} state */
  function persist(state) {
    if (!storage) return;
    /** @type {Record<string, AnswerRecord[]>} */
    const sections = {};
    for (const questionId of state.dirty) {
      const record = state.records.get(questionId);
      if (record) (sections[record.sectionId ?? ''] ??= []).push(strip(record));
    }
    try {
      const key = `${STORAGE_PREFIX}${state.visit.trackId}`;
      if (Object.keys(sections).length === 0) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify({ restartedAt: state.restartedAt, sections }));
    } catch {
      // Quota or private mode: the in-memory copy is still there.
    }
  }

  /**
   * The state for a visit. A track whose restartedAt differs from what was held was restarted by
   * the facilitator while this page was away: its unsaved answers are from before the restart and
   * must not come back, so the state starts again from whatever the server has.
   * @param {Visit} visit
   * @returns {State}
   */
  function use(visit) {
    const restartedAt = visit.restartedAt ?? null;
    let state = states.get(visit.trackId);
    if (state && state.restartedAt === restartedAt) {
      state.visit = { ...state.visit, ...visit };
      return state;
    }
    const restarted = Boolean(state);
    state = { visit: { ...visit }, restartedAt, records: new Map(), dirty: new Set(), ref: state?.ref ?? null, loaded: false, loading: null, draining: null, rewrite: false, retryAt: 0, quietUntil: 0 };
    const stored = restarted ? null : readStored(visit.trackId);
    if (stored && (stored.restartedAt ?? null) === restartedAt) {
      for (const [sectionId, records] of Object.entries(stored.sections)) {
        for (const record of Array.isArray(records) ? records : []) {
          if (!record || typeof record.questionId !== 'string') continue;
          state.records.set(record.questionId, { ...strip(record), sectionId: sectionId || null });
          state.dirty.add(record.questionId);
        }
      }
    }
    states.set(visit.trackId, state);
    persist(state); // drops stored answers that belong to before a restart
    return state;
  }

  // ---- The server's copy ----------------------------------------------------------------------

  /**
   * Lays what the server holds under what this device holds. A first answer the server already
   * has is kept (mergeAnswerRecords), so nothing here can rewrite a first try.
   * @param {State} state
   * @param {{ responses: AnswerRecord[], ref: unknown } | null} item
   */
  function adopt(state, item) {
    if (item) {
      state.ref = item.ref;
      // The server's answers first and in its order, then anything only this device has: the
      // stored list stays in the order the questions were answered.
      const records = new Map();
      for (const saved of item.responses) {
        const held = state.records.get(saved.questionId);
        if (!held) { records.set(saved.questionId, { ...strip(saved), sectionId: null }); continue; }
        const [merged] = api.mergeAnswerRecords([saved], [strip(held)]);
        records.set(saved.questionId, { ...merged, sectionId: held.sectionId });
        if (JSON.stringify(merged) === JSON.stringify(strip(saved))) state.dirty.delete(saved.questionId);
      }
      for (const [questionId, held] of state.records) if (!records.has(questionId)) records.set(questionId, held);
      state.records = records;
    }
    state.loaded = true;
    persist(state);
  }

  /** @param {State} state */
  function load(state) {
    if (state.loaded) return Promise.resolve();
    state.loading ??= (async () => {
      try {
        const item = await api.getParticipantResponses(state.visit.trackId);
        if (states.get(state.visit.trackId) === state && !state.loaded) adopt(state, item);
      } finally {
        state.loading = null;
      }
    })();
    return state.loading;
  }

  // ---- Saving ----------------------------------------------------------------------------------

  const retryable = (error) => (api.isUnreachable ? api.isUnreachable(error) : true);
  /** @param {unknown} error */
  const askedWait = (error) => {
    const asked = /** @type {{ retryAfter?: number }} */ (error)?.retryAfter;
    return typeof asked === 'number' && Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_RETRY_AFTER_MS) : 0;
  };

  /**
   * One pass: everything known, in one write. Retries with backoff. On success the answers it
   * carried are no longer dirty, unless one was answered again while the request was out.
   * @param {State} state
   */
  async function saveOnce(state) {
    await load(state);
    const carried = new Map([...state.dirty].map((questionId) => [questionId, state.records.get(questionId)?.answeredAt]));
    const responses = [...state.records.values()].map(strip);
    const rewriting = state.rewrite;
    let failure;
    for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await sleep(Math.max(BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1], askedWait(failure)));
      try {
        const { trackId, sessionId, clientId } = state.visit;
        const saved = await api.saveParticipantResponses({ trackId, sessionId, clientId, responses }, state.ref);
        state.ref = saved.ref;
        // A create that met an existing item merged with it: take what the item held that this device did not.
        for (const record of saved.responses ?? []) {
          if (!state.records.has(record.questionId)) state.records.set(record.questionId, { ...strip(record), sectionId: null });
        }
        for (const [questionId, answeredAt] of carried) {
          const held = state.records.get(questionId);
          if (!held || held.answeredAt === answeredAt) state.dirty.delete(questionId);
        }
        if (rewriting) state.rewrite = false;
        persist(state);
        return;
      } catch (error) {
        failure = error;
        if (!retryable(error)) break;
      }
    }
    state.retryAt = now() + askedWait(failure);
    state.quietUntil = now() + Math.max(COOL_DOWN_MS, askedWait(failure));
    throw failure;
  }

  /**
   * Saves until nothing is left to save. One of these runs at a time per visit; a call while one
   * is running joins it (and shares its outcome), and whatever was recorded meanwhile goes out on
   * its next pass. A background save stays quiet for a while after a round that failed, so a run
   * of answers during an outage is not a run of failing requests; an explicit one (a flush) only
   * waits for as long as the server asked.
   * @param {State} state
   * @param {boolean} explicit
   */
  function drain(state, explicit) {
    if (state.draining) return state.draining;
    if (state.dirty.size === 0 && !state.rewrite) return Promise.resolve();
    if (!explicit && now() < state.quietUntil) return Promise.resolve();
    const run = (async () => {
      const wait = state.retryAt - now();
      if (wait > 0) await sleep(wait);
      while (state.dirty.size > 0 || state.rewrite) await saveOnce(state);
    })();
    state.draining = run;
    // Cleared from outside the run, so it is never cleared before it is set. Anything recorded in
    // the instant between the run's last look and this is picked up here.
    const done = () => {
      if (state.draining === run) state.draining = null;
      if (state.dirty.size > 0 || state.rewrite) kick(state);
    };
    run.then(done, done);
    return run;
  }

  /** A background save: failures are kept for the next flush, never thrown at a tap handler. @param {State} state */
  function kick(state) {
    void drain(state, false).catch(() => {});
  }

  // ---- Public API ------------------------------------------------------------------------------

  return {
    /**
     * Reads the server's copy for a visit, once: the single indexed read that restores progress on
     * a reload or another device. Pass `preloaded` (the item, or null for "there is none") when
     * the boot sequence has read it already.
     * @param {Visit} visit
     * @param {{ responses: AnswerRecord[], ref: unknown } | null} [preloaded]
     */
    async restore(visit, preloaded) {
      const state = use(visit);
      if (state.loaded) return;
      if (preloaded !== undefined) adopt(state, preloaded);
      else await load(state);
      if (state.dirty.size > 0) kick(state); // answers a reload interrupted: finish saving them
    },

    /**
     * Keeps an answer and starts saving it. Never waits. A first answer already held for the
     * question is kept, whatever the caller passes.
     * @param {Visit} visit
     * @param {string} sectionId
     * @param {Omit<AnswerRecord, 'answeredAt'>} input
     */
    record(visit, sectionId, input) {
      const state = use(visit);
      const held = state.records.get(input.questionId);
      state.records.set(input.questionId, {
        questionId: input.questionId,
        answer: capText(input.answer),
        firstAnswer: held ? held.firstAnswer : capText(input.firstAnswer),
        attempts: input.attempts,
        correct: held ? held.correct : input.correct,
        answeredAt: new Date(now()).toISOString(),
        sectionId,
      });
      state.dirty.add(input.questionId);
      persist(state);
      kick(state);
    },

    /**
     * Waits until every answer of the visit is saved. Resolves with the records of `sectionId`
     * that this device recorded (all of them saved by now). Throws SaveFailedError when the save
     * fails every try; nothing is lost, and calling again retries.
     * @param {Visit} visit
     * @param {string} sectionId
     * @returns {Promise<AnswerRecord[]>}
     */
    async flush(visit, sectionId) {
      const state = use(visit);
      try {
        await drain(state, true);
      } catch (cause) {
        throw new SaveFailedError("Couldn't save your answers.", { cause });
      }
      return [...state.records.values()].filter((record) => record.sectionId === sectionId).map(strip);
    },

    /** Starts a background save if anything is waiting (the connection came back). @param {Visit} visit */
    resume(visit) {
      const state = use(visit);
      state.quietUntil = 0;
      if (state.dirty.size > 0 || state.rewrite) kick(state);
    },

    /** Answers of an activity recorded here that the server does not have yet. @param {Visit} visit @param {string} sectionId @returns {AnswerRecord[]} */
    pending(visit, sectionId) {
      const state = use(visit);
      return [...state.dirty].map((questionId) => state.records.get(questionId))
        .filter((record) => record?.sectionId === sectionId).map((record) => strip(/** @type {AnswerRecord} */ (record)));
    },

    /** Is anything held for the visit that the server does not have? @param {Visit} visit */
    hasPending(visit) {
      return use(visit).dirty.size > 0;
    },

    /** This device's record for a question, saved or not; null if there is none. @param {Visit} visit @param {string} questionId @returns {AnswerRecord | null} */
    recordFor(visit, questionId) {
      const record = use(visit).records.get(questionId);
      return record ? strip(record) : null;
    },

    /** Every answer the server holds for the visit (reads it first if that has not happened). @param {Visit} visit @returns {Promise<AnswerRecord[]>} */
    async saved(visit) {
      const state = use(visit);
      await load(state);
      return [...state.records.values()].filter((record) => !state.dirty.has(record.questionId)).map(strip);
    },

    /**
     * The facilitator restarted the visit: all of it (`questionIds` null) or one activity. The
     * answers in scope are dropped here and the server's copy is rewritten without them, which
     * also undoes a save of this device's that landed after the facilitator's own clean-up.
     * @param {Visit} visit The visit with its new restartedAt.
     * @param {string[] | null} questionIds
     */
    async restart(visit, questionIds) {
      const state = states.get(visit.trackId);
      if (!state) { use(visit); return; }
      if (state.draining) await state.draining.catch(() => {});
      if (!state.loaded) await load(state).catch(() => {});
      for (const questionId of [...state.records.keys()]) {
        if (questionIds === null || questionIds.includes(questionId)) {
          state.records.delete(questionId);
          state.dirty.delete(questionId);
        }
      }
      state.restartedAt = visit.restartedAt ?? null;
      state.visit = { ...state.visit, ...visit };
      state.rewrite = state.ref !== null || state.records.size > 0;
      persist(state);
      if (state.rewrite) kick(state);
    },

    /** Forgets everything held for a track, saved or not. @param {string} trackId */
    discard(trackId) {
      states.delete(trackId);
      try { storage?.removeItem(`${STORAGE_PREFIX}${trackId}`); } catch { /* nothing to clean */ }
    },
  };
}
