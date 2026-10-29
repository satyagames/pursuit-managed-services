// What the admin's Today screen reads, decides and says. Plain JS with JSDoc and no DOM or Svelte, so
// `node --test` can run it against the mocked SharePoint REST and count requests
// (scripts/test-admin-today.js). AdminToday.svelte only renders what this says.
//
// The data service is handed in (`api`), as boot.js does, so a test can pass a stand-in.
//
// Request budgets, on SharePoint (the Today load is measured in scripts/test-admin-today.js and, in
// a real browser, in scripts/migration-tests/admin-sharepoint.spec.ts):
//
//   load    the write token, then ONE $batch carrying AppSettings, Clients, Sessions and Sections,
//           beside ONE $batch carrying every list's columns (the schema check), then ONE $batch
//           carrying the picked client's questions and options, the live session's tracks and the
//           roster: 4 requests. Changing the picker costs one more (the questions and options).
//   poll    ONE $batch carrying AppSettings, the live session and its tracks: 1 request. When the
//           facilitator (or another admin) changed what is live, one more carries the new session,
//           its tracks and its client: 2 at the worst. Never the whole page again.
//   go live activateClient() as the data service does it, then ONE read of AppSettings to prove it.
//
// Where the site cannot batch, the same reads go one by one: more requests, never a failed screen.

import { isCheckActivity } from '../participant/confidence-check.js';
import { withoutRetiredLogo } from '../brand/retired-logos.js';
import { daySessionPick } from './session-plan.js';

/** How often the status panel asks. Visibility-aware: AdminToday.svelte pauses while the tab is hidden. */
export const POLL_MS = 10_000;

/** Question ids per read: keeps the address of one read well under 2,000 characters. */
const CHUNK = 20;

/**
 * Phase 9b (DI-1). In staff mode a device looks for "the visit this account already has today", so two iPads that share one
 * sign-in end up on one visit and overwrite each other's answers. The code was deliberately not changed (boot.js): the rule is
 * said out loud instead, beside "How people are identified" and as a warning in the readiness list. It never blocks Go live.
 */
export const STAFF_MODE_WARNING = "Staff mode: every person needs their own sign-in. iPads that share one sign-in must use Guests scan a personal QR, or two people's answers will be mixed.";

/** Is this session (or one that Go live is about to make, `null`) in staff mode? Anything but guests is staff, as the data service has it. */
export const isStaffMode = (session) => session?.participationMode !== 'client-visit';

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, (index + 1) * size));
const unique = (list) => [...new Set(list)];
const settingsOf = (rows) => rows.find((row) => row.id === 'default') ?? null;

// ---- Dates ----------------------------------------------------------------------------------------

/** Today as YYYY-MM-DD in the browser's local time (not UTC: an evening session is still today). */
export const localDate = (now = new Date()) => new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** A real calendar date written YYYY-MM-DD. */
export const isCalendarDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '')
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

// ---- What is live ---------------------------------------------------------------------------------

/**
 * Is a client live, and if not, why? The same rules the participant page applies (getLiveExperience):
 * a session that exists and has not ended, whose client exists and is not archived.
 * `reason` is 'no-session', 'session-missing', 'session-ended', 'client-missing' or 'client-archived'.
 * @param {{ settings: any, session: any, clients: any[] }} state
 * @returns {{ live: boolean, reason: string | null, client: any, session: any, since: string | null }}
 */
export function liveStatus({ settings, session, clients }) {
  const since = settings?.activatedAt ?? null;
  const found = (reason, client = null) => ({ live: false, reason, client, session: session ?? null, since });
  if (!settings?.activeSessionId) return found('no-session');
  if (!session) return found('session-missing');
  // (The client is the one AppSettings names, which Go live writes beside the session. It is never looked for through the session.)
  const client = clients.find((entry) => entry.id === settings.activeClientId) ?? null;
  if (session.status === 'completed') return found('session-ended', client);
  if (!client || session.clientId !== client.id) return found('client-missing', client);
  if (client.status === 'archived') return found('client-archived', client);
  return { live: true, reason: null, client, session, since };
}

/** What the status panel says about a client that is not live. */
export const notLiveText = (status) => ({
  'no-session': 'Nothing is live. A participant who opens the page sees "Today\'s experience isn\'t live yet".',
  'session-missing': 'The live session no longer exists. A participant who opens the page sees "Today\'s experience isn\'t live yet".',
  'session-ended': `The ${status.client?.name ?? 'client'} session has ended. A participant who opens or reloads the page sees "This session has ended."; a page that is already open shows it within about 25 seconds (someone partway through an activity finishes it first). Reopen it, or go live with a client below.`,
  'client-missing': 'The live session\'s client no longer exists. A participant who opens the page sees "Today\'s experience isn\'t live yet".',
  'client-archived': `${status.client?.name ?? 'The client'} is archived. A participant who opens the page sees "Today's experience isn't live yet".`,
}[status.reason] ?? 'Nothing is live.');

// ---- Loading --------------------------------------------------------------------------------------

/**
 * The picker's starting client: the one asked for, else the live one, else the first active client by name.
 * A re-check passes `keepWanted` so that the client the facilitator picked stays picked even if someone
 * has archived it since: readiness then says so, instead of the picker quietly moving to another client.
 * @param {any[]} clients @param {string | null | undefined} wanted @param {string | null | undefined} liveId
 * @param {{ keepWanted?: boolean }} [options]
 */
export function startingClientId(clients, wanted, liveId, { keepWanted = false } = {}) {
  const open = (id) => clients.find((client) => client.id === id && client.status !== 'archived')?.id ?? null;
  if (keepWanted && clients.some((client) => client.id === wanted)) return wanted;
  return open(wanted) ?? open(liveId)
    ?? [...clients].filter((client) => client.status !== 'archived').sort((a, b) => a.name.localeCompare(b.name))[0]?.id ?? null;
}

/**
 * What readiness needs that the first round does not hold: the picked client's questions and options
 * (live activities only; a switched-off activity is not shown to anyone), and the roster of the
 * session that client would go live with. Read side by side, in one request. `extra` is more list
 * reads to send in the same request (the load adds the live session's tracks); their answers come
 * back as `extraAnswers`. The session is the one picked for the day (`sessionId`, Prompt 21 Phase 3: a client may have several that day), else
 * the day's first that has not ended (daySessionPick); for a client with one session that day, the one Go live made, as before.
 * @param {any} api
 * @param {{ client: any, date: string, sections: any[], sessions: any[], sessionId?: string | null }} input
 * @param {{ list: string, where?: Record<string, any> }[]} [extra]
 */
export async function loadReadinessInputs(api, { client, date, sections, sessions, sessionId = null }, extra = []) {
  const live = sections.filter((section) => section.clientId === client.id && section.enabled === true);
  const questionIds = unique(live.flatMap((section) => section.questionIds ?? []));
  const target = daySessionPick(sessions, client.id, date, sessionId);
  const guests = target?.participationMode === 'client-visit';
  const pages = Math.ceil(questionIds.length / CHUNK);
  const asked = [
    ...chunks(questionIds, CHUNK).map((ids) => ({ list: 'questions', where: { id: ids } })),
    ...chunks(questionIds, CHUNK).map((ids) => ({ list: 'options', where: { questionId: ids } })),
    ...(guests ? [{ list: 'visitorroster', where: { sessionId: target.id } }] : []),
    ...extra,
  ];
  const answers = asked.length ? await api.readLists(asked) : [];
  return {
    questions: answers.slice(0, pages).flat(),
    options: answers.slice(pages, pages * 2).flat(),
    roster: guests ? answers[pages * 2] ?? [] : null,
    extraAnswers: answers.slice(pages * 2 + (guests ? 1 : 0)),
    target,
  };
}

/**
 * Everything Today shows on first paint.
 * @param {any} api
 * @param {{ clientId?: string | null, date?: string, keepClient?: boolean, sessionId?: string | null }} [options]
 */
export async function loadToday(api, { clientId = null, date = localDate(), keepClient = false, sessionId = null } = {}) {
  // The schema check is only meaningful on SharePoint, and only a read: a failure to run it is
  // reported as a warning, never a reason to hide the screen.
  const schema = api.isSharePointMode()
    ? api.checkSharePointSchema({ batch: true }).then((report) => ({ report }), (error) => ({ error: error instanceof Error ? error.message : String(error) }))
    : Promise.resolve(null);
  const [[settingRows, clients, sessions, sections], schemaResult] = await Promise.all([
    api.readLists([{ list: 'appsettings' }, { list: 'clients' }, { list: 'sessions' }, { list: 'sections' }]),
    schema,
  ]);
  const settings = settingsOf(settingRows);
  const active = settings?.activeSessionId ? sessions.find((session) => session.id === settings.activeSessionId) ?? null : null;
  const status = liveStatus({ settings, session: active, clients });
  const picked = startingClientId(clients, clientId, status.live ? status.client.id : null, { keepWanted: keepClient });
  const client = clients.find((entry) => entry.id === picked) ?? null;
  const inputs = client
    ? await loadReadinessInputs(api, { client, date, sections, sessions, sessionId }, active ? [{ list: 'tracks', where: { sessionId: active.id } }] : [])
    : { questions: [], options: [], roster: null, target: null, extraAnswers: [] };
  const { extraAnswers, ...held } = inputs;
  const tracks = extraAnswers[0] ?? (active && !client ? (await api.readLists([{ list: 'tracks', where: { sessionId: active.id } }]))[0] : []);
  return { settings, clients, sessions, sections, schema: schemaResult, status, participants: tracks.length, pickedClientId: picked, ...held };
}

/**
 * The status panel's refresh: AppSettings, the live session and its tracks together (one request on
 * SharePoint). If something else became live meanwhile, one more read gets that session, its tracks
 * and its client. `known` is the last result of loadToday() or pollToday().
 * @param {any} api
 * @param {{ settings: any, clients: any[] }} known
 */
export async function pollToday(api, known) {
  const knownSession = known.settings?.activeSessionId ?? null;
  const [settingRows, sessionRows, trackRows] = await api.readLists([
    { list: 'appsettings' },
    { list: 'sessions', where: { id: knownSession ?? [] } },
    { list: 'tracks', where: { sessionId: knownSession ?? [] } },
  ]);
  const settings = settingsOf(settingRows);
  let session = sessionRows[0] ?? null;
  let tracks = trackRows;
  let clients = known.clients;
  const nextSession = settings?.activeSessionId ?? null;
  if (nextSession !== knownSession) {
    const wantedClient = settings?.activeClientId ?? null;
    const [sessionNow, tracksNow, clientNow] = await api.readLists([
      { list: 'sessions', where: { id: nextSession ?? [] } },
      { list: 'tracks', where: { sessionId: nextSession ?? [] } },
      { list: 'clients', where: { id: wantedClient ?? [] } },
    ]);
    session = sessionNow[0] ?? null;
    tracks = tracksNow;
    clients = [...known.clients.filter((entry) => !clientNow.some((fresh) => fresh.id === entry.id)), ...clientNow];
  } else if (session && settings?.activeClientId && !clients.some((entry) => entry.id === settings.activeClientId)) {
    const [clientNow] = await api.readLists([{ list: 'clients', where: { id: settings.activeClientId } }]);
    clients = [...clients, ...clientNow];
  }
  const status = liveStatus({ settings, session, clients });
  return { settings, clients, session, status, participants: tracks.length, changed: nextSession !== knownSession || (known.settings?.activeClientId ?? null) !== (settings?.activeClientId ?? null) };
}

// ---- Going live -----------------------------------------------------------------------------------

const going = new Map();

/**
 * Makes `clientId` live for `date`, then reads AppSettings back to prove the page participants read
 * now names it. Pressing it twice (a double click, a second admin) is safe: the session's id comes
 * from the client's slug and the date, so there is only ever one, and a second call made while the
 * first is still running on this page gets the first one's answer instead of starting another.
 * Resolves to { session, client, settings, verified } where `settings` is what was read back.
 * @param {any} api
 * @param {{ clientId: string, date: string }} target
 */
export function goLive(api, { clientId, date }) {
  const key = `${clientId}|${date}`;
  const running = going.get(key);
  if (running) return running;
  const run = (async () => {
    const result = await api.activateClient(clientId, date);
    const settings = await api.getAppSettings();
    const verified = settings?.activeSessionId === result.session.id && settings?.activeClientId === result.client.id;
    return { session: result.session, client: result.client, settings, verified };
  })().finally(() => { going.delete(key); });
  going.set(key, run);
  return run;
}

/**
 * The Producer's Start (Prompt 21, Phase 3): makes a planned session live through the data layer's startSession(), the only thing that makes a planned
 * session live, then reads AppSettings back, as goLive() does. Pressing it twice on this page gets the first press's answer.
 * Resolves to { session, client, settings, verified }.
 * @param {any} api @param {string} sessionId
 */
export function startPlannedSession(api, sessionId) {
  const key = `start|${sessionId}`;
  const running = going.get(key);
  if (running) return running;
  const run = (async () => {
    const result = await api.startSession(sessionId);
    const settings = await api.getAppSettings();
    const verified = settings?.activeSessionId === result.session.id && settings?.activeClientId === result.client.id;
    return { session: result.session, client: result.client, settings, verified };
  })().finally(() => { going.delete(key); });
  going.set(key, run);
  return run;
}

/**
 * Makes an EXISTING session live (one whose id is not `<slug>-<date>`), then reads AppSettings back,
 * as goLive() does. Resolves to { session, client, settings, verified }.
 * @param {any} api @param {string} sessionId
 */
export function makeSessionLive(api, sessionId) {
  const key = `session|${sessionId}`;
  const running = going.get(key);
  if (running) return running;
  const run = (async () => {
    const result = await api.activateSession(sessionId);
    const settings = await api.getAppSettings();
    const verified = settings?.activeSessionId === result.session.id && settings?.activeClientId === result.client.id;
    return { session: result.session, client: result.client, settings, verified };
  })().finally(() => { going.delete(key); });
  going.set(key, run);
  return run;
}

// ---- Readiness ------------------------------------------------------------------------------------

/**
 * @typedef {object} ReadinessRow
 * @property {string} id
 * @property {'pass' | 'warning' | 'blocker'} level
 * @property {string} title
 * @property {string} detail What was found, in plain words.
 * @property {string} [fix] What to do about it.
 * @property {{ label: string, tab?: string, href?: string, action?: string }} [go] Where to do it.
 */

const LEVEL_ORDER = { blocker: 0, warning: 1, pass: 2 };
const list = (names, max = 3) => (names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} and ${names.length - max} more`);
const quoted = (prompt) => `"${text(prompt).length > 60 ? `${text(prompt).slice(0, 57)}...` : text(prompt)}"`;

/** One line for a schema problem: where it is and what is wrong. */
function schemaLine(listName, problem) {
  return problem.column === null ? `${listName}: ${problem.problem}`
    : `${listName}.${problem.column}${problem.type ? ` (${problem.type})` : ''}: ${problem.problem}`;
}

/**
 * The readiness check: every rule as a row, each a pass, a warning or a blocker, with the fix in
 * plain words. Go live is disabled while any row is a blocker.
 *
 * @param {object} input
 * @param {any} input.client The picked client.
 * @param {string} input.date The picked date, YYYY-MM-DD.
 * @param {string} input.today Today, YYYY-MM-DD, in the browser's local time.
 * @param {any[]} input.sections Every activity (any client).
 * @param {any[]} input.questions The picked client's live activities' questions.
 * @param {any[]} input.options Their options.
 * @param {any[]} input.sessions Every session.
 * @param {any[]} input.clients Every client (to name the other clients' sessions).
 * @param {any | null} input.target The session this client would go live with on this date, if it exists.
 * @param {any[] | null} input.roster Its guests (null when it is not in guest mode).
 * @param {{ report?: any[], error?: string } | null} input.schema The SharePoint schema check, or null off SharePoint.
 * @param {boolean} [input.mayPlan] Whether this person may plan sessions as well as run them (Prompt 21, Phase 3): with nothing planned for the
 *   client that day, Go live makes the day's session for them, as before; anyone else (a Producer) needs a session planned first.
 * @returns {ReadinessRow[]}
 */
export function evaluateReadiness({ client, date, today, sections, questions, options, sessions, clients = [], target, roster, schema, mayPlan = true }) {
  /** @type {ReadinessRow[]} */
  const rows = [];
  const add = (row) => rows.push(row);
  const name = client?.name ?? 'This client';

  // -- the SharePoint lists -----------------------------------------------------------------
  if (schema === null || schema === undefined) {
    add({ id: 'lists', level: 'pass', title: 'SharePoint lists', detail: 'This is the local test server: there are no SharePoint lists to check.' });
  } else if (schema.error) {
    add({ id: 'lists', level: 'warning', title: 'SharePoint lists', detail: `The lists could not be checked: ${schema.error}`,
      fix: 'Press Re-check. If it keeps failing, run Check Lists on the Setup page.', go: { label: 'Open Setup', href: './setup.html' } });
  } else {
    const found = schema.report.flatMap((entry) => entry.problems.map((problem) => ({ listName: entry.list, ...problem })));
    const breaking = found.filter((problem) => problem.problem !== 'Not indexed.');
    const slow = found.filter((problem) => problem.problem === 'Not indexed.');
    if (breaking.length > 0) {
      add({ id: 'lists', level: 'blocker', title: 'SharePoint lists', detail: `${breaking.length} problem${breaking.length === 1 ? '' : 's'}: ${list(breaking.map((problem) => schemaLine(problem.listName, problem)))}`,
        fix: 'Ask the site owner to create or correct them (SHAREPOINT-LISTS.md says how each must be), then press Re-check. Setup shows the full list.', go: { label: 'Open Setup', href: './setup.html' } });
    } else if (slow.length > 0) {
      add({ id: 'lists', level: 'warning', title: 'SharePoint lists', detail: `Works, but slower than it should: ${list(slow.map((problem) => schemaLine(problem.listName, problem)))}`,
        fix: 'Ask the site owner to index the column.', go: { label: 'Open Setup', href: './setup.html' } });
    } else {
      add({ id: 'lists', level: 'pass', title: 'SharePoint lists', detail: 'Every list and column the app needs is there.' });
    }
  }

  // -- the client -----------------------------------------------------------------------------
  if (!client) {
    add({ id: 'client', level: 'blocker', title: 'Client', detail: 'No client is chosen.', fix: 'Add a client first.', go: { label: 'Open Clients', tab: 'clients' } });
    return sortRows(rows);
  }
  if (client.status === 'archived') {
    add({ id: 'client', level: 'blocker', title: 'Client', detail: `${name} is archived.`, fix: 'Restore it on Clients, or choose another client.', go: { label: 'Open Clients', tab: 'clients' } });
  } else {
    add({ id: 'client', level: 'pass', title: 'Client', detail: `${name} is active.` });
  }

  // -- the activities --------------------------------------------------------------------------
  // (The client's confidence check is not one of its activities: Phase 20.)
  const owned = sections.filter((section) => section.clientId === client.id && !isCheckActivity(section));
  const live = owned.filter((section) => section.enabled === true);
  if (live.length === 0) {
    add({ id: 'activities', level: 'blocker', title: 'Live activities',
      detail: owned.length === 0 ? `${name} has no activities.` : `${name} has ${owned.length} activit${owned.length === 1 ? 'y' : 'ies'}, none switched on.`,
      fix: owned.length === 0 ? 'Add activities under Content, then switch them on there.' : 'Switch at least one on under Content.',
      go: { label: 'Open Content', tab: 'content' } });
  } else {
    add({ id: 'activities', level: 'pass', title: 'Live activities', detail: `${live.length} activit${live.length === 1 ? 'y is' : 'ies are'} live: ${list(live.map((section) => section.title))}.` });
    if (live.length === 1) {
      add({ id: 'one-activity', level: 'warning', title: 'Only one activity', detail: `Participants will see a single activity (${live[0].title}).`,
        fix: 'Switch on another under Content if you want more.', go: { label: 'Open Content', tab: 'content' } });
    }
    const empty = live.filter((section) => (section.questionIds ?? []).length === 0);
    if (empty.length > 0) {
      add({ id: 'empty-activity', level: 'warning', title: 'Empty activity', detail: `${list(empty.map((section) => section.title))} ${empty.length === 1 ? 'is' : 'are'} live but ${empty.length === 1 ? 'has' : 'have'} no questions.`,
        fix: 'Add questions under Content, or switch it off there.', go: { label: 'Open Content', tab: 'content' } });
    }
  }

  // -- the questions ---------------------------------------------------------------------------
  const sectionOf = (question) => live.find((section) => (section.questionIds ?? []).includes(question.id))?.title ?? 'an activity';
  const optionsOf = (question) => options.filter((option) => option.questionId === question.id);
  const needsOptions = (question) => question.type !== 'open-text-feedback';
  const bare = questions.filter((question) => needsOptions(question) && optionsOf(question).length === 0);
  if (bare.length > 0) {
    add({ id: 'no-options', level: 'blocker', title: 'Answer options',
      detail: `${list(bare.map((question) => `${quoted(question.prompt)} (${sectionOf(question)})`), 2)} ${bare.length === 1 ? 'has' : 'have'} no answer options.`,
      fix: 'Open the question under Content and add its answers.', go: { label: 'Open Content', tab: 'content' } });
  }
  // (Until Phase 12 a single choice or true-or-false whose answers were all "not correct" was a blocker, "marked as graded but no answer
  // is marked correct". That is a poll: Content allows it for both types, the pager runs it as one, and on SharePoint every poll reads
  // back that way, because a Yes/No column keeps No for the null Content writes. So the rule could only ever stop Go live for a poll.)
  if (questions.length > 0 && bare.length === 0) {
    add({ id: 'questions', level: 'pass', title: 'Questions', detail: `${questions.length} question${questions.length === 1 ? '' : 's'} in the live activities, each with answers and a correct answer where it is graded.` });
  }

  // -- the session for this date ----------------------------------------------------------------
  if (!target && !mayPlan) {
    add({ id: 'session-none', level: 'blocker', title: 'Session', detail: `No session is planned for ${name} on ${date}.`,
      fix: 'An Admin plans sessions on the client\'s page under Clients. Ask one to plan this session.', go: { label: 'Open Clients', tab: 'clients' } });
  }
  if (target?.status === 'completed') {
    add({ id: 'session-ended', level: 'blocker', title: 'Session', detail: `The ${name} session for ${date} has ended.`,
      fix: 'Reopen it to use it again, or choose another date.', go: { label: 'Reopen session', action: 'reopen' } });
  }

  // -- warnings --------------------------------------------------------------------------------
  // (A drawn stand-in logo that older sample seeds wrote is not a logo: lib/brand/retired-logos.js.)
  const noLogo = !text(withoutRetiredLogo(client.logoUrl)) && !text(withoutRetiredLogo(client.theme?.assets?.logo)) && !text(client.theme?.assets?.hero);
  if (noLogo) {
    add({ id: 'logo', level: 'warning', title: 'Logo', detail: `${name} has no logo or hero image. A text plate with its name will show instead.`,
      fix: 'Upload a logo on Clients if you have one.', go: { label: 'Open Clients', tab: 'clients' } });
  }
  if (target?.participationMode === 'client-visit' && (roster ?? []).filter((guest) => guest.enabled !== false).length === 0) {
    add({ id: 'guests', level: 'warning', title: 'Guests', detail: 'Guests scan a personal QR is on, but no guests are added.',
      fix: 'Add their names under Guests and QR, or switch to Staff sign in.', go: { label: 'Open Guests and QR', tab: 'guests' } });
  }
  if (isStaffMode(target)) {
    add({ id: 'staff-signin', level: 'warning', title: 'Staff mode', detail: STAFF_MODE_WARNING,
      fix: 'Fine when every person signs in as themselves. Otherwise switch to Guests scan a personal QR under Controls once the session is live.' });
  }
  const clash = sessions.filter((session) => session.date === date && session.clientId !== client.id);
  if (clash.length > 0) {
    const names = unique(clash.map((session) => session.clientId)).map((id) => clients.find((entry) => entry.id === id)?.name ?? id);
    add({ id: 'same-date', level: 'warning', title: 'Another client on this date',
      detail: `${list(names)} already ${names.length === 1 ? 'has' : 'have'} a session on ${date}.`,
      fix: `Going live with ${name} replaces it for participants. Fine if that is the plan.` });
  }
  if (date !== today) {
    add({ id: 'date', level: 'warning', title: 'Date', detail: `${date} is not today (${today}).`,
      fix: 'Check the date. Participants see this client as soon as you go live, whatever the date.' });
  }
  return sortRows(rows);
}

function sortRows(rows) {
  return rows.map((row, index) => ({ row, index })).sort((a, b) => LEVEL_ORDER[a.row.level] - LEVEL_ORDER[b.row.level] || a.index - b.index).map(({ row }) => row);
}

/** Why Go live is disabled, in a sentence; null when it is not. @param {ReadinessRow[]} rows */
export function blockedReason(rows) {
  const blockers = rows.filter((row) => row.level === 'blocker');
  if (blockers.length === 0) return null;
  return blockers.length === 1 ? `Fix this first: ${blockers[0].title}.` : `Fix these first: ${blockers.map((row) => row.title).join(', ')}.`;
}

// ---- Switching away from a client that is live ---------------------------------------------------

/**
 * Does Go live need the facilitator to confirm? Yes when a different session is live and people have
 * joined it. Reopening or re-pressing the session that is already live never asks.
 * @param {{ status: { live: boolean, session: any }, participants: number, targetSessionId: string }} input
 */
export const needsSwitchConfirmation = ({ status, participants, targetSessionId }) =>
  status.live && status.session.id !== targetSessionId && participants > 0;

/**
 * The words of the confirmation. They describe what the participant page actually does (App.svelte's
 * watchTrack and followFacilitator, and activateClient), nothing more; a browser test holds them to it:
 *  - a page checks the facilitator's choice every 10 seconds while it is showing, and the moment a hidden
 *    one comes back, then moves to the new client's Welcome in the new client's look;
 *  - someone partway through an activity is taken out of it and starts again from Welcome;
 *  - answers already saved stay in the old session's results; the old session is not ended;
 *  - codes nobody scanned for the old session stop working.
 * @param {{ from: any, to: any, participants: number, fromSession: any, date: string }} input
 */
export function switchDialog({ from, to, participants, fromSession, date }) {
  const people = `${participants} participant${participants === 1 ? '' : 's'}`;
  const same = from.id === to.id;
  const old = same ? `The ${from.name} session for ${fromSession.date ?? 'the earlier date'}` : from.name;
  return {
    title: same ? `Switch ${from.name} to ${date}?` : `Switch from ${from.name} to ${to.name}?`,
    lead: `${old} is live now with ${people}.`,
    points: [
      `Pages that are already open move on by themselves: within about 25 seconds for someone on Welcome or the Activities hub, and within about a minute and a half for someone with a question on screen (a waiting page checks every 20 seconds, a page on a question once a minute). A hidden page checks as soon as it is shown again. They land on the ${same ? `Welcome screen for ${date}` : `${to.name} Welcome screen, in that client's colours`}.`,
      'Anyone partway through an activity is taken out of it and has to start again from Welcome.',
      `Answers already saved stay in the ${same ? 'earlier' : from.name} session and in its results. Nothing is deleted and that session is not ended. An answer given in the last moments, or while an iPad was offline, may not have been saved.`,
      `Visitor codes for ${same ? 'the earlier session' : from.name} that nobody has scanned yet stop working.`,
    ],
    confirm: same ? `Switch to ${date}` : `Switch to ${to.name}`,
  };
}
