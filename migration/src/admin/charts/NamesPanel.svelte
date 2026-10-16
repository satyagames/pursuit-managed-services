<script lang="ts">
  import { people } from '../../lib/results-chart-model.js';
  import { placeName, timeOf, type Who } from './chart-ui.js';

  // Who picked an answer (admin view only): under its card, "Who picked: 1014 Vine Street, Cincinnati (2 people)" and each name with the time they
  // answered. The names are lib/participant-names.js's, as on the Results rows and in the report ("Unnamed participant 2", "Mike A (2)"), and there
  // are as many as the chart counts. For a ranking it is everyone who ranked the answer, with the place they gave it. Esc or the close button closes
  // it, and focus goes back to the bar that opened it (the card does that). The wall display never has one.
  let { id, label, who, ranking = false, headingLevel = 4, onClose }: {
    id: string;
    label: string;
    who: Who[];
    ranking?: boolean;
    headingLevel?: number;
    onClose: () => void;
  } = $props();

  const headingId = $derived(`${id}-heading`);
</script>

<section class="names" {id} aria-labelledby={headingId} data-testid="names-panel">
  <div class="names__head">
    <svelte:element this={`h${headingLevel}`} class="names__heading" id={headingId}>{ranking ? 'How people ranked' : 'Who picked'}: {label} ({people(who.length)})</svelte:element>
    <button type="button" class="names__close" aria-label="Close the names" onclick={onClose}>
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></svg>
    </button>
  </div>
  {#if who.length === 0}
    <p class="names__none">{ranking ? 'Nobody has ranked this yet.' : 'Nobody picked this.'}</p>
  {:else}
    <ul class="names__list">
      {#each who as person (person.key)}
        <li class="names__person">
          <span class="names__name">{person.name}</span>
          <span class="names__when">{ranking && person.place ? `${placeName(person.place)}${person.at ? ' · ' : ''}` : ''}{timeOf(person.at)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .names {
    margin-top: calc(0.75rem * var(--chart-scale, 1));
    padding: 0.75rem 1rem;
    color: var(--viz-text);
    background: var(--viz-surface);
    border: 1px solid var(--viz-text-secondary);
    border-radius: 0.5rem;
  }

  .names__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .names__heading {
    margin: 0;
    font-size: 1rem;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .names__close {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    margin: -0.5rem -0.6rem 0 0;
    color: var(--viz-text);
    background: transparent;
    border: 0;
    border-radius: 0.4rem;
    cursor: pointer;
  }

  .names__close svg {
    width: 1rem;
    height: 1rem;
    fill: none;
    stroke: currentcolor;
    stroke-width: 2;
    stroke-linecap: round;
  }

  .names__list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
    gap: 0.35rem 1.25rem;
    margin: 0.5rem 0 0;
    padding: 0;
    list-style: none;
  }

  .names__person {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0 0.75rem;
    padding: 0.3rem 0;
    border-bottom: 1px solid var(--viz-grid);
  }

  .names__name {
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .names__when,
  .names__none {
    color: var(--viz-text-secondary);
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
  }

  .names__none {
    margin: 0.5rem 0 0;
  }
</style>
