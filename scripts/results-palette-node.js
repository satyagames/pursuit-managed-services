// The Results palette in node (Phase 11b): migration/src/styles/results-tokens.css read from disk and parsed by the same function the admin page
// uses (lib/results/results-palette.js), so a test draws with exactly the colours a browser does.

import { readFileSync } from 'node:fs';
import { readPalette } from '../migration/src/lib/results/results-palette.js';

export const TOKENS_FILE = new URL('../migration/src/styles/results-tokens.css', import.meta.url);

let held = null;
/** @returns {import('../migration/src/lib/results/results-palette.js').Palette} */
export function nodePalette() {
  held ??= readPalette(readFileSync(TOKENS_FILE, 'utf8'));
  return held;
}
