// Phase 17: the source of the data service, for the tests that read it (a title spelled nowhere, the columns a check reads, a picture's name).
// Until Phase 17 that was migration/src/lib/data/dataService.js alone; it is now that file and the parts it passes on (docs/DECISIONS.md,
// "The data layer"), so a check of "the data layer's source" reads all of them. read-groups.js, a helper of the admin's reads that the service
// does not import, is not part of it, as it was not before.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const DATA_DIR = path.join(import.meta.dirname, '..', 'migration', 'src', 'lib', 'data');
/** The files of lib/data that are not the data service. */
export const NOT_THE_SERVICE = ['read-groups.js'];

/** The data service's files (dataService.js first, then its parts by name), as paths. */
export async function dataLayerFiles() {
  const names = (await readdir(DATA_DIR)).filter((name) => name.endsWith('.js') && !NOT_THE_SERVICE.includes(name)).sort();
  return ['dataService.js', ...names.filter((name) => name !== 'dataService.js')].map((name) => path.join(DATA_DIR, name));
}

/** The data service's source: every one of its files, one after the other. */
export async function dataLayerSource() {
  const texts = await Promise.all((await dataLayerFiles()).map((file) => readFile(file, 'utf8')));
  return texts.join('\n');
}
