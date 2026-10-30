<script lang="ts">
  import GuestAvatar from '../../components/GuestAvatar.svelte';
  import MetricInfo from '../MetricInfo.svelte';
  import { timeOf, type Chart, type Who } from './chart-ui.js';

  // An Art of the Possible question's results (Prompt 23, board 17): a real grid of rows, with each criterion's average shaded in the blue ramp and written out, then its opportunity,
  // band, agreement and people. No chart library and no second page: every row is in the same grid. Every number is lib/results/results-chart-model.js's (and so aop-math.js's). A row
  // opens in place: the counts of each criterion and, for someone who may see names, who said High. The wall draws the same grid, with no names and nothing to open.
  type Row = Chart['rows'][number];
  let { chart, withNames = false, fit = false, level = 5 }: { chart: Chart; withNames?: boolean; fit?: boolean; level?: number } = $props();

  type Sort = 'opportunity' | 'people' | 'name' | 'order';
  let sort = $state<Sort>('opportunity');
  let group = $state('');
  let open = $state<string | null>(null);

  const view = $derived(group ? chart.views.find((each: { group: string }) => each.group === group) : null);
  const source = $derived<Row[]>(view ? view.rows : chart.rows);
  const rows = $derived.by(() => {
    const list = [...source];
    if (sort === 'people') return list.sort((left, right) => right.people - left.people || left.order - right.order);
    if (sort === 'name') return list.sort((left, right) => left.label.localeCompare(right.label));
    if (sort === 'order') return list.sort((left, right) => left.order - right.order);
    return list.sort((left, right) => (right.opportunity ?? -1) - (left.opportunity ?? -1) || right.people - left.people || left.order - right.order);
  });
  const columns = $derived(1 + (chart.criteria?.length ?? 0) + 4);
  const who = (cell: { who: Who[] }) => cell.who;
</script>

<div class="aop" class:aop--fit={fit}>
  {#if !fit}
    <div class="aop__tools">
      <label class="aop__tool"><span>Sort by</span>
        <select bind:value={sort}><option value="opportunity">Opportunity</option><option value="people">People</option><option value="name">Name</option><option value="order">Original order</option></select>
      </label>
      {#if chart.views.length > 0}
        <label class="aop__tool"><span>Show</span>
          <select bind:value={group}><option value="">All guests</option>{#each chart.views as each (each.group)}<option value={each.group}>{each.group} ({each.respondents})</option>{/each}</select>
        </label>
      {/if}
    </div>
  {/if}

  <div class="aop__scroll">
    <table class="aop__grid">
      <caption class="sr-only">{chart.prompt}</caption>
      <thead>
        <tr>
          <th scope="col">Sub-process</th>
          {#each chart.criteria as criterion (criterion.id)}<th scope="col" class="aop__n">{criterion.label}{#if criterion.direction === 'against'}{' '}<span class="aop__direction">(counts against)</span>{:else if criterion.direction === 'none'}{' '}<span class="aop__direction">(not in the score)</span>{/if}</th>{/each}
          <th scope="col" class="aop__n">Opportunity{#if !fit}<MetricInfo id="aop-opportunity" />{/if}</th>
          <th scope="col">Band{#if !fit}<MetricInfo id="aop-band" />{/if}</th>
          <th scope="col" class="aop__n">Agreement{#if !fit}<MetricInfo id="aop-agreement" />{/if}</th>
          <th scope="col" class="aop__n">People</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.id)}
          <tr data-row={row.id}>
            <th scope="row">
              {#if fit}{row.label}{:else}
                <button type="button" class="aop__open" aria-expanded={open === row.id} aria-controls={`aop-${chart.id}-${row.id}`} onclick={() => { open = open === row.id ? null : row.id; }}><span aria-hidden="true">{open === row.id ? '▾' : '▸'}</span> {row.label}</button>
              {/if}
              {#if row.single}<span class="aop__flag">1 guest</span>{/if}
            </th>
            {#each row.criteria as cell (cell.id)}
              <td class="aop__heat" data-tone={cell.tone}>{cell.meanText}</td>
            {/each}
            <td class="aop__n"><span class="aop__score">{row.opportunityText}</span>{#if row.opportunity !== null}<span class="aop__track" aria-hidden="true"><span style:width="{row.opportunity}%"></span></span>{/if}</td>
            <td class="aop__band" data-band={row.band}>{row.mark} {row.bandText}</td>
            <td class="aop__n">{row.agreementText}{#if row.split}{' '}<span class="aop__split">⚠ Split</span>{/if}</td>
            <td class="aop__n">{row.people}</td>
          </tr>
          {#if open === row.id && !fit}
            <tr class="aop__detail" id={`aop-${chart.id}-${row.id}`}>
              <td colspan={columns}>
                <svelte:element this={`h${level}`} class="aop__detail-title">{row.label}: {row.n} {row.n === 1 ? 'guest' : 'guests'} rated it</svelte:element>
                <ul class="aop__cells">
                  {#each row.criteria as cell (cell.id)}
                    <li>
                      <strong>{cell.label}</strong>: Low {cell.counts[1]}, Medium {cell.counts[2]}, High {cell.counts[3]}{#if cell.meanText}{' '}(average {cell.meanText}){/if}
                      {#if withNames && who(cell).length > 0}
                        <p class="aop__who">Who said High:</p>
                        <ul class="aop__names">
                          {#each who(cell) as person (person.key)}
                            <li>{#if 'picture' in person}<GuestAvatar src={person.picture} size={24} />{/if} {person.name} <span class="aop__when">{timeOf(person.at)}</span></li>
                          {/each}
                        </ul>
                      {/if}
                    </li>
                  {/each}
                </ul>
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>

  {#if !fit && !view}
    <section class="aop__where" data-testid="aop-where">
      <svelte:element this={`h${level}`} class="aop__where-title">Where to start</svelte:element>
      <p>{chart.where.line}.<MetricInfo id="aop-share" /><MetricInfo id="aop-people-high" /></p>
      {#if chart.where.start.length > 0}<ol class="aop__list">{#each chart.where.start as row (row.id)}<li>{row.label} ({row.people} {row.people === 1 ? 'person' : 'people'})</li>{/each}</ol>{/if}
      {#if chart.where.discuss.length > 0}
        <p><strong>Discuss: guests disagree</strong></p>
        <ul class="aop__list">{#each chart.where.discuss as row (row.id)}<li>{row.label} ({row.people} {row.people === 1 ? 'person' : 'people'})</li>{/each}</ul>
      {/if}
      <p class="aop__note">An average is out of 3.<MetricInfo id="aop-average" /></p>
    </section>
  {/if}
</div>

<style>
  .aop {
    display: grid;
    gap: 0.75rem;
    min-width: 0;
    font-size: calc(0.95rem * var(--chart-scale, 1));
  }

  .aop__tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .aop__tool {
    display: inline-flex;
    gap: 0.4rem;
    align-items: center;
    font-weight: 600;
  }

  .aop__tool select {
    min-height: 44px;
    color: var(--viz-text);
    font: inherit;
    background: var(--viz-surface);
    border: 1px solid var(--viz-text-secondary);
    border-radius: 0.4rem;
  }

  .aop__scroll {
    overflow-x: auto;
  }

  .aop__grid {
    width: 100%;
    color: var(--viz-text);
    border-collapse: collapse;
  }

  .aop__grid th,
  .aop__grid td {
    padding: 0.35rem 0.5rem;
    text-align: left;
    vertical-align: middle;
    border-bottom: 1px solid var(--viz-grid);
    overflow-wrap: anywhere;
  }

  .aop__grid thead th {
    color: var(--viz-text-secondary);
    font-size: 0.875em;
    font-weight: 700;
    vertical-align: bottom;
  }

  .aop__direction,
  .aop__flag,
  .aop__when,
  .aop__note {
    color: var(--viz-text-secondary);
    font-size: 0.875em;
    font-weight: 400;
  }

  .aop__flag {
    display: block;
  }

  .aop__n {
    text-align: right;
  }

  .aop__grid .aop__heat {
    min-width: 2.75rem;
    font-weight: 700;
    text-align: center;
  }

  .aop__heat[data-tone='0'] { color: var(--viz-text); background: var(--viz-ramp-4-1); }
  .aop__heat[data-tone='1'] { color: var(--viz-text); background: var(--viz-ramp-4-2); }
  .aop__heat[data-tone='2'] { color: var(--viz-surface); background: var(--viz-ramp-4-3); }
  .aop__heat[data-tone='3'] { color: var(--viz-surface); background: var(--viz-ramp-4-4); }

  .aop__score {
    font-weight: 700;
  }

  .aop__track {
    display: block;
    min-width: 3rem;
    height: 0.4rem;
    margin-top: 0.15rem;
    background: var(--viz-grid);
  }

  .aop__track span {
    display: block;
    height: 100%;
    background: var(--viz-primary);
  }

  .aop__band {
    font-weight: 700;
    white-space: nowrap;
  }

  .aop__band[data-band='High'] { color: var(--viz-band-high); }
  .aop__band[data-band='Medium'] { color: var(--viz-band-medium); }
  .aop__band[data-band='Low'] { color: var(--viz-band-low); }

  .aop__split {
    font-weight: 700;
    white-space: nowrap;
  }

  .aop__open {
    min-height: 44px;
    padding: 0;
    color: inherit;
    font: inherit;
    font-weight: 600;
    text-align: left;
    background: none;
    border: 0;
    cursor: pointer;
  }

  .aop__detail td {
    padding: 0.5rem 0.75rem;
    background: var(--viz-band-shade);
  }

  .aop__detail-title,
  .aop__where-title {
    margin: 0 0 0.35rem;
    font-size: 1em;
    font-weight: 700;
  }

  .aop__cells,
  .aop__names,
  .aop__list {
    margin: 0;
    padding-left: 1.2rem;
  }

  .aop__names {
    padding-left: 0;
    list-style: none;
  }

  .aop__names li {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    margin-top: 0.2rem;
  }

  .aop__who {
    margin: 0.25rem 0 0;
    font-weight: 600;
  }

  .aop__where p {
    margin: 0.25rem 0;
  }
</style>
