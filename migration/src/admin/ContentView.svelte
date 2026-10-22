<script lang="ts">
  import type { Snippet } from 'svelte';
  import { provideReveal } from '../lib/admin/unsaved.js';

  // One of Content's views (Phase 18), as a tab panel of the strip. It stays in the page once its view has been opened and is put out of
  // sight with the `hidden` attribute while another view shows, so what is typed in it survives a switch. A screen inside it that asks before
  // the person leaves (Brand Studio, a question being edited) brings it into sight first through `onReveal` (lib/admin/unsaved.ts).
  let { id, labelledBy, shown, onReveal, children }: {
    id: string;
    labelledBy: string;
    shown: boolean;
    onReveal: () => Promise<void> | void;
    children?: Snippet;
  } = $props();

  provideReveal(() => onReveal());
</script>

<div {id} class="content-view" role="tabpanel" aria-labelledby={labelledBy} hidden={!shown}>
  {@render children?.()}
</div>
