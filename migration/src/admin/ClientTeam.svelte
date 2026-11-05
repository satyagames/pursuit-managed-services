<script lang="ts">
  // The Client team part of a client's page (Prompt 21, Phase 3; board 6): who has a Producer's, a Designer's or Leadership's role on the client or
  // on some of its sessions, Add (a role, a person registered in People, the whole client or selected sessions, a Designer's "may also edit
  // activities") and Remove, with a confirmation that says what they lose. Rules in lib/access/team.js (addToTeam, through grants.js grantRole) and
  // people-ops.js (removeRole, loseWords); each change writes its audit line. Only a person who may pick the team (team.assign: an Admin, a Super
  // admin) sees Add and Remove; the data layer's guard asks again.
  import { tick } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { focusHeading } from '../lib/common/focus.js';
  import { can } from '../lib/access/can.js';
  import { reachWords, sessionLabel } from '../lib/access/people.js';
  import { loseWords, removeRole } from '../lib/access/people-ops.js';
  import { TEAM_ROLES, addToTeam, teamCandidates, teamProblems, teamRows } from '../lib/access/team.js';
  import { errorText } from '../lib/admin/session-notice.js';
  import SiteAccessHandoff from './SiteAccessHandoff.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import IconButton from './IconButton.svelte';
  import Icon from './Icon.svelte';
  import EmailBox from './EmailBox.svelte';
  import EmailPanel from './EmailPanel.svelte';

  let { open = $bindable(false), client, access = null, sessions, users, assignments, preset = null, onChanged, onToast }: {
    client: { id: string; name: string };
    access?: any;
    /** The client's sessions. */
    sessions: any[];
    users: any[];
    assignments: any[];
    /** A session just planned with its own team: the form opens on it. */
    preset?: string | null;
    onChanged: (words: string) => void;
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
    /** (Prompt 33) Whether Add team member is open: the client's breadcrumb names it. */
    open?: boolean;
  } = $props();

  const mayAssign = $derived(Boolean(access) && can(access, 'team.assign', { clientId: client.id }));
  const team = $derived(teamRows(assignments, users, { clientId: client.id, sessions }));
  const choices = $derived([...sessions].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || String(a.startTime ?? '').localeCompare(String(b.startTime ?? ''))));

  let role = $state('Producer');
  let search = $state('');
  let userKey = $state('');
  let scope = $state<'client' | 'sessions'>('client');
  let sessionIds = $state<string[]>([]);
  let editActivities = $state(false);
  let submitted = $state(false);
  let busy = $state(false);
  let formError = $state('');
  let confirm = $state<any>(null);
  let lastPreset: string | null = null;
  /** The person just added or taken off the team, for their site access (Prompt 27): checked again after each change. */
  let lastAdded = $state('');
  let teamChanges = $state(0);
  const added = $derived(users.find((user) => user.id === lastAdded) ?? null);
  let heading = $state<HTMLElement>();
  /** (Prompt 28) "Email them about this", unticked each time the form or a confirmation opens; the message once a ticked change has saved. */
  let emailed = $state(false);
  let mail = $state<any>(null);
  const personOf = (key: string) => {
    const user = users.find((each) => each.id === key);
    return { key, name: user?.fullName ?? '', email: user?.email || (key.includes('@') ? key : '') };
  };
  const chosenEmail = $derived(personOf(userKey).email);

  const candidates = $derived(teamCandidates(users, search));
  const problems = $derived(teamProblems({ userKey, role, scope, sessionIds, editActivities }));

  function openForm(sessionId: string | null = null) {
    open = true;
    role = 'Producer';
    search = '';
    userKey = '';
    scope = sessionId ? 'sessions' : 'client';
    sessionIds = sessionId ? [sessionId] : [];
    editActivities = false;
    submitted = false;
    formError = '';
    emailed = false;
  }

  // A session planned with a team of its own opens the form on it, once.
  $effect(() => {
    if (preset && preset !== lastPreset && mayAssign) { lastPreset = preset; openForm(preset); void tick().then(() => focusHeading(heading)); }
  });

  const toggle = (id: string, on: boolean) => { sessionIds = on ? [...new Set([...sessionIds, id])] : sessionIds.filter((each) => each !== id); };

  async function add(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    submitted = true;
    const first = Object.values(problems)[0];
    if (first) { formError = first; return; }
    busy = true;
    formError = '';
    try {
      const done = await addToTeam(dataService, access, { clientId: client.id, userKey, role, scope, sessionIds, editActivities });
      open = false;
      lastAdded = userKey;
      teamChanges += 1;
      const name = users.find((user) => user.id === userKey)?.fullName || userKey;
      const places = scope === 'client' ? [client.name] : choices.filter((session) => sessionIds.includes(session.id)).map((session) => `${client.name}, ${sessionLabel(session)}`);
      mail = emailed && done.added && chosenEmail ? { kind: 'team-added', person: personOf(userKey), roles: [role], clients: places } : null;
      onChanged(done.added ? `${name} is on the team as ${role}` : `${name} already had that role`);
    } catch (cause) {
      formError = errorText(cause, 'Could not add this person.');
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!confirm || busy) return;
    busy = true;
    try {
      const done = await removeRole(dataService, access, confirm.assignment, assignments);
      lastAdded = confirm.assignment.userKey;
      teamChanges += 1;
      const words = done.removed ? `${confirm.name} removed from the team` : `${confirm.name} was already off the team`;
      const gone = confirm.assignment;
      mail = emailed && done.removed && personOf(gone.userKey).email ? { kind: 'removed', person: personOf(gone.userKey), roles: [gone.role], clients: [reachWords({ ...gone, validUntil: null }, { clients: [client], sessions })] } : null;
      confirm = null;
      onChanged(words);
    } catch (cause) {
      onToast(errorText(cause, 'Could not remove this role.'), 'error');
    } finally {
      busy = false;
    }
  }
</script>

<section class="part" aria-labelledby="team-heading">
  <div class="part__head">
    <h3 id="team-heading" bind:this={heading} tabindex="-1">Team</h3>
    {#if mayAssign}<button class="btn btn--primary btn--with-icon" type="button" onclick={() => openForm()} disabled={busy || open}><Icon name="plus" /> Add team member</button>{/if}
  </div>
  <p class="part__intro">Team: who runs, designs or looks at this client's sessions.</p>
  <p class="muted small">A Producer runs the sessions, a Designer edits the brand, Leadership sees the results. Give a role for the whole client, or only for some sessions.{mayAssign ? '' : ' An Admin chooses the team.'}</p>
  {#if added && access}<SiteAccessHandoff {access} person={added} {assignments} changed={teamChanges} />{/if}
  {#if mail && access}<EmailPanel {access} {mail} onClose={() => { mail = null; }} />{/if}

  {#if open}
    <form class="editor-form team-form" onsubmit={add} novalidate aria-labelledby="team-form-heading">
      <h4 id="team-form-heading">Add a team member to {client.name}</h4>
      <div class="field"><span class="field__line"><label class="field__label" for="team-role">Role</label><span class="field__required">Required</span></span>
        <select id="team-role" class="select" aria-required="true" bind:value={role} disabled={busy} onchange={() => { if (role !== 'Designer') editActivities = false; }}>
          {#each TEAM_ROLES as each (each)}<option value={each}>{each}</option>{/each}
        </select>
      </div>
      <div class="field"><label class="field__label" for="team-search">Search people</label>
        <input id="team-search" class="input" type="search" bind:value={search} disabled={busy} autocomplete="off" aria-describedby="team-search-help" />
        <span id="team-search-help" class="muted small">Only people added under People can be chosen. {candidates.length} match{candidates.length === 1 ? '' : 'es'}.</span>
      </div>
      <div class="field"><span class="field__line"><label class="field__label" for="team-person">Person</label><span class="field__required">Required</span></span>
        <select id="team-person" class="select" aria-required="true" bind:value={userKey} disabled={busy} aria-invalid={submitted && Boolean(problems.userKey)} aria-describedby={submitted && problems.userKey ? 'team-person-problem' : undefined}>
          <option value="">Choose a person</option>
          {#each candidates as user (user.id)}<option value={user.id}>{user.fullName || user.email || user.id} ({user.email || user.id})</option>{/each}
        </select>
        {#if submitted && problems.userKey}<span id="team-person-problem" class="error small">{problems.userKey}</span>{/if}
      </div>
      <fieldset class="field team-scope">
        <legend class="field__label">Where</legend>
        <label class="check"><input type="radio" name="team-scope" value="client" bind:group={scope} disabled={busy} /> Whole client</label>
        <label class="check"><input type="radio" name="team-scope" value="sessions" bind:group={scope} disabled={busy || sessions.length === 0} /> Selected sessions</label>
        {#if scope === 'sessions'}
          <div class="team-sessions" role="group" aria-label="Sessions" aria-describedby={submitted && problems.sessionIds ? 'team-sessions-problem' : undefined}>
            {#each choices as session (session.id)}
              <label class="check"><input type="checkbox" checked={sessionIds.includes(session.id)} onchange={(event) => toggle(session.id, (event.currentTarget as HTMLInputElement).checked)} disabled={busy} /> {sessionLabel(session)}</label>
            {/each}
          </div>
          {#if submitted && problems.sessionIds}<span id="team-sessions-problem" class="error small">{problems.sessionIds}</span>{/if}
        {/if}
      </fieldset>
      {#if role === 'Designer'}
        <label class="check"><input type="checkbox" bind:checked={editActivities} disabled={busy} /> May also edit activities</label>
      {/if}
      {#if formError}<p class="error" role="alert">{formError}</p>{/if}
      <EmailBox {access} email={chosenEmail} bind:checked={emailed} disabled={busy} />
      <div class="dialog__actions">
        <button class="btn" type="button" onclick={() => { open = false; }} disabled={busy}>Cancel</button>
        <button class="btn btn--primary" type="submit" disabled={busy}>{busy ? 'Adding...' : 'Add team member'}</button>
      </div>
    </form>
  {/if}

  {#if team.length === 0}
    <p class="muted">Nobody is on this client's team yet. Until someone is, only Super admins and Admins see this client.</p>
  {:else}
    <ul class="rows rows--flat" data-testid="client-team">
      {#each team as row (row.id)}
        <li class="row">
          <div class="row__main">
            <span class="row__title">{row.name} <span class="pill">{row.role}</span></span>
            <span class="muted small">{row.reach}{row.extras ? ` · ${row.extras}` : ''}</span>
          </div>
          {#if mayAssign}<IconButton icon="minus-circle" danger tip="Remove" label="Remove {row.role} for {client.name}{row.reach === 'Whole client' ? '' : `, ${row.reach}`} from {row.name}" disabled={busy} onclick={() => { emailed = false; confirm = row; }} />{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

{#if confirm}
  <ConfirmDialog title="Remove {confirm.name} from the team?" lead={loseWords(confirm.assignment, confirm.name, { clients: [client], sessions })} confirmLabel="Remove" tone="danger" {busy}
    onCancel={() => { confirm = null; }} onConfirm={() => void remove()}>
    <EmailBox {access} email={personOf(confirm.assignment.userKey).email} bind:checked={emailed} disabled={busy} />
  </ConfirmDialog>
{/if}

<style>
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

  .team-form {
    display: grid;
    gap: 0.75rem;
    padding: 1rem;
    border: 1px solid var(--adm-line);
    border-radius: 0.75rem;
  }

  .team-scope {
    border: 0;
    margin: 0;
    padding: 0;
  }

  .team-sessions {
    display: grid;
    gap: 0.25rem;
    padding-left: 1.75rem;
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

  .error {
    color: var(--adm-bad-ink);
  }
</style>
