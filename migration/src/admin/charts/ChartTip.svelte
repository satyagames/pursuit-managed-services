<script lang="ts">
  import { around, placeTip } from '../../lib/results/tip-place.js';
  import type { Tip } from './chart-ui.js';

  // The tooltip of a chart's mark: its value first, its label second. Since Phase 11a-2 it is drawn in a layer fixed to the window, so nothing can cut it
  // off: not its card, not its chart, not a box that scrolls (on the real site a confidence question's tooltip was cut in half by its own chart). It sits
  // next to its mark, clear of the mark and of the mark's own label (above them, or under them when there is no room above), moved along so that it stays
  // inside the window (lib/results/tip-place.js), clear of its card's words and buttons, and then of the other marks' figures, where there is room (Phase 11a-3), and follows its mark when the page scrolls or the window changes size. Everything it says is also in the chart
  // (the value is written beside each mark) and in the numbers view, so nobody needs to hover to read it.
  let { tip }: { tip: Tip | null } = $props();

  let box = $state<HTMLDivElement>();
  let at = $state<{ left: number; top: number; below: boolean } | null>(null);

  function place() {
    if (!tip || !box || !tip.target.isConnected) return;
    const clear = around([tip.target, ...tip.clear].map((element) => element.getBoundingClientRect()));
    const middle = (tip.centre ?? tip.target).getBoundingClientRect();
    const own = box.getBoundingClientRect();
    // The card's words and buttons (ResultCard marks them data-tip-avoid): kept clear of where the window has room (Phase 11a-3).
    const card = tip.target.closest('.result-card');
    const avoid = [...(card?.querySelectorAll<HTMLElement>('[data-tip-avoid]') ?? [])].map((element) => element.getBoundingClientRect());
    // The other marks' figures and labels (the charts mark them data-tip-soft), and the mark's own track, along which the tooltip may move.
    const soft = [...(card?.querySelectorAll<HTMLElement>('[data-tip-soft]') ?? [])].filter((element) => !tip.target.contains(element)).map((element) => element.getBoundingClientRect());
    at = placeTip({ width: own.width, height: own.height }, clear, middle.left + middle.width / 2, { width: document.documentElement.clientWidth, height: window.innerHeight }, { avoid, soft, span: { left: middle.left, right: middle.right } });
  }

  $effect(() => {
    if (!tip || !box) {
      at = null;
      return;
    }
    place();
    let frame = 0;
    const again = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    window.addEventListener('scroll', again, true);
    window.addEventListener('resize', again);
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(again);
    watch?.observe(box);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', again, true);
      window.removeEventListener('resize', again);
      watch?.disconnect();
    };
  });
</script>

{#if tip}
  <div
    class="chart-tip"
    class:chart-tip--below={at?.below}
    id={tip.id}
    role="tooltip"
    style:left={`${Math.round(at?.left ?? 0)}px`}
    style:top={`${Math.round(at?.top ?? 0)}px`}
    style:visibility={at ? null : 'hidden'}
    bind:this={box}
  >
    <strong class="chart-tip__value">{tip.value}</strong>
    <span class="chart-tip__label">{tip.label}</span>
    {#if tip.extra}<span class="chart-tip__extra">{tip.extra}</span>{/if}
  </div>
{/if}

<style>
  /* Above the admin page's sticky bar and tabs (5) and under its toast (100). */
  .chart-tip {
    position: fixed;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    box-sizing: border-box;
    width: max-content;
    max-width: min(calc(20rem * var(--chart-scale, 1)), calc(100vw - 16px));
    padding: 0.5rem 0.7rem;
    color: var(--viz-text);
    font-size: calc(0.875rem * var(--chart-scale, 1));
    line-height: 1.3;
    background: var(--viz-surface);
    border: 1px solid var(--viz-text-secondary);
    border-radius: 0.4rem;
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.16);
    pointer-events: none;
    overflow-wrap: anywhere;
  }

  .chart-tip__value {
    font-size: calc(1rem * var(--chart-scale, 1));
  }

  .chart-tip__extra {
    color: var(--viz-text-secondary);
  }
</style>
