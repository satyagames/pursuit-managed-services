// The admin page's icons (Prompt 38, on Prompt 31's and 33's rule): thin outlines on one 24 px grid, drawn by admin/Icon.svelte with a 1.75 stroke
// in the text's own colour, round caps and joins, no fill. Each icon has ONE meaning (./icon-meanings.js, and docs/RULES.md "Icons"); no two share a path.
// An icon is never the only word: beside a word it is aria-hidden; alone it is an IconButton whose words are its name. Paths only: nothing is read
// or loaded, no font and no library. The participant page never imports this file. scripts/test-admin-icons.js holds the table.

/** Each icon's path data, on a 24 x 24 grid. */
export const PATHS = Object.freeze({
  // The six tabs, and who is signed in.
  'calendar-check': 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M8 3v4M16 3v4M9 15.5l2 2l4-4',
  building: 'M4 21V4h11v17M15 9h5v12M2 21h20M8 8h3M8 12h3M8 16h3',
  layers: 'M12 3l9 5l-9 5l-9-5zM3 12.5l9 5l9-5M3 16.5l9 5l9-5',
  qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v.01M17 20h4M20 17v3M14 20h.01',
  'bar-chart': 'M4 20h16M7 16v-5M12 16V6M17 16V9',
  users: 'M12.5 8a3.5 3.5 0 1 1-7 0a3.5 3.5 0 0 1 7 0zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.5a6.5 6.5 0 0 1 3.5 5.5',
  user: 'M16 8a4 4 0 1 1-8 0a4 4 0 0 1 8 0zM4 21a8 8 0 0 1 16 0',
  // A session's life.
  broadcast: 'M12 12h.01M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8',
  stop: 'M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  copy: 'M11 9h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  screen: 'M3 4h18v12H3zM8 20h8M12 16v4',
  gauge: 'M4 17a8 8 0 1 1 16 0M12 17l4-5M3 20h18',
  // People and access.
  key: 'M11 15a4 4 0 1 1-8 0a4 4 0 0 1 8 0zM10 12l10-10M16 6l3 3M14 8l2 2',
  power: 'M12 3v9M7 6.3a8 8 0 1 0 10 0',
  clock: 'M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0zM12 7v5l3 2',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3s-3.6 3-8 3s-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  // Editing.
  plus: 'M12 5v14M5 12h14',
  'minus-circle': 'M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0zM8 12h8',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6',
  eye: 'M2 12s3.6-7 10-7s10 7 10 7s-3.6 7-10 7S2 12 2 12zM15 12a3 3 0 1 1-6 0a3 3 0 0 1 6 0z',
  'eye-off': 'M3 3l18 18M10.6 5.1Q11.3 5 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  'arrow-up': 'M12 19V5M5 12l7-7l7 7',
  'arrow-down': 'M12 5v14M19 12l-7 7l-7-7',
  'arrow-left': 'M19 12H5M12 19l-7-7l7-7',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  close: 'M6 6l12 12M18 6L6 18',
  'chevron-down': 'M6 9l6 6l6-6',
  'chevron-right': 'M9 6l6 6l-6 6',
  check: 'M5 12.5l4.5 4.5L19 7',
  'rotate-left': 'M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5',
  sliders: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  // Files and pictures.
  printer: 'M6 9V3h12v6M6 18H4v-7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7h-2M6 14h12v7H6z',
  download: 'M12 4v11M7 10.5l5 5l5-5M5 20h14',
  upload: 'M12 16V5M7 9.5l5-5l5 5M5 20h14',
  file: 'M14 3H5v18h14V8zM14 3v5h5M9 13h6M9 17h6',
  sheet: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14',
  slides: 'M7 8h14v11H7zM3 4h14v2M3 4v11h2M10 15h8',
  image: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM4 16l5-5l5 5l2-2l4 4M15.5 8.5h.01',
  palette: 'M12 3a9 9 0 1 0 0 18a2 2 0 0 0 1.5-3.3a2 2 0 0 1 1.5-3.4h2.4A4.6 4.6 0 0 0 22 9.8C22 6 17.5 3 12 3zM7.5 11h.01M10 7.5h.01M14.5 7.5h.01',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  sun: 'M16 12a4 4 0 1 1-8 0a4 4 0 0 1 8 0zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  // The question types.
  radio: 'M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0zM14 12a2 2 0 1 1-4 0a2 2 0 0 1 4 0z',
  checks: 'M3 7l3 3l5-5M3 16l3 3l5-5M14 8h7M14 17h7',
  toggle: 'M8 7h8a5 5 0 0 1 0 10H8A5 5 0 0 1 8 7zM18 12a2 2 0 1 1-4 0a2 2 0 0 1 4 0z',
  slider: 'M3 12h6M13 12h8M13 12a2 2 0 1 1-4 0a2 2 0 0 1 4 0z',
  podium: 'M9 9h6v12H9zM3 14h6v7H3zM15 12h6v9h-6zM12 3v3',
  message: 'M4 5h16v11H9l-5 4z',
  matrix: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  // Readiness: four shapes, not four colours.
  'alert-octagon': 'M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3zM12 8v5M12 16.5h.01',
  'alert-triangle': 'M12 3l10 18H2zM12 10v4M12 17.5h.01',
  'check-circle': 'M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0zM8 12.5l2.7 2.7L16 9.5',
  info: 'M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0zM12 11v6M12 7.5h.01',
});

/** Each question type's icon (beside its word, never alone). */
export const TYPE_ICON = Object.freeze({
  'single-select': 'radio',
  'multi-select': 'checks',
  'true-false': 'toggle',
  'confidence-continuum': 'slider',
  'ranked-voting': 'podium',
  'open-text-feedback': 'message',
  'art-of-the-possible': 'matrix',
});
