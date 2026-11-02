<script lang="ts">
  // Users (Prompt 21, Phase 2; boards 3 and 4): the people who may use the admin page, and what each may do. Shown to a Super admin, to an Admin
  // (who may look, and give team roles) and to nobody else (the menu comes from the role matrix: AdminApp.svelte). It reads the four lists once, as an index (people, their
  // assignments, the names of clients and sessions: lib/admin/list-index.js), filters them here (lib/access/people.js: role chips, search, Client and Session, Status, pages of 5) and
  // opens one person (UserDetail.svelte) or Add user (UserAdd.svelte). A change reads the lists again. A Super admin also opens History of changes
  // (AuditReview.svelte, Prompt 21, Phase 7: the audit list, read only).
  import { onMount } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { focusHeading } from '../lib/common/focus.js';
  import { can } from '../lib/access/can.js';
  import { PAGE_SIZE, ROLE_CHIPS, filterPeople, pageOf, peopleRows, sessionsOfClient } from '../lib/access/people.js';
  import { errorText } from '../lib/admin/session-notice.js';
  import { PEOPLE_INDEX } from '../lib/admin/list-index.js';
  import { hashWithPage, pageOfHash, pagerState } from '../lib/common/paging.js';
  import Pager from './Pager.svelte';
  import UserAdd from './UserAdd.svelte';
  import UserDetail from './UserDetail.svelte';
  import AuditReview from './AuditReview.svelte';
  import SiteAccessDrift from './SiteAccessDrift.svelte';

  let { access, onToast }: {
    access: any;
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
  } = $props();

  let users = $state<any[]>([]);
  let assignments = $state<any[]>([]);
  let clients = $state<any[]>([]);
  let sessions = $state<any[]>([]);
  let loading = $state(true);
  let error = $state('');
  let heading = $state<HTMLElement>();
  let chip = $state('all');
  let search = $state('');
  let clientId = $state('');
  let sessionId = $state('');
  let status = $state('all');
  let page = $state(pageOfHash(window.location.hash));
  let openKey = $state<string | null>(null);
  let adding = $state(false);
  let reviewing = $state(false);

  const mayAdd = $derived(can(access, 'users.manage', {}));
  const mayReview = $derived(can(access, 'audit.view', {}));
  const everyone = $derived(peopleRows(users, assignments, { clients, sessions }));
  const shown = $derived(filterPeople(everyone, { chip, search, status, clientId, sessionId, sessions }));
  const paged = $derived(pageOf(shown, page));
  const where = $derived(pagerState({ total: shown.length, pageSize: PAGE_SIZE, page }));
  const goTo = (next: number) => { page = next; };
  // The page is kept in the address, so a reload comes back to it (a filter that goes back to the first page too).
  $effect(() => {
    const hash = hashWithPage(window.location.hash, where.page);
    if (hash !== window.location.hash) try { window.history.replaceState(window.history.state, '', hash); } catch { /* the page still changes */ }
  });
  const clientChoices = $derived([...clients].sort((a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id))));
  const sessionChoices = $derived(sessionsOfClient(sessions, clientId));
  const open = $derived(openKey ? everyone.find((row) => row.key === openKey) ?? null : null);
  const filtering = $derived(chip !== 'all' || Boolean(search.trim()) || Boolean(clientId) || status !== 'all');

  async function load() {
    const [people, rows, clientRows, sessionRows] = await dataService.readLists(PEOPLE_INDEX as never) as unknown as any[][];
    users = [...people].sort((a, b) => String(a.fullName || a.email || a.id).localeCompare(String(b.fullName || b.email || b.id)));
    assignments = rows;
    clients = clientRows;
    sessions = sessionRows;
  }

  onMount(() => {
    void load().catch((cause) => { error = errorText(cause, 'Could not load the people.'); }).finally(() => { loading = false; focusHeading(heading); });
  });

  const changed = (words: string) => {
    void load().then(() => onToast(words, 'success')).catch((cause) => { error = errorText(cause, 'Could not read the people again.'); });
  };
  const choose = (next: string) => { chip = next; page = 1; };
  const clear = () => { chip = 'all'; search = ''; clientId = ''; sessionId = ''; status = 'all'; page = 1; };
</script>

{#if reviewing}
  <AuditReview {users} onBack={() => { reviewing = false; }} />
{:else if open}
  <UserDetail {access} person={open} {users} {assignments} {clients} {sessions} onBack={() => { openKey = null; }} onChanged={changed} />
{:else}
  <section class="panel" aria-labelledby="users-heading" aria-busy={loading}>
    <header class="panel__head">
      <div>
        <h2 id="users-heading" bind:this={heading} tabindex="-1">People</h2>
        <p class="muted">Who can use the admin page, and what each person may do. Roles are given to a person for all clients, one client or one session.</p>
      </div>
      <div class="panel__actions">
        {#if mayReview}<button class="btn" type="button" onclick={() => { reviewing = true; }}>History of changes</button>{/if}
        {#if mayAdd}<button class="btn btn--primary" type="button" onclick={() => { adding = true; }}>Add user</button>{/if}
      </div>
    </header>

    {#if loading}<p class="muted" role="status">Loading people...</p>
    {:else if error}<p class="error" role="alert">{error}</p>
    {:else}
      {#if can(access, 'roles.global', {})}<SiteAccessDrift {users} {assignments} />{/if}
      <div class="users__bar">
        <div class="field"><label class="field__label" for="users-search">Search people</label>
          <input id="users-search" class="input" type="search" autocomplete="off" bind:value={search} oninput={() => { page = 1; }} placeholder="Name or email" /></div>
        <div class="field"><label class="field__label" for="users-client">Client</label>
          <select id="users-client" class="input" bind:value={clientId} onchange={() => { sessionId = ''; page = 1; }}>
            <option value="">All clients</option>
            {#each clientChoices as client}<option value={client.id}>{client.name ?? client.id}</option>{/each}
          </select></div>
        <div class="field"><label class="field__label" for="users-session">Session</label>
          <select id="users-session" class="input" bind:value={sessionId} onchange={() => { page = 1; }} disabled={!clientId}>
            <option value="">{clientId ? 'All sessions' : 'Choose a client first'}</option>
            {#each sessionChoices as session}<option value={session.id}>{session.label}</option>{/each}
          </select></div>
        <div class="field"><label class="field__label" for="users-status">Status</label>
          <select id="users-status" class="input" bind:value={status} onchange={() => { page = 1; }}>
            <option value="all">All</option><option value="Active">Active</option><option value="Disabled">Turned off</option>
          </select></div>
      </div>
      <div class="users__chips" role="group" aria-label="Show people by role">
        {#each ROLE_CHIPS as each (each.id)}
          <button class="btn users__chip" type="button" aria-pressed={chip === each.id} onclick={() => choose(each.id)}>{each.label}</button>
        {/each}
      </div>

      <p class="muted" role="status" data-testid="users-count">
        {#if shown.length === 0}No one matches.{:else}Showing {(paged.page - 1) * PAGE_SIZE + 1} to {(paged.page - 1) * PAGE_SIZE + paged.items.length} of {shown.length} {shown.length === 1 ? 'person' : 'people'}.{/if}
        {#if filtering}<button class="btn" type="button" onclick={clear}>Clear filters</button>{/if}
      </p>

      {#if everyone.length === 0}
        <p class="muted">No one has been added yet.{mayAdd ? ' Use Add user to start.' : ''}</p>
      {:else}
        <ul class="rows" aria-label="People">
          {#each paged.items as row (row.key)}
            <li class="row" data-testid="user-row">
              <div class="row__main">
                <span class="row__title">{row.name}
                  {#if row.status === 'Disabled'}<span class="pill pill--expired">Turned off</span>{/if}
                </span>
                <span class="muted small">{row.email}</span>
                <span class="small">{row.roles.length ? row.roles.join(', ') : 'No access yet'}{row.reach.length ? `: ${row.reach.join('; ')}` : ''}</span>
              </div>
              <button class="btn" type="button" onclick={() => { openKey = row.key; }} aria-label="Open {row.name}">Open</button>
            </li>
          {/each}
        </ul>
        <Pager state={where} label="Pages of people" {heading} onPage={goTo} />
      {/if}
    {/if}
  </section>
{/if}

{#if adding}
  <UserAdd {access} onCancel={() => { adding = false; }}
    onDone={(key, already) => { adding = false; void load().then(() => { openKey = key; onToast(already ? 'That person is in the list already.' : 'Added. Now give them access.', 'success'); }); }} />
{/if}

<style>
  .users__bar {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .users__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 0.75rem;
  }

  .users__chip[aria-pressed='true'] {
    border-color: var(--ink);
    background: var(--ink);
    color: #fff;
  }

</style>
