// Results trees for the Live display's one-page PDF and PowerPoint (Phase 11b: scripts/test-results-export.js, and for looking at the files by hand).
// Each is built with lib/results/results-tally.js buildResults from records written out here, as lib/results/session-results.js hands a session to the exports.
//
//   krogerResults()  Kroger on the real site, 16 Oct 2026: five visits that answered 9, 8, 0, 8 and 9 of nine questions, and a sixth whose answers
//                    could not be read.
//   vineResults()    VJR's run on the PCOE site in miniature (scripts/results-charts-fixtures.js VINE_PEOPLE): four people, one question of each kind.
//   bigResults()     60 people and 15 questions of every kind, answers of 90 characters: the sizes the layout must hold.
//   oddResults()     words the one-pager's font cannot draw (another script, emoji), a comment of 1,000 characters, an answer to an option that has gone.

import { buildResults } from '../migration/src/lib/results/results-tally.js';
import { VINE_PEOPLE, vineContent } from './results-charts-fixtures.js';

const at = (minute) => new Date(Date.UTC(2026, 9, 16, 10, 0) + minute * 60_000).toISOString();
const answer = (track, questionId, value, minute) => ({ questionId, clientTrackId: track, answer: value, timestamp: at(minute) });

export function krogerResults() {
  const tracks = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'].map((id, index) => ({ id, createdAt: at(index), participantName: `Guest ${index + 1}` }));
  const answeredBy = { k1: 9, k2: 8, k3: 0, k4: 8, k5: 9 };
  const questionIds = Array.from({ length: 9 }, (_, index) => `kq${index + 1}`);
  const results = buildResults({
    session: { id: 'kroger-2026-10-16', clientId: 'c-kroger', date: '2026-10-16', sectionIds: ['ks'] }, tracks,
    sections: [{ id: 'ks', title: 'Kroger', enabled: true, questionIds }],
    questions: questionIds.map((id) => ({ id, type: 'single-select', prompt: `Question ${id.slice(2)}`, optionIds: [`${id}-a`, `${id}-b`] })),
    options: questionIds.flatMap((id) => [{ id: `${id}-a`, label: 'Yes' }, { id: `${id}-b`, label: 'No' }]),
    answers: Object.entries(answeredBy).flatMap(([track, count]) => questionIds.slice(0, count).map((questionId, index) => answer(track, questionId, `${questionId}-a`, index))),
  });
  return { ...results, unreadable: [{ id: 'k6', reason: 'not-json' }] };
}

export function vineResults() {
  const content = vineContent();
  const tracks = VINE_PEOPLE.map((person, index) => ({ id: `t-${person.key}`, createdAt: at(index), ...(person.name ? { participantName: person.name } : {}) }));
  const firstPick = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value.first : value);
  const answers = VINE_PEOPLE.flatMap((person, index) => Object.entries(person.answers).map(([questionId, value]) => answer(`t-${person.key}`, questionId, firstPick(value), index)));
  return buildResults({ session: { id: 'vine-2026-10-15', clientId: content.client.id, date: '2026-10-15', sectionIds: content.sections.map((section) => section.id) }, tracks, sections: content.sections, questions: content.questions, options: content.options, answers });
}

/** A seeded choice: the same session every run. */
function chooser(seed) {
  let state = seed;
  return (n) => { state = (state * 1103515245 + 12345) % 2147483648; return state % n; };
}

const KINDS = ['single-select', 'multi-select', 'true-false', 'confidence-continuum', 'ranked-voting', 'open-text-feedback'];
const long = (text) => `${text} ${'and a good deal more besides, said at length '.repeat(3)}`.slice(0, 90).trim();

export function bigResults() {
  const pick = chooser(11);
  const tracks = Array.from({ length: 60 }, (_, index) => ({ id: `b${index + 1}`, createdAt: at(index), participantName: `Person ${index + 1}` }));
  const questions = [];
  const options = [];
  for (let index = 0; index < 15; index += 1) {
    const type = KINDS[index % KINDS.length];
    const id = `bq${index + 1}`;
    const count = type === 'true-false' ? 2 : type === 'open-text-feedback' ? 0 : type === 'confidence-continuum' ? 5 : 8;
    const own = Array.from({ length: count }, (_, at) => ({
      id: `${id}-${at}`, questionId: id,
      label: type === 'true-false' ? (at === 0 ? 'True' : 'False') : type === 'confidence-continuum' ? ['Not at all', 'A little', 'Somewhat', 'Quite', 'Completely'][at] : long(`Answer ${at + 1} of question ${index + 1}`),
      value: type === 'true-false' ? at === 0 : type === 'confidence-continuum' ? at + 1 : null,
      correct: type === 'single-select' || type === 'true-false' ? at === 0 : null,
    }));
    options.push(...own);
    questions.push({ id, type, prompt: long(`Question ${index + 1}: what do you think of the way the work is planned and shared`), optionIds: own.map((option) => option.id), own });
  }
  const answers = [];
  tracks.forEach((track, person) => {
    for (const question of questions) {
      if (pick(10) === 0) continue; // about one in ten left unanswered
      const ids = question.own.map((option) => option.id);
      let value;
      if (question.type === 'open-text-feedback') value = ['Delivery was slow and the price was high.', 'Great team, clear plan, more training please.', 'Price matters most to us; delivery second.'][pick(3)];
      else if (question.type === 'multi-select') value = ids.filter(() => pick(3) === 0).concat(ids[pick(ids.length)]).filter((id, at, all) => all.indexOf(id) === at);
      else if (question.type === 'ranked-voting') value = [...ids].sort(() => pick(3) - 1);
      else value = ids[Math.min(ids.length - 1, pick(ids.length) % (pick(2) + 2))];
      answers.push(answer(track.id, question.id, value, person));
    }
  });
  return buildResults({
    session: { id: 'big-2026-10-16', clientId: 'c-big', date: '2026-10-16', sectionIds: ['big1', 'big2'] }, tracks,
    sections: [
      { id: 'big1', title: long('The first activity, which has a long title'), enabled: true, questionIds: questions.slice(0, 8).map((question) => question.id) },
      { id: 'big2', title: 'The second activity', enabled: true, questionIds: questions.slice(8).map((question) => question.id) },
    ],
    questions: questions.map(({ own, ...question }) => question), options, answers,
  });
}

export function oddResults() {
  const tracks = ['o1', 'o2', 'o3'].map((id, index) => ({ id, createdAt: at(index), participantName: ['Søren Kjær', '山田 太郎', 'Zoë 😀'][index] }));
  const comment = `Très bien 東京 😀 ${'a very long comment that goes on and on '.repeat(25)}`.slice(0, 1000);
  return buildResults({
    session: { id: 'odd-2026-10-16', clientId: 'c-odd', date: '2026-10-16', sectionIds: ['os'] }, tracks,
    sections: [{ id: 'os', title: 'Ünïcode 東京', enabled: true, questionIds: ['oq1', 'oq2'] }],
    questions: [
      { id: 'oq1', type: 'single-select', prompt: 'Which city? 東京 or Paris 😀', optionIds: ['oa', 'ob'] },
      { id: 'oq2', type: 'open-text-feedback', prompt: 'Anything else?', optionIds: [] },
    ],
    options: [{ id: 'oa', label: '東京 (Tokyo)', correct: true }, { id: 'ob', label: 'Paris 😀', correct: false }],
    answers: [answer('o1', 'oq1', 'oa', 1), answer('o2', 'oq1', 'ob', 2), answer('o3', 'oq1', 'gone', 3), answer('o1', 'oq2', comment, 4), answer('o2', 'oq2', 'さようなら', 5)],
  });
}
