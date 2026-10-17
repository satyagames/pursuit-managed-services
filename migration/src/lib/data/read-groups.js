// Reads in groups of 20 ids to an address (Phase 9b), so that no request address grows with what a session holds. Plain JS with JSDoc and no DOM.
//
// A SharePoint read by several ids puts each of them in the address (about 40 characters an id, 60 with a UUID). The admin's newer reads
// (dataService.readActivityContent, lib/exports/leader-report-data.js) already read in groups of 20; the activities of a session were read in one address
// each time, so a session with many activities grew one. Nothing here is the tenant's limit: whether it has one near 2,000 characters is what the
// Setup page's self-test prints (QA-TESTING.md).

/** Ids to an address: 20 keeps one read under about 1,400 characters even with UUIDs. */
export const READ_CHUNK = 20;

/** @template T @param {T[]} list @param {number} [size] @returns {T[][]} */
export const groupsOf = (list, size = READ_CHUNK) => Array.from({ length: Math.ceil(list.length / size) }, (_unused, index) => list.slice(index * size, (index + 1) * size));

/** The reads of some activities by id, in groups of 20, for dataService.readLists(). @param {string[]} ids */
export const sectionQueries = (ids) => groupsOf([...new Set(ids.map(String))]).map((group) => ({ list: 'sections', where: { id: group } }));
