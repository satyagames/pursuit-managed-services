<script lang="ts">
  import { type Chart } from './chart-ui.js';

  // A chart's numbers, as rows and columns: the same numbers the chart draws and its tooltips say, readable without a pointer and by a screen
  // reader (the chart's accessible twin). Words on the left, numbers on the right. The correct answer is said only where the chart marks it.
  let { chart, marked }: { chart: Chart; marked: boolean } = $props();

  const note = (option: { isTop?: boolean; isCorrect?: boolean }) => [marked && option.isCorrect ? 'Correct' : '', option.isTop && chart.kind !== 'scale' ? 'Top choice' : ''].filter(Boolean).join(', ');
</script>

<div class="numbers">
  <table class="numbers__grid">
    <caption class="sr-only">{chart.prompt}</caption>
    {#if chart.kind === 'matrix'}
      <thead><tr><th scope="col">Sub-process</th>{#each chart.criteria as criterion (criterion.id)}<th scope="col" class="numbers__n">{criterion.label}</th>{/each}<th scope="col" class="numbers__n">Opportunity</th><th scope="col">Band</th><th scope="col" class="numbers__n">Agreement</th><th scope="col" class="numbers__n">People</th><th scope="col" class="numbers__n">Guests</th></tr></thead>
      <tbody>
        {#each chart.rows as row (row.id)}
          <tr><th scope="row">{row.label}</th>{#each row.criteria as cell (cell.id)}<td class="numbers__n">{cell.meanText}</td>{/each}<td class="numbers__n">{row.opportunityText}</td><td>{row.mark} {row.bandText}</td><td class="numbers__n">{row.agreementText}{row.split ? ' Split' : ''}</td><td class="numbers__n">{row.people}</td><td class="numbers__n">{row.n}</td></tr>
        {/each}
      </tbody>
    {:else if chart.kind === 'ranking'}
      <thead><tr><th scope="col">Rank and answer</th><th scope="col" class="numbers__n">Support score</th><th scope="col" class="numbers__n">Points</th><th scope="col" class="numbers__n">First places</th><th scope="col" class="numbers__n">People who ranked it</th></tr></thead>
      <tbody>
        {#each chart.options as item (item.id)}
          <tr><th scope="row">{item.rankLabel} {item.label}</th><td class="numbers__n">{item.score}</td><td class="numbers__n">{item.points}</td><td class="numbers__n">{item.firsts}</td><td class="numbers__n">{item.rankers}</td></tr>
        {/each}
      </tbody>
    {:else if chart.kind === 'text'}
      <thead><tr><th scope="col">Word</th><th scope="col" class="numbers__n">Comments</th></tr></thead>
      <tbody>
        {#each chart.words as entry (entry.word)}<tr><th scope="row">{entry.word}</th><td class="numbers__n">{entry.count}</td></tr>{/each}
        {#if chart.words.length === 0}<tr><td colspan="2">No word has come up in more than one comment yet.</td></tr>{/if}
      </tbody>
      <tfoot><tr><th scope="row">All comments</th><td class="numbers__n">{chart.comments.length}</td></tr></tfoot>
    {:else}
      <thead><tr><th scope="col">{chart.kind === 'scale' ? 'Step' : 'Answer'}</th><th scope="col" class="numbers__n">People</th><th scope="col" class="numbers__n">Share</th>{#if chart.kind !== 'scale'}<th scope="col">Note</th>{/if}</tr></thead>
      <tbody>
        {#each chart.options as option (option.id)}
          <tr><th scope="row">{option.label}</th><td class="numbers__n">{option.count}</td><td class="numbers__n">{option.percent}%</td>{#if chart.kind !== 'scale'}<td>{note(option)}</td>{/if}</tr>
        {/each}
      </tbody>
      <tfoot>
        <tr><th scope="row">Answered</th><td class="numbers__n">{chart.answered}</td><td></td>{#if chart.kind !== 'scale'}<td></td>{/if}</tr>
        {#if chart.kind === 'scale' && chart.scale.averageText}<tr><th scope="row">Average</th><td class="numbers__n" colspan="2">{chart.scale.average.toFixed(1)} of {chart.scale.top}</td></tr>{/if}
      </tfoot>
    {/if}
  </table>
</div>

<style>
  /* Nothing in a card scrolls (Phase 11a-2): the words wrap, so the numbers fit the card's width at every size the layout spec measures. */
  .numbers {
    max-width: 100%;
    font-size: calc(1rem * var(--chart-scale, 1));
  }

  .numbers__grid {
    width: 100%;
    border-collapse: collapse;
    color: var(--viz-text);
  }

  .numbers__grid th,
  .numbers__grid td {
    padding: 0.45rem 0.6rem;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid var(--viz-grid);
    overflow-wrap: anywhere;
  }

  .numbers__grid thead th {
    color: var(--viz-text-secondary);
    font-size: 0.875em;
    font-weight: 700;
  }

  .numbers__grid tbody th {
    font-weight: 600;
  }

  .numbers__grid tfoot th,
  .numbers__grid tfoot td {
    font-weight: 700;
    border-bottom: 0;
  }

  .numbers__grid .numbers__n {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  /* A number never breaks; a heading over a number may, onto as many lines as it needs, so that the view fits a phone's width. */
  .numbers__grid td.numbers__n {
    white-space: nowrap;
  }

  @media (max-width: 560px) {
    .numbers__grid th,
    .numbers__grid td {
      padding: 0.4rem 0.35rem;
    }
  }
</style>
