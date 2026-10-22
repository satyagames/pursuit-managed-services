<script lang="ts">
  // The body of Today's Readiness card, inside AdminToday.svelte's section and under its heading: the line that sums it up and one row per check,
  // each with its fix and where to go (Phase 17: moved out of AdminToday.svelte unchanged, its markup and its styles). The checks are
  // lib/admin/admin-today.js's evaluateReadiness; what a row's button does is AdminToday's.
  type Row = { id: string; level: string; title: string; detail: string; fix?: string; go?: { href?: string; label?: string; tab?: string; action?: string } };

  let { rows, summary, busy, onRowAction }: {
    rows: Row[];
    /** The line under the heading (lib/admin/today-view.js readinessSummary). */
    summary: string;
    busy: boolean;
    onRowAction: (row: Row) => void;
  } = $props();
</script>

<p class="muted ready__summary" data-testid="readiness-summary">
  {summary}
</p>
<ul class="checks">
  {#each rows as row (row.id)}
    <li class="check check--{row.level}" data-level={row.level} data-check={row.id}>
      <span class="check__word">{row.level === 'blocker' ? 'Blocker' : row.level === 'warning' ? 'Warning' : 'Ready'}</span>
      <div class="check__body">
        <strong>{row.title}</strong>
        <p>{row.detail}</p>
        {#if row.fix}<p class="check__fix">{row.fix}</p>{/if}
        {#if row.go}
          {#if row.go.href}<a class="btn btn--small" href={row.go.href}>{row.go.label}</a>
          {:else}<button class="btn btn--small" type="button" onclick={() => onRowAction(row)} disabled={busy}>{row.go.label}</button>{/if}
        {/if}
      </div>
    </li>
  {/each}
</ul>

<style>
  .ready__summary {
    margin: 0;
  }

  .checks {
    display: grid;
    gap: 0.6rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .check {
    display: grid;
    grid-template-columns: 5.2rem minmax(0, 1fr);
    gap: 0.75rem;
    padding: 0.75rem 0.85rem;
    border-radius: 0.7rem;
    border: 1px solid transparent;
  }

  .check p {
    margin: 0.15rem 0 0;
    overflow-wrap: anywhere;
  }

  .check__fix {
    font-weight: var(--fw-semibold);
  }

  .check__body {
    display: grid;
    justify-items: start;
    min-width: 0;
    gap: 0.1rem;
  }

  .check__body .btn {
    margin-top: 0.5rem;
  }

  .check__word {
    align-self: start;
    padding: 0.15rem 0.5rem;
    border-radius: var(--radius-full);
    background: var(--adm-card);
    font-size: 0.8rem;
    font-weight: var(--fw-bold);
    text-align: center;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .check--pass {
    padding-block: 0.55rem;
    color: var(--adm-ok-ink);
    background: var(--adm-ok-bg);
  }

  .check--warning {
    color: var(--adm-warn-ink);
    background: var(--adm-warn-bg);
  }

  .check--blocker {
    color: var(--adm-bad-ink);
    background: var(--adm-bad-bg);
    border-color: var(--adm-bad-line);
  }

  @media (max-width: 480px) {
    .check {
      grid-template-columns: 1fr;
      gap: 0.4rem;
    }

    .check__word {
      justify-self: start;
    }
  }
</style>
