// Sessions for the Results charts' tests (Phase 11a: scripts/migration-tests/results-charts*.spec.ts) and for looking at the charts by hand.
//
// VINE is VJR's run on the PCOE site (15 Oct 2026) in miniature: four people, one activity with a question of each of the six kinds, and the
// figures the brief names (a single choice split 1, 2, 1, 0; a confidence scale 0, 2, 0; a ranking whose points are 15, 15, 13, 9, 8). Mike A and
// two more are guests who scanned their own QR codes (so their names are on their visits, as on the real site); the fourth is a member of
// staff with no name recorded anywhere ("Unnamed participant 1"). Every one of them wrote a comment. The expected numbers are written out in
// the tests, not computed from this file.
//
// BIG is 60 people and 15 questions with long answers (90 characters), eight answers to a question, a 100-character name, accents and a name
// that starts with "=": the sizes the layout must hold.
//
// Both are played through the data service with seedSession() (lib: scripts/leader-report-fixtures.js): a guest scans a code, a member of staff
// begins at Welcome, and each saves answers as a device does.

import { seedSession } from './leader-report-fixtures.js';

export const VINE_DAY = '2026-10-15';
export const VINE = '1014 Vine Street, Cincinnati';
/** The four people's names as the charts' admin view shows them, in the order they joined. */
export const VINE_NAMES = Object.freeze(['Mike A', 'José Álvarez', '=SUM(A1)', 'Unnamed participant 1']);

const option = (id, label, correct = null, value = label) => ({ id, label, correct, value });
// A graded answer is [first pick, last pick, tries]; anything else is the answer itself.
const g = (first, final = first, attempts = first === final ? 1 : 2) => ({ first, final, attempts });

/** The client and its one activity of six questions. */
export function vineContent({ id = 'c-vine', name = 'Vine Street Partners', primary = '#7A1F5C' } = {}) {
  const questions = [
    { id: 'v1', type: 'single-select', prompt: 'Where is the head office?', options: [option('v1a', '5th Street, Cincinnati', false), option('v1b', VINE, true), option('v1c', 'Main Street, Dayton', false), option('v1d', 'Elm Street, Columbus', false)] },
    { id: 'v2', type: 'multi-select', prompt: 'Which channels do you use with customers?', options: [option('v2a', 'Email'), option('v2b', 'Chat'), option('v2c', 'Phone'), option('v2d', 'Fax')] },
    { id: 'v3', type: 'true-false', prompt: 'The store opens at 8 in the morning.', options: [option('v3t', 'True', true, true), option('v3f', 'False', false, false)] },
    { id: 'v4', type: 'confidence-continuum', prompt: 'How confident are you in the new plan?', options: [option('v4a', 'Not confident', null, 1), option('v4b', 'Moderately confident', null, 2), option('v4c', 'Very confident', null, 3)] },
    { id: 'v5', type: 'ranked-voting', prompt: 'Rank what matters most, most important first.', options: [option('v5a', 'Faster checkout'), option('v5b', 'Better pay'), option('v5c', 'More training'), option('v5d', 'New uniforms'), option('v5e', 'Longer breaks')] },
    { id: 'v6', type: 'open-text-feedback', prompt: 'Is there anything else you would like us to know?', options: [] },
  ];
  return {
    client: {
      id, name, slug: id.replace(/^c-/, ''), status: 'active', logoUrl: null, primaryColor: primary, secondaryColor: '#64748B', themeVersion: 1,
      theme: { version: 1, primary, accent: null, assets: { hero: null, logo: null, background: null, tile: null }, copy: { eventTitle: 'Vine Street Day', eventSubtitle: '', welcomeLine: '', logoText: name } },
    },
    sections: [{ id: 'vine-act', title: 'Getting to know us', order: 1, enabled: true, description: '', questionIds: questions.map((question) => question.id), clientId: id, industryTags: [] }],
    questions: questions.map(({ options: own, ...question }, order) => ({ ...question, sectionId: 'vine-act', optionIds: own.map((entry) => entry.id), order })),
    options: questions.flatMap((question) => question.options.map((entry) => ({ ...entry, questionId: question.id }))),
  };
}

// The rankings are A B C D E twice, B A C D E and E C D B A: points 15, 15, 13, 9, 8 (worked out in scripts/test-results-chart-model.js).
export const VINE_PEOPLE = Object.freeze([
  { key: 'mike', name: 'Mike A', guest: 'v-mike', answers: { v1: g('v1b'), v2: ['v2a', 'v2b'], v3: g('v3t'), v4: 'v4b', v5: ['v5a', 'v5b', 'v5c', 'v5d', 'v5e'], v6: 'The prices are too high, and delivery is slow.' } },
  { key: 'jose', name: 'José Álvarez', guest: 'v-jose', answers: { v1: g('v1b'), v2: ['v2a', 'v2c'], v3: g('v3t'), v4: 'v4b', v5: ['v5a', 'v5b', 'v5c', 'v5d', 'v5e'], v6: 'Price matters; delivery took 3 days.' } },
  { key: 'formula', name: '=SUM(A1)', guest: 'v-formula', answers: { v1: g('v1a', 'v1b'), v2: ['v2a'], v3: g('v3f', 'v3t'), v5: ['v5b', 'v5a', 'v5c', 'v5d', 'v5e'], v6: 'Delivery boxes arrived damaged. Don’t like the box.' } },
  { key: 'staff', name: null, answers: { v1: g('v1c', 'v1b'), v2: ['v2b', 'v2c'], v3: g('v3t'), v5: ['v5e', 'v5c', 'v5d', 'v5b', 'v5a'], v6: 'Friendly café, but prices high.' } },
]);

/** VINE, live (not ended), through `ds`. */
export const seedVine = (ds, { date = VINE_DAY } = {}) => seedSession(ds, { content: vineContent(), people: VINE_PEOPLE, end: false, date });

// ---- Sixty people, fifteen questions, long answers ---------------------------------------------------------------------------------

export const BIG_CHARTS = Object.freeze({ people: 60, questions: 15, options: 8, labelLength: 90, nameLength: 100 });
const FIRST = ['José', 'Zoë', 'Søren', 'Łukasz', 'Renée', 'Björn', 'Chloë', 'İpek', 'Ángela', 'Þór', 'Çağla', 'Mike'];
const LAST = ['Álvarez', 'Brontë', 'Kjær', 'Żółć', 'Müller', 'Ångström', 'Ó Súilleabháin', 'Škoda', 'Nuñez', 'Grønn'];
/** Exactly `length` characters: `text` and then words, cut at the length. */
const exactly = (text, length) => {
  let out = text;
  while (out.length < length) out += ' and then some more words';
  return out.slice(0, length).trimEnd().padEnd(length, '.');
};
/** Person `i`'s name: the first is a name that starts with "=", the second is 100 characters long, the rest have accents. */
export const bigChartsName = (i) => (i === 0 ? '=HYPERLINK("x") Ann Lee' : i === 1 ? exactly('Maximiliana Ottilie Bernadette Wilhelmina von Hohenzollern-Sigmaringen', BIG_CHARTS.nameLength) : `${FIRST[i % FIRST.length]} ${LAST[i % LAST.length]} ${i + 1}`);
/** Answer `n` of a long question: 90 characters. */
export const longLabel = (question, n) => exactly(`Answer ${n + 1} to question ${question}: a long answer that has to wrap onto a second line`, BIG_CHARTS.labelLength);

/** Three activities of five: single choice (some graded), multiple choice, true or false, two scales (5 and 7 steps), two rankings and two written answers. */
export function bigChartsContent({ id = 'c-wide', name = 'Northwind Trading' } = {}) {
  const kinds = ['single-select', 'single-select', 'multi-select', 'true-false', 'confidence-continuum', 'single-select', 'ranked-voting', 'multi-select', 'open-text-feedback', 'single-select', 'confidence-continuum', 'true-false', 'ranked-voting', 'single-select', 'open-text-feedback'];
  const sections = [0, 1, 2].map((index) => ({ id: `w-act-${index + 1}`, title: ['Company History', 'Products and People', 'Your Views'][index], order: index + 1, enabled: true, clientId: id, industryTags: [], description: '', questionIds: [] }));
  const questions = [];
  const options = [];
  kinds.forEach((type, number) => {
    const section = sections[Math.floor(number / 5)];
    const qid = `w${number + 1}`;
    let labels;
    let correct = null;
    if (type === 'true-false') { labels = ['True', 'False']; correct = 0; }
    else if (type === 'confidence-continuum') labels = number === 4 ? ['Not at all', 'A little', 'Somewhat', 'Mostly', 'Completely'] : ['1', '2', '3', '4', '5', '6', '7'];
    else if (type === 'ranked-voting') labels = Array.from({ length: 6 }, (_, n) => longLabel(number + 1, n));
    else if (type === 'open-text-feedback') labels = [];
    else { labels = Array.from({ length: BIG_CHARTS.options }, (_, n) => longLabel(number + 1, n)); if (type === 'single-select' && number % 2 === 0) correct = 2; }
    const own = labels.map((label, position) => ({
      id: `${qid}-o${position}`, questionId: qid, label,
      value: type === 'confidence-continuum' ? position + 1 : type === 'true-false' ? position === 0 : label,
      correct: correct === null ? null : position === correct,
    }));
    options.push(...own);
    questions.push({ id: qid, sectionId: section.id, type, prompt: `Question ${number + 1}: ${exactly('Which of these long answers best describes how the team should work together next year', 110)}`, optionIds: own.map((entry) => entry.id), order: section.questionIds.length });
    section.questionIds.push(qid);
  });
  return {
    client: {
      id, name, slug: id.replace(/^c-/, ''), status: 'active', logoUrl: null, primaryColor: '#0B6E4F', secondaryColor: '#64748B', themeVersion: 1,
      theme: { version: 1, primary: '#0B6E4F', accent: null, assets: { hero: null, logo: null, background: null, tile: null }, copy: { eventTitle: 'Northwind Day', eventSubtitle: '', welcomeLine: '', logoText: name } },
    },
    sections, questions, options,
  };
}

/** The sixty people, every one a guest by name, answering by a rule (person i picks answer (i + j) % n of question j, and so on). */
export function bigChartsPeople({ people = BIG_CHARTS.people } = {}) {
  const content = bigChartsContent();
  const optionsOf = (qid) => content.options.filter((entry) => entry.questionId === qid).map((entry) => entry.id);
  return Array.from({ length: people }, (_, i) => {
    const answers = {};
    content.questions.forEach((question, j) => {
      const ids = optionsOf(question.id);
      if (question.type === 'open-text-feedback') answers[question.id] = `${['Loved the trivia', 'The room was warm', 'More time for questions', 'Zoë’s table had the best answers'][(i + j) % 4]}, and thank you to the team. note-${i + 1}.`;
      else if (question.type === 'multi-select') answers[question.id] = [ids[(i + j) % ids.length], ids[(i * 3 + j + 1) % ids.length]].filter((value, at, all) => all.indexOf(value) === at);
      else if (question.type === 'ranked-voting') answers[question.id] = ids.map((_, at) => ids[(i + j + at) % ids.length]);
      else if (question.type === 'confidence-continuum') answers[question.id] = ids[(i * 7 + j) % ids.length];
      else if (content.options.some((entry) => entry.questionId === question.id && entry.correct === true)) answers[question.id] = g(ids[(i + j) % ids.length]);
      else answers[question.id] = ids[(i * 5 + j) % ids.length];
    });
    return { key: `p${i + 1}`, name: bigChartsName(i), guest: `v-big-${i + 1}`, answers };
  });
}

/** BIG, live (not ended), through `ds`. */
export const seedBigCharts = (ds, { date = VINE_DAY } = {}) => seedSession(ds, { content: bigChartsContent(), people: bigChartsPeople(), end: false, date });
