<script lang="ts">
  // The one notice of a SharePoint sign-in the data layer could not renew (Prompt 19): calm and persistent, under the admin page's tabs (and at
  // the top of Setup), role="alert" without taking focus. The words are lib/admin/session-notice.js's; it says Reload, warns when a screen holds
  // unsaved work (lib/admin/unsaved.ts) and offers to stay, and never reloads by itself; Details holds SharePoint's status, code, SPRequestGuid
  // and how long since the last answer. When a later request is answered it goes: `onBack` (the admin's shell says "Reconnected." in its toast),
  // else it says "Reconnected." itself (Setup).
  import { onMount } from 'svelte';
  import * as dataService from '../lib/data/dataService.js';
  import { sessionBanner } from '../lib/admin/session-notice.js';
  import { hasUnsaved } from '../lib/admin/unsaved.js';

  let { onBack }: { onBack?: () => void } = $props();

  let lost = $state<unknown>(null);
  let unsaved = $state(false);
  let staying = $state(false);
  let back = $state(false);
  const banner = $derived(lost && !staying ? sessionBanner(lost, { unsaved }) : null);

  onMount(() => {
    const look = () => { if (lost) unsaved = hasUnsaved(); };
    window.addEventListener('input', look, true);
    window.addEventListener('change', look, true);
    const stop = dataService.onSessionChange((event: { state: 'lost' | 'back'; error?: unknown }) => {
      if (event.state === 'lost') {
        lost = event.error;
        unsaved = hasUnsaved();
        staying = false;
        back = false;
      } else if (lost) {
        lost = null;
        if (onBack) onBack(); else back = true;
      }
    });
    return () => { stop(); window.removeEventListener('input', look, true); window.removeEventListener('change', look, true); };
  });
</script>

{#if banner}
  <div class="session-banner" role="alert" data-testid="session-banner">
    <p class="session-banner__text">{banner.text}{#if banner.warning}{' '}<strong>{banner.warning}</strong>{/if}</p>
    <div class="session-banner__actions">
      <button class="btn btn--primary" type="button" onclick={() => window.location.reload()}>Reload</button>
      {#if banner.warning}<button class="btn" type="button" onclick={() => { staying = true; }}>Stay on this page</button>{/if}
    </div>
    {#if banner.details}
      <details class="session-banner__details">
        <summary>Details</summary>
        <p data-testid="session-details">{banner.details}</p>
      </details>
    {/if}
  </div>
{:else if back && !lost}
  <p class="session-banner session-banner--back" role="status">Reconnected.</p>
{/if}

<style>
  .session-banner {
    display: grid;
    gap: 0.75rem;
    margin: 1rem 1.5rem 0;
    padding: 1rem 1.25rem;
    font-size: 1rem;
    line-height: 1.5;
    color: var(--adm-warn-ink);
    background: var(--adm-warn-bg);
    border: 1px solid currentColor;
    border-radius: 12px;
  }

  .session-banner__text {
    margin: 0;
  }

  .session-banner__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .session-banner__details summary {
    display: flex;
    align-items: center;
    min-height: 44px;
    cursor: pointer;
    font-weight: var(--fw-bold);
  }

  .session-banner__details p {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .session-banner--back {
    color: var(--adm-ok-ink);
    background: var(--adm-ok-bg);
  }

  @media (max-width: 40rem) {
    .session-banner {
      margin: 1rem 1rem 0;
    }
  }
</style>
