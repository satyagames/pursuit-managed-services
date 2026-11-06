<script lang="ts">
  import { LEVEL_LOOK } from '../lib/participant/aop-levels.js';
  import '../styles/aop-level-tokens.css';

  // A guest's Art of Possibility ratings as a small mosaic (Prompt 35): a square per box in its level's colour with its shape, row by row. "Your ratings
  // at a glance" draws it at 16 px a square, the hub's finished activity at 6 px. It says its counts in words; it is the guest's own, from the device.
  let { levels, label, cell = 16 }: { levels: number[][]; label: string; cell?: number } = $props();

  const columns = $derived(Math.max(0, ...levels.map((row) => row.length)));
  const shapeOf = (level: number) => LEVEL_LOOK[level as 1 | 2 | 3]?.path ?? '';
</script>

<svg class="mosaic" role="img" aria-label={label} viewBox="0 0 {columns * 16} {levels.length * 16}" width={columns * cell} height={levels.length * cell} data-testid="rating-mosaic">
  {#each levels as row, r (r)}
    {#each row as level, c (c)}
      <g transform="translate({c * 16 + 1} {r * 16 + 1})" data-level={level}><rect width="14" height="14" rx="3" />{#if cell >= 10 && level}<path d={shapeOf(level)} transform="translate(1 1)" />{/if}</g>
    {/each}
  {/each}
</svg>

<style>
  .mosaic {
    flex: none;
  }

  g {
    color: var(--aop-well-ink);
    fill: var(--aop-well);
  }

  path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  [data-level='1'] { color: var(--aop-on-low); fill: var(--aop-low); }
  [data-level='2'] { color: var(--aop-on-medium); fill: var(--aop-medium); }
  [data-level='3'] { color: var(--aop-on-high); fill: var(--aop-high); }
</style>
