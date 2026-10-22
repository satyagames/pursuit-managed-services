// Phase 10j, part A: how often a participant waits for SharePoint, moment by moment, counted in ROUNDS.
//
// VJR said the participant page "responds slowly (showing loading)" on the real site (15 Oct 2026, package pms-da9fc8d), with a live client of
// only a few activities. The data is small; what costs is the number of requests that wait for each other, one after another, and the
// screens that wait on them. A round is one such step: requests sent side by side are one round.
//
// How it counts, without a clock: every request the data layer sends is held, and the waiting ones are let go together, in waves, once the
// code has had every chance to ask for more (the queue has not grown for a few turns of the event loop). A moment's rounds are the waves it
// needs before the person sees the next screen; what the moment leaves going in the background (a write it does not wait for) is let go
// after it, in waves too, and counted apart. So the count is the same on any machine, however slow.
//
// Each moment runs what the page runs at that moment: the data layer (migration/src/lib/data/dataService.js, a module of its own for each "page", as
// scripts/test-participant-storage.js does) and the page's plain modules (lib/participant/boot.js, lib/participant/answer-store.js). Where the page's own code is a
// Svelte file, the moment says which calls it stands for.
//
// The targets of Phase 10j are asserted below. A target that a later part of the phase meets was a node:test `todo` until that part (it ran,
// printed what it measured and did not fail the run): the answer to a question asked at the start of this phase, so that no commit is red. The table printed at the end has
// the rounds and requests measured at c7848e5 (before) and now.
//
// What it cannot show: how long one round takes on the real site. That is RUNBOOK.md's timing check. Run: node --test scripts/test-participant-waits.js
import './fresh-page.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import * as ds from '../migration/src/lib/data/dataService.js';
import { createAnswerStore } from '../migration/src/lib/participant/answer-store.js';
import * as bootModule from '../migration/src/lib/participant/boot.js';
import { bootParticipant } from '../migration/src/lib/participant/boot.js';
import { samplePack } from '../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../migration/src/lib/setup/seed.js';
import { freePort } from './free-port.js';
import { REFUSED_BY_NAME, STRAYS, TITLE, UNINDEXED, UNNAMED, createSharePointFake } from './sharepoint-fake.js';
import { dataLayerSource } from './data-layer-source.js';

const ROOT = path.join(import.meta.dirname, '..');
// (Imported when first used: Phase 10j part D's tests of the boot were run against the last commit, which had no such module, to see them fail.)
const contentModule = import('../migration/src/lib/participant/activity-content.js').catch(() => null);
/** The page's holder of the activities' questions (lib/participant/activity-content.js, as lib/participant/experience.svelte.ts makes it), on `page`'s data layer. */
async function contentHolder(page) {
  const module = await contentModule;
  if (!module) throw new Error('migration/src/lib/participant/activity-content.js is missing');
  return module.createActivityContent({ api: page });
}
const realFetch = globalThis.fetch;
const DAY = '2026-10-15';
const KROGER = 'c-kroger';
/** Turns of the event loop with nothing new asked for, after which the waiting requests are let go. */
const QUIET = 8;

// ---- Holding requests, and letting them go in waves --------------------------------------------------------------------------------

const turn = () => new Promise((resolve) => { setImmediate(resolve); });

/**
 * Runs `moment` with every request held. Resolves to { value, rounds, requests, later: { rounds, requests } }: `rounds` are the waves the
 * moment needed before it resolved, `requests` what it sent meanwhile (a $batch is one), and `later` what it left going. `onWave` is handed
 * the requests of each wave the moment needed, as the mock logged them.
 */
async function measure(fake, moment, onWave = null) {
  const held = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (url, init) => new Promise((resolve, reject) => { held.push({ url, init, resolve, reject }); });
  let done = false;
  let value;
  let failure = null;
  const start = fake.count();
  Promise.resolve().then(moment).then((result) => { value = result; }, (error) => { failure = error; }).finally(() => { done = true; });
  /** Lets the code run until it has asked for everything it can ask for now (or, with `stopWhenDone`, until the moment is over). */
  const settle = async (stopWhenDone) => {
    let size = -1;
    for (let still = 0; still < QUIET;) {
      await turn();
      if (stopWhenDone && done) return;
      if (held.length === size) still += 1; else { size = held.length; still = 0; }
    }
  };
  const release = () => {
    const before = fake.count();
    for (const { url, init, resolve, reject } of held.splice(0)) fake.fetch(url, init).then(resolve, reject);
    onWave?.(fake.requests.slice(before));
  };
  let rounds = 0;
  try {
    for (;;) {
      await settle(true);
      if (done) break;
      if (held.length === 0) throw new Error('The moment waits for something that is not a request (a timer?): it cannot be counted in rounds.');
      release();
      rounds += 1;
    }
    const requests = fake.count() - start;
    let laterRounds = 0;
    for (;;) {
      await settle(false);
      if (held.length === 0) break;
      release();
      laterRounds += 1;
    }
    if (failure) throw failure;
    return { value, rounds, requests, later: { rounds: laterRounds, requests: fake.count() - start - requests } };
  } finally {
    globalThis.fetch = previous;
  }
}

// ---- A site, a page, a visitor ------------------------------------------------------------------------------------------------------

/** A mocked SharePoint with the sample clients seeded and Kroger live today, the session not started. (`settings` are the pages', below.) */
async function liveSite(_settings = {}) {
  const fake = createSharePointFake();
  fake.install();
  ds.configure({ sharePoint: fake.settings });
  await seedPack(ds, samplePack());
  const { session } = await ds.activateClient(KROGER, DAY);
  fake.reset();
  return { fake, session };
}

let pagesOpened = 0;
/** A page of its own: the data layer as a separate module, so it shares no write token, list type or column check with any other. */
async function freshPage(fake, settings = {}) {
  const page = await import(`../migration/src/lib/data/dataService.js?waits=${pagesOpened += 1}`);
  page.configure({ sharePoint: { ...fake.settings, ...settings } });
  return page;
}

const memoryStorage = () => {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); }, removeItem: (key) => { map.delete(key); } };
};
/** The page's answer store (lib/participant/answer-store.js, as lib/participant/participantData.ts makes it), on `page`'s data layer; waits are not slept. */
const answerStore = (page) => createAnswerStore({ api: page, storage: memoryStorage(), sleep: async () => {} });

/** `count` guests with a personal code each, the session being for guests: how a QR visit arrives. */
async function guestCodes(session, count) {
  await ds.setSessionParticipationMode(session.id, 'client-visit');
  const tokens = [];
  for (let index = 0; index < count; index += 1) {
    const visitor = await ds.createVisitor({ sessionId: session.id, displayName: `Guest ${index + 1}`, enabled: true });
    tokens.push((await ds.provisionQrToken(KROGER, session.id, { visitorId: visitor.id })).id);
  }
  return tokens;
}

/** A record as the pager hands it to the answer store: the first pick of a question. */
const pickOf = (questionId, optionId) => ({ questionId, answer: optionId, firstAnswer: optionId, attempts: 1, correct: true });

// ---- What the page does at each moment ---------------------------------------------------------------------------------------------

/**
 * What App.svelte's afterFirstScreen sends once the first screen is drawn: (Phase 10j, part D) the questions and options of every enabled
 * activity, read in the background into the page's holder (experience.holdActivityContent); the visit log (logEntry, through
 * recordParticipantVisit), then (part C) what the page's writes will need, fetched ahead (lib/participant/boot.js writesAhead, dataService.prepareWrites),
 * and, for a visit resumed from its address, the resume stamp. `content` is the page's holder; none, as before part D, reads no content.
 */
async function afterFirstScreen(page, boot, content = null) {
  const reading = content && boot.experience.status === 'live' ? content.start(boot.experience.sections) : null;
  const track = boot.track;
  const session = boot.experience.session;
  if (boot.experience.status === 'live' || track) {
    const entryMode = track?.visitorId || session?.participationMode === 'client-visit' ? 'client-visit' : 'staff';
    await page.recordParticipantVisit({
      visitKey: crypto.randomUUID(), sessionId: track?.sessionId ?? session?.id ?? null, clientId: track?.clientId ?? session?.clientId ?? null,
      page: 'participant', entryMode, sharePointUserId: entryMode === 'staff' ? boot.user?.id ?? null : null,
      displayName: entryMode === 'staff' ? boot.user?.displayName ?? '' : '', visitorId: track?.visitorId ?? null,
      visitorName: track?.participantName ?? '', trackId: track?.id ?? null, visitedAt: new Date().toISOString(),
    });
  }
  const ahead = page.prepareWrites(bootModule.writesAhead(boot));
  if (track && !boot.claimed) await page.noteTrackResumed(track);
  await ahead;
  await reading;
}

/**
 * "Click here to begin" (Welcome.svelte's continueVisit): beginVisit with an id the page made, not waiting for the session to be moved on (Phase
 * 10j). The button is busy until it returns.
 */
const begin = (page, session, sharePointUserId = '42') => page.beginVisit(crypto.randomUUID(), session.id, KROGER, { sharePointUserId, waitForSession: false });

/**
 * The Activities hub, arriving (Agenda.svelte; Phase 10j, part E): it is drawn at once from what the page holds, the activities
 * (experience.knownActivities) and this visit's answers on the device (participantData.getKnownProgress: the answer store, no request), and
 * then the activities and the enabled ones' questions and options are read again in the background (experience.refreshActivities:
 * activityContent.refreshWith, one request where the site can batch), and the hub is drawn again if anything changed. Resolves once it is
 * drawn. (Before part E it read the client's activities first, getProgress then dataService.getClientActivities, with "Loading
 * activities..." in its place. The one arrival that takes boot's own read is the first, within five seconds of boot: HANDOFF_MS.)
 */
async function arriveAtHub(content, sections, store = null, visit = null) {
  const drawn = store && visit ? await store.saved(visit) : [];
  // (Every enabled activity done: there is none left to open, and the read is of the activities alone.)
  const answered = new Set(drawn.map((record) => record.questionId));
  const allDone = sections.filter((section) => section.enabled === true && (section.questionIds ?? []).length).every((section) => section.questionIds.every((id) => answered.has(id)));
  void content.refreshWith(KROGER, allDone ? [] : sections);
  return drawn;
}

/**
 * An activity, opening (ActivityPager.svelte, experience.loadActivity): its questions and options from what the page holds (Phase 10j,
 * part D: lib/participant/activity-content.js), read only when they are not held. It shows "Loading activity..." while it waits.
 */
const openActivity = (content, section, sections) => content.questionsOf(section, sections);

// ---- The moments, measured once --------------------------------------------------------------------------------------------------

/** What was measured, by moment: { rounds, requests, later }. */
const now = {};
/** The requests of a whole visit, by kind of device: the page's own, each moment's and what each left going. */
const wholeVisit = {};

/** A staff member's whole visit on one page: open, begin, every activity, finish. Resolves to the requests it cost. */
async function measureWholeVisit(firstDevice, settings = {}) {
  const { fake, session } = await liveSite(settings);
  if (!firstDevice) await begin(await freshPage(fake), session, '7'); // someone else began first: the session is in progress
  fake.reset();
  const page = await freshPage(fake, settings);
  const store = answerStore(page);
  const content = await contentHolder(page);
  let total = 0;
  const step = async (moment) => { const measured = await measure(fake, moment); total += measured.requests + measured.later.requests; return measured.value; };
  const boot = await step(() => bootParticipant(page, { path: '/', content }));
  await step(() => afterFirstScreen(page, boot, content));
  const track = await step(() => begin(page, session));
  const visit = { trackId: track.id, sessionId: session.id, clientId: KROGER, restartedAt: null };
  await store.restore(visit, null); // a visit that began this moment has saved nothing
  const sections = boot.experience.sections.filter((section) => section.enabled === true);
  for (const section of sections) {
    await step(() => arriveAtHub(content, boot.experience.sections, store, visit));
    const questions = await step(() => openActivity(content, section, sections));
    for (const [index, question] of questions.entries()) {
      const answer = pickOf(question.id, question.options[0].id);
      if (index < questions.length - 1) await step(() => { store.record(visit, section.id, answer); });
      else await step(async () => { store.record(visit, section.id, answer); await store.flush(visit, section.id); });
    }
  }
  await step(() => arriveAtHub(content, boot.experience.sections, store, visit));
  await step(() => page.getClientActivities(KROGER)); // the finale checks against the server before it shows (ThankYou.svelte, getProgress)
  return total;
}

after(() => {
  globalThis.fetch = realFetch;
  ds.configure({ baseUrl: '/api' });
  const rows = [
    ['Page open, staff link, up to Welcome', 'staffOpen', '2'],
    ['Page open, staff link, an earlier visit today', 'staffOpenEarlier', '3'],
    ['Page open by QR scan, the session\'s first device', 'qrFirst', '<= before'],
    ['Page open by QR scan, a later device', 'qrLater', '<= before'],
    ['"Click here to begin", first device, after the fetch-ahead', 'beginFirstReady', '2'],
    ['"Click here to begin", later device, after the fetch-ahead', 'beginLaterReady', '2'],
    ['"Click here to begin", first device, before it', 'beginFirstCold', '4'],
    ['"Click here to begin", later device, before it', 'beginLaterCold', '4'],
    ['Hub arrival (any but one within 5 s of boot)', 'hub', '0'],
    ['Opening an activity (before part D: any but the one boot fetched)', 'openActivity', '0'],
    ['Next', 'next', '0'],
    ['Submit, earlier answers saved', 'submit', '1'],
    ['Submit, the visit\'s first save', 'submitFirst', '-'],
  ];
  const cell = (entry) => (entry ? `${entry.rounds} (${entry.requests}${entry.later.requests ? ` + ${entry.later.requests} after` : ''})` : '-');
  const before = (key) => (BEFORE[key] ? `${BEFORE[key][0]} (${BEFORE[key][1]}${BEFORE[key][2] ? ` + ${BEFORE[key][2]} after` : ''})` : '-');
  console.log('\nRounds the participant waits, at c7848e5 (before) and now; in brackets the requests, and what is sent after the moment without being waited for:');
  console.log(`  ${'Moment'.padEnd(64)} ${'Before'.padEnd(14)} ${'Now'.padEnd(14)} Target`);
  for (const [label, key, target] of rows) console.log(`  ${label.padEnd(64)} ${before(key).padEnd(14)} ${cell(now[key]).padEnd(14)} ${target}`);
  console.log(`  A whole visit (open, begin, both of Kroger's activities, finish): requests, before ${WHOLE_VISIT_BEFORE.first} and now ${wholeVisit.first} for the session's first device; before ${WHOLE_VISIT_BEFORE.later} and now ${wholeVisit.later} for a later one.`);
  if (wholeVisit.firstUnbatched !== undefined) console.log(`  The same on a site that cannot batch ("batch": false; before, nothing of this visit was batched): now ${wholeVisit.firstUnbatched} and ${wholeVisit.laterUnbatched}.`);
});

/** [rounds, requests, requests after] of each moment, measured by this suite at c7848e5, before any change of Phase 10j. */
const BEFORE = Object.freeze({
  staffOpen: [4, 8, 0],
  staffOpenEarlier: [4, 7, 0],
  qrFirst: [4, 9, 0],
  qrLater: [4, 8, 0],
  beginFirstReady: [7, 9, 0],
  beginLaterReady: [4, 5, 0],
  beginFirstCold: [8, 10, 0],
  beginLaterCold: [5, 6, 0],
  hub: [1, 1, 0],
  openActivity: [1, 2, 0],
  next: [0, 0, 1],
  submit: [1, 1, 0],
  submitFirst: [2, 2, 0],
});
/** The requests of a whole visit at c7848e5, measured by measureWholeVisit. */
const WHOLE_VISIT_BEFORE = Object.freeze({ first: 33, later: 29 });

// ---- The targets ----------------------------------------------------------------------------------------------------------------------

/** One target: `rounds` of the moment `key` at most `most`. `todo` names the part of Phase 10j that meets it, until it does. */
function target(name, key, most, todo) {
  it(name, todo ? { todo } : {}, (t) => {
    t.diagnostic(`measured: ${now[key].rounds} rounds, ${now[key].requests} requests (target: at most ${most} rounds; before: ${BEFORE[key][0]})`);
    assert.ok(now[key].rounds <= most, `${now[key].rounds} rounds, ${now[key].requests} requests; at most ${most} rounds wanted`);
  });
}

describe('the rounds a participant waits (Phase 10j)', () => {
  before(async () => {
    // Page open, staff link: the plain address, someone who has not visited today.
    {
      const { fake } = await liveSite();
      const page = await freshPage(fake);
      const content = await contentHolder(page);
      now.staffOpen = await measure(fake, () => bootParticipant(page, { path: '/', content }));
    }
    // Page open, staff link, someone with an earlier visit today (the same account): it is offered on Welcome, with its answers.
    {
      const { fake, session } = await liveSite();
      const earlier = await begin(ds, session);
      await ds.saveParticipantResponses({ trackId: earlier.id, sessionId: session.id, clientId: KROGER, responses: [pickOf('q-trivia-1', 'o-trivia-1-b')] });
      fake.reset();
      const page = await freshPage(fake);
      const content = await contentHolder(page);
      now.staffOpenEarlier = await measure(fake, () => bootParticipant(page, { path: '/', content }));
      assert.equal(now.staffOpenEarlier.value.accountTrack?.id, earlier.id, 'the earlier visit was found');
    }
    // Page open by a first QR scan: the session's first device, then a later one.
    {
      const { fake, session } = await liveSite();
      const [first, second] = await guestCodes(session, 2);
      fake.reset();
      const scan = async (token) => { const page = await freshPage(fake); return bootParticipant(page, { qrToken: token, path: '/', content: await contentHolder(page) }); };
      now.qrFirst = await measure(fake, () => scan(first));
      now.qrLater = await measure(fake, () => scan(second));
      assert.equal(now.qrFirst.value.claimed && now.qrLater.value.claimed, true);
    }
    // "Click here to begin": the session's first device and a later one, once with what the page does after its first screen finished
    // (the visit log; the fetch-ahead of Phase 10j) and once pressed before any of it.
    for (const ready of [true, false]) {
      const { fake, session } = await liveSite();
      for (const device of ['First', 'Later']) {
        const page = await freshPage(fake);
        const content = await contentHolder(page);
        const boot = await bootParticipant(page, { path: '/', content });
        if (ready) await afterFirstScreen(page, boot, content);
        now[`begin${device}${ready ? 'Ready' : 'Cold'}`] = await measure(fake, () => begin(page, session));
      }
      assert.equal(fake.item('sessions', session.id).Status, 'in-progress', 'the first device moved the session on');
    }
    // The hub, an activity, Next and Submit, on one page that has begun a visit.
    {
      const { fake, session } = await liveSite();
      const page = await freshPage(fake);
      const content = await contentHolder(page);
      const boot = await bootParticipant(page, { path: '/', content });
      await afterFirstScreen(page, boot, content);
      const track = (await measure(fake, () => begin(page, session))).value; // (and the write that moves the session on, after it)
      const store = answerStore(page);
      const visit = { trackId: track.id, sessionId: session.id, clientId: KROGER, restartedAt: null };
      await store.restore(visit, null);
      // Submit, the visit's first save: the one answer of Guess the Brand, nothing saved before it.
      const sections = boot.experience.sections;
      const [trivia, brand] = sections;
      const brandQuestions = await openActivity(content, brand, sections);
      now.submitFirst = await measure(fake, async () => { store.record(visit, brand.id, pickOf(brandQuestions[0].id, brandQuestions[0].options[0].id)); await store.flush(visit, brand.id); });
      now.hub = await measure(fake, () => arriveAtHub(content, sections, store, visit));
      now.openActivity = await measure(fake, () => openActivity(content, trivia, sections));
      const questions = now.openActivity.value;
      now.next = await measure(fake, () => { store.record(visit, trivia.id, pickOf(questions[0].id, questions[0].options[1].id)); });
      for (const question of questions.slice(1, -1)) await measure(fake, () => { store.record(visit, trivia.id, pickOf(question.id, question.options[0].id)); });
      const last = questions.at(-1);
      now.submit = await measure(fake, async () => { store.record(visit, trivia.id, pickOf(last.id, last.options[0].id)); await store.flush(visit, trivia.id); });
    }
    wholeVisit.first = await measureWholeVisit(true);
    wholeVisit.later = await measureWholeVisit(false);
    wholeVisit.firstUnbatched = await measureWholeVisit(true, { batch: false });
    wholeVisit.laterUnbatched = await measureWholeVisit(false, { batch: false });
  });

  target('page open, staff link, up to Welcome: 2 rounds (the settings file aside)', 'staffOpen', 2);
  target('page open, staff link, someone with an earlier visit today: 3 rounds (its answers)', 'staffOpenEarlier', 3);
  target("page open by QR scan, the session's first device: no more rounds than before", 'qrFirst', BEFORE.qrFirst[0]);
  target('page open by QR scan, a later device: no more rounds than before', 'qrLater', BEFORE.qrLater[0]);
  target('"Click here to begin", first device, the fetch-ahead finished: 2 rounds', 'beginFirstReady', 2);
  target('"Click here to begin", later device, the fetch-ahead finished: 2 rounds', 'beginLaterReady', 2);
  target('"Click here to begin", first device, without the fetch-ahead: 4 rounds', 'beginFirstCold', 4);
  target('"Click here to begin", later device, without the fetch-ahead: 4 rounds', 'beginLaterCold', 4);
  target('the hub, arriving with the activities held: drawn after 0 rounds', 'hub', 0);
  target('an activity, opening with its content held: 0 rounds', 'openActivity', 0);
  target('Next: 0 rounds', 'next', 0);
  target('Submit, the earlier answers saved: 1 round', 'submit', 1);

  it('a whole visit costs no more requests than before, on the session\'s first device and on a later one', () => {
    assert.ok(wholeVisit.first <= WHOLE_VISIT_BEFORE.first, `${wholeVisit.first} requests; ${WHOLE_VISIT_BEFORE.first} before`);
    assert.ok(wholeVisit.later <= WHOLE_VISIT_BEFORE.later, `${wholeVisit.later} requests; ${WHOLE_VISIT_BEFORE.later} before`);
  });

  it('the count does not depend on the machine: the same moment measured again gives the same rounds and requests', async () => {
    const { fake } = await liveSite();
    const again = [];
    for (let run = 0; run < 3; run += 1) {
      const page = await freshPage(fake);
      const { rounds, requests } = await measure(fake, () => bootParticipant(page, { path: '/' }));
      again.push([rounds, requests]);
    }
    assert.deepEqual(again, [[now.staffOpen.rounds, now.staffOpen.requests], [now.staffOpen.rounds, now.staffOpen.requests], [now.staffOpen.rounds, now.staffOpen.requests]]);
  });

  it('the gate counts what it should: two reads side by side are one round, one after the other two', async () => {
    const { fake } = await liveSite();
    const together = await measure(fake, () => Promise.all([ds.getAppSettings(), ds.getClient(KROGER)]));
    const apart = await measure(fake, async () => { await ds.getAppSettings(); await ds.getClient(KROGER); });
    const background = await measure(fake, () => { void ds.getClient(KROGER); });
    assert.deepEqual([together.rounds, together.requests, apart.rounds, apart.requests], [1, 2, 2, 2]);
    assert.deepEqual([background.rounds, background.requests, background.later.rounds, background.later.requests], [0, 0, 1, 1], 'a read the moment does not wait for is counted after it');
  });
});

// ---- Part E: the hub and the activities -----------------------------------------------------------------------------------------
// The hub read the client's activities on every arrival and showed "Loading activities..." until they came back; each activity but the one the
// boot had fetched read its questions and options when it was opened. Since Phase 10j the hub is drawn at once from what the page holds, and
// the activities and the enabled ones' content are read again behind it, together (lib/participant/activity-content.js refreshWith: the data layer's
// readLists, one $batch where the site can batch); an activity opens from what is held (part D). An edit made in Content reaches a participant
// at the next activity they open after visiting the hub; an activity already open keeps what it opened with.

describe('the hub and the activities (part E)', () => {
  async function holding(settings = {}) {
    const { fake, session } = await liveSite();
    const page = await freshPage(fake, settings);
    const content = await contentHolder(page);
    const boot = await bootParticipant(page, { path: '/', content });
    await afterFirstScreen(page, boot, content); // (the visit log, which also fetches the write token a $batch needs, and the content read)
    fake.reset();
    return { fake, session, page, content, sections: boot.experience.sections };
  }

  it('the hub\'s read is ONE request where the site can batch: the client\'s activities, and the enabled ones\' questions and options', async () => {
    const { fake, content, sections } = await holding();
    const refreshed = await measure(fake, () => content.refreshWith(KROGER, sections));
    assert.deepEqual([refreshed.rounds, refreshed.requests], [1, 1]);
    const [batch] = fake.requests;
    assert.ok(batch.path.endsWith('/$batch'));
    assert.deepEqual(batch.parts.map((part) => part.list), ['sections', 'questions', 'options']);
    assert.match(batch.parts[0].query, /ClientId eq 'c-kroger'/);
    assert.deepEqual(refreshed.value.map((section) => section.id), sections.map((section) => section.id), 'the activities, in their order');
  });

  it('where the site cannot batch it is the same reads side by side: one round', async () => {
    const { fake, content, sections } = await holding({ batch: false });
    const refreshed = await measure(fake, () => content.refreshWith(KROGER, sections));
    assert.deepEqual([refreshed.rounds, refreshed.requests], [1, 3]);
    assert.deepEqual(fake.requests.map((entry) => entry.list).sort(), ['options', 'questions', 'sections']);
  });

  it('an edit to a question in Content reaches the participant at the next activity they open after the hub; the one already open keeps its own', async () => {
    const { content, sections } = await holding();
    const open = await content.questionsOf(sections[0], sections);
    const before = open[0].prompt;
    await ds.updateQuestion('q-trivia-1', { prompt: 'Which year did the first store open?' });
    await ds.updateOption('o-trivia-1-a', { label: 'Long ago' });
    assert.equal((await content.questionsOf(sections[0], sections))[0].prompt, before, 'not yet: no hub between');
    await content.refreshWith(KROGER, sections);
    const next = await content.questionsOf(sections[0], sections);
    assert.equal(next[0].prompt, 'Which year did the first store open?');
    assert.equal(next[0].options.find((option) => option.id === 'o-trivia-1-a').label, 'Long ago');
    assert.equal(open[0].prompt, before, 'the activity that was open keeps what it opened with');
  });

  it('an activity switched off, or removed, drops out after the hub\'s read; its content is not read again', async () => {
    const { fake, content, sections } = await holding();
    await ds.updateSection('sec-guess-the-brand', { enabled: false });
    fake.reset();
    const off = await content.refreshWith(KROGER, sections);
    assert.equal(off.find((section) => section.id === 'sec-guess-the-brand').enabled, false);
    await ds.deleteActivity('sec-guess-the-brand');
    const gone = await content.refreshWith(KROGER, off);
    assert.deepEqual(gone.map((section) => section.id), ['sec-trivia']);
    assert.doesNotMatch(fake.requests.at(-1).parts.find((part) => part.list === 'questions').query, /q-brand-1/, 'a switched-off activity\'s questions are not read');
  });

  it('once every activity is done, the hub\'s read is of the activities alone: there is none left to open', async () => {
    const { fake, content } = await holding({ batch: false });
    const refreshed = await measure(fake, () => content.refreshWith(KROGER, []));
    assert.deepEqual([refreshed.rounds, refreshed.requests], [1, 1]);
    assert.deepEqual(fake.requests.map((entry) => entry.list), ['sections']);
    const agenda = await readFile(path.join(ROOT, 'migration', 'src', 'routes', 'Agenda.svelte'), 'utf8');
    assert.match(agenda, /refreshActivities\(\{ withContent: !\(fetchedAllDone && !fetching\) \}\)/);
  });

  it('a read that fails leaves what is held as it was, for the hub to keep showing', async () => {
    const { fake, content, sections } = await holding();
    fake.failNext({ status: 500, times: 1, when: (entry) => entry.path.endsWith('/$batch') });
    fake.failNext({ status: 500, times: 3, when: (entry) => entry.list === 'sections' });
    await assert.rejects(content.refreshWith(KROGER, sections));
    fake.reset();
    assert.equal((await content.questionsOf(sections[1], sections)).length, 1);
    assert.equal(fake.count(), 0, 'the held content still opens the activity');
  });

  it('the hub draws from what is held before it reads, and keeps showing it when that read fails; its lines wait 300 ms (source checks)', async () => {
    const agenda = await readFile(path.join(ROOT, 'migration', 'src', 'routes', 'Agenda.svelte'), 'utf8');
    const mount = /onMount\(\(\) => \{[\s\S]*?\n {2}\}\);/.exec(agenda)?.[0] ?? '';
    assert.ok(mount.indexOf('getKnownProgress(') !== -1 && mount.indexOf('getKnownProgress(') < mount.indexOf('refreshActivities('), 'drawn from what is held, then read');
    assert.match(agenda, /\{#if loading && slow\}/, 'the loading line, after 300 ms');
    const pager = await readFile(path.join(ROOT, 'migration', 'src', 'pager', 'ActivityPager.svelte'), 'utf8');
    assert.match(pager, /\{#if phase === 'loading'\}\s*\{#if slow\}/);
    for (const source of [agenda, pager]) assert.match(source, /setTimeout\(\(\) => \{ slow = true; \}, LOADING_DELAY_MS\)/);
    const experienceSource = await readFile(path.join(ROOT, 'migration', 'src', 'lib', 'participant', 'experience.svelte.ts'), 'utf8');
    assert.match(experienceSource, /activityContent\.refreshWith\(experience\.clientId, withContent \? activities : \[\]\)/);
    const { LOADING_DELAY_MS } = (await contentModule) ?? {};
    assert.equal(LOADING_DELAY_MS, 300);
  });
});

// ---- Part D: the first screen ------------------------------------------------------------------------------------------------------
// The plain link's boot read AppSettings and who is signed in; then the client, the session and the activities; then the session's visits
// (has this account visited today?); then the first activity's questions and options, which Welcome never shows: four rounds before
// Welcome. Since Phase 10j the visits are read in round 2, beside the rest, and the questions and options of every enabled activity once the
// first screen is up (lib/participant/activity-content.js), so Welcome waits for two rounds, three for someone with an earlier visit today (its answers).

describe('the first screen (part D)', () => {
  const readsOf = (fake, list) => fake.select((entry) => entry.method === 'GET' && entry.list === list).length;

  it('the plain link\'s first screen is drawn before any question or option is read, in two rounds', async () => {
    const { fake } = await liveSite();
    const page = await freshPage(fake);
    const opened = await measure(fake, () => bootParticipant(page, { path: '/' }));
    assert.equal(opened.value.experience.status, 'live');
    assert.deepEqual([readsOf(fake, 'questions'), readsOf(fake, 'options')], [0, 0], 'no question and no option before the first screen');
    assert.equal(opened.rounds, 2);
    assert.equal(opened.value.accountChecked, true, 'the account was looked for, and has no visit today');
  });

  it('the visits of the session are read in round 2, beside the client, the session and the activities', async () => {
    const { fake, session } = await liveSite();
    const earlier = await begin(ds, session);
    fake.reset();
    const page = await freshPage(fake);
    const waves = [];
    const opened = await measure(fake, () => bootParticipant(page, { path: '/' }), (released) => waves.push(released.map((entry) => entry.list ?? entry.path.split('/_api')[1]).sort()));
    assert.deepEqual(waves, [['/web/currentuser', 'appsettings'], ['clients', 'sections', 'sessions', 'tracks'], ['responses']]);
    assert.equal(opened.value.accountTrack.id, earlier.id);
    assert.equal(opened.value.accountOwn, null, 'its answers were read: none yet');
  });

  it('what that early read found is used only for a live session of staff: otherwise it is dropped, never offered on Welcome', async () => {
    const dropped = (boot) => [boot.accountChecked, boot.accountTrack, boot.accountOwn];
    // Guests only: the account's earlier staff visit is not offered.
    {
      const { fake, session } = await liveSite();
      await begin(ds, session);
      await ds.setSessionParticipationMode(session.id, 'client-visit');
      fake.reset();
      const boot = await bootParticipant(await freshPage(fake), { path: '/' });
      assert.equal(boot.experience.status, 'live');
      assert.deepEqual(dropped(boot), [false, null, undefined]);
      assert.equal(readsOf(fake, 'responses'), 0, 'and its answers are not read');
    }
    // The session ended, and the client archived: nothing is live, and nothing found is kept.
    for (const end of [(session) => ds.endSession(session.id), () => ds.updateClient(KROGER, { status: 'archived' })]) {
      const { fake, session } = await liveSite();
      await begin(ds, session);
      await end(session);
      fake.reset();
      const boot = await bootParticipant(await freshPage(fake), { path: '/' });
      assert.notEqual(boot.experience.status, 'live');
      assert.deepEqual(dropped(boot), [false, null, undefined]);
      assert.equal(readsOf(fake, 'responses'), 0);
    }
  });

  it('when that read fails the first screen still comes up, and Welcome looks for itself', async () => {
    const { fake, session } = await liveSite();
    await begin(ds, session);
    fake.reset();
    fake.failNext({ status: 500, times: 1, when: (entry) => entry.list === 'tracks' && entry.method === 'GET' });
    const warn = console.warn;
    console.warn = () => {};
    let boot;
    try { boot = await bootParticipant(await freshPage(fake), { path: '/' }); } finally { console.warn = warn; }
    assert.equal(boot.experience.status, 'live');
    assert.deepEqual([boot.accountChecked, boot.accountTrack], [false, null]);
  });

  it('one read, once the first screen is up, holds the questions and options of every enabled activity; each then opens with no request', async () => {
    const { fake } = await liveSite();
    const page = await freshPage(fake);
    const content = await contentHolder(page);
    const boot = await bootParticipant(page, { path: '/', content });
    fake.reset();
    await content.start(boot.experience.sections);
    assert.deepEqual([readsOf(fake, 'questions'), readsOf(fake, 'options')], [1, 1]);
    const ids = boot.experience.sections.filter((section) => section.enabled).flatMap((section) => section.questionIds);
    assert.match(fake.select({ list: 'questions' })[0].query, new RegExp(ids.map((id) => `AppId eq '${id}'`).join(' or ')), 'every enabled activity\'s, in one address');
    fake.reset();
    for (const section of boot.experience.sections) {
      const questions = await content.questionsOf(section, boot.experience.sections);
      assert.deepEqual(questions.map((question) => question.id), section.questionIds, `${section.id}: its own questions, in its order`);
      assert.ok(questions.every((question) => question.options.length > 0));
    }
    assert.equal(fake.count(), 0);
    await content.start(boot.experience.sections);
    assert.equal(fake.count(), 0, 'and nothing is read again');
  });

  it('an activity opened while that read is on its way waits for it, and nothing is asked twice', async () => {
    const { fake } = await liveSite();
    const page = await freshPage(fake);
    const content = await contentHolder(page);
    const { experience } = await bootParticipant(page, { path: '/', content });
    fake.reset();
    const reading = content.start(experience.sections);
    const opened = await content.questionsOf(experience.sections[1], experience.sections);
    await reading;
    assert.deepEqual(opened.map((question) => question.id), experience.sections[1].questionIds);
    assert.deepEqual([readsOf(fake, 'questions'), readsOf(fake, 'options')], [1, 1]);
  });

  it('an activity opened before anything was read (a reload inside it) reads every enabled activity\'s, once', async () => {
    const { fake } = await liveSite();
    const page = await freshPage(fake);
    const content = await contentHolder(page);
    const { experience } = await bootParticipant(page, { path: '/', content });
    fake.reset();
    const questions = await content.questionsOf(experience.sections[0], experience.sections);
    assert.equal(questions.length, experience.sections[0].questionIds.length);
    await content.start(experience.sections);
    assert.deepEqual([readsOf(fake, 'questions'), readsOf(fake, 'options')], [1, 1]);
    assert.match(fake.select({ list: 'questions' })[0].query, new RegExp(experience.sections[1].questionIds[0]), 'the other activity\'s with it');
  });

  it('a new activity, or a question added since, is read when it opens; a read that failed is read again', async () => {
    const { fake } = await liveSite();
    const page = await freshPage(fake);
    const content = await contentHolder(page);
    const { experience } = await bootParticipant(page, { path: '/', content });
    fake.failNext({ status: 500, times: 1, when: (entry) => entry.list === 'questions' });
    const warn = console.warn;
    console.warn = () => {};
    try { await content.start(experience.sections); } finally { console.warn = warn; }
    fake.reset();
    const first = await content.questionsOf(experience.sections[0], experience.sections);
    assert.equal(first.length, experience.sections[0].questionIds.length, 'the failed read is read again, at the opening');
    assert.equal(readsOf(fake, 'questions'), 1);
    fake.reset();
    const added = { ...experience.sections[1], questionIds: [...experience.sections[1].questionIds, 'q-trivia-1'] };
    await content.questionsOf(added, experience.sections);
    assert.equal(readsOf(fake, 'questions'), 0, 'held already, from the other activity');
    const fresh = { id: 'sec-new', enabled: true, questionIds: ['q-new-1'] };
    await ds.createOption({ id: 'o-new-1', questionId: 'q-new-1', label: 'Yes', correct: true });
    await ds.createQuestion({ id: 'q-new-1', sectionId: 'sec-new', type: 'single-select', prompt: 'New?', optionIds: ['o-new-1'], order: 1 });
    fake.reset();
    const made = await content.questionsOf(fresh, [...experience.sections, fresh]);
    assert.deepEqual(made.map((question) => [question.id, question.options.map((option) => option.id)]), [['q-new-1', ['o-new-1']]]);
    assert.deepEqual([readsOf(fake, 'questions'), readsOf(fake, 'options')], [1, 1], 'read as it always was: its questions and options');
  });

  it('more than 20 questions are read 20 to an address, and no address is longer than the longest read before this phase (1,873 characters)', async () => {
    const fake = createSharePointFake({ siteUrl: 'https://internal.global.deloitteonline.com/sites/PCOE' });
    fake.install();
    const page = await freshPage(fake);
    const ids = Array.from({ length: 45 }, () => crypto.randomUUID());
    const sections = [{ id: 's1', enabled: true, questionIds: ids.slice(0, 25) }, { id: 's2', enabled: true, questionIds: ids.slice(25) }];
    const content = await contentHolder(page);
    await content.start(sections);
    const reads = fake.select((entry) => ['questions', 'options'].includes(entry.list));
    assert.equal(reads.length, 6, 'three groups of at most 20, each a questions read and an options read');
    const longest = Math.max(...reads.map((entry) => entry.url.length));
    measuredAddresses.push(longest);
    assert.ok(longest <= 1_873, `${longest} characters`);
  });

  it('a first QR scan reads every enabled activity\'s questions beside the claim, holds them, and takes no more rounds than before', async () => {
    const { fake, session } = await liveSite();
    const [token] = await guestCodes(session, 1);
    fake.reset();
    const page = await freshPage(fake);
    const content = await contentHolder(page);
    const scanned = await measure(fake, () => bootParticipant(page, { qrToken: token, path: '/', content }));
    assert.ok(scanned.rounds <= BEFORE.qrLater[0]);
    const writtenAt = fake.requests.findIndex((entry) => entry.method === 'POST' && entry.list === 'tracks');
    const questionsAt = fake.requests.findIndex((entry) => entry.list === 'questions');
    assert.ok(Math.abs(writtenAt - questionsAt) <= 2, 'in the round of the track');
    fake.reset();
    for (const section of scanned.value.experience.sections) await content.questionsOf(section, scanned.value.experience.sections);
    assert.equal(fake.count(), 0);
  });

  it('App.svelte reads the activities\' content once the first screen is up, and hands the boot the page\'s holder', async () => {
    const app = await readFile(path.join(ROOT, 'migration', 'src', 'App.svelte'), 'utf8');
    assert.match(app, /async function afterFirstScreen\(boot: Boot\) \{\s*await painted\(\);\s*void holdActivityContent\(\);/);
    assert.match(app, /bootParticipant\(dataService, \{ [^}]*content: activityContent \}\)/);
    const experienceSource = await readFile(path.join(ROOT, 'migration', 'src', 'lib', 'participant', 'experience.svelte.ts'), 'utf8');
    assert.match(experienceSource, /activityContent\.questionsOf\(section, activities\)/, 'an activity opens from what is held');
    assert.doesNotMatch(experienceSource, /FIRST_CONTENT_MS|firstContent/);
  });
});

/** The longest address of a content read of 45 questions on the PCOE site, printed at the end. */
const measuredAddresses = [];
after(() => {
  if (measuredAddresses.length) console.log(`  The longest address of the activities' content read (45 questions, 20 to an address, the PCOE site): ${Math.max(...measuredAddresses).toLocaleString('en')} characters.`);
});

// ---- Part C: beginning a visit -----------------------------------------------------------------------------------------------------
// "Click here to begin" read AppSettings, then the session; then the participants list's type and its columns, then the write token, then
// wrote the visit; and for the session's first device it read the session again, then the sessions list's type and columns, then wrote the
// session as in progress. The click waited for all of it: eight rounds. Since Phase 10j: AppSettings and the session side by side; what the
// writes need fetched ahead once the first screen is up; and the write that moves the session on uses the version the check read and is not
// waited for (a 412 means someone else moved it first).

/** Resolves once `ready()` is true (a background write landed), looking every few milliseconds, for two seconds at most. */
async function until(ready, what) {
  for (let tries = 0; tries < 200; tries += 1) {
    if (await ready()) return;
    await new Promise((resolve) => { setTimeout(resolve, 10); });
  }
  throw new Error(`Still not so after two seconds: ${what}`);
}

describe('beginning a visit (part C)', () => {
  const sent = (fake, filter) => fake.select(filter).map((entry) => `${entry.method} ${entry.list ?? entry.path.split('/_api')[1]}`);

  it('the checks are one round, AppSettings and the session side by side, and the session is read once', async () => {
    const { fake, session } = await liveSite();
    const page = await freshPage(fake);
    const boot = await bootParticipant(page, { path: '/' });
    await afterFirstScreen(page, boot);
    fake.reset();
    const measured = await measure(fake, () => begin(page, session));
    assert.equal(measured.rounds, 2);
    assert.deepEqual(sent(fake, (entry) => entry.method === 'GET').sort(), ['GET appsettings', 'GET sessions'], 'nothing else is read, the session once');
    assert.deepEqual(sent(fake, (entry) => entry.method !== 'GET'), ['POST tracks', 'MERGE sessions'], 'the visit, then (after the click) the session');
    assert.equal(measured.later.requests, 1, 'the session is moved on after the click, which does not wait for it');
  });

  it('the write that moves the session on names the version the check read; a later device does not write the session', async () => {
    const { fake, session } = await liveSite();
    const version = fake.item('sessions', session.id).__metadata.etag;
    const first = await freshPage(fake);
    await afterFirstScreen(first, await bootParticipant(first, { path: '/' }));
    await begin(first, session);
    await until(() => fake.item('sessions', session.id).Status === 'in-progress', 'the session is in progress');
    const [merge] = fake.select({ method: 'MERGE', list: 'sessions' });
    assert.equal(merge.ifMatch, version, 'If-Match: the version AppSettings and the session were checked at');
    const later = await freshPage(fake);
    await afterFirstScreen(later, await bootParticipant(later, { path: '/' }));
    fake.reset();
    await begin(later, session, '7');
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    assert.equal(fake.count({ method: 'MERGE', list: 'sessions' }), 0);
    assert.equal(fake.count({ list: 'sessions', method: 'GET' }), 1);
  });

  it('two first devices at once: two visits, one session in progress, and neither is told anything went wrong', async () => {
    const { fake, session } = await liveSite();
    const pages = [await freshPage(fake), await freshPage(fake)];
    for (const page of pages) await afterFirstScreen(page, await bootParticipant(page, { path: '/' }));
    const warned = [];
    const warn = console.warn;
    console.warn = (...parts) => { warned.push(parts.join(' ')); };
    try {
      const tracks = await Promise.all(pages.map((page, index) => begin(page, session, String(50 + index))));
      assert.equal(new Set(tracks.map((track) => track.id)).size, 2);
      await until(() => fake.count({ method: 'MERGE', list: 'sessions' }) === 2, 'both devices tried to move the session on');
      await new Promise((resolve) => { setTimeout(resolve, 20); });
    } finally { console.warn = warn; }
    assert.deepEqual(fake.select({ method: 'MERGE', list: 'sessions' }).map((entry) => entry.faulted ?? null).sort(), [null, null], 'both were sent');
    assert.equal(fake.item('sessions', session.id).Status, 'in-progress');
    assert.equal(fake.lists.get('tracks').length, 2);
    assert.deepEqual(warned, [], 'the one that found the session moved on already (412) says nothing');
  });

  it('a click while the fetch-ahead is on its way waits for it, and nothing is asked for twice', async () => {
    const { fake, session } = await liveSite();
    const page = await freshPage(fake);
    const boot = await bootParticipant(page, { path: '/' });
    fake.reset();
    const ahead = page.prepareWrites(bootModule.writesAhead(boot));
    const track = await begin(page, session);
    await ahead;
    await until(() => fake.item('sessions', session.id).Status === 'in-progress', 'the session is in progress');
    assert.equal(track.sessionId, session.id);
    const asked = sent(fake, (entry) => entry.method === 'GET' || entry.path.endsWith('/contextinfo')).sort();
    assert.deepEqual(asked, ['GET appsettings', 'GET responses', 'GET sessions', 'GET sessions', 'GET sessions', 'GET tracks', 'GET tracks', 'POST /contextinfo']);
    assert.equal(fake.count((entry) => /\/fields\?/.test(entry.url) && entry.list === 'tracks'), 1, "the participants list's columns, once");
    assert.equal(fake.count((entry) => /\/fields\?/.test(entry.url) && entry.list === 'sessions'), 1, "the sessions list's columns, once");
    assert.equal(fake.count((entry) => /ListItemEntityTypeFullName/.test(entry.url) && entry.list === 'tracks'), 1);
  });

  it('a fetch-ahead that failed is forgotten: the click asks for what it needs itself, and the visit begins', async () => {
    const { fake, session } = await liveSite();
    const page = await freshPage(fake);
    const boot = await bootParticipant(page, { path: '/' });
    fake.failNext({ status: 500, times: 1, when: (entry) => entry.path.endsWith('/contextinfo') });
    fake.failNext({ status: 500, times: 1, when: (entry) => entry.list === 'tracks' && entry.path.endsWith('/fields') });
    fake.failNext({ status: 500, times: 1, when: (entry) => entry.list === 'responses' && /ListItemEntityTypeFullName/.test(entry.url) });
    await page.prepareWrites(bootModule.writesAhead(boot)); // never throws
    assert.equal(fake.count((entry) => Boolean(entry.faulted)), 3, 'all three failed');
    fake.reset();
    const track = await begin(page, session);
    assert.equal(track.sessionId, session.id);
    assert.equal(fake.count((entry) => entry.path.endsWith('/contextinfo')), 1, 'the write token, asked for again');
    assert.equal(fake.count((entry) => entry.list === 'tracks' && entry.path.endsWith('/fields')), 1, 'the columns, asked for again');
  });

  it('the checks keep their order: what AppSettings says wins over anything the session read says, with the code and words of c7848e5', async () => {
    const said = async (page, sessionId) => {
      try { await page.beginVisit(crypto.randomUUID(), sessionId, KROGER, { waitForSession: false }); return 'begun'; } catch (error) { return [error.code ?? error.status, error.message]; }
    };
    const NOT_ACTIVE = ['session-not-active', 'Your facilitator changed the active session. Ask them for the current check-in link.'];
    // Something else is live: AppSettings refuses, whatever the session read finds (the session itself, nothing, or a failure).
    {
      const { fake, session } = await liveSite();
      await ds.activateClient('c-dominos', DAY);
      assert.deepEqual(await said(await freshPage(fake), session.id), NOT_ACTIVE, 'the session is there');
      assert.deepEqual(await said(await freshPage(fake), 'no-such-session'), NOT_ACTIVE, 'no such session: still not active, never missing');
      fake.failNext({ status: 500, times: 1, when: (entry) => entry.list === 'sessions' && entry.method === 'GET' });
      assert.deepEqual(await said(await freshPage(fake), session.id), NOT_ACTIVE, 'the session read failed: still not active');
      assert.equal(fake.count((entry) => entry.list === 'tracks' && entry.method !== 'GET'), 0, 'and nothing is written');
    }
    // AppSettings cannot be read: its own failure, as before, whatever the session read did.
    {
      const { fake, session } = await liveSite();
      fake.failNext({ status: 500, times: 1, message: 'The settings are busy.', when: (entry) => entry.list === 'appsettings' });
      assert.deepEqual(await said(await freshPage(fake), session.id), [500, 'SharePoint (500): The settings are busy.']);
      fake.failNext({ status: 500, times: 1, message: 'The settings are busy.', when: (entry) => entry.list === 'appsettings' });
      fake.failNext({ status: 500, times: 1, message: 'The session is busy.', when: (entry) => entry.list === 'sessions' && entry.method === 'GET' });
      assert.deepEqual(await said(await freshPage(fake), session.id), [500, 'SharePoint (500): The settings are busy.'], 'both failed: AppSettings first');
    }
    // AppSettings agrees, and the session read fails: the session read's failure, as before.
    {
      const { fake, session } = await liveSite();
      fake.failNext({ status: 500, times: 1, message: 'The session is busy.', when: (entry) => entry.list === 'sessions' && entry.method === 'GET' });
      assert.deepEqual(await said(await freshPage(fake), session.id), [500, 'SharePoint (500): The session is busy.']);
    }
    // The lists are of another version: the stop code AppSettings carries, before anything else.
    {
      const { fake, session } = await liveSite();
      fake.item('appsettings', 'default').SchemaVersion = 2;
      assert.deepEqual(await said(await freshPage(fake), session.id), ['PMS-LST-011', 'PMS-LST-011']);
      fake.item('appsettings', 'default').SchemaVersion = 3;
    }
  });

  it('what the page fetches ahead, by what it can write (lib/participant/boot.js writesAhead)', () => {
    const live = (session) => ({ status: 'live', session: { id: 's', clientId: 'c', status: 'not-started', participationMode: 'staff', ...session } });
    const ahead = bootModule.writesAhead;
    assert.deepEqual(ahead({ experience: live(), track: null, own: undefined, code: null }), { checked: ['tracks', 'sessions'], types: ['responses'] }, 'can begin, and the first visit moves the session on');
    assert.deepEqual(ahead({ experience: live({ status: 'in-progress' }), track: null, own: undefined, code: null }), { checked: ['tracks'], types: ['responses'] }, 'can begin; the session is under way');
    assert.deepEqual(ahead({ experience: live({ participationMode: 'client-visit' }), track: null, own: undefined, code: null }), null, 'a guest without a code writes nothing');
    assert.deepEqual(ahead({ experience: live(), track: { id: 't' }, own: null, code: null }), { checked: [], types: ['responses'] }, 'a visit with no answers saved yet: its first save makes the item');
    assert.deepEqual(ahead({ experience: live(), track: { id: 't' }, own: { responses: [], ref: { id: 1, type: 'x' } }, code: null }), { checked: [], types: [] }, 'a visit whose item is known: the write token alone');
    assert.deepEqual(ahead({ experience: { status: 'not-live', session: null }, track: null, own: undefined, code: null }), null, 'nothing live');
    assert.deepEqual(ahead({ experience: live(), track: null, own: undefined, code: 'token-used' }), null, 'a code that could not be used');
  });

  it('prepareWrites never throws, and sends nothing on the local server', async () => {
    const page = await import(`../migration/src/lib/data/dataService.js?waits=${pagesOpened += 1}`);
    page.configure({ baseUrl: 'http://127.0.0.1:9/api' });
    let asked = 0;
    const previous = globalThis.fetch;
    globalThis.fetch = async () => { asked += 1; throw new TypeError('no server'); };
    try { await page.prepareWrites({ checked: ['tracks'], types: ['responses'] }); } finally { globalThis.fetch = previous; }
    assert.equal(asked, 0);
    await page.prepareWrites(null);
  });

  it('Welcome begins a visit without waiting for the session to be moved on', async () => {
    const welcome = await readFile(path.join(ROOT, 'migration', 'src', 'routes', 'Welcome.svelte'), 'utf8');
    assert.match(welcome, /dataService\.beginVisit\(visitIdFor\(live\.id\), live\.id, live\.clientId, \{ sharePointUserId: participant\.sharePointUserId, waitForSession: false \}\)/);
  });

  it('App.svelte fetches ahead once the first screen is up, after the visit log', async () => {
    const app = await readFile(path.join(ROOT, 'migration', 'src', 'App.svelte'), 'utf8');
    const after = /async function afterFirstScreen\(boot: Boot\) \{[\s\S]*?\n {2}\}\n/.exec(app)?.[0] ?? '';
    assert.match(after, /await logEntry\([\s\S]*dataService\.prepareWrites\(writesAhead\(boot\)\)/);
  });
});

describe('beginning a visit on the local server (part C)', () => {
  let server;
  let dataDir;
  before(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'pms-waits-'));
    await cp(path.join(ROOT, 'server', 'data'), dataDir, { recursive: true });
    const port = await freePort();
    server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((resolve, reject) => {
      server.once('exit', (code) => reject(new Error(`server exited early (code ${code})`)));
      server.stdout.on('data', (chunk) => String(chunk).includes('running') && resolve());
    });
    globalThis.fetch = realFetch;
    ds.configure({ baseUrl: `http://localhost:${port}/api` });
  });
  after(async () => {
    server?.kill();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('two first devices at once: two visits, one session in progress, the session moved on after the click', async () => {
    const { session } = await ds.activateClient(KROGER, '2026-12-09');
    assert.equal(session.status, 'not-started');
    const warned = [];
    const warn = console.warn;
    console.warn = (...parts) => { warned.push(parts.join(' ')); };
    try {
      const tracks = await Promise.all([begin(ds, session, '50'), begin(ds, session, '51')]);
      assert.equal(new Set(tracks.map((track) => track.id)).size, 2);
      await until(async () => (await ds.getSession(session.id)).status === 'in-progress', 'the session is in progress');
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    } finally { console.warn = warn; }
    assert.equal((await ds.listClientTracks(session.id)).length, 2);
    assert.deepEqual(warned, [], 'the one that lost (412) says nothing');
  });
});

// ---- Part B: the column check reads only what it checks ------------------------------------------------------------------------------
// Before a list is first written through the general create or update, the data layer reads the list's columns and checks them (spMetadata:
// every column there, AppId unique, JSON in plain multi-line text, no other required column). It read `/fields` with no `$select`, and a real
// SharePoint list answers that with every field, hidden ones included, each with all its properties and its SchemaXml: far more than the
// mock's handful. Since Phase 10j it names the eight properties the check reads.

/** The properties spMetadata's check reads, in the order the read names them. */
const FIELD_CHECK = ['InternalName', 'TypeAsString', 'Indexed', 'EnforceUniqueValues', 'RichText', 'AppendOnly', 'Required', 'ReadOnlyField'];

describe('the column check reads only what it checks (part B)', () => {
  /** A site with nothing on it but the lists, and a page that has checked no list yet. */
  async function emptySite() {
    const fake = createSharePointFake();
    fake.install();
    ds.configure({ sharePoint: fake.settings });
    return fake;
  }
  const fieldReads = (fake) => fake.select((entry) => entry.method === 'GET' && entry.path.endsWith('/fields'));

  it('the read of a list\'s columns before its first write names the eight properties the check uses, and nothing else', async () => {
    const fake = await emptySite();
    await ds.createClient({ id: 'c-one', name: 'One' });
    const [read, ...others] = fieldReads(fake);
    assert.equal(others.length, 0);
    assert.equal(read.list, 'clients');
    assert.equal(read.query, `?$select=${FIELD_CHECK.join(',')}`);
  });

  it('the check reads exactly the properties it names (a source check of spMetadata)', async () => {
    const source = await dataLayerSource();
    const body = /async function spMetadata\(list\) \{[\s\S]*?\n\}\n/.exec(source)?.[0];
    assert.ok(body, 'spMetadata is where it was');
    const read = new Set([...body.matchAll(/\b(?:field|appId|extra)\??\.([A-Z]\w+)/g)].map(([, property]) => property));
    for (const [, property] of body.matchAll(/\(field\) => field\.([A-Z]\w+)/g)) read.add(property);
    assert.deepEqual([...read].sort(), [...FIELD_CHECK].sort());
  });

  it('its rules and its words are what they were: a missing column, AppId not unique, rich text for JSON, another required column', async () => {
    const said = async (change, write) => {
      const fake = await emptySite();
      change(fake);
      try { await write(); return 'written'; } catch (error) { return error.message; }
    };
    const client = () => ds.createClient({ id: 'c-one', name: 'One' });
    assert.equal(await said(() => {}, client), 'written');
    assert.equal(await said((fake) => { fake.fields.get('clients').splice(fake.fields.get('clients').findIndex((field) => field.InternalName === 'Slug'), 1); }, client),
      `${TITLE.clients} is missing the internal column Slug. See SHAREPOINT-LISTS.md.`);
    assert.equal(await said((fake) => { fake.field('clients', 'AppId').EnforceUniqueValues = false; }, client),
      `${TITLE.clients}.AppId must be Single line of text, indexed, with Enforce unique values = Yes.`);
    assert.equal(await said((fake) => { fake.field('clients', 'ThemeJson').RichText = true; }, client),
      `${TITLE.clients}.ThemeJson must be Multiple lines of plain text, with append-only disabled.`);
    assert.equal(await said((fake) => { fake.fields.get('clients').push({ InternalName: 'Region', TypeAsString: 'Text', Indexed: false, EnforceUniqueValues: false, RichText: false, AppendOnly: false, Required: true, ReadOnlyField: false }); }, client),
      `${TITLE.clients} has an unsupported required column: Region.`);
  });

  it('the mock answers a read of the columns as SharePoint does: the properties named, or every property with its SchemaXml', async () => {
    const fake = await emptySite();
    const at = (query = '') => `${fake.siteUrl}/_api/web/lists/getbytitle('${fake.titleOf('tracks')}')/fields${query}`;
    const named = await (await fake.fetch(at(`?$select=${FIELD_CHECK.join(',')}`), { headers: { Accept: 'application/json;odata=verbose' } })).text();
    const whole = await (await fake.fetch(at(), { headers: { Accept: 'application/json;odata=verbose' } })).text();
    const fields = (text) => JSON.parse(text).d.results;
    assert.deepEqual(Object.keys(fields(named)[0]).filter((key) => key !== '__metadata'), FIELD_CHECK);
    assert.ok(fields(whole).every((field) => typeof field.SchemaXml === 'string' && field.SchemaXml.startsWith('<Field ')), 'every field has its SchemaXml');
    assert.deepEqual(fields(named).map((field) => field.InternalName), fields(whole).map((field) => field.InternalName), 'the same columns');
    measuredSizes.push([TITLE.tracks, Buffer.byteLength(named), Buffer.byteLength(whole), fields(whole).length]);
    assert.ok(Buffer.byteLength(named) * 4 < Buffer.byteLength(whole), `${Buffer.byteLength(named)} B named, ${Buffer.byteLength(whole)} B not`);
  });
});

/** [list, bytes of the named read, bytes of the read with no $select, fields] of the mock's answers, printed at the end. */
const measuredSizes = [];
after(() => {
  for (const [list, named, whole, count] of measuredSizes) {
    console.log(`  The column check's read of ${list} on the mock (${count} fields): ${named.toLocaleString('en')} B named, ${whole.toLocaleString('en')} B with no $select. A real list has many more fields, hidden ones too.`);
  }
});

it('no request of this suite reached another copy\'s lists, filtered on a column with no index, or read items without naming their columns', () => {
  assert.deepEqual(STRAYS.map((entry) => `${entry.method} ${entry.title}`), []);
  assert.deepEqual(UNINDEXED.map((entry) => `${entry.list}.${entry.unindexed}`), []);
  assert.deepEqual(UNNAMED.map((entry) => `${entry.list}${entry.query}`), []);
  assert.deepEqual(REFUSED_BY_NAME.map((entry) => `${entry.list}.${entry.refusedByName}`), []);
});
