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
  <nav class="pager" aria-label={label}>
    <button class="btn pager__button" type="button" aria-disabled={!where.hasPrevious} onclick={() => void go(where.page - 1, where.hasPrevious)}>Previous</button>
    <span class="pager__line">{where.line}</span>
    <button class="btn pager__button" type="button" aria-disabled={!where.hasNext} onclick={() => void go(where.page + 1, where.hasNext)}>Next</button>
  </nav>
  <p class="pager__say" role="status" aria-live="polite" data-testid="pager-range">{where.range}</p>
{/if}

<style>
  .pager {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    margin-top: 1rem;
  }

  .pager__button {
    min-height: 44px;
  }

  .pager__button[aria-disabled='true'] {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .pager__say {
    margin: 0.25rem 0 0;
    text-align: center;
    color: var(--adm-muted);
  }
</style>
