// A logo address the sample seeds used to carry and no longer do (Phase 9b, SAM-1). Plain JS with JSDoc and no DOM, so `node --test` imports it.
//
// `public/assets/images/clients/kroger-logo.svg` is a drawn stand-in, a blue box with the word KROGER, and the rule is that a client's logo is never
// drawn or imitated. The seeds now leave Kroger's logo empty (the name shows in type, and readiness warns), but a site that was seeded earlier still
// holds that address in `Clients.LogoUrl`. So that such a site shows the name in type and the warning without anybody editing data, this address
// counts as "no logo" wherever a logo is read: Welcome, the Live display, the Clients list, Brand Studio, the leader report and the PDF export.
// Uploading a real logo replaces it as normal (a stored theme logo or a new LogoUrl is a different address).
//
// The match is on the path alone, so the address a SharePoint seed import wrote (the Setup page's own folder in front of it) is recognised too.
// The file itself left the branch with the legacy app in Phase 10c-1. The rule stays, for a site that still holds the address.

const RETIRED = /(?:^|\/)assets\/images\/clients\/kroger-logo\.svg(?:[?#].*)?$/i;

/** @param {unknown} url */
export const isRetiredLogo = (url) => typeof url === 'string' && RETIRED.test(url.trim());

/**
 * The address, or null when it is one of the retired ones. Anything else (a real logo, nothing at all) comes back as it was.
 * @template T
 * @param {T} url
 * @returns {T | null}
 */
export const withoutRetiredLogo = (url) => (isRetiredLogo(url) ? null : url);
