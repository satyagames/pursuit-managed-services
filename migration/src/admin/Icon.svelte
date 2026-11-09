<script lang="ts" module>
  // The admin page's icons (Prompt 38): the paths and their one meaning each live in ./icons.js; this draws one. A thin outline (1.75 stroke) in the
  // text's own colour, round caps and joins, no fill, 20 px in the UI and 16 px in a chip. Beside a word it is aria-hidden; an icon button
  // (IconButton.svelte) carries its words as its name and a tooltip.
  import { PATHS } from './icons.js';

  export type IconName = keyof typeof PATHS;
  export const ICON_NAMES = Object.keys(PATHS) as IconName[];
</script>

<script lang="ts">
  let { name, size = 20 }: { name: IconName; size?: number } = $props();
</script>

<svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-icon={name}>
  <path d={PATHS[name]} fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
</svg>

<style>
  .icon {
    flex: none;
    vertical-align: -0.2em;
  }
</style>
