<script lang="ts">
  import { metricWords } from '../lib/results/metric-words.js';

  // The i button beside every figure of the Leadership dashboard (Prompt 21, Phase 5; boards 9 and 12): hover or focus shows what the figure is, its
  // formula, what it means and an example, in the words of lib/results/metric-words.js; Escape hides them; the button names the figure for a screen reader,
  // and the words are its description. Pressing it keeps them open (a touch screen has no hover).
  let { id }: { id: string } = $props();
  const words = $derived(metricWords(id));
  // (Prompt 22: one figure's i is on a tile and beside every client and session, so each words' id is its own: an id is never on the page twice.)
  const uid = $props.id();
  const tipId = $derived(`metric-tip-${id}-${uid}`);
  let shown = $state(false);
  let pinned = $state(false);
</script>

{#if words}
  <span class="metric-info">
    <button class="metric-info__button" type="button" aria-label="About {words.label}" aria-describedby={tipId} aria-expanded={shown || pinned}
      onmouseenter={() => { shown = true; }} onmouseleave={() => { shown = false; }} onfocus={() => { shown = true; }} onblur={() => { shown = false; pinned = false; }}
      onclick={() => { pinned = !pinned; }} onkeydown={(event) => { if (event.key === 'Escape') { shown = false; pinned = false; } }}>i</button>
    <span class="metric-info__tip" id={tipId} role="tooltip" data-open={shown || pinned}>
      <strong>{words.label}</strong>
      <span>{words.formula}</span>
      <span>{words.meaning}</span>
      <span class="metric-info__example">For example: {words.example}</span>
    </span>
  </span>
{/if}

<style>
  .metric-info {
    position: relative;
    display: inline-flex;
    vertical-align: middle;
  }

  .metric-info__button {
    min-width: 44px;
    min-height: 44px;
    border: 0;
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-weight: 700;
    font-style: italic;
    cursor: pointer;
  }

  .metric-info__button::before {
    content: '';
    position: absolute;
    inset: 10px;
    border: 2px solid currentColor;
    border-radius: 50%;
    pointer-events: none;
  }

  .metric-info__tip {
    position: absolute;
    z-index: 5;
    top: 100%;
    left: 0;
    display: none;
    width: min(22rem, 80vw);
    padding: 0.75rem;
    border: 1px solid var(--ink);
    border-radius: 6px;
    background: #fff;
    color: var(--ink);
    font-size: 1rem;
    font-weight: 400;
    font-style: normal;
    line-height: 1.4;
    box-shadow: 0 4px 16px rgb(0 0 0 / 15%);
  }

  .metric-info__tip[data-open='true'] {
    display: grid;
    gap: 0.35rem;
  }

  .metric-info__example {
    color: var(--muted, #53565a);
  }
</style>
