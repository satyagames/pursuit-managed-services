<script lang="ts">
  // An on/off switch for a role for all clients (Prompt 33, People): role="switch" with aria-checked, its name says the role and the state
  // ("Super admin for all clients: on"), and the state is a word beside the track too. A switch a guard holds is disabled with the guard's
  // reason beside it, never hidden. Flipping it only asks the caller (`onflip`); the caller grants, or confirms and removes, as the buttons did.
  let { role, on, disabled = false, reason = '', busy = false, onflip }: {
    role: string;
    on: boolean;
    disabled?: boolean;
    /** Why it is disabled, in the guard's own words. */
    reason?: string;
    busy?: boolean;
    onflip: (next: boolean) => void;
  } = $props();

  const uid = $props.id();
</script>

<div class="role-switch">
  <button class="role-switch__button" type="button" role="switch" aria-checked={on} aria-label="{role} for all clients: {on ? 'on' : 'off'}"
    aria-describedby={disabled && reason ? `${uid}-why` : undefined} aria-busy={busy} disabled={disabled || busy} data-testid="role-switch" data-role={role}
    onclick={() => onflip(!on)}>
    <span class="role-switch__track" aria-hidden="true"><span class="role-switch__thumb"></span></span>
    <span class="role-switch__word" aria-hidden="true">{on ? 'On' : 'Off'}</span>
  </button>
  {#if disabled && reason}<span id="{uid}-why" class="muted role-switch__why" data-testid="role-switch-reason">{reason}</span>{/if}
</div>

<style>
  .role-switch {
    display: grid;
    justify-items: end;
    gap: 0.25rem;
    text-align: end;
  }

  .role-switch__button {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-width: var(--target-min);
    min-height: var(--target-min);
    padding: 0 0.5rem;
    border: 0;
    border-radius: 0.65rem;
    background: transparent;
    color: var(--adm-ink);
    font: inherit;
    font-weight: var(--fw-semibold);
    cursor: pointer;
  }

  .role-switch__button:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .role-switch__button:focus-visible {
    outline: 3px solid var(--focus);
    outline-offset: 3px;
    box-shadow: 0 0 0 3px var(--adm-ink), 0 0 0 9px var(--adm-ink);
  }

  .role-switch__track {
    position: relative;
    width: 3rem;
    height: 1.6rem;
    border: 2px solid var(--adm-muted);
    border-radius: 999px;
    background: var(--adm-card);
  }

  .role-switch__thumb {
    position: absolute;
    inset-block-start: 2px;
    inset-inline-start: 2px;
    width: calc(1.6rem - 8px);
    height: calc(1.6rem - 8px);
    border-radius: 50%;
    background: var(--adm-muted);
    transition: transform var(--motion-duration-quick) var(--motion-ease-standard);
  }

  [aria-checked='true'] .role-switch__track {
    border-color: var(--adm-green);
    background: var(--adm-green);
  }

  [aria-checked='true'] .role-switch__thumb {
    background: var(--adm-on-deep);
    transform: translateX(1.4rem);
  }

  .role-switch__word {
    min-width: 2rem;
    text-align: start;
  }

  .role-switch__why {
    max-width: 18rem;
  }

  @media (prefers-reduced-motion: reduce) {
    .role-switch__thumb {
      transition: none;
    }
  }

  @media (forced-colors: active) {
    .role-switch__track {
      border-color: ButtonText;
    }

    .role-switch__thumb {
      background: ButtonText;
    }

    [aria-checked='true'] .role-switch__track {
      background: Highlight;
      border-color: Highlight;
    }

    [aria-checked='true'] .role-switch__thumb {
      background: HighlightText;
    }
  }
</style>
