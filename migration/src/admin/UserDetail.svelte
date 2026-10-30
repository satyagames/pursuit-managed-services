<script lang="ts">
  // One person (Prompt 21, Phase 2; board 4): their status, their global roles (Super admin, Admin, and the extra that lets an Admin add people), the
  // access they have to clients and sessions with Give access and Remove (the confirmation says what they lose), and their history from the audit
  // list. Every change goes through lib/access/people-ops.js and grants.js, so the guards of the data layer hold here too; a refusal is shown in
  // words. The rows are the list's: after a change the screen above reads them again.
  import { onMount } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { focusHeading } from '../lib/common/focus.js';
  import { can } from '../lib/access/can.js';
  import { EXTRAS } from '../lib/access/access-matrix.js';
  import { grantRole, revokeProblem } from '../lib/access/grants.js';
  import { dayWords, reachWords } from '../lib/access/people.js';
  import { historyOf, loseWords, removeRole, setExtras, setStatus } from '../lib/access/people-ops.js';
  import { errorText } from '../lib/admin/session-notice.js';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import GiveAccess from './GiveAccess.svelte';

  type Row = { key: string; name: string; email: string; status: string; assignments: any[] };
  let { access, person, users, assignments, clients, sessions, onBack, onChanged }: {
    access: any;
    person: Row;
    users: any[];
    assignments: any[];
    clients: any[];
    sessions: any[];
    onBack: () => void;
    /** Something changed: the screen above reads the lists again and says `words`. */
    onChanged: (words: string) => void;
  } = $props();

  let heading = $state<HTMLElement>();
  let busy = $state(false);
  let error = $state('');
  let confirm = $state<{ kind: 'remove'; assignment: any } | { kind: 'disable' } | null>(null);
  let giving = $state(false);
  let history = $state<{ id: string; day: string; words: string }[] | null>(null);
  let historyError = $state('');

  const at = $derived({ clients, sessions });
  const mine = $derived(assignments.filter((row) => row.userKey === person.key));
  const global = $derived(mine.filter((row) => row.scopeType === 'global' && (row.role === 'Super admin' || row.role === 'Admin')));
  const superRow = $derived(global.find((row) => row.role === 'Super admin') ?? null);
  const adminRow = $derived(global.find((row) => row.role === 'Admin') ?? null);
  const team = $derived(mine.filter((row) => !global.includes(row)));
  const own = $derived(person.key === access?.person?.key);
  const mayManage = $derived(can(access, 'users.manage', {}));
  const mayGlobal = $derived(can(access, 'roles.global', {}));
  const mayGive = $derived(can(access, 'team.assign', {}));
  const today = new Date().toISOString().slice(0, 10);
  const ended = (row: any) => Boolean(row.validUntil) && String(row.validUntil).slice(0, 10) < today;
  const names = $derived(Object.fromEntries(users.map((user) => [user.id, user.fullName || user.email || user.id])));
  const mayRemove = (row: any) => revokeProblem(access, row, assignments) === null;

  onMount(() => {
    focusHeading(heading);
    void dataService.listAccessRecords('auditlog')
      .then((lines) => { history = historyOf(lines, person.key, { names }); })
      .catch((cause) => { historyError = errorText(cause, 'Could not read the history.'); });
  });

  /** Runs one change: busy while it goes, its refusal in words, the screen above told when it worked. */
  async function run(change: () => Promise<string | null>) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      const words = await change();
      confirm = null;
      giving = false;
      if (words) onChanged(words);
    } catch (cause) {
      error = errorText(cause, 'Could not make this change.');
      confirm = null;
    } finally {
      busy = false;
    }
  }

  const makeSuperAdmin = () => run(async () => {
    const done = await grantRole(dataService, access, { userKey: person.key, role: 'Super admin', scopeType: 'global' });
    return done.already ? `${person.name} is a Super admin already.` : `${person.name} is now a Super admin.`;
  });
  const makeAdmin = () => run(async () => {
    const done = await grantRole(dataService, access, { userKey: person.key, role: 'Admin', scopeType: 'global' });
    return done.already ? `${person.name} is an Admin already.` : `${person.name} is now an Admin.`;
  });
  const remove = (assignment: any) => run(async () => {
    const done = await removeRole(dataService, access, assignment, assignments);
    return done.already ? `${person.name} did not have that access any more.` : `Removed ${assignment.role} from ${person.name}.`;
  });
  const switchExtra = (assignment: any, extra: string, on: boolean) => run(async () => {
    const wanted = (String(assignment.extras ?? '').split(/[\s,]+/).filter(Boolean)).filter((entry) => entry !== extra);
    if (on) wanted.push(extra);
    await setExtras(dataService, access, assignment, wanted, assignments);
    return `Changed what ${person.name} may do.`;
  });
  const turn = (status: 'Disabled' | 'Active') => run(async () => {
    await setStatus(dataService, access, person.key, status, { rows: { users, assignments } });
    return status === 'Disabled' ? `${person.name}'s access is turned off.` : `${person.name}'s access is turned on.`;
  });
</script>

<section class="panel" aria-labelledby="user-heading" aria-busy={busy}>
  <button class="btn" type="button" onclick={onBack}>Back to people</button>
  <header class="panel__head detail__head">
    <div>
      <h2 id="user-heading" bind:this={heading} tabindex="-1">{person.name}</h2>
      <p class="muted">{person.email}</p>
    </div>
    <div class="panel__actions">
      <span class="pill" class:pill--expired={person.status === 'Disabled'}>{person.status === 'Disabled' ? 'Turned off' : 'Active'}</span>
      {#if mayManage && !own}
        {#if person.status === 'Disabled'}
          <button class="btn" type="button" onclick={() => void turn('Active')} disabled={busy}>Turn access on</button>
        {:else}
          <button class="btn btn--danger" type="button" onclick={() => { confirm = { kind: 'disable' }; }} disabled={busy}>Turn access off</button>
        {/if}
      {/if}
    </div>
  </header>
  {#if own}<p class="muted" data-testid="own-note">This is you: you cannot change your own roles or turn off your own access.</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}

  <section class="detail__block" aria-labelledby="global-heading">
    <h3 id="global-heading">Roles for all clients</h3>
    <ul class="rows">
      <li class="row">
        <div class="row__main"><span class="row__title">Super admin</span><span class="muted small">{superRow ? 'Manages people, clients, sessions, content and results.' : 'Not a Super admin.'}</span></div>
        {#if mayGlobal && !own}
          {#if superRow}
            <button class="btn" type="button" onclick={() => { confirm = { kind: 'remove', assignment: superRow }; }} disabled={busy} aria-label="Remove Super admin from {person.name}">Remove</button>
          {:else}
            <button class="btn" type="button" onclick={() => void makeSuperAdmin()} disabled={busy} aria-label="Make {person.name} a Super admin">Make Super admin</button>
          {/if}
        {/if}
      </li>
      <li class="row">
        <div class="row__main">
          <span class="row__title">Admin</span>
          <span class="muted small">{adminRow ? 'Creates clients and sessions and chooses each team.' : 'Not an Admin.'}</span>
          {#if adminRow}
            <label class="detail__check">
              <input type="checkbox" checked={String(adminRow.extras ?? '').includes('users.manage')} disabled={busy || !mayGlobal || own}
                onchange={(event) => void switchExtra(adminRow, 'users.manage', event.currentTarget.checked)} />
              Also allowed to add people ({EXTRAS['users.manage'].words})
            </label>
          {/if}
        </div>
        {#if mayGlobal && !own}
          {#if adminRow}
            <button class="btn" type="button" onclick={() => { confirm = { kind: 'remove', assignment: adminRow }; }} disabled={busy} aria-label="Remove Admin from {person.name}">Remove</button>
          {:else}
            <button class="btn" type="button" onclick={() => void makeAdmin()} disabled={busy} aria-label="Make {person.name} an Admin">Make Admin</button>
          {/if}
        {/if}
      </li>
    </ul>
    {#if !mayGlobal}<p class="muted small">Only a Super admin can give or remove these.</p>{/if}
  </section>

  <section class="detail__block" aria-labelledby="access-heading">
    <div class="detail__line">
      <h3 id="access-heading">Access to clients and sessions</h3>
      {#if mayGive && !own}<button class="btn btn--primary" type="button" onclick={() => { giving = true; }} disabled={busy}>Give access</button>{/if}
    </div>
    {#if team.length === 0}
      <p class="muted" data-testid="no-access-rows">{person.name} has no access to any client or session yet.</p>
    {:else}
      <ul class="rows">
        {#each team as row (row.id)}
          <li class="row" data-testid="access-row">
            <div class="row__main">
              <span class="row__title">{row.role}</span>
              <span class="muted small">{reachWords(row, at)}{ended(row) ? ' (ended)' : ''}</span>
              {#if row.role === 'Designer'}
                <label class="detail__check">
                  <input type="checkbox" checked={String(row.extras ?? '').includes('content.edit')} disabled={busy || own || !mayRemove(row)}
                    onchange={(event) => void switchExtra(row, 'content.edit', event.currentTarget.checked)} />
                  May also edit activities
                </label>
              {/if}
            </div>
            {#if !own && mayRemove(row)}
              <button class="btn btn--danger" type="button" onclick={() => { confirm = { kind: 'remove', assignment: row }; }} disabled={busy} aria-label="Remove {row.role}, {reachWords(row, at)}">Remove</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="detail__block" aria-labelledby="history-heading">
    <h3 id="history-heading">History</h3>
    {#if historyError}<p class="error" role="alert">{historyError}</p>
    {:else if history === null}<p class="muted" role="status">Reading the history...</p>
    {:else if history.length === 0}<p class="muted">Nothing recorded yet.</p>
    {:else}
      <ul class="rows rows--flat" data-testid="history">
        {#each history as entry (entry.id)}<li class="row"><span class="muted small detail__day">{entry.day}</span><span>{entry.words}</span></li>{/each}
      </ul>
    {/if}
  </section>
</section>

{#if confirm?.kind === 'disable'}
  <ConfirmDialog title="Turn off {person.name}'s access?" lead="They will not be able to use the admin page." confirmLabel="Turn access off" tone="danger" {busy}
    points={['Their roles stay as they are, so turning access on again gives everything back.', 'They are not deleted, and what they did stays in the history.']}
    onConfirm={() => void turn('Disabled')} onCancel={() => { confirm = null; }} />
{:else if confirm?.kind === 'remove'}
  <ConfirmDialog title="Remove {confirm.assignment.role}?" lead={loseWords(confirm.assignment, person.name, at)} confirmLabel="Remove" tone="danger" {busy}
    points={['You can give the access again later.']}
    onConfirm={() => { if (confirm?.kind === 'remove') void remove(confirm.assignment); }} onCancel={() => { confirm = null; }} />
{/if}
{#if giving}
  <GiveAccess {access} person={{ key: person.key, name: person.name }} {clients} {sessions} onCancel={() => { giving = false; }} onDone={(words) => { giving = false; onChanged(words); }} />
{/if}

<style>
  .detail__head h2 {
    margin: 0;
  }

  .detail__block {
    display: grid;
    gap: 0.6rem;
    margin-top: 1.5rem;
  }

  .detail__block h3 {
    margin: 0;
    font-size: 1.1rem;
  }

  .detail__line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .detail__check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 44px;
  }

  .detail__day {
    min-width: 7rem;
  }
</style>
