<script lang="ts">
  import { saveClientMotion } from '../lib/admin/adminData.js';
  import { motionEnabled } from '../lib/brand/client-theme.js';

  type Client = { id: string; name: string; theme?: unknown };

  /**
   * The client's Animations switch (Phase 15): ThemeJson `motion.enabled`, one value, flipped here from Brand Studio or from Today. It
   * shows the new state at once and saves it; if the save fails it goes back to the saved state and says so. A missing or damaged value
   * reads as On. The participant page applies it at its next load.
   */
  let { client, help = false, compact = false, onSaved, onToast }: {
    client: Client;
    /** One line under it saying what it does (Brand Studio). */
    help?: boolean;
    /** The small form for the Controls panel of Today. */
    compact?: boolean;
    /** The client as written. */
    onSaved: (client: Client) => void;
    onToast: (message: string, kind?: 'info' | 'success' | 'error') => void;
  } = $props();

  const uid = $props.id();
  let pending = $state<boolean | null>(null);
  const on = $derived(pending ?? motionEnabled(client.theme));

  async function flip() {
    if (pending !== null) return;
    const next = !on;
    pending = next;
    try {
      const written = await saveClientMotion<Client>(client.id, next);
      onSaved({ ...client, ...written });
      onToast(`Animations are ${next ? 'on' : 'off'} for ${client.name}`, 'success');
    } catch (cause) {
      onToast(`Could not save the animations setting. ${cause instanceof Error ? cause.message : ''}`.trim(), 'error');
    } finally {
      pending = null;
    }
  }
</script>

<div class="motion-switch" class:motion-switch--compact={compact}>
  <button
    class="btn motion-switch__button"
    type="button"
    role="switch"
    aria-checked={on}
    aria-busy={pending !== null}
    aria-describedby={help ? `${uid}-help` : undefined}
    data-testid="motion-switch"
    onclick={() => void flip()}
  >Animations <span class="motion-switch__state" aria-hidden="true">{on ? 'On' : 'Off'}</span></button>
  {#if help}
    <p class="muted small" id="{uid}-help">Turns the screen transitions and the celebration confetti on or off for participants. People whose device asks for reduced motion never see them.</p>
  {/if}
</div>

<style>
  .motion-switch {
    display: grid;
    gap: 0.5rem;
    justify-items: start;
  }

  .motion-switch__button {
    min-height: 44px;
  }

  .motion-switch__state {
    display: inline-block;
    min-width: 2.2rem;
    margin-left: 0.4rem;
    padding: 0.1rem 0.5rem;
    font-weight: 700;
    text-align: center;
    border: 1px solid currentcolor;
    border-radius: 999px;
  }

  .motion-switch--compact {
    margin-top: 0.75rem;
  }
</style>
