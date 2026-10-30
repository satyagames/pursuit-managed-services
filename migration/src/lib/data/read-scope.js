// The read check of the data layer (Prompt 21, Phase 4): a read of a list that belongs to places (clients, sessions, activities, a session's answers)
// asks the page's access guard first (lib/access/guard.js, its `read`), and tells it what came back (its `learn`), so that a scoped role's requests
// name only the places it holds and the guard knows whose each session and activity is. Pages that install no guard (the participant page, Setup, a
// global role's) are asked nothing. No state, no imports: core.js and today-clients.js use it.

/**
 * Runs `read` for `list` by `where`, after the guard's read check and before its learning.
 * @template T @param {{ read?: (list: string, where?: any) => void, learn?: (list: string, rows: any[]) => void } | null} guard
 * @param {string} list @param {Record<string, unknown> | undefined} where @param {() => Promise<T>} read @returns {Promise<T>}
 */
export async function observed(guard, list, where, read) {
  guard?.read?.(list, where); // (throws AccessDenied: nothing is sent)
  const rows = await read();
  if (guard?.learn && Array.isArray(rows)) guard.learn(list, rows);
  return rows;
}
