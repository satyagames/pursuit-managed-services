// Prompt 26, Part 0: what each journey costs, measured the same way before and after a change. It runs the page's own plain modules and the
// data layer's own calls (what each screen calls; a Svelte file's calls are written out here) against the mocked SharePoint, with `--delay`
// milliseconds on every request (0.4 s, what a call costs on the real site), and records for each journey: the requests, the longest chain of
// requests that waited for each other before the screen could be used, the bytes received and the time to a usable screen.
//
//   npm run perf                        prints the table
//   npm run perf -- --write BEFORE      and writes it to docs/perf/BEFORE.md (AFTER likewise)
//   npm run perf -- --check             exits 1 if a target of docs/perf/TARGETS.md is missed
//   npm run perf -- --delay 20          a quicker run: chains are still counted, times are not comparable
//
// It is the fake, not SharePoint: the bytes are the fake's rows, which carry what the real rows carry (`realShape`: Created, Modified, id, uri) but
// not every built-in column. The real site's numbers are QA-TESTING.md's to read (docs/DEVTOOLS-NETWORK.md says how).
import './fresh-page.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as ds from '../migration/src/lib/data/dataService.js';
import { createItem, requestTotal } from '../migration/src/lib/data/core.js';
import { createAnswerStore } from '../migration/src/lib/participant/answer-store.js';
import { createActivityContent } from '../migration/src/lib/participant/activity-content.js';
import { bootParticipant, writesAhead } from '../migration/src/lib/participant/boot.js';
import { samplePack } from '../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../migration/src/lib/setup/seed.js';
import { resolveAccess } from '../migration/src/lib/access/resolve.js';
import { loadToday } from '../migration/src/lib/admin/admin-today.js';
import { readSessionResults } from '../migration/src/lib/results/session-results.js';
import { readDashboard } from '../migration/src/lib/admin/session-summaries.js';
import { createSharePointFake } from './sharepoint-fake.js';

const DAY = '2026-10-15';
const KROGER = 'c-kroger';
const SIZES = { guests: 30, sessions: 20, summaries: 40, users: 60 };
/** A question's answer as the pager hands it to the answer store, by kind of question. */
const ANSWERS = {
  'single-select': { answer: 'o-1', firstAnswer: 'o-1', attempts: 1, correct: true },
  'multi-select': { answer: ['o-1', 'o-2'], firstAnswer: ['o-1', 'o-2'], attempts: 1, correct: false },
  'true-false': { answer: 'true', firstAnswer: 'true', attempts: 1, correct: true },
  'confidence-continuum': { answer: 4, firstAnswer: 4, attempts: 1, correct: null },
  'ranked-voting': { answer: ['o-2', 'o-1'], firstAnswer: ['o-2', 'o-1'], attempts: 1, correct: null },
  'open-text-feedback': { answer: 'A written answer of a sentence or two, as a guest types it.', firstAnswer: 'A written answer of a sentence or two, as a guest types it.', attempts: 1, correct: null },
  'art-of-the-possible': { answer: '{"a":{"impact":5,"ease":3},"b":{"impact":4,"ease":4}}', firstAnswer: '{"a":{"impact":5,"ease":3},"b":{"impact":4,"ease":4}}', attempts: 1, correct: null },
};

const memoryStorage = () => {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); }, removeItem: (key) => { map.delete(key); } };
};

/** A site with the sample clients, Kroger live, and the rows the journeys ask for. */
async function buildSite() {
  const fake = createSharePointFake({ strict: true, realShape: { now: () => new Date().toISOString() } });
  fake.install();
  ds.configure({ sharePoint: fake.settings });
  await seedPack(ds, samplePack());
  const { session } = await ds.activateClient(KROGER, DAY);
  await ds.setSessionParticipationMode(session.id, 'client-visit');
  const sections = await ds.listClientSections(KROGER);
  const questionIds = sections.flatMap((section) => section.questionIds ?? []);
  const answers = (who) => questionIds.map((questionId) => ({ questionId, answer: `o-${who}`, firstAnswer: `o-${who}`, attempts: 1, correct: true, answeredAt: '2026-10-15T10:00:00.000Z' }));
  const tokens = [];
  for (let at = 0; at < SIZES.guests; at += 1) {
    const visitor = await ds.createVisitor({ sessionId: session.id, displayName: `Guest ${at + 1}`, enabled: true });
    const token = await ds.provisionQrToken(KROGER, session.id, { visitorId: visitor.id });
    tokens.push(token.id);
  }
  for (let at = 0; at < 5; at += 1) {
    const id = `t-live-${at}`;
    await createItem('tracks', { id, sessionId: session.id, clientId: KROGER, participantName: `Guest ${at + 1}`, createdAt: '2026-10-15T10:00:00.000Z' });
    await ds.saveParticipantResponses({ trackId: id, sessionId: session.id, clientId: KROGER, responses: answers(at) });
  }
  const past = [];
  for (let at = 0; at < SIZES.sessions; at += 1) {
    const id = `s-past-${at}`;
    await createItem('sessions', { id, clientId: KROGER, date: `2026-0${(at % 9) + 1}-${String((at % 27) + 1).padStart(2, '0')}`, sectionIds: sections.map((section) => section.id), status: 'completed', participationMode: 'staff', activityFlow: 'sequential' });
    past.push(id);
    for (let guest = 0; guest < 5; guest += 1) {
      const track = `t-${id}-${guest}`;
      await createItem('tracks', { id: track, sessionId: id, clientId: KROGER, participantName: `Guest ${guest + 1}`, createdAt: '2026-05-01T10:00:00.000Z' });
      await ds.saveParticipantResponses({ trackId: track, sessionId: id, clientId: KROGER, responses: answers(guest) });
    }
  }
  for (let at = 0; at < SIZES.summaries; at += 1) {
    await createItem('sessionsummary', { id: `s-sum-${at}`, clientId: KROGER, period: 'FY27-Q1', sessionDate: DAY, guests: 12, answers: 120, completed: 10, summaryJson: { facilitator: 'Casey', title: 'Workshop', kinds: { 'single-select': 8, 'ranked-voting': 2 }, groups: {}, scaleMax: 5, distribution: [1, 2, 3, 4, 2], feedback: { themes: [{ word: 'pricing', count: 3 }], quotes: [{ text: 'A useful day, and a clear next step for the team.' }] }, activities: Array.from({ length: 6 }, (_, activity) => ({ id: `a-${activity}`, score: 3.5, questions: 4 })) } });
  }
  for (let at = 0; at < SIZES.users; at += 1) {
    const email = `person${at}@example.com`;
    await createItem('users', { id: email, email, fullName: `Person ${String(at).padStart(2, '0')} Example`, status: 'Active' });
    await createItem('roleassignments', { id: `r-${at}`, userKey: email, role: at % 2 ? 'Producer' : 'Designer', scopeType: 'Client', clientId: KROGER });
  }
  fake.reset();
  return { fake, session, sections, tokens, past, questionIds };
}

/** A page opening: the data layer forgets what it held (its write token, whether it can batch), as a new page load does. */
const opened = (fake) => ds.configure({ sharePoint: fake.settings });

/** Each journey: `usable()` marks the moment the screen can be used; what it sends after that is background work. */
const journeys = (site) => {
  const { fake, session, sections, tokens, past } = site;
  const visit = { trackId: 't-live-0', sessionId: session.id, clientId: KROGER, restartedAt: null };
  const store = () => createAnswerStore({ api: ds, storage: memoryStorage(), sleep: async () => {} });
  /** What App.svelte's afterFirstScreen sends once the first screen is drawn. */
  const afterFirstScreen = async (boot, content) => {
    if (boot.experience?.status === 'live') await content.start(boot.experience.sections);
    await ds.recordParticipantVisit({ visitKey: crypto.randomUUID(), sessionId: session.id, clientId: KROGER, page: 'participant', entryMode: 'staff', visitedAt: new Date().toISOString() });
    await ds.prepareWrites(writesAhead(boot));
    if (boot.track && !boot.claimed) await ds.noteTrackResumed(boot.track);
  };
  const watch = (extra = {}) => ds.readParticipantWatch({ sessionId: session.id, ...extra });
  const hubRead = (content, held) => (content.hubRead ? content.hubRead(KROGER, held) : content.refreshWith(KROGER, held));
  let scans = 0;
  return [
    ['Participant boot, a QR scan', async (usable) => {
      const content = createActivityContent({ api: ds });
      const boot = await bootParticipant(ds, { qrToken: tokens[scans++ % tokens.length], path: '/', content });
      usable();
      await afterFirstScreen(boot, content);
    }],
    ['Welcome, its first minute', async (usable) => {
      const content = createActivityContent({ api: ds });
      const boot = await bootParticipant(ds, { path: '/' });
      usable();
      await afterFirstScreen(boot, content);
      for (let check = 0; check < 3; check += 1) await watch(); // (3 checks a minute: lib/common/poll-schedule.js)
    }],
    ['The hub: Welcome, hub, quiz, hub, finale', async (usable) => {
      const content = createActivityContent({ api: ds });
      const boot = await bootParticipant(ds, { trackId: visit.trackId, path: '/agenda' });
      usable();
      const held = boot.experience.sections;
      await afterFirstScreen(boot, content);
      await hubRead(content, held); // a later arrival (the first takes what boot read)
      await watch({ trackId: visit.trackId, clientId: KROGER });
      await hubRead(content, held);
    }],
    ...Object.entries(ANSWERS).map(([kind, answer]) => [`Answering: ${kind}`, async (usable) => {
      const answers = store();
      await answers.restore(visit, undefined);
      usable();
      answers.record(visit, sections[0].id, { questionId: `perf-${kind}`, ...answer });
      await answers.flush(visit, sections[0].id);
      await answers.flush(visit, sections[0].id);
    }]),
    ['The finale', async (usable) => {
      await ds.getClientActivities(KROGER, session);
      usable();
    }],
    ['Admin sign-in', async (usable) => {
      await resolveAccess(ds, { refresh: true });
      await ds.getAppSettings();
      usable();
    }],
    ['Today', async (usable) => {
      await loadToday(ds, { clientId: KROGER, date: DAY });
      usable();
    }],
    ['Clients', async (usable) => {
      const read = ds.readClientsScreen ?? (() => ds.readLists([{ list: 'appsettings' }, { list: 'clients' }, { list: 'sessions' }, { list: 'sections' }]));
      await read();
      usable();
    }],
    ['Content, one client', async (usable) => {
      await ds.readLists([{ list: 'appsettings' }, { list: 'clients' }, { list: 'sections' }]);
      usable();
      await ds.readActivityContent(sections);
    }],
    [`Guests, ${SIZES.guests} guests`, async (usable) => {
      await ds.readLists([{ list: 'appsettings' }]);
      await ds.readLists([
        { list: 'sessions', where: { id: session.id } }, { list: 'visitorroster', where: { sessionId: session.id } }, { list: 'qrtokens', where: { sessionId: session.id } },
        { list: 'tracks', where: { sessionId: session.id } }, { list: 'uservisitlogs', where: { sessionId: session.id } },
        { list: 'sections', where: { clientId: KROGER } }, { list: 'clients', where: { id: KROGER } },
      ]);
      usable();
    }],
    [`Results, Sessions, ${SIZES.sessions} sessions`, async (usable) => {
      const basics = ds.readResultsIndex ?? (async () => { const [rows] = await Promise.all([ds.listSessions(), ds.listClients(), ds.listQrTokens(), ds.getAppSettings()]); return rows; });
      const rows = await basics();
      const opening = ds.readResultsIndex ? rows.slice(0, 1).map((row) => row.id) : rows.map((row) => row.id);
      await Promise.all(opening.map((id) => readSessionResults(id)));
      usable();
    }],
    [`Results, Dashboard, ${SIZES.summaries} summaries`, async (usable) => {
      await ds.getAppSettings();
      await readDashboard(null, { startMonth: 7 });
      usable();
    }],
    [`People, ${SIZES.users} users`, async (usable) => {
      if (ds.readPeopleIndex) await ds.readPeopleIndex();
      else await Promise.all([ds.listAccessRecords('users'), ds.listAccessRecords('roleassignments'), ds.listClients(), ds.listSessions()]);
      usable();
    }],
    ['Live display, one refresh', async (usable) => {
      await ds.readLiveFeed(session.id, { sectionIds: sections.map((section) => section.id) });
      usable();
    }],
  ].map(([name, run]) => ({ name, run, opened: () => opened(fake), past }));
};

const roundUp = (bytes) => (bytes / 1024).toFixed(1);

/** Runs every journey with `delay` ms on every request. @returns {Promise<{ name: string, requests: number, chain: number, bytes: number, usableMs: number }[]>} */
export async function measureJourneys({ delay = 400 } = {}) {
  const realFetch = globalThis.fetch;
  const site = await buildSite();
  const { fake } = site;
  const rows = [];
  try {
    for (const journey of journeys(site)) {
      journey.opened();
      let bytes = 0;
      let requests = 0;
      globalThis.fetch = async (url, init) => {
        await new Promise((resolve) => { setTimeout(resolve, delay); });
        requests += 1;
        const reply = await fake.fetch(url, init);
        bytes += Buffer.byteLength(await reply.clone().text());
        return reply;
      };
      const started = performance.now();
      let usableAt = null;
      await journey.run(() => { usableAt ??= performance.now(); });
      const usableMs = Math.round((usableAt ?? performance.now()) - started);
      rows.push({ name: journey.name, requests, chain: Math.round(usableMs / delay), bytes, usableMs });
    }
  } finally {
    globalThis.fetch = realFetch;
    void requestTotal;
  }
  return rows;
}

export const tableOf = (rows) => [
  '| Journey | Requests | Longest chain to a usable screen | kB received | Time to usable (s) |',
  '|---|---:|---:|---:|---:|',
  ...rows.map((row) => `| ${row.name} | ${row.requests} | ${row.chain} | ${roundUp(row.bytes)} | ${(row.usableMs / 1000).toFixed(1)} |`),
].join('\n');

/** The targets of docs/perf/TARGETS.md a run misses, in words. `before` (the BEFORE.md rows) is what the 40% is measured against. */
export function missed(rows, before = []) {
  const problems = [];
  for (const row of rows) {
    if (row.chain > 3) problems.push(`${row.name}: ${row.chain} sequential requests before it is drawn (at most 3).`);
    const old = before.find((entry) => entry.name === row.name);
    if (old && old.bytes > 0 && row.bytes > old.bytes * 0.6) problems.push(`${row.name}: ${row.bytes} B, down ${Math.round((1 - row.bytes / old.bytes) * 100)}% from ${old.bytes} B (at least 40%).`);
    if (row.name.startsWith('Welcome') && row.requests > 12) problems.push(`${row.name}: ${row.requests} requests (at most 12).`);
  }
  return problems;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const option = (name) => { const at = process.argv.indexOf(`--${name}`); return at === -1 ? null : process.argv[at + 1]; };
  const delay = Number(option('delay') ?? 400);
  const rows = await measureJourneys({ delay });
  const table = tableOf(rows);
  console.log(table);
  const label = option('write');
  const dir = path.join(import.meta.dirname, '..', 'docs', 'perf');
  if (label) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${label}.md`), `# Journeys: ${label}\n\nMeasured by \`npm run perf\` (\`scripts/perf-journeys.js\`) on the mocked SharePoint with ${delay} ms on every request. It is the fake, not the real site.\n\n${table}\n\n<!-- rows: ${JSON.stringify(rows.map(({ name, requests, chain, bytes }) => ({ name, requests, chain, bytes })))} -->\n`);
  }
  if (process.argv.includes('--check')) {
    const { readFileSync } = await import('node:fs');
    const before = JSON.parse(/<!-- rows: (.*) -->/.exec(readFileSync(path.join(dir, 'BEFORE.md'), 'utf8'))[1]);
    const problems = missed(rows, before);
    for (const problem of problems) console.error(problem);
    process.exit(problems.length ? 1 : 0);
  }
  process.exit(0);
}
