// An independent check of every number the admin shows a leader (Phase 9a).
//
//   node scripts/oracle-results.js [--seeds 200] [--from 1] [--pdf-every 10] [--local-every 10] [--verbose]
//
// It makes a random session from a seed (many participants, missing answers, retries, deleted questions, removed and renamed
// options, a changed answer key, restarts, repeated names, names in other scripts, long and awkward comments, and (Phase 9b) answer items
// damaged in storage: not JSON, or JSON that is not a list), stores it as RAW
// list rows, works every figure out again FROM THOSE ROWS with the few plain rules in `oracle()` below, and compares the answers
// with what the app makes of the same rows: the leader report's model, its CSV, the text of its PDF, the Results screen's rows
// and the Live display's tally, on the mocked SharePoint REST and (every so often) on the real local server.
//
// `oracle()` imports nothing from the app: no counting code, no naming rule, no pager rule. That is the point of it. Where it
// and the app disagree, one of them is wrong, and the run prints which figure, for which seed. Known, deliberate differences are
// in KNOWN below, each with its reason; nothing else is let through.
//
// scripts/test-oracle.js runs a small seeded version of this in `npm test`.

import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TITLE } from './sharepoint-fake.js';

// ---- A seeded random source ---------------------------------------------------------------------------------------------------------

export function random(seed) {
  let state = (seed >>> 0) || 1;
  const next = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
  const int = (low, high) => low + Math.floor(next() * (high - low + 1));
  const chance = (probability) => next() < probability;
  const pick = (list) => list[int(0, list.length - 1)];
  const shuffle = (list) => { const copy = [...list]; for (let index = copy.length - 1; index > 0; index -= 1) { const other = int(0, index); [copy[index], copy[other]] = [copy[other], copy[index]]; } return copy; };
  return { next, int, chance, pick, shuffle };
}

// ---- Words the fixtures are made of ---------------------------------------------------------------------------------------------------

const E_ACUTE = String.fromCharCode(0xE9);
const E_PLUS_COMBINING = `e${String.fromCharCode(0x301)}`;
const NAMES = [
  'Asha Rao', 'Ben Carter', 'Chen Wei', 'Dana Whitfield', `Jos${E_ACUTE} Carre${String.fromCharCode(0xF1)}o`, `Jos${E_PLUS_COMBINING} Carren${String.fromCharCode(0x303)}o`, 'ASHA RAO', 'asha rao',
  String.fromCodePoint(0x930, 0x93E, 0x91C, 0x947, 0x936), String.fromCodePoint(0x738B, 0x4F1F), String.fromCodePoint(0x645, 0x62D, 0x645, 0x62F), String.fromCodePoint(0x41E, 0x43B, 0x44C, 0x433, 0x430),
  `Zo${String.fromCharCode(0xEB)} ${String.fromCodePoint(0x1F44D)}`, '=HYPERLINK("http://example.invalid","Click")', '+44 20 7946 0000', '-Dash Person', '@handle', "O'Brien, Pat", 'Quote "Q" Person',
  'Wolfeschlegelsteinhausenbergerdorff Hubert Blaine von Hohenzollern-Sigmaringen the Elder of the House', 'Ben  Carter', ' Ben Carter ',
];
const COMMENTS = [
  'Great session.', 'The harbour tour was the part I will remember.', '=1+1', '+SUM(A1:A9)', '-2+3', '@cmd', 'Line one\nLine two', 'Comma, and "quotes"', 'x',
  `Tr${E_ACUTE}s bien, merci.`, String.fromCodePoint(0x1F44D, 0x1F3FD), String.fromCodePoint(0x6F22, 0x5B57), 'A  double  space', 'sec-trivia~c-dominos', '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  `${'Long answer with many words. '.repeat(40)}`.slice(0, 1000),
];
/** What a damaged ResponsesJson can hold (Phase 9b, DI-6): text that is not JSON, and JSON that is not a list. (Nothing in it at all is an empty list, not damage.) */
const DAMAGE = ['{oops', '{"answers":[]}', '"words"', '7', 'null', '[{"questionId":'];
const LABELS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', '=Foxtrot', 'Golf, with a comma', `Caf${E_ACUTE}`, 'True', 'False', 'A much longer answer option that goes on for some time'];
const KINDS = ['graded', 'graded', 'graded', 'graded', 'truefalse', 'poll', 'multi', 'scale', 'ranking', 'text'];

// ---- A random session, as logical records ---------------------------------------------------------------------------------------------

/** A session's records as the app's own data model has them, before they are stored. `p` namespaces every id, so many can share one store. */
export function generate(seed, { people = null } = {}) {
  const r = random(seed);
  const p = `o${seed}`;
  const client = { id: `${p}-client`, name: r.pick(['Harbour Co', 'Kroger', '=Formula Client', `Caf${E_ACUTE} & Sons, Ltd`]), slug: `${p}`, status: 'active' };
  const session = { id: `${p}-2026-10-13`, clientId: client.id, date: '2026-10-13', sectionIds: [], activeSectionId: null, status: r.chance(0.5) ? 'completed' : 'in-progress', endedAt: null, participationMode: r.chance(0.5) ? 'client-visit' : 'staff', activityFlow: 'sequential' };
  if (session.status === 'completed') session.endedAt = '2026-10-13T23:45:00.000Z';
  const sections = [];
  const questions = [];
  const options = [];
  let serial = 0;
  for (let s = 0; s < r.int(1, 4); s += 1) {
    const section = { id: `${p}-sec${s}`, title: r.pick(['Trivia', 'Feedback', 'Straight talk', '=Sum up', 'Warm-up']) + (s ? ` ${s + 1}` : ''), order: s + 1, enabled: true, industryTags: [], questionIds: [], clientId: client.id, description: '' };
    for (let q = 0; q < r.int(1, 5); q += 1) {
      const kind = r.pick(KINDS);
      const question = { id: `${p}-q${serial += 1}`, sectionId: section.id, kind, prompt: `${r.pick(['Which', 'What', '=Why', 'How  often'])} is question ${serial}?`, optionIds: [], order: q + 1,
        type: { graded: 'single-select', truefalse: 'true-false', poll: 'single-select', multi: 'multi-select', scale: 'confidence-continuum', ranking: 'ranked-voting', text: 'open-text-feedback' }[kind] };
      const count = kind === 'text' ? 0 : kind === 'truefalse' ? 2 : r.int(2, 5);
      const right = kind === 'graded' || kind === 'truefalse' ? r.int(0, count - 1) : -1;
      for (let o = 0; o < count; o += 1) {
        const option = { id: `${question.id}-o${o}`, questionId: question.id, label: kind === 'truefalse' ? ['True', 'False'][o] : `${r.pick(LABELS)} ${o + 1}`, value: kind === 'scale' ? o + 1 : String(o), correct: kind === 'graded' || kind === 'truefalse' ? o === right : null };
        options.push(option);
        question.optionIds.push(option.id);
      }
      questions.push(question);
      section.questionIds.push(question.id);
    }
    sections.push(section);
    session.sectionIds.push(section.id);
  }

  // People. A guest has a roster entry and a name on the visit; a staff member has a sign-in, written to the visit log (or not).
  const tracks = [];
  const roster = [];
  const visits = [];
  const items = new Map(); // trackId -> answer records
  const count = people ?? (r.chance(0.1) ? 0 : r.chance(0.1) ? r.int(40, 70) : r.int(1, 14));
  const optionsOf = (question) => question.optionIds.map((id) => options.find((option) => option.id === id));
  const answerAll = (track, from, onlySection = null) => {
    const mine = items.get(track.id) ?? [];
    let at = Date.parse(from);
    const stopAt = r.chance(0.35) ? r.int(0, questions.length) : Infinity;
    let answered = 0;
    for (const section of sections) {
      if (onlySection && section.id !== onlySection) continue;
      for (const id of section.questionIds) {
        if (answered >= stopAt) break;
        const question = questions.find((entry) => entry.id === id);
        const own = optionsOf(question);
        at += r.int(2, 40) * 1000 + r.int(0, 999);
        const stamp = new Date(at).toISOString();
        let record;
        if (question.kind === 'graded' || question.kind === 'truefalse') {
          const first = r.pick(own);
          if (first.correct) record = { answer: first.id, firstAnswer: first.id, attempts: 1, correct: true };
          else if (r.chance(0.2)) record = { answer: first.id, firstAnswer: first.id, attempts: 1, correct: false }; // wrong, never tried again
          else record = { answer: r.pick(own).id, firstAnswer: first.id, attempts: 2, correct: false };
        } else if (question.kind === 'text') {
          record = { answer: r.pick(COMMENTS).trim(), attempts: 1, correct: null };
        } else if (question.kind === 'multi') {
          record = { answer: r.shuffle(own).slice(0, r.int(1, own.length)).map((option) => option.id), attempts: 1, correct: null };
        } else if (question.kind === 'ranking') {
          record = { answer: r.shuffle(own).map((option) => option.id), attempts: 1, correct: null };
        } else {
          record = { answer: r.pick(own).id, attempts: 1, correct: null };
        }
        if (record.firstAnswer === undefined) record.firstAnswer = record.answer;
        const index = mine.findIndex((entry) => entry.questionId === id);
        const whole = { questionId: id, ...record, answeredAt: stamp };
        if (index === -1) mine.push(whole); else mine[index] = whole;
        answered += 1;
      }
    }
    items.set(track.id, mine);
  };
  let joined = Date.parse('2026-10-13T14:00:00.000Z');
  for (let n = 0; n < count; n += 1) {
    joined += r.chance(0.15) ? 0 : r.int(1, 90) * 1000;
    const guest = session.participationMode === 'client-visit' ? r.chance(0.9) : r.chance(0.1);
    const track = { id: `${p}-t${String(n).padStart(3, '0')}`, sessionId: session.id, clientId: client.id, joinedVia: guest || r.chance(0.3) ? 'qr' : 'manual', qrTokenId: null, visitorId: null, participantName: null, sharePointUserId: null,
      createdAt: new Date(joined).toISOString(), resumeCount: 0, lastResumedAt: null, restartedAt: null, restartSectionId: null };
    const name = r.pick(NAMES);
    if (guest) {
      const visitor = { id: `${p}-v${n}`, sessionId: session.id, displayName: name, enabled: true };
      roster.push(visitor);
      track.visitorId = visitor.id;
      track.participantName = r.chance(0.85) ? name : null; // an older visit kept no name of its own: the roster has it
      if (r.chance(0.2)) visitor.displayName = r.pick(NAMES); // the roster was edited afterwards: the visit keeps the name it had
      if (r.chance(0.7)) visits.push({ id: `${p}-log${n}`, sessionId: session.id, clientId: client.id, page: 'participant', entryMode: 'client-visit', sharePointUserId: null, displayName: '', visitorId: visitor.id, visitorName: track.participantName ?? '', trackId: track.id, visitedAt: track.createdAt });
    } else {
      track.sharePointUserId = String(r.chance(0.3) ? 42 : 100 + n); // sometimes several iPads share one sign-in
      const kept = r.chance(0.75);
      if (kept) visits.push({ id: `${p}-log${n}`, sessionId: session.id, clientId: client.id, page: 'participant', entryMode: 'staff', sharePointUserId: track.sharePointUserId, displayName: track.sharePointUserId === '42' ? 'Casey Example' : name, visitorId: null, visitorName: '', trackId: r.chance(0.8) ? track.id : null, visitedAt: track.createdAt });
    }
    tracks.push(track);
    if (!r.chance(0.12)) answerAll(track, track.createdAt); // some join and answer nothing: no item at all
    if (items.has(track.id) && r.chance(0.12)) {
      // The facilitator restarted this person: everything, or one activity. The answers in scope went then; some were given again.
      const sectionId = r.chance(0.5) ? r.pick(sections).id : null;
      const scope = sectionId ? sections.find((section) => section.id === sectionId).questionIds : null;
      items.set(track.id, items.get(track.id).filter((record) => scope !== null && !scope.includes(record.questionId)));
      track.restartedAt = new Date(joined + 3_600_000).toISOString();
      track.restartSectionId = sectionId;
      if (r.chance(0.7)) answerAll(track, track.restartedAt, sectionId);
    }
  }

  // What the facilitator did to the content afterwards.
  const edits = [];
  const gone = { questions: [], options: [], sections: [], tracks: [] };
  for (const question of [...questions]) {
    const own = optionsOf(question);
    if (r.chance(0.06)) { // deleted outright: its answers remain
      const section = sections.find((entry) => entry.id === question.sectionId);
      section.questionIds = section.questionIds.filter((id) => id !== question.id);
      questions.splice(questions.indexOf(question), 1);
      for (const option of own) options.splice(options.indexOf(option), 1);
      gone.questions.push(question.id);
      edits.push(`deleted ${question.id}`);
      continue;
    }
    if (r.chance(0.03)) { // taken out of its activity; the record still exists
      const section = sections.find((entry) => entry.id === question.sectionId);
      section.questionIds = section.questionIds.filter((id) => id !== question.id);
      edits.push(`unlisted ${question.id}`);
      continue;
    }
    if (own.length > 2 && r.chance(0.08)) { // an answer option removed
      const option = r.pick(own);
      options.splice(options.indexOf(option), 1);
      question.optionIds = question.optionIds.filter((id) => id !== option.id);
      gone.options.push(option.id);
      edits.push(`removed option ${option.id}`);
    }
    if (own.length && r.chance(0.1)) { r.pick(optionsOf(question)).label = `Renamed ${r.pick(LABELS)}`; edits.push(`renamed an option of ${question.id}`); }
    if ((question.kind === 'graded' || question.kind === 'truefalse') && r.chance(0.08)) { // the key moved to another answer
      const left = optionsOf(question);
      for (const option of left) option.correct = false;
      r.pick(left).correct = true;
      edits.push(`re-keyed ${question.id}`);
    } else if (question.kind === 'graded' && r.chance(0.03)) { for (const option of optionsOf(question)) option.correct = false; edits.push(`un-keyed ${question.id}`); } // now a poll
    else if (question.kind === 'poll' && r.chance(0.05)) { r.pick(optionsOf(question)).correct = true; edits.push(`keyed ${question.id}`); } // a poll given a right answer
  }
  for (const section of sections) if (r.chance(0.1)) { section.enabled = false; edits.push(`switched off ${section.id}`); }
  if (sections.length > 1 && r.chance(0.05)) { const section = r.pick(sections); sections.splice(sections.indexOf(section), 1); gone.sections.push(section.id); edits.push(`deleted activity ${section.id} (still listed by the session)`); }
  for (const track of [...tracks]) if (items.has(track.id) && items.get(track.id).length && r.chance(0.03)) { tracks.splice(tracks.indexOf(track), 1); gone.tracks.push(track.id); edits.push(`visit ${track.id} removed, its answers remain`); }

  // Until Phase 10c-2a some sessions (8 in 100) were also given the session's older shared item, as the legacy pages wrote it. Nothing
  // writes that item now and the app does not read one, so no session is given one. The draws that chose its answers are still made,
  // and thrown away: every seed is then the same session it always was in everything else (its visits, its answers, what was damaged).
  if (r.chance(0.08) && questions.length) for (let index = 0; index < Math.min(3, tracks.length); index += 1) r.pick(questions);

  // Answer items damaged in storage (Phase 9b, DI-6): drawn LAST, so that every session made before this existed is still the same session.
  const damaged = new Map(); // trackId -> the raw text now in ResponsesJson
  if (r.chance(0.25)) {
    const holders = tracks.filter((track) => (items.get(track.id) ?? []).length > 0);
    for (const track of r.shuffle(holders).slice(0, Math.min(holders.length, r.int(1, 3)))) damaged.set(track.id, r.pick(DAMAGE));
    if (damaged.size) edits.push(`damaged ${[...damaged.keys()].join(' ')}`);
  }
  return { seed, prefix: p, client, session, sections, questions, options, tracks, roster, visits, items, damaged, edits, gone };
}

// ---- Stored: the raw SharePoint rows, and the local server's files -------------------------------------------------------------------

const orNull = (value) => (value === undefined || value === '' ? null : value);

/** The rows as SharePoint holds them: internal column names, JSON as text, empty text as null. */
export function toRows(fixture) {
  const { client, session, sections, questions, options, tracks, roster, visits, items, damaged } = fixture;
  return {
    clients: [{ AppId: client.id, Title: client.name, Name: client.name, LogoUrl: null, PrimaryColor: null, SecondaryColor: null, CreatedAt: null, Slug: client.slug, ThemeJson: null, ThemeVersion: null, Status: client.status }],
    sessions: [{ AppId: session.id, Title: session.id, ClientId: session.clientId, SessionDate: `${session.date}T00:00:00Z`, SectionIds: JSON.stringify(session.sectionIds), ActiveSectionId: null, Status: session.status, EndedAt: session.endedAt, ParticipationMode: session.participationMode, ActivityFlow: session.activityFlow }],
    sections: sections.map((row) => ({ AppId: row.id, Title: row.title, SortOrder: row.order, Enabled: row.enabled, IndustryTags: '[]', QuestionIds: JSON.stringify(row.questionIds), ClientId: row.clientId, Description: orNull(row.description) })),
    questions: questions.map((row) => ({ AppId: row.id, Title: row.id, SectionId: row.sectionId, QuestionType: row.type, Prompt: row.prompt, OptionIds: JSON.stringify(row.optionIds), SortOrder: row.order, Layout: null })),
    options: options.map((row) => ({ AppId: row.id, Title: row.id, QuestionId: row.questionId, Label: row.label, OptionValue: String(row.value), Correct: row.correct === true, ImageUrl: null })),
    tracks: tracks.map((row) => ({ AppId: row.id, Title: row.id, SessionId: row.sessionId, ClientId: row.clientId, JoinedVia: row.joinedVia, QrTokenId: null, VisitorId: orNull(row.visitorId), ParticipantName: orNull(row.participantName), SharePointUserId: orNull(row.sharePointUserId), CreatedAt: row.createdAt, ResumeCount: 0, LastResumedAt: null, RestartedAt: row.restartedAt, RestartSectionId: row.restartSectionId })),
    visitorroster: roster.map((row) => ({ AppId: row.id, Title: row.id, SessionId: row.sessionId, GuestName: row.displayName, Enabled: row.enabled })),
    uservisitlogs: visits.map((row) => ({ AppId: row.id, Title: row.id, SessionId: row.sessionId, ClientId: row.clientId, Page: row.page, EntryMode: row.entryMode, SharePointUserId: orNull(row.sharePointUserId), SignedInName: orNull(row.displayName), VisitorId: orNull(row.visitorId), VisitorName: orNull(row.visitorName), TrackId: orNull(row.trackId), VisitedAt: row.visitedAt })),
    responses: [
      ...[...items].map(([trackId, records]) => ({ AppId: trackId, Title: trackId, SessionId: session.id, TrackId: trackId, ClientId: client.id, ResponsesJson: damaged.get(trackId) ?? JSON.stringify(records) })),
    ],
  };
}

/** The same records as the local server's JSON files hold them. */
export function toLocalFiles(fixtures) {
  const all = (key, shape = (row) => row) => fixtures.flatMap((fixture) => fixture[key].map(shape));
  return {
    clients: fixtures.map((fixture) => fixture.client),
    sessions: fixtures.map((fixture) => fixture.session),
    sections: all('sections'),
    questions: all('questions', ({ kind, ...row }) => row),
    options: all('options'),
    tracks: all('tracks'),
    visitorroster: all('roster'),
    uservisitlogs: all('visits'),
    // (A damaged item is the same text locally, where text is not a list either.)
    participantresponses: fixtures.flatMap((fixture) => [...fixture.items].map(([trackId, responses]) => ({ id: trackId, trackId, sessionId: fixture.session.id, clientId: fixture.client.id, responses: fixture.damaged.get(trackId) ?? responses }))),
    qrtokens: [], adminusers: [], appsettings: [],
  };
}

// ---- THE ORACLE: every figure, from the raw rows, by plain rules ---------------------------------------------------------------------
// Nothing below this line and above "The app's side" imports or calls the app.

const tidy = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const asList = (value) => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);
/** A stored ResponsesJson as a list of records; nothing in it is an empty list, and anything that is not a JSON list is null (damaged). */
const readable = (text) => {
  if (text === undefined || text === null || text === '') return [];
  try { const value = JSON.parse(text); return Array.isArray(value) ? value : null; } catch { return null; }
};

/**
 * @param {ReturnType<typeof toRows>} rows
 * @param {string} sessionId
 */
export function oracle(rows, sessionId) {
  const session = rows.sessions.find((row) => row.AppId === sessionId);
  const listed = JSON.parse(session.SectionIds || '[]');

  // 1. Whose answer is whose: each participant has an item of their own (TrackId). An item with no TrackId is nobody's.
  const owners = []; // in the order storage first names them
  const held = new Map();
  const put = (owner, questionId, record) => {
    if (!held.has(owner)) { held.set(owner, new Map()); owners.push(owner); }
    held.get(owner).set(questionId, record);
  };
  const unreadable = []; // the items that cannot be read: not counted, and named
  for (const item of rows.responses.filter((row) => row.SessionId === sessionId && row.TrackId)) {
    const list = readable(item.ResponsesJson);
    if (list === null) { unreadable.push({ id: item.TrackId }); continue; }
    for (const entry of list) {
      // What counts for a question that was graded when it was answered is the FIRST pick.
      put(item.TrackId, entry.questionId, { first: entry.firstAnswer, final: entry.answer, counted: entry.correct === null ? entry.answer : entry.firstAnswer, attempts: entry.attempts, stored: entry.correct, at: entry.answeredAt });
    }
  }

  // 2. Who took part: every visit in the order it began, then anyone whose answers outlived their visit.
  const tracks = rows.tracks.filter((row) => row.SessionId === sessionId)
    .sort((a, b) => (a.CreatedAt < b.CreatedAt ? -1 : a.CreatedAt > b.CreatedAt ? 1 : a.AppId < b.AppId ? -1 : 1));
  const people = [...tracks.map((track) => ({ key: track.AppId, track })), ...owners.filter((owner) => !tracks.some((track) => track.AppId === owner)).map((owner) => ({ key: owner, track: null }))];
  const logs = rows.uservisitlogs.filter((row) => row.SessionId === sessionId).sort((a, b) => (a.VisitedAt < b.VisitedAt ? -1 : a.VisitedAt > b.VisitedAt ? 1 : 0));
  const latest = (wanted, read) => { let found = ''; for (const log of logs) if (wanted(log) && read(log)) found = read(log); return found; };
  let unnamed = 0;
  const seen = new Map();
  for (const person of people) {
    const track = person.track;
    let name = '';
    if (track) {
      name = tidy(track.ParticipantName)
        || latest((log) => log.TrackId === track.AppId, (log) => tidy(log.VisitorName) || tidy(log.SignedInName))
        || (track.VisitorId ? tidy(rows.visitorroster.find((row) => row.AppId === track.VisitorId)?.GuestName) : '')
        || (!track.VisitorId && track.SharePointUserId !== null ? latest((log) => log.SharePointUserId === track.SharePointUserId && !log.VisitorId, (log) => tidy(log.SignedInName)) : '');
    }
    person.unnamed = !name;
    if (!name) name = `Unnamed participant ${unnamed += 1}`;
    else {
      const key = name.normalize('NFC').toLowerCase();
      seen.set(key, (seen.get(key) ?? 0) + 1);
      if (seen.get(key) > 1) name = `${name} (${seen.get(key)})`;
    }
    person.name = name;
  }

  // 3. The activities and questions as they stand NOW.
  const optionsOf = (question) => JSON.parse(question.OptionIds || '[]').map((id) => rows.options.find((row) => row.AppId === id)).filter(Boolean);
  const kindOf = (question, own) => (question.QuestionType === 'open-text-feedback' ? 'text' : question.QuestionType === 'ranked-voting' ? 'ranking' : question.QuestionType === 'multi-select' ? 'multi'
    : question.QuestionType === 'confidence-continuum' ? 'scale' : own.some((option) => option.Correct === true) ? 'graded' : 'choice');
  const everyoneAnswered = new Set([...held.values()].flatMap((mine) => [...mine.keys()]));
  const activities = [];
  const sessionSections = []; // every activity the session lists that still exists, switched on or not (what the screens tally over)
  let number = 0;
  for (const id of listed) {
    const section = rows.sections.find((row) => row.AppId === id);
    if (!section) continue;
    const questions = JSON.parse(section.QuestionIds || '[]').map((questionId) => rows.questions.find((row) => row.AppId === questionId)).filter(Boolean)
      .map((question) => { const own = optionsOf(question); return { id: question.AppId, prompt: tidy(question.Prompt), type: question.QuestionType, options: own, kind: kindOf(question, own) }; });
    const on = section.Enabled === true;
    sessionSections.push({ id, on, questions });
    if (!on && !questions.some((question) => everyoneAnswered.has(question.id))) continue; // switched off and never answered: not in the report
    activities.push({ id, title: tidy(section.Title), on, questions: questions.map((question) => ({ ...question, number: number += 1 })) });
  }
  const placed = new Set(activities.flatMap((activity) => activity.questions.map((question) => question.id)));

  // 4. Right or wrong, by the answer that is marked correct now; an option that has gone is judged by what was recorded then.
  const rightNow = (question, id, record) => { const option = question.options.find((row) => row.AppId === id); return option ? option.Correct === true : record.first === id && record.stored === true; };
  // A wrong first answer that was never tried again is not a final answer.
  const isOpen = (question, record) => question.kind === 'graded' && record.stored === false && record.attempts !== null && record.attempts < 2 && !rightNow(question, record.final, record);
  const label = (question, id) => tidy(question.options.find((row) => row.AppId === id)?.Label) || null; // null: an option that was removed

  // 5. Each person.
  for (const person of people) {
    const mine = held.get(person.key) ?? new Map();
    Object.assign(person, { answered: 0, gradedAnswered: 0, gradedRight: 0, rows: [] });
    const statuses = [];
    for (const activity of activities) {
      let given = 0;
      let final = 0;
      for (const question of activity.questions) {
        const record = mine.get(question.id);
        const row = { number: question.number, questionId: question.id, activity: activity.title, prompt: question.prompt, kind: question.kind, answered: Boolean(record) };
        if (record) {
          person.answered += 1;
          given += 1;
          const graded = question.kind === 'graded';
          if (graded) { person.gradedAnswered += 1; row.firstRight = rightNow(question, record.first, record); row.finalRight = rightNow(question, record.final, record); if (row.firstRight) person.gradedRight += 1; }
          row.open = isOpen(question, record);
          if (!row.open) final += 1;
          row.first = graded ? record.first : record.counted;
          row.final = graded ? record.final : record.counted;
          row.attempts = record.attempts;
          row.at = record.at;
        }
        person.rows.push(row);
      }
      statuses.push({ on: activity.on, size: activity.questions.length, status: activity.questions.length > 0 && final === activity.questions.length ? 'finished' : given > 0 ? 'started' : 'not-started' });
    }
    const required = statuses.filter((status) => status.on && status.size > 0);
    person.statuses = statuses;
    person.activityCount = required.length;
    person.activitiesFinished = required.filter((status) => status.status === 'finished').length;
    person.finishedAll = required.length > 0 && person.activitiesFinished === required.length;
    person.score = person.gradedAnswered > 0 ? (person.gradedRight / person.gradedAnswered) * 100 : null;
    person.strays = [...mine.keys()].filter((questionId) => !placed.has(questionId)).length;
  }

  // 6. Each question.
  const tally = (question, among) => {
    const records = among.map((person) => held.get(person.key)?.get(question.id)).filter(Boolean);
    const counts = new Map(question.options.map((option) => [option.AppId, 0]));
    for (const record of records) {
      // A graded question counts first picks; every other kind counts the answer (each option of a list once).
      for (const id of question.kind === 'graded' ? [record.first] : [...new Set(asList(record.counted))]) if (counts.has(id)) counts.set(id, counts.get(id) + 1);
    }
    const result = { respondents: records.length, counts };
    if (question.kind === 'graded') result.right = records.filter((record) => rightNow(question, record.first, record)).length;
    if (question.kind === 'scale') {
      const own = question.options.map((option) => (option.OptionValue === null || option.OptionValue === '' ? NaN : Number(option.OptionValue)));
      const place = new Map(question.options.map((option, index) => [option.AppId, own.every(Number.isFinite) ? own[index] : index + 1]));
      const chosen = records.map((record) => place.get(record.counted)).filter((value) => value !== undefined);
      result.average = chosen.length ? chosen.reduce((sum, value) => sum + value, 0) / chosen.length : null;
    }
    if (question.kind === 'ranking') {
      // Borda, among the options that still exist: with n of them, the one a person put highest earns n, the next n - 1 ...
      const size = question.options.length;
      result.borda = new Map(question.options.map((option) => [option.AppId, 0]));
      result.bordaAsStored = new Map(question.options.map((option) => [option.AppId, 0]));
      for (const record of records) {
        const order = asList(record.counted);
        const still = order.filter((id) => result.borda.has(id));
        still.forEach((id, index) => result.borda.set(id, result.borda.get(id) + (size - index)));
        // The same, by each option's place in the answer as it was stored (a removed option still holds its place).
        order.forEach((id, index) => { if (result.bordaAsStored.has(id)) result.bordaAsStored.set(id, result.bordaAsStored.get(id) + (size - index)); });
      }
    }
    return result;
  };
  for (const activity of activities) {
    for (const question of activity.questions) Object.assign(question, tally(question, people), {
      comments: question.kind === 'text' ? people.flatMap((person) => { const record = held.get(person.key)?.get(question.id); return record ? [{ name: person.name, text: String(record.counted ?? '') }] : []; }) : [],
    });
    activity.finished = people.filter((person) => person.statuses[activities.indexOf(activity)].status === 'finished').length;
    activity.started = people.filter((person) => person.statuses[activities.indexOf(activity)].status === 'started').length;
  }

  // 7. The summary.
  const scored = people.filter((person) => person.score !== null);
  const graded = activities.filter((activity) => activity.on).flatMap((activity) => activity.questions).filter((question) => question.kind === 'graded' && question.respondents > 0)
    .map((question) => ({ number: question.number, right: question.right, answered: question.respondents, percent: (question.right / question.respondents) * 100 }));
  const extreme = (sign) => [...graded].sort((a, b) => sign * (a.percent - b.percent) || b.answered - a.answered || a.number - b.number)[0] ?? null;
  const flat = graded.length > 0 && graded.every((question) => question.percent === graded[0].percent);

  // 8. What the Results screen and the Live display count: every activity the session lists, switched on or not, by the people who have a visit.
  const screen = {
    sections: sessionSections.map((section) => ({ id: section.id, questions: section.questions.map((question) => ({ id: question.id, kind: question.kind, ...tally(question, people) })) })),
    rows: people.filter((person) => person.track).map((person) => {
      const expected = sessionSections.filter((section) => section.on).flatMap((section) => section.questions.map((question) => question.id));
      const mine = held.get(person.key) ?? new Map();
      // "Completed" on the screen is what the participant's own page calls finished: every question answered, none of them a wrong
      // first answer still waiting for its Retry (told from the stored record alone, as that page tells it).
      const waiting = (record) => record.stored === false && record.attempts !== null && record.attempts < 2;
      const completed = expected.length > 0 && expected.every((id) => mine.has(id) && !waiting(mine.get(id)));
      return { trackId: person.key, name: person.name, answered: expected.filter((id) => mine.has(id)).length, total: expected.length, completed };
    }),
  };

  return {
    people, activities, screen, unreadable,
    summary: {
      // (Somebody whose answers could not be read has not "answered nothing": nobody knows.)
      joined: people.length, finishedAll: people.filter((person) => person.finishedAll).length, answeredNothing: people.filter((person) => person.answered === 0 && person.strays === 0 && !unreadable.some((entry) => entry.id === person.key)).length,
      scored: scored.length, average: scored.length ? scored.reduce((sum, person) => sum + person.score, 0) / scored.length : null,
      questionCount: activities.reduce((sum, activity) => sum + activity.questions.length, 0),
      gradedCount: activities.flatMap((activity) => activity.questions).filter((question) => question.kind === 'graded').length,
      commentCount: activities.flatMap((activity) => activity.questions).reduce((sum, question) => sum + question.comments.length, 0),
      hardest: flat ? null : extreme(1), easiest: flat ? null : extreme(-1),
    },
    label,
  };
}

/** "2026-10-13 19:35:09" for an instant, in a zone that keeps one offset all year (so no rule about summer time is needed). */
export const FIXED_ZONES = { UTC: 0, 'Asia/Kolkata': 330, 'America/Phoenix': -420, 'Pacific/Kiritimati': 840 };
export function wallClock(iso, zone) {
  const shifted = new Date(Date.parse(iso) + FIXED_ZONES[zone] * 60_000);
  const two = (value) => String(value).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${two(shifted.getUTCMonth() + 1)}-${two(shifted.getUTCDate())} ${two(shifted.getUTCHours())}:${two(shifted.getUTCMinutes())}:${two(shifted.getUTCSeconds())}`;
}

/** A CSV file as rows of cells (RFC 4180: quoted cells, doubled quotes, line breaks inside quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const body = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quoted) {
      if (char === '"' && body[index + 1] === '"') { cell += '"'; index += 1; } else if (char === '"') quoted = false; else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; } else if (char === '\r' && body[index + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; index += 1; } else cell += char;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ---- The app's side -----------------------------------------------------------------------------------------------------------------

/**
 * Differences that are understood and meant. Anything else the comparison finds is a failure. There are none: the one there was
 * (the Results screen calling a visit "completed" while a wrong first answer was still waiting for its Retry) was fixed in Phase 9a.
 */
export const KNOWN = Object.freeze({});

const close = (a, b) => (a === null || b === null ? a === b : Math.abs(a - b) < 1e-9);

/**
 * Compares everything the app makes of a stored session with the oracle's figures. Resolves to the list of differences (empty when
 * they agree). `app` is the loaded app modules (see loadApp); the data service must already point at where `fixture` is stored.
 */
export async function compare(fixture, truth, app, { zone = 'UTC', pdf = false, source = 'sharepoint' } = {}) {
  const sessionId = fixture.session.id;
  const diffs = [];
  const differ = (what, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) diffs.push(`[${source}] seed ${fixture.seed}: ${what}: the app says ${JSON.stringify(got)}, the oracle ${JSON.stringify(want)}`); };

  // The leader report's model.
  const records = await app.readLeaderReportRecords(sessionId);
  const report = app.buildLeaderReport(records, { generatedAt: '2026-10-14T09:30:00.000Z', timeZone: zone });
  differ('participants, in order', report.participants.map((person) => person.name), truth.people.map((person) => person.name));
  // Phase 9b (DI-6): the answer items that could not be read are named exactly, here and on both screens, and the report says so in its own words.
  const idsOf = (list) => list.map((entry) => entry.id).sort();
  const wantUnreadable = idsOf(truth.unreadable);
  differ('unreadable items: what the report reads', idsOf(records.unreadable ?? []), wantUnreadable);
  differ('unreadable items: the report', idsOf(report.unreadable), wantUnreadable);
  const notice = report.meta.unreadableNotice;
  const damagedPeople = truth.unreadable;
  if (truth.unreadable.length === 0) differ('the report says nothing about unreadable items when there are none', notice, '');
  else {
    const named = damagedPeople.map((entry) => truth.people.find((person) => person.key === entry.id)?.name);
    if (damagedPeople.length > 0 && !notice.includes(`${damagedPeople.length} participant${damagedPeople.length === 1 ? "'s" : "s'"} answers could not be read and are not counted: `)) diffs.push(`[${source}] seed ${fixture.seed}: the notice does not count ${damagedPeople.length} damaged participant item(s): ${JSON.stringify(notice)}`);
    if (damagedPeople.length <= 8) for (const name of named) if (!notice.includes(name)) diffs.push(`[${source}] seed ${fixture.seed}: the notice does not name ${JSON.stringify(name)}: ${JSON.stringify(notice)}`);
    if (!notice.endsWith(`Correct or delete the damaged item in the ${TITLE.responses} list, then reload.`)) diffs.push(`[${source}] seed ${fixture.seed}: the notice does not say what to do: ${JSON.stringify(notice)}`);
  }
  differ('the people marked as unreadable in the report', report.participants.filter((person) => person.unreadable).map((person) => person.key).sort(), damagedPeople.map((entry) => entry.id).sort());
  truth.people.forEach((person, index) => {
    const got = report.participants[index];
    if (!got) return;
    differ(`${person.name}: answered / graded answered / right first time`, [got.answered, got.gradedAnswered, got.gradedRight], [person.answered, person.gradedAnswered, person.gradedRight]);
    differ(`${person.name}: finished every activity`, got.finishedAll, person.finishedAll);
    differ(`${person.name}: activities finished`, [got.activitiesFinished, got.activityCount], [person.activitiesFinished, person.activityCount]);
    differ(`${person.name}: answers outside the activities`, got.strays, person.strays);
    if (!close(got.scorePercent, person.score)) differ(`${person.name}: score`, got.scorePercent, person.score);
  });
  const s = report.summary;
  differ('summary: joined / finished all / answered nothing / scored', [s.joined, s.finishedAll, s.answeredNothing, s.scored], [truth.summary.joined, truth.summary.finishedAll, truth.summary.answeredNothing, truth.summary.scored]);
  differ('summary: questions / graded / comments', [s.questionCount, s.gradedCount, s.commentCount], [truth.summary.questionCount, truth.summary.gradedCount, truth.summary.commentCount]);
  if (!close(s.averageScore, truth.summary.average)) differ('summary: average first-try score', s.averageScore, truth.summary.average);
  for (const which of ['hardest', 'easiest']) differ(`summary: ${which}`, s[which] && [s[which].number, s[which].right, s[which].answered], truth.summary[which] && [truth.summary[which].number, truth.summary[which].right, truth.summary[which].answered]);
  differ('activities, in order', report.activities.map((activity) => [activity.title, activity.off, activity.questions.length]), truth.activities.map((activity) => [activity.title, !activity.on, activity.questions.length]));
  truth.activities.forEach((activity, a) => {
    const got = report.activities[a];
    if (!got || got.questions.length !== activity.questions.length) return;
    differ(`${activity.title}: finished / started`, [got.finished, got.started], [activity.finished, activity.started]);
    activity.questions.forEach((question, q) => {
      const mine = got.questions[q];
      const where = `question ${question.number} (${question.kind})`;
      differ(`${where}: kind`, mine.kind, question.kind);
      differ(`${where}: answered by`, mine.respondents, question.respondents);
      differ(`${where}: count for each option`, mine.options.map((option) => option.count), [...question.counts.values()]);
      if (question.kind === 'graded') differ(`${where}: right first time`, [mine.firstTry.right, mine.firstTry.answered], [question.right, question.respondents]);
      if (question.kind === 'scale' && !close(mine.average?.value ?? null, question.average)) differ(`${where}: average`, mine.average?.value ?? null, question.average);
      if (question.kind === 'ranking') differ(`${where}: Borda points`, Object.fromEntries(mine.ranking.map((row) => [row.label, row.score]).sort()), Object.fromEntries(question.options.map((option) => [tidy(option.Label), question.borda.get(option.AppId)]).sort()));
      if (question.kind === 'text') differ(`${where}: comments`, mine.comments, question.comments);
    });
  });

  // The participant CSV.
  const csvText = app.participantAnswersCsv(report);
  const csv = parseCsv(csvText);
  if (csvText.charCodeAt(0) !== 0xFEFF) diffs.push(`seed ${fixture.seed}: the CSV has no byte-order mark`);
  // (Takes the guard back off: the apostrophe in front of a sign at the start, after white space or the zero-width space, and after a ; or a tab.)
  const blank = `[\\s${String.fromCharCode(0x200B)}]*`;
  const unguard = (cell) => cell.replace(new RegExp(`^'(?=${blank}[=+\\-@]|[\\t\\r])`), '').replace(new RegExp(`([;\\t])'(?=${blank}[=+\\-@])`, 'g'), '$1');
  for (const [r, row] of csv.entries()) for (const [c, cell] of row.entries()) if (/^[=+\-@\t\r]/.test(cell)) diffs.push(`seed ${fixture.seed}: CSV row ${r + 1}, column ${c + 1} starts a formula: ${JSON.stringify(cell.slice(0, 30))}`);
  const expectedRows = truth.people.flatMap((person) => person.rows.map((row) => ({ person, row })));
  const strayCount = truth.people.reduce((sum, person) => sum + person.strays, 0);
  differ('CSV: rows', csv.length - 1, expectedRows.length + strayCount);
  const activityOf = (questionId) => truth.activities.flatMap((activity) => activity.questions).find((question) => question.id === questionId);
  const wording = (question, value) => {
    if (question.kind === 'text') return String(value ?? '');
    const named = (id) => truth.label(question, id);
    if (question.kind === 'ranking') return asList(value).map((id, index) => `${index + 1}. ${named(id) ?? '?'}`).join('  ');
    if (question.kind === 'multi') return asList(value).map((id) => named(id) ?? '?').join('; ');
    return named(value) ?? '?';
  };
  expectedRows.forEach(({ person, row }, index) => {
    const cells = (csv[index + 1] ?? []).map(unguard);
    const where = `CSV row ${index + 2} (${person.name}, question ${row.number})`;
    differ(`${where}: client, date, participant, activity, question`, cells.slice(0, 5), [tidy(fixture.client.name) || 'Client', fixture.session.date, person.name, row.activity, row.prompt]);
    if (!row.answered) { differ(`${where}: an unanswered question`, cells.slice(5), ['', '', '', '', '0', '']); return; }
    const question = activityOf(row.questionId);
    // An option that was removed has no label any more: the file must say so in words, never print its id.
    const check = (cell, value, what) => {
      const want = wording(question, value);
      if (want.includes('?')) { if (/-o\d|^o\d+-/.test(cell) || cell === '') diffs.push(`seed ${fixture.seed}: ${where}: ${what} shows an id or nothing for a removed option: ${JSON.stringify(cell)}`); return; }
      const got = question.kind === 'scale' ? cell.replace(/ \(\d+(?:\.\d+)? of \d+(?:\.\d+)?\)$/, '') : cell;
      differ(`${where}: ${what}`, got, want);
    };
    check(cells[5], row.first, 'first answer');
    check(cells[6], row.final, 'final answer');
    const yes = (value) => (value === undefined ? '' : value ? 'Yes' : 'No');
    differ(`${where}: correct, correct on first try`, [cells[7], cells[8]], [yes(row.finalRight), yes(row.firstRight)]);
    differ(`${where}: attempts`, cells[9], row.attempts === null ? '' : String(row.attempts));
    differ(`${where}: answered at (${zone})`, cells[10], row.at ? wallClock(row.at, zone) : '');
  });

  // The Results screen's rows and the Live display's tally.
  // (As lib/adminData.ts reads them for the Results screen and the exports; scripts/test-oracle.js holds that file to this line.)
  const results = await app.readSessionResults(sessionId);
  differ('unreadable items: the Results screen', idsOf(results.unreadable), wantUnreadable);
  const sources = (await app.readNameSources([sessionId])).get(sessionId);
  const rows = app.resultRows(results, sources);
  differ('Results screen: names, in order', rows.map((row) => row.name), truth.screen.rows.map((row) => row.name));
  truth.screen.rows.forEach((want, index) => {
    const got = rows[index];
    if (!got) return;
    differ(`Results screen, ${want.name}: answered of total`, [got.answered, got.total], [want.answered, want.total]);
    differ(`Results screen, ${want.name}: completed`, got.status === 'completed', want.completed);
    differ(`Results screen, ${want.name}: answers that could not be read`, got.status === 'unreadable', truth.unreadable.some((entry) => entry.id === want.trackId));
  });
  const structure = await app.loadLiveStructure(sessionId);
  const live = await app.readLive(structure);
  differ('unreadable items: the Live display', idsOf(live.results.unreadable), wantUnreadable);
  for (const [name, tree] of [['Results screen', results], ['Live display', live.results]]) {
    differ(`${name}: activities`, tree.sections.map((section) => section.id), truth.screen.sections.map((section) => section.id));
    truth.screen.sections.forEach((section, a) => section.questions.forEach((question, q) => {
      const got = tree.sections[a]?.questions[q];
      if (!got) { diffs.push(`[${source}] seed ${fixture.seed}: ${name}: question ${question.id} is missing`); return; }
      differ(`${name}, ${question.id}: answered by`, got.respondents, question.respondents);
      differ(`${name}, ${question.id} (${question.kind}): count for each option`, got.options.map((option) => option.count), [...question.counts.values()]);
      if (question.kind === 'ranking') differ(`${name}, ${question.id}: Borda points`, got.options.map((option) => option.score), [...question.borda.values()]);
    }));
  }

  // The PDF's own words: the figures a reader sees are the model's, which are the oracle's.
  if (pdf) {
    const made = await app.makeReport(records, { generatedAt: '2026-10-14T09:30:00.000Z', timeZone: zone });
    const read = await app.inspectPdf(made.bytes);
    const text = app.squash(read.pages.map((page) => page.text).join(' '));
    const times = (needle) => text.split(app.squash(needle)).length - 1;
    // What the report's two faces can draw: Basic Latin to Latin Extended-A, and the common punctuation (code points, so nothing here is invisible).
    const printable = (value) => [...value].every((char) => { const code = char.codePointAt(0); return (code >= 0x20 && code <= 0x17F) || (code >= 0x2013 && code <= 0x2026); });
    const wanted = new Map();
    const want = (line) => wanted.set(line, (wanted.get(line) ?? 0) + 1);
    for (const person of truth.people) {
      want(person.score === null ? 'No graded question answered' : `${person.gradedRight} of ${person.gradedAnswered} right first time (${Math.round(person.score)}%)`);
      want(`${person.answered} of ${truth.summary.questionCount} answered`);
      want(`Activities finished: ${person.activitiesFinished} of ${person.activityCount}`);
      // (A heading is one line: a name too long for it is cut there, so only its start is looked for. The CSV has it whole.)
      if (printable(person.name) && times(person.name.slice(0, 24)) < 1) diffs.push(`seed ${fixture.seed}: PDF: the name ${JSON.stringify(person.name)} is not in the file`);
    }
    for (const question of truth.activities.flatMap((activity) => activity.questions)) {
      want(`Answered by ${question.respondents} of ${truth.summary.joined}.`);
      for (const comment of question.comments) if (printable(comment.text) && comment.text.trim() && times(comment.text) < 1) diffs.push(`seed ${fixture.seed}: PDF: a comment is not in the file in full: ${JSON.stringify(comment.text.slice(0, 40))}`);
    }
    // The notice is on the cover in words the font can print, whoever is named (a name it cannot draw is printed as one replacement character).
    const coverText = app.squash(read.pages[0].text);
    differ('PDF: the cover says answers could not be read, if and only if some could not', coverText.includes(app.squash('answers could not be read and are not counted')), truth.unreadable.length > 0);
    for (const [line, count] of wanted) if (times(line) < count) diffs.push(`seed ${fixture.seed}: PDF: "${line}" is printed ${times(line)} time(s), expected at least ${count}`);
    if (times(`${truth.summary.finishedAll} of ${truth.summary.joined}`) < 1) diffs.push(`seed ${fixture.seed}: PDF: the "finished every activity" figure is not in the file`);
    if (read.pages.some((page, index) => !app.squash(page.text).includes(app.squash(`Page ${index + 1} of ${read.pages.length}`)))) diffs.push(`seed ${fixture.seed}: PDF: a page lacks "Page N of M"`);
  }
  return { diffs, report };
}

/** The app modules the comparison drives. Loaded here, away from the oracle, so that the oracle above cannot reach them. */
export async function loadApp() {
  const [ds, report, data, names, live, fake, node, inspect, results] = await Promise.all([
    import('../public/js/dataService.js'), import('../migration/src/lib/leader-report.js'), import('../migration/src/lib/leader-report-data.js'),
    import('../migration/src/lib/admin-results.js'), import('../migration/src/lib/live-session.js'), import('./sharepoint-fake.js'), import('./leader-report-node.js'), import('./pdf-inspect.js'), import('../migration/src/lib/session-results.js'),
  ]);
  return { ds, buildLeaderReport: report.buildLeaderReport, participantAnswersCsv: report.participantAnswersCsv, readLeaderReportRecords: data.readLeaderReportRecords,
    readNameSources: names.readNameSources, resultRows: names.resultRows, loadLiveStructure: live.loadLiveStructure, readLive: live.readLive, readSessionResults: results.readSessionResults,
    createSharePointFake: fake.createSharePointFake, makeReport: node.makeReport, inspectPdf: inspect.inspectPdf, squash: inspect.squash };
}

/** Stores a fixture's raw rows in a new mocked SharePoint and points the data service at it. */
export function storeInSharePoint(app, fixture) {
  const fake = app.createSharePointFake();
  fake.install();
  app.ds.configure({ sharePoint: fake.settings });
  const rows = toRows(fixture);
  for (const [list, entries] of Object.entries(rows)) for (const row of entries) fake.add(list, row);
  return { fake, rows };
}

/** A real local server on a scratch folder holding these fixtures. Resolves to { baseUrl, stop }. */
export async function startLocalServer(fixtures) {
  const { freePort } = await import('./free-port.js');
  const root = path.join(import.meta.dirname, '..');
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cec-oracle-'));
  await mkdir(dataDir, { recursive: true });
  for (const [name, records] of Object.entries(toLocalFiles(fixtures))) await writeFile(path.join(dataDir, `${name}.json`), JSON.stringify(records));
  const port = await freePort();
  const server = spawn(process.execPath, [path.join(root, 'server', 'index.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, UPLOAD_DIR: path.join(dataDir, 'uploads') }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    server.once('exit', (code) => reject(new Error(`the local server exited early (code ${code})`)));
    server.stdout.on('data', (chunk) => String(chunk).includes('running') && resolve());
  });
  return { baseUrl: `http://localhost:${port}/api`, stop: async () => { server.kill(); await rm(dataDir, { recursive: true, force: true }); } };
}

/**
 * Runs seeds `from` .. `from + seeds - 1`. Resolves to { diffs, checked, people, zones }.
 * @param {{ from?: number, seeds?: number, pdfEvery?: number, localEvery?: number, verbose?: boolean }} [options]
 */
export async function run({ from = 1, seeds = 50, pdfEvery = 10, localEvery = 10, verbose = false } = {}) {
  const app = await loadApp();
  const realFetch = globalThis.fetch;
  const zones = Object.keys(FIXED_ZONES);
  const diffs = [];
  const local = [];
  let people = 0;
  try {
    for (let seed = from; seed < from + seeds; seed += 1) {
      const fixture = generate(seed);
      const { rows } = storeInSharePoint(app, fixture);
      const truth = oracle(rows, fixture.session.id);
      const zone = zones[seed % zones.length];
      const found = await compare(fixture, truth, app, { zone, pdf: pdfEvery > 0 && seed % pdfEvery === 0 });
      diffs.push(...found.diffs);
      people += truth.people.length;
      if (localEvery > 0 && seed % localEvery === 0) local.push({ fixture, truth, zone, report: found.report });
      if (verbose) console.log(`seed ${seed}: ${truth.people.length} people, ${truth.summary.questionCount} questions, ${zone}${fixture.edits.length ? `; ${fixture.edits.join(', ')}` : ''}: ${found.diffs.length ? `${found.diffs.length} DIFFERENCE(S)` : 'agrees'}`);
    }
    if (local.length) {
      // The same sessions on the real local server: the oracle's figures again, and the SharePoint adapter's report, word for word.
      globalThis.fetch = realFetch;
      const server = await startLocalServer(local.map((entry) => entry.fixture));
      try {
        app.ds.configure({ baseUrl: server.baseUrl });
        for (const { fixture, truth, zone, report } of local) {
          const found = await compare(fixture, truth, app, { zone, source: 'local server' });
          diffs.push(...found.diffs);
          const plain = (value) => JSON.stringify({ ...value, at: undefined });
          if (plain(found.report) !== plain(report)) diffs.push(`seed ${fixture.seed}: the local server and SharePoint give different reports for the same records`);
        }
      } finally {
        await server.stop();
      }
    }
  } finally {
    globalThis.fetch = realFetch;
    app.ds.configure({ baseUrl: '/api' });
  }
  return { diffs, checked: seeds, people, local: local.length, zones };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flag = (name, fallback) => { const index = process.argv.indexOf(`--${name}`); return index === -1 ? fallback : Number(process.argv[index + 1]); };
  const options = { from: flag('from', 1), seeds: flag('seeds', 200), pdfEvery: flag('pdf-every', 10), localEvery: flag('local-every', 10), verbose: process.argv.includes('--verbose') };
  const started = Date.now();
  const outcome = await run(options);
  for (const line of outcome.diffs.slice(0, 60)) console.log(line);
  if (outcome.diffs.length > 60) console.log(`... and ${outcome.diffs.length - 60} more`);
  console.log(`\n${outcome.checked} sessions (seeds ${options.from} to ${options.from + options.seeds - 1}), ${outcome.people} participants, ${outcome.local} also on the local server, zones ${outcome.zones.join(', ')}: ${outcome.diffs.length} difference(s) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  process.exit(outcome.diffs.length ? 1 : 0);
}
