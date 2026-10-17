<script lang="ts">
  import { FIRST_COMMENTS, WORDS_HEADING, segmentsOf } from '../../lib/results/results-chart-model.js';
  import { timeOf, type Chart } from './chart-ui.js';

  // Written answers: on the left, the words that came up most (repeated words, counted by comment: never "themes", and nothing made up), each a
  // button with its count; pressing one shows only the comments that hold it (press it again, or "All comments", to show them all). On the right,
  // the comments themselves, word for word, the chosen word in bold and underlined in each (never by colour alone), "Showing 3 of 12 comments", the
  // first 20 and then "Show more". On the admin view each comment says who wrote it and when; the wall display is given no names.
  // In full screen (`fit`) the card has a fixed height: the comments that do not fit are not drawn, and the card says how many.
  let { chart, chosen = null, onChoose, fit = false, headingLevel = 4 }: {
    chart: Chart;
    chosen?: string | null;
    onChoose?: (word: string | null) => void;
    fit?: boolean;
    headingLevel?: number;
  } = $props();

  let limit = $state(FIRST_COMMENTS);
  let list = $state<HTMLUListElement>();
  let more = $state(0);

  type Word = { word: string; count: number; commentIds: string[]; spans: Record<string, [number, number][]> };
  type Comment = { id: string; text: string; name: string | null; at: string | null };

  const words = $derived(chart.words as Word[]);
  const comments = $derived(chart.comments as Comment[]);
  const word = $derived(words.find((entry) => entry.word === chosen) ?? null);
  const filtered = $derived(word ? comments.filter((comment) => word.commentIds.includes(comment.id)) : comments);
  const visible = $derived(fit ? filtered : filtered.slice(0, limit));

  /** Comments that do not fit the card in full screen are not drawn (a comment cut in half reads as a mistake), and counted instead. */
  function measure() {
    if (!fit || !list) { more = 0; return; }
    const items = [...list.children] as HTMLElement[];
    for (const item of items) item.style.visibility = '';
    const bottom = list.getBoundingClientRect().bottom + 1;
    const cut = items.filter((item) => item.getBoundingClientRect().bottom > bottom);
    for (const item of cut) item.style.visibility = 'hidden';
    more = cut.length;
  }

  $effect(() => {
    void visible;
    const target = list;
    if (!target || !fit || typeof ResizeObserver === 'undefined') return;
    measure();
    const watch = new ResizeObserver(() => measure());
    watch.observe(target);
    return () => watch.disconnect();
  });

  const showing = $derived(fit
    ? `Showing ${filtered.length - more} of ${filtered.length} ${filtered.length === 1 ? 'comment' : 'comments'}`
    : `Showing ${visible.length} of ${filtered.length} ${filtered.length === 1 ? 'comment' : 'comments'}`);
</script>

<div class="words" class:words--fit={fit}>
  <div class="words__side">
    <svelte:element this={`h${headingLevel}`} class="words__heading">{WORDS_HEADING}</svelte:element>
    {#if words.length > 0}
      <ul class="words__list">
        {#each words as entry (entry.word)}
          <li>
            <button type="button" class="words__word" data-mark={entry.word} aria-pressed={chosen === entry.word} onclick={() => { limit = FIRST_COMMENTS; onChoose?.(chosen === entry.word ? null : entry.word); }}>
              <span class="words__term">{entry.word}</span>
              <span class="words__count">{entry.count}<span class="sr-only">{entry.count === 1 ? ' comment' : ' comments'}</span></span>
            </button>
          </li>
        {/each}
      </ul>
      {#if chosen}<button type="button" class="words__all" onclick={() => { limit = FIRST_COMMENTS; onChoose?.(null); }}>All comments</button>{/if}
    {:else}
      <p class="words__none">No word has come up in more than one comment yet.</p>
    {/if}
  </div>
  <div class="words__main">
    <p class="words__showing" aria-live="polite">{showing}{word ? ` with “${word.word}”` : ''}</p>
    {#if filtered.length === 0}
      <p class="words__none">No comments yet.</p>
    {:else}
      <ul class="words__comments" bind:this={list}>
        {#each visible as comment (comment.id)}
          <li class="words__comment">
            <p class="words__text">{#each segmentsOf(comment.text, word?.spans[comment.id] ?? []) as part, index (index)}{#if part.hit}<strong class="words__hit">{part.text}</strong>{:else}{part.text}{/if}{/each}</p>
            {#if comment.name}<p class="words__who">{comment.name}{comment.at ? ` · ${timeOf(comment.at)}` : ''}</p>{/if}
          </li>
        {/each}
      </ul>
      {#if fit && more > 0}<p class="words__more">{more === 1 ? '1 more written answer is not shown' : `${more} more written answers are not shown`}</p>{/if}
      {#if !fit && filtered.length > visible.length}<button type="button" class="words__all" onclick={() => { limit += FIRST_COMMENTS; }}>Show more</button>{/if}
    {/if}
  </div>
</div>

<style>
  /* Side by side when the card is wide enough, the words above the comments when it is not (flex-wrap, not a size query: Tailwind would read
     one as a class name and add a rule to the participant page). */
  .words {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: calc(1rem * var(--chart-scale, 1));
    font-size: calc(1rem * var(--chart-scale, 1));
  }

  .words__side {
    flex: 1 1 13rem;
    min-width: 0;
  }

  .words__main {
    flex: 2.2 1 22rem;
    min-width: 0;
  }

  .words__heading {
    margin: 0 0 0.5rem;
    color: var(--viz-text);
    font-size: 1em;
  }

  .words__list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .words__word,
  .words__all {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 44px;
    padding: 0 0.8rem;
    color: var(--viz-text);
    font: inherit;
    font-weight: 600;
    background: var(--viz-surface);
    border: 1px solid var(--viz-text-secondary);
    border-radius: 999px;
    cursor: pointer;
  }

  .words__word[aria-pressed='true'] {
    color: #fff;
    background: var(--viz-primary);
    border-color: var(--viz-primary);
  }

  .words__count {
    min-width: 1.6em;
    padding: 0 0.35rem;
    font-variant-numeric: tabular-nums;
    text-align: center;
    border: 1px solid currentcolor;
    border-radius: 999px;
  }

  .words__all {
    margin-top: 0.6rem;
    font-weight: 600;
  }

  .words__showing,
  .words__none,
  .words__more {
    margin: 0 0 0.5rem;
    color: var(--viz-text-secondary);
    font-size: 0.875em;
    font-weight: 600;
  }

  .words__comments {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .words__comment {
    padding: 0.6rem 0.85rem;
    background: var(--viz-band-shade);
    border-left: 3px solid var(--viz-grid);
    border-radius: 0 0.4rem 0.4rem 0;
  }

  .words__text {
    margin: 0;
    color: var(--viz-text);
    line-height: 1.45;
    overflow-wrap: anywhere;
    white-space: pre-line;
  }

  .words__hit {
    font-weight: 700;
    text-decoration-line: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 0.18em;
  }

  .words__who {
    margin: 0.3rem 0 0;
    color: var(--viz-text-secondary);
    font-size: 0.875em;
    font-weight: 600;
  }

  /* Full screen: the comments take the room that is left, in columns, and what does not fit is counted, not cut. The words sit beside them on a
     screen on its side, and above them on one held upright; either way the comments' room is what the card has left, never what they would need. */
  .words--fit {
    flex: 1 1 0;
    flex-wrap: nowrap;
    align-items: stretch;
    min-height: 0;
  }

  .words--fit .words__main {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  @media (orientation: portrait) {
    .words--fit {
      flex-direction: column;
    }

    .words--fit .words__side {
      flex: 0 0 auto;
    }

    .words--fit .words__main {
      flex: 1 1 0;
    }
  }

  /* Room for one comment at least: when the words leave less, the card is too tall, and the full screen makes the type smaller until one fits (a
     phone held upright had room for none, and said "Showing 0 of 4"). */
  .words--fit .words__comments {
    display: grid;
    flex: 1 1 0;
    grid-template-columns: repeat(auto-fill, minmax(calc(18rem * var(--chart-scale, 1)), 1fr));
    align-content: start;
    min-height: calc(5.5rem * var(--chart-scale, 1));
    overflow: hidden;
  }
</style>
