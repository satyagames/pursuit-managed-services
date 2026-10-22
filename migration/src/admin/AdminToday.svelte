<script lang="ts">
  import { onMount } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import {
    POLL_MS, blockedReason, evaluateReadiness, goLive, isCalendarDate, liveStatus, loadReadinessInputs, loadToday, localDate, makeSessionLive,
    needsSwitchConfirmation, notLiveText, pollToday, switchDialog,
  } from '../lib/admin/admin-today.js';
  import { participantPageUrl, qrImage } from '../lib/admin/admin-links.js';
  import {
    failureText as failed, goLiveLabel, goLiveWhy, levelCounts, otherSessionsOf, pickableClients, readinessSummary, sinceText, upsertSession as upsert,
  } from '../lib/admin/today-view.js';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import TodayControls from './TodayControls.svelte';
  import TodayGoLive from './TodayGoLive.svelte';
  import TodayReadiness from './TodayReadiness.svelte';
  import TodayShare from './TodayShare.svelte';

  type Client = { id: string; name: string; status?: string; logoUrl?: string | null; theme?: { assets?: { logo?: string | null; hero?: string | null } } | null };
  type Session = { id: string; clientId: string; date?: string; status?: string; participationMode?: string; activityFlow?: string };
  type Section = { id: string; title: string; enabled?: boolean; clientId?: string | null; questionIds?: string[] };
  type Settings = { id?: string; activeSessionId?: string | null; activeClientId?: string | null; activatedAt?: string | null };
  type Status = ReturnType<typeof liveStatus>;
  type Wanted = {
    sessionId: string;
    client: Client;
    date: string;
    run: () => Promise<{ session: Session; client: Client; settings: Settings | null; verified: boolean }>;
  };

  let { onToast, onNavigate, onLiveDisplay }: {
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
    onNavigate: (tab: string) => void;
    /** Opens the Live display (Results) for a session. */
    onLiveDisplay: (sessionId: string) => void;
  } = $props();

  const today = localDate();

  // What the page holds (all of it read fresh on load; nothing is kept between page loads).
  let loaded = $state(false);
  let loadError = $state('');
  let clients = $state<Client[]>([]);
  let sessions = $state<Session[]>([]);
  let sections = $state<Section[]>([]);
  let settings = $state<Settings | null>(null);
  let schema = $state<{ report?: unknown[]; error?: string } | null>(null);
  let status = $state<Status>({ live: false, reason: 'no-session', client: null, session: null, since: null });
  let participants = $state(0);
  let questions = $state<unknown[]>([]);
  let options = $state<unknown[]>([]);
  let roster = $state<{ id: string; enabled?: boolean }[] | null>(null);

  // The picker.
  let clientId = $state('');
  let date = $state(today);
  let inputsBusy = $state(false);

  // Actions.
  let checking = $state(false);
  let goingLive = $state(false);
  let controlsBusy = $state(false);
  let verified = $state('');
  let problem = $state('');
  let confirmation = $state<{ dialog: ReturnType<typeof switchDialog>; wanted: Wanted } | null>(null);
  let pollError = $state('');
  let shareUrl = $state('');
  let shareQr = $state('');
  let allSessions = $state(false);

  let alive = true;
  let polling = false;
  let inputsVersion = 0;
  // Bumped by every action. A refresh that began before an action and ends after it is out of date and is dropped,
  // so a slow poll can never put back what the facilitator just changed.
  let epoch = 0;

  const client = $derived(clients.find((entry) => entry.id === clientId) ?? null);
  const dateValid = $derived(isCalendarDate(date));
  const targetId = $derived(client && dateValid ? dataService.sessionIdFor(client, date) as string : '');
  const target = $derived(sessions.find((session) => session.id === targetId) ?? null);
  const controlSession = $derived(sessions.find((session) => session.id === settings?.activeSessionId) ?? null);
  /** The live session's client, for the Animations switch. */
  const controlClient = $derived(controlSession ? clients.find((entry) => entry.id === controlSession.clientId) ?? null : null);
  const rows = $derived(evaluateReadiness({
    client, date: dateValid ? date : today, today, sections, questions, options, sessions, clients, target, roster, schema,
  } as never));
  const counts = $derived(levelCounts(rows));
  const blockers = $derived(counts.blockers);
  const warnings = $derived(counts.warnings);
  const alreadyLive = $derived(status.live && status.session?.id === targetId);
  const busy = $derived(checking || goingLive || controlsBusy);
  const why = $derived(goLiveWhy({ loaded, client, dateValid, inputsBusy, blockers, reason: blockers > 0 ? blockedReason(rows) : null, alreadyLive, date }));
  const canGo = $derived(loaded && Boolean(client) && dateValid && !inputsBusy && blockers === 0 && !alreadyLive && !busy);
  const pickable = $derived(pickableClients(clients, clientId));
  const otherSessions = $derived(otherSessionsOf(sessions, settings?.activeSessionId, status.live));

  const nameOf = (id: string) => clients.find((entry) => entry.id === id)?.name ?? id;
  onMount(() => {
    void reload();
    const tick = () => { if (!document.hidden) void poll(); };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      alive = false;
      inputsVersion += 1;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  });

  // The participant link and its QR image exist only while something is live.
  $effect(() => {
    const sessionId = status.live ? status.session?.id : null;
    if (!sessionId) { shareUrl = ''; shareQr = ''; return; }
    let current = true;
    void participantPageUrl().then(async (url) => {
      if (!current) return;
      shareUrl = url;
      try { const image = await qrImage(url); if (current) shareQr = image; } catch { if (current) shareQr = ''; }
    });
    return () => { current = false; };
  });

  async function reload({ keepPicker = false } = {}) {
    try {
      const data = await loadToday(dataService, { clientId: keepPicker ? clientId : null, date: dateValid ? date : today, keepClient: keepPicker });
      if (!alive) return;
      clients = data.clients as Client[];
      sessions = data.sessions as Session[];
      sections = data.sections as Section[];
      settings = data.settings as Settings | null;
      schema = data.schema as typeof schema;
      status = data.status;
      participants = data.participants;
      questions = data.questions;
      options = data.options;
      roster = data.roster as typeof roster;
      clientId = data.pickedClientId ?? '';
      loadError = '';
    } catch (cause) {
      if (alive) loadError = failed(cause, 'Could not load Today.');
    } finally {
      if (alive) loaded = true;
    }
  }

  /** Reads what readiness needs for the picked client and date (the questions and answers of its live activities). */
  async function recheckInputs({ everything = false } = {}) {
    if (!client) return;
    const version = ++inputsVersion;
    inputsBusy = true;
    try {
      if (everything) {
        await reload({ keepPicker: true });
        return;
      }
      const inputs = await loadReadinessInputs(dataService, { client, date: dateValid ? date : today, sections, sessions });
      if (!alive || version !== inputsVersion) return;
      questions = inputs.questions;
      options = inputs.options;
      roster = inputs.roster as typeof roster;
    } catch (cause) {
      if (alive && version === inputsVersion) problem = failed(cause, 'Could not check readiness.');
    } finally {
      if (alive && version === inputsVersion) inputsBusy = false;
    }
  }

  async function pickClient(event: Event) {
    clientId = (event.currentTarget as HTMLSelectElement).value;
    verified = '';
    problem = '';
    await recheckInputs();
  }

  async function pickDate() {
    verified = '';
    problem = '';
    if (!dateValid) return;
    // The date decides which session the client would go live with, and so which roster counts.
    if (target?.participationMode === 'client-visit' || roster !== null) await recheckInputs();
  }

  async function poll() {
    if (polling || busy || !loaded || !alive || confirmation) return;
    polling = true;
    const began = epoch;
    try {
      const next = await pollToday(dataService, { settings, clients });
      if (!alive || began !== epoch) return;
      pollError = '';
      if (next.changed && next.settings?.activeSessionId !== settings?.activeSessionId) {
        await reload({ keepPicker: true }); // something else became live: the sessions list is out of date too
        return;
      }
      settings = next.settings as Settings | null;
      clients = next.clients as Client[];
      status = next.status;
      participants = next.participants;
      if (next.session) sessions = upsert(sessions, next.session as Session);
    } catch (cause) {
      if (alive) pollError = failed(cause, 'Could not refresh.');
    } finally {
      polling = false;
    }
  }

  // ---- Going live ---------------------------------------------------------------------------------

  function goLiveWanted(): Wanted | null {
    if (!client || !targetId) return null;
    const chosen = client;
    return { sessionId: targetId, client: chosen, date, run: () => goLive(dataService, { clientId: chosen.id, date }) as ReturnType<Wanted['run']> };
  }

  async function attempt(wanted: Wanted | null) {
    if (!wanted || busy) return;
    epoch += 1;
    problem = '';
    verified = '';
    checking = true;
    try {
      // Decide on what is true now, not on what was true at the last refresh: who is live, and how many are in it.
      if (status.live && status.session?.id !== wanted.sessionId) await applyPoll();
      const live = status;
      if (needsSwitchConfirmation({ status: live, participants, targetSessionId: wanted.sessionId } as never)) {
        confirmation = {
          dialog: switchDialog({ from: live.client, to: wanted.client, participants, fromSession: live.session, date: wanted.date }),
          wanted,
        };
        return;
      }
    } catch (cause) {
      problem = failed(cause, 'Could not check who is live.');
      return;
    } finally {
      checking = false;
    }
    await execute(wanted);
  }

  async function applyPoll() {
    const next = await pollToday(dataService, { settings, clients });
    if (!alive) return;
    settings = next.settings as Settings | null;
    clients = next.clients as Client[];
    status = next.status;
    participants = next.participants;
    if (next.session) sessions = upsert(sessions, next.session as Session);
  }

  async function execute(wanted: Wanted) {
    epoch += 1;
    goingLive = true;
    problem = '';
    verified = '';
    const existed = sessions.some((session) => session.id === wanted.sessionId);
    try {
      const result = await wanted.run();
      if (!alive) return;
      settings = result.settings;
      sessions = upsert(sessions, result.session);
      if (!clients.some((entry) => entry.id === result.client.id)) clients = [...clients, result.client];
      status = liveStatus({ settings: result.settings, session: result.session, clients } as never);
      // A session made a moment ago has nobody in it; one that already existed may, and one read says how many.
      if (existed) await applyPoll().catch(() => { /* the next refresh brings the count */ });
      else participants = 0;
      if (result.verified) {
        verified = `Verified: participants now see ${result.client.name}`;
        onToast(`${result.client.name} is live`, 'success');
      } else {
        const now = settings?.activeClientId ? nameOf(settings.activeClientId) : 'another session';
        problem = `Not verified: ${dataService.sharePointListTitles().appsettings} now names ${now}, not ${result.client.name}. Another admin may have switched it. Check the status above.`;
      }
    } catch (cause) {
      problem = failed(cause, 'Could not go live.');
    } finally {
      epoch += 1;
      goingLive = false;
      confirmation = null;
    }
  }

  // ---- Controls on the live session ----------------------------------------------------------------

  async function setMode(mode: 'client-visit' | 'staff') {
    if (!controlSession || controlsBusy || (controlSession.participationMode ?? 'staff') === mode) return;
    if (mode === 'staff' && controlSession.participationMode === 'client-visit'
      && !window.confirm('Switch to staff sign-in? Guest QR codes that nobody has scanned yet will stop working.')) return;
    controlsBusy = true;
    epoch += 1;
    problem = '';
    try {
      const updated = await dataService.setSessionParticipationMode(controlSession.id, mode) as Session;
      sessions = upsert(sessions, { ...controlSession, ...updated });
      onToast(mode === 'client-visit' ? 'Guests now scan a personal QR' : 'Staff now sign in', 'success');
      if (client && targetId === controlSession.id) await recheckInputs();
    } catch (cause) {
      problem = failed(cause, 'Could not change how people are identified.');
    } finally {
      epoch += 1;
      controlsBusy = false;
    }
  }

  async function setFlow(flow: string) {
    if (!controlSession || controlsBusy || (controlSession.activityFlow ?? 'sequential') === flow) return;
    controlsBusy = true;
    epoch += 1;
    problem = '';
    try {
      const updated = await dataService.updateSession(controlSession.id, { activityFlow: flow }) as Session;
      sessions = upsert(sessions, { ...controlSession, ...updated, activityFlow: flow });
      onToast(`Activity flow is ${flow}`, 'success');
    } catch (cause) {
      problem = failed(cause, 'Could not change the activity flow.');
    } finally {
      epoch += 1;
      controlsBusy = false;
    }
  }

  async function endIt(session: Session) {
    if (controlsBusy) return;
    const owner = nameOf(session.clientId);
    if (!window.confirm(`End the ${owner} session? iPads can't join or resume afterwards, and QR codes nobody has scanned stop working.`)) return;
    controlsBusy = true;
    epoch += 1;
    problem = '';
    try {
      const ended = await dataService.endSession(session.id) as Session;
      if (!alive) return;
      sessions = upsert(sessions, { ...session, ...ended, status: 'completed' });
      status = liveStatus({ settings, session: { ...session, ...ended, status: 'completed' }, clients } as never);
      verified = '';
      onToast('Session ended', 'success');
    } catch (cause) {
      if (alive) { problem = failed(cause, 'Could not end the session.'); onToast(problem, 'error'); }
    } finally {
      epoch += 1;
      controlsBusy = false;
    }
  }

  async function reopenIt(session: Session) {
    if (controlsBusy) return;
    controlsBusy = true;
    epoch += 1;
    problem = '';
    try {
      const reopened = await dataService.reopenSession(session.id) as Session;
      if (!alive) return;
      const next = { ...session, ...reopened };
      sessions = upsert(sessions, next);
      if (session.id === settings?.activeSessionId) status = liveStatus({ settings, session: next, clients } as never);
      onToast('Session reopened', 'success');
    } catch (cause) {
      if (alive) { problem = failed(cause, 'Could not reopen the session.'); onToast(problem, 'error'); }
    } finally {
      epoch += 1;
      controlsBusy = false;
    }
  }

  function sessionWanted(session: Session): Wanted | null {
    const owner = clients.find((entry) => entry.id === session.clientId);
    if (!owner) return null;
    return { sessionId: session.id, client: owner, date: session.date ?? '', run: () => makeSessionLive(dataService, session.id) as ReturnType<Wanted['run']> };
  }

  function rowAction(row: { go?: { tab?: string; action?: string } }) {
    if (row.go?.action === 'reopen' && target) void reopenIt(target).then(() => recheckInputs());
    else if (row.go?.tab) onNavigate(row.go.tab);
  }
</script>

<section class="today" aria-busy={!loaded || busy}>
  <header class="panel__head">
    <div><h2>Today</h2><p class="muted">Pick the client and the date, press Go live, and know what participants will see.</p></div>
  </header>

  {#if !loaded}
    <p role="status">Loading Today...</p>
  {:else if loadError}
    <div class="panel-error" role="alert">
      <h2>Could not load Today</h2>
      <p class="muted">{loadError}</p>
      <button class="btn" type="button" onclick={() => { loaded = false; void reload({ keepPicker: true }); }}>Try again</button>
    </div>
  {:else}
    <div class="today__grid">
      <div class="today__main">
        <!-- Status -->
        <section class="card-panel status" class:status--live={status.live} aria-labelledby="status-heading" data-live={status.live}>
          <div class="status__head">
            <h3 id="status-heading" class="sr-only">Status</h3>
            <span class="badge" class:badge--live={status.live}><span class="badge__dot" aria-hidden="true"></span>{status.live ? 'LIVE' : 'NOT LIVE'}</span>
            {#if status.live && status.client}<p class="status__client">{status.client.name}</p>{/if}
          </div>
          {#if status.live && status.session}
            <dl class="facts">
              <div><dt>Date</dt><dd>{status.session.date ?? 'Undated'}</dd></div>
              <div><dt>Session</dt><dd class="mono">{status.session.id}</dd></div>
              <div><dt>Participants</dt><dd data-testid="participants">{participants}</dd></div>
              <div><dt>Live since</dt><dd>{sinceText(status.since, today)}</dd></div>
            </dl>
          {:else}
            <p class="status__text">{notLiveText(status)}</p>
          {/if}
          {#if pollError}<p class="muted small" role="status">Could not refresh just now ({pollError}). Trying again in a few seconds.</p>{/if}
        </section>

        <!-- Go live -->
        <section class="card-panel" aria-labelledby="golive-heading">
          <h3 id="golive-heading">Go live</h3>
          <TodayGoLive
            {pickable} {clientId} bind:date {busy} {canGo} label={goLiveLabel({ goingLive, checking, alreadyLive })} {why} {verified} {problem}
            onPickClient={pickClient} onPickDate={() => void pickDate()} onGo={() => void attempt(goLiveWanted())} {onNavigate}
          />
        </section>

        <!-- Readiness -->
        <section class="card-panel" aria-labelledby="ready-heading">
          <div class="ready__head">
            <h3 id="ready-heading">Readiness{client ? ` for ${client.name}` : ''}</h3>
            <button class="btn btn--small" type="button" onclick={() => void recheckInputs({ everything: true })} disabled={busy || inputsBusy}>Re-check</button>
          </div>
          <TodayReadiness {rows} summary={readinessSummary({ inputsBusy, blockers, warnings })} {busy} onRowAction={rowAction} />
        </section>
      </div>

      <div class="today__side">
        <!-- Controls -->
        <section class="card-panel" aria-labelledby="controls-heading">
          <h3 id="controls-heading">Controls</h3>
          <TodayControls
            {controlSession} {controlClient} owner={controlSession ? nameOf(controlSession.clientId) : ''} live={status.live} {controlsBusy}
            onSetMode={(mode) => void setMode(mode)} onSetFlow={(flow) => void setFlow(flow)} onEnd={(session) => void endIt(session)} onReopen={(session) => void reopenIt(session)}
            onMotionSaved={(written) => { clients = clients.map((entry) => (entry.id === written.id ? { ...entry, theme: written.theme as Client['theme'] } : entry)); }} {onToast}
          />
        </section>

        <!-- Share -->
        {#if status.live && status.session}
          <section class="card-panel" aria-labelledby="share-heading">
            <h3 id="share-heading">Participant link</h3>
            <TodayShare {shareUrl} {shareQr} onLive={() => onLiveDisplay(status.session!.id)} {onToast} />
          </section>
        {/if}
      </div>
    </div>

    {#if otherSessions.length > 0}
      <details class="card-panel others">
        <summary>All sessions ({otherSessions.length})</summary>
        <p class="muted small">Sessions made by Go live are found by client and date above. This list is for any other session, and to reopen one that has ended.</p>
        <ul class="rows rows--flat">
          {#each (allSessions ? otherSessions : otherSessions.slice(0, 8)) as session (session.id)}
            {@const wanted = sessionWanted(session)}
            <li class="row">
              <div class="row__main"><span class="row__title">{nameOf(session.clientId)} · {session.date ?? 'Undated'}</span><span class="muted small mono">{session.id} · {session.status ?? 'not-started'}</span></div>
              {#if session.status === 'completed'}
                <button class="btn btn--small" type="button" onclick={() => void reopenIt(session)} disabled={busy}>Reopen</button>
              {:else}
                <button class="btn btn--small" type="button" onclick={() => void attempt(wanted)} disabled={busy || !wanted}>Make live</button>
              {/if}
            </li>
          {/each}
        </ul>
        {#if otherSessions.length > 8 && !allSessions}<button class="btn btn--small" type="button" onclick={() => { allSessions = true; }}>Show all</button>{/if}
      </details>
    {/if}
  {/if}
</section>

{#if confirmation}
  <ConfirmDialog
    title={confirmation.dialog.title}
    lead={confirmation.dialog.lead}
    points={confirmation.dialog.points}
    confirmLabel={confirmation.dialog.confirm}
    busy={goingLive}
    onCancel={() => { confirmation = null; }}
    onConfirm={() => { if (confirmation) void execute(confirmation.wanted); }}
  />
{/if}

<style>
  .today__grid {
    display: grid;
    gap: 1.25rem;
    align-items: start;
  }

  .today__main,
  .today__side {
    display: grid;
    gap: 1.25rem;
    min-width: 0;
  }

  @media (min-width: 1000px) {
    .today__grid {
      grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    }
  }

  .card-panel {
    display: grid;
    gap: 0.9rem;
    padding: 1.25rem;
    background: var(--adm-card);
    border: 1px solid var(--adm-line);
    border-radius: 0.9rem;
  }

  h3 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: var(--fw-bold);
  }

  /* Status */
  .status {
    border-left: 0.4rem solid var(--adm-line);
  }

  .status--live {
    border-left-color: var(--focus);
  }

  .status__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1rem;
  }

  .status__client {
    margin: 0;
    font-size: clamp(1.4rem, 3vw, 1.9rem);
    font-weight: var(--fw-bold);
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  .status__text {
    margin: 0;
    color: var(--adm-muted);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 2rem;
    padding: 0 0.85rem;
    border-radius: var(--radius-full);
    color: var(--adm-idle-ink);
    background: var(--adm-idle-bg);
    font-size: 0.95rem;
    font-weight: var(--fw-bold);
    letter-spacing: 0.04em;
  }

  .badge__dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.55;
  }

  .badge--live {
    color: var(--adm-ok-ink);
    background: var(--adm-ok-bg);
  }

  .badge--live .badge__dot {
    background: var(--focus);
    opacity: 1;
    box-shadow: 0 0 0 0.2rem rgb(134 188 37 / 0.3);
  }

  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr));
    gap: 0.9rem 1.25rem;
    margin: 0;
  }

  .facts div {
    min-width: 0;
  }

  dt {
    color: var(--adm-muted);
    font-size: 0.85rem;
    font-weight: var(--fw-semibold);
  }

  dd {
    margin: 0.1rem 0 0;
    font-weight: var(--fw-semibold);
    overflow-wrap: anywhere;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.95em;
  }

  /* Readiness */
  .ready__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .others {
    display: block;
    margin-top: 1.25rem;
  }

  .others summary {
    min-height: 2.75rem;
    font-weight: var(--fw-semibold);
    cursor: pointer;
  }
</style>
