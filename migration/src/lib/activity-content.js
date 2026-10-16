// The questions and options of today's activities, held for as long as the participant page is open (Phase 10j). No DOM and no Svelte:
// lib/experience.svelte.ts makes the page's one, and lib/boot.js and scripts/test-participant-waits.js are handed it.
//
// Until Phase 10j the boot sequence read the first activity's questions before the first screen and kept them for five minutes, and every
// other activity read its own when it was opened, with "Loading activity..." in its place. Now one read fetches the questions and options of
// every enabled activity, once the first screen is up (or beside a QR code's claim, or when an activity is opened before any was read), and
// an activity opens from what is held. The read is the data layer's getSectionQuestions, handed every question id at once: 20 ids to an
// address (READ_CHUNK), a questions read and an options read for each 20, side by side.
//
// What is held is by question id, so an activity opens with exactly its own questions, in its own order, whatever was read together. A
// question an activity lists that is not held (the activity is new, or a question was added to it, or the read failed) is read when the
// activity opens, as it always was; a question that was asked for and did not come back is held as gone, so it is not asked for again. A read
// that is on its way is waited for, never sent twice. Content read afresh (the hub's refresh, Phase 10j part E) replaces what is held for the
// next opening; an activity already open keeps the questions it opened with.

/** How long a wait that remains goes before its loading line is shown (Phase 10j): a quick read does not flash one. */
export const LOADING_DELAY_MS = 300;
/** Ids to an address, as the data layer reads them (dataService.js READ_CHUNK): no address grows with the content. */
const PER_READ = 20;

/** The ids of the questions of `sections`, each once, as strings. */
const questionIdsOf = (sections) => [...new Set(sections.flatMap((section) => section?.questionIds ?? []).map(String))];
/** The activities a participant can open that have questions. */
const openable = (sections) => sections.filter((section) => section?.enabled === true && (section.questionIds ?? []).length > 0);

/** `list` in groups of `size`. */
const groupsOf = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, at) => list.slice(at * size, (at + 1) * size));

/**
 * @param {{ api: { getSectionQuestions(section: { questionIds?: string[] }): Promise<any[]>, readLists?(queries: { list: string, where?: object }[]): Promise<any[][]> } }} options
 *   The data layer (public/js/dataService.js).
 */
export function createActivityContent({ api }) {
  /** @type {Map<string, any>} question id -> the question, with its options, as last read */
  const held = new Map();
  /** Question ids that were asked for and did not come back. */
  const gone = new Set();
  /** @type {{ ids: Set<string>, promise: Promise<void> }[]} Reads on their way. */
  const reading = [];

  const known = (id) => held.has(id) || gone.has(id);
  /** Holds what a read brought back for `askedIds`: replaces what was held for each, and notes those that did not come back. */
  const adopt = (questions, askedIds) => {
    const found = new Set(questions.map((question) => String(question.id)));
    for (const question of questions) { held.set(String(question.id), question); gone.delete(String(question.id)); }
    for (const id of askedIds.map(String)) if (!found.has(id)) gone.add(id);
  };
  const beingRead = (id) => reading.some((read) => read.ids.has(id));

  /** Reads `ids` (none of them being read already) and holds what comes back. Rejects as the read does. */
  function read(ids) {
    const entry = { ids: new Set(ids), promise: Promise.resolve() };
    entry.promise = (async () => {
      try {
        adopt(await api.getSectionQuestions({ questionIds: ids }), ids);
      } finally {
        reading.splice(reading.indexOf(entry), 1);
      }
    })();
    reading.push(entry);
    return entry.promise;
  }

  return {
    /**
     * In the background: the questions and options of every enabled activity of `sections` that is neither held nor being read. Resolves when
     * that read is done (or there was nothing to read); never rejects (an activity reads its own when it is opened).
     * @param {any[]} sections
     */
    start(sections) {
      const missing = questionIdsOf(openable(sections)).filter((id) => !known(id) && !beingRead(id));
      if (!missing.length) return Promise.all(reading.map((entry) => entry.promise.catch(() => {}))).then(() => {});
      return read(missing).catch((cause) => { console.warn('Could not read the activities\' questions ahead.', cause); });
    },

    /**
     * In the background: the questions and options of every enabled activity of `sections`, read afresh whether held or not (the hub's
     * refresh). Never rejects.
     * @param {any[]} sections
     */
    refresh(sections) {
      const ids = questionIdsOf(openable(sections)).filter((id) => !beingRead(id));
      if (!ids.length) return Promise.resolve();
      return read(ids).catch((cause) => { console.warn('Could not read the activities\' questions again.', cause); });
    },

    /**
     * The questions of `section`, each with its options, in the order the activity lists them: at once when they are held, after the read on
     * its way when one is reading them, and otherwise read now, together with whatever else of `sections` is not held yet (an activity opened
     * before anything was read reads them all, once). Rejects when that read fails.
     * @param {any} section
     * @param {any[]} [sections]
     */
    async questionsOf(section, sections = []) {
      const ids = questionIdsOf([section]);
      for (;;) {
        const waiting = reading.filter((entry) => ids.some((id) => !known(id) && entry.ids.has(id)));
        if (!waiting.length) break;
        await Promise.all(waiting.map((entry) => entry.promise.catch(() => {})));
      }
      const missing = ids.filter((id) => !known(id));
      if (missing.length) {
        const others = questionIdsOf(openable(sections)).filter((id) => !known(id) && !beingRead(id) && !missing.includes(id));
        await read([...missing, ...others]);
      }
      return ids.filter((id) => held.has(id)).map((id) => held.get(id));
    },

    /**
     * The hub's read (Phase 10j, part E): the client's activities, and the questions and options of the enabled ones of `sections` (what the
     * page holds), read afresh together: ONE request where the site can batch (the data layer's readLists), side by side where it cannot. What
     * comes back replaces what is held, for the next opening. Resolves to the client's activities, in order; rejects as the read does, and then
     * what is held is as it was.
     * @param {string} clientId
     * @param {any[]} sections
     */
    async refreshWith(clientId, sections) {
      const ids = questionIdsOf(openable(sections));
      const groups = groupsOf(ids, PER_READ);
      const [owned, ...rest] = await /** @type {NonNullable<typeof api.readLists>} */ (api.readLists)([
        { list: 'sections', where: { clientId } },
        ...groups.map((group) => ({ list: 'questions', where: { id: group } })),
        ...groups.map((group) => ({ list: 'options', where: { questionId: group } })),
      ]);
      const options = new Map(rest.slice(groups.length).flat().map((option) => [String(option.id), option]));
      const questions = rest.slice(0, groups.length).flat().map((question) => ({
        ...question, options: (question.optionIds ?? []).map((id) => options.get(String(id))).filter(Boolean),
      }));
      // (A read the page started meanwhile, for an activity opened before this one came back, is held over by this one.)
      adopt(questions, ids);
      return [...owned].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
    },
  };
}
