<script lang="ts">
  import type { Problem } from '../lib/deploy-problems.js';

  // "This copy of the app": the first thing on Setup, read-only (Phase 10b). The rows are lib/setup-deployment.js copyRows(), made
  // from what the page really worked out as it started, each with where it came from. When the page could not tell which lists are
  // its own, the problem is here in full, with the two ways to put it right. Only Setup loads this.
  let { rows, trouble = null, ways = [] }: {
    rows: { label: string; value: string; source: string }[];
    /** The problem in its six parts, when there is one. */
    trouble?: Problem | null;
    /** The two ways to name this copy's lists: shown with a problem. */
    ways?: string[];
  } = $props();
</script>

<section class="copy" aria-labelledby="copy-heading">
  <h2 id="copy-heading">1. This copy of the app</h2>
  {#if trouble}
    <div class="copy-problem" role="alert" data-problem={trouble.id}>
      <h3>{trouble.title}</h3>
      <p>{trouble.what}</p>
      <p>{trouble.next}</p>
      {#if ways.length}
        <p>There are two ways to say which lists are this copy's:</p>
        <ol>
          {#each ways as way (way)}<li>{way}</li>{/each}
        </ol>
      {/if}
      <p>Everything below is switched off until this is put right, so that nothing is read from or written to the wrong lists.</p>
      <p class="copy-small">Who to ask: {trouble.who}</p>
      <p class="copy-small">Details: {trouble.technical}</p>
    </div>
  {:else}
    <p class="copy-small">What these pages are using, and where each value came from. Nothing here can be changed on this screen.</p>
  {/if}
  <dl class="copy-rows">
    {#each rows as row (row.label)}
      <div class="copy-row">
        <dt>{row.label}</dt>
        <dd><span class="copy-value">{row.value}</span>{#if row.source}{' '}<span class="copy-source">({row.source})</span>{/if}</dd>
      </div>
    {/each}
  </dl>
</section>

<style>
  /* (Addresses and file names are long words: they break wherever they must, so that a phone never scrolls sideways.) */
  .copy { overflow-wrap: anywhere; }

  .copy-problem {
    margin: 0 0 1rem;
    padding: 0.75rem 1rem;
    border: 2px solid var(--adm-bad-line, currentColor);
    border-radius: 8px;
    color: var(--adm-bad-ink, inherit);
    background: var(--adm-bad-bg, transparent);
  }

  .copy-problem h3 { margin: 0 0 0.5rem; font-size: 1.1rem; }
  .copy-problem p,
  .copy-problem ol { margin: 0 0 0.5rem; }
  .copy-problem li { margin-bottom: 0.35rem; }
  .copy-small { font-size: 1rem; }

  .copy-rows { margin: 0; }

  .copy-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--line, currentColor);
  }

  dt {
    flex: 0 0 9.5rem;
    font-weight: 600;
  }

  dd {
    flex: 1 1 16rem;
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
  }

  .copy-source { color: var(--muted, inherit); }
</style>
