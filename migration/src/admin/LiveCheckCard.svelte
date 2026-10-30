<script lang="ts">
  // The producer's card of the confidence check on the Live display (Phase 20, board 14): "Before 28 of 34", "After 0 of 34" and a thin bar
  // for each, so the facilitator knows when the room is ready. Counts only, from the answers the Live display already reads (no request of its
  // own): no name and no score, and never on the wall. lib/admin/live-view.js checkProgress() works the figures out.
  import { checkProgress } from '../lib/admin/live-view.js';

  let { check }: { check: Parameters<typeof checkProgress>[0] } = $props();
  const progress = $derived(checkProgress(check));
</script>

{#if progress}
  <section class="check-card" aria-labelledby="check-card-title" data-testid="live-check-card">
    <h3 id="check-card-title" class="check-card__title">Confidence check, this session</h3>
    {#each [['Before', progress.before], ['After', progress.after]] as const as [label, phase] (label)}
      <div class="check-card__row">
        <span class="check-card__label">{label}</span>
        <span class="check-card__track" aria-hidden="true"><span class="check-card__fill" style:width={`${phase.percent}%`}></span></span>
        <strong class="check-card__count">{phase.count} of {progress.guests}</strong>
      </div>
    {/each}
    <p class="muted small check-card__note">Counts only: no names and no scores.</p>
  </section>
{/if}

<style>
  .check-card {
    display: grid;
    gap: 0.4rem;
    max-width: 32rem;
    margin: 0 0 1rem;
    padding: 0.75rem 1rem;
    background: var(--viz-surface);
    border: 1px solid var(--viz-grid);
    border-radius: 0.5rem;
  }

  .check-card__title {
    margin: 0;
    font-size: 1rem;
  }

  .check-card__row {
    display: grid;
    grid-template-columns: 4rem minmax(0, 1fr) auto;
    gap: 0.75rem;
    align-items: center;
  }

  .check-card__track {
    height: 0.875rem;
    background: var(--viz-band-shade);
    border: 1px solid var(--viz-grid);
  }

  .check-card__fill {
    display: block;
    height: 100%;
    background: var(--viz-primary);
  }

  .check-card__note {
    margin: 0;
  }
</style>
