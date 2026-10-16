<script lang="ts">
  import { onMount } from 'svelte';
  import { router } from 'svelte-spa-router';
  import { navigateTo } from '../lib/navigation.js';

  // #/feedback/<sectionId> predates the pager. Open-text questions are steps of the pager now, so
  // an old link (or a bookmark) simply lands on the same activity.
  onMount(() => {
    const sectionId = router.location.split('/')[2];
    void navigateTo(sectionId ? `/quiz/${sectionId}` : '/agenda', true);
  });
</script>

<p role="status">Opening your activity...</p>
