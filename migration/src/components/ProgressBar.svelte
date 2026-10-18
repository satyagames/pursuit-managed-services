<script lang="ts">
  let { value, max = 100, label = 'Progress' }: {
    value: number;
    max?: number;
    /** What is progressing, read out with the value, e.g. "Question 2 of 5". */
    label?: string;
  } = $props();

  const safeMax = $derived(max > 0 ? max : 1);
  const clamped = $derived(Math.min(safeMax, Math.max(0, value)));
  const share = $derived(clamped / safeMax);
</script>

<div
  class="progress"
  role="progressbar"
  aria-label={label}
  aria-valuemin="0"
  aria-valuemax={safeMax}
  aria-valuenow={clamped}
>
  <!-- The fill is the whole track scaled from its left edge (Phase 15): a change moves on the compositor, not by a new layout; the track's rounded ends clip it. -->
  <div class="fill" style:--share={share}></div>
</div>

<style>
  /* A dark track so the Deloitte-green fill stays clearly visible on every client colour. */
  .progress {
    box-sizing: border-box;
    width: 100%;
    height: 0.5rem;
    overflow: hidden;
    background: rgb(0 1 2 / 0.45);
    border: 1px solid rgb(255 255 255 / 0.6);
    border-radius: var(--radius-full);
  }

  .fill {
    height: 100%;
    background: var(--progress);
    transform: scaleX(var(--share, 0));
    transform-origin: 0 50%;
    transition: transform var(--motion-duration-base) var(--motion-ease-standard);
  }

  @media (prefers-reduced-motion: reduce) {
    .fill { transition: none; }
  }
</style>
