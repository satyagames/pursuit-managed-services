// The older colour fields (Clients.PrimaryColor and SecondaryColor) that the Master screen, the exports and the legacy
// app read, and how they follow a client's stored theme. Plain JS with JSDoc and no DOM. Kept apart from
// brand-studio.js because the participant page's Master route needs just this, and not the rest of Brand Studio.

import { safePlate } from './client-theme.js';
import { deriveTheme, normalizeHex } from './theme.js';

/** '#abc' or '#aabbcc' as '#AABBCC', or null when it is not a colour. @param {unknown} value */
export const hexOrNull = (value) => { try { return normalizeHex(/** @type {string} */ (value)); } catch { return null; } };

/**
 * The older colour fields for a theme: the page colour participants see, and the accent (or, without
 * one, the button colour). Written on every save so the Master screen, the exports and the legacy app
 * keep working.
 * @param {{ primary: string, accent?: string | null, plate?: 'light' | 'dark' }} theme
 * @returns {{ primaryColor: string, secondaryColor: string }}
 */
export function legacyColours({ primary, accent = null, plate = 'light' }) {
  const { tokens } = deriveTheme(primary, accent ?? undefined, { plate });
  return { primaryColor: tokens['--bg-mid'], secondaryColor: accent ? normalizeHex(accent) : tokens['--action'] };
}

/**
 * The colours the Master screen and the exports use: the client's stored theme when it has one, and the
 * older fields otherwise (or when they are not colours either: null, and the page keeps its default).
 * @param {any} client
 * @returns {{ primaryColor: string | null, secondaryColor: string | null, source: 'theme' | 'legacy' | 'none' }}
 */
export function masterColours(client) {
  const theme = client?.theme && typeof client.theme === 'object' && !Array.isArray(client.theme) ? client.theme : null;
  const primary = theme ? hexOrNull(theme.primary) : null;
  if (primary) return { ...legacyColours({ primary, accent: hexOrNull(theme.accent), plate: safePlate(theme.plate) }), source: 'theme' };
  const legacy = { primaryColor: hexOrNull(client?.primaryColor), secondaryColor: hexOrNull(client?.secondaryColor) };
  return { ...legacy, source: legacy.primaryColor || legacy.secondaryColor ? 'legacy' : 'none' };
}
