// A client's Industry and Region (Prompt 22, Part 2): two optional tags the Leadership dashboard filters by (PMSClients.Industry, Region), set on the
// client's page by whoever has clients.manage (a Super admin, an Admin), saved with the client update and written to the audit list. A tag is plain
// text, trimmed, its spaces single, at most 60 characters (lib/access/field-values.js, which the write guard asks again); empty is allowed. The screen
// suggests the values already in use. Plain JS with no DOM (scripts/test-reporting-settings.js); admin/ClientAbout.svelte shows it.

import { AccessDenied } from '../access/access-denied.js';
import { writeAudit } from '../access/audit.js';
import { can } from '../access/can.js';
import { TAG_MAX } from '../access/field-values.js';

export { TAG_MAX };
/** The two tags, in the order the screens show them, with their words. */
export const TAGS = Object.freeze([Object.freeze({ key: 'industry', label: 'Industry' }), Object.freeze({ key: 'region', label: 'Region' })]);

/** A tag as it is kept: no control characters, spaces single, trimmed, at most TAG_MAX characters. @param {unknown} value */
export function cleanTag(value) {
  const plain = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.slice(0, TAG_MAX).trim();
}

/** The values already in use for a tag, once each whatever their case (the first spelling met), in order. @param {any[]} clients @param {'industry' | 'region'} key */
export function tagSuggestions(clients, key) {
  const seen = new Map();
  for (const client of clients) {
    const value = cleanTag(client?.[key]);
    if (value && !seen.has(value.toLowerCase())) seen.set(value.toLowerCase(), value);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** What changed, in words: "Industry: none to Retail; Region: US to EU". '' when nothing did. @param {any} before @param {any} after */
export function tagChangeWords(before, after) {
  const said = (value) => cleanTag(value) || 'none';
  return TAGS.filter(({ key }) => cleanTag(before?.[key]) !== cleanTag(after?.[key])).map(({ key, label }) => `${label}: ${said(before?.[key])} to ${said(after?.[key])}`).join('; ');
}

/**
 * Saves a client's tags (what changed only) and writes one audit line naming the client. Refused (AccessDenied, nothing sent) without clients.manage on
 * that client. Resolves to { changed, client: the tags as kept, detail }.
 * @param {any} ds the data service @param {any} access @param {{ id: string, industry?: string, region?: string }} client
 * @param {{ industry?: string, region?: string }} tags @param {{ now?: Date }} [options]
 */
export async function saveClientTags(ds, access, client, tags, { now = new Date() } = {}) {
  if (!can(access, 'clients.manage', { clientId: client.id }, { now })) throw new AccessDenied('clients.manage');
  const kept = { industry: cleanTag(tags.industry), region: cleanTag(tags.region) };
  const diff = Object.fromEntries(TAGS.filter(({ key }) => kept[key] !== cleanTag(client[key])).map(({ key }) => [key, kept[key]]));
  const detail = tagChangeWords(client, kept);
  if (!detail) return { changed: false, client: kept, detail: '' };
  await ds.updateClient(client.id, diff);
  await writeAudit(ds, access, { action: 'client', clientId: client.id, detail }, { now });
  return { changed: true, client: kept, detail };
}
