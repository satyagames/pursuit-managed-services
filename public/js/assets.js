// Since Phase 10c-1 this file belongs to the new build alone (migration/): the legacy app that shared it is kept in the tag legacy-final.
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

export async function loadAssetText(path) {
  const embedded = globalThis.CEC_TEXT_ASSETS?.[path];
  if (embedded !== undefined) return embedded;
  const response = await fetch(assetUrl(path), { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw Object.assign(new Error(`Could not load ${path} (${response.status})`), { status: response.status });
  return response.text();
}