// Seeding: puts a pack of clients and their activities into the backend through the data service,
// so the same code seeds the local server and SharePoint. Plain JS, no DOM (`node --test` runs it).
//
// The rules, in order of importance:
//   1. Nothing an admin may have edited is ever changed. A record that exists is left as it is.
//   2. Create only what is missing. Ids are fixed, so running it twice creates nothing twice, and
//      two admins running it together cannot create a record twice either (the id is unique).
//   3. The one thing done to an existing record is to fill a field that is EMPTY and that did not
//      exist before clients owned activities (FILLABLE): a record made before then cannot hold an
//      edit there. That is how the earlier Kroger starter content gains its slug, theme and client.

/** Lists in creation order: answers and questions before the activity that lists them. */
import { LISTS as SCHEMA } from '../schema/pms-schema.js';
const LISTS = [
  { key: 'clients', title: SCHEMA.clients.title, list: 'listClients', create: 'createClient', update: 'updateClient' },
  { key: 'options', title: SCHEMA.options.title, list: 'listOptions', create: 'createOption', update: 'updateOption' },
  { key: 'questions', title: SCHEMA.questions.title, list: 'listQuestions', create: 'createQuestion', update: 'updateQuestion' },
  { key: 'sections', title: SCHEMA.sections.title, list: 'listSections', create: 'createSection', update: 'updateSection' },
];

/** The fields added for client scoping: the only ones ever filled in on a record that already exists. */
export const FILLABLE = {
  clients: ['slug', 'theme', 'themeVersion', 'status'],
  sections: ['clientId', 'description'],
  questions: ['layout'],
  options: ['imageUrl'],
};

const empty = (value) => value === undefined || value === null || value === '';

/**
 * @param {any} api migration/src/lib/data/dataService.js (or a stand-in with the same list/create/update functions).
 * @param {{ clients: any[], sections: any[], questions: any[], options: any[] }} pack
 * @param {(result: { list: string, id: string, status: string }) => void} [onProgress]
 * @returns {Promise<{ list: string, id: string, status: 'Created' | 'Completed' | 'Skipped existing' }[]>}
 *   'Completed' means empty added fields were filled in; nothing else on the record was touched.
 */
export async function seedPack(api, pack, onProgress = () => {}) {
  const results = [];
  for (const { key, title, list, create, update } of LISTS) {
    const records = pack[key] ?? [];
    if (records.length === 0) continue;
    const existing = new Map((await api[list]()).map((record) => [String(record.id), record]));
    for (const record of records) {
      /** @type {'Created' | 'Completed' | 'Skipped existing'} */
      let status = 'Skipped existing';
      const found = existing.get(String(record.id));
      if (!found) {
        try {
          await api[create](record);
          status = 'Created';
        } catch (error) {
          if (error?.status !== 409) throw error; // 409: someone else created it a moment ago
        }
      } else {
        const fill = Object.fromEntries((FILLABLE[key] ?? [])
          .filter((field) => empty(found[field]) && !empty(record[field]))
          .map((field) => [field, record[field]]));
        if (Object.keys(fill).length > 0) {
          await api[update](record.id, fill);
          status = 'Completed';
        }
      }
      const result = { list: title, id: record.id, status };
      results.push(result);
      onProgress(result);
    }
  }
  return results;
}
