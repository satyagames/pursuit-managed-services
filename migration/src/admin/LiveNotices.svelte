<script lang="ts">
  // What the Live display says above its results: a lost connection, answers that could not be read, the export just saved, and on the admin
  // view the Names shown switch (Phase 17: moved out of LiveDisplay.svelte unchanged, its markup and its styles). The switch's state is
  // LiveDisplay's. The full-screen rule names the display (`.live--present`) as its ancestor.
  let { message, unreadableText, wall, exportMessage, presenting, namesShown, onToggleNames }: {
    message: string;
    /** lib/admin/live-view.js unreadableText: names on the admin view, how many on the wall, '' when every answer was read. */
    unreadableText: string;
    wall: boolean;
    exportMessage: string;
    presenting: boolean;
    namesShown: boolean;
    onToggleNames: () => void;
  } = $props();
</script>

{#if message}<p class="live__status" role="status">{message}</p>{/if}
{#if unreadableText}<p class="notice live__unreadable" class:live__unreadable--wall={wall} role="status" data-testid="unreadable-notice"><strong>{unreadableText}</strong></p>{/if}
{#if exportMessage && !presenting}<p class="live__status" role="status">{exportMessage}</p>{/if}
{#if !wall}
  <div class="live__names">
    <button class="btn live__auto" type="button" role="switch" aria-checked={namesShown} onclick={onToggleNames}>Names shown <span class="live__auto-state" aria-hidden="true">{namesShown ? 'On' : 'Off'}</span></button>
    <span class="live__names-note">{namesShown ? 'Press a bar to see who picked it. Hide the names before you share this screen.' : 'Names are hidden.'}</span>
  </div>
{/if}

<style>
  .live__status {
    margin: 0;
    padding: 0.75rem 1rem;
    background: var(--adm-card);
    border: 1px solid var(--adm-line);
    border-radius: 0.5rem;
  }

  .live__names {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
  }

  .live__names-note {
    color: var(--adm-muted);
  }

  .live__unreadable--wall {
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font-size: 0.875em;
  }

  .live__auto-state {
    display: inline-block;
    min-width: 2.2rem;
    margin-left: 0.4rem;
    padding: 0.1rem 0.5rem;
    font-weight: 700;
    text-align: center;
    border: 1px solid currentcolor;
    border-radius: 999px;
  }

  :global(.live--present) .live__status {
    color: var(--adm-ink);
    font-size: calc(1rem * var(--chart-scale, 1));
  }
</style>
