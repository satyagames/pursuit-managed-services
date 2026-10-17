// Per-client branding, applied once at the page root so no screen has to do it.
//
// The participant page (lib/participant/experience.svelte.ts) calls applyBrand(), and the Live display loadBrand(). That sets these
// custom properties on <html>:
//
//   --brand-primary, --brand-secondary   colors
//   --brand-logo-url                     url("...") or none, for `.brand__logo`
//   --brand-name                         a quoted CSS string, for `.brand__name::before`
//
// Every screen's CSS reads those, so a client's colors, logo and name change the whole
// app with no per-screen code. Which client? The one the caller names (the Live display
// hands over its session's client), else the client of the session being viewed.
//
// The client's record is what the admin edits, and it is the whole answer for that
// client: a logo the admin cleared stays cleared. When there is no such client the
// built-in default brand below is used. (Until Phase 10c-2a a missing client fell back to
// the legacy look's one item, the ThemeConfig list; nothing reads that list now.) It was public/js/branding.js until Phase 14.
import * as dataService from '../data/dataService.js';
import { embeddedAssetUrl } from './assets.js';

export const DEFAULT_BRAND = Object.freeze({
  name: 'Pursuits CEC',
  logoUrl: null,
  primaryColor: '#0f172a',
  secondaryColor: '#64748b',
});

// Hex only. These values come from an admin form and land in CSS, so anything else
// is dropped for the default rather than trusted.
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const color = (value, fallback) => (typeof value === 'string' && HEX_COLOR.test(value.trim()) ? value.trim() : fallback);
const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** A CSS string literal for `value` (escapes quotes, backslashes and line breaks). */
const cssString = (value) => `"${String(value).replace(/[\\"]/g, '\\$&').replace(/[\r\n\f]/g, ' ')}"`;

let current = { ...DEFAULT_BRAND, clientId: null };

/** The brand last applied: { clientId, name, logoUrl, primaryColor, secondaryColor }. */
export const currentBrand = () => current;

/** The client whose brand a route shows: the one it names, else the client of the session it names, else none. */
async function clientIdFor({ state, sessionId }) {
  if (state.clientId) return state.clientId;
  const session = sessionId ? await dataService.getSession(sessionId) : null;
  return session?.clientId ?? null;
}

/**
 * Works out the brand for a route. Never throws: if the server can't be reached the
 * brand already on screen stays, so a flaky connection doesn't flash the app unstyled.
 * `route` is { state, sessionId }.
 */
export async function loadBrand(route) {
  try {
    const clientId = await clientIdFor(route);
    const client = clientId ? await dataService.getClient(clientId) : null;
    return {
      clientId: client?.id ?? null,
      name: text(client?.name) ?? DEFAULT_BRAND.name,
      logoUrl: embeddedAssetUrl(text(client?.logoUrl)) ?? DEFAULT_BRAND.logoUrl,
      primaryColor: color(client?.primaryColor, DEFAULT_BRAND.primaryColor),
      secondaryColor: color(client?.secondaryColor, DEFAULT_BRAND.secondaryColor),
    };
  } catch (error) {
    console.warn('branding: could not load the client brand, keeping the current one', error);
    return current;
  }
}

/** Sets the brand's custom properties on <html> and remembers it as the current brand. */
export function applyBrand(brand) {
  const style = document.documentElement.style;
  style.setProperty('--brand-primary', brand.primaryColor);
  style.setProperty('--brand-secondary', brand.secondaryColor);
  style.setProperty('--brand-logo-url', brand.logoUrl ? `url(${cssString(brand.logoUrl)})` : 'none');
  style.setProperty('--brand-name', cssString(brand.name));
  document.documentElement.dataset.brandLogo = brand.logoUrl ? 'set' : 'none'; // lets CSS hide an empty logo slot
  current = brand;
}
