<script lang="ts">
  // The sticky bottom bar of an admin screen (Prompt 38): 64 px, fixed to the foot of the window. On the left, where the screen stands, in one line ("Ready
  // to go live", "3 changes not saved"); on the right, the ONE primary action and at most one secondary. A destructive action is never here: it stays
  // in its card's Danger area. The page leaves room under its content for it (admin-look.css), and on an iPad it rides above the keyboard
  // (lib/admin/sticky-bar.ts). It is a labelled region, so a screen reader can find it.
  import { onMount } from 'svelte';
  import Icon, { type IconName } from './Icon.svelte';
  import { followKeyboard } from '../lib/admin/sticky-bar.js';

  type Action = { label: string; icon?: IconName; onclick: () => void; disabled?: boolean; describedBy?: string; testid?: string };

  let { context, icon = 'info', tone = 'neutral', primary = null, secondary = null, label = 'Next step' }: {
    /** Where the screen stands, in one line. */
    context: string;
    icon?: IconName;
    tone?: 'neutral' | 'ok' | 'warn' | 'danger';
    primary?: Action | null;
    secondary?: Action | null;
    /** The region's name. */
    label?: string;
  } = $props();

  onMount(() => followKeyboard());
</script>

<div class="adm-bar" role="region" aria-label={label} data-testid="sticky-bar">
  <p class="adm-bar__context" data-tone={tone} data-testid="sticky-context" aria-live="polite"><Icon name={icon} />{context}</p>
  <div class="adm-bar__actions">
    {#if secondary}
      <button class="btn btn--with-icon" type="button" onclick={secondary.onclick} disabled={secondary.disabled} aria-describedby={secondary.describedBy} data-testid={secondary.testid}>
        {#if secondary.icon}<Icon name={secondary.icon} />{/if}{secondary.label}
      </button>
    {/if}
    {#if primary}
      <button class="btn btn--primary btn--with-icon" type="button" onclick={primary.onclick} disabled={primary.disabled} aria-describedby={primary.describedBy} data-testid={primary.testid}>
        {#if primary.icon}<Icon name={primary.icon} />{/if}{primary.label}
      </button>
    {/if}
  </div>
</div>
