<script lang="ts">
  // One person (Prompt 21, Phase 2; board 4): their status, their global roles (Super admin, Admin, and the extra that lets an Admin add people), the
  // access they have to clients and sessions with Give access and Remove (the confirmation says what they lose), and their history from the audit
  // list. Every change goes through lib/access/people-ops.js and grants.js, so the guards of the data layer hold here too; a refusal is shown in
  // words. The rows are the list's: after a change the screen above reads them again.
  import { onMount } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { focusHeading } from '../lib/common/focus.js';
  import { can } from '../lib/access/can.js';
  import { grantRole, revokeProblem } from '../lib/access/grants.js';
  import { dayWords, reachWords } from '../lib/access/people.js';
  import { historyOf, loseWords, removeRole, setExtras, setStatus } from '../lib/access/people-ops.js';
  import { errorText } from '../lib/admin/session-notice.js';
  import ConfirmDialog from './ui/ConfirmDialog.svelte';
  import GiveAccess from './GiveAccess.svelte';
  import SiteAccessHandoff from './SiteAccessHandoff.svelte';
  import EmailBox from './EmailBox.svelte';
  import EmailPanel from './EmailPanel.svelte';
  import { MANAGED_GROUPS, desiredGroups, groupIds } from '../lib/access/site-access.js';
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';
  import Breadcrumb from './ui/Breadcrumb.svelte';
  import Fold from './ui/Fold.svelte';
  import RoleSwitch from './RoleSwitch.svelte';

  type Row = { key: string; name: string; email: string; status: string; assignments: any[] };
  let { access, person, users, assignments, clients, sessions, waiting = null, onBack, onChanged, startGiving = false }: {
    access: any;
    person: Row;
    users: any[];
    assignments: any[];
    clients: any[];
    sessions: any[];
    /** (Prompt 28) Whether the People page's site check found them waiting for their groups; null when it was not checked. */
    waiting?: boolean | null;
    onBack: () => void;
    /** Something changed: the screen above reads the lists again and says `words`. */
    onChanged: (words: string) => void;
    /** (Prompt 38) Opened from the list's Give access: Give access opens at once. */
    startGiving?: boolean;
  } = $props();

  let heading = $state<HTMLElement>();
  let busy = $state(false);
  let error = $state('');
  let confirm = $state<{ kind: 'remove'; assignment: any } | { kind: 'disable' } | null>(null);
  let giving = $state(false);
  $effect(() => { if (startGiving) giving = true; });
  let history = $state<{ id: string; day: string; words: string }[] | null>(null);
  let historyError = $state('');
  /** (Prompt 28) "Email them about this": the page's box, for the changes made with one press, and the confirmation's; both unticked every time. */
  let pageEmail = $state(false);
  let confirmEmail = $state(false);
  let mail = $state<any>(null);
  let settled = $state(false);
  const waitingNow = $derived(settled ? false : waiting);
  const who = $derived({ key: person.key, name: person.name, email: person.email });
  const placeOf = (row: any) => (row.scopeType === 'global' ? 'all' : [reachWords({ ...row, validUntil: null }, at).replace(/^All clients/, 'all clients')]);
  /** The message's input for a change, when its box was ticked. */
  const mailFor = (ticked: boolean, kind: string, rows: any[] = []) => (ticked && person.email
    ? { kind, person: who, roles: [...new Set(rows.map((row) => row.role))], clients: rows.some((row) => row.scopeType === 'global') ? 'all' : rows.flatMap((row) => placeOf(row)), endDate: rows.length === 1 ? rows[0].validUntil ?? '' : '' }
    : null);
  const ask = (next: typeof confirm) => { confirmEmail = false; confirm = next; };

  const at = $derived({ clients, sessions });
  const mine = $derived(assignments.filter((row) => row.userKey === person.key));
  const global = $derived(mine.filter((row) => row.scopeType === 'global' && (row.role === 'Super admin' || row.role === 'Admin')));
  const superRow = $derived(global.find((row) => row.role === 'Super admin') ?? null);
  const adminRow = $derived(global.find((row) => row.role === 'Admin') ?? null);
  const team = $derived(mine.filter((row) => !global.includes(row)));
  const own = $derived(person.key === access?.person?.key);
  const mayManage = $derived(can(access, 'users.manage', {}));
  const mayGlobal = $derived(can(access, 'roles.global', {}));
  /** (Prompt 27) Counts the changes made here, so the site access line checks again after each; and what Turn off also does to the site's groups. */
  let synced = $state(0);
  let offGroups = $state('');
  $effect(() => {
    if (confirm?.kind !== 'disable' || !mayGlobal) { offGroups = ''; return; }
    const keys = desiredGroups({ id: person.key, status: 'Active' }, assignments);
    void groupIds(dataService).then((ids: any) => { offGroups = ids?.sync && keys.length ? ` This also removes them from ${keys.map((key) => ids[key]?.title ?? MANAGED_GROUPS[key]).join(' and ')}.` : ''; });
  });
  const mayGive = $derived(can(access, 'team.assign', {}));
  const today = new Date().toISOString().slice(0, 10);
  const ended = (row: any) => Boolean(row.validUntil) && String(row.validUntil).slice(0, 10) < today;
  const names = $derived(Object.fromEntries(users.map((user) => [user.id, user.fullName || user.email || user.id])));
  const mayRemove = (row: any) => revokeProblem(access, row, assignments) === null;
  /** (Prompt 33) Why a role-for-all-clients switch cannot move, in the guards' own words (lib/access/grants.js); '' when it can. */
  const switchWhy = (row: any) => (own ? 'You cannot change your own roles.'
    : !mayGlobal ? 'Only a Super admin can give or remove roles for all clients.'
    : row ? (revokeProblem(access, row, assignments) ?? '') : '');
  /** Turning a role for all clients on gives it at once; turning it off asks first, as Remove did. */
  const flip = (row: any, give: () => Promise<void>) => (row ? ask({ kind: 'remove', assignment: row }) : void give());
  const historySummary = $derived(history === null ? (historyError ? 'could not be read' : 'reading') : history.length === 0 ? 'none yet'
    : `${history.length} ${history.length === 1 ? 'entry' : 'entries'}, latest ${history[0].day}`);

  onMount(() => {
    focusHeading(heading);
    void dataService.listAccessRecords('auditlog')
      .then((lines) => { history = historyOf(lines, person.key, { names }); })
      .catch((cause) => { historyError = errorText(cause, 'Could not read the history.'); });
  });

  /** Runs one change: busy while it goes, its refusal in words, the screen above told when it worked. */
  async function run(change: () => Promise<string | null>, mailIf: any = null) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      const words = await change();
      confirm = null;
      giving = false;
      if (words) { synced += 1; mail = mailIf; onChanged(words); }
      pageEmail = false;
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
  }, mailFor(pageEmail, 'given', [{ role: 'Super admin', scopeType: 'global' }]));
  const makeAdmin = () => run(async () => {
    const done = await grantRole(dataService, access, { userKey: person.key, role: 'Admin', scopeType: 'global' });
    return done.already ? `${person.name} is an Admin already.` : `${person.name} is now an Admin.`;
  }, mailFor(pageEmail, 'given', [{ role: 'Admin', scopeType: 'global' }]));
  const remove = (assignment: any) => run(async () => {
    const done = await removeRole(dataService, access, assignment, assignments);
    return done.already ? `${person.name} did not have that access any more.` : `Removed ${assignment.role} from ${person.name}.`;
  }, mailFor(confirmEmail, 'removed', [assignment]));
  const switchExtra = (assignment: any, extra: string, on: boolean) => run(async () => {
    const wanted = (String(assignment.extras ?? '').split(/[\s,]+/).filter(Boolean)).filter((entry) => entry !== extra);
    if (on) wanted.push(extra);
    await setExtras(dataService, access, assignment, wanted, assignments);
    return `Changed what ${person.name} may do.`;
  }, mailFor(pageEmail, 'changed', [assignment]));
  const turn = (status: 'Disabled' | 'Active') => run(async () => {
    await setStatus(dataService, access, person.key, status, { rows: { users, assignments } });
    return status === 'Disabled' ? `${person.name}'s access is turned off.` : `${person.name}'s access is turned on.`;
  }, status === 'Disabled' ? mailFor(confirmEmail, 'off') : mailFor(pageEmail, 'on', mine.filter((row) => !ended(row))));
</script>

<section class="panel" aria-labelledby="user-heading" aria-busy={busy}>
  <Breadcrumb parts={[{ label: 'People', onclick: onBack }, { label: person.name }]} />
  <button class="btn btn--back" type="button" onclick={onBack}><Icon name="arrow-left" /> Back to people</button>
  <header class="panel__head detail__head">
    <div>
      <h2 id="user-heading" bind:this={heading} tabindex="-1"><Icon name="users" />{person.name}</h2>
      <p class="muted">{person.email}: what they may do, for all clients and for each client.</p>
    </div>
    <div class="panel__actions">
      <span class="pill" class:pill--expired={person.status === 'Disabled'}>{person.status === 'Disabled' ? 'Turned off' : 'Active'}</span>
      {#if mayManage && !own}
        {#if person.status === 'Disabled'}
          <button class="btn" type="button" onclick={() => void turn('Active')} disabled={busy}>Turn access on</button>
        {:else}
          <button class="btn btn--danger" type="button" onclick={() => ask({ kind: 'disable' })} disabled={busy}>Turn access off</button>
        {/if}
      {/if}
    </div>
  </header>
  {#if own}<p class="muted" data-testid="own-note">This is you: you cannot change your own roles or turn off your own access.</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <SiteAccessHandoff {access} person={{ id: person.key, email: person.email, status: person.status }} {assignments} changed={synced} bind:settled />
  {#if mail}<EmailPanel {access} mail={{ ...mail, waiting: waitingNow }} onClose={() => { mail = null; }} />{/if}
  {#if !own && (mayGlobal || mayManage)}<EmailBox {access} email={person.email} bind:checked={pageEmail} disabled={busy} />{/if}

  <section class="detail__block" aria-labelledby="global-heading">
    <h3 id="global-heading">Roles for all clients</h3>
    <ul class="rows">
      <li class="row">
        <div class="row__main"><span class="row__title">Super admin</span><span class="muted">Manages people, clients, sessions, content and results.</span></div>
        <RoleSwitch role="Super admin" on={Boolean(superRow)} {busy} disabled={Boolean(switchWhy(superRow))} reason={switchWhy(superRow)} onflip={() => flip(superRow, makeSuperAdmin)} />
      </li>
      <li class="row">
        <div class="row__main">
          <span class="row__title">Admin</span>
          <span class="muted">Creates clients and sessions and chooses each team.</span>
          {#if adminRow}
            <label class="detail__check">
              <input type="checkbox" checked={String(adminRow.extras ?? '').includes('users.manage')} disabled={busy || !mayGlobal || own}
                onchange={(event) => void switchExtra(adminRow, 'users.manage', event.currentTarget.checked)} />
              Also allowed to add people
            </label>
          {/if}
        </div>
        <RoleSwitch role="Admin" on={Boolean(adminRow)} {busy} disabled={Boolean(switchWhy(adminRow))} reason={switchWhy(adminRow)} onflip={() => flip(adminRow, makeAdmin)} />
      </li>
    </ul>
  </section>

  <section class="detail__block" aria-labelledby="access-heading">
    <div class="detail__line">
      <h3 id="access-heading">Access to clients and sessions</h3>
      {#if mayGive && !own}<button class="btn btn--primary" type="button" onclick={() => { giving = true; }} disabled={busy}><Icon name="key" /> Give access</button>{/if}
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
              <IconButton icon="minus-circle" danger tip="Remove" label="Remove {row.role} for {reachWords(row, at)} from {person.name}" disabled={busy} onclick={() => ask({ kind: 'remove', assignment: row })} />
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <Fold title="History of changes" icon="clock" summary={historySummary} testid="person-history">
    {#if historyError}<p class="error" role="alert">{historyError}</p>
    {:else if history === null}<p class="muted" role="status">Reading the history...</p>
    {:else if history.length === 0}<p class="muted">Nothing recorded yet.</p>
    {:else}
      <ul class="rows rows--flat" data-testid="history">
        {#each history as entry (entry.id)}<li class="row"><span class="muted small detail__day">{entry.day}</span><span>{entry.words}</span></li>{/each}
      </ul>
    {/if}
  </Fold>
</section>

{#if confirm?.kind === 'disable'}
  <ConfirmDialog title="Turn off {person.name}'s access?" lead={`They will not be able to use the admin page.${offGroups}`} confirmLabel="Turn access off" tone="danger" {busy}
    points={['Their roles stay as they are, so turning access on again gives everything back.', 'They are not deleted, and what they did stays in the history.']}
    onConfirm={() => void turn('Disabled')} onCancel={() => { confirm = null; }}>
    <EmailBox {access} email={person.email} bind:checked={confirmEmail} disabled={busy} />
  </ConfirmDialog>
{:else if confirm?.kind === 'remove'}
  <ConfirmDialog title="Remove {confirm.assignment.role} from {person.name}?" lead={loseWords(confirm.assignment, person.name, at)} confirmLabel="Remove" tone="danger" {busy}
    points={['You can give the access again later.']}
    onConfirm={() => { if (confirm?.kind === 'remove') void remove(confirm.assignment); }} onCancel={() => { confirm = null; }}>
    <EmailBox {access} email={person.email} bind:checked={confirmEmail} disabled={busy} />
  </ConfirmDialog>
{/if}
{#if giving}
  <GiveAccess {access} person={{ key: person.key, name: person.name, email: person.email }} {clients} {sessions} onCancel={() => { giving = false; }} onDone={(words, given) => { giving = false; synced += 1; mail = given; onChanged(words); }} />
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

  .btn--back {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
</style>
