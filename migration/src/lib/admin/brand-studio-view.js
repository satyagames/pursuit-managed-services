// What Brand Studio works out for itself before it draws: the look its preview is given, a picture's address as the page shows it, the page
// gradient of its colour strip, whether a typed colour is wrong, the word for each pairing of the contrast check, what each picture slot says,
// the address that previews the saved look on a device, and what a save says. Plain JS with JSDoc and no DOM or Svelte
// (scripts/test-brand-studio-view.js). Phase 17 moved these out of BrandStudio.svelte unchanged; the rules of a look stay in
// lib/brand/brand-studio.js, the saving in BrandStudio.svelte. Reads nothing and writes nothing.

import { embeddedAssetUrl } from '../brand/assets.js';
import { parseColour } from '../brand/brand-studio.js';

/** A picture's address as the page shows it: the copy the page carries inline, if any, else the address; null for none. @param {string | null} url */
export const displayUrl = (url) => (url ? embeddedAssetUrl(url) ?? url : null);

/**
 * The look the preview draws, from the unsaved draft: the scene, the client's name and words, the pictures, the plate, the background's focus
 * (the middle when it has none, nothing without a background) and the Animations switch.
 * @param {{ scene: string, clientName: string, words: { eventTitle: string, eventSubtitle: string, welcomeLine: string, logoText: string },
 *   draft: { plate: string, focus: { x: number, y: number } | null, assets: { hero: string | null, logo: string | null, background: string | null } },
 *   motion: boolean }} input
 */
export const lookOf = ({ scene, clientName, words, draft, motion }) => ({
  scene,
  clientName,
  eventTitle: words.eventTitle,
  eventSubtitle: words.eventSubtitle,
  welcomeLine: words.welcomeLine,
  logoText: words.logoText,
  heroUrl: displayUrl(draft.assets.hero),
  logoUrl: displayUrl(draft.assets.logo),
  plate: draft.plate,
  backgroundUrl: displayUrl(draft.assets.background),
  backgroundFocus: draft.assets.background ? draft.focus ?? { x: 50, y: 50 } : null,
  motion,
});

/** The page's gradient, from the theme's three page tokens. @param {Record<string, string>} tokens */
export const pageGradient = (tokens) => `linear-gradient(to bottom, ${tokens['--bg-top']} 0%, ${tokens['--bg-mid']} 58%, ${tokens['--bg-bottom']} 100%)`;

/**
 * A typed colour is wrong: something is typed (null is nothing) and it is not a colour. With `blankIsNone` (the accent) a blank is "none".
 * @param {string | null} typed @param {{ blankIsNone?: boolean }} [options]
 */
export const colourInvalid = (typed, { blankIsNone = false } = {}) => typed !== null && !(blankIsNone && typed.trim() === '') && parseColour(typed) === null;

/** A pairing's result in the contrast check: a mark and a word. An accent that fails is not drawn. @param {{ id: string, pass: boolean }} row */
export const contrastResult = (row) => (row.pass ? '✓ Pass' : row.id.startsWith('accent') ? '✕ Not drawn' : '✕ Fails');

/**
 * What a picture slot says: a picture chosen and not saved, one that is set (saved, or not yet), or none.
 * @param {{ pending: unknown, current: string | null, saved: string | null }} slot
 */
export const slotStatus = ({ pending, current, saved }) => (pending ? 'Not saved yet' : current ? (saved ? 'Saved' : 'Not saved yet') : 'Not set');

/** The address that shows the client's saved look on a device: the participant page with `?preview=<id>`. @param {string} base @param {string} clientId */
export function previewAddress(base, clientId) {
  const url = new URL(base);
  url.searchParams.set('preview', clientId);
  return url.href;
}

/** What a save says, and how: Saved, or how many old pictures could not be removed. @param {number} kept */
export const savedMessage = (kept) => ({
  message: kept > 0 ? `Saved. ${kept === 1 ? 'An old picture' : `${kept} old pictures`} could not be removed and can be deleted from the library by hand.` : 'Saved',
  kind: kept > 0 ? 'info' : 'success',
});
