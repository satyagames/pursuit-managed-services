// A client's stored look (Clients.ThemeJson) turned into what the participant page applies.
// Plain JS with JSDoc, like theme.js, so `node --test` can import it.
//
// The stored shape (PMS-IMPLEMENTATION-PLAN.md 4.2 and 4.4, in git history at 7347c72), written by the seeds now and by Brand
// Studio later:
//   { version, primary, accent, plate, tokens, assets: { hero, logo, background, backgroundFocus, tile },
//     copy: { eventTitle, eventSubtitle, welcomeLine, logoText } }
// `plate` is 'dark' for the plate a white logo needs; absent means the light plate. `backgroundFocus` is the
// point of the background picture that stays in view, { x, y } as percentages, present only with a background.
// `assets.tile` is reserved and unused.
// `tokens` are the resolved custom properties (deriveTheme output). Nothing here trusts the stored
// value: tokens go through applyTheme's own name and value checks, and anything missing or
// unusable is derived again from the stored `primary` and `accent`. A client with no stored theme
// wears the default look: its older PrimaryColor was chosen for the legacy light pages and is not
// carried over.
//
// The controls (CTA, Next, Home, Retry, pills, tiles) are never taken from storage at all: they
// are worked out here, every time, from the page colour the theme paints. So a theme that was
// stored while an accent still coloured the buttons cannot make a button red again, and no stored
// value can either.

import { withoutRetiredLogo } from './retired-logos.js';
import { CONTROL_TOKENS, DEFAULT_PRIMARY, applyTheme, deriveTheme } from './theme.js';

/** @typedef {{ eventTitle: string, eventSubtitle: string, welcomeLine: string, logoText: string }} ThemeCopy */
/** @typedef {{ x: number, y: number }} FocalPoint percentages, 0 to 100 */
/** @typedef {{ hero: string | null, logo: string | null, background: string | null, backgroundFocus?: FocalPoint, tile: string | null }} ThemeAssets */
/**
 * @typedef {object} ClientTheme
 * @property {Record<string, string>} tokens  Ready for applyTheme().
 * @property {'stored' | 'derived' | 'default'} source Where the tokens came from.
 * @property {number | null} version The client's ThemeVersion, read on every boot.
 * @property {ThemeCopy} copy
 * @property {ThemeAssets} assets
 * @property {'light' | 'dark'} plate The plate behind a logo.
 */

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * A picture address that is safe to put in an <img> or a CSS background: http(s), a path on this
 * site, or an inline image. Anything else (a script or a non-image data URL) is dropped.
 * @param {unknown} value
 * @returns {string | null}
 */
export function safeImageUrl(value) {
  const url = text(value);
  if (!url) return null;
  if (/^data:/i.test(url)) return /^data:image\/(?:png|jpeg|gif|webp|svg\+xml)[;,]/i.test(url) ? url : null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return /^https?:\/\//i.test(url) ? url : null;
  return url;
}

/**
 * A stored focal point as { x, y } within 0 to 100 (one decimal), or null when it is not one.
 * @param {unknown} value
 * @returns {FocalPoint | null}
 */
export function safeFocus(value) {
  if (!value || typeof value !== 'object') return null;
  const { x, y } = /** @type {Record<string, unknown>} */ (value);
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const clamp = (n) => Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;
  return { x: clamp(x), y: clamp(y) };
}

/** @param {unknown} value @returns {'light' | 'dark'} */
export const safePlate = (value) => (value === 'dark' ? 'dark' : 'light');

/** Runs the tokens through applyTheme's checks without touching the page. @param {unknown} tokens */
function usableTokens(tokens) {
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return null;
  try {
    applyTheme(/** @type {Record<string, string>} */ (tokens), { style: { setProperty() {} } });
    return /** @type {Record<string, string>} */ (tokens);
  } catch {
    return null;
  }
}

/** deriveTheme, or null when the colour is not one. @param {unknown} primary @param {unknown} [accent] @param {'light' | 'dark'} [plate] */
function derived(primary, accent, plate = 'light') {
  try {
    return deriveTheme(/** @type {string} */ (primary), text(accent) || undefined, { plate }).tokens;
  } catch {
    try { return deriveTheme(/** @type {string} */ (primary), undefined, { plate }).tokens; } catch { return null; }
  }
}

/**
 * The control tokens for a page painted with `tokens`: derived from its `--bg-mid` (the client's
 * primary as the page shows it), or `base`'s when that is not a plain colour.
 * @param {Record<string, string>} tokens @param {Record<string, string>} base
 */
function controlsFor(tokens, base) {
  let source = base;
  try { source = deriveTheme(tokens['--bg-mid']).tokens; } catch { /* keep the derived set */ }
  return Object.fromEntries(CONTROL_TOKENS.map((name) => [name, source[name]]));
}

/**
 * The theme to apply for a client record (or the default look for none).
 * @param {{ name?: string, theme?: unknown, themeVersion?: number | null, logoUrl?: string | null } | null | undefined} client
 * @returns {ClientTheme}
 */
export function resolveClientTheme(client) {
  const stored = client?.theme && typeof client.theme === 'object' && !Array.isArray(client.theme)
    ? /** @type {Record<string, any>} */ (client.theme) : {};
  const version = typeof client?.themeVersion === 'number' && Number.isFinite(client.themeVersion) ? client.themeVersion : null;
  const plate = safePlate(stored.plate);
  const fallback = derived(stored.primary, stored.accent, plate);
  // Stored tokens are used as they are only while they belong to the current ThemeVersion. A
  // version that moved on without them means they are stale, so the colours are derived instead.
  const current = version === null || stored.version === undefined || stored.version === version;
  const tokens = current ? usableTokens(stored.tokens) : null;
  const base = fallback ?? deriveTheme(DEFAULT_PRIMARY).tokens;
  const copy = stored.copy && typeof stored.copy === 'object' ? stored.copy : {};
  const assets = stored.assets && typeof stored.assets === 'object' ? stored.assets : {};
  const name = text(client?.name);
  const painted = tokens ? { ...base, ...tokens } : base;
  return {
    plate,
    tokens: { ...painted, ...controlsFor(painted, base) },
    source: tokens ? 'stored' : fallback ? 'derived' : 'default',
    version,
    copy: {
      eventTitle: text(copy.eventTitle),
      eventSubtitle: text(copy.eventSubtitle),
      welcomeLine: text(copy.welcomeLine) || (name ? `Welcome to the ${name} experience.` : ''),
      logoText: text(copy.logoText),
    },
    assets: {
      hero: safeImageUrl(assets.hero),
      // (A drawn stand-in logo that older sample seeds wrote counts as no logo: lib/retired-logos.js.)
      logo: withoutRetiredLogo(safeImageUrl(assets.logo)) ?? withoutRetiredLogo(safeImageUrl(client?.logoUrl)),
      background: safeImageUrl(assets.background),
      ...(safeFocus(assets.backgroundFocus) ? { backgroundFocus: safeFocus(assets.backgroundFocus) } : {}),
      tile: safeImageUrl(assets.tile),
    },
  };
}

/**
 * Builds the value to store in Clients.ThemeJson from the choices an admin makes. The tokens are
 * resolved here, at save time (plan 4.4), so they are stored already contrast-checked.
 * `sample` is the marker lib/sample-notice.js reads ("made by Seed sample clients", and who confirmed it and when): written only when there is one, and
 * carried over by every writer that rebuilds a theme, so an edit does not wipe it. Nothing that paints a page reads it.
 * @param {{ primary: string, accent?: string | null, plate?: 'light' | 'dark', version?: number, copy?: Partial<ThemeCopy>, assets?: Partial<ThemeAssets>, sample?: Record<string, any> }} choices
 */
export function buildClientTheme({ primary, accent = null, plate = 'light', version = 1, copy = {}, assets = {}, sample = undefined }) {
  const theme = deriveTheme(primary, accent ?? undefined, { plate: safePlate(plate) });
  return {
    version,
    primary,
    accent,
    // Only the dark plate is written (a theme without one has the light plate), and a focal point only with its picture,
    // so a theme that never used either is stored exactly as it was before Brand Studio.
    ...(safePlate(plate) === 'dark' ? { plate: 'dark' } : {}),
    tokens: theme.tokens,
    assets: {
      hero: assets.hero ?? null, logo: assets.logo ?? null, background: assets.background ?? null,
      ...(assets.background && safeFocus(assets.backgroundFocus) ? { backgroundFocus: safeFocus(assets.backgroundFocus) } : {}),
      tile: assets.tile ?? null,
    },
    copy: {
      eventTitle: copy.eventTitle ?? '', eventSubtitle: copy.eventSubtitle ?? '', welcomeLine: copy.welcomeLine ?? '', logoText: copy.logoText ?? '',
    },
    ...(sample && typeof sample === 'object' && !Array.isArray(sample) ? { sample } : {}),
  };
}

/**
 * A client's stored theme with new words and a new version: its palette, accent and pictures are kept
 * (and its tokens derived again from them, so they are stored contrast-checked), where
 * buildClientTheme() starts from choices. The admin's Clients screen uses this to save an edit, so a
 * stored accent is still read in this file only. A stored theme whose colours are unusable falls back
 * to the default palette.
 * @param {unknown} stored The client's current ThemeJson, or nothing for a client without one.
 * @param {{ version: number, copy: Partial<ThemeCopy> }} changes
 */
export function reviseClientTheme(stored, { version, copy }) {
  const old = stored && typeof stored === 'object' && !Array.isArray(stored) ? /** @type {Record<string, any>} */ (stored) : {};
  const choices = { version, copy, assets: old.assets && typeof old.assets === 'object' ? old.assets : {}, sample: old.sample };
  try {
    return buildClientTheme({ primary: old.primary ?? DEFAULT_PRIMARY, accent: old.accent ?? null, plate: safePlate(old.plate), ...choices });
  } catch {
    return buildClientTheme({ primary: DEFAULT_PRIMARY, accent: null, plate: safePlate(old.plate), ...choices });
  }
}
