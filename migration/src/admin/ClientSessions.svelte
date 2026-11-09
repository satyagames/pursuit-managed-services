<script lang="ts">
  import Icon from './Icon.svelte';
  // The Sessions part of a client's page (Prompt 21, Phase 3; board 5): every session of the client with its date and time, title, period, label
  // (Planned, Live, Ended) and team, the latest day first; and New session (the date, the start time, a title when the client has another session
  // that day, and whether the client's team runs it). Rules in lib/admin/session-plan.js; the write is the data layer's planSession(), which takes
  // the next free id (-2, -3) when SharePoint refuses one. Only a person who may create clients and sessions (clients.manage) sees the form.
  import * as dataService from '../lib/data/dataService.js';
  import { can } from '../lib/access/can.js';
  import { sessionTeamWords } from '../lib/access/team.js';
  import { errorText } from '../lib/admin/session-notice.js';
  import { localDate } from '../lib/admin/admin-today.js';
  import { planProblems, planSessionFor, sessionRows } from '../lib/admin/session-plan.js';
  import { nextFreeDate, pageStorage, prefsKeyOf, recall, remember, sessionNameFor } from '../lib/admin/admin-defaults.js';
  import StickyBar from './StickyBar.svelte';

  let { open = $bindable(false), client, access = null, sessions, settings, users, assignments, fiscalStartMonth, onPlanned, onToast }: {
    client: { id: string; name: string; slug?: string };
    access?: any;
    /** The client's sessions. */
    sessions: any[];
    settings: any;
    users: any[];
    assignments: any[];
    fiscalStartMonth: unknown;
    /** A session was planned: the words to say, its id, and whether it has a team of its own (the team panel opens on it). */
    onPlanned: (words: string, sessionId: string, ownTeam: boolean) => void;
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
    /** (Prompt 33) Whether Add session is open: the client's breadcrumb names it. */
    open?: boolean;
  } = $props();
  /** (Prompt 33) The session just added, marked in the list for this visit. */
  let fresh = $state<string | null>(null);
  let planForm = $state<HTMLFormElement>();

  const mayPlan = $derived(!access || can(access, 'clients.manage', { clientId: client.id }));
  const rows = $derived(sessionRows(sessions, { clientId: client.id, settings, fiscalStartMonth }));

  let date = $state(localDate());
  let startTime = $state('');
  let title = $state('');
  let clientTeam = $state(true);
  let submitted = $state(false);
  let busy = $state(false);
  let formError = $state('');
  const problems = $derived(planProblems({ date, startTime, title }, { sessions, clientId: client.id }));

  // (Prompt 38: the form starts filled in: the next day the client has no session, the start time this person used last, and the name
  // "{Client} · {date}", which follows the date until it is typed in. All of it can be changed.)
  const prefsKey = $derived(prefsKeyOf(access?.person ?? null));
  let titleTouched = false;

  function openForm() {
    open = true;
    date = nextFreeDate(sessions, client.id, localDate());
    startTime = String(recall(pageStorage(), prefsKey, 'startTime'));
    title = sessionNameFor(client.name, date);
    titleTouched = false;
    clientTeam = true;
    submitted = false;
    formError = '';
  }

  async function plan(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    submitted = true;
    const first = problems.date ?? problems.startTime ?? problems.title;
    if (first) { formError = first; return; }
    busy = true;
    formError = '';
    try {
      const fields = planSessionFor(dataService, client, { date, startTime, title }, { sessions, fiscalStartMonth });
      const made = await dataService.planSession(fields) as { id: string };
      remember(pageStorage(), prefsKey, 'startTime', startTime);
      open = false;
      fresh = made.id;
      onPlanned(`Session added to ${client.name}: ${date} at ${startTime}`, made.id, !clientTeam);
    } catch (cause) {
      formError = errorText(cause, 'Could not plan this session.');
      onToast(formError, 'error');
    } finally {
      busy = false;
    }
  }
</script>

<section class="part" aria-labelledby="sessions-heading">
  <div class="part__head">
    <h3 id="sessions-heading">Sessions</h3>
    {#if mayPlan}<button class="btn btn--primary btn--with-icon" type="button" onclick={openForm} disabled={busy || open}><Icon name="plus" /> Add session</button>{/if}
  </div>
  <p class="part__intro">Sessions: each time you run the app for this client.</p>
  {#if !mayPlan}<p class="muted small">Sessions are planned by an Admin. A Producer starts them on Today.</p>{/if}

  {#if open}
    <form bind:this={planForm} class="editor-form plan" onsubmit={plan} novalidate aria-labelledby="plan-heading">
      <h4 id="plan-heading">Add a session to {client.name}</h4>
      <div class="plan__fields">
        <div class="field"><span class="field__line"><label class="field__label" for="plan-date">Date</label><span class="field__required">Required</span></span>
          <input id="plan-date" class="input" type="date" bind:value={date} oninput={() => { if (!titleTouched) title = sessionNameFor(client.name, date); }} disabled={busy} required aria-invalid={submitted && Boolean(problems.date)} aria-describedby={submitted && problems.date ? 'plan-date-problem' : undefined} />
          {#if submitted && problems.date}<span id="plan-date-problem" class="error small">{problems.date}</span>{/if}
        </div>
        <div class="field"><span class="field__line"><label class="field__label" for="plan-time">Start time</label><span class="field__required">Required</span></span>
          <input id="plan-time" class="input" type="time" bind:value={startTime} disabled={busy} required aria-invalid={submitted && Boolean(problems.startTime)} aria-describedby={submitted && problems.startTime ? 'plan-time-problem' : undefined} />
          {#if submitted && problems.startTime}<span id="plan-time-problem" class="error small">{problems.startTime}</span>{/if}
        </div>
        <div class="field plan__title"><label class="field__label" for="plan-title">Title</label>
          <input id="plan-title" class="input" bind:value={title} oninput={() => { titleTouched = true; }} maxlength={255} disabled={busy} placeholder="Morning workshop" aria-invalid={submitted && Boolean(problems.title)} aria-describedby="plan-title-help" />
          <span id="plan-title-help" class="small" class:muted={!(submitted && problems.title)} class:error={submitted && Boolean(problems.title)}>{submitted && problems.title ? problems.title : 'Filled in from the client and the date; change it as you like.'}</span>
        </div>
      </div>
      <label class="check"><input type="checkbox" bind:checked={clientTeam} disabled={busy} /> Use the client team</label>
      <p class="muted small">{clientTeam ? 'Everyone on the client\'s team can work on this session.' : 'Once it is planned, choose who works on this session below.'}</p>
      {#if formError}<p class="error" role="alert">{formError}</p>{/if}
    </form>
    <StickyBar label="New session" icon="calendar-check" context={`New session for ${client.name}${date ? ` on ${date}` : ''}`}
      primary={{ label: busy ? 'Creating...' : 'Create session', icon: 'plus', onclick: () => planForm?.requestSubmit(), disabled: busy, testid: 'create-session' }}
      secondary={{ label: 'Cancel', icon: 'close', onclick: () => { open = false; }, disabled: busy }} />
  {/if}

  {#if rows.length === 0}
    <div class="adm-empty"><Icon name="calendar-check" /><p>No sessions yet. {mayPlan ? `Add the first one for ${client.name}.` : 'An Admin adds them.'}</p>{#if mayPlan && !open}<button class="btn btn--with-icon" type="button" onclick={openForm}><Icon name="plus" />Add session</button>{/if}</div>
  {:else}
    <div class="sessions__scroll">
      <table class="sessions" data-testid="client-sessions">
        <caption class="sr-only">Sessions of {client.name}</caption>
        <thead><tr><th scope="col">Date and time</th><th scope="col">Title</th><th scope="col">Period</th><th scope="col">Status</th><th scope="col">Team</th></tr></thead>
        <tbody>
          {#each rows as row (row.session.id)}
            <tr data-session-id={row.session.id} class:sessions__fresh={row.session.id === fresh}>
              <td>{row.when}{#if row.session.id === fresh}<span class="sessions__new">Just added</span>{/if}{#if row.sequence}<span class="muted small sessions__order">{row.sequence}</span>{/if}</td>
              <td>{row.title || '-'}</td>
              <td>{row.period || '-'}</td>
              <td><span class="pill" class:pill--live={row.stage === 'Live'} class:pill--ended={row.stage === 'Ended'}>{row.stage}</span></td>
              <td>{sessionTeamWords(assignments, users, row.session)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style>
  .sessions__fresh td {
    background: var(--adm-green-wash);
  }

  .sessions__new {
    margin-inline-start: 0.5rem;
    font-weight: var(--fw-semibold);
  }

  .btn--with-icon {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }

  .part {
    display: grid;
    gap: 0.9rem;
  }

  .part__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  h3,
  h4 {
    margin: 0;
  }

  .plan {
    display: grid;
    gap: 0.75rem;
    padding: 1rem;
    border: 1px solid var(--adm-line);
    border-radius: 0.75rem;
  }

  .plan__fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 0.9rem;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 2.75rem;
  }

  .check input {
    width: 1.25rem;
    height: 1.25rem;
  }

  .sessions__scroll {
    overflow-x: auto;
  }

  .sessions {
    width: 100%;
    border-collapse: collapse;
  }

  .sessions th,
  .sessions td {
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid var(--adm-line);
    text-align: left;
    vertical-align: top;
  }

  .sessions__order {
    display: block;
  }

  .pill--live {
    color: var(--adm-ok-ink);
    background: var(--adm-ok-bg);
  }

  .pill--ended {
    color: var(--adm-muted);
  }


  .error {
    color: var(--adm-bad-ink);
  }
</style>
