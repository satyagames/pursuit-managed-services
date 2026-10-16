// Phase 10j, part B: the proof that the column check's read changed what the data layer sends in exactly one way. Before a list is first
// written through the general create or update, dataService.js reads the list's columns and checks them (spMetadata); that read named no
// properties (`.../fields`), and now names the eight the check uses (`.../fields?$select=InternalName,...`). The other reads of a list's columns
// (the schema check of Today and of Setup, carried in a $batch or not, and Setup's plan) still name none, and read the same address as before.
//
// So a baseline's `N x GET <list>/fields` is, since this part, `N - k x GET <list>/fields` and `k x GET <list>/fields?$select=...`, where k is how
// many of those N reads were the check's. The text of a baseline cannot say which they were: the suites are run on the last commit's tree and on
// today's, request by request, and every request must be the same, in the same place, except that a read of a list's columns gained the
// `$select` (--order). That run gives k for each suite and list, and the translation is the old baseline with each entry split by it. A fresh
// recording must then equal the translation EXACTLY (--check), by the same comparison as always (scripts/request-baseline.js differences()). The
// baselines are never recorded again. The browsers' start-up sends no such read: their baselines are not touched.
//
//   node scripts/schema-baseline/fields-baselines.js --order           every node suite on the last commit's tree and on today's, request by request
//                                                                     (writes nothing); prints how many of each list's column reads gained the $select
//   node scripts/schema-baseline/fields-baselines.js --check           the same run, then a fresh recording of every node suite against its translation
//   node scripts/schema-baseline/fields-baselines.js --write           ONLY after --check passed: the translation in place, with a line in the header
//                                                                     of each file it changes. Refuses a file already translated.
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASELINE_DIR, NODE_SUITES, differences, exportLastCommit, parse, recordSuite } from '../request-baseline.js';
import { sequence } from './select-baselines.js';

export const FIELD_CHECK = '$select=InternalName,TypeAsString,Indexed,EnforceUniqueValues,RichText,AppendOnly,Required,ReadOnlyField';
export const FIELDS_NOTE = '# Amended in Phase 10j, part B: the column check before a list\'s first write (dataService.js spMetadata) names the eight properties it checks, so each of its reads of a list\'s columns ends `/fields?$select=InternalName,TypeAsString,Indexed,EnforceUniqueValues,RichText,AppendOnly,Required,ReadOnlyField` where it ended `/fields`; which of a list\'s `/fields` reads were the check\'s was found by running the suite on the last commit\'s tree and on today\'s, request by request (scripts/schema-baseline/fields-baselines.js), and a fresh recording equalled the translation exactly; the number and the order of the requests are as they were, and the schema checks\' own reads of a list\'s columns are unchanged. Nothing else was changed.';

/** `GET <address>/fields`, the read as it was: the address, or null for any other request. */
const columnsRead = (entry) => /^GET (\S+\/fields)$/.exec(entry)?.[1] ?? null;

/**
 * Every node suite, on the last commit's tree and on today's, request by request. Resolves to Map(suite -> Map(address -> k)), k being how many
 * reads of that list's columns gained the $select, and the suites where anything else differs (each with its first difference).
 */
async function compare() {
  const lastCommit = await exportLastCommit();
  const splits = new Map();
  const failures = [];
  let total = 0;
  try {
    for (const name of NODE_SUITES) {
      const loose = new Set([...parse(await readFile(path.join(BASELINE_DIR, `${name}.txt`), 'utf8'))].filter(([, { loose: timed }]) => timed).map(([entry]) => entry));
      const before = (await sequence(name, lastCommit)).filter((entry) => !loose.has(entry));
      const now = (await sequence(name, path.join(import.meta.dirname, '..', '..'))).filter((entry) => !loose.has(entry));
      total += now.length;
      const split = new Map();
      let first = -1;
      for (let at = 0; at < Math.max(before.length, now.length); at += 1) {
        if (before[at] === now[at]) continue;
        const address = columnsRead(before[at] ?? '');
        if (address && now[at] === `GET ${address}?${FIELD_CHECK}`) { split.set(address, (split.get(address) ?? 0) + 1); continue; }
        first = at;
        break;
      }
      if (first !== -1) {
        failures.push(name);
        console.log(`${name}: first difference at request ${first + 1} of those whose count does not depend on timing`);
        console.log(`  last commit: ${before[first]?.replaceAll('\n', ' + ')}\n  today:       ${now[first]?.replaceAll('\n', ' + ')}`);
        continue;
      }
      splits.set(name, split);
      const named = [...split.values()].reduce((sum, count) => sum + count, 0);
      console.log(`${name}: ${now.length} requests, the same and in the same order as the last commit's but for ${named} read${named === 1 ? '' : 's'} of a list's columns that name the eight properties now (${split.size} list${split.size === 1 ? '' : 's'})`);
    }
  } finally {
    await rm(lastCommit, { recursive: true, force: true });
  }
  console.log(`\n${total} requests in all (those whose count depends on timing set aside); ${failures.length ? `NOT the same in ${failures.join(', ')}` : 'the same requests, in the same number and order, but for the column check\'s $select'}`);
  return { splits, failures };
}

/** A baseline's text with each `N x GET <address>/fields` split by `split` (address -> k). Throws if k is more than N or the entry is loose. */
export function splitText(text, split) {
  const out = [];
  const left = new Map(split);
  for (const line of text.split('\n')) {
    const entry = /^(~?)(\d+) x GET (\S+\/fields)$/.exec(line);
    const k = entry ? left.get(entry[3]) : undefined;
    if (!entry || !k) { out.push(line); continue; }
    if (entry[1] === '~') throw new Error(`A loose entry cannot be split: ${line}`);
    const count = Number(entry[2]);
    if (k > count) throw new Error(`${k} of ${count} reads cannot be the check's: ${line}`);
    if (count > k) out.push(`${count - k} x GET ${entry[3]}`);
    out.push(`${k} x GET ${entry[3]}?${FIELD_CHECK}`);
    left.delete(entry[3]);
  }
  if (left.size) throw new Error(`No baseline entry for ${[...left.keys()].join(', ')}`);
  // (In the order the file has: the new entry sorts straight after the plain one, as render() would put it.)
  return out.join('\n');
}

async function check(write) {
  const { splits, failures } = await compare();
  if (failures.length) { process.exitCode = 1; return; }
  let failed = false;
  const translations = new Map();
  for (const name of NODE_SUITES) {
    const split = splits.get(name);
    const text = await readFile(path.join(BASELINE_DIR, `${name}.txt`), 'utf8');
    const translated = split.size ? splitText(text, split) : text;
    translations.set(name, { text, translated, split });
    const found = differences(parse(translated), await recordSuite(name));
    console.log(`${name}: ${found.length ? `${found.length} DIFFERENCE${found.length === 1 ? '' : 'S'} from the translation` : 'a fresh recording equals the translation'}${split.size ? '' : ' (nothing translated)'}`);
    for (const [address, k] of split) console.log(`  ${k} x ${address}  ->  ?${FIELD_CHECK.slice(0, 30)}...`);
    for (const difference of found) console.log(`  ${difference.replaceAll('\n', '\n    ')}`);
    failed ||= found.length > 0;
  }
  console.log(`\n${failed ? 'NOT equal' : 'every fresh recording equals its translated baseline'}`);
  if (failed) { process.exitCode = 1; return; }
  if (!write) return;
  for (const [name, { text, translated, split }] of translations) {
    if (!split.size) continue;
    if (text.includes(FIELDS_NOTE)) throw new Error(`${name}.txt was translated already.`);
    const lines = translated.split('\n');
    const header = lines.filter((line) => line.startsWith('#'));
    const body = lines.filter((line) => !line.startsWith('#'));
    await writeFile(path.join(BASELINE_DIR, `${name}.txt`), [...header, FIELDS_NOTE, ...body].join('\n'));
    console.log(`${name}.txt: ${split.size} entr${split.size === 1 ? 'y' : 'ies'} split`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.includes('--order')) process.exitCode = (await compare()).failures.length ? 1 : 0;
  else if (process.argv.includes('--check')) await check(false);
  else if (process.argv.includes('--write')) await check(true);
  else console.log('Use --order, --check or --write (see the top of the file).');
}
