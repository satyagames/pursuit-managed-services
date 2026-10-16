// Setup's import of a seed file (`npm run export:sharepoint`): content made on another copy of the app, put on this site where it is missing.
// Plain JS with JSDoc and no DOM, and ONLY the Setup page imports it (`npm run test:bundle` holds that).
//
// Phase 10c-3 moved it here from dataService.js (importSharePointSeed), which the participant page carries whole, and built it on the data layer's
// own calls, so it sends exactly the requests it sent; and it no longer imports admins. A file's `adminusers` are left out, so the demo admin and
// its PIN cannot reach a new site this way: admins are added with "Add an admin" (lib/setup-admins.js). A file made before Phase 10c-2a also holds
// `theme`, the legacy look's one item: such a file is accepted and that key is not read either.
import { assetLocation } from '../../../public/js/assets.js';
import { LISTS } from '../../../public/js/pms-schema.js';

/** The lists a seed file's records are put in, in this order; the reads and creates of each are the data layer's own. */
const IMPORTED = {
  clients: ['getClient', 'createClient'],
  sections: ['getSection', 'createSection'],
  questions: ['getQuestion', 'createQuestion'],
  options: ['getOption', 'createOption'],
  sessions: ['getSession', 'createSession'],
};

/** How many admins a seed file holds (the page says that they were left out). */
export const adminsInSeed = (seed) => (Array.isArray(seed?.data?.adminusers) ? seed.data.adminusers.length : 0);

/**
 * Puts the records of a seed file on the site where they are missing; a record whose id is there already is never changed. SharePoint only.
 * Resolves to [{ list, id, status: 'Imported' | 'Skipped existing' }], one for each record, as it goes (`onProgress`).
 * @param {any} dataService
 * @param {any} seed the parsed file
 * @param {(result: { list: string, id: string, status: string }) => void} [onProgress]
 */
export async function importSeed(dataService, seed, onProgress = () => {}) {
  if (!dataService.isSharePointMode()) throw new Error('SharePoint mode is not enabled on this page.');
  if (seed?.version !== 1 || !seed.data || typeof seed.data !== 'object' || Array.isArray(seed.data)) {
    throw new Error('Select a seed file produced by npm run export:sharepoint.');
  }
  for (const list of Object.keys(IMPORTED)) {
    const records = seed.data[list];
    if (!Array.isArray(records)) throw new Error(`Seed file is missing ${list}.`);
    const ids = new Set();
    for (const record of records) {
      if (!record || typeof record.id !== 'string' || !record.id || ids.has(record.id)) throw new Error(`Invalid or duplicate ID in ${list}.`);
      ids.add(record.id);
      const stray = Object.keys(record).find((key) => record[key] !== undefined && !LISTS[list].fields[key]);
      if (stray) throw new Error(`Unsupported field ${list}.${stray}.`);
    }
  }
  const checks = await dataService.checkSharePointLists();
  const problem = checks.find((check) => check.status !== 'Ready');
  if (problem) throw new Error(problem.status);
  const titles = dataService.sharePointListTitles();
  const results = [];
  for (const [list, [read, make]] of Object.entries(IMPORTED)) {
    for (const record of seed.data[list]) {
      let status = 'Skipped existing';
      if (!(await dataService[read](record.id))) {
        const fields = { ...record };
        if (fields.logoUrl?.startsWith('/assets/')) fields.logoUrl = assetLocation(fields.logoUrl.slice(1));
        try {
          await dataService[make](fields);
          status = 'Imported';
        } catch (error) {
          if (error.status !== 409) throw error;
        }
      }
      const result = { list: titles[list], id: record.id, status };
      results.push(result);
      onProgress(result);
    }
  }
  return results;
}
