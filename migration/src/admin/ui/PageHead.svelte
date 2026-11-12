<script lang="ts">
  // A screen's title row (Prompt 44): its icon and title (h2), one line of what the screen is for, and its actions on the right. The markup is
  // the one each screen wrote for itself (`header.panel__head`, the words in its first div); its look is admin.css's `.panel__head`. The
  // heading takes focus when the screen opens (tabindex -1, `heading` bound) where the screen asked for that. `extra` comes under the line of
  // words; `actions` after them (each screen keeps its own wrapper, and its own scoped styles apply to what it passes).
  import type { Snippet } from 'svelte';
  import Icon, { type IconName } from '../Icon.svelte';

  let { title, description, icon, id, headClass = '', focusable = false, heading = $bindable(), extra, actions }: {
    title: string; description: string; icon?: IconName; id?: string; headClass?: string; focusable?: boolean;
    heading?: HTMLElement; extra?: Snippet; actions?: Snippet;
  } = $props();
</script>

<!-- (The heading's tabindex is -1 or none: focus is given to it, never reached by Tab.) -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<header class="panel__head {headClass}"><div><h2 {id} bind:this={heading} tabindex={focusable ? -1 : undefined}>{#if icon}<Icon name={icon} />{/if}{title}</h2><p class="muted">{description}</p>{@render extra?.()}</div>{@render actions?.()}</header>
