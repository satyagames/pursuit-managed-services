<script lang="ts">
  import { onMount } from 'svelte';
  import * as dataService from '../../../public/js/dataService.js';
  import { restartClientTrack, getSessionResults, removeEmptyVisit } from '../lib/adminData.js';
  import type { SessionResults, SessionTrack, SessionSection } from '../lib/adminData.js';
  import { loadLiveStructure, readLive, type LiveStructure } from '../lib/live-session.js';
  import { namesByVisit, unreadableNotice } from '../lib/unreadable.js';
  import { createPageWatcher, type PageWatcher } from '../lib/page-watch.js';
  import { adminDelay } from '../lib/poll-schedule.js';
  import { REMOVE_VISIT_CONFIRM, canRemoveVisit, holdNameSources, readNameSources, resultRows, rowsToLookForAgain, sessionsNeedingNames, type NameSources } from '../lib/admin-results.js';
  import { answerCounts, answersFrom, answersOf, chartsOf, namesFor } from '../lib/results-chart-model.js';
  import ReportExports from './ReportExports.svelte';
  import ResultCard from './charts/ResultCard.svelte';

  type Session = { id: string; clientId: string; date?: string; sectionIds?: string[]; status?: string };
  type Client = { id: string; name: string };
  type Token = { id: string; sessionId: string; used?: boolean; expiredAt?: string | null };
  type TrackRow = { track: SessionTrack; name: string; unnamed: boolean; status: string; answered: number; total: number };
  type SessionCard = { results: SessionResults; owner: string; codes: string[]; tracks: TrackRow[]; unreadable: string; charts: ReturnType<typeof chartsOf> };

  let { onToast, onLiveDisplay }: {
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
    /** Opens the Live display (and the exports) for a session. */
    onLiveDisplay: (sessionId: string) => void;
  } = $props();
  let cards = $state<SessionCard[]>([]);
  let loading = $state(true);
  let error = $state('');
  let updated = $state('');
  let openResults = $state<string[]>([]);
  /** Each chart's open answer (its names) or chosen word, by session and question: a refresh keeps them. In memory only. */
  let chosen = $state<Record<string, string | null>>({});
  let restartTrack = $state<TrackRow | null>(null);
  let restartSectionId = $state<string | null | undefined>(undefined);
  let busy = $state(false);
  let active = false;
  let refreshing = false;
  let requestVersion = 0;

  // How this screen keeps up (Phase 7). Every session is read in full when it opens, on Refresh and after a restart (5 requests a session on
  // SharePoint since Phase 9b: the session, its visits and its answers, then its activities, then their questions and options in groups of 20). What changes while it is open is the session that is LIVE, so on SharePoint only that one is refreshed on the timer, with
  // the same one-request feed the Live display uses (lib/live-session.js), every 15 seconds and never while the tab is hidden. The local
  // server has no throttle, so it still refreshes everything every 2.5 seconds.
  const local = !dataService.isSharePointMode();
  const LIVE_REFRESH_MS = 15_000;
  let liveHeld: LiveStructure | null = null;
  let namesHeld = new Map<string, string>();
  let tokensHeld: Token[] = [];
  // A person is named by lib/participant-names.js, the rule the leader report uses, so the screen and the PDF agree. A track carries a
  // guest's QR name itself; a staff sign-in name is in the session's visit log and a roster name in its roster, which are read with
  // the session (only for a session with a track that has no name of its own) and again, for the live session, when somebody who joined in
  // the last two minutes is still unnamed (rowsToLookForAgain: twice for each person at most, because a page records a sign-in a moment
  // after its first screen).
  let sourcesHeld = new Map<string, NameSources>();
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
        if (active && version === requestVersion) error = cause instanceof Error ? cause.message : 'Could not load results.';
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

  function statusText(status: string) {
    return status === 'in-progress' ? 'In progress' : status === 'completed' ? 'Completed' : status === 'used' ? 'Scanned' : status === 'expired' ? 'Expired' : status === 'unused' ? 'Unused' : status === 'unreadable' ? 'Answers unreadable' : 'Not started';
  }

  function statusClass(status: string) {
    return `pill pill--${status}`;
  }

  function toggleResults(sessionId: string) {
    openResults = openResults.includes(sessionId) ? openResults.filter((id) => id !== sessionId) : [...openResults, sessionId];
  }

  function counts(codes: string[]) {
    const count = (status: string) => codes.filter((value) => value === status).length;
    return `${count('unused')} unused · ${count('used')} scanned · ${count('expired')} expired`;
  }

  function openRestart(row: TrackRow, sectionId: string | null | undefined = undefined) {
    restartTrack = row;
    restartSectionId = sectionId;
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
    if (active) await refreshNow().catch((cause) => { error = cause instanceof Error ? cause.message : 'Could not load results.'; });
  }

  async function confirmRestart() {
    if (!restartTrack || restartSectionId === undefined || busy) return;
    const targetName = restartTrack.name;
    busy = true;
    requestVersion += 1;
    try {
      const result = await restartClientTrack(restartTrack.track.id, { sectionId: restartSectionId });
      if (!active) return;
      restartTrack = null;
      restartSectionId = undefined;
      onToast(`${targetName} restarted · ${result.removed} answers removed`, 'success');
      await refreshNow();
    } catch (cause) {
      if (active) onToast(cause instanceof Error ? cause.message : 'Could not restart this track.', 'error');
    } finally {
      busy = false;
    }
  }

  /** One session's card, from its results: each iPad's row, its status, and the codes. */
  function cardOf(result: SessionResults): SessionCard {
    const sources = sourcesHeld.get(result.session.id);
    const tracks = resultRows(result, sources);
    // The charts of the session's live activities (Phase 11a), with each answer's names: the same rule as the rows, over what was read for them.
    const charts = chartsOf({ sections: result.sections.filter((section) => section.enabled) }, { names: namesFor({ tracks: result.tracks, answers: answersOf(result), ...(sources ?? {}) }) });
    // What could not be read (Phase 9b, DI-6), said beside the export buttons, with each person's name the way their row has it.
    return { results: result, owner: namesHeld.get(result.session.clientId) ?? result.session.clientId, codes: tokensHeld.filter((token) => token.sessionId === result.session.id).map((token) => token.expiredAt ? 'expired' : token.used ? 'used' : 'unused'), tracks, unreadable: unreadableNotice(result.unreadable, namesByVisit(tracks)), charts };
  }

  /** Everything, from the start: every session in full. The live one is read the lean way, so the timer can carry on from it. */
  async function refreshNow() {
    const version = ++requestVersion;
    const [sessions, clients, tokens, settings] = await Promise.all([
      dataService.listSessions() as Promise<Session[]>,
      dataService.listClients() as Promise<Client[]>,
      dataService.listQrTokens() as Promise<Token[]>,
      local ? Promise.resolve(null) : dataService.getAppSettings() as Promise<{ activeSessionId?: string | null } | null>,
    ]);
    if (!active || version !== requestVersion) return;
    namesHeld = new Map(clients.map((client) => [client.id, client.name]));
    tokensHeld = tokens;
    let held: LiveStructure | null = null;
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
    sourcesHeld = sources;
    holdNameSources(sources);
    for (const result of results) if (needing.includes(result.session.id)) for (const track of result.tracks) if (!track.participantName?.trim()) lookedFor.set(track.id, Math.max(lookedFor.get(track.id) ?? 0, 1));
    liveHeld = held;
    cards = results.map(cardOf);
    updated = `Updated ${new Date().toLocaleTimeString()}`;
    error = '';
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
  <header class="panel__head"><div><h2>Results</h2><p class="muted">Each iPad is its own client track. Answers merge into live results as submitted. The live session refreshes by itself every {local ? 'few seconds' : '15 seconds'}; Refresh reads every session again. To end or reopen a session, use Today.</p></div><span class="muted small">{updated}</span><button class="btn btn--small" type="button" onclick={() => refreshAll()} disabled={busy}>Refresh</button></header>
  {#if loading}<p role="status">Loading results...</p>
  {:else if error}<p class="error" role="alert">{error}</p>
  {:else if cards.length === 0}<p class="muted">No sessions yet.</p>
  {:else}
    {#each cards as card (card.results.session.id)}
      {@const session = card.results.session}
      <article class="card" data-session={session.id}>
        <header class="card__head">
          <strong>{card.owner}</strong><span class="muted">{session.date ?? ''}</span><span class="tag">Session: {session.status ?? 'unknown'}</span><span class="card__spacer"></span>
          <button class="btn btn--small" type="button" onclick={() => onLiveDisplay(session.id)}>Live display</button>
        </header>
        <ReportExports sessionId={session.id} {onToast} />
        {#if card.unreadable}<p class="notice card__unreadable" role="status" data-testid="unreadable-notice"><strong>{card.unreadable}</strong></p>{/if}
        <!-- (Phase 12, F-08: the charts first; with sixty people the list ran 5,000 px above them.) -->
        <details class="tally" open={openResults.includes(session.id)} ontoggle={(event) => { const isOpen = (event.currentTarget as HTMLDetailsElement).open; openResults = isOpen ? [...new Set([...openResults, session.id])] : openResults.filter((id) => id !== session.id); }}>
          <summary>Live results · {answersFrom(answerCounts(card.results.sections.flatMap((section) => section.questions)))}</summary>
          {#if openResults.includes(session.id)}
            <div class="tally__charts">
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
        {#if card.tracks.length === 0}<p class="card__note muted">No iPads have joined yet.</p>
        {:else}
          <ul class="rows rows--flat">
            {#each card.tracks as row (row.track.id)}
              {@const notes = `${row.answered} of ${row.total} questions answered · joined ${row.track.createdAt ? new Date(row.track.createdAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) : ''} via ${row.track.joinedVia === 'qr' ? 'QR code' : 'manual select'}${row.track.resumeCount ? ` · resumed ${row.track.resumeCount}×` : ''}${row.track.restartedAt ? ` · restarted ${new Date(row.track.restartedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}` : ''}`}
              <li class="row">
                <div class="row__main"><span class="row__title">{row.name}</span><span class="muted">{notes}</span></div>
                <span class={statusClass(row.status)}>{statusText(row.status)}</span>
                {#if canRemoveVisit(row, session)}<button class="btn btn--small" type="button" onclick={() => void removeVisit(row)} disabled={busy}>Remove...</button>{/if}
                <button class="btn btn--small" type="button" onclick={() => openRestart(row)} disabled={busy || row.status === 'unreadable'} title={row.status === 'unreadable' ? `Its saved answers cannot be read, so they cannot be restarted. Correct or delete the damaged item in the ${dataService.sharePointListTitles().responses} list.` : undefined}>Restart...</button>
              </li>
            {/each}
          </ul>
        {/if}
        {#if card.codes.length}<p class="card__note muted small">QR codes: {counts(card.codes)}</p>{/if}
      </article>
    {/each}
  {/if}

  {#if restartTrack}
    <section class="content-editor" aria-labelledby="restart-title">
      <h3 id="restart-title">Restart {restartTrack.name}</h3>
      <p class="muted">Choose the restart point. Only this track's answers from that point are removed.</p>
      <fieldset class="field">
        <legend class="field__label">Restart from</legend>
        <label class="choice"><input type="radio" name="restart-from" checked={restartSectionId === null} onchange={() => { restartSectionId = null; }} /><span>The very beginning</span><span class="muted small">removes all of its answers</span></label>
        {#each restartTrack.track.sessionId ? cards.find((card) => card.results.session.id === restartTrack?.track.sessionId)?.results.sections ?? [] : [] as section (section.id)}
          <label class="choice"><input type="radio" name="restart-from" checked={restartSectionId === section.id} onchange={() => { restartSectionId = section.id; }} /><span>{section.title}</span><span class="muted small">{answeredIn(restartTrack.track.id, section)} of {section.questions.length} answered{section.enabled ? '' : ' · not live'}</span></label>
        {/each}
      </fieldset>
      <div class="dialog__actions"><button class="btn" type="button" onclick={() => { restartTrack = null; restartSectionId = undefined; }} disabled={busy}>Cancel</button><button class="btn btn--danger" type="button" onclick={() => void confirmRestart()} disabled={busy || restartSectionId === undefined}>{busy ? 'Restarting...' : 'Restart'}</button></div>
    </section>
  {/if}
</section>

<style>
  /* Each session card's "Live results" (Phase 11a): the charts of admin/charts/ResultCard.svelte, a grid of cards under each activity. Here and not in
     src/admin.css, which the Setup page loads too. */
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
</style>
