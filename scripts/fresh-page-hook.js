// The resolve hook of scripts/fresh-page.js (Phase 17), on Node's loader thread: a module of migration/src/lib/data/ that was imported with a
// query (`dataService.js?page=3`) gets the other modules of lib/data with the same query (`core.js?page=3`), so that one test page is one copy of
// every part. Anything else resolves as Node resolves it.

const DATA = '/migration/src/lib/data/';

/** @param {string} specifier @param {{ parentURL?: string }} context @param {Function} nextResolve */
export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  return { ...resolved, url: tagged(resolved.url, context.parentURL) };
}

/** The address `url` should have, imported from `parentURL`: tagged with the parent's query when both are in lib/data and it has none of its own. */
export function tagged(url, parentURL) {
  if (!parentURL || !url.startsWith('file:') || !parentURL.startsWith('file:')) return url;
  const parent = new URL(parentURL);
  const child = new URL(url);
  if (!parent.search || child.search || !parent.pathname.includes(DATA) || !child.pathname.includes(DATA)) return url;
  child.search = parent.search;
  return child.href;
}
