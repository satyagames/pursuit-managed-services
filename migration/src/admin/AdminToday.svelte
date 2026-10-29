<script lang="ts">
  import { onMount } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import {
    POLL_MS, blockedReason, evaluateReadiness, goLive, isCalendarDate, liveStatus, loadReadinessInputs, loadToday, localDate, makeSessionLive,
    needsSwitchConfirmation, pollToday, startPlannedSession, switchDialog,
  } from '../lib/admin/admin-today.js';
  import { daySessionPick, daySessionsOf, oneLiveWords, sessionChoiceWords } from '../lib/admin/session-plan.js';
  import { can } from '../lib/access/can.js';
  import { participantPageUrl, qrImage } from '../lib/admin/admin-links.js';
  import {
    failureText as failed, goLiveLabel, goLiveWhy, levelCounts, otherSessionsOf, pickableClients, readinessSummary, sinceText, upsertSession as upsert,
  } from '../lib/admin/today-view.js';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import TodayControls from './TodayControls.svelte';
  import TodayGoLive from './TodayGoLive.svelte';
  import TodayReadiness from './TodayReadiness.svelte';
  import TodaySessions from './TodaySessions.svelte';
  import TodayShare from './TodayShare.svelte';
  import TodayStatus from './TodayStatus.svelte';
  import { writeSummary } from '../lib/admin/session-summaries.js';

  type Client = { id: string; name: string; status?: string; logoUrl?: string | null; theme?: { assets?: { logo?: string | null; hero?: string | null } } | null };
  type Session = { id: string; clientId: string; date?: string; status?: string; participationMode?: string; activityFlow?: string; confidenceCheck?: boolean | null };
  type Section = { id: string; title: string; enabled?: boolean; clientId?: string | null; questionIds?: string[] };
  type Settings = { id?: string; activeSessionId?: string | null; activeClientId?: string | null; activatedAt?: string | null };
  type Status = ReturnType<typeof liveStatus>;
  type Wanted = {
    sessionId: string;
    client: Client;
    date: string;
    run: () => Promise<{ session: Session; client: Client; settings: Settings | null; verified: boolean }>;
  };

  let { access = null, onToast, onNavigate, onLiveDisplay }: {
    /** The signed-in person's access (lib/access): who may start a session, and who may also make the day's one (Prompt 21, Phase 3). */
    access?: any;
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
  /** The session picked among the client's sessions that day (Prompt 21, Phase 3: several may be planned); null for the day's first open one. */
  let pickedSessionId = $state<string | null>(null);
  /** The date the last pick was made for (not state: nothing draws it). */
  let pickedDate = today;
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
  // (Prompt 21, Phase 3: an Admin plans sessions on the client's page and a Producer starts one here. With nothing planned for the client that day, a
  // person who may plan as well as run (the PIN's legacy admin, a Super admin) goes live as before: Go live makes the day's session, <slug>-<date>.)
  const legacyId = $derived(client && dateValid ? dataService.sessionIdFor(client, date) as string : '');
  const daySessions = $derived(client && dateValid ? daySessionsOf(sessions, client.id, date) : []);
  const target = $derived(client && dateValid ? daySessionPick(sessions, client.id, date, pickedSessionId) : null);
  const targetId = $derived(target?.id ?? legacyId);
  /** The day has a session planned on the client's page (not only the one Go live made): Today offers the choice. */
  const planned = $derived(daySessions.some((session) => session.id !== legacyId));
  const sessionChoices = $derived(planned ? daySessions.map((session) => ({ id: session.id, label: sessionChoiceWords(session, daySessions, settings) })) : []);
  const mayRun = $derived(!access || can(access, 'events.run', { clientId: client?.id }));
  const mayPlan = $derived(!access || can(access, 'clients.manage', { clientId: client?.id }));
  const controlSession = $derived(sessions.find((session) => session.id === settings?.activeSessionId) ?? null);
  /** The live session's client, for the Animations switch. */
  const controlClient = $derived(controlSession ? clients.find((entry) => entry.id === controlSession.clientId) ?? null : null);
  const rows = $derived(evaluateReadiness({
    client, date: dateValid ? date : today, today, sections, questions, options, sessions, clients, target, roster, schema, mayPlan,
  } as never));
  const counts = $derived(levelCounts(rows));
  const blockers = $derived(counts.blockers);
  const warnings = $derived(counts.warnings);
  const alreadyLive = $derived(status.live && status.session?.id === targetId);
  const busy = $derived(checking || goingLive || controlsBusy);
  const why = $derived(goLiveWhy({ loaded, client, dateValid, inputsBusy, blockers, reason: blockers > 0 ? blockedReason(rows) : null, alreadyLive, date, mayRun }));
  const canGo = $derived(loaded && Boolean(client) && dateValid && !inputsBusy && blockers === 0 && !alreadyLive && !busy && mayRun);
  /** The known limit, said plainly when going live would take the place of another live session. */
  const oneLive = $derived(targetId ? oneLiveWords(status, { id: targetId }) : '');
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
      const data = await loadToday(dataService, { clientId: keepPicker ? clientId : null, date: dateValid ? date : today, keepClient: keepPicker, sessionId: keepPicker ? pickedSessionId : null, access });
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
      const inputs = await loadReadinessInputs(dataService, { client, date: dateValid ? date : today, sections, sessions, sessionId: target?.id ?? null, access });
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
    pickedSessionId = null;
    verified = '';
    problem = '';
    await recheckInputs();
  }

  /** A session picked among the client's sessions that day: its roster may differ. */
  async function pickSession(event: Event) {
    pickedSessionId = (event.currentTarget as HTMLSelectElement).value || null;
    verified = '';
    problem = '';
    await recheckInputs();
  }

  async function pickDate() {
    // (Safari sends a date field's change again when it loses the focus, as when Go live is pressed: the same date is not a new pick, and must not
    // re-check readiness under the press, which would land on a button that is off for that moment.)
    if (date === pickedDate) return;
    pickedDate = date;
    pickedSessionId = null;
    verified = '';
    problem = '';
    if (!dateValid) return;
    if (planned) { await recheckInputs(); return; }
    // The date decides which session the client would go live with, and so which roster counts.
    if (target?.participationMode === 'client-visit' || roster !== null) await recheckInputs();
  }

  async function poll() {
    if (polling || busy || !loaded || !alive || confirmation) return;
    polling = true;
    const began = epoch;
    try {
      const next = await pollToday(dataService, { settings, clients, access });
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
    // A planned session: the Producer's Start. The day's session Go live made (or will make), as before.
    if (target && target.id !== legacyId) {
      const id = target.id;
      return { sessionId: id, client: chosen, date, run: () => startPlannedSession(dataService, id) as ReturnType<Wanted['run']> };
    }
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
    const next = await pollToday(dataService, { settings, clients, access });
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

  /** Phase 20: the live session's confidence check, on or off. */
  async function setCheck(on: boolean) {
    if (!controlSession || controlsBusy || (controlSession.confidenceCheck === true) === on) return;
    controlsBusy = true;
    epoch += 1;
    problem = '';
    try {
      const updated = await dataService.updateSession(controlSession.id, { confidenceCheck: on }) as Session;
      sessions = upsert(sessions, { ...controlSession, ...updated, confidenceCheck: on });
      onToast(`The confidence check is ${on ? 'on' : 'off'}`, 'success');
    } catch (cause) {
      problem = failed(cause, 'Could not change the confidence check.');
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
      // (Prompt 21, Phase 5) its summary for the Leadership dashboard, from its answers as they are now: one more read of the session and one write. A
      // failure ends nothing: the session has ended, and Rebuild on the dashboard writes the summary later.
      void writeSummary(session.id, { writtenBy: access?.person?.name ?? '', startMonth: (settings as { fiscalYearStartMonth?: number } | null)?.fiscalYearStartMonth ?? undefined })
        .catch(() => { if (alive) onToast('The session ended, but its summary for the dashboard could not be written. Rebuild it from Results.', 'error'); });
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
          <TodayStatus {status} {participants} since={sinceText(status.since, today)} {pollError} />
        </section>

        <!-- Go live -->
        <section class="card-panel" aria-labelledby="golive-heading">
          <h3 id="golive-heading">Go live</h3>
          <TodayGoLive
            {pickable} {clientId} bind:date {busy} {canGo} label={goLiveLabel({ goingLive, checking, alreadyLive })} {why} {verified} {problem}
            onPickClient={pickClient} onPickDate={() => void pickDate()} onGo={() => void attempt(goLiveWanted())} {onNavigate}
            {sessionChoices} sessionId={target?.id ?? ''} onPickSession={(event) => void pickSession(event)} {oneLive}
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
            onSetMode={(mode) => void setMode(mode)} onSetFlow={(flow) => void setFlow(flow)} onSetCheck={(on) => void setCheck(on)} onEnd={(session) => void endIt(session)} onReopen={(session) => void reopenIt(session)}
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
        <TodaySessions
          sessions={otherSessions} all={allSessions} {busy} {nameOf} canMakeLive={(session) => sessionWanted(session as Session) !== null}
          onReopen={(session) => void reopenIt(session as Session)} onMakeLive={(session) => void attempt(sessionWanted(session as Session))} onShowAll={() => { allSessions = true; }}
        />
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
