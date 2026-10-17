// What Brand Studio decides: a client's look as a draft, the checks on it, what a save writes and what
// the older screens read. Plain JS with JSDoc and no DOM, so `node --test` runs it (scripts/test-brand.js);
// BrandStudio.svelte only renders it.
//
// The draft is the colours, the plate, and the pictures' addresses; the client's WORDS (event title,
// subtitle, welcome line, logo text) are the Clients screen's and are carried through a save untouched.
//
// Legacy fields: the Master screen, the exports and the legacy app read Clients.PrimaryColor,
// SecondaryColor and LogoUrl. A save writes them from the theme (legacyColours, logoUrlFor) so those
// stay right; the Master screen reads the stored theme when there is one (masterColours) and the legacy
// fields otherwise.

import { buildClientTheme, safeFocus, safeImageUrl, safePlate } from './client-theme.js';
import { withoutRetiredLogo } from './retired-logos.js';
import { hexOrNull, legacyColours, masterColours } from './legacy-colours.js';
import {
  DANGER_HUE_MARGIN, DEFAULT_PRIMARY, MIN_GRAPHIC_CONTRAST, MIN_TEXT_CONTRAST, PLATE_COLOURS,
  contrastRatio, deriveTheme, isNearDangerHue, normalizeHex, relativeLuminance,
} from './theme.js';

export { legacyColours, masterColours };

/** Colours to start from. The first is the standard blue every new client begins with. */
export const PRESETS = Object.freeze([
  { name: 'Standard blue', hex: '#045BCC' },
  { name: 'Deep blue', hex: '#0B3A75' },
  { name: 'Teal', hex: '#0A6B6B' },
  { name: 'Green', hex: '#166534' },
  { name: 'Purple', hex: '#5B3A99' },
  { name: 'Plum', hex: '#8B2F6F' },
  { name: 'Slate', hex: '#3C4A5E' },
  { name: 'Charcoal', hex: '#262B33' },
]);

/** The colours of a very light or very dark primary start warning here (relative luminance, 0 to 1). */
export const VERY_LIGHT = 0.45;
export const VERY_DARK = 0.012;

/**
 * @typedef {object} Draft
 * @property {string} primary   '#RRGGBB'
 * @property {string | null} accent
 * @property {'light' | 'dark'} plate
 * @property {{ hero: string | null, logo: string | null, background: string | null }} assets  Saved addresses, or a picture just chosen (not yet uploaded).
 * @property {{ x: number, y: number } | null} focus  Background focal point, percentages.
 */


/**
 * The draft for a client record. A client with no stored theme starts from the standard blue, as the
 * participant page shows it (its older PrimaryColor was chosen for the legacy light pages).
 * @param {any} client
 * @returns {Draft}
 */
export function draftFromClient(client) {
  const theme = client?.theme && typeof client.theme === 'object' && !Array.isArray(client.theme) ? client.theme : {};
  const assets = theme.assets && typeof theme.assets === 'object' ? theme.assets : {};
  return {
    primary: hexOrNull(theme.primary) ?? DEFAULT_PRIMARY,
    accent: hexOrNull(theme.accent),
    plate: safePlate(theme.plate),
    // The legacy LogoUrl is the logo for a client that never had Brand Studio's.
    assets: {
      hero: safeImageUrl(assets.hero),
      logo: withoutRetiredLogo(safeImageUrl(assets.logo)) ?? withoutRetiredLogo(safeImageUrl(client?.logoUrl)),
      background: safeImageUrl(assets.background),
    },
    focus: safeFocus(assets.backgroundFocus),
  };
}

/** Are two drafts the same look? @param {Draft} a @param {Draft} b */
export const sameDraft = (a, b) => JSON.stringify(normalised(a)) === JSON.stringify(normalised(b));
const normalised = (draft) => ({
  primary: draft.primary.toUpperCase(), accent: draft.accent?.toUpperCase() ?? null, plate: draft.plate,
  assets: { hero: draft.assets.hero ?? null, logo: draft.assets.logo ?? null, background: draft.assets.background ?? null },
  focus: draft.assets.background ? draft.focus : null,
});

/** The standard look, keeping the pictures. @param {Draft} draft @returns {Draft} */
export const resetColours = (draft) => ({ ...draft, primary: DEFAULT_PRIMARY, accent: null, plate: 'light' });

/** Another client's colours and plate (never its pictures: a file belongs to one client). @param {Draft} draft @param {any} other @returns {Draft} */
export function copyColoursFrom(draft, other) {
  const from = draftFromClient(other);
  return { ...draft, primary: from.primary, accent: from.accent, plate: from.plate };
}

// ---- Checks ---------------------------------------------------------------------------------------

/**
 * @typedef {object} Pairing
 * @property {string} id
 * @property {string} label    What is on what, in words.
 * @property {string} foreground
 * @property {string} background
 * @property {number} ratio
 * @property {number} need
 * @property {boolean} pass
 * @property {boolean} applies  False when it does not exist (no accent, so no accent rule).
 */

/**
 * The contrast of every text and control pairing, as the participant page will draw it.
 * @param {Draft} draft
 */
export function contrastRows(draft) {
  const theme = deriveTheme(draft.primary, draft.accent ?? undefined, { plate: draft.plate });
  const t = theme.tokens;
  const plateColour = PLATE_COLOURS[draft.plate];
  const pages = [t['--bg-top'], t['--bg-mid'], t['--bg-bottom']];
  const lowest = (colour, grounds) => grounds.reduce((worst, ground) => Math.min(worst, contrastRatio(colour, ground)), Infinity);
  /** @type {Pairing[]} */
  const rows = [
    { id: 'page-text', label: 'Words on the page', foreground: '#FFFFFF', background: t['--bg-mid'], ratio: lowest('#FFFFFF', pages), need: MIN_TEXT_CONTRAST },
    { id: 'pill-text', label: 'Words on pills and tiles', foreground: '#FFFFFF', background: t['--bg-mid'], ratio: theme.contrast.surface, need: MIN_TEXT_CONTRAST },
    { id: 'button-text', label: 'Words on buttons', foreground: '#FFFFFF', background: t['--action'], ratio: theme.contrast.action, need: MIN_TEXT_CONTRAST },
  ].map((row) => ({ ...row, pass: row.ratio >= row.need, applies: true }));
  if (draft.accent) {
    const rule = lowest(draft.accent, pages);
    const ring = contrastRatio(draft.accent, plateColour);
    rows.push(
      { id: 'accent-rule', label: 'Accent rule on the page', foreground: draft.accent, background: t['--bg-mid'], ratio: rule, need: MIN_GRAPHIC_CONTRAST, pass: rule >= MIN_GRAPHIC_CONTRAST, applies: true },
      { id: 'accent-ring', label: 'Accent ring on the logo plate', foreground: draft.accent, background: plateColour, ratio: ring, need: MIN_GRAPHIC_CONTRAST, pass: ring >= MIN_GRAPHIC_CONTRAST, applies: true },
    );
  }
  return { theme, rows };
}

/**
 * What the admin should know about a draft. `adjusted` is the primary as it will really be drawn when it had to be
 * changed for readability (Auto-fix puts it in the field). `warnings` never block a save.
 * @param {Draft} draft
 * @param {{ logo?: LogoStats | null }} [options] The logo's pixel statistics, once measured.
 * @returns {{ theme: ReturnType<typeof deriveTheme>, rows: Pairing[], adjusted: { from: string, to: string } | null, warnings: { id: string, message: string }[] }}
 */
export function brandReport(draft, { logo = null } = {}) {
  const { theme, rows } = contrastRows(draft);
  const change = theme.adjustments.find((entry) => entry.token === '--bg-mid');
  const warnings = [];
  if (draft.accent && isNearDangerHue(draft.accent)) {
    warnings.push({ id: 'accent-near-red', message: `This accent is within ${DANGER_HUE_MARGIN}° of the red used for wrong answers. It shows only as a thin rule and a ring (never on a button), but it can read as “wrong”. Consider a different accent.` });
  }
  if (isNearDangerHue(draft.primary)) {
    warnings.push({ id: 'primary-near-red', message: `This primary is within ${DANGER_HUE_MARGIN}° of the red used for wrong answers. Buttons and pills follow the primary, so they can look like a wrong answer. Consider a different primary.` });
  }
  const luminance = relativeLuminance(draft.primary);
  if (luminance > VERY_LIGHT) warnings.push({ id: 'primary-light', message: 'This primary is very light. White words need a darker page, so it is darkened (see “adjusted for readability”).' });
  if (luminance < VERY_DARK) warnings.push({ id: 'primary-dark', message: 'This primary is almost black. The page will look black and the brand colour will hardly show.' });
  for (const row of rows) {
    if (row.applies && !row.pass && row.id === 'accent-rule') warnings.push({ id: 'accent-rule', message: `The accent has only ${row.ratio.toFixed(1)}:1 against the page (it needs ${MIN_GRAPHIC_CONTRAST}:1), so the thin rule stays white.` });
    if (row.applies && !row.pass && row.id === 'accent-ring') warnings.push({ id: 'accent-ring', message: `The accent has only ${row.ratio.toFixed(1)}:1 against the ${draft.plate === 'dark' ? 'dark' : 'white'} logo plate (it needs ${MIN_GRAPHIC_CONTRAST}:1), so the ring is not drawn.` });
  }
  const advice = plateAdvice(draft.plate, logo);
  if (advice.message) warnings.push({ id: 'plate', message: advice.message });
  return { theme, rows: rows.filter((row) => row.applies), adjusted: change ? { from: change.from, to: change.to } : null, warnings };
}

// ---- The plate -----------------------------------------------------------------------------------

/**
 * @typedef {object} LogoStats
 * @property {number} opaque     Share of the picture's pixels that are drawn (alpha at least half), 0 to 1.
 * @property {number} light      Share of those drawn pixels that are very light.
 * @property {number} dark       Share that are very dark.
 */

const lut = Array.from({ length: 256 }, (_, value) => { const unit = value / 255; return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; });
/** WCAG relative luminance of an 8-bit colour. */
export const luminanceOfRgb = (red, green, blue) => 0.2126 * lut[red] + 0.7152 * lut[green] + 0.0722 * lut[blue];

/** A drawn pixel at least this light (relative luminance) counts as "very light"; at most DARK_PIXEL as "very dark". */
export const LIGHT_PIXEL = 0.72;
export const DARK_PIXEL = 0.04;
/** Share of a logo's drawn pixels that must be very light (or dark) for the plate to need changing. */
export const MOSTLY = 0.8;

/**
 * Measures a logo from its pixels (RGBA, any size: Brand Studio samples a small copy).
 * @param {ArrayLike<number>} rgba @returns {LogoStats}
 */
export function logoStats(rgba) {
  let total = 0; let opaque = 0; let light = 0; let dark = 0;
  for (let index = 0; index + 3 < rgba.length; index += 4) {
    total += 1;
    if (rgba[index + 3] < 128) continue;
    opaque += 1;
    const value = luminanceOfRgb(rgba[index], rgba[index + 1], rgba[index + 2]);
    if (value >= LIGHT_PIXEL) light += 1;
    else if (value <= DARK_PIXEL) dark += 1;
  }
  return { opaque: total ? opaque / total : 0, light: opaque ? light / opaque : 0, dark: opaque ? dark / opaque : 0 };
}

/**
 * Does the chosen plate suit the logo? White-on-transparent logos vanish on the white plate, and black
 * ones on the dark plate. Silent (no message) when it suits, or when there is too little to judge.
 * @param {'light' | 'dark'} plate @param {LogoStats | null} stats
 * @returns {{ message: string, suggest: 'light' | 'dark' | null }}
 */
export function plateAdvice(plate, stats) {
  if (!stats || stats.opaque < 0.01) return { message: '', suggest: null };
  if (plate === 'light' && stats.light >= MOSTLY) {
    return { suggest: 'dark', message: 'This logo is mostly very light, so it would be hard to see on the white plate. Choose the Dark plate.' };
  }
  if (plate === 'dark' && stats.dark >= MOSTLY) {
    return { suggest: 'light', message: 'This logo is mostly very dark, so it would be hard to see on the dark plate. Choose the Light plate.' };
  }
  return { message: '', suggest: null };
}

// ---- What a save writes, and what the older screens read ----------------------------------------------

/**
 * The Clients.LogoUrl change a save makes, if any, so the legacy app keeps its logo: set to the new
 * logo, cleared when the logo was removed, absent when nothing changed.
 * @param {Draft} draft @param {Draft} saved @returns {{ logoUrl: string } | {}}
 */
export function logoUrlChange(draft, saved) {
  if ((draft.assets.logo ?? null) === (saved.assets.logo ?? null)) return {};
  return { logoUrl: draft.assets.logo ?? '' };
}

/**
 * The client fields a save writes: the new ThemeJson with the version one higher, the resolved tokens,
 * the older colours and, if it changed, the logo address. The client's words are kept as they are.
 * @param {any} client The record as last read.
 * @param {Draft} draft @param {Draft} saved The draft the screen opened with (to tell what changed).
 * @returns {{ theme: any, themeVersion: number, primaryColor: string, secondaryColor: string, logoUrl?: string }}
 */
export function changesForSave(client, draft, saved) {
  const stored = client?.theme && typeof client.theme === 'object' && !Array.isArray(client.theme) ? client.theme : {};
  const storedAssets = stored.assets && typeof stored.assets === 'object' ? stored.assets : {};
  const version = (Number.isInteger(client?.themeVersion) ? client.themeVersion : 0) + 1;
  // A logo that is only the client's older LogoUrl stays that way: it is not copied into the theme.
  const legacyOnly = !storedAssets.logo && draft.assets.logo === (withoutRetiredLogo(safeImageUrl(client?.logoUrl)) ?? null);
  const theme = buildClientTheme({
    primary: draft.primary,
    accent: draft.accent,
    plate: draft.plate,
    version,
    copy: stored.copy && typeof stored.copy === 'object' ? stored.copy : {},
    sample: stored.sample,
    assets: {
      hero: draft.assets.hero,
      logo: legacyOnly ? null : draft.assets.logo,
      background: draft.assets.background,
      backgroundFocus: draft.assets.background ? draft.focus ?? { x: 50, y: 50 } : null,
    },
  });
  return { theme, themeVersion: version, ...legacyColours(draft), ...logoUrlChange(draft, saved) };
}

/**
 * What an open participant page does after a save, in the words Brand Studio prints. It is true because
 * (checked by scripts/test-brand.js against App.svelte and experience.svelte.ts): a page reads its client
 * and theme when it loads or when AppSettings says something else is live; a save changes neither
 * AppSettings nor the session, so an open page is not told.
 */
export const OPEN_PAGES_NOTE = 'Saved. Participant pages that are already open keep the old look until they are reloaded; a page opened or reloaded from now on shows the new one. Nothing is pushed to open pages.';

/** A copy of a draft that shares nothing with it (a draft is plain data). @param {Draft} draft @returns {Draft} */
export const cloneDraft = (draft) => ({
  primary: draft.primary, accent: draft.accent, plate: draft.plate,
  assets: { hero: draft.assets.hero, logo: draft.assets.logo, background: draft.assets.background },
  focus: draft.focus ? { x: draft.focus.x, y: draft.focus.y } : null,
});

/** '#rgb', 'rrggbb' and the like as '#RRGGBB', or null when it is not a colour. @param {string} text @returns {string | null} */
export function parseColour(text) {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(text ?? '').trim());
  return match ? normalizeHex(`#${match[1]}`) : null;
}
