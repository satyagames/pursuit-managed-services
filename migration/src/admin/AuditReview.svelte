<script lang="ts">
  // History of changes (Prompt 21, Phase 7): a Super admin's read-only review of the audit list (decision J), opened from People. It reads PMSAuditLog once
  // (as a person's history does) and filters it here (lib/access/audit-review.js: what was done, a person, from and to, 50 lines a page). Nothing on it
  // writes: a line is never changed or removed from the page, and the list's own permissions hold the same (lib/setup/list-permissions.js).
  import { onMount } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { focusHeading } from '../lib/common/focus.js';
  import { AUDIT_FILTERS, auditView } from '../lib/access/audit-review.js';
  import { errorText } from '../lib/admin/session-notice.js';

  let { users, onBack }: { users: any[]; onBack: () => void } = $props();

  let lines = $state<any[]>([]);
  let loading = $state(true);
  let error = $state('');
  let heading = $state<HTMLElement>();
  let action = $state('');
  let person = $state('');
  let from = $state('');
  let to = $state('');
  let page = $state(1);

  const names = $derived(Object.fromEntries(users.map((user) => [String(user.id).toLowerCase(), user.fullName || user.email || user.id])));
  const view = $derived(auditView(lines, { names, action, person, from, to, page }));
  const filtering = $derived(Boolean(action || person.trim() || from || to));
  const clear = () => { action = ''; person = ''; from = ''; to = ''; page = 1; };

  onMount(() => {
    void (dataService.listAccessRecords('auditlog') as Promise<any[]>)
      .then((read) => { lines = read; })
      .catch((cause) => { error = errorText(cause, 'Could not read the history of changes.'); })
      .finally(() => { loading = false; focusHeading(heading); });
  });
</script>

<section class="panel" aria-labelledby="audit-heading" aria-busy={loading}>
  <button class="btn" type="button" onclick={onBack}>Back to people</button>
  <header class="panel__head">
    <div>
      <h2 id="audit-heading" bind:this={heading} tabindex="-1">History of changes</h2>
      <p class="muted">Every time access was given, removed, turned off or on, and every person added, newest first. Nothing here can be changed.</p>
    </div>
  </header>

  {#if loading}<p class="muted" role="status">Reading the history of changes...</p>
  {:else if error}<p class="error" role="alert">{error}</p>
  {:else}
    <div class="audit__bar">
      <div class="field"><label class="field__label" for="audit-action">What was done</label>
        <select id="audit-action" class="input" bind:value={action} onchange={() => { page = 1; }}>
          {#each AUDIT_FILTERS as choice (choice.id)}<option value={choice.id}>{choice.label}</option>{/each}
        </select></div>
      <div class="field"><label class="field__label" for="audit-person">Person</label>
        <input id="audit-person" class="input" type="search" autocomplete="off" bind:value={person} oninput={() => { page = 1; }} placeholder="Who did it, or to whom" /></div>
      <div class="field"><label class="field__label" for="audit-from">From</label>
        <input id="audit-from" class="input" type="date" bind:value={from} onchange={() => { page = 1; }} /></div>
      <div class="field"><label class="field__label" for="audit-to">To</label>
        <input id="audit-to" class="input" type="date" bind:value={to} onchange={() => { page = 1; }} /></div>
    </div>

    <p class="muted" role="status" data-testid="audit-count">
      {#if view.total === 0}{lines.length === 0 ? 'Nothing recorded yet.' : 'No change matches.'}{:else}Showing {(view.page - 1) * 50 + 1} to {(view.page - 1) * 50 + view.rows.length} of {view.total} {view.total === 1 ? 'change' : 'changes'}.{/if}
      {#if filtering}<button class="btn" type="button" onclick={clear}>Clear filters</button>{/if}
    </p>

    {#if view.rows.length}
      <ul class="rows rows--flat" aria-label="Changes" data-testid="audit-lines">
        {#each view.rows as row (row.id)}
          <li class="row">
            <div class="row__main">
              <span class="row__title">{row.did}{row.target ? `: ${row.target}` : ''}</span>
              <span class="muted small">{row.day}, by {row.who}{row.place ? `. Where: ${row.place}` : ''}</span>
            </div>
          </li>
        {/each}
      </ul>
      {#if view.pages > 1}
        <nav class="audit__pages" aria-label="Pages of changes">
          <button class="btn" type="button" onclick={() => { page = view.page - 1; }} disabled={view.page <= 1}>Previous</button>
          <span>Page {view.page} of {view.pages}</span>
          <button class="btn" type="button" onclick={() => { page = view.page + 1; }} disabled={view.page >= view.pages}>Next</button>
        </nav>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .audit__bar {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .audit__pages {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    margin-top: 1rem;
  }
</style>
