// Phase 10h, part A: the proof that naming the columns of every item read changed what the data layer sends in exactly one way. Every
// request baseline (scripts/request-baseline/*.txt) is translated: each item read that names no columns gets `&$select=` and its list's
// columns (pms-schema.js selectOf) at the end of its query, as the data layer now builds it (dataService.js spItems), and a `__next` link the
// mock made of such a read carries the same, encoded, before its own `$fakeskip`, as the mock now makes it. Nothing else moves: an entry that
// already named its columns (a participant's answers, Setup's probes) is left as it is, and every count stays what it was. A fresh recording
// must then equal the translation EXACTLY, by the same comparison as always (scripts/request-baseline.js differences()), in every node suite
// and in the three browsers' start-up. The baselines are never recorded again: they are translated, and the translation is proved.
//
//   node scripts/schema-baseline/select-baselines.js --check         record every node suite afresh and compare it with its translated baseline
//                                                                   (writes nothing); says how many entries the translation moved
//   node scripts/schema-baseline/select-baselines.js --order         the ORDER and the number of requests: every node suite run on the last
//                                                                   commit's tree and on today's, request by request, one translated line against
//                                                                   the other (writes nothing)
//   node scripts/schema-baseline/select-baselines.js --to <dir>      write every baseline, translated, into <dir>: the browsers' proof is
//                                                                   PMS_BASELINE_DIR=<dir> npx playwright test ... request-baseline
//   node scripts/schema-baseline/select-baselines.js --write         ONLY after the proofs passed: put the translation in place, with a line in
//                                                                   each file's header that says so. Refuses a file already translated.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { LISTS, selectOf } from '../../migration/src/lib/schema/pms-schema.js';
import { BASELINE_DIR, NODE_SUITES, differences, exportLastCommit, normalise, parse, recordSuite } from '../request-baseline.js';

export const SELECT_NOTE = '# Amended in Phase 10h, part A: every item read names its columns, so each entry that read items without naming them has `&$select=` and its list\'s columns at the end of its query (and a mock\'s `__next` link of such a read carries them before its `$fakeskip`), by scripts/schema-baseline/select-baselines.js, after a fresh recording equalled the translation exactly; the number and the order of the requests are as they were. Nothing else was changed.';

const KEY_OF = new Map(Object.entries(LISTS).map(([key, { title }]) => [title, key]));
/** Titles an item read names that are no list of the schema, left as they are (a test's own, on purpose). */
export const LEFT = new Set();

/**
 * One line of a baseline (an entry, or a read a batch carried) as the data layer sends it since Phase 10h. A header line, a write, a read
 * that is not of items, and a read that names its columns already are left exactly as they are.
 * @param {string} line
 */
export function selectLine(line) {
  if (line.startsWith('#')) return line;
  const read = /^(~?\d+ x |    carries )GET (\S*\/getbytitle\('([^']+)'\)\/items)\?(.*)$/.exec(line);
  if (!read) return line;
  const [, lead, address, title, query] = read;
  if (/(?:^|&)(?:\$|%24)select=/.test(query)) return line;
  const key = KEY_OF.get(decodeURIComponent(title));
  if (!key) { LEFT.add(decodeURIComponent(title)); return line; }
  // A `__next` link the mock made: the query as URLSearchParams wrote it, with $fakeskip last; the select goes before it, encoded the same way.
  const skip = query.indexOf('&%24fakeskip=');
  if (skip !== -1) return `${lead}GET ${address}?${query.slice(0, skip)}&${new URLSearchParams([['$select', selectOf(key).slice('$select='.length)]])}${query.slice(skip)}`;
  return `${lead}GET ${address}?${query}&${selectOf(key)}`;
}

export const selectText = (text) => text.split('\n').map(selectLine).join('\n');
/** One request of a recording (scripts/request-recorder.js: a line, and the reads a batch carried) as the data layer sends it since Phase 10h. */
export const selectRequest = (entry) => entry.split('\n').map((line) => (line.startsWith('    carries ') ? selectLine(line) : selectLine(`1 x ${line}`).slice('1 x '.length))).join('\n');

/** Every baseline file's name (without .txt). */
const baselineNames = async () => (await readdir(BASELINE_DIR)).filter((file) => file.endsWith('.txt')).map((file) => file.slice(0, -4)).sort();

async function check() {
  let entries = 0;
  let moved = 0;
  let failed = false;
  for (const name of NODE_SUITES) {
    const text = await readFile(path.join(BASELINE_DIR, `${name}.txt`), 'utf8');
    const old = parse(text);
    const translated = parse(selectText(text));
    const changed = [...old.keys()].filter((entry) => !translated.has(entry)).length;
    entries += old.size;
    moved += changed;
    const found = differences(translated, await recordSuite(name));
    console.log(`${name}: ${found.length ? `${found.length} DIFFERENCE${found.length === 1 ? '' : 'S'} from the translation` : 'equals the translation'} (${old.size} entries, ${changed} of them with their columns named)`);
    for (const difference of found) console.log(`  ${difference.replaceAll('\n', '\n    ')}`);
    failed ||= found.length > 0;
  }
  console.log(`\nnode suites: ${entries} entries, ${moved} of them translated; ${failed ? 'NOT equal' : 'every fresh recording equals its translated baseline'}`);
  if (LEFT.size) console.log(`left as they were (a test's own titles, no list of the schema): ${[...LEFT].join(', ')}`);
  process.exitCode = failed ? 1 : 0;
}

/** Every request one node suite sends, in the order it sends them, as recorder lines (scripts/request-recorder.js), in the tree `root`. */
export async function sequence(name, root) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pms-order-'));
  const file = path.join(dir, 'requests.txt');
  const { NODE_TEST_CONTEXT: _runner, ...inherited } = process.env;
  try {
    await promisify(execFile)(process.execPath, ['--import', new URL('../request-recorder.js', import.meta.url).href, path.join(root, 'scripts', `${name}.js`)], {
      cwd: root, env: { ...inherited, PMS_RECORD_REQUESTS: file }, maxBuffer: 64 * 1024 * 1024,
    }).catch((error) => { throw new Error(`${name} failed in ${root}:\n${String(error.stdout ?? '').slice(-3000)}`); });
    const text = existsSync(file) ? await readFile(file, 'utf8') : '';
    // One request is one entry: a batch and the reads it carried together.
    const entries = [];
    for (const line of normalise(text).split('\n')) {
      if (!line.trim()) continue;
      if (line.startsWith('    carries ') && entries.length) entries[entries.length - 1] += `\n${line}`;
      else entries.push(line);
    }
    return entries;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The order: request by request, the last commit's translated against today's. An entry whose count depends on timing (`~` in the baseline: a page's
 * timer that fits one more look into a test on a faster run) is set aside on both sides, and how many of it each side sent is printed; every other
 * request must be the same, in the same place.
 */
async function order() {
  const lastCommit = await exportLastCommit();
  let failed = false;
  let total = 0;
  try {
    for (const name of NODE_SUITES) {
      const loose = new Set([...parse(selectText(await readFile(path.join(BASELINE_DIR, `${name}.txt`), 'utf8')))].filter(([, { loose: timed }]) => timed).map(([entry]) => entry));
      const translated = (await sequence(name, lastCommit)).map(selectRequest);
      const now = await sequence(name, path.join(import.meta.dirname, '..', '..'));
      total += now.length;
      const [held, heldNow] = [translated.filter((entry) => !loose.has(entry)), now.filter((entry) => !loose.has(entry))];
      const timed = `${translated.length - held.length} and ${now.length - heldNow.length}`;
      let first = -1;
      for (let at = 0; at < Math.max(held.length, heldNow.length); at += 1) if (held[at] !== heldNow[at]) { first = at; break; }
      if (first === -1) {
        console.log(`${name}: ${now.length} requests (${translated.length} at the last commit); ${heldNow.length} of them in the same order, each the last commit's with its columns named${loose.size ? `, and ${timed} of the requests whose count depends on timing` : ''}`);
        continue;
      }
      failed = true;
      console.log(`${name}: first difference at request ${first + 1} of those whose count does not depend on timing`);
      console.log(`  last commit, translated: ${held[first]?.replaceAll('\n', ' + ')}\n  today:                   ${heldNow[first]?.replaceAll('\n', ' + ')}`);
    }
  } finally {
    await rm(lastCommit, { recursive: true, force: true });
  }
  console.log(`\n${total} requests in all; ${failed ? 'NOT the same' : 'the same requests, in the same number and order, but for the ones whose count depends on timing'}`);
  process.exitCode = failed ? 1 : 0;
}

async function writeTo(dir) {
  await mkdir(dir, { recursive: true });
  let moved = 0;
  for (const name of await baselineNames()) {
    const text = await readFile(path.join(BASELINE_DIR, `${name}.txt`), 'utf8');
    const translated = selectText(text);
    moved += [...parse(text).keys()].filter((entry) => !parse(translated).has(entry)).length;
    await writeFile(path.join(dir, `${name}.txt`), translated);
  }
  console.log(`Wrote ${(await baselineNames()).length} translated baselines to ${dir} (${moved} entries with their columns named, in all).`);
}

async function writeInPlace() {
  for (const name of await baselineNames()) {
    const file = path.join(BASELINE_DIR, `${name}.txt`);
    const text = await readFile(file, 'utf8');
    if (text.includes(SELECT_NOTE)) throw new Error(`${name}.txt was translated already.`);
    const old = parse(text);
    const lines = selectText(text).split('\n');
    const now = parse(lines.join('\n'));
    const moved = [...old.keys()].filter((entry) => !now.has(entry)).length;
    const header = lines.filter((line) => line.startsWith('#'));
    const body = lines.filter((line) => !line.startsWith('#'));
    await writeFile(file, [...header, SELECT_NOTE, ...body].join('\n'));
    console.log(`${name}.txt: ${moved} of ${old.size} entries with their columns named`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.includes('--check')) await check();
  else if (process.argv.includes('--order')) await order();
  else if (process.argv.includes('--to')) await writeTo(path.resolve(process.argv[process.argv.indexOf('--to') + 1]));
  else if (process.argv.includes('--write')) await writeInPlace();
  else console.log('Use --check, --order, --to <dir> or --write (see the top of the file).');
}
