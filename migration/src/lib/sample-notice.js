// "Sample content: confirm with the client team before real use" (Phase 9b, SAM-2). Plain JS with JSDoc and no DOM, so `node --test` imports it.
//
// The two sample clients (Kroger and Domino's, from lib/sample-clients.js) have colours, questions and answers that look like approved material and
// are not: some are the mockup's, some placeholders, some checked against a public page, none signed off by the client. Admin says so on the Clients
// list and the Content tab until somebody presses "Mark as confirmed", which records who and when. The leader report's cover carries a line too.
//
// WHERE IT IS STORED. No new SharePoint column, and the only place a client has for an optional extra is `Clients.ThemeJson`, so the marker is a
// key inside it: `theme.sample = { source, confirmedBy?, confirmedAt? }`. The theme's readers ignore keys they do not know (resolveClientTheme builds what
// it uses from named fields), and the two writers that rebuild a theme (buildClientTheme, through reviseClientTheme and Brand Studio's save) now carry
// `sample` over, so an edit does not wipe it. (AppSettings has no free column to hold it.)
//
// WHICH CLIENTS. A client the seeds made carries the marker (new seeds write it). A site seeded BEFORE Phase 9b has none, so the seeds' own id and
// creation date also identify them: they are fixed instants the Clients screen can never write (it stamps the time of creation), so a client that
// somebody made by hand, even called Kroger, is not taken for a sample.

/** The words, on the Clients list and the Content tab. */
export const SAMPLE_NOTICE = 'Sample content: confirm with the client team before real use';
/** The line on the leader report's cover until it is confirmed. */
export const SAMPLE_REPORT_LINE = 'Sample content, not yet confirmed with the client.';
/** What the marker's `source` says. */
export const SAMPLE_SOURCE = 'Seed sample clients';

/** The id and creation date the seeds give each sample client (lib/sample-clients.js; scripts/test-seeds.js holds them equal). */
export const SAMPLE_ORIGINS = Object.freeze({ 'c-kroger': '2026-09-18T00:00:00.000Z', 'c-dominos': '2026-10-11T00:00:00.000Z' });

const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, any>} */ (value) : null);

/** The stored marker, or null. @param {{ theme?: unknown } | null | undefined} client */
export const sampleMark = (client) => asObject(asObject(client?.theme)?.sample);

/**
 * Was this client made by "Seed sample clients"?
 * @param {{ id?: string, createdAt?: string | null, theme?: unknown } | null | undefined} client
 */
export function isSampleClient(client) {
  if (!client) return false;
  if (sampleMark(client)) return true;
  if (typeof client.id !== 'string' || !Object.hasOwn(SAMPLE_ORIGINS, client.id)) return false;
  // The same INSTANT, not the same text: SharePoint hands a DateTime column back without the milliseconds (2026-09-18T00:00:00Z).
  const made = Date.parse(String(client.createdAt ?? ''));
  return Number.isFinite(made) && made === Date.parse(SAMPLE_ORIGINS[client.id]);
}

/**
 * Has somebody confirmed it? null for a client that is not a sample.
 * @param {{ id?: string, createdAt?: string | null, theme?: unknown } | null | undefined} client
 * @returns {{ confirmed: false } | { confirmed: true, by: string, at: string } | null}
 */
export function sampleState(client) {
  if (!isSampleClient(client)) return null;
  const mark = sampleMark(client);
  const at = typeof mark?.confirmedAt === 'string' ? mark.confirmedAt : '';
  return at ? { confirmed: true, by: typeof mark?.confirmedBy === 'string' ? mark.confirmedBy : '', at } : { confirmed: false };
}

/** Does this client still need the facilitator's "confirm with the client team"? @param {Parameters<typeof sampleState>[0]} client */
export const needsConfirmation = (client) => sampleState(client)?.confirmed === false;

/**
 * The ThemeJson to store when somebody confirms: everything as it was, and `sample` saying who and when.
 * @param {unknown} theme The client's current ThemeJson (read just now).
 * @param {{ by: string, at?: string }} who
 */
export function confirmedTheme(theme, { by, at = new Date().toISOString() }) {
  const held = asObject(theme) ?? {};
  return { ...held, sample: { source: SAMPLE_SOURCE, ...(asObject(held.sample) ?? {}), confirmedBy: by, confirmedAt: at } };
}

/** "Confirmed by Casey on 13 October 2026." @param {{ by: string, at: string }} state */
export function confirmedLine({ by, at }) {
  const when = new Date(at);
  const day = Number.isNaN(when.getTime()) ? '' : when.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return `Confirmed${by ? ` by ${by}` : ''}${day ? ` on ${day}` : ''}.`;
}
