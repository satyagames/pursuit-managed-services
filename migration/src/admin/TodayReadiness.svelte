<script lang="ts">
  // The body of Today's Readiness card, inside AdminToday.svelte's section and under its heading. Prompt 38: one summary line first ("Ready to go
  // live", "2 things to fix"), then the blockers, then the warnings, each with its fix and where to go; the checks that passed fold into one line
  // ("6 checks passed") that opens on a press, at every width. Each level has its own icon shape and word as well as its wash, never colour alone.
  // The checks are lib/admin/admin-today.js's evaluateReadiness; what a row's button does is AdminToday's.
  import Icon, { type IconName } from './Icon.svelte';

  type Row = { id: string; level: string; title: string; detail: string; fix?: string; go?: { href?: string; label?: string; tab?: string; action?: string } };

  let { rows, summary, busy, onRowAction }: {
    rows: Row[];
    /** The line that sums it up (lib/admin/today-view.js readinessSummary). */
    summary: string;
    busy: boolean;
    onRowAction: (row: Row) => void;
  } = $props();

  const blockers = $derived(rows.filter((row) => row.level === 'blocker'));
  const warnings = $derived(rows.filter((row) => row.level === 'warning'));
  const open = $derived([...blockers, ...warnings]);
  const ready = $derived(rows.filter((row) => row.level === 'pass'));
  let showReady = $state(false);
  const readyWord = $derived(`${ready.length} ${ready.length === 1 ? 'check' : 'checks'} passed`);
  const LEVEL: Record<string, { icon: IconName; word: string }> = {
    blocker: { icon: 'alert-octagon', word: 'Blocker' }, warning: { icon: 'alert-triangle', word: 'Warning' }, pass: { icon: 'check-circle', word: 'Ready' },
  };
  const summaryIcon = $derived<IconName>(blockers.length ? 'alert-octagon' : warnings.length ? 'alert-triangle' : 'check-circle');
  const summaryTone = $derived(blockers.length ? 'blocker' : warnings.length ? 'warning' : 'pass');
</script>

{#snippet check(row: Row)}
  <li class="check check--{row.level}" data-level={row.level} data-check={row.id}>
    <span class="check__mark"><Icon name={LEVEL[row.level]?.icon ?? 'info'} /></span>
    <div class="check__body">
      <span class="check__word">{LEVEL[row.level]?.word ?? row.level}</span>
      <strong>{row.title}</strong>
      <p>{row.detail}</p>
      {#if row.fix}<p class="check__fix">{row.fix}</p>{/if}
      {#if row.go}
        {#if row.go.href}<a class="btn btn--small" href={row.go.href}>{row.go.label}</a>
        {:else}<button class="btn btn--small" type="button" onclick={() => onRowAction(row)} disabled={busy}>{row.go.label}</button>{/if}
      {/if}
    </div>
  </li>
{/snippet}

<p class="ready__summary ready__summary--{summaryTone}" data-testid="readiness-summary"><Icon name={summaryIcon} />{summary}</p>
{#if open.length}
  <ul class="checks">
    {#each open as row (row.id)}{@render check(row)}{/each}
  </ul>
{/if}
{#if ready.length}
  <button class="checks__fold" type="button" aria-expanded={showReady} aria-controls="ready-checks" onclick={() => { showReady = !showReady; }}>
    <Icon name={showReady ? 'chevron-down' : 'chevron-right'} /><span>{readyWord}</span><span class="checks__show">{showReady ? 'Hide' : 'Show'}</span>
  </button>
  <ul class="checks checks--ready" class:checks--folded={!showReady} id="ready-checks">
    {#each ready as row (row.id)}{@render check(row)}{/each}
  </ul>
{/if}

<style>
  .ready__summary {
    display: flex;
    align-items: center;
    gap: var(--adm-s2);
    margin: 0;
    font-size: var(--adm-fs-h2);
    line-height: var(--adm-lh-h2);
    font-weight: var(--fw-semibold);
    color: var(--adm-ink);
  }

  .ready__summary--pass :global(.icon) { color: var(--adm-ok); }
  .ready__summary--warning :global(.icon) { color: var(--adm-warn); }
  .ready__summary--blocker :global(.icon) { color: var(--adm-danger); }

  .checks__fold {
    display: flex;
    align-items: center;
    gap: var(--adm-s2);
    width: 100%;
    min-height: var(--target-min);
    padding: 0 var(--adm-s3);
    border: 1px solid var(--adm-line);
    border-radius: var(--adm-radius-sm);
    background: var(--adm-surface-2);
    color: var(--adm-ink);
    font: inherit;
    font-weight: var(--fw-semibold);
    text-align: start;
    cursor: pointer;
  }

  .checks__show {
    margin-inline-start: auto;
    color: var(--adm-link); /* (Prompt 41: the primary is 4.36:1 on the stripe; its shade 6.0:1) */
  }

  .checks.checks--folded {
    display: none;
  }

  .checks {
    display: grid;
    gap: var(--adm-s2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .check {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--adm-s3);
    padding: var(--adm-s3) var(--adm-s4);
    border-radius: var(--adm-radius-sm);
    color: var(--adm-ink);
  }

  .check p {
    margin: var(--adm-s1) 0 0;
    overflow-wrap: anywhere;
  }

  .check__fix {
    font-weight: var(--fw-semibold);
  }

  .check__body {
    display: grid;
    justify-items: start;
    min-width: 0;
  }

  .check__body .btn {
    margin-top: var(--adm-s2);
  }

  .check__mark {
    padding-top: 2px;
  }

  .check__word {
    font-size: var(--adm-fs-label);
    line-height: var(--adm-lh-label);
    font-weight: var(--fw-semibold);
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  .check--pass {
    background: var(--adm-ok-wash);
  }

  .check--pass .check__mark,
  .check--pass .check__word {
    color: var(--adm-ok-ink);
  }

  .check--warning {
    background: var(--adm-warn-wash);
  }

  .check--warning .check__mark,
  .check--warning .check__word {
    color: var(--adm-warn-ink);
  }

  .check--blocker {
    background: var(--adm-danger-wash);
  }

  .check--blocker .check__mark,
  .check--blocker .check__word {
    color: var(--adm-danger-ink);
  }
</style>
