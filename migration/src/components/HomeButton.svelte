<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';

  let { label = 'Home', ...rest }: Omit<HTMLButtonAttributes, 'children'> & {
    /** Accessible name; the button shows only the house icon. */
    label?: string;
  } = $props();
</script>

<button type="button" class="home-button" aria-label={label} {...rest}>
  <svg viewBox="0 0 24 24" width="45%" height="45%" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M12 2.7 2.6 11.1a1 1 0 0 0 .67 1.74H5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-7.16h1.73a1 1 0 0 0 .67-1.74z" />
  </svg>
</button>

<style>
  .home-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    box-sizing: border-box;
    width: var(--cta-h);
    height: var(--cta-h);
    min-width: var(--target-min);
    min-height: var(--target-min);
    padding: 0;
    color: var(--text);
    background: var(--action);
    border: 1px solid var(--action-border);
    border-radius: 50%;
    cursor: pointer;
    transition: transform 160ms ease;
  }

  .home-button:active {
    transform: scale(0.95);
  }

  @media (prefers-reduced-motion: reduce) {
    .home-button { transition: none; }
    .home-button:active { transform: none; }
  }
</style>
