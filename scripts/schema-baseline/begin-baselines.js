// Phase 10j, part C: the proof that beginning a visit changed what the data layer sends in exactly one way. dataService.beginVisit read the
// session twice: once to check it, and again inside the write that moves it to in progress (the general update reads an item before it writes
// it). It now writes with the version the check read, so that second read is gone; the write itself, the reads of the sessions list's type and
// columns before it, and every other request are as they were, in the same order. (Its first two reads, AppSettings and the session, are now
// sent side by side; the mock answers them in the order they are sent, AppSettings first, as before.)
//
// So a baseline's `N x GET <PMSClientSessions read by AppId>` is, since this part, `N - k x`, where k is how many of those reads were the second
// read of a visit beginning. The text of a baseline cannot say which they were: the suites are run on the last commit's tree and on today's,
// test by test, and every test must send what it sent, except that a read of a session by its AppId may be gone (--order). That run gives k for
// each suite and session, and the translation is the old baseline with each entry lowered by it. A fresh recording must then
// equal the translation EXACTLY (--check). The baselines are never recorded again. The browsers' start-up never begins a visit from Welcome
// (the start-ups are a first staff visit to Welcome, two first QR scans and a reload): their baselines are not touched.
//
//   node scripts/schema-baseline/begin-baselines.js --order     every node suite on the last commit's tree and on today's, test by test (writes nothing)
//   node scripts/schema-baseline/begin-baselines.js --check     the same, then a fresh recording of every node suite against its translation
//   node scripts/schema-baseline/begin-baselines.js --write     ONLY after --check passed: the translation in place, with a line in the header of
//                                                               each file it changes. Refuses a file already translated.
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LISTS } from '../../migration/src/lib/schema/pms-schema.js';
import { BASELINE_DIR, NODE_SUITES, differences, explain, exportLastCommit, parse, recordSuite } from '../request-baseline.js';

export const BEGIN_NOTE = '# Amended in Phase 10j, part C: beginning a visit (dataService.js beginVisit) moves the session on with the version its check read, so the second read of the session by its AppId, which the general update made before that write, is gone, and the session is read side by side with AppSettings, so a press that AppSettings refuses reads it too (and its error is still AppSettings\'s): each entry of such a read is lower by the visits begun on a session that had not started, and higher by the presses refused, found by running the suite on the last commit\'s tree and on today\'s, test by test (scripts/schema-baseline/begin-baselines.js), and a fresh recording equalled the translation exactly; every test sends every other request as it did. Nothing else was changed.';

/** A read of one session by its AppId, as getItem() and spFind() send it: the address, or null for any other request. */
const sessionRead = (entry) => (new RegExp(`^GET (\\S+getbytitle\\('${LISTS.sessions.title}'\\)/items\\?\\$filter=AppId eq '[^']+'&\\$top=2&\\$select=\\S+)$`).test(entry) ? entry : null);

/**
 * Every node suite, on the last commit's tree and on today's, test by test (the recorder notes which test sent each request: --explain's way).
 * A test may send fewer reads of a session by its AppId and nothing else may differ, but for an entry whose count depends on timing. The order
 * is not held: the two reads that are now side by side may leave in either order, and a baseline has never held the order of requests.
 * Resolves to Map(suite -> Map(entry -> k)), k being how many of that read are gone, and the suites where anything else differs.
 */
async function compare() {
  const lastCommit = await exportLastCommit();
  const drops = new Map();
  const failures = [];
  try {
    for (const name of NODE_SUITES) {
      const baseline = parse(await readFile(path.join(BASELINE_DIR, `${name}.txt`), 'utf8'));
      const before = (await recordSuite(name, {}, { root: lastCommit, byTest: true })).tests;
      const now = (await recordSuite(name, {}, { byTest: true })).tests;
      const dropped = new Map();
      const other = [];
      const refused = [];
      let tests = 0;
      for (const { test, changes } of explain(before, now)) {
        let counted = false;
        for (const { entry, before: was, after: is } of changes) {
          if (baseline.get(entry)?.loose) continue;
          if (sessionRead(entry) && is < was) { dropped.set(entry, (dropped.get(entry) ?? 0) + was - is); counted = true; continue; }
          // (A press that AppSettings refuses reads the session too now, side by side, and drops what it read: listed as this kind, as asked during this phase.)
          if (sessionRead(entry) && is > was) { dropped.set(entry, (dropped.get(entry) ?? 0) + was - is); refused.push(`${test}: ${is - was} more: ${entry.slice(0, 160)}...`); counted = true; continue; }
          other.push(`${test}: ${was} x then, ${is} x now: ${entry.replaceAll('\n', ' + ').slice(0, 220)}`);
        }
        if (counted) tests += 1;
      }
      if (other.length) {
        failures.push(name);
        console.log(`${name}: ${other.length} other difference${other.length === 1 ? '' : 's'}`);
        for (const line of other) console.log(`  ${line}`);
        continue;
      }
      drops.set(name, dropped);
      const gone = [...dropped.values()].reduce((sum, count) => sum + count, 0) + refused.length;
      console.log(`${name}: every test sends what it sent at the last commit, but for ${gone} read${gone === 1 ? '' : 's'} of a session by its AppId that ${gone === 1 ? 'is' : 'are'} gone, in ${tests - refused.length} test${tests - refused.length === 1 ? '' : 's'}${refused.length ? `, and ${refused.length} more in ${refused.length} test${refused.length === 1 ? '' : 's'} where AppSettings refused the press:` : ''}`);
      for (const line of refused) console.log(`  + ${line}`);
    }
  } finally {
    await rm(lastCommit, { recursive: true, force: true });
  }
  console.log(`\n${failures.length ? `NOT the same in ${failures.join(', ')}` : 'every test of every node suite sends what it sent, but for the second read of a session as a visit begins'}`);
  return { drops, failures };
}

/** A baseline's text with each entry in `dropped` (entry -> k) lowered by k (and gone at 0). Throws if k is more than the count or it is loose. */
export function lowerText(text, dropped) {
  const left = new Map(dropped);
  const out = [];
  for (const line of text.split('\n')) {
    const entry = /^(~?)(\d+) x (.*)$/.exec(line);
    const k = entry ? left.get(entry[3]) : undefined;
    if (!entry || !k) { if (entry) left.delete(entry[3]); out.push(line); continue; }
    if (entry[1] === '~') throw new Error(`A loose entry cannot be lowered: ${line}`);
    const count = Number(entry[2]);
    if (k > count) throw new Error(`${k} of ${count} reads cannot be gone: ${line}`);
    if (count !== k) out.push(`${count - k} x ${entry[3]}`);
    left.delete(entry[3]);
  }
  // A read the baseline did not have at all (a press refused, in a test that sent no other such read): a new entry, where render() sorts it.
  for (const [entry, k] of left) {
    if (k > 0) throw new Error(`No baseline entry for ${entry}`);
    const at = out.findIndex((line) => { const start = /^~?\d+ x (.*)$/.exec(line); return start && start[1] > entry; });
    out.splice(at === -1 ? out.length : at, 0, `${-k} x ${entry}`);
  }
  return out.join('\n');
}

async function check(write) {
  const { drops, failures } = await compare();
  if (failures.length) { process.exitCode = 1; return; }
  let failed = false;
  const translations = new Map();
  for (const name of NODE_SUITES) {
    const dropped = drops.get(name);
    const text = await readFile(path.join(BASELINE_DIR, `${name}.txt`), 'utf8');
    const translated = dropped.size ? lowerText(text, dropped) : text;
    translations.set(name, { text, translated, dropped });
    const found = differences(parse(translated), await recordSuite(name));
    console.log(`${name}: ${found.length ? `${found.length} DIFFERENCE${found.length === 1 ? '' : 'S'} from the translation` : 'a fresh recording equals the translation'}${dropped.size ? '' : ' (nothing translated)'}`);
    for (const [entry, k] of dropped) console.log(`  ${k > 0 ? `${k} fewer` : `${-k} more`} x ${entry.slice(0, 160)}...`);
    for (const difference of found) console.log(`  ${difference.replaceAll('\n', '\n    ')}`);
    failed ||= found.length > 0;
  }
  console.log(`\n${failed ? 'NOT equal' : 'every fresh recording equals its translated baseline'}`);
  if (failed) { process.exitCode = 1; return; }
  if (!write) return;
  for (const [name, { text, translated, dropped }] of translations) {
    if (!dropped.size) continue;
    if (text.includes(BEGIN_NOTE)) throw new Error(`${name}.txt was translated already.`);
    const lines = translated.split('\n');
    await writeFile(path.join(BASELINE_DIR, `${name}.txt`), [...lines.filter((line) => line.startsWith('#')), BEGIN_NOTE, ...lines.filter((line) => !line.startsWith('#'))].join('\n'));
    console.log(`${name}.txt: ${dropped.size} entr${dropped.size === 1 ? 'y' : 'ies'} lowered`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.includes('--order')) process.exitCode = (await compare()).failures.length ? 1 : 0;
  else if (process.argv.includes('--check')) await check(false);
  else if (process.argv.includes('--write')) await check(true);
  else console.log('Use --order, --check or --write (see the top of the file).');
}
