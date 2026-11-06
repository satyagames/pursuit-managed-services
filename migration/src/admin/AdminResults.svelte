<script lang="ts">
  import { errorText } from '../lib/admin/session-notice.js';
  import { onMount, tick, untrack } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import Icon from './Icon.svelte';
  import Fold from './Fold.svelte';
  /** (Prompt 33) A session's status in words, not the stored word ("in-progress"). */
  const sessionWord = (status: string | null | undefined) => ({ 'in-progress': 'In progress', 'not-started': 'Not started', completed: 'Ended', planned: 'Planned', scheduled: 'Planned' } as Record<string, string>)[String(status)] ?? (status ? String(status) : 'Status unknown');
  import { restartClientTrack, getSessionResults, removeEmptyVisit } from '../lib/admin/adminData.js';
  import type { SessionResults, SessionTrack, SessionSection } from '../lib/admin/adminData.js';
  import { loadLiveStructure, readLive, type LiveStructure } from '../lib/admin/live-session.js';
  import { namesByVisit, unreadableNotice } from '../lib/results/unreadable.js';
  import { createPageWatcher, type PageWatcher } from '../lib/common/page-watch.js';
  import { adminDelay } from '../lib/common/poll-schedule.js';
  import { REMOVE_VISIT_CONFIRM, canRemoveVisit, forgetNameSources, glanceOf, holdNameSources, keepShownOrder, newestFirst, readNameSources, resultRows, rowsInOrder, rowsToLookForAgain, sessionsNeedingNames, type NameSources } from '../lib/admin/admin-results.js';
  import { answerCounts, answersFrom, answersOf, chartsOf, namesFor, picturesFor } from '../lib/results/results-chart-model.js';
  import GuestAvatar from '../components/GuestAvatar.svelte';
  import { DELETE_SESSION, cardCounts, deleteSessionData, deleteSessionWarning, deletedText, progressText, refusedText, stoppedText } from '../lib/admin/session-delete.js';
  import { focusHeading } from '../lib/common/focus.js';
  import { PER_PAGE, hashWithPage, pageOfHash, pageRows, pagerState } from '../lib/common/paging.js';
  import { RESULTS_INDEX } from '../lib/admin/list-index.js';
  import Pager from './Pager.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import ReportExports from './ReportExports.svelte';
  import ConfidenceShift from './ConfidenceShift.svelte';
  import ResultCard from './charts/ResultCard.svelte';
  import { can } from '../lib/access/can.js';
  import { reachOf, readQueries, sessionsFor } from '../lib/access/scope.js';

  type Session = { id: string; clientId: string; date?: string; sectionIds?: string[]; status?: string };
  type Client = { id: string; name: string };
  type Token = { id: string; sessionId: string; used?: boolean; expiredAt?: string | null };
  type TrackRow = { track: SessionTrack; name: string; unnamed: boolean; status: string; answered: number; total: number; pictureUrl?: string };
  type SessionCard = { results: SessionResults; owner: string; clientName: string; codes: string[]; tracks: TrackRow[]; unreadable: string; charts: ReturnType<typeof chartsOf> };

  let { access = null, onToast, onLiveDisplay, hideNames = false, mayName = true, onHideNames = () => {} }: {
    /** The signed-in person's access (Phase 4): the sessions listed are those they hold, and a button shows only for an action their role has on that session. */
    access?: any;
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
    /** Opens the Live display (and the exports) for a session. */
    onLiveDisplay: (sessionId: string) => void;
    /** Results' one Hide names switch (Prompt 21, Phase 6; decision B, ResultsTab): every row, chart and export names Guest 1, Guest 2 ... */
    hideNames?: boolean;
    /** Whether the role may see names at all (results.names): without it the switch is not offered and names stay hidden. */
    mayName?: boolean;
    onHideNames?: (on: boolean) => void;
  } = $props();
  /** The cards opened so far, in memory: a card keeps its numbers when the person pages away and back. */
  let cards = $state<SessionCard[]>([]);
  /** Every session the person may read, newest first (the index, Prompt 26): five to a page, and a session's answers are read when its card is opened. */
  let sessionRows = $state.raw<Session[]>([]);
  let opening = $state<string[]>([]);
  let page = $state(pageOfHash(window.location.hash));
  const where = $derived(pagerState({ total: sessionRows.length, pageSize: PER_PAGE.sessions, page }));
  const visible = $derived(pageRows(sessionRows, where));
  // Prompt 34: the page's sessions are one list on the left, and the session chosen is shown on the right, one at a time (the newest opens by
  // itself). A session read once keeps its card in memory, so choosing it again reads nothing.
  const opened = $derived(visible.filter((row) => cards.some((card) => card.results.session.id === row.id)));
  /** The session the person chose in the list (null: the first one read on this page). */
  let chosenId = $state<string | null>(null);
  const shownId = $derived(chosenId && visible.some((row) => row.id === chosenId) ? chosenId : (opened[0]?.id ?? null));
  const shownCard = $derived(shownId ? cards.find((card) => card.results.session.id === shownId) ?? null : null);
  let loading = $state(true);
  let error = $state('');
  let updated = $state('');
  /** The sessions whose charts the person folded (Prompt 34: the charts are open, unless folded). */
  let shutResults = $state<string[]>([]);
  /** Each chart's open answer (its names) or chosen word, by session and question: a refresh keeps them. In memory only. */
  let chosen = $state<Record<string, string | null>>({});
  let restartTrack = $state<TrackRow | null>(null);
  let restartSectionId = $state<string | null | undefined>(undefined);
  /** The id of the Restart form (one is open at a time). */
  const RESTART_FORM = 'restart-form';
  /** The card whose row holds the open Restart form: a visit is one row of one card, so the form opens under that row only. */
  let restartIn = $state<string | null>(null);
  let busy = $state(false);
  /** The session whose data the person is about to delete (Phase 16): the numbers the warning shows, and where the delete has got to. */
  type Deleting = { card: SessionCard; counts: ReturnType<typeof cardCounts>; working: boolean; status: string; error: string; failed: boolean };
  let deleting = $state<Deleting | null>(null);
  let pageHeading = $state<HTMLElement>();
  let active = false;
  let refreshing = false;
  let requestVersion = 0;

  // How this screen keeps up (Phase 7; Prompt 26: only the sessions opened). A session is read in full when its card opens, on Refresh and after a restart (5 requests a session on
  // SharePoint since Phase 9b: the session, its visits and its answers, then its activities, then their questions and options in groups of 20). What changes while it is open is the session that is LIVE, so on SharePoint only that one is refreshed on the timer, with
  // the same one-request feed the Live display uses (lib/admin/live-session.js), every 15 seconds and never while the tab is hidden. The local
  // server has no throttle, so it still refreshes everything every 2.5 seconds.
  const local = !dataService.isSharePointMode();
  const LIVE_REFRESH_MS = 15_000;
  let liveHeld: LiveStructure | null = null;
  let namesHeld = $state.raw(new Map<string, string>());
  let tokensHeld: Token[] = [];
  let settingsHeld: { activeSessionId?: string | null } | null = null;
  // A person is named by lib/results/participant-names.js, the rule the leader report uses, so the screen and the PDF agree. A track carries a
  // guest's QR name itself; a staff sign-in name is in the session's visit log and a roster name in its roster, which are read with
  // the session (only for a session with a track that has no name of its own) and again, for the live session, when somebody who joined in
  // the last two minutes is still unnamed (rowsToLookForAgain: twice for each person at most, because a page records a sign-in a moment
  // after its first screen).
  let sourcesHeld = $state.raw(new Map<string, NameSources>());
  const lookedFor = new Map<string, number>();
  let watcher: PageWatcher | undefined;
  let refreshAll = () => {};

  onMount(() => {
    active = true;

    async function refresh(manual = false) {
      if (refreshing || busy) return;
      refreshing = true;
      const version = requestVersion + 1;
      try {
        if (local || manual || cards.length === 0) await refreshNow();
        else if (liveHeld) await refreshLive();
        // else nothing is live, so nothing changes by itself: Refresh reads every session again.
      } catch (cause) {
        if (active && version === requestVersion) error = errorText(cause, 'Could not load results.');
        throw cause;
      } finally {
        refreshing = false;
        if (active) loading = false;
      }
    }

    refreshAll = () => { void refresh(true).catch(() => {}); };
    watcher = createPageWatcher({
      check: async () => { await refresh(); return { requests: 1 }; },
      local,
      wait: ({ requests, failures, retryAfterMs, local: onLocal }) => adminDelay({ sharePointMs: LIVE_REFRESH_MS, localMs: 2500, local: onLocal, requests, failures, retryAfterMs }),
    });
    void refresh().catch(() => {}).finally(() => watcher?.start());
    return () => { active = false; requestVersion += 1; watcher?.stop(); watcher = undefined; };
  });

  /** A change of page: kept in the address; the first card of a page opens by itself. Nothing already opened is read again. */
  function goToPage(next: number) {
    page = next;
    try { window.history.replaceState(window.history.state, '', hashWithPage(window.location.hash, next)); } catch { /* the page still changes */ }
    const first = pageRows(sessionRows, pagerState({ total: sessionRows.length, pageSize: PER_PAGE.sessions, page: next }))[0];
    if (first) void choose(first.id);
  }

  function statusText(status: string) {
    return status === 'in-progress' ? 'In progress' : status === 'completed' ? 'Completed' : status === 'used' ? 'Scanned' : status === 'expired' ? 'Expired' : status === 'unused' ? 'Unused' : status === 'unreadable' ? 'Answers unreadable' : 'Not started';
  }

  function statusClass(status: string) {
    return `pill pill--${status}`;
  }

  /** A session chosen in the list: shown at once if it was read before, otherwise read first (the page says so meanwhile). */
  async function choose(id: string) {
    chosenId = id;
    await openCard(id);
  }

  /** "60 answers", for a session's line in the list (once it has been read). */
  function answersOnly(card: SessionCard) {
    const { answers } = answerCounts(card.results.sections.flatMap((section) => section.questions));
    return `${answers} ${answers === 1 ? 'answer' : 'answers'}`;
  }

  function counts(codes: string[]) {
    const count = (status: string) => codes.filter((value) => value === status).length;
    return `${count('unused')} unused · ${count('used')} scanned · ${count('expired')} expired`;
  }

  /**
   * Restart... opens its form under the iPad's own row (Phase 16: it opened at the foot of the page), one at a time; pressed again, it closes.
   * Focus goes to the first choice, and back to the row's Restart... button when the form closes.
   */
  function openRestart(row: TrackRow, sessionId: string) {
    if (restartTrack?.track.id === row.track.id && restartIn === sessionId) { closeRestart(); return; }
    restartTrack = row;
    restartIn = sessionId;
    restartSectionId = undefined;
    void tick().then(() => {
      const form = document.getElementById(RESTART_FORM);
      form?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      form?.querySelector<HTMLElement>('input')?.focus({ preventScroll: true });
    });
  }

  function closeRestart() {
    const id = restartTrack?.track.id;
    const sessionId = restartIn;
    restartTrack = null;
    restartIn = null;
    restartSectionId = undefined;
    if (id && sessionId) void focusRestartButton(id, sessionId);
  }

  async function focusRestartButton(trackId: string, sessionId: string) {
    await tick();
    document.querySelector<HTMLElement>(`article[data-session="${CSS.escape(sessionId)}"] [data-restart="${CSS.escape(trackId)}"]`)?.focus();
  }

  function answeredIn(trackId: string, section: SessionSection) {
    return section.questions.filter((question) => question.responses.some((response) => dataService.responseOwner(response) === trackId)).length;
  }

  /** Removes a visit that has no answers (Phase 9b, DI-9). The data service reads its answers again first and refuses, in words, if one has arrived. */
  async function removeVisit(row: TrackRow) {
    if (busy || !window.confirm(REMOVE_VISIT_CONFIRM)) return;
    busy = true;
    requestVersion += 1;
    try {
      await removeEmptyVisit(row.track.id);
      if (!active) return;
      onToast(`${row.name} removed`, 'success');
    } catch (cause) {
      if (active) onToast(cause instanceof Error ? cause.message : 'Could not remove this visit.', 'error');
    } finally {
      busy = false;
    }
    // Whatever happened, show what is there now: a visit that gained an answer, or was already gone.
    if (active) await refreshNow().catch((cause) => { error = errorText(cause, 'Could not load results.'); });
  }

  /** Opens the warning. Nothing is read or written: the numbers are the card's, and they are read again when the person confirms. */
  function openDelete(card: SessionCard) {
    if (busy) return;
    deleting = { card, counts: cardCounts(card), working: false, status: '', error: '', failed: false };
  }

  function closeDelete() {
    if (!deleting || deleting.working) return;
    const id = deleting.card.results.session.id;
    deleting = null;
    void tick().then(() => document.querySelector<HTMLElement>(`article[data-session="${CSS.escape(id)}"] [data-delete-session]`)?.focus());
  }

  /** What the screen holds of a session that has gone: its card, its open panel, its chosen answers and its names. */
  function forgetSession(id: string) {
    cards = cards.filter((card) => card.results.session.id !== id);
    sessionRows = sessionRows.filter((session) => session.id !== id);
    shutResults = shutResults.filter((shut) => shut !== id);
    chosen = Object.fromEntries(Object.entries(chosen).filter(([key]) => !key.startsWith(`${id}/`)));
    sourcesHeld = new Map([...sourcesHeld].filter(([sessionId]) => sessionId !== id));
    forgetNameSources(id);
  }

  /**
   * Deletes the session's data for good (Phase 16), once, from the confirming button only: lib/admin/session-delete.js reads it all again first and
   * refuses the live session and numbers that changed while the dialog was open. A delete that stops part way keeps the card, says what is left, and
   * the button becomes Try again, which removes only what is left.
   */
  async function confirmDelete() {
    const held = deleting;
    if (!held || held.working || busy) return;
    const session = held.card.results.session;
    const label = { clientName: held.card.clientName || held.card.owner, date: session.date };
    const at = visible.findIndex((row) => row.id === session.id);
    deleting = { ...held, working: true, error: '', status: '' };
    busy = true;
    requestVersion += 1;
    let refresh = false;
    let gone = false;
    try {
      // (Try again, after a delete that stopped part way, removes what is left: the person has confirmed, and the numbers are smaller now.)
      const result = await deleteSessionData(session.id, { expected: held.failed ? null : held.counts, onProgress: (step) => { if (deleting) deleting = { ...deleting, status: progressText(step) }; } });
      if (!active) return;
      if (result.left > 0) {
        deleting = { ...held, working: false, failed: true, status: '', error: result.refused ? refusedText(result.refused) : stoppedText(result.left) };
        refresh = true;
      } else gone = true;
    } catch (cause) {
      if (!active) return;
      const failure = cause as { code?: string; counts?: Deleting['counts']; message?: string };
      // Numbers that changed while the dialog was open: the new ones are shown, and the person presses again.
      deleting = { ...held, ...(failure.code === 'session-changed' && failure.counts ? { counts: failure.counts } : {}), working: false, status: '', failed: failure.code !== 'session-changed' && failure.code !== 'session-live', error: failure.message || 'Could not delete this session.' };
      refresh = failure.code !== 'session-changed' && failure.code !== 'session-live';
    } finally {
      busy = false;
    }
    if (gone && active) {
      for (const track of held.card.results.tracks) lookedFor.delete(track.id);
      forgetSession(session.id);
      deleting = null;
      onToast(deletedText(label), 'success');
      await tick();
      // (Prompt 34: the session that took its place in the list is shown, and its title takes the focus.)
      const nextRow = visible[Math.min(at, visible.length - 1)];
      if (nextRow) await choose(nextRow.id);
      await tick();
      const next = nextRow ? document.querySelector<HTMLElement>(`article[data-session="${CSS.escape(nextRow.id)}"] [data-card-title]`) ?? undefined : undefined;
      focusHeading(next ?? pageHeading);
    }
    // What is there now, after a delete that stopped: the card stays, with what is left.
    if (refresh && active) await refreshNow().catch(() => {});
  }

  async function confirmRestart() {
    if (!restartTrack || restartSectionId === undefined || busy) return;
    const targetName = restartTrack.name;
    const targetId = restartTrack.track.id;
    const targetIn = restartIn;
    busy = true;
    requestVersion += 1;
    try {
      const result = await restartClientTrack(restartTrack.track.id, { sectionId: restartSectionId });
      if (!active) return;
      restartTrack = null;
      restartIn = null;
      restartSectionId = undefined;
      onToast(`${targetName} restarted · ${result.removed} answers removed`, 'success');
      await refreshNow();
      if (targetIn) void focusRestartButton(targetId, targetIn);
    } catch (cause) {
      if (active) onToast(cause instanceof Error ? cause.message : 'Could not restart this track.', 'error');
    } finally {
      busy = false;
    }
  }

  // The Hide names switch turned: every card is named again from what it already holds (no request).
  let namedHidden: boolean | null = null;
  $effect(() => {
    const hide = hideNames;
    untrack(() => {
      if (namedHidden !== null && namedHidden !== hide) cards = cards.map((card) => cardOf(card.results));
      namedHidden = hide;
    });
  });

  /** Each visit's guest group, for the Group filter of an Art of the Possible question (Prompt 23); none until the session's roster has been read. */
  function groupsOf(result: SessionResults, sources: NameSources | undefined) {
    const groupOf = new Map((sources?.roster ?? []).map((visitor: { id: string; guestGroup?: string | null }) => [String(visitor.id), visitor.guestGroup ?? '']));
    const hasGroups = [...groupOf.values()].some(Boolean);
    return hasGroups ? new Map(result.tracks.map((track: { id: string; visitorId?: string | null }) => [String(track.id), groupOf.get(String(track.visitorId ?? '')) ?? ''])) : null;
  }

  /**
   * The Live results of a session opened (Prompt 23): a guest's picture and group are on the session's roster, which Results otherwise reads only for a track with no name of its own. It is read
   * here, once, only for someone who may see names with Hide names off, and only when a guest has joined. One request more, and only for this; a session of staff is not asked.
   */
  async function readRosterForFaces(id: string) {
    if (!mayName || hideNames || sourcesHeld.has(id)) return;
    const card = cards.find((each) => each.results.session.id === id);
    if (!card?.results.tracks.some((track: { visitorId?: string | null }) => track.visitorId)) return;
    const found = await readNameSources([id]).catch(() => null);
    if (!active || !found) return;
    sourcesHeld = new Map(sourcesHeld).set(id, found.get(id) ?? { visits: [], roster: [] });
    cards = cards.map((each) => (each.results.session.id === id ? cardOf(each.results) : each));
  }

  /** One session's card, from its results: each iPad's row, its status, and the codes. */
  function cardOf(result: SessionResults): SessionCard {
    const sources = sourcesHeld.get(result.session.id);
    // (Phase 16: the newest joiner first, lib/admin/admin-results.js ROW_ORDER; the names are the report's, worked out in the order they joined.)
    const tracks = rowsInOrder(resultRows(result, sources, { hide: hideNames }));
    // The charts of the session's live activities (Phase 11a), with each answer's names: the same rule as the rows, over what was read for them.
    const charts = chartsOf({ tracks: result.tracks, sections: result.sections.filter((section) => section.enabled) }, { pictures: picturesFor({ tracks: result.tracks, ...(sources ?? {}) }, { hide: hideNames }), groups: groupsOf(result, sources), names: namesFor({ tracks: result.tracks, answers: answersOf(result), ...(sources ?? {}) }, { hide: hideNames }) });
    // What could not be read (Phase 9b, DI-6), said beside the export buttons, with each person's name the way their row has it.
    return { results: result, owner: namesHeld.get(result.session.clientId) ?? result.session.clientId, clientName: namesHeld.get(result.session.clientId) ?? '', codes: tokensHeld.filter((token) => token.sessionId === result.session.id).map((token) => token.expiredAt ? 'expired' : token.used ? 'used' : 'unused'), tracks, unreadable: unreadableNotice(result.unreadable, namesByVisit(tracks)), charts };
  }

  /** The sessions and clients the person may read, and the settings: the index for a global role, the places held for a scoped one (lib/access/scope.js). */
  async function readBasics(): Promise<[Session[], Client[], { activeSessionId?: string | null } | null]> {
    const reach = access ? reachOf(access) : null;
    const settingsRead = local ? Promise.resolve(null) : dataService.getAppSettings() as Promise<{ activeSessionId?: string | null } | null>;
    if (!reach || reach.all) {
      const [sessions, clients] = await dataService.readLists(RESULTS_INDEX as never) as unknown as [Session[], Client[]];
      return [sessions, clients, await settingsRead];
    }
    const wantedSessions = readQueries(reach, 'sessions');
    const wantedClients = readQueries(reach, 'clients');
    const answers = await dataService.readLists([...wantedSessions, ...wantedClients]) as unknown as unknown[][];
    const sessions = sessionsFor(access, answers.slice(0, wantedSessions.length).flat() as Session[]);
    const clients = answers.slice(wantedSessions.length).flat() as Client[];
    return [sessions, clients, await settingsRead];
  }

  /** Whether this role may do an action to a session (a role with no access, before there were roles, may do all). */
  const may = (action: string, session: Session) => !access || can(access, action, { clientId: session.clientId, sessionId: session.id, date: session.date });

  /** A card is opened: its session is read in full, with its codes and any names not on a track. */
  async function openCard(id: string) {
    if (opening.includes(id) || cards.some((card) => card.results.session.id === id)) return;
    opening = [...opening, id];
    try {
      const version = requestVersion;
      await readCards(sessionRows.filter((session) => session.id === id), settingsHeld, version);
    } catch (cause) {
      if (active) error = errorText(cause, 'Could not load results.');
    } finally {
      opening = opening.filter((each) => each !== id);
    }
  }

  /** Everything, from the start: the list of sessions, and in full the cards already open and the first card of the page (and the live session, when it is on the page). */
  async function refreshNow() {
    const version = ++requestVersion;
    const [sessions, clients, settings] = await readBasics();
    if (!active || version !== requestVersion) return;
    namesHeld = new Map(clients.map((client) => [client.id, client.name]));
    settingsHeld = settings;
    // Newest first (Phase 16), and a session already on the screen keeps its place: a refresh never moves one under the person's hands.
    const wrapped = sessions.map((session) => ({ results: { session } }));
    sessionRows = keepShownOrder(sessionRows.map((session) => session.id), newestFirst(wrapped, (each) => each.results), (each) => each.results).map((each) => each.results.session) as Session[];
    const shown = pageRows(sessionRows, pagerState({ total: sessionRows.length, pageSize: PER_PAGE.sessions, page }));
    const wanted = new Set([...cards.map((card) => card.results.session.id), ...shown.slice(0, 1).map((session) => session.id), ...shown.filter((session) => session.id === settings?.activeSessionId).map((session) => session.id)]);
    cards = cards.filter((card) => sessions.some((session) => session.id === card.results.session.id));
    await readCards(sessionRows.filter((session) => wanted.has(session.id)), settings, version);
    updated = `Updated ${new Date().toLocaleTimeString()}`;
    error = '';
  }

  /** `sessions` in full, as cards, over what is held. The live one is read the lean way, so the timer can carry on from it. */
  async function readCards(sessions: Session[], settings: { activeSessionId?: string | null } | null, version: number) {
    if (!sessions.length) return;
    let held: LiveStructure | null = null;
    const ids = sessions.map((session) => session.id);
    const tokenReads: Promise<unknown>[] = [];
    for (let at = 0; at < ids.length; at += 15) tokenReads.push(dataService.readLists([{ list: 'qrtokens', where: { sessionId: ids.slice(at, at + 15) } }]));
    const tokens = (await Promise.all(tokenReads) as Token[][][]).flatMap(([rows]) => rows);
    const results = (await Promise.all(sessions.map(async (session) => {
      if (!local && settings?.activeSessionId === session.id) {
        const opened = await loadLiveStructure(session.id);
        if (opened) {
          const read = await readLive(opened);
          if (!read.gone) { held = read.structure; return read.results; }
        }
      }
      return getSessionResults(session.id);
    }))).filter(Boolean) as SessionResults[];
    if (!active || version !== requestVersion) return;
    // The names that are not on a track: one more request (two lists side by side) for every session that needs them, none otherwise.
    const needing = sessionsNeedingNames(results);
    const sources = await readNameSources(needing);
    if (!active || version !== requestVersion) return;
    tokensHeld = [...tokensHeld.filter((token) => !ids.includes(token.sessionId)), ...tokens];
    sourcesHeld = new Map([...sourcesHeld, ...sources]);
    holdNameSources(sources);
    for (const result of results) if (needing.includes(result.session.id)) for (const track of result.tracks) if (!track.participantName?.trim()) lookedFor.set(track.id, Math.max(lookedFor.get(track.id) ?? 0, 1));
    if (held || ids.includes(settings?.activeSessionId ?? '')) liveHeld = held;
    const made = results.map(cardOf);
    cards = [...cards.filter((card) => !made.some((each) => each.results.session.id === card.results.session.id)), ...made];
  }

  /** The timer's refresh on SharePoint: the live session alone, one request. Everything is read again when it has gone. */
  async function refreshLive() {
    const version = ++requestVersion;
    const held = liveHeld;
    if (!held) return refreshNow();
    const read = await readLive(held);
    if (!active || version !== requestVersion) return;
    if (read.gone) { await refreshNow(); return; }
    liveHeld = read.structure;
    const id = read.results.session.id;
    const waiting = rowsToLookForAgain(resultRows(read.results, sourcesHeld.get(id)), lookedFor);
    if (waiting.length > 0) {
      const found = await readNameSources([id]);
      if (!active || version !== requestVersion) return;
      sourcesHeld = new Map(sourcesHeld).set(id, found.get(id) ?? { visits: [], roster: [] });
      holdNameSources(new Map([[id, sourcesHeld.get(id) ?? { visits: [], roster: [] }]]));
      for (const row of waiting) lookedFor.set(row.track.id, (lookedFor.get(row.track.id) ?? 0) + 1);
    }
    cards = cards.map((card) => (card.results.session.id === id ? cardOf(read.results) : card));
    updated = `Updated ${new Date().toLocaleTimeString()}`;
    error = '';
  }

</script>

<section class="panel sessions-panel" aria-busy={loading || busy}>
  <header class="panel__head"><div><h2 bind:this={pageHeading} tabindex="-1"><Icon name="chart" />Results</h2><p class="muted">How each session went: open one for its charts, the people who took part and the reports for leaders.</p></div><span class="muted">{updated}{updated ? ' · ' : ''}the live session refreshes every {local ? 'few seconds' : '15 seconds'}</span><div class="results-actions">{#if mayName}<label class="choice"><input type="checkbox" checked={hideNames} onchange={(event) => onHideNames((event.currentTarget as HTMLInputElement).checked)} /><span>Hide names</span></label>{/if}<button class="btn btn--small" type="button" onclick={() => refreshAll()} disabled={busy}>Refresh</button></div></header>
  {#if loading}<p role="status">Loading results...</p>
  {:else if error}<p class="error" role="alert">{error}</p>
  {:else if sessionRows.length === 0}<p class="muted">No sessions yet.</p>
  {:else}
    <div class="results-layout">
      <nav class="session-list" aria-label="Sessions">
        <ul class="session-list__items">
          {#each visible as row (row.id)}
            {@const held = cards.find((card) => card.results.session.id === row.id)}
            <li>
              <button class="session-list__item" type="button" data-open-session={row.id} aria-current={row.id === shownId ? 'true' : undefined} onclick={() => void choose(row.id)}>
                <span class="session-list__name">{namesHeld.get(row.clientId) ?? row.clientId}</span>
                <span class="session-list__meta">{[row.date ?? '', sessionWord(row.status), held ? answersOnly(held) : ''].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          {/each}
        </ul>
        <Pager state={where} label="Pages of sessions" heading={pageHeading} onPage={goToPage} />
      </nav>
      <div class="results-layout__session">
        {#if shownCard}{@render sessionCard(shownCard)}
        {:else if shownId || opening.length}<p class="muted" role="status">Loading this session...</p>{/if}
      </div>
    </div>
  {/if}

  {#if deleting}
    {@const warning = deleteSessionWarning({ clientName: deleting.card.clientName || deleting.card.owner, date: deleting.card.results.session.date, status: deleting.card.results.session.status }, deleting.counts)}
    <ConfirmDialog title={DELETE_SESSION.title} lead={warning.lead} points={warning.points} confirmLabel={deleting.failed ? DELETE_SESSION.retry : DELETE_SESSION.confirm} cancelLabel={DELETE_SESSION.cancel}
      tone="danger" busy={deleting.working} status={deleting.status} error={deleting.error} onConfirm={() => void confirmDelete()} onCancel={closeDelete}>
      <div class="delete-keep">
        <p class="muted">{DELETE_SESSION.keepFirst}</p>
        <ReportExports sessionId={deleting.card.results.session.id} clientName={deleting.card.clientName} {hideNames} {onToast} />
      </div>
    </ConfirmDialog>
  {/if}

</section>

<!-- The session chosen (Prompt 34): its head and Live display; four figures; Downloads; the charts, open; the people, folded; Delete at the foot. -->
{#snippet sessionCard(card: SessionCard)}
      {@const session = card.results.session}
      {@const answered = answerCounts(card.results.sections.flatMap((section) => section.questions))}
      <article class="card" data-session={session.id} aria-busy={deleting?.working && deleting.card.results.session.id === session.id}>
        <header class="card__head">
          <strong class="session__title" data-card-title tabindex="-1">{card.owner}</strong><span class="muted">{session.date ?? ''}</span><span class="tag">{sessionWord(session.status)}</span><span class="card__spacer"></span>
          {#if may('results.live', session)}<button class="btn btn--small session__live" type="button" onclick={() => onLiveDisplay(session.id)}><Icon name="screen" size={18} />Live display</button>{/if}
        </header>
        <ul class="glance" aria-label="At a glance">
          {#each glanceOf(card.tracks, answered) as each (each.key)}<li class="glance__item" data-glance={each.key}><span class="glance__figure">{each.figure}</span><span class="glance__label">{each.label}</span></li>{/each}
        </ul>
        {#if card.unreadable}<p class="notice card__unreadable" role="status" data-testid="unreadable-notice"><strong>{card.unreadable}</strong></p>{/if}
        {#if may('results.export', session)}<ReportExports sessionId={session.id} clientName={card.clientName} {hideNames} {onToast} />{/if}
        <!-- (Phase 12, F-08: the charts before the people. Prompt 34: open unless folded, the confidence check first.) -->
        <details class="tally" open={!shutResults.includes(session.id)} ontoggle={(event) => { const isOpen = (event.currentTarget as HTMLDetailsElement).open; if (isOpen) void readRosterForFaces(session.id); shutResults = isOpen ? shutResults.filter((id) => id !== session.id) : [...new Set([...shutResults, session.id])]; }}>
          <summary>Charts · {answersFrom(answered)}</summary>
          {#if !shutResults.includes(session.id)}
            <div class="tally__charts">
              {#if card.results.confidenceCheck}<ConfidenceShift check={card.results.confidenceCheck} />{/if}
              {#each card.charts as section (section.id)}
                <h3 class="tally__section">{section.title}</h3>
                <div class="tally__grid">
                  {#each section.charts as chart (chart.id)}
                    <ResultCard {chart} withNames marked selected={chosen[`${session.id}/${chart.id}`] ?? null} onSelect={(id) => { chosen = { ...chosen, [`${session.id}/${chart.id}`]: id }; }} level={4} />
                  {/each}
                </div>
              {/each}
            </div>
          {/if}
        </details>
        <!-- (Prompt 33: the people who took part are folded under the charts, closed on every visit; Prompt 34: the QR codes' count beside them.) -->
        <Fold title="People" icon="people" summary={[card.tracks.length === 1 ? '1 person' : `${card.tracks.length} people`, card.codes.length ? `QR codes: ${counts(card.codes)}` : ''].filter(Boolean).join(' · ')} testid="participant-details">
          {#if card.tracks.length === 0}<p class="card__note muted">No one has joined yet: people appear here as their iPads open the session.</p>
          {:else}
            <ul class="rows rows--flat">
              {#each card.tracks as row (row.track.id)}
                {@const notes = `${row.answered} of ${row.total} questions answered · joined ${row.track.createdAt ? new Date(row.track.createdAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) : ''} via ${row.track.joinedVia === 'qr' ? 'QR code' : 'the participant link'}${row.track.resumeCount ? ` · resumed ${row.track.resumeCount}×` : ''}${row.track.restartedAt ? ` · restarted ${new Date(row.track.restartedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}` : ''}`}
                {@const restarting = restartTrack?.track.id === row.track.id && restartIn === session.id}
                <li class="row" class:row--open={restarting}>
                  {#if sourcesHeld.has(session.id)}<GuestAvatar src={row.pictureUrl ?? null} size={40} />{/if}<div class="row__main"><span class="row__title">{row.name}</span><span class="muted">{notes}</span></div>
                  <span class={statusClass(row.status)}>{statusText(row.status)}</span>
                  {#if canRemoveVisit(row, session)}{#if may('events.run', session)}<button class="btn btn--small" type="button" onclick={() => void removeVisit(row)} disabled={busy}>Remove...</button>{/if}{/if}
                  {#if may('events.run', session)}<button class="btn btn--small" type="button" data-restart={row.track.id} aria-expanded={restarting} aria-controls={restarting ? RESTART_FORM : undefined} onclick={() => openRestart(row, session.id)} disabled={busy || row.status === 'unreadable'} title={row.status === 'unreadable' ? `Its saved answers cannot be read, so they cannot be restarted. Correct or delete the damaged item in the ${dataService.sharePointListTitles().responses} list.` : undefined}>Restart...</button>{/if}
                  {#if restarting && restartTrack}{@render restartForm(restartTrack)}{/if}
                </li>
              {/each}
            </ul>
          {/if}
        </Fold>
        <!-- (Phase 16: Delete opens a warning; only its "Delete permanently" deletes. Prompt 34: at the foot of the session, away from Live display and the files.) -->
        {#if may('results.delete', session)}<footer class="card__foot"><button class="btn btn--small btn--danger" type="button" data-delete-session onclick={() => openDelete(card)} disabled={busy}>{DELETE_SESSION.button}</button></footer>{/if}
      </article>
{/snippet}

<!-- The Restart form, under the row of the iPad it restarts (Phase 16). Escape closes it, as Cancel does. -->
{#snippet restartForm(target: TrackRow)}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions (Escape is a shortcut for Cancel; the button stays the way to do it) -->
  <section class="content-editor restart-inline" id={RESTART_FORM} aria-labelledby="restart-title" onkeydown={(event) => { if (event.key === 'Escape' && !busy) { event.preventDefault(); closeRestart(); } }}>
    <h3 id="restart-title">Restart {target.name}</h3>
    <p class="muted">Choose the restart point. Only this track's answers from that point are removed.</p>
    <fieldset class="field">
      <legend class="field__label">Restart from</legend>
      <label class="choice"><input type="radio" name="restart-from" checked={restartSectionId === null} onchange={() => { restartSectionId = null; }} /><span>The very beginning</span><span class="muted small">removes all of its answers</span></label>
      {#each target.track.sessionId ? cards.find((card) => card.results.session.id === target.track.sessionId)?.results.sections ?? [] : [] as section (section.id)}
        <label class="choice"><input type="radio" name="restart-from" checked={restartSectionId === section.id} onchange={() => { restartSectionId = section.id; }} /><span>{section.title}</span><span class="muted small">{answeredIn(target.track.id, section)} of {section.questions.length} answered{section.enabled ? '' : ' · not live'}</span></label>
      {/each}
    </fieldset>
    <div class="dialog__actions"><button class="btn" type="button" onclick={closeRestart} disabled={busy}>Cancel</button><button class="btn btn--danger" type="button" onclick={() => void confirmRestart()} disabled={busy || restartSectionId === undefined}>{busy ? 'Restarting...' : 'Restart'}</button></div>
  </section>
{/snippet}

<style>
  /* (Phase 6) Hide names and Refresh as one group, so the time beside them, which changes as the live session refreshes, never moves them. */
  .results-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }

  /* Each session card's "Live results" (Phase 11a): the charts of admin/charts/ResultCard.svelte, a grid of cards under each activity. Here and not in
     src/admin.css, which the Setup page loads too. */
  /* (Phase 16) The row of the iPad being restarted holds its form under it: the row wraps, and the form takes the whole width. */
  .row--open {
    flex-wrap: wrap;
  }

  .restart-inline {
    flex: 1 0 100%;
    margin-top: 0.75rem;
  }

  .delete-keep {
    display: grid;
    gap: 0.4rem;
  }

  .delete-keep p {
    margin: 0;
  }

  .tally__charts {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.5rem 1rem 1.25rem;
  }

  .tally__section {
    margin: 0.5rem 0 0;
    font-size: 1.1rem;
  }

  /* Each card keeps its own height, at the top of its row (Phase 11a-2: a card stretched to the height of its neighbour whose names were open). */
  .tally__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr));
    align-items: start;
    gap: 1rem;
  }

  /* Prompt 34: the sessions of the page one list, and the session chosen beside it on a laptop (above it, narrower than 1,100 px). */
  .results-layout {
    display: grid;
    gap: 1rem;
    align-items: start;
  }

  .session-list {
    display: grid;
    gap: 0.75rem;
    min-width: 0;
  }

  .session-list__items {
    display: grid;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .session-list__item {
    display: grid;
    gap: 0.15rem;
    width: 100%;
    min-height: 44px;
    padding: 0.65rem 0.9rem;
    border: 1px solid var(--adm-line);
    border-left: 4px solid transparent;
    border-radius: 0;
    background: var(--adm-card);
    color: var(--adm-ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .session-list__item:hover {
    background: var(--adm-wash);
  }

  .session-list__item[aria-current='true'] {
    border-left-color: var(--adm-green);
    background: var(--adm-green-wash);
  }

  .session-list__name {
    font-weight: 600;
  }

  .session-list__meta {
    color: var(--adm-muted);
    font-size: 1rem;
  }

  .results-layout__session {
    min-width: 0;
  }

  .results-layout__session :global(.card) {
    margin: 0;
  }

  .results-layout__session > :global(article) {
    display: grid;
    gap: 1rem;
    padding-bottom: 1rem;
  }

  .results-layout__session > :global(article > :not(.card__head)) {
    margin-inline: 1rem;
  }

  .session__title {
    font-size: 1.25rem;
  }

  .session__live {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  /* The four figures: joined, answered, answers, finished every activity. */
  .glance {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr));
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .glance__item {
    display: grid;
    gap: 0.1rem;
    padding: 0.75rem 1rem;
    border-left: 4px solid var(--adm-lime);
    background: var(--adm-wash);
  }

  .glance__figure {
    color: var(--adm-ink);
    font-size: 1.75rem;
    font-weight: 700;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }

  .glance__label {
    color: var(--adm-muted);
    font-size: 1rem;
  }

  .card__foot {
    display: flex;
    justify-content: flex-end;
    padding-top: 0.75rem;
    border-top: 1px solid var(--adm-line);
  }

  @media (min-width: 1100px) {
    .results-layout {
      grid-template-columns: minmax(14rem, 18rem) minmax(0, 1fr);
    }
  }

  @media (min-width: 1100px) {
    .tally__grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (min-width: 1600px) {
    .tally__grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>
