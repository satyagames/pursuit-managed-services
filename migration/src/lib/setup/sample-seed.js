// "Seed sample clients", with the clients' pictures (Phase 10f). Plain JS with JSDoc and no DOM, so `node --test` runs it, and ONLY the
// Setup page imports it: the files themselves are src/setup/sample-picture-data.ts, which `npm run test:bundle` keeps out of the participant
// and admin pages (they show a client's pictures from the picture library, like any client's).
//
// The order, and why:
//   1. The clients are read once; seedPack is handed that answer, so it does not read them again.
//   2. A client whose theme this seed writes (one that does not exist yet, or one made before clients had themes, whose empty theme is
//      filled: seed.js FILLABLE) gets its pictures. A client that exists with a theme gets nothing, its pictures included (seed.js rule 1:
//      nothing an admin may have edited is changed), so seeding twice uploads nothing twice.
//   3. Its pictures go to the picture library FIRST, so a client is never written pointing at a file that is not there; a failed upload
//      stops the seed before any client is made, and running it again carries on. On SharePoint the library's files are read once (one
//      GET) and a file of that name already there is not sent again: a name carries the hash of its bytes, so the same name is the same
//      picture. (The local server has no such read: there a file is written again under its own name, the same bytes.)
//   4. Then the pack, with each picture's address in its client's theme and LogoUrl, through seedPack: what is missing is created and
//      nothing is overwritten.
// The files are exactly what Brand Studio stored for those pictures in those slots (scripts/build-sample-pictures.js); uploading them goes
// through the data layer's own uploadClientAsset, as Brand Studio's save does.
import { listAddress, siteApi } from './provision.js';
import { samplePack } from './sample-clients.js';
import { SAMPLE_PICTURES } from './sample-pictures.js';
import { FILLABLE, seedPack } from './seed.js';

const SLOTS = /** @type {const} */ (['hero', 'logo', 'background']);
/** Where the local server serves its uploads (server/api.js): the addresses server/data/clients.json holds. */
export const LOCAL_PICTURES = '/assets/images/clients/';
/** What the progress line says of a picture. */
export const UPLOADED = 'Uploaded';
export const ALREADY_THERE = 'Already in the library';

const empty = (value) => value === undefined || value === null || value === '';

/**
 * The `pictures` samplePack() takes, for the sample clients named (both by default): each file's address from `addressOf(name)`, and the
 * focal point Brand Studio stored beside the background.
 * @param {(name: string) => string} addressOf
 * @param {string[]} [ids]
 */
export function pictureAddresses(addressOf, ids = Object.keys(SAMPLE_PICTURES)) {
  return Object.fromEntries(ids.map((id) => {
    const entry = SAMPLE_PICTURES[/** @type {keyof typeof SAMPLE_PICTURES} */ (id)];
    return [id, {
      hero: addressOf(entry.hero.name), logo: addressOf(entry.logo.name), background: addressOf(entry.background.name),
      backgroundFocus: { x: entry.backgroundFocus.x, y: entry.backgroundFocus.y },
    }];
  }));
}

/** The pack as the local server holds it (server/data): every picture at its address among the local server's uploads. */
export const localSamplePack = () => samplePack({ pictures: pictureAddresses((name) => `${LOCAL_PICTURES}${name}`) });

/**
 * The files in the picture library, by name in lower case (SharePoint does not tell the cases apart), with each one's address. One GET.
 * @param {any} dataService @param {string} library the library's title @param {string} siteUrl
 */
async function libraryFiles(dataService, library, siteUrl) {
  const data = await siteApi(dataService).read(`${listAddress(library)}/RootFolder/Files?$select=Name,ServerRelativeUrl`);
  return new Map((data?.results ?? data?.value ?? []).map((file) => [String(file.Name).toLowerCase(), new URL(file.ServerRelativeUrl, siteUrl).href]));
}

/**
 * Seeds the sample clients and their activities, and puts their pictures in the picture library first.
 * @param {any} dataService migration/src/lib/data/dataService.js
 * @param {object} options
 * @param {(name: string, type: string) => Blob | Promise<Blob>} options.file A sample picture's bytes, by its file name.
 * @param {string | null} [options.siteUrl] This copy's site (on SharePoint): the address of a file already in the library is built from it.
 * @param {(result: { list: string, id: string, status: string }) => void} [options.onProgress]
 * @returns {Promise<{ list: string, id: string, status: string }[]>} the pictures first, then seedPack's results.
 */
export async function seedSampleClients(dataService, { file, siteUrl = null, onProgress = () => {} }) {
  const clients = await dataService.listClients();
  const found = new Map(clients.map((client) => [String(client.id), client]));
  const themed = (id) => !found.has(id) || (FILLABLE.clients.includes('theme') && empty(found.get(id).theme));
  const pictured = Object.keys(SAMPLE_PICTURES).filter(themed);
  const results = [];
  const addresses = new Map();
  if (pictured.length > 0) {
    const sharePoint = dataService.isSharePointMode();
    const library = sharePoint ? dataService.sharePointListTitles().logoLibrary : 'Uploads';
    if (sharePoint && !siteUrl) throw new Error('The site of this copy is not known, so the pictures cannot be put in the library.');
    const there = sharePoint ? await libraryFiles(dataService, library, /** @type {string} */ (siteUrl)) : new Map();
    for (const id of pictured) {
      for (const slot of SLOTS) {
        const { name, type } = SAMPLE_PICTURES[/** @type {keyof typeof SAMPLE_PICTURES} */ (id)][slot];
        let url = there.get(name.toLowerCase());
        const status = url ? ALREADY_THERE : UPLOADED;
        if (!url) ({ url } = await dataService.uploadClientAsset(await file(name, type), name));
        addresses.set(name, url);
        const result = { list: library, id: name, status };
        results.push(result);
        onProgress(result);
      }
    }
  }
  const pack = samplePack({ pictures: pictureAddresses((name) => addresses.get(name), pictured) });
  // seedPack reads each list before it writes; the clients were read just now.
  const api = { ...dataService, listClients: async () => clients };
  results.push(...await seedPack(api, pack, onProgress));
  return results;
}
