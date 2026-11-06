<script lang="ts">
  // The Live display's cards when it is not full screen: one block per activity, its title and a card per question (Phase 17: moved out of
  // LiveDisplay.svelte unchanged, its markup and its styles). Which answers are open, which are shown and whose names appear are LiveDisplay's;
  // this draws them and hands each press back.
  import ResultCard from './charts/ResultCard.svelte';
  import type { Chart } from './charts/chart-ui.js';

  let { chartSections, wall, withNames, revealed, selected, scale, onToggleAnswer, onSelect }: {
    /** The charts by activity (lib/results/results-chart-model.js chartsOf). */
    chartSections: { id: string; title: string; charts: Chart[] }[];
    wall: boolean;
    withNames: boolean;
    revealed: Record<string, boolean>;
    selected: Record<string, string | null>;
    scale: number;
    onToggleAnswer: (questionId: string) => void;
    onSelect: (questionId: string, id: string | null) => void;
  } = $props();
</script>

<div class="live__sections">
  {#each chartSections as section (section.id)}
    <section class="live-section">
      <h3 class="live-section__title">{section.title}</h3>
      <div class="live-section__grid">
        {#each section.charts as chart (chart.id)}
          <ResultCard {chart} {wall} {withNames} marked={!wall || !!revealed[chart.id]} onToggleAnswer={() => onToggleAnswer(chart.id)} selected={selected[chart.id] ?? null} onSelect={(id) => onSelect(chart.id, id)} {scale} level={4} />
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .live__sections {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  /* Each activity's band (Prompt 34, as Prompt 33's group headers): its title in the deep green on the pale green wash. */
  .live-section__title {
    margin: 0 0 1rem;
    padding: 0.5rem 1rem;
    color: var(--adm-deep);
    font-size: 1.2rem;
    background: var(--adm-green-wash);
    border-radius: 0.5rem;
  }

  /* Each card keeps its own height, at the top of its row (Phase 11a-2: a card stretched to the height of its neighbour whose names were open). */
  .live-section__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 34rem), 1fr));
    align-items: start;
    gap: 1.25rem;
  }
</style>
