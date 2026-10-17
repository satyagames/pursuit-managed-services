<script lang="ts">
  import { onMount } from 'svelte';
  import { router } from 'svelte-spa-router';
  import { APP_NAME } from '../lib/common/app-name.js';
  import { navigateTo } from '../lib/participant/navigation.js';
  import { participant } from '../lib/participant/session.svelte.js';

  let path = $derived(router.location);
  let title = $derived(path.startsWith('/quiz/') ? 'Activity' : path.startsWith('/feedback/') ? 'Feedback' : path === '/thank-you' ? 'Thank you' : path === '/agenda' ? 'Agenda' : 'Page not found');

  onMount(() => {
    if (!participant.clientTrackId && path !== '/' && path !== '/welcome') void navigateTo('/welcome', true);
  });
</script>

<section class="screen stage-placeholder">
  <p class="eyebrow">{APP_NAME}</p>
  <h1>{title}</h1>
  {#if participant.sessionId}
    <p class="hint">Your participant session is active. This screen is being migrated in the next stage.</p>
  {:else}
    <p class="hint">This participant route is not available without an active session.</p>
  {/if}
  {#if participant.notice}
    <p class="notice" role="status">{participant.notice}</p>
  {/if}
  <button class="button button-secondary" type="button" onclick={() => void navigateTo('/welcome')}>Back to welcome</button>
</section>