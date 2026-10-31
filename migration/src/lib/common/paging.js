// A screen draws one page of a long list (Prompt 26): the sums and the address. Plain JS with no DOM. What is read is the screen's: one light read of the
// keys and the filter columns (the index: lib/admin/list-index.js), kept in memory, so search, chips and filters work on the whole set and a page costs nothing.
// Each list's page size is one constant here.

/** How many rows a page of each list shows. */
export const PER_PAGE = Object.freeze({ people: 5, clients: 5, sessions: 5, dashboardClients: 5, guests: 20, history: 10 });

/** How many rows an index read asks for in one request: the most SharePoint returns in one page of a list read. A list longer than this costs one request more for each such page. */
export const INDEX_TOP = 5000;

/**
 * Where a person is in a list of `total` rows: a page that no longer exists (rows were deleted) steps back to the last one there is.
 * @param {{ total: number, pageSize: number, page?: number }} options
 */
export function pagerState({ total, pageSize, page = 1 }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const at = Math.min(Math.max(1, Math.trunc(Number(page)) || 1), pages);
  const from = total === 0 ? 0 : (at - 1) * pageSize + 1;
  const to = Math.min(at * pageSize, total);
  return {
    page: at, pages, total, pageSize, from, to, hasPrevious: at > 1, hasNext: at < pages,
    line: `Page ${at} of ${pages}`, range: total === 0 ? '' : `Showing ${from} to ${to} of ${total}`,
  };
}

/** The rows of the page `state` is on. @template T @param {T[]} rows @param {{ page: number, pageSize: number }} state @returns {T[]} */
export const pageRows = (rows, { page, pageSize }) => rows.slice((page - 1) * pageSize, page * pageSize);

/** The page an address asks for (`#users?page=2`), or 1. @param {string} hash */
export function pageOfHash(hash) {
  const asked = Number(/[?&]page=(\d+)/.exec(hash)?.[1]);
  return asked >= 1 ? asked : 1;
}

/** `hash` with `page` in it (nothing for the first page). @param {string} hash @param {number} page */
export function hashWithPage(hash, page) {
  const [bare] = hash.split('?');
  return page > 1 ? `${bare}?page=${page}` : bare;
}
