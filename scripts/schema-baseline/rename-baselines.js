// Phase 10i, part B: the proof that schema version 3 changed what the data layer sends in exactly one way. Version 3 renamed two columns
// (PMSGuestList.DisplayName is GuestName, PMSVisitLog.DisplayName is SignedInName: the real site would not return a column called DisplayName by
// name), so an item read of those two lists names the new column in its `$select` where it named the old one. Every request baseline
// (scripts/request-baseline/*.txt) is translated: in each read of the items of a list with a retired column (pms-schema-meta.js RETIRED), the
// list's `$select` of version 2 becomes its `$select` of today (pms-schema.js selectOf), plain or encoded as a mock's `__next` link spells it.
// Nothing else moves, and every count stays what it was. A request's body is not recorded, so the version itself (3, written by Setup's Mark the
// site as ready) is in no entry. A fresh recording must then equal the translation EXACTLY, by the same comparison as always
// (scripts/request-baseline.js differences()), in every node suite and in the three browsers' start-up. The baselines are never recorded again.
//
//   node scripts/schema-baseline/rename-baselines.js --check             record every node suite afresh and compare it with its translated baseline
//                                                                      (writes nothing); lists every entry the translation moves
//   node scripts/schema-baseline/rename-baselines.js --order <commit>    the ORDER and the number of requests: every node suite run on <commit>'s tree
//                                                                      (the last green one: e07d2e3, since part A is red on purpose) and on today's,
//                                                                      request by request, one translated line against the other (writes nothing)
//   node scripts/schema-baseline/rename-baselines.js --to <dir>          write every baseline, translated, into <dir>: the browsers' proof is
//                                                                      PMS_BASELINE_DIR=<dir> npx playwright test ... request-baseline
//   node scripts/schema-baseline/rename-baselines.js --write             ONLY after the proofs passed: put the translation in place, with a line in
//                                                                      each file it changes that says so. Refuses a file already translated.
import { exec } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ID, LISTS, selectOf } from '../../migration/src/lib/schema/pms-schema.js';
import { RETIRED, columnNamesAt } from '../../migration/src/lib/schema/pms-schema-meta.js';
import { BASELINE_DIR, NODE_SUITES, differences, parse, recordSuite } from '../request-baseline.js';
import { sequence } from './select-baselines.js';

export const RENAME_NOTE = '# Amended in Phase 10i, part B: schema version 3 renamed PMSGuestList.DisplayName to GuestName and PMSVisitLog.DisplayName to SignedInName (the real site would not return a column called DisplayName by name), so each read of those two lists names the new column in its `$select`, by scripts/schema-baseline/rename-baselines.js, after a fresh recording equalled the translation exactly; the number and the order of the requests are as they were. Nothing else was changed.';

const ROOT = path.join(import.meta.dirname, '..', '..');
/** The `$select` of a list as version 2 spelled it, and as today does, for each list with a retired column. */
export const RENAMED = Object.freeze(Object.keys(RETIRED).map((key) => ({
  key, title: LISTS[key].title, before: `$select=${[...new Set(['Id', ID, ...columnNamesAt(key, 2)])]}`, after: selectOf(key),
})));
const encoded = (select) => new URLSearchParams([['$select', select.slice('$select='.length)]]).toString();

/**
 * One line of a baseline (an entry, or a read a batch carried) as the data layer sends it since schema version 3. A header line, a write, a read
 * of another list or of a list's columns, and a read that does not name the version-2 columns are left exactly as they are.
 * @param {string} line
 */
export function renameLine(line) {
  if (line.startsWith('#')) return line;
  const read = /^(~?\d+ x |    carries )GET (\S*\/getbytitle\('([^']+)'\)\/items)\?(.*)$/.exec(line);
  if (!read) return line;
  const [, lead, address, title, query] = read;
  const list = RENAMED.find((each) => each.title === decodeURIComponent(title));
  if (!list) return line;
  const swap = (text, from, to) => text.replace(new RegExp(`(^|&)${from.replace(/[$.*+?^{}()|[\]\\]/g, '\\$&')}(?=&|$)`), `$1${to}`);
  return `${lead}GET ${address}?${swap(swap(query, list.before, list.after), encoded(list.before), encoded(list.after))}`;
}

export const renameText = (text) => text.split('\n').map(renameLine).join('\n');
/** One request of a recording (a line, and the reads a batch carried) as the data layer sends it since schema version 3. */
export const renameRequest = (entry) => entry.split('\n').map((line) => (line.startsWith('    carries ') ? renameLine(line) : renameLine(`1 x ${line}`).slice('1 x '.length))).join('\n');

const baselineNames = async () => (await readdir(BASELINE_DIR)).filter((file) => file.endsWith('.txt')).map((file) => file.slice(0, -4)).sort();
/** The entries of a baseline the translation changes: [before, after]. */
const moves = (text) => [...parse(text).keys()].map((entry) => [entry, renameRequest(entry)]).filter(([before, after]) => before !== after);

async function check() {
  let entries = 0;
  let moved = 0;
  let failed = false;
  for (const name of NODE_SUITES) {
    const text = await readFile(path.join(BASELINE_DIR, `${name}.txt`), 'utf8');
    const translated = parse(renameText(text));
    const changed = moves(text);
    entries += parse(text).size;
    moved += changed.length;
    const found = differences(translated, await recordSuite(name));
    console.log(`${name}: ${found.length ? `${found.length} DIFFERENCE${found.length === 1 ? '' : 'S'} from the translation` : 'equals the translation'} (${parse(text).size} entries, ${changed.length} of them renamed)`);
    for (const [before, after] of changed) console.log(`  - ${before.replaceAll('\n', '\n    ')}\n  + ${after.replaceAll('\n', '\n    ')}`);
    for (const difference of found) console.log(`  ${difference.replaceAll('\n', '\n    ')}`);
    failed ||= found.length > 0;
  }
  console.log(`\nnode suites: ${entries} entries, ${moved} of them renamed; ${failed ? 'NOT equal' : 'every fresh recording equals its translated baseline'}`);
  process.exitCode = failed ? 1 : 0;
}

/** A commit's whole tree in a temporary folder, with this checkout's node_modules. */
async function exportCommit(commit) {
  const dir = await mkdtemp(path.join(os.tmpdir(), `pms-${commit}-`));
  await promisify(exec)(`git archive --format=tar ${commit} | tar -x -C "${dir}"`, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  await symlink(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  return dir;
}

/**
 * The order: request by request, `commit`'s translated against today's. An entry whose count depends on timing (`~` in the baseline) is set
 * aside on both sides, and how many of it each side sent is printed; every other request must be the same, in the same place.
 */
async function order(commit) {
  if (!/^[0-9a-f]{7,40}$/.test(commit ?? '')) throw new Error('Name the commit to compare with: --order <commit>.');
  const before = await exportCommit(commit);
  let failed = false;
  let total = 0;
  try {
    for (const name of NODE_SUITES) {
      const loose = new Set([...parse(renameText(await readFile(path.join(BASELINE_DIR, `${name}.txt`), 'utf8')))].filter(([, { loose: timed }]) => timed).map(([entry]) => entry));
      const translated = (await sequence(name, before)).map(renameRequest);
      const now = await sequence(name, ROOT);
      total += now.length;
      const [held, heldNow] = [translated.filter((entry) => !loose.has(entry)), now.filter((entry) => !loose.has(entry))];
      const renamed = now.filter((entry) => RENAMED.some((list) => entry.includes(list.after))).length;
      let first = -1;
      for (let at = 0; at < Math.max(held.length, heldNow.length); at += 1) if (held[at] !== heldNow[at]) { first = at; break; }
      if (first === -1) {
        console.log(`${name}: ${now.length} requests (${translated.length} at ${commit}); ${heldNow.length} of them in the same order, each ${commit}'s with the new column names (${renamed} name one)${loose.size ? `, and ${translated.length - held.length} and ${now.length - heldNow.length} of the requests whose count depends on timing` : ''}`);
        continue;
      }
      failed = true;
      console.log(`${name}: first difference at request ${first + 1} of those whose count does not depend on timing`);
      console.log(`  ${commit}, translated: ${held[first]?.replaceAll('\n', ' + ')}\n  today:              ${heldNow[first]?.replaceAll('\n', ' + ')}`);
    }
  } finally {
    await rm(before, { recursive: true, force: true });
  }
  console.log(`\n${total} requests in all; ${failed ? 'NOT the same' : 'the same requests, in the same number and order, but for the ones whose count depends on timing'}`);
  process.exitCode = failed ? 1 : 0;
}

async function writeTo(dir) {
  await mkdir(dir, { recursive: true });
  let moved = 0;
  for (const name of await baselineNames()) {
    const text = await readFile(path.join(BASELINE_DIR, `${name}.txt`), 'utf8');
    moved += moves(text).length;
    await writeFile(path.join(dir, `${name}.txt`), renameText(text));
  }
  console.log(`Wrote ${(await baselineNames()).length} translated baselines to ${dir} (${moved} entries renamed, in all).`);
}

async function writeInPlace() {
  for (const name of await baselineNames()) {
    const file = path.join(BASELINE_DIR, `${name}.txt`);
    const text = await readFile(file, 'utf8');
    if (text.includes(RENAME_NOTE)) throw new Error(`${name}.txt was translated already.`);
    const changed = moves(text);
    if (!changed.length) { console.log(`${name}.txt: nothing to rename, left as it is`); continue; }
    const lines = renameText(text).split('\n');
    const header = lines.filter((line) => line.startsWith('#'));
    const body = lines.filter((line) => !line.startsWith('#'));
    await writeFile(file, [...header, RENAME_NOTE, ...body].join('\n'));
    console.log(`${name}.txt: ${changed.length} of ${parse(text).size} entries renamed`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.includes('--check')) await check();
  else if (process.argv.includes('--order')) await order(process.argv[process.argv.indexOf('--order') + 1]);
  else if (process.argv.includes('--to')) await writeTo(path.resolve(process.argv[process.argv.indexOf('--to') + 1]));
  else if (process.argv.includes('--write')) await writeInPlace();
  else console.log('Use --check, --order <commit>, --to <dir> or --write (see the top of the file).');
}
