// A session's results tree built from records already in hand: the Live display's own tally, so that its timer reads one feed
// (dataService.readLiveFeed) and not six requests. The arithmetic (counts, respondents, percent, Borda score) is the one the legacy
// pages' reader had in dataService.js; that function left in Phase 10c-2a, and scripts/test-live-display.js now holds this one to a
// tally worked out by hand, on both adapters. Since Phase 9b the Results screen and the exports use it too (lib/results/session-results.js), so
// that one damaged answer item does not stop them, and a ranked question is scored among the options it has now.
//
// Plain JS with JSDoc and no DOM.

/**
 * @typedef {{ id: string, [key: string]: any }} Row
 * @typedef {{ questionId: string, answer: unknown, [key: string]: any }} Answer
 */

const byId = (rows) => new Map(rows.map((row) => [String(row.id), row]));
const pick = (index, ids = []) => ids.map((id) => index.get(String(id))).filter(Boolean);

// Borda count for a ranked-voting question, among the options it has NOW (`optionIds`): with n of them, the one a person put
// highest earns n points, the next n-1, and so on. An option that was removed after people answered no longer holds a place, so
// what is left keeps its order and nobody's points fall below 1 (Phase 9a: a removed option used to cost the ones ranked under it).
const rankScore = (answers, optionId, optionIds) => answers.reduce((total, { answer }) => {
  const position = [answer].flat().filter((id) => optionIds.includes(id)).indexOf(optionId);
  return position === -1 ? total : total + (optionIds.length - position);
}, 0);

/**
 * A session's results tree: { session, tracks, sections: [{ ...section, questions: [{ ...question, responses, respondents,
 * options: [{ ...option, count, percent, score? }] }] }] }. The sections are in the order of `session.sectionIds`.
 * @param {{ session: Row, tracks: Row[], sections: Row[], questions: Row[], options: Row[], answers: Answer[] }} records
 */
export function buildResults({ session, tracks, sections, questions, options, answers }) {
  const questionIndex = byId(questions);
  const optionIndex = byId(options);
  return {
    session,
    tracks,
    sections: pick(byId(sections), session.sectionIds).map((section) => ({
      ...section,
      questions: pick(questionIndex, section.questionIds).map((question) => {
        const given = answers.filter((response) => response.questionId === question.id);
        const ranked = question.type === 'ranked-voting';
        const present = pick(optionIndex, question.optionIds);
        const presentIds = present.map((option) => option.id);
        const own = present.map((option) => ({
          ...option,
          count: given.filter((response) => [response.answer].flat().includes(option.id)).length,
          ...(ranked && { score: rankScore(given, option.id, presentIds) }),
        }));
        // What an option's share is measured against: everyone who answered, or all Borda points.
        const whole = ranked ? own.reduce((sum, option) => sum + option.score, 0) : given.length;
        return {
          ...question,
          responses: given,
          respondents: given.length,
          options: own.map((option) => ({ ...option, percent: whole === 0 ? 0 : ((ranked ? option.score : option.count) / whole) * 100 })),
        };
      }),
    })),
  };
}

/** The activities, questions and options a session's display is made from: what changes rarely, so it is read once and again only when it must be. */
export const STRUCTURE_MAX_AGE_MS = 5 * 60_000;

/**
 * Did the feed find the session's structure different from the one held? A different list of activities, or an activity switched
 * on or off, renamed, reordered or given another list of questions. (A question's own words and its options are re-read every
 * STRUCTURE_MAX_AGE_MS, and when the facilitator presses Refresh.)
 * @param {{ session: Row, sections: Row[] }} held
 * @param {{ session: Row | null, sections: Row[] | null }} feed
 */
export function structureChanged(held, feed) {
  if (!feed.session) return false;
  if (JSON.stringify(feed.session.sectionIds ?? []) !== JSON.stringify(held.session.sectionIds ?? [])) return true;
  const fingerprint = (section) => JSON.stringify([section.id, section.title, section.enabled === true, section.order ?? 0, section.questionIds ?? []]);
  const before = new Map(held.sections.map((section) => [section.id, fingerprint(section)]));
  return (feed.sections ?? []).some((section) => before.get(section.id) !== fingerprint(section));
}
