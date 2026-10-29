<script lang="ts">
  import type { Snippet } from 'svelte';

  // A screen shown to read (Prompt 21, Phase 4): when the person's role may look at it but not change it, it is shown with a plain notice and every
  // control in it switched off (a disabled fieldset switches off the buttons, fields and pickers inside, whatever they are). The data layer's write
  // guard would refuse a change in any case; this is so that nobody is invited to try. When `readOnly` is false it adds nothing at all.
  let { readOnly = false, words, children }: { readOnly?: boolean; words: string; children?: Snippet } = $props();
</script>

{#if readOnly}
  <p class="notice" role="status" data-testid="view-only">View only. {words}</p>
  <fieldset class="view-only" disabled>
    {@render children?.()}
  </fieldset>
{:else}
  {@render children?.()}
{/if}

<style>
  .view-only {
    min-inline-size: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
</style>
