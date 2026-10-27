<script lang="ts">
  // A session's confidence check on Results (Phase 20): Confidence shift and Moved to confident with "N of M guests answered both", and the
  // Before and After bars of every step of the scale. Every number is lib/results/confidence-shift.js's (the session's results carry it as
  // `confidenceCheck`); nothing is counted here. No name. Before and After are told apart by their words and by lightness, never colour alone.
  import { checkSummary, type ConfidenceCheck } from '../lib/results/confidence-shift.js';

  let { check }: { check: ConfidenceCheck } = $props();
  const summary = $derived(checkSummary(check));
  const whole = (value: number) => `${Math.round(value)}%`;
</script>

<section class="shift" aria-labelledby={`shift-${check.sectionId}`} data-testid="confidence-shift">
  <h3 class="shift__title" id={`shift-${check.sectionId}`}>Confidence check</h3>
  {#if !summary.measured}
    <p class="shift__line"><strong>Confidence shift:</strong> not measured <span class="muted small">(the check is switched off for this session)</span></p>
  {:else}
    <dl class="shift__figures">
      <div><dt>Confidence shift</dt><dd><strong>{summary.shift}</strong>{#if summary.from} <span class="muted small">({summary.from})</span>{/if}</dd></div>
      <div><dt>Moved to confident</dt><dd>{summary.moved || '-'}</dd></div>
    </dl>
    <p class="muted small shift__answered">{summary.answered}{#if summary.lowSample} · <span class="tag">Low sample</span>{/if}</p>
    {#if check.distribution.length}
      <table class="shift__bars">
        <caption class="muted small">Before and After: the share of guests on each step ({check.answeredBefore} Before, {check.answeredAfter} After)</caption>
        <thead><tr><th scope="col">Step</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
        <tbody>
          {#each check.distribution as row (row.value)}
            <tr>
              <th scope="row">{row.value} {check.labels[row.value - 1] ?? ''}</th>
              <td><span class="shift__bar shift__bar--before" style:width={whole(row.beforePercent)} aria-hidden="true"></span> {row.before} ({whole(row.beforePercent)})</td>
              <td><span class="shift__bar shift__bar--after" style:width={whole(row.afterPercent)} aria-hidden="true"></span> {row.after} ({whole(row.afterPercent)})</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}
</section>

<style>
  .shift {
    display: grid;
    gap: 0.5rem;
    margin: 0.75rem 0;
    padding: 0.75rem 1rem;
    color: var(--viz-text);
    background: var(--viz-surface);
    border: 1px solid var(--viz-grid);
    border-radius: 0.5rem;
  }

  .shift__title,
  .shift__line,
  .shift__answered {
    margin: 0;
  }

  .shift__title {
    font-size: 1rem;
  }

  .shift__figures {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 2rem;
    margin: 0;
  }

  .shift__figures dt {
    color: var(--viz-text-secondary);
    font-size: 0.875rem;
  }

  .shift__figures dd {
    margin: 0;
    font-size: 1.125rem;
  }

  .shift__bars {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }

  .shift__bars th,
  .shift__bars td {
    padding: 0.2rem 0.5rem 0.2rem 0;
    text-align: left;
    vertical-align: middle;
    border-bottom: 1px solid var(--viz-grid);
  }

  .shift__bars td {
    width: 35%;
    white-space: nowrap;
  }

  .shift__bar {
    display: inline-block;
    max-width: 60%;
    height: 0.75rem;
    vertical-align: middle;
  }

  .shift__bar--before {
    background: var(--viz-primary-tint);
  }

  .shift__bar--after {
    background: var(--viz-primary);
  }
</style>
