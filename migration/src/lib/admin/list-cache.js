// What Clients and Content last read, held in this page's memory (Prompt 26): the screen is drawn from it at once and reads behind it, and draws again only if something
// differs. So another person's change shows at the next read, as it always did. Any write this page has sent since makes what is held no longer good (`writes`: the data
// layer's writesSent()). Never in browser storage: nothing outlives the page.

const held = new Map();

/** What was read under `key`, if no write has been sent since; else null. @param {string} key @param {number} writes */
export function heldRead(key, writes) {
  const entry = held.get(key);
  return entry && entry.writes === writes ? entry.rows : null;
}

/** Holds a read. Resolves to whether it differs from what was held (a screen draws again only then). @param {string} key @param {unknown} rows @param {number} writes */
export function holdRead(key, rows, writes) {
  const text = JSON.stringify(rows);
  const changed = held.get(key)?.text !== text;
  held.set(key, { rows, text, writes });
  return changed;
}

/** Forgets everything (a test's). */
export const forgetReads = () => held.clear();
