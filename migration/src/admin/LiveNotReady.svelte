<script lang="ts">
  // The Live display while it has no results to show: the sessions to choose from when nothing is live, the loading line, or what went wrong
  // and Try again (Phase 17: moved out of LiveDisplay.svelte unchanged, its markup and its styles). Opening a session is LiveDisplay's.
  // A session can go while the display is in full screen, so the full-screen rule names the display (`.live--present`) as its ancestor.
  import { sessionLabel } from '../lib/admin/live-view.js';

  let { phase, message, sessions, clients, onOpen }: {
    phase: string;
    message: string;
    sessions: { id: string; clientId: string; date?: string; status?: string }[];
    clients: { id: string; name: string }[];
    onOpen: (sessionId: string) => void;
  } = $props();
</script>

{#if phase === 'picker'}
  <p class="live__status" role="status">{message}</p>
  {#if sessions.length}
    <ul class="live__picker">
      {#each sessions as session (session.id)}
        <li><button class="btn" type="button" onclick={() => onOpen(session.id)}>{sessionLabel(session, clients)}</button></li>
      {/each}
    </ul>
  {/if}
{:else if phase === 'loading'}
  <p class="live__status" role="status">Loading results...</p>
{:else}
  <p class="live__status live__status--error" role="alert">{message}</p>
  <div class="live__actions"><button class="btn" type="button" onclick={() => location.reload()}>Try again</button></div>
{/if}

<style>
  .live__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .live__status {
    margin: 0;
    padding: 0.75rem 1rem;
    background: var(--adm-card);
    border: 1px solid var(--adm-line);
    border-radius: 0.5rem;
  }

  .live__status--error {
    color: var(--adm-bad-ink);
    background: var(--adm-bad-bg);
    border-color: var(--adm-bad-line);
  }

  .live__picker {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  :global(.live--present) .live__status {
    color: var(--adm-ink);
    font-size: calc(1rem * var(--chart-scale, 1));
  }
</style>
