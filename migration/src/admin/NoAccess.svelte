<script lang="ts">
  // The No access screen (Prompt 21, Phase 1; board 2): a signed-in person whose row is disabled, or who has no current role. It says who they are
  // signed in as and whom to ask, and copies their details for that. "Request access" waits for PMSAccessRequests (not in this release). The words
  // are lib/access/access-words.js's.
  import { onMount } from 'svelte';
  import { focusHeading } from '../lib/common/focus.js';
  import { APP_NAME } from '../lib/common/app-name.js';
  import { myDetails, noAccessWords } from '../lib/access/access-words.js';
  import DeloitteWordmark from '../components/DeloitteWordmark.svelte';

  let { person, reason, support = '' }: { person: { name?: string; email?: string } | null; reason: string | null; support?: string } = $props();
  let heading = $state<HTMLElement>();
  let copied = $state('');
  const words = $derived(noAccessWords(APP_NAME, reason));

  onMount(() => focusHeading(heading));

  async function copy() {
    try {
      await navigator.clipboard.writeText(myDetails(person));
      copied = 'Copied your name and email.';
    } catch {
      copied = `Copy this by hand: ${myDetails(person)}`;
    }
  }
</script>

<main class="login" data-testid="no-access">
  <div class="login__brand"><div class="login__wordmark"><DeloitteWordmark /></div></div>
  <div class="login__card">
    <h1 bind:this={heading} tabindex="-1">{words.title}</h1>
    {#if person?.email}<p class="muted">Signed in as {person.email}</p>{/if}
    <p>{words.line}{support ? ` You can also ask ${support}.` : ''}</p>
    <button class="btn btn--primary btn--block" type="button" onclick={() => void copy()}>Copy my details</button>
    {#if copied}<p class="muted" role="status">{copied}</p>{/if}
  </div>
</main>
