// Where a picture's address points: relative to the page's own folder, or to a copy the page carries inline (globalThis.CEC_ASSETS).
// Reads and writes nothing. It was public/js/assets.js until Phase 14.
const documentBase = () => globalThis.document?.baseURI ?? globalThis.location?.href ?? 'https://cec.invalid/';

export const assetLocation = (path) => new URL(path, new URL('./', documentBase())).href;

export const assetUrl = (path) => globalThis.CEC_ASSETS?.[path] ?? assetLocation(path);

export function embeddedAssetUrl(url) {
  if (!globalThis.CEC_ASSETS || typeof url !== 'string') return url;
  const direct = globalThis.CEC_ASSETS[url.replace(/^\/+/, '')];
  if (direct) return direct;
  const base = new URL('./', documentBase());
  const resolved = new URL(url, base);
  return resolved.href.startsWith(base.href)
    ? globalThis.CEC_ASSETS[resolved.href.slice(base.href.length)] ?? url : url;
}