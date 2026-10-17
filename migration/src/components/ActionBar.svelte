<script lang="ts">
  import type { Snippet } from 'svelte';

  /** The row under a question: the main action beside the home button. On a phone it sticks to the bottom of the screen. */
  let { sticky = true, children }: {
    /** Sticks to the bottom edge on phones. Off for a bar framed inside something else (the admin preview). */
    sticky?: boolean;
    children: Snippet;
  } = $props();
</script>

<div class="pms-actions" data-sticky={sticky ? 'true' : 'false'}>
  {@render children()}
</div>

<style>
  .pms-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: clamp(0.75rem, 2.4vw, 1.25rem);
    margin-top: auto;
    padding-top: clamp(1.25rem, 4vw, 2rem);
  }

  /* Phones: pinned to the bottom, over a fade of the page colour, clear of the home indicator. */
  @media (max-width: 599px) {
    .pms-actions[data-sticky='true'] {
      position: sticky;
      bottom: 0;
      z-index: 5;
      margin-inline: calc(-1 * var(--gutter));
      padding: 0.75rem var(--gutter) calc(0.75rem + env(safe-area-inset-bottom));
      background: linear-gradient(to top, color-mix(in srgb, var(--bg-bottom) 55%, transparent) 60%, transparent);
      -webkit-backdrop-filter: blur(10px);
      backdrop-filter: blur(10px);
    }
  }
</style>
