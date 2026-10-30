// Prompt 21, Phase 3: the proof that schema version 6 changed what the data layer sends in exactly two ways. PMSClientSessions gains a session's
// title (SharePoint's own Title column), StartTime, Sequence, Period and PlannedDate, and every item read names its list's columns (pms-schema.js
// selectOf), so each read of the sessions names five columns more at the end of its `$select` (and a mock's `__next` link of such a read carries them
// too, encoded). And Setup, on a site it builds or completes, makes the four that are not SharePoint's own: their own requests (a create and its
// read-back), in the order Setup makes columns. Nothing else moves: the new calls (planSession, startSession) are in no recorded suite.
//
// So every request baseline is translated: each `$select` of the sessions gains its five columns. The suites are then run on this branch's start
// (43a98d4, the tip of pms-21-2, schema version 5: its commits carry version 6 already, so HEAD is not the "before") and on today's tree, request by
// request (--order): every request today must be the start's, translated, in the same place, except requests that make or read back one of the four
// new columns, which today may add. Those are counted per suite and entry, and the translation of a baseline adds them. A fresh recording must then
// equal the translation EXACTLY (--check), by the same comparison as always (scripts/request-baseline.js differences()). The baselines are never
// recorded again. The browsers' start-up baselines are translated by the same rule (--to <dir> writes them for the spec to prove: PMS_BASELINE_DIR=<dir>).
//
//   node scripts/schema-baseline/sessions-baselines.js --order        every node suite on 43a98d4's tree and on today's (writes nothing)
//   node scripts/schema-baseline/sessions-baselines.js --check        the same run, then a fresh recording of every node suite against its translation
//   node scripts/schema-baseline/sessions-baselines.js --to <dir>     the browsers' start-up baselines, translated, into <dir> (their proof)
//   node scripts/schema-baseline/sessions-baselines.js --write        ONLY after --check passed: the translation in place, with a line in the header
//                                                                    of each file it changes. Refuses a file already translated.
import { exec } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { LISTS, selectOf } from '../../migration/src/lib/schema/pms-schema.js';
import { BASELINE_DIR, NODE_SUITES, differences, parse, recordSuite } from '../request-baseline.js';
import { sequence } from './select-baselines.js';

const ROOT = path.join(import.meta.dirname, '..', '..');
/** Where this branch began: pms-21-2's tip, schema version 5. */
export const BEFORE = '43a98d4';
export const SESSIONS_NOTE = '# Amended in Prompt 21, Phase 3: schema version 6 adds a session\'s Title (SharePoint\'s own column), StartTime, Sequence, Period and PlannedDate, so each read of PMSClientSessions names five columns more at the end of its `$select` (encoded too, in a mock\'s `__next` link), and Setup, where it makes columns, makes and reads back the four that are not SharePoint\'s own; by scripts/schema-baseline/sessions-baselines.js, after the suites were run on 43a98d4\'s tree and on today\'s, request by request (in the two Setup suites, whose lanes interleave, as many of each request, not in order), and a fresh recording equalled the translation exactly. Nothing else was changed.';

const ADDED = ['Title', 'StartTime', 'Sequence', 'Period', 'PlannedDate'];
/** The list, the columns it gained (those Setup makes: not SharePoint's own Title), and its `$select` before and since. */
const GAINED = [['sessions', ADDED]].map(([key, columns]) => {
  const now = selectOf(key);
  const tail = `,${columns.join(',')}`;
  if (!now.endsWith(tail)) throw new Error(`${key}: ${columns.join(', ')} are not the last columns of ${now}`);
  return { key, title: LISTS[key].title, made: columns.filter((column) => column !== 'Title'), before: now.slice(0, -tail.length), now };
});

/** The suites where Setup makes columns in lanes side by side (test-provision, test-site-ready). */
const LANES = new Set(['test-provision', 'test-site-ready']);

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const encoded = (select) => select.replace('$select=', '%24select=').replaceAll(',', '%2C');

/** This branch's start, exported to a folder of its own (with this checkout's node_modules: a junction on Windows). */
async function exportBefore() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pms-before-21c-'));
  await promisify(exec)(`git archive --format=tar ${BEFORE} | tar -x -C "${dir}"`, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  await symlink(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  return dir;
}

/** One line of a baseline (or a request), with each `$select` of the sessions as it is sent since Prompt 21, Phase 3. Anything else is left as it is. */
export function sessionsLine(line) {
  let out = line;
  for (const { title, before, now } of GAINED) {
    if (!out.includes(`getbytitle('${title}')`)) continue;
    for (const [old, fresh] of [[before, now], [encoded(before), encoded(now)]]) {
      out = out.replace(new RegExp(`${escape(old)}(?=$|&|\\s)`, 'g'), fresh);
    }
  }
  return out;
}
export const sessionsText = (text) => text.split('\n').map(sessionsLine).join('\n');
const sessionsRequest = (entry) => entry.split('\n').map(sessionsLine).join('\n');

/** Is this request one Setup sends to make or read back a column of the sessions (a create's address names no column)? */
const makesNewColumn = (entry) => GAINED.some(({ title, made }) => entry.includes(`getbytitle('${title}')/fields`)
  && (made.some((column) => entry.includes(column)) || /\/fields\/(createfieldasxml|getbyid\()/.test(entry)));

/**
 * Every node suite on this branch's start and on today's tree. Resolves to Map(suite -> Map(entry -> how many today added)) and the suites where
 * anything else differs (each with its first difference printed).
 */
async function compare() {
  const start = await exportBefore();
  const added = new Map();
  const failures = [];
  try {
    for (const name of NODE_SUITES) {
      const loose = new Set([...parse(await readFile(path.join(BASELINE_DIR, `${name}.txt`), 'utf8'))].filter(([, { loose: timed }]) => timed).map(([entry]) => sessionsLine(entry)));
      const before = (await sequence(name, start)).map(sessionsRequest).filter((entry) => !loose.has(entry));
      const now = (await sequence(name, ROOT)).filter((entry) => !loose.has(entry));
      const extra = new Map();
      let [at, from] = [0, 0];
      let first = null;
      while (at < now.length || from < before.length) {
        if (now[at] === before[from]) { at += 1; from += 1; continue; }
        if (at < now.length && makesNewColumn(now[at])) { extra.set(now[at], (extra.get(now[at]) ?? 0) + 1); at += 1; continue; }
        first = { at, today: now[at], then: before[from] };
        break;
      }
      if (first && LANES.has(name)) {
        // Setup makes columns three lists at a time, so a column more on one list moves the others' requests in the interleaving: here the
        // proof is the number of each request, not their order. Every request of the start's is sent as many times, and what is sent more is a
        // request that makes or reads back a column of the sessions.
        const tally = (entries) => entries.reduce((map, entry) => map.set(entry, (map.get(entry) ?? 0) + 1), new Map());
        const [then, today] = [tally(before), tally(now)];
        const fewer = [...then].filter(([entry, count]) => (today.get(entry) ?? 0) < count);
        const more = [...today].filter(([entry, count]) => count > (then.get(entry) ?? 0)).map(([entry, count]) => [entry, count - (then.get(entry) ?? 0)]);
        if (fewer.length === 0 && more.every(([entry]) => makesNewColumn(entry))) {
          added.set(name, new Map(more));
          console.log(`${name}: ${now.length} requests, each of ${BEFORE}'s translated as many times (Setup's lanes interleave: not compared in order), and ${more.reduce((sum, [, count]) => sum + count, 0)} that make or read back the four new columns`);
          continue;
        }
      }
      if (first) {
        failures.push(name);
        console.log(`${name}: first difference at request ${first.at + 1} of today's\n  ${BEFORE}, translated: ${first.then?.replaceAll('\n', ' + ')}\n  today:               ${first.today?.replaceAll('\n', ' + ')}`);
        continue;
      }
      added.set(name, extra);
      const count = [...extra.values()].reduce((sum, each) => sum + each, 0);
      console.log(`${name}: ${now.length} requests, ${BEFORE}'s translated in the same order${count ? `, and ${count} that make or read back the four new columns` : ''}`);
    }
  } finally {
    await rm(start, { recursive: true, force: true });
  }
  console.log(`\n${failures.length ? `NOT the same in ${failures.join(', ')}` : 'the same requests, in the same number and order, but for the four columns'}`);
  return { added, failures };
}

/** A baseline translated, with today's additions as entries of their own (or added to an entry today's translation already has). */
function translate(text, extra = new Map()) {
  const lines = sessionsText(text).split('\n');
  const body = new Map(extra);
  const out = [];
  for (const line of lines) {
    const found = /^(\d+) x (.*)$/.exec(line);
    if (found && body.has(found[2])) { out.push(`${Number(found[1]) + body.get(found[2])} x ${found[2]}`); body.delete(found[2]); continue; }
    out.push(line);
  }
  // (A new entry is a request with its carried reads on lines of their own, as render() writes them.)
  for (const [entry, count] of body) out.push(`${count} x ${entry.split('\n')[0]}`, ...entry.split('\n').slice(1));
  return out.join('\n');
}

async function check(write) {
  const { added, failures } = await compare();
  if (failures.length) { process.exitCode = 1; return; }
  let failed = false;
  const translations = new Map();
  for (const name of NODE_SUITES) {
    const text = await readFile(path.join(BASELINE_DIR, `${name}.txt`), 'utf8');
    const translated = translate(text, added.get(name));
    translations.set(name, { text, translated });
    const found = differences(parse(translated), await recordSuite(name));
    console.log(`${name}: ${found.length ? `${found.length} DIFFERENCE${found.length === 1 ? '' : 'S'} from the translation` : 'a fresh recording equals the translation'}${translated === text ? ' (nothing translated)' : ''}`);
    for (const difference of found) console.log(`  ${difference.replaceAll('\n', '\n    ')}`);
    failed ||= found.length > 0;
  }
  console.log(`\n${failed ? 'NOT equal' : 'every fresh recording equals its translated baseline'}`);
  if (failed) { process.exitCode = 1; return; }
  if (write) await put(translations);
}

const noted = (translated) => {
  const lines = translated.split('\n');
  return [...lines.filter((line) => line.startsWith('#')), SESSIONS_NOTE, ...lines.filter((line) => !line.startsWith('#'))].join('\n');
};

async function put(translations) {
  for (const [name, { text, translated }] of translations) {
    if (translated === text) continue;
    if (text.includes(SESSIONS_NOTE)) throw new Error(`${name}.txt was translated already.`);
    await writeFile(path.join(BASELINE_DIR, `${name}.txt`), noted(translated));
    console.log(`${name}.txt translated`);
  }
}

/** The browsers' start-up baselines: no Setup there, so the `$select` alone. */
async function browsers(dir, write) {
  const files = (await readdir(BASELINE_DIR)).filter((file) => /^browser-participant-start\..+\.txt$/.test(file));
  if (dir) await mkdir(dir, { recursive: true });
  for (const file of files) {
    const text = await readFile(path.join(BASELINE_DIR, file), 'utf8');
    const translated = sessionsText(text);
    if (write) {
      if (text.includes(SESSIONS_NOTE)) throw new Error(`${file} was translated already.`);
      if (translated === text) continue;
      await writeFile(path.join(BASELINE_DIR, file), noted(translated));
      console.log(`${file} translated`);
    } else {
      await writeFile(path.join(dir, file), translated);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const to = process.argv.indexOf('--to');
  if (process.argv.includes('--order')) process.exitCode = (await compare()).failures.length ? 1 : 0;
  else if (process.argv.includes('--check')) await check(false);
  else if (to !== -1) await browsers(path.resolve(process.argv[to + 1]), false);
  else if (process.argv.includes('--write')) { await check(true); if (!process.exitCode) await browsers(null, true); }
  else console.log('Use --order, --check, --to <dir> or --write (see the top of the file).');
}
