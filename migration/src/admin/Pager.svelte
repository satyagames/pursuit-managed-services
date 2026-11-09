<script lang="ts">
  // One long list's page controls (Prompt 26): Previous, Next and where the person is. It says the new range politely, and moves focus to the list's heading after a
  // change (never to the button, which may have gone disabled). A control at an end stays in the tab order with aria-disabled, so focus is never lost.
  // It draws nothing with one page. The sums are lib/common/paging.js's; the screen owns the page and reads nothing for a change of page.
  import { tick } from 'svelte';
  import { focusHeading } from '../lib/common/focus.js';

  let { state: where, label = 'Pages', heading = null, onPage }: {
    state: { page: number; pages: number; line: string; range: string; hasPrevious: boolean; hasNext: boolean };
    label?: string;
    heading?: HTMLElement | null;
    onPage: (page: number) => void;
  } = $props();

  async function go(page: number, allowed: boolean) {
    if (!allowed) return;
    onPage(page);
    await tick();
    if (heading) focusHeading(heading);
  }
</script>

{#if where.pages > 1}
  <!-- (Prompt 39: Previous, the page and Next never wrap; "Showing 1 to 5 of 8" shares their row whenever there is room, else sits under it.) -->
  <div class="pager-row">
    <nav class="pager" aria-label={label}>
      <button class="btn pager__button" type="button" aria-disabled={!where.hasPrevious} onclick={() => void go(where.page - 1, where.hasPrevious)}>Previous</button>
      <span class="pager__line">{where.line}</span>
      <button class="btn pager__button" type="button" aria-disabled={!where.hasNext} onclick={() => void go(where.page + 1, where.hasNext)}>Next</button>
    </nav>
    <p class="pager__say" role="status" aria-live="polite" data-testid="pager-range">{where.range}</p>
  </div>
{/if}

<style>
  .pager-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--adm-s2) var(--adm-s4);
    margin-top: var(--adm-s4);
  }

  .pager {
    display: flex;
    flex: none;
    flex-wrap: nowrap;
    align-items: center;
    gap: var(--adm-s2);
  }

  .pager__line {
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .pager__button {
    min-height: 44px;
    padding-inline: var(--adm-s3);
    white-space: nowrap;
  }

  .pager__button[aria-disabled='true'] {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .pager__say {
    margin: 0;
    color: var(--adm-ink-2);
    white-space: nowrap;
  }
</style>
