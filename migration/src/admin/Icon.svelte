<script lang="ts" module>
  // The admin page's icons (Prompt 33, on Prompt 31's rule): one 24 px grid, a 2 px stroke in the text's own colour, round caps and joins, no
  // fill. Each has one common meaning (docs/RULES.md, "Icons"): the round minus removes one grant, the bin deletes a whole record, the pencil
  // edits, the plus adds, the chevrons fold, the eye shows or hides, the clock is history. An icon is never the only word: beside a word it is
  // aria-hidden; an icon button (IconButton.svelte) carries its words as its name and a tooltip. Paths only: nothing is read or loaded.
  const PATHS = {
    plus: 'M12 5v14M5 12h14',
    'minus-circle': 'M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0zM8 12h8',
    pencil: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
    'chevron-down': 'M6 9l6 6l6-6',
    'chevron-right': 'M9 6l6 6l-6 6',
    eye: 'M2 12s3.6-7 10-7s10 7 10 7s-3.6 7-10 7S2 12 2 12zM15 12a3 3 0 1 1-6 0a3 3 0 0 1 6 0z',
    'eye-off': 'M3 3l18 18M10.6 5.1Q11.3 5 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
    clock: 'M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0zM12 7v5l3 2',
    printer: 'M6 9V3h12v6M6 18H4v-7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7h-2M6 14h12v7H6z',
    copy: 'M11 9h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
    trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6',
    'arrow-left': 'M19 12H5M12 19l-7-7l7-7',
    check: 'M5 12.5l4.5 4.5L19 7',
    download: 'M12 4v11M7 10.5l5 5l5-5M5 20h14',
    people: 'M12.5 8a3.5 3.5 0 1 1-7 0a3.5 3.5 0 0 1 7 0zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.5a6.5 6.5 0 0 1 3.5 5.5',
    calendar: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M8 3v4M16 3v4',
    building: 'M4 21V4h11v17M15 9h5v12M2 21h20M8 8h3M8 12h3M8 16h3',
    file: 'M14 3H5v18h14V8zM14 3v5h5M9 13h6M9 17h6',
    list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
    palette: 'M12 3a9 9 0 1 0 0 18a2 2 0 0 0 1.5-3.3a2 2 0 0 1 1.5-3.4h2.4A4.6 4.6 0 0 0 22 9.8C22 6 17.5 3 12 3zM7.5 11h.01M10 7.5h.01M14.5 7.5h.01',
    qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v.01M17 20h4M20 17v3M14 20h.01',
    chart: 'M4 20h16M7 16v-5M12 16V6M17 16V9',
    // Prompt 34, the Live display: read again, open in a new tab, show on the big screen, the dark and the light look, a sheet (CSV), slides (PowerPoint).
    refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
    external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
    screen: 'M3 4h18v12H3zM8 20h8M12 16v4',
    moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
    sun: 'M16 12a4 4 0 1 1-8 0a4 4 0 0 1 8 0zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    sheet: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14',
    slides: 'M7 8h14v11H7zM3 4h14v2M3 4v11h2M10 15h8',
  } as const;
  export type IconName = keyof typeof PATHS;
  export const ICON_NAMES = Object.keys(PATHS) as IconName[];
</script>

<script lang="ts">
  let { name, size = 20 }: { name: IconName; size?: number } = $props();
</script>

<svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-icon={name}>
  <path d={PATHS[name]} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
</svg>

<style>
  .icon {
    flex: none;
    vertical-align: -0.2em;
  }
</style>
