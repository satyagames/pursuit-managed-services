<script lang="ts">
  import { SAMPLE_NOTICE, confirmedLine, sampleState } from '../lib/sample-notice.js';

  // "Sample content: confirm with the client team before real use" with a Mark as confirmed button, for a client the seeds made (Phase 9b, SAM-2); once
  // somebody has confirmed it, a quiet line says who and when. Nothing at all for a client that is not a sample. The same words on the Clients list and
  // the Content tab; the parent does the confirming (adminData.confirmSampleClient) and reads the client again.
  let { client, busy = false, onConfirm }: {
    client: { id: string; createdAt?: string | null; theme?: unknown };
    busy?: boolean;
    onConfirm: () => void;
  } = $props();
  const state = $derived(sampleState(client));
</script>

{#if state && !state.confirmed}
  <p class="notice sample-notice" role="note" data-testid="sample-notice" data-client={client.id}>
    <span>{SAMPLE_NOTICE}</span>
    <button class="btn btn--small" type="button" onclick={onConfirm} disabled={busy}>Mark as confirmed</button>
  </p>
{:else if state?.confirmed}
  <p class="muted small sample-confirmed" data-testid="sample-confirmed" data-client={client.id}>{confirmedLine(state)}</p>
{/if}

<style>
  .sample-notice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.9rem;
    margin: 0.4rem 0;
  }

  .sample-confirmed {
    margin: 0.3rem 0;
  }
</style>
