<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type { ActivityState } from './types.js';

  let { label, state = 'default', lockedCaption = 'Finish the previous activity', onclick, ...rest }: Omit<HTMLButtonAttributes, 'children'> & {
    label: string;
    /** `done` adds a green dot; `locked` greys the pill, adds a lock and prints why. */
    state?: ActivityState;
    lockedCaption?: string;
  } = $props();

  const uid = $props.id();
  const captionId = `${uid}-why`;
  const locked = $derived(state === 'locked');
  // A locked pill's title is white, as its caption and lock are (Phase 11a-3: in --on-disabled it was about 2:1 and could not be read on the real
  // site); it still reads as locked by its darker fill, the lock and the caption. (Said here: a comment in the style block is kept in the built page.)
</script>

<!-- A locked pill stays focusable (aria-disabled, not disabled) so a screen reader can find it
     and read the caption; it just does nothing when activated. -->
<button
  type="button"
  class="activity"
  data-state={state}
  aria-disabled={locked ? 'true' : undefined}
  aria-describedby={locked ? captionId : undefined}
  onclick={(event) => { if (!locked) onclick?.(event); }}
  {...rest}
>
  <span class="text">
    <span class="label">{label}</span>
    {#if locked}<span class="caption" id={captionId}>{lockedCaption}</span>{/if}
  </span>
  {#if state === 'done'}
    <span class="dot" aria-hidden="true"></span>
    <span class="sr-only">Completed</span>
  {:else if locked}
    <svg class="lock" viewBox="0 0 24 24" width="1.4em" height="1.4em" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2m-7-2a2 2 0 0 1 4 0v2h-4zm3 9.7V18h-2v-1.3a2 2 0 1 1 2 0" />
    </svg>
  {/if}
</button>

<style>
  /* The words and the dot or the lock share a row; with larger text or a narrow window the dot or the lock goes under the words rather than squeezing them (Phase 8). */
  .activity {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    box-sizing: border-box;
    width: 100%;
    min-height: var(--pill-h);
    padding: 0.75rem clamp(0.75rem, 4vw, 1.5rem);
    color: var(--text);
    font: var(--fw-regular) var(--fs-option) / 1.3 var(--font-sans);
    text-align: left;
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: var(--pill-radius);
    cursor: pointer;
    transition: transform var(--motion-duration-quick) var(--motion-ease-standard), background-color var(--motion-duration-quick) var(--motion-ease-standard);
  }

  .activity:active:not([aria-disabled='true']) {
    transform: scale(0.985);
  }

  .text {
    display: grid;
    flex: 1 1 10ch;
    gap: 0.15rem;
    min-width: 0;
  }

  .label {
    overflow-wrap: break-word;
  }

  .dot {
    flex: none;
    width: 0.9rem;
    height: 0.9rem;
    background: var(--success);
    border-radius: 50%;
    box-shadow: 0 0 0 3px rgb(9 255 83 / 0.28);
  }

  .activity[data-state='locked'] {
    color: var(--on-disabled);
    background: var(--disabled);
    border-color: color-mix(in srgb, var(--on-disabled) 45%, transparent);
    cursor: not-allowed;
  }

  .activity[data-state='locked'] .label {
    color: var(--text);
  }

  .caption {
    overflow-wrap: break-word;
    color: var(--text);
    font-size: 1rem;
    font-weight: var(--fw-semibold);
  }

  .lock {
    flex: none;
    color: var(--text);
  }

  @media (prefers-reduced-motion: reduce) {
    .activity { transition: none; }
    .activity:active:not([aria-disabled='true']) { transform: none; }
  }
</style>
