<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  let { variant = 'primary', size = 'lg', children, ...rest }: Omit<HTMLButtonAttributes, 'children'> & {
    /** `primary` is the solid action colour; `secondary` is the translucent surface. */
    variant?: 'primary' | 'secondary';
    /** `lg` is the mockup CTA (Next, Retry, Click here to begin); `md` for in-flow actions. */
    size?: 'lg' | 'md';
    children: Snippet;
  } = $props();
</script>

<button type="button" class="pill-button" data-variant={variant} data-size={size} {...rest}>
  {@render children()}
</button>

<style>
  .pill-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    box-sizing: border-box;
    min-width: var(--target-min);
    min-height: var(--target-min);
    padding: 0.5rem 1.75rem;
    color: var(--text);
    font: var(--fw-semibold) var(--fs-button) / 1.2 var(--font-sans);
    text-align: center;
    background: var(--action);
    border: 1px solid var(--action-border);
    border-radius: var(--radius-full);
    cursor: pointer;
    transition: transform var(--motion-duration-quick) var(--motion-ease-standard), background-color var(--motion-duration-quick) var(--motion-ease-standard), border-color var(--motion-duration-quick) var(--motion-ease-standard);
  }

  .pill-button[data-size='lg'] {
    min-width: min(100%, var(--cta-w));
    min-height: var(--cta-h);
  }

  .pill-button[data-size='md'] {
    font-size: clamp(1rem, 2.6vw, 1.25rem);
  }

  .pill-button[data-variant='secondary'] {
    background: var(--surface);
    border-color: var(--surface-border);
  }

  .pill-button:active:not(:disabled) {
    transform: scale(0.97);
  }

  .pill-button:disabled {
    color: var(--on-disabled);
    background: var(--disabled);
    border-color: color-mix(in srgb, var(--on-disabled) 70%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--on-disabled) 70%, transparent);
    cursor: not-allowed;
  }

  @media (prefers-reduced-motion: reduce) {
    .pill-button { transition: none; }
    .pill-button:active:not(:disabled) { transform: none; }
  }
</style>
