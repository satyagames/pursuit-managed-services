// Sessions for the leader report's tests (scripts/test-leader-report.js and scripts/migration-tests/leader-report.spec.ts).
//
// HARBOUR is small enough to work out by hand; the expected numbers are written out in the test, not computed from this file.
// Each participant is a little script: who they are, and what they picked first and last for each question. From that one
// description the tests get the records two ways: `harbourRecords()` builds them directly (what a read of the session returns), and
// `seedSession()` plays the same script through the data service (beginVisit or a scanned code, saveParticipantResponses, a real facilitator
// restart), on the mocked SharePoint REST, the local server, or the server behind a browser test.
//
// BIG is 60 people and 15 questions, made by a rule simple enough to count again in the test.

export const DAY = '2026-10-11';

const option = (id, label, correct = null, value = label) => ({ id, label, correct, value });

/** @param {{ plate?: 'dark' | 'light', primary?: string, logo?: string | null, name?: string, id?: string }} [look] */
export function harbourContent({ id = 'c-harbour', name = 'Harbour & Søn', primary = '#1F5FA8', plate = 'light', logo = null } = {}) {
  const sections = [
    { id: 'a-history', title: 'Harbour History', order: 1, enabled: true, description: 'How the harbour came to be, and who built it.', questionIds: ['q1', 'q2', 'q3'] },
    { id: 'a-views', title: 'Your Views', order: 2, enabled: true, description: '', questionIds: ['q4', 'q5', 'q6', 'q7', 'q8'] },
    { id: 'a-paused', title: 'Bonus Round', order: 3, enabled: false, description: '', questionIds: ['q9'] },
    { id: 'a-never', title: 'Never Run', order: 4, enabled: false, description: '', questionIds: ['q10'] },
  ];
  const questions = [
    { id: 'q1', sectionId: 'a-history', type: 'single-select', prompt: 'Which year did the harbour open?', options: [option('o1a', '1887', true), option('o1b', '1901', false), option('o1c', '1923', false), option('o1d', '1950', false)] },
    { id: 'q2', sectionId: 'a-history', type: 'true-false', prompt: 'The first ship to dock was a steamer.', options: [option('o2t', 'True', true), option('o2f', 'False', false)] },
    { id: 'q3', sectionId: 'a-history', type: 'single-select', prompt: 'Who designed the lighthouse?', options: [option('o3a', 'Ada Łęcka', true), option('o3b', 'Søren Holm', false), option('o3c', 'José Marín', false)] },
    { id: 'q4', sectionId: 'a-views', type: 'single-select', prompt: 'Which service matters most to you?', options: [option('o4a', 'Speed'), option('o4b', 'Price'), option('o4c', 'Care')] },
    { id: 'q5', sectionId: 'a-views', type: 'multi-select', prompt: 'Which channels do you use?', options: [option('o5a', 'Phone'), option('o5b', 'Email'), option('o5c', 'App')] },
    { id: 'q6', sectionId: 'a-views', type: 'confidence-continuum', prompt: 'How confident are you in the plan?', options: [option('o6a', 'Not confident', null, 1), option('o6b', 'Fairly confident', null, 2), option('o6c', 'Very confident', null, 3)] },
    { id: 'q7', sectionId: 'a-views', type: 'ranked-voting', prompt: 'Rank these priorities, most important first.', options: [option('o7a', 'Cost'), option('o7b', 'Quality'), option('o7c', 'Speed')] },
    { id: 'q8', sectionId: 'a-views', type: 'open-text-feedback', prompt: 'Is there anything else you would like us to know?', options: [] },
    { id: 'q9', sectionId: 'a-paused', type: 'single-select', prompt: 'Bonus: what is the capital of the region?', options: [option('o9a', 'Northport', true), option('o9b', 'Eastbay', false)] },
    { id: 'q10', sectionId: 'a-never', type: 'single-select', prompt: 'A question nobody was asked.', options: [option('o10a', 'Yes'), option('o10b', 'No')] },
  ];
  return {
    client: {
      id, name, slug: id.replace(/^c-/, ''), status: 'active', logoUrl: null, primaryColor: primary, secondaryColor: '#64748B', themeVersion: 1,
      theme: { version: 1, primary, accent: null, ...(plate === 'dark' ? { plate: 'dark' } : {}), assets: { hero: null, logo, background: null, tile: null }, copy: { eventTitle: 'Harbour Discovery Day', eventSubtitle: '', welcomeLine: '', logoText: name } },
    },
    sections: sections.map((section) => ({ ...section, clientId: id, industryTags: [] })),
    questions: questions.map(({ options: own, ...question }, order) => ({ ...question, optionIds: own.map((entry) => entry.id), order })),
    options: questions.flatMap((question) => question.options.map((entry) => ({ ...entry, questionId: question.id }))),
  };
}

// A graded answer is [first pick, last pick, tries]; anything else is the answer itself.
const g = (first, final = first, attempts = first === final ? 1 : 2) => ({ first, final, attempts });

/** The seven people of Harbour, in the order they join. `answers` is what they have at the end; `before` is what a restart removed. */
export const HARBOUR_PEOPLE = Object.freeze([
  { key: 'jose', name: 'José Álvarez', guest: 'v-jose', answers: { q1: g('o1a'), q2: g('o2t'), q3: g('o3b', 'o3a'), q4: 'o4a', q5: ['o5a', 'o5c'], q6: 'o6c', q7: ['o7b', 'o7a', 'o7c'], q8: 'Great day — thank you!', q9: g('o9b'), 'q-moved': 'om-b' } },
  { key: 'zoe', name: 'Zoë Brontë', guest: 'v-zoe', answers: { q1: g('o1b', 'o1a'), q2: g('o2t'), q3: g('o3c', 'o3b'), q4: 'o4c', q5: ['o5b'], q6: 'o6b', q7: ['o7b', 'o7c', 'o7a'], 'q-deleted': 'o-old-2' } },
  { key: 'soren', name: 'Søren Kjær', account: '17', answers: { q1: g('o1b', 'o1c'), q2: g('o2f', 'o2t'), q3: g('o3b', 'o3a'), q4: 'o4c', q5: ['o5a', 'o5b', 'o5c'], q6: 'o6c', q7: ['o7a', 'o7b', 'o7c'], q8: 'Søren says: more time for questions, please.\nAnd coffee.' } },
  { key: 'lukasz', name: 'Łukasz Żółć', guest: 'v-lukasz', before: { q1: g('o1d', 'o1c'), q2: g('o2f', 'o2f'), q4: 'o4a' }, answers: { q1: g('o1a'), q2: g('o2t'), q3: g('o3a'), q4: 'o4b', q6: 'o6b', q8: '=SUM(A1:A9) "quoted", with a comma' } },
  { key: 'nobody', name: null, answers: { q1: g('o1c') } },
  { key: 'jose2', name: 'José Álvarez', guest: 'v-jose', answers: {} },
  { key: 'stray', name: null, answers: { q1: g('o1a'), 'q-deleted': 'It was fine' } },
]);

/** A question that still exists but is in none of the session's activities, and its options. */
export const HARBOUR_MOVED = Object.freeze({
  question: { id: 'q-moved', sectionId: 'a-elsewhere', type: 'single-select', prompt: 'Which colour is the old pier?', optionIds: ['om-a', 'om-b'], order: 0 },
  options: [{ id: 'om-a', questionId: 'q-moved', label: 'Red', value: 'Red', correct: null }, { id: 'om-b', questionId: 'q-moved', label: 'Blue', value: 'Blue', correct: null }],
});

const isCorrect = (content, optionId) => content.options.find((entry) => entry.id === optionId)?.correct === true;

/** What a participant's device saves for these answers (the ResponsesJson records). */
export function storedRecords(content, answers, startAt, stepMs = 20_000) {
  return Object.entries(answers).map(([questionId, answer], index) => {
    const graded = answer && typeof answer === 'object' && !Array.isArray(answer);
    return {
      questionId,
      answer: graded ? answer.final : answer,
      firstAnswer: graded ? answer.first : answer,
      attempts: graded ? answer.attempts : 1,
      correct: graded ? isCorrect(content, answer.first) : null,
      answeredAt: new Date(startAt + index * stepMs).toISOString(),
    };
  });
}

/** A stored record as readSessionResponses() hands it on. */
export const asResponse = (record, trackId, clientId) => ({
  questionId: record.questionId, clientId, clientTrackId: trackId,
  answer: record.correct === null ? record.answer : record.firstAnswer,
  firstAnswer: record.firstAnswer, finalAnswer: record.answer, attempts: record.attempts, correct: record.correct, timestamp: record.answeredAt,
});

/** Harbour as the records a read of the session returns, built directly (no server). */
export function harbourRecords(look = {}) {
  const content = harbourContent(look);
  const sessionId = `${content.client.slug}-${DAY}`;
  const start = Date.parse(`${DAY}T13:00:00.000Z`);
  const tracks = HARBOUR_PEOPLE.map((person, index) => ({
    id: `t-${person.key}`, sessionId, clientId: content.client.id, joinedVia: person.guest ? 'qr' : 'manual', qrTokenId: null,
    visitorId: person.guest ?? null, participantName: person.guest ? person.name : null, sharePointUserId: person.account ?? null,
    createdAt: new Date(start + index * 60_000).toISOString(), resumeCount: 0, lastResumedAt: null,
    restartedAt: person.before ? `${DAY}T13:40:00.000Z` : null, restartSectionId: null,
  }));
  return {
    session: { id: sessionId, clientId: content.client.id, date: DAY, sectionIds: [...content.sections.map((section) => section.id), 'a-gone'], status: 'completed', endedAt: `${DAY}T16:30:00.000Z`, participationMode: 'client-visit', activityFlow: 'open' },
    client: content.client,
    tracks,
    sections: content.sections,
    questions: content.questions,
    options: content.options,
    answers: HARBOUR_PEOPLE.flatMap((person, index) => storedRecords(content, person.answers, start + 45 * 60_000 + index * 1000).map((record) => asResponse(record, `t-${person.key}`, content.client.id))),
    visits: [
      { id: 'visit-1', sessionId, entryMode: 'staff', sharePointUserId: '17', displayName: 'Søren Kjær', visitorId: null, visitorName: '', trackId: null, visitedAt: `${DAY}T13:02:00.000Z` },
      { id: 'visit-2', sessionId, entryMode: 'client-visit', sharePointUserId: null, displayName: '', visitorId: 'v-zoe', visitorName: 'Zoë Brontë', trackId: 't-zoe', visitedAt: `${DAY}T13:01:10.000Z` },
    ],
    roster: [{ id: 'v-jose', sessionId, displayName: 'José Álvarez', enabled: true }, { id: 'v-zoe', sessionId, displayName: 'Zoë Brontë', enabled: true }, { id: 'v-lukasz', sessionId, displayName: 'Łukasz Żółć', enabled: true }],
    strayQuestions: [HARBOUR_MOVED.question],
    strayOptions: HARBOUR_MOVED.options,
  };
}

/**
 * Plays a session through a data service: the client and its activities, a live session, each person joining (a guest by the
 * roster's name, a member of staff by an account whose name is in the visit log), their answers saved as a device saves them, and
 * a REAL facilitator restart for anyone with `before` answers. Works on either adapter. Resolves to { session, tracks }.
 * @param {any} ds dataService
 * @param {{ content: ReturnType<typeof harbourContent>, people: readonly any[], extra?: { questions?: any[], options?: any[] }, end?: boolean, date?: string }} input
 */
export async function seedSession(ds, { content, people, extra = {}, end = true, date = DAY }) {
  await ds.createClient(content.client);
  for (const entry of [...content.options, ...(extra.options ?? [])]) await ds.createOption(entry);
  for (const question of [...content.questions, ...(extra.questions ?? [])]) await ds.createQuestion(question);
  for (const section of content.sections) await ds.createSection(section);
  const { session } = await ds.activateClient(content.client.id, date);
  // Go live fills the session with the client's activities; the ones that are switched off belong to it too, as on a real day.
  await ds.updateSession(session.id, { sectionIds: content.sections.map((section) => section.id), participationMode: 'staff', activityFlow: 'open' });
  const guests = new Map();
  const tracks = [];
  for (const person of people) {
    if (person.guest && !guests.has(person.guest)) guests.set(person.guest, await ds.createVisitor({ sessionId: session.id, displayName: person.name, enabled: true }));
    // A guest scans a code of their own, which is what records the roster's name on the visit; a member of staff begins at Welcome
    // under their account. (Each way in checks the session's mode, so it is set for each person.)
    await ds.updateSession(session.id, { participationMode: person.guest ? 'client-visit' : 'staff' });
    const track = person.guest
      ? await (await ds.openQrScan((await ds.provisionQrToken(content.client.id, session.id, { visitorId: guests.get(person.guest).id })).id)).claim()
      : await ds.beginVisit(crypto.randomUUID(), session.id, content.client.id, { sharePointUserId: person.account ?? null });
    tracks.push(track);
    // People join at different moments; two visits stamped in the same millisecond would have no order of their own.
    await new Promise((resolve) => { setTimeout(resolve, 3); });
    if (person.account && person.name) {
      await ds.recordUserVisit({ visitKey: `visit-${track.id}`, sessionId: session.id, clientId: content.client.id, page: 'participant', entryMode: 'staff', sharePointUserId: person.account, displayName: person.name, visitorId: null, visitorName: '', trackId: null, visitedAt: new Date().toISOString() });
    }
    const save = (answers) => ds.saveParticipantResponses({ trackId: track.id, sessionId: session.id, clientId: content.client.id, responses: storedRecords(content, answers, Date.now()) });
    if (person.before) {
      await save(person.before);
      await ds.restartParticipantTrack(track.id, { sectionId: null });
    }
    if (Object.keys(person.answers).length > 0) await save(person.answers);
  }
  if (end) await ds.endSession(session.id);
  return { session: await ds.getSession(session.id), tracks };
}

// ---- Sixty people, fifteen questions ---------------------------------------------------------------------------------------------

export const BIG = Object.freeze({ people: 60, questions: 15 });
const FIRST_NAMES = ['José', 'Zoë', 'Søren', 'Łukasz', 'Renée', 'Björn', 'Chloë', 'Dvořák', 'İpek', 'Ángela', 'Þór', 'Çağla'];
const LAST_NAMES = ['Álvarez', 'Brontë', 'Kjær', 'Żółć', 'Müller', 'Ångström', 'Ó Súilleabháin', 'Škoda', 'Nuñez', 'Grønn'];

/** Person `i` (0-based) of the big session. */
export const bigName = (i) => `${FIRST_NAMES[i % FIRST_NAMES.length]} ${LAST_NAMES[i % LAST_NAMES.length]} ${i + 1}`;
/** The words person `i` writes. Each ends in a token of their own ("note-7."), which a test looks for. */
export const bigComment = (i) => `${['Loved the trivia', 'The room was a little warm', 'More time for questions next year', 'Zoë’s table had the best answers'][i % 4]}, and thank you to the team. note-${i + 1}.`;

/**
 * Three activities of five questions: ten graded questions (four short answers, as trivia has; the first is right), a poll, a confidence scale, a
 * ranking, a multiple choice and, last of all, a written answer. The rule, which the test counts again for itself:
 *   person i's first pick for graded question j (0-based, of the ten) is option (i + j) % 4, so it is right when (i + j) % 4 === 0;
 *   a wrong first pick is followed by the right one when i is even, and by the same wrong one when i is odd;
 *   people 55 to 59 stop after the first activity; everyone else answers everything.
 */
export function bigContent({ id = 'c-big', name = 'Northwind Trading', primary = '#0B6E4F' } = {}) {
  const sections = [0, 1, 2].map((index) => ({ id: `b-act-${index + 1}`, title: ['Company History', 'Products and People', 'Your Views'][index], order: index + 1, enabled: true, clientId: id, industryTags: [], description: 'A sample activity for the report’s tests.', questionIds: [] }));
  const questions = [];
  const options = [];
  const add = (section, question, labels, correct = null) => {
    const own = labels.map((label, position) => ({ id: `${question.id}-o${position}`, questionId: question.id, label, value: question.type === 'confidence-continuum' ? position + 1 : label, correct: correct === null ? null : position === correct }));
    options.push(...own);
    questions.push({ ...question, sectionId: section.id, optionIds: own.map((entry) => entry.id), order: section.questionIds.length });
    section.questionIds.push(question.id);
  };
  for (let j = 0; j < 10; j += 1) {
    add(sections[j < 5 ? 0 : 1], { id: `bq${j + 1}`, type: 'single-select', prompt: `Graded question ${j + 1}: where did it happen?` }, ['Cincinnati', 'Columbus', 'Cleveland', 'Dayton'], 0);
  }
  add(sections[2], { id: 'bq11', type: 'single-select', prompt: 'Which topic should we cover next time?' }, ['Strategy', 'Technology', 'People']);
  add(sections[2], { id: 'bq12', type: 'confidence-continuum', prompt: 'How confident are you in the plan?' }, ['Not confident', 'Fairly confident', 'Very confident']);
  add(sections[2], { id: 'bq13', type: 'ranked-voting', prompt: 'Rank these priorities, most important first.' }, ['Cost', 'Quality', 'Speed']);
  add(sections[2], { id: 'bq14', type: 'multi-select', prompt: 'Which channels do you use?' }, ['Phone', 'Email', 'App']);
  add(sections[2], { id: 'bq15', type: 'open-text-feedback', prompt: 'What should we know?' }, []);
  return {
    client: { id, name, slug: id.replace(/^c-/, ''), status: 'active', logoUrl: null, primaryColor: primary, secondaryColor: '#64748B', themeVersion: 1, theme: { version: 1, primary, accent: null, assets: { hero: null, logo: null, background: null, tile: null }, copy: { eventTitle: 'Annual Kick-off', eventSubtitle: '', welcomeLine: '', logoText: name } } },
    sections, questions, options,
  };
}

/** The big session's people, as scripts for seedSession() and bigRecords(). */
export function bigPeople({ people = BIG.people } = {}) {
  return Array.from({ length: people }, (_unused, i) => {
    const answers = {};
    for (let j = 0; j < 10; j += 1) {
      if (i >= 55 && j >= 5) break;
      const first = `bq${j + 1}-o${(i + j) % 4}`;
      answers[`bq${j + 1}`] = (i + j) % 4 === 0 ? g(first) : g(first, i % 2 === 0 ? `bq${j + 1}-o0` : first, 2);
    }
    if (i < 55) {
      answers.bq11 = `bq11-o${i % 3}`;
      answers.bq12 = `bq12-o${i % 3}`;
      answers.bq13 = [0, 1, 2].map((place) => `bq13-o${(i + place) % 3}`);
      answers.bq14 = i % 2 === 0 ? ['bq14-o0', 'bq14-o2'] : ['bq14-o1'];
      answers.bq15 = bigComment(i);
    }
    return { key: `p${i + 1}`, name: bigName(i), guest: `bv-${i + 1}`, answers };
  });
}

export function bigRecords(look = {}) {
  const content = bigContent(look);
  const people = bigPeople();
  const sessionId = `${content.client.slug}-${DAY}`;
  const start = Date.parse(`${DAY}T09:00:00.000Z`);
  return {
    session: { id: sessionId, clientId: content.client.id, date: DAY, sectionIds: content.sections.map((section) => section.id), status: 'completed', endedAt: `${DAY}T12:00:00.000Z` },
    client: content.client,
    tracks: people.map((person, index) => ({ id: `t-${person.key}`, sessionId, clientId: content.client.id, joinedVia: 'qr', visitorId: person.guest, participantName: person.name, sharePointUserId: null, createdAt: new Date(start + index * 5000).toISOString(), restartedAt: null, restartSectionId: null })),
    sections: content.sections, questions: content.questions, options: content.options,
    answers: people.flatMap((person, index) => storedRecords(content, person.answers, start + 600_000 + index * 1000).map((record) => asResponse(record, `t-${person.key}`, content.client.id))),
    visits: [], roster: [], strayQuestions: [], strayOptions: [],
  };
}
