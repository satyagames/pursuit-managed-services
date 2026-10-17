<script lang="ts">
  import { onMount } from 'svelte';
  import { UNAVAILABLE_TITLE, onSoundChange, setSound, soundState } from '../lib/effects/effects.js';

  /**
   * The compact header sound switch: a speaker, off until tapped. Tapping it turns sound on and plays
   * the confirmation chime. Where the browser has no Web Audio it is disabled and says why.
   */
  let { id = 'sound-toggle' }: { id?: string } = $props();

  let current = $state(soundState());
  const on = $derived(current.on);
  const available = $derived(current.available);

  onMount(() => {
    current = soundState();
    return onSoundChange((next) => { current = next; });
  });
</script>

<button
  {id}
  type="button"
  class="pms-sound"
  role="switch"
  aria-checked={on}
  aria-label="Sound"
  aria-describedby={available ? undefined : `${id}-why`}
  disabled={!available}
  title={available ? undefined : UNAVAILABLE_TITLE}
  onclick={() => setSound(!on)}
>
  <svg viewBox="0 0 24 24" width="1.4rem" height="1.4rem" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M3 9.5v5h3.6l4.4 3.7V5.8L6.6 9.5z" />
    {#if on}
      <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M14.5 9.2a4 4 0 0 1 0 5.6M17 6.8a7.4 7.4 0 0 1 0 10.4" />
    {:else}
      <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="m15 9.5 5 5m0-5-5 5" />
    {/if}
  </svg>
  <span class="pms-sound-state" aria-hidden="true">{on ? 'On' : 'Off'}</span>
</button>
{#if !available}<span class="sr-only" id="{id}-why">{UNAVAILABLE_TITLE}</span>{/if}

<style>
  .pms-sound {
    position: static;
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    box-sizing: border-box;
    min-width: var(--target-min);
    min-height: var(--target-min);
    padding: 0 0.7rem;
    color: var(--text);
    font: var(--fw-semibold) var(--fs-small) / 1 var(--font-sans);
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-full);
    cursor: pointer;
    transition: background-color 160ms ease;
  }

  .pms-sound[aria-checked='true'] {
    background: var(--action);
  }

  .pms-sound:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .pms-sound-state {
    min-width: 1.6em;
    text-align: left;
  }

  @media (prefers-reduced-motion: reduce) {
    .pms-sound { transition: none; }
  }
</style>
