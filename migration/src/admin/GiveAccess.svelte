<script lang="ts">
  // Give access (Prompt 21, Phase 2; board 4): an existing person gets a role on one client or one session, with an optional end date. It is not
  // "Add user": the person is already in the list. A Super admin may also give Leadership for all clients in a period (decision F). The rules are
  // lib/access/grants.js's (grantProblem says what is wrong in words, before anything is sent; grantRole writes the row and its audit line).
  import { onMount } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { can } from '../lib/access/can.js';
  import { grantProblem, grantRole } from '../lib/access/grants.js';
  import { sessionsOfClient } from '../lib/access/people.js';
  import { siteAccessNote } from '../lib/access/access-words.js';
  import { errorText } from '../lib/admin/session-notice.js';

  type Client = { id: string; name?: string };
  type Session = { id: string; clientId?: string; date?: string; title?: string; startTime?: string };
  let { access, person, clients, sessions, onDone, onCancel }: {
    access: any;
    person: { key: string; name: string };
    clients: Client[];
    sessions: Session[];
    onDone: (words: string) => void;
    onCancel: () => void;
  } = $props();

  const ROLE_CHOICES = ['Producer', 'Designer', 'Leadership'];
  let dialog = $state<HTMLDialogElement>();
  let role = $state('Producer');
  let place = $state<'client' | 'session' | 'period'>('client');
  let clientId = $state('');
  let sessionId = $state('');
  let periodFrom = $state('');
  let periodTo = $state('');
  let validUntil = $state('');
  let editsActivities = $state(false);
  let submitted = $state(false);
  let busy = $state(false);
  let error = $state('');

  const mayPeriod = $derived(can(access, 'roles.global', {}));
  const periodOffered = $derived(role === 'Leadership' && mayPeriod);
  const clientChoices = $derived([...clients].sort((a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id))));
  const sessionChoices = $derived(sessionsOfClient(sessions, clientId));
  const wanted = $derived({
    userKey: person.key, role, scopeType: place, clientId: place === 'client' ? clientId : undefined, sessionId: place === 'session' ? sessionId : undefined,
    periodFrom: place === 'period' ? periodFrom : undefined, periodTo: place === 'period' ? periodTo : undefined,
    validUntil: validUntil || undefined, extras: role === 'Designer' && editsActivities ? 'content.edit' : '',
  });
  const problem = $derived(grantProblem(access, wanted));
  const siteNote = $derived(siteAccessNote(role, { person, me: access?.person }));

  onMount(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      queueMicrotask(() => { if (opener?.isConnected) opener.focus(); });
    };
  });

  $effect(() => { if (place === 'period' && !periodOffered) place = 'client'; });
  $effect(() => { if (role !== 'Designer') editsActivities = false; });

  async function give(event: SubmitEvent) {
    event.preventDefault();
    submitted = true;
    if (problem || busy) return;
    busy = true;
    error = '';
    try {
      const done = await grantRole(dataService, access, wanted);
      if (done.already) { error = `${person.name} already has this access.`; busy = false; return; }
      onDone(`${person.name} now has ${role} access.${siteNote ? ` ${siteNote}` : ''}`);
    } catch (cause) {
      error = errorText(cause, 'Could not give this access.');
      busy = false;
    }
  }
</script>

<dialog bind:this={dialog} class="dialog" aria-labelledby="give-title" oncancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
  <form class="give" onsubmit={give} novalidate>
    <h2 id="give-title">Give access to {person.name}</h2>
    <label class="field"><span class="field__label">Role</span>
      <select class="input" bind:value={role} disabled={busy}>{#each ROLE_CHOICES as choice}<option value={choice}>{choice}</option>{/each}</select>
    </label>
    <label class="field"><span class="field__label">Where</span>
      <select class="input" bind:value={place} disabled={busy}>
        <option value="client">One client</option>
        <option value="session">One session</option>
        {#if periodOffered}<option value="period">All clients, for a period</option>{/if}
      </select>
    </label>
    {#if place !== 'period'}
      <label class="field"><span class="field__label">Client</span>
        <select class="input" bind:value={clientId} onchange={() => { sessionId = ''; }} disabled={busy}>
          <option value="">Choose a client</option>
          {#each clientChoices as client}<option value={client.id}>{client.name ?? client.id}</option>{/each}
        </select>
      </label>
    {/if}
    {#if place === 'session'}
      <label class="field"><span class="field__label">Session</span>
        <select class="input" bind:value={sessionId} disabled={busy || !clientId}>
          <option value="">{clientId ? 'Choose a session' : 'Choose a client first'}</option>
          {#each sessionChoices as session}<option value={session.id}>{session.label}</option>{/each}
        </select>
      </label>
    {/if}
    {#if place === 'period'}
      <div class="give__pair">
        <label class="field"><span class="field__label">First day</span><input class="input" type="date" bind:value={periodFrom} disabled={busy} /></label>
        <label class="field"><span class="field__label">Last day</span><input class="input" type="date" bind:value={periodTo} disabled={busy} /></label>
      </div>
    {/if}
    {#if role === 'Designer'}
      <label class="give__check"><input type="checkbox" bind:checked={editsActivities} disabled={busy} /> May also edit activities (a Designer edits the brand)</label>
    {/if}
    <label class="field"><span class="field__label">Access ends on (optional)</span>
      <input class="input" type="date" bind:value={validUntil} disabled={busy} aria-describedby="give-ends" />
      <span id="give-ends" class="muted small">The last day they can use it. Leave empty for no end date.</span>
    </label>
    {#if submitted && problem}<p class="error" role="alert">{problem}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if siteNote}<p class="muted small" data-testid="site-access-note">{siteNote}</p>{/if}
    <div class="dialog__actions">
      <button class="btn" type="button" onclick={onCancel} disabled={busy}>Cancel</button>
      <button class="btn btn--primary" type="submit" disabled={busy}>{busy ? 'Giving...' : 'Give access'}</button>
    </div>
  </form>
</dialog>

<style>
  .give {
    display: grid;
    gap: 0.9rem;
    padding: 1.5rem;
  }

  .give h2 {
    margin: 0;
    font-size: 1.35rem;
  }

  .give__pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }

  .give__check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 44px;
  }
</style>
