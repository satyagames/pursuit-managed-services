// Who answered a Results chart's question and how the shares are shown (Phase 11a): the names and pictures of who picked what, answer counts
// and whole percentages that add up to 100 by the largest-remainder rule. Moved out of results-chart-model.js unchanged (Prompt 44), which
// passes these names on; every number a chart shows still comes from that model. Plain JS, no DOM.

import { nameParticipants, ownerOf, withNamesHidden } from './participant-names.js';

// ---- Who answered ---------------------------------------------------------------------------------------------------------------------

/**
 * Who is who, by the key an answer carries (its visit, see ownerOf): the names lib/results/participant-names.js gives, so the chart's names are the
 * Results rows' and the leader report's. `visits` and `roster` are what Admin → Results reads besides the tracks (lib/admin/admin-results.js
 * readNameSources); without them a staff sign-in is "Unnamed participant N" (a guest's QR name is on the track itself). With `hide` (the Hide names
 * switch, Prompt 21 decision B) everyone is "Guest N" in the same order.
 * @param {{ tracks?: any[], answers?: TallyAnswer[], visits?: any[], roster?: any[] }} records
 * @param {{ hide?: boolean }} [shown]
 * @returns {Map<string, string>}
 */
export function namesFor({ tracks = [], answers = [], visits = [], roster = [] }, { hide = false } = {}) {
  const named = nameParticipants({ tracks, visits, roster, answers: answers.map((answer) => ({ clientTrackId: answer.clientTrackId ?? null, clientId: answer.clientId ?? null })) });
  const people = hide ? withNamesHidden(named) : named;
  return new Map(people.map((person) => [person.key, person.name]));
}

/**
 * Whose picture is whose, by visit (Prompt 23): the same people as namesFor, and none at all when names are hidden, so a chart that is given this shows the silhouette for everyone
 * else. Only the admin view of Results calls this: the wall, the exports and the dashboard never do.
 * @param {{ tracks?: any[], visits?: any[], roster?: any[] }} records @param {{ hide?: boolean }} [shown] @returns {Map<string, string>}
 */
export function picturesFor({ tracks = [], visits = [], roster = [] }, { hide = false } = {}) {
  if (hide) return new Map();
  return new Map(nameParticipants({ tracks, visits, roster }).filter((person) => person.pictureUrl).map((person) => [person.key, person.pictureUrl]));
}

/** Every answer of a results tree ({ sections: [{ questions: [{ responses }] }] }), for namesFor(). @param {{ sections?: { questions?: TallyQuestion[] }[] }} results */
export const answersOf = (results) => (results.sections ?? []).flatMap((section) => (section.questions ?? []).flatMap((question) => question.responses ?? []));

/** "1 person", "2 people". @param {number} count */
export const people = (count) => `${count} ${count === 1 ? 'person' : 'people'}`;

const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** A count in running words as the language guide (p. 40) has it: one to nine spelled out, 10 and more as figures with commas. @param {number} count */
export const numberWords = (count) => (Number.isInteger(count) && count >= 1 && count <= 9 ? SMALL[count] : count.toLocaleString('en-US'));

/** Under this many answers a share is said to rest on few (Phase 13): a percentage of three people must not read like one of three hundred. */
export const FEW_ANSWERS = 5;

/** "Only four answers." under FEW_ANSWERS; nothing at that many or more, and nothing for none (NO_ANSWERS says so). @param {number} answered */
export const fewAnswersLine = (answered) => (answered > 0 && answered < FEW_ANSWERS ? `Only ${numberWords(answered)} ${answered === 1 ? 'answer' : 'answers'}.` : '');

export const byTime = (a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')) || a.name.localeCompare(b.name);

/** @param {TallyAnswer} answer @param {Map<string, string> | null} names */
export function whoOf(answer, names) {
  if (!names) return null;
  const key = ownerOf(answer);
  if (key === null) return null;
  return { key, name: names.get(key) ?? 'Unnamed participant', at: answer.timestamp ?? null };
}

/**
 * "N answers from M iPads" over `questions` (Phase 11a-2, part D, VJR's choice of 16 Oct 2026): N is the answers to them (each question's `respondents`),
 * and M the visits those answers came from (ownerOf), each once. A visit that answered nothing is not counted (on the real site Kroger's header said "34
 * answers from 5 iPads" with one visit that had answered nothing: it says 4 now), nor one whose answers could not be read (they are not among the answers,
 * and the notice above them says so). The Live display's header, each Results card's summary and (since Phase 11b) the Live display's one-page PDF and PowerPoint
 * say it this way; the leader report's "participants" are every visit, on purpose.
 * @param {TallyQuestion[]} questions
 */
export function answerCounts(questions) {
  const visits = new Set();
  let answers = 0;
  for (const question of questions) {
    answers += Number(question.respondents ?? (question.responses ?? []).length) || 0;
    for (const response of question.responses ?? []) {
      const key = ownerOf(response);
      if (key !== null) visits.add(key);
    }
  }
  return { answers, visits: visits.size };
}

/** "34 answers from 4 iPads", and in the singular "1 answer from 1 iPad" (Phase 11b: it said "1 answers from 1 iPads"). @param {{ answers: number, visits: number }} counts */
export const answersFrom = ({ answers, visits }) => `${answers} ${answers === 1 ? 'answer' : 'answers'} from ${visits} ${visits === 1 ? 'iPad' : 'iPads'}`;

// ---- Shares -----------------------------------------------------------------------------------------------------------------------------

/**
 * Whole percentages of `total` that add up to exactly 100 (the largest-remainder rule): each share is rounded down, and the points left over
 * go to the largest remainders, the larger count first and then the earlier one. All 0 when nobody answered. When the counts add up to less
 * than `total` (answers to an option that has gone), pass that rest as the last count: it takes its share of the 100 and the others stay honest.
 * @param {number[]} counts @param {number} total
 */
export function wholePercents(counts, total) {
  if (!(total > 0)) return counts.map(() => 0);
  const exact = counts.map((count) => (count * 100) / total);
  const floors = exact.map((value) => Math.floor(value + 1e-9));
  let left = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, rest: value - floors[index], count: counts[index] }))
    .sort((a, b) => b.rest - a.rest || b.count - a.count || a.index - b.index);
  for (const { index, rest } of order) {
    if (left <= 0) break;
    if (rest <= 1e-9) continue;
    floors[index] += 1;
    left -= 1;
  }
  return floors;
}

/** "X and Y", "X, Y and Z". @param {string[]} items */
export const listOf = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

export const labelOf = (option) => (typeof option.label === 'string' && option.label.trim() ? option.label.trim() : 'Untitled answer');
