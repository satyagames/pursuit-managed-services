// What the Results charts (Phase 11a) share on the screen: the model's type, the tooltip, the time beside a name and the ramp of a scale.
// The numbers are lib/results/results-chart-model.js's; nothing here counts.

import type { chartOf } from '../../lib/results/results-chart-model.js';

export type Chart = ReturnType<typeof chartOf> & Record<string, any>;
export type Who = { key: string; name: string; at: string | null; place?: number; picture?: string | null };

/**
 * A tooltip: the value first, then the label, beside the mark it is about. ChartTip draws it in a layer fixed to the window (lib/results/tip-place.js
 * decides where), clear of `target` and everything in `clear` (the mark's own label), centred across on `centre` (else on `target`), and where
 * there is room clear of its card's words and buttons (marked data-tip-avoid) and then of the other marks' figures and labels (data-tip-soft).
 */
export type Tip = { id: string; mark: string; value: string; label: string; extra?: string; target: HTMLElement; clear: HTMLElement[]; centre?: HTMLElement | null };

let count = 0;
/** An id unique on the page, for aria-controls, aria-describedby and aria-labelledby. */
export const uid = (prefix: string) => `${prefix}-${(count += 1)}`;

/** The element of a chart that is the own label of the mark `id` (each chart marks them with data-label-of), or null. */
export function labelOf(frame: HTMLElement | undefined, id: string) {
  return frame?.querySelector<HTMLElement>(`[data-label-of="${CSS.escape(id)}"]`) ?? null;
}

// (The word "container" is in this file on purpose: Tailwind reads every file under migration/ and makes its `.container` rule for the participant
// page from it. That word was in the Live display's old question card, which Phase 11a removed, and the participant page must stay byte for byte as
// it was. Until Phase 11a-2 it was in the comment of the tooltip's old placing, which measured the tooltip inside its chart's container.)

// The cards whose names are open, the most recent last: Esc closes the one the keyboard is in, or else the most recent (Safari does not focus a
// button that is clicked, so after a click the keyboard is not in any card).
const openPanels: string[] = [];
export function notePanel(cardId: string, isOpen: boolean) {
  const at = openPanels.indexOf(cardId);
  if (at >= 0) openPanels.splice(at, 1);
  if (isOpen) openPanels.push(cardId);
}
export const isLatestPanel = (cardId: string) => openPanels[openPanels.length - 1] === cardId;

/** "10:42 AM", in the browser's own way of writing a time; '' when there is no time. */
export function timeOf(at: string | null | undefined) {
  if (!at) return '';
  const when = new Date(at);
  return Number.isFinite(when.getTime()) ? when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
}

/** "1st", "2nd", "3rd", "11th": a place in a ranking. */
export function placeName(place: number) {
  const tens = place % 100;
  if (tens >= 11 && tens <= 13) return `${place}th`;
  return `${place}${['th', 'st', 'nd', 'rd'][place % 10] ?? 'th'}`;
}

/** The blue of step `tone` (0 is the lowest) of a scale with `tones` colours: the ramps of styles/results-tokens.css. */
export function rampColour(tone: number, tones: number) {
  if (tones <= 2) return tone === 0 ? 'var(--viz-ramp-3-1)' : 'var(--viz-ramp-3-3)';
  const steps = Math.min(5, tones);
  return `var(--viz-ramp-${steps}-${Math.min(steps, tone + 1)})`;
}

/** The label of the button that swaps a chart for its numbers (written in two parts: see the note in ResultCard.svelte). */
export const VIEW_NUMBERS = `View as ${'ta'}ble`;
