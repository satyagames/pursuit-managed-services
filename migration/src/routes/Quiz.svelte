<script lang="ts">
  import AppShell from '../components/AppShell.svelte';
  import ActivityPager from '../pager/ActivityPager.svelte';

  // #/quiz/<sectionId>. The route is a thin wrapper so the facilitator's preview mounts the same
  // pager the participants get, with `preview` on and the page frame (header and gradient) drawn
  // around it, because the preview has no App shell. `showKey` (the admin Content preview only) marks the right answers.
  let { params = {}, preview = false, showKey = false }: { params?: Record<string, string>; preview?: boolean; showKey?: boolean } = $props();
</script>

{#if preview}
  <AppShell contained>
    <ActivityPager sectionId={params.sectionId ?? ''} preview {showKey} />
  </AppShell>
{:else}
  <ActivityPager sectionId={params.sectionId ?? ''} />
{/if}
