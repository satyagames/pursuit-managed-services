// The local site's scenarios (Phase 12): each one a whole site, built once from a seeded generator and a fixed "now" (16 Oct 2026, 17:00 IST),
// then kept as a state file (scripts/local-site/data/<scenario>/state.json, git-ignored) that the server loads and saves after each write.
//
// Content goes in through the app's own calls on a mocked SharePoint (seedPack, activateClient, setSessionParticipationMode, uploadClientAsset,
// seedSampleClients, addAdminUser), exactly as Setup and the admin page would write it. Visits and answers are written as raw list rows, as the
// result oracle stores them (scripts/oracle-results.js toRows): sixty iPads' worth of pressing would add nothing but time, and the rows are the
// shape the pages read. Every person here is invented.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPin } from '../../migration/src/lib/admin/admin-pin.js';
import { samplePack } from '../../migration/src/lib/setup/sample-clients.js';
import { SAMPLE_PICTURES } from '../../migration/src/lib/setup/sample-pictures.js';
import { seedSampleClients } from '../../migration/src/lib/setup/sample-seed.js';
import { seedPack } from '../../migration/src/lib/setup/seed.js';
import { random } from '../oracle-results.js';
import { packRecords, pictureFiles, storedName } from './dataset.js';
import { ADMIN, makeFake, NOW, SITE_URL } from './site-shape.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const SCENARIOS = Object.freeze({
  empty: 'A brand-new site with no lists: review Setup from the start.',
  'sample-pack': 'Lists made and marked ready, one admin, and Setup\'s "Seed sample clients" pressed (the older Kroger and Domino\'s pack, with its pictures).',
  ready: 'Lists ready, one admin, VJR\'s dataset (Template, Kroger, Domino\'s; five activities each) and pictures; no session.',
  tiles: '"ready" plus a test-only sixth Kroger activity of picture tiles.',
  'event-day': 'Kroger live on VJR\'s dataset with about 60 visits at every stage, guests and staff.',
  finished: '"event-day" with the session ended, and Domino\'s run to the end on two iPads the day before.',
  'pcoe-16oct': 'Calibration: what PCOE showed on 16 Oct 2026 (the older Kroger and Domino\'s content), to compare with the photographs.',
  stress: '60 clients, one session of 400 visits and 30 questions, eight answers of 90 characters.',
  chaos: '"ready", with a fault answered in turn every few requests (429, 503, 500, a dropped connection, an expired write token).',
});
export const EVENT_DATE = '2026-10-16';
let builds = 0;

/** Runs `work` with `Date` fixed at NOW, one second on for every date asked for, so a build is the same every time. */
async function atFixedTime(work) {
  const Real = Date;
  let tick = Real.parse(NOW);
  class Fixed extends Real {
    constructor(...args) { if (args.length) super(...args); else { super(tick); tick += 1000; } }
    static now() { tick += 1000; return tick; }
  }
  globalThis.Date = Fixed;
  try { return await work(); } finally { globalThis.Date = Real; }
}

/** A fresh mocked site and a fresh copy of the data layer pointed at it (one module is one page: scripts/test-participant-storage.js freshPage). */
async function freshSite(options) {
  const fake = makeFake(options);
  const ds = await import(`../../migration/src/lib/data/dataService.js?local-site=${builds += 1}`);
  ds.configure({ sharePoint: fake.settings });
  return { fake, ds };
}

async function addAdmin(ds) {
  await ds.addAdminUser({ id: ADMIN.id, name: ADMIN.name, pin: await hashPin(ADMIN.pin) });
}

/**
 * VJR's dataset: each picture on disk goes to the picture library as Brand Studio would store it (the data layer's own upload); one the data layer
 * refuses (over 512 KB: the gingham) is put in the library as a person would put it there by hand, and noted. Then seedPack.
 */
async function loadDataset(fake, ds, { withTiles, pictures }) {
  const notes = [];
  const urls = new Map();
  const pictureUrl = (slug, slot, fileName) => urls.get(`${slug}|${slot}|${fileName}`) ?? null;
  const wanted = packRecords({ withTiles, pictureUrl: (slug, slot, fileName) => (pictures.has(fileName) ? `${slug}|${slot}|${fileName}` : null) });
  const uses = new Set([...wanted.clients.flatMap((client) => [client.theme.assets.hero, client.theme.assets.logo, client.theme.assets.background]), ...wanted.options.map((option) => option.imageUrl)].filter(Boolean));
  for (const use of uses) {
    const [slug, slot, fileName] = use.split('|');
    const file = pictures.get(fileName);
    const name = storedName(slug, slot, file);
    try {
      const { url } = await ds.uploadClientAsset(new Blob([file.bytes], { type: file.type }), name);
      urls.set(use, url);
    } catch (error) {
      fake.files.set(`${fake.libraryFolder}/${name}`, { bytes: file.bytes, type: file.type });
      urls.set(use, `${SITE_URL.replace(/\/sites\/.*$/, '')}${fake.libraryFolder}/${name}`);
      notes.push(`${fileName} (${file.bytes.length} B) was refused by the data layer's upload ("${error.message}") and put in ${fake.libraryTitle} by hand.`);
    }
  }
  const records = packRecords({ withTiles, pictureUrl });
  await seedPack(ds, records);
  return { records, notes: [...notes, ...records.notes] };
}

// ---- Visits and answers, as raw rows -----------------------------------------------------------------------------------------------------

const FIRST = ['Morgan', 'Priya', 'Daniel', 'Aisha', 'Tomás', 'Mei', 'Oluwaseun', 'Hannah', 'Rafael', 'Sofia', 'Kenji', 'Leila', 'Marcus', 'Ananya', 'Grace', 'Diego', 'Fatima', 'Lukas', 'Chloe', 'Arjun', 'Nadia', 'Samuel', 'Yara', 'Ethan', 'Ingrid', 'Kwame', 'Lucía', 'Omar', 'Freya', 'Vikram'];
const LAST = ['Patel', 'Okonkwo', 'Fischer', 'Nakamura', 'Haddad', 'Lindqvist', 'Moreno', 'Chen', 'Byrne', 'Kowalski', 'Mensah', 'Rossi', 'Iyer', 'Dubois', 'Novak', 'Alvarez', 'Sato', 'Brennan', 'Kaur', 'Osei'];
const ODD_NAMES = ['张伟', 'Ольга Петрова', 'Maximiliana Theodora Wolfeschlegelsteinhausen-Bergerdorff', "O'Neill, Siobhán"];
const COMMENTS = {
  general: [
    'Clear ownership on both sides, and a weekly check-in we actually keep.',
    'Getting the data right before we automate anything.',
    'Store teams need to see the benefit in the first month, not the first year.',
    'Less slideware, more working software.',
    'Honest conversations about what is not working.',
    'A single roadmap that finance and operations both sign up to.',
    '=Bring the field teams in early',
    'Speed. 🚀 And no surprises on cost.',
    'デジタルと店舗の連携を強化してほしい。',
    'स्टोर टीमों के लिए सरल प्रक्रियाएँ।',
    'نريد نتائج واضحة في أول تسعين يوماً.',
    'Fewer pilots that go nowhere. 👍',
  ],
  long: `${'We have run three transformation programmes in the last eight years and each one started well and then stalled once the first wave of quick wins was done. The reasons were always the same: the people doing the work were not in the room when the plan was made, the data we needed was in four systems that did not agree, and nobody owned the benefits after the consultants left. '.repeat(3)}`.slice(0, 990),
};

/**
 * Answer records for one person over `questions` (in order), up to `stopAfter` answers. Graded questions follow `rightRate` (by question id);
 * a ranking comes from `rankings` in turn (so ties are exact); a scale from `scaleWeights`; open text from the comment pools.
 */
function answersFor(r, person, questions, optionsOf, { stopAfter = Infinity, startAt, rightRate = {}, rankings = [], scaleWeights = [0.15, 0.6, 0.25], forced = {} }) {
  const records = [];
  let at = Date.parse(startAt);
  for (const question of questions) {
    if (records.length >= stopAfter) break;
    const own = optionsOf(question);
    at += r.int(8, 50) * 1000;
    const stamp = new Date(at).toISOString();
    let record;
    if (forced[question.id] !== undefined) record = forced[question.id](person, own);
    else if (question.type === 'ranked-voting') record = { answer: rankings[person.index % rankings.length].map((index) => own[index].id), attempts: 1, correct: null };
    else if (question.type === 'confidence-continuum') {
      const roll = r.next();
      const index = roll < scaleWeights[0] ? 0 : roll < scaleWeights[0] + scaleWeights[1] ? 1 : 2;
      record = { answer: own[index].id, attempts: 1, correct: null };
    } else if (question.type === 'open-text-feedback') {
      record = { answer: person.index === 7 && question.order === 1 ? COMMENTS.long : r.pick(COMMENTS.general), attempts: 1, correct: null };
    } else if (own.some((option) => option.correct)) {
      const right = own.find((option) => option.correct);
      const wrong = own.filter((option) => !option.correct);
      if (r.next() < (rightRate[question.id] ?? 0.6)) record = { answer: right.id, firstAnswer: right.id, attempts: 1, correct: true };
      else {
        const first = r.pick(wrong);
        record = r.chance(0.8) ? { answer: right.id, firstAnswer: first.id, attempts: 2, correct: false } : { answer: first.id, firstAnswer: first.id, attempts: 2, correct: false };
      }
    } else record = { answer: r.pick(own).id, attempts: 1, correct: null };
    if (record.firstAnswer === undefined) record.firstAnswer = record.answer;
    records.push({ questionId: question.id, ...record, answeredAt: stamp });
  }
  return records;
}

const visitRows = (fake) => ({
  track: (row) => fake.add('tracks', { Title: row.AppId, ResumeCount: 0, LastResumedAt: null, RestartedAt: null, RestartSectionId: null, QrTokenId: null, VisitorId: null, ParticipantName: null, SharePointUserId: null, ...row }),
  answers: (trackId, sessionId, clientId, records) => fake.add('responses', { AppId: trackId, Title: trackId, SessionId: sessionId, TrackId: trackId, ClientId: clientId, ResponsesJson: typeof records === 'string' ? records : JSON.stringify(records) }),
  guest: (row) => fake.add('visitorroster', { Title: row.AppId, Enabled: true, ...row }),
  code: (row) => fake.add('qrtokens', { Title: row.AppId, Used: false, UsedAt: null, ExpiredAt: null, ClientTrackId: null, VisitorId: null, ...row }),
  log: (row) => fake.add('uservisitlogs', { Title: row.AppId, Page: 'participant', VisitorId: null, VisitorName: null, SignedInName: null, SharePointUserId: null, ...row }),
});

/** The questions of a client's enabled activities, in order, read back from the site as the pages would see them. */
async function contentOf(ds, clientId) {
  const sections = (await ds.listClientSections(clientId)).filter((section) => section.enabled);
  const questions = [];
  const options = new Map();
  for (const section of sections) {
    const content = await ds.getSectionQuestions(section);
    for (const question of content) {
      questions.push(question);
      options.set(question.id, question.options ?? []);
    }
  }
  return { sections, questions, optionsOf: (question) => options.get(question.id) ?? [] };
}

/** Kroger live, about 60 visits: guests by QR code and staff signed in, at every stage. Returns the guests' codes that were not scanned. */
async function eventDay(fake, ds, r) {
  const { session } = await ds.activateClient('c-kroger', EVENT_DATE);
  // A poll the facilitator added during the session, after everyone had passed the quiz: the question nobody answered.
  await ds.createOption({ id: 'o-kroger-late-a', questionId: 'q-kroger-mcq-late', label: 'Technology', value: 'technology', correct: null, imageUrl: null });
  await ds.createOption({ id: 'o-kroger-late-b', questionId: 'q-kroger-mcq-late', label: 'Operations', value: 'operations', correct: null, imageUrl: null });
  await ds.createOption({ id: 'o-kroger-late-c', questionId: 'q-kroger-mcq-late', label: 'Customer experience', value: 'customer-experience', correct: null, imageUrl: null });
  await ds.createQuestion({ id: 'q-kroger-mcq-late', sectionId: 'sec-kroger-mcq', type: 'single-select', prompt: 'Which topic would you like more time on this afternoon?', optionIds: ['o-kroger-late-a', 'o-kroger-late-b', 'o-kroger-late-c'], order: 4, layout: 'text-list' });
  const mcq = await ds.getSection('sec-kroger-mcq');
  await ds.updateSection('sec-kroger-mcq', { questionIds: [...mcq.questionIds, 'q-kroger-mcq-late'] });
  const { questions, optionsOf } = await contentOf(ds, 'c-kroger');
  const answered = questions.filter((question) => question.id !== 'q-kroger-mcq-late');
  const rows = visitRows(fake);
  // Rankings in mirrored pairs, so "Modernize technology" and "Enhance customer experience" tie for first exactly.
  const rankings = [[1, 3, 0, 2, 4], [3, 1, 0, 2, 4], [1, 3, 2, 0, 4], [3, 1, 2, 0, 4]];
  // Half of everyone picks the answer to the hard quiz question first, and everyone gets the riddle.
  const forced = {
    'q-kroger-mcq-2': (person, own) => (person.index % 2 === 0
      ? { answer: own[2].id, firstAnswer: own[2].id, attempts: 1, correct: true }
      : { answer: own[2].id, firstAnswer: own[person.index % 4 === 1 ? 0 : 1].id, attempts: 2, correct: false }),
    'q-kroger-guess-the-brand-1': (person, own) => ({ answer: own[0].id, firstAnswer: own[0].id, attempts: 1, correct: true }),
  };
  const rightRate = { 'q-kroger-mcq-1': 0.85, 'q-kroger-mcq-3': 0.4 };
  const unscanned = [];
  let joined = Date.parse(`${EVENT_DATE}T09:05:00.000Z`);
  const people = 60;
  for (let index = 0; index < people; index += 1) {
    joined += r.int(10, 75) * 1000;
    const id = `t-kroger-${String(index + 1).padStart(2, '0')}`;
    const guest = index % 4 !== 3; // three in four are guests with a code; the rest are staff signed in on an iPad
    const name = index < ODD_NAMES.length ? ODD_NAMES[index] : `${FIRST[index % FIRST.length]} ${LAST[(index * 7) % LAST.length]}`;
    const createdAt = new Date(joined).toISOString();
    const person = { index };
    // Stages: 6 joined and answered nothing, 14 part of the way, the rest to the end; two of those were restarted.
    const stage = index % 10 === 9 ? 'not-started' : index % 10 >= 7 ? 'in-progress' : 'completed';
    if (guest) {
      const visitorId = `v-kroger-${String(index + 1).padStart(2, '0')}`;
      rows.guest({ AppId: visitorId, SessionId: session.id, GuestName: name });
      rows.code({ AppId: `qr-kroger-${String(index + 1).padStart(2, '0')}`, ClientId: 'c-kroger', SessionId: session.id, VisitorId: visitorId, Used: true, CreatedAt: `${EVENT_DATE}T08:30:00.000Z`, UsedAt: createdAt, ClientTrackId: id });
      rows.track({ AppId: id, SessionId: session.id, ClientId: 'c-kroger', JoinedVia: 'qr', QrTokenId: `qr-kroger-${String(index + 1).padStart(2, '0')}`, VisitorId: visitorId, ParticipantName: name, CreatedAt: createdAt });
      rows.log({ AppId: `log-kroger-${index + 1}`, SessionId: session.id, ClientId: 'c-kroger', EntryMode: 'client-visit', VisitorId: visitorId, VisitorName: name, TrackId: id, VisitedAt: createdAt });
    } else {
      const shared = index % 8 === 7; // some iPads share one sign-in
      const signIn = shared ? { id: '30', name: 'PMS iPad, Shared' } : { id: String(200 + index), name: `${LAST[(index * 3) % LAST.length]}, ${FIRST[(index * 5) % FIRST.length]}` };
      rows.track({ AppId: id, SessionId: session.id, ClientId: 'c-kroger', JoinedVia: 'manual', SharePointUserId: signIn.id, CreatedAt: createdAt });
      rows.log({ AppId: `log-kroger-${index + 1}`, SessionId: session.id, ClientId: 'c-kroger', EntryMode: 'staff', SharePointUserId: signIn.id, SignedInName: signIn.name, TrackId: id, VisitedAt: createdAt });
    }
    if (stage === 'not-started') continue;
    let records = answersFor(r, person, answered, optionsOf, { stopAfter: stage === 'in-progress' ? r.int(2, answered.length - 2) : Infinity, startAt: createdAt, rightRate, rankings, forced });
    if (index === 4 || index === 16) {
      // Restarted twice by the facilitator; only what came after the last restart is stored.
      fake.item('tracks', id).RestartedAt = new Date(joined + 1_800_000).toISOString();
      fake.item('tracks', id).ResumeCount = 2;
      records = answersFor(r, person, answered, optionsOf, { startAt: new Date(joined + 1_800_000).toISOString(), rightRate, rankings, forced });
    }
    if (index === 11) records = records.map((record) => (record.questionId === 'q-kroger-mcq-3' ? { ...record, answer: 'o-kroger-mcq-3-c', firstAnswer: 'o-kroger-mcq-3-c', correct: false } : record));
    rows.answers(id, session.id, 'c-kroger', index === 21 ? '{oops' : records);
  }
  // Guests on the list who have a code and have not scanned it yet: the control page lists their links.
  for (let index = 0; index < 4; index += 1) {
    const visitorId = `v-kroger-wait-${index + 1}`;
    const name = `${FIRST[(index * 11 + 3) % FIRST.length]} ${LAST[(index * 13 + 5) % LAST.length]}`;
    rows.guest({ AppId: visitorId, SessionId: session.id, GuestName: name });
    rows.code({ AppId: `qr-kroger-wait-${index + 1}`, ClientId: 'c-kroger', SessionId: session.id, VisitorId: visitorId, CreatedAt: `${EVENT_DATE}T08:30:00.000Z` });
    unscanned.push({ name, token: `qr-kroger-wait-${index + 1}` });
  }
  rows.guest({ AppId: 'v-kroger-nocode', SessionId: session.id, GuestName: 'Late Addition' });
  // An answer option removed after one person had picked it (index 11's answer to the third quiz question).
  const third = await ds.getQuestion('q-kroger-mcq-3');
  await ds.updateQuestion('q-kroger-mcq-3', { optionIds: third.optionIds.filter((id) => id !== 'o-kroger-mcq-3-c') });
  await ds.deleteOption('o-kroger-mcq-3-c');
  await ds.setSessionParticipationMode(session.id, 'client-visit');
  // (The first visit's Click here to begin moves a session on; the rows above were written without it.)
  await ds.updateSession(session.id, { status: 'in-progress' });
  // (setSessionParticipationMode retires unscanned codes of the session's guests only when it changes away from guests: these stay.)
  return { session, unscanned };
}

/** Domino's, the day before, two iPads, run to the end, the session ended. */
async function dominosDone(fake, ds, r) {
  const { session } = await ds.activateClient('c-dominos', '2026-10-15');
  const { questions, optionsOf } = await contentOf(ds, 'c-dominos');
  const rows = visitRows(fake);
  for (const [index, name] of [['1', 'Brennan, Ingrid'], ['2', 'Sato, Kenji']].entries()) {
    const id = `t-dominos-${name[0]}`;
    const createdAt = `2026-10-15T10:0${index}:00.000Z`;
    rows.track({ AppId: id, SessionId: session.id, ClientId: 'c-dominos', JoinedVia: 'manual', SharePointUserId: String(300 + index), CreatedAt: createdAt });
    rows.log({ AppId: `log-dominos-${index + 1}`, SessionId: session.id, ClientId: 'c-dominos', EntryMode: 'staff', SharePointUserId: String(300 + index), SignedInName: name[1], TrackId: id, VisitedAt: createdAt });
    rows.answers(id, session.id, 'c-dominos', answersFor(r, { index }, questions, optionsOf, { startAt: createdAt, rankings: [[3, 1, 2, 0, 4], [1, 3, 0, 4, 2]] }));
  }
  await ds.endSession(session.id);
  return session;
}

/** Four rankings of five options whose points (5 for first ... 1 for last) are exactly `points`, found by search. */
function rankingsFor(points) {
  const perms = [];
  const permute = (rest, done) => (rest.length ? rest.forEach((item, at) => permute([...rest.slice(0, at), ...rest.slice(at + 1)], [...done, item])) : perms.push(done));
  permute([0, 1, 2, 3, 4], []);
  const score = (perm) => { const out = [0, 0, 0, 0, 0]; perm.forEach((option, place) => { out[option] += 5 - place; }); return out; };
  for (const a of perms) for (const b of perms) for (const c of perms) {
    const sum = [a, b, c].map(score).reduce((total, each) => total.map((value, at) => value + each[at]));
    const need = points.map((value, at) => value - sum[at]);
    const d = perms.find((perm) => score(perm).every((value, at) => value === need[at]));
    if (d) return [a, b, c, d];
  }
  throw new Error('No four rankings give those points.');
}

/** What PCOE showed on 16 Oct 2026 with pms-283ad18 / pms-618b8fc, as far as the photographs let it be rebuilt (UX-REVIEW.md says what could not be). */
async function pcoe16Oct(fake, ds) {
  const pack = samplePack();
  // Two activities the facilitator made by hand on the live site, with its words (the typos are the live site's).
  pack.sections.push({ id: 'sec-pcoe-straight-talk', title: 'Straight Talk', order: 3, enabled: true, industryTags: [], questionIds: ['q-pcoe-straight-talk'], clientId: 'c-kroger', description: 'Rank what matters most.' });
  pack.questions.push({ id: 'q-pcoe-straight-talk', sectionId: 'sec-pcoe-straight-talk', type: 'ranked-voting', prompt: 'Which objectives are top of mind for you?', optionIds: ['a', 'b', 'c', 'd', 'e'].map((letter) => `o-pcoe-st-${letter}`), order: 1, layout: null });
  ['Reduce cost', 'Modernize technology', 'Transform process', 'Enhance customer experience', 'Scale talent model'].forEach((label, at) => pack.options.push({ id: `o-pcoe-st-${'abcde'[at]}`, questionId: 'q-pcoe-straight-talk', label, value: label.toLowerCase().replace(/ /g, '-'), correct: null, imageUrl: null }));
  pack.sections.push({ id: 'sec-pcoe-confidence', title: 'Confidence continuum', order: 4, enabled: true, industryTags: [], questionIds: ['q-pcoe-confidence', 'q-pcoe-unknown'], clientId: 'c-kroger', description: 'How confident are you?' });
  pack.questions.push({ id: 'q-pcoe-confidence', sectionId: 'sec-pcoe-confidence', type: 'confidence-continuum', prompt: 'How confident are you that Deloitte can deliver?', optionIds: ['o-pcoe-c-a', 'o-pcoe-c-b', 'o-pcoe-c-c'], order: 1, layout: null });
  ['Not confident', 'Modarately confidence', 'Very confident'].forEach((label, at) => pack.options.push({ id: `o-pcoe-c-${'abc'[at]}`, questionId: 'q-pcoe-confidence', label, value: at + 1, correct: null, imageUrl: null }));
  // The ninth question a 9-answer visit implies is not in the photographs: an open question stands in for it.
  pack.questions.push({ id: 'q-pcoe-unknown', sectionId: 'sec-pcoe-confidence', type: 'open-text-feedback', prompt: '(Reconstructed: the ninth question is not in the photographs.)', optionIds: [], order: 2, layout: null });
  await seedPack(ds, pack);
  const { session } = await ds.activateClient('c-kroger', EVENT_DATE);
  const rows = visitRows(fake);
  const at = (minutes) => new Date(Date.parse(`${EVENT_DATE}T10:00:00.000Z`) + minutes * 60_000).toISOString();
  // Support scores 69, 69, 56, 31, 25 over four rankers of five options are points 15, 15, 13, 9, 8.
  const rankings = rankingsFor([15, 15, 13, 9, 8]);
  const firstStore = ['o-trivia-1-a', 'o-trivia-1-a', 'o-trivia-1-a', 'o-trivia-1-a'];
  const address = ['o-trivia-2-b', 'o-trivia-2-b', 'o-trivia-2-a', 'o-trivia-2-c'];
  const people = [
    { name: 'Raghavan, Venkata Srinivas', user: '501', answers: 9 },
    { name: 'Raghavan, Venkata Srinivas', user: '501', answers: 8 },
    { name: 'Mike A', user: '502', answers: 8 },
    { name: 'Mike B', user: '503', answers: 9 },
    { name: 'Iyer, Meera', user: '504', answers: 0 },
  ];
  let ranker = 0;
  people.forEach((person, index) => {
    const id = `t-pcoe-${index + 1}`;
    rows.track({ AppId: id, SessionId: session.id, ClientId: 'c-kroger', JoinedVia: 'manual', SharePointUserId: person.user, CreatedAt: at(index * 3) });
    rows.log({ AppId: `log-pcoe-${index + 1}`, SessionId: session.id, ClientId: 'c-kroger', EntryMode: 'staff', SharePointUserId: person.user, SignedInName: person.name, TrackId: id, VisitedAt: at(index * 3) });
    if (!person.answers) return;
    const pick = (questionId, option, correct) => ({ questionId, answer: option, firstAnswer: option, attempts: correct ? 1 : 2, correct, answeredAt: at(index * 3 + 1) });
    const records = [
      pick('q-trivia-1', firstStore[ranker], false), pick('q-trivia-2', address[ranker], address[ranker] === 'o-trivia-2-a'),
      pick('q-trivia-3', 'o-trivia-3-c', true), pick('q-trivia-4', 'o-trivia-4-a', true), pick('q-trivia-5', 'o-trivia-5-c', true),
      pick('q-brand-1', 'o-brand-1-b', true),
      { questionId: 'q-pcoe-straight-talk', answer: rankings[ranker].map((option) => `o-pcoe-st-${'abcde'[option]}`), firstAnswer: null, attempts: 1, correct: null, answeredAt: at(index * 3 + 2) },
      { questionId: 'q-pcoe-unknown', answer: 'Reconstructed answer.', attempts: 1, correct: null, answeredAt: at(index * 3 + 2) },
    ];
    if (person.answers === 9) records.push({ questionId: 'q-pcoe-confidence', answer: 'o-pcoe-c-b', attempts: 1, correct: null, answeredAt: at(index * 3 + 2) });
    records.forEach((record) => { if (record.firstAnswer === null) record.firstAnswer = record.answer; });
    rows.answers(id, session.id, 'c-kroger', records);
    ranker += 1;
  });
  // Domino's: two visits, nine answers.
  const { session: dominos } = await ds.activateClient('c-dominos', '2026-10-15');
  rows.track({ AppId: 't-pcoe-d1', SessionId: dominos.id, ClientId: 'c-dominos', JoinedVia: 'manual', SharePointUserId: '502', CreatedAt: '2026-10-15T11:00:00.000Z' });
  rows.track({ AppId: 't-pcoe-d2', SessionId: dominos.id, ClientId: 'c-dominos', JoinedVia: 'manual', SharePointUserId: '503', CreatedAt: '2026-10-15T11:02:00.000Z' });
  const history = ['q-dominos-history-1', 'q-dominos-history-2', 'q-dominos-history-3', 'q-dominos-history-4', 'q-dominos-history-5', 'q-dominos-innovation-1', 'q-dominos-innovation-2', 'q-dominos-innovation-3'];
  const pick = (questionId) => ({ questionId, answer: `o-${questionId.slice(2)}-a`, firstAnswer: `o-${questionId.slice(2)}-a`, attempts: 1, correct: false, answeredAt: '2026-10-15T11:05:00.000Z' });
  rows.answers('t-pcoe-d1', dominos.id, 'c-dominos', history.map(pick));
  rows.answers('t-pcoe-d2', dominos.id, 'c-dominos', [pick(history[0])]);
  await ds.updateSession(session.id, { status: 'in-progress' });
  await ds.activateClient('c-kroger', EVENT_DATE);
  return { notes: [
    'The ninth question of Kroger\'s session is not in the photographs: "q-pcoe-unknown", an open question, stands in for it.',
    'Real names in the photographs are replaced by invented ones of the same shape (a repeated "Last, First Middle", two short names, one who never started).',
    'Whether the Domino\'s answers were right is not known: every one is the first answer. "9 answers from 2 iPads" holds.',
  ] };
}

/** 60 clients and one session of 400 visits over 30 questions, one with eight answers of 90 characters. */
async function stress(fake, ds, r) {
  const clients = Array.from({ length: 60 }, (_, at) => ({ id: `c-stress-${at + 1}`, name: `Stress Client ${String(at + 1).padStart(2, '0')} ${LAST[at % LAST.length]} Holdings`, logoUrl: null, primaryColor: '#045BCC', secondaryColor: '#045BCC', createdAt: NOW, slug: `stress-${at + 1}`, theme: null, themeVersion: 1, status: at % 9 === 8 ? 'archived' : 'active' }));
  const sections = [];
  const questions = [];
  const options = [];
  const kinds = ['single-select', 'single-select', 'multi-select', 'confidence-continuum', 'ranked-voting', 'open-text-feedback', 'true-false'];
  for (let s = 0; s < 6; s += 1) {
    const section = { id: `sec-stress-${s + 1}`, title: `Stress activity ${s + 1}`, order: s + 1, enabled: true, industryTags: [], questionIds: [], clientId: 'c-stress-1', description: 'Thirty questions over six activities.' };
    for (let q = 0; q < 5; q += 1) {
      const n = s * 5 + q + 1;
      const type = n === 1 ? 'single-select' : kinds[n % kinds.length];
      const id = `q-stress-${n}`;
      const count = type === 'open-text-feedback' ? 0 : type === 'true-false' ? 2 : type === 'confidence-continuum' ? 3 : n === 1 ? 8 : 4;
      const labels = Array.from({ length: count }, (_, o) => (type === 'true-false' ? ['True', 'False'][o] : n === 1 ? `Answer ${o + 1}: ${'a long answer that goes on and on to show how ninety characters look'.slice(0, 78)}`.slice(0, 90) : `Option ${o + 1} of question ${n}`));
      const graded = type === 'single-select' || type === 'true-false';
      labels.forEach((label, o) => options.push({ id: `o-stress-${n}-${o}`, questionId: id, label, value: type === 'confidence-continuum' ? o + 1 : type === 'true-false' ? o === 0 : `v-${o}`, correct: graded ? o === 0 : null, imageUrl: null }));
      questions.push({ id, sectionId: section.id, type, prompt: `Stress question ${n}: ${type}${n % 6 === 0 ? `, with a much longer prompt to see how a question of several lines wraps on every device and in the charts of Results` : ''}?`, optionIds: labels.map((_, o) => `o-stress-${n}-${o}`), order: q + 1, layout: count ? 'text-list' : null });
      section.questionIds.push(id);
    }
    sections.push(section);
  }
  await seedPack(ds, { clients, sections, questions, options });
  const { session } = await ds.activateClient('c-stress-1', EVENT_DATE);
  const { questions: read, optionsOf } = await contentOf(ds, 'c-stress-1');
  const rows = visitRows(fake);
  const rankings = [[0, 1, 2, 3], [1, 0, 3, 2], [2, 3, 0, 1], [3, 2, 1, 0]];
  for (let index = 0; index < 400; index += 1) {
    const id = `t-stress-${String(index + 1).padStart(3, '0')}`;
    const createdAt = new Date(Date.parse(`${EVENT_DATE}T09:00:00.000Z`) + index * 20_000).toISOString();
    rows.track({ AppId: id, SessionId: session.id, ClientId: 'c-stress-1', JoinedVia: 'manual', SharePointUserId: String(1000 + index), CreatedAt: createdAt });
    rows.log({ AppId: `log-stress-${index + 1}`, SessionId: session.id, ClientId: 'c-stress-1', EntryMode: 'staff', SharePointUserId: String(1000 + index), SignedInName: `${LAST[index % LAST.length]}, ${FIRST[(index * 7) % FIRST.length]} ${index + 1}`, TrackId: id, VisitedAt: createdAt });
    if (index % 13 === 12) continue;
    const records = answersFor(r, { index }, read, optionsOf, { startAt: createdAt, rankings, stopAfter: index % 5 === 4 ? r.int(3, 25) : Infinity }).map((record) => {
      const question = read.find((each) => each.id === record.questionId);
      if (question.type !== 'multi-select') return record;
      const picked = r.shuffle(optionsOf(question)).slice(0, r.int(1, 3)).map((option) => option.id);
      return { ...record, answer: picked, firstAnswer: picked };
    });
    rows.answers(id, session.id, 'c-stress-1', records);
  }
  return {};
}

/**
 * Builds a scenario on a fresh mocked site and returns its state (the fake's exportState) and what the control page shows of it:
 * { state, extras: { notes, reveals, guests, chaos } }.
 * @param {string} name @param {{ pictures?: Map<string, { bytes: Uint8Array, type: string }> }} [options]
 */
export async function buildScenario(name, { pictures = pictureFiles() } = {}) {
  if (!(name in SCENARIOS)) throw new Error(`No scenario "${name}". The scenarios are: ${Object.keys(SCENARIOS).join(', ')}.`);
  return atFixedTime(async () => {
    const empty = name === 'empty';
    const { fake, ds } = await freshSite(empty ? { empty: true } : {});
    const restore = fake.install();
    const extras = { notes: [], reveals: [], guests: [], chaos: name === 'chaos' };
    const r = random(20261016);
    try {
      if (!empty) await addAdmin(ds);
      if (name === 'sample-pack') {
        const results = await seedSampleClients(ds, {
          siteUrl: SITE_URL,
          file: (fileName, type) => new Blob([readFileSync(path.join(ROOT, 'migration', 'src', 'assets', 'sample-pictures', fileName))], { type }),
        });
        extras.notes.push(`Seed sample clients: ${results.length} results (${Object.keys(SAMPLE_PICTURES).length} clients with pictures).`);
      } else if (name === 'pcoe-16oct') {
        extras.notes.push(...(await pcoe16Oct(fake, ds)).notes);
      } else if (name === 'stress') {
        await stress(fake, ds, r);
      } else if (!empty) {
        const loaded = await loadDataset(fake, ds, { withTiles: name === 'tiles', pictures });
        extras.notes.push(...loaded.notes);
        extras.reveals = loaded.records.reveals;
        if (name === 'event-day' || name === 'finished') {
          if (name === 'finished') await dominosDone(fake, ds, r);
          const { session, unscanned } = await eventDay(fake, ds, r);
          extras.guests = unscanned;
          if (name === 'finished') await ds.endSession(session.id);
        }
      }
    } finally {
      restore();
    }
    return { state: fake.exportState(), extras };
  });
}
