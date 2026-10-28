// Prompt 21, Phase 1: the proof that schema version 5 changed what the data layer sends in exactly three ways, and nothing else. (1) PMSAppSettings
// gains FiscalYearStartMonth and MinSample, and every item read names its list's columns (pms-schema.js selectOf), so each read of the settings item
// names two columns more at the end of its `$select` (encoded too, in a mock's `__next` link). (2) A read of every list's columns (Today's check, and
// the self-test's) carries the three new lists as well, after the twelve, in one batch as before. (3) Requests that name one of the three new lists
// (PMSUsers, PMSRoleAssignments, PMSAuditLog: Setup making them, the self-test reading them, the named-reads walk reading a person's row and roles),
// requests that make or read back the settings' two new columns, and the read of the settings item's version alone that a page makes on a site of
// an older version (records.js olderItem) are new.
//
// So every request baseline is translated by (1) and (2). The suites are then run on pms-20's tree (21cef34, where this branch began: its commits
// carry version 5 already, so HEAD is not the "before") and on today's, request by request (--order): every request today must be the old one,
// translated, in the same place, except the new requests of (3), which today may add. Those are counted per suite and entry, and the translation of a
// baseline adds them. A fresh recording must then equal the translation EXACTLY (--check), by the same comparison as always (scripts/request-baseline.js
// differences()). The baselines are never recorded again. The browsers' start-up baselines are translated by (1) (--to <dir> writes them for the spec to
// prove: PMS_BASELINE_DIR=<dir>).
//
//   node scripts/schema-baseline/access-baselines.js --order        every node suite on 21cef34's tree and on today's (writes nothing)
//   node scripts/schema-baseline/access-baselines.js --check        the same run, then a fresh recording of every node suite against its translation
//   node scripts/schema-baseline/access-baselines.js --to <dir>     the browsers' start-up baselines, translated, into <dir> (their proof)
//   node scripts/schema-baseline/access-baselines.js --write        ONLY after --check passed: the translation in place, with a line in the header
//                                                                  of each file it changes. Refuses a file already translated.
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
/** Where this branch began: pms-20's tip, schema version 4. */
export const BEFORE = '21cef34';
export const ACCESS_NOTE = '# Amended in Prompt 21, Phase 1: schema version 5 adds PMSAppSettings.FiscalYearStartMonth and MinSample, so each read of the settings item names two columns more at the end of its `$select` (encoded too, in a mock\'s `__next` link); a read of every list\'s columns carries the three new lists (PMSUsers, PMSRoleAssignments, PMSAuditLog) after the twelve; and requests that name the three lists, make or read back the two settings, or read the settings item\'s version alone on an older site, are new; by scripts/schema-baseline/access-baselines.js, after the suites were run on 21cef34\'s tree and on today\'s, request by request (in the two Setup suites, whose lanes interleave, as many of each request, not in order), and a fresh recording equalled the translation exactly. Nothing else was changed.';

const SETTINGS = (() => {
  const now = selectOf('appsettings');
  const added = ',FiscalYearStartMonth,MinSample';
  if (!now.endsWith(added)) throw new Error(`appsettings: the two settings are not the last columns of ${now}`);
  return { title: LISTS.appsettings.title, before: now.slice(0, -added.length), now };
})();
const NEW_TITLES = ['users', 'roleassignments', 'auditlog'].map((key) => LISTS[key].title);
const LAST_OLD = LISTS.responses.title;

/** The suites where Setup makes columns in lanes side by side (test-provision, test-site-ready). */
const LANES = new Set(['test-provision', 'test-site-ready']);

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const encoded = (select) => select.replace('$select=', '%24select=').replaceAll(',', '%2C');

/** One line of a baseline (or a request), with each `$select` of the settings item as it is sent since Prompt 21. Anything else is left as it is. */
export function settingsLine(line) {
  if (!line.includes(`getbytitle('${SETTINGS.title}')`)) return line;
  let out = line;
  for (const [old, fresh] of [[SETTINGS.before, SETTINGS.now], [encoded(SETTINGS.before), encoded(SETTINGS.now)]]) {
    out = out.replace(new RegExp(`${escape(old)}(?=$|&|\\s)`, 'g'), fresh);
  }
  return out;
}

/**
 * One entry (a request, with the reads a batch carries on lines of its own), translated: (1) on every line, and (2) a batch that carries the
 * twelve lists' columns, ending with the answers list's, carries the three new lists' the same way after it.
 */
export function translateEntry(entry) {
  const lines = entry.split('\n').map(settingsLine);
  const last = lines.findLastIndex((line) => /^\s+carries /.test(line) && line.includes(`getbytitle('${LAST_OLD}')/fields`));
  const all = lines.filter((line) => /^\s+carries /.test(line) && /\/fields(\?|$)/.test(line)).length;
  if (last !== -1 && all === 12 && last === lines.length - 1) {
    const model = lines[last];
    lines.push(...NEW_TITLES.map((title) => model.replace(`getbytitle('${LAST_OLD}')`, `getbytitle('${title}')`)));
  }
  return lines.join('\n');
}
/** A whole baseline file, translated entry by entry (an entry's carried reads follow it on lines of their own). */
export function translateText(text) {
  const out = [];
  let block = [];
  const flush = () => { if (block.length) out.push(translateEntry(block.join('\n'))); block = []; };
  for (const line of text.split('\n')) {
    if (/^\s+carries /.test(line) && block.length) { block.push(line); continue; }
    flush();
    block = [line];
  }
  flush();
  return out.join('\n');
}

/** Is this request one of (3): new, naming a new list, making or reading back a new setting, or the settings' version alone? */
const isNew = (entry) => NEW_TITLES.some((title) => entry.split('\n')[0].includes(`getbytitle('${title}')`))
  || (entry.includes(`getbytitle('${SETTINGS.title}')/fields`) && (/FiscalYearStartMonth|MinSample/.test(entry) || /\/fields\/(createfieldasxml|getbyid\()/.test(entry)))
  || (entry.includes(`getbytitle('${SETTINGS.title}')/items?`) && /\$select=Id,AppId,SchemaVersion(?:&|$)/.test(entry))
  || (/\$batch/.test(entry.split('\n')[0]) && entry.split('\n').slice(1).every((line) => NEW_TITLES.some((title) => line.includes(`getbytitle('${title}')`))))
  // (Setup making a list: its address is the site's lists, its body names the list. Only the two Setup suites, compared by count, make lists.)
  || /^POST \S*\/_api\/web\/lists$/.test(entry);

/** pms-20's tree, in a temporary folder (with this checkout's node_modules). */
async function exportBefore() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pms-before-21-'));
  await promisify(exec)(`git archive --format=tar ${BEFORE} | tar -x -C "${dir}"`, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  await symlink(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  return dir;
}

/** Every node suite on pms-20's tree and on today's: Map(suite -> Map(entry -> how many today added)), and the suites where anything else differs. */
async function compare() {
  const before21 = await exportBefore();
  const added = new Map();
  const failures = [];
  try {
    for (const name of NODE_SUITES) {
      const loose = new Set([...parse(await readFile(path.join(BASELINE_DIR, `${name}.txt`), 'utf8'))].filter(([, { loose: timed }]) => timed).map(([entry]) => translateEntry(entry)));
      const before = (await sequence(name, before21)).map(translateEntry).filter((entry) => !loose.has(entry));
      const now = (await sequence(name, ROOT)).filter((entry) => !loose.has(entry));
      const extra = new Map();
      let [at, from] = [0, 0];
      let first = null;
      while (at < now.length || from < before.length) {
        if (now[at] === before[from]) { at += 1; from += 1; continue; }
        if (at < now.length && isNew(now[at])) { extra.set(now[at], (extra.get(now[at]) ?? 0) + 1); at += 1; continue; }
        first = { at, today: now[at], then: before[from] };
        break;
      }
      if (first && LANES.has(name)) {
        // Setup makes lists and columns three at a time, so three lists more move the others' requests in the interleaving: here the proof is the
        // number of each request, not their order. Every old request is sent as many times, and what is sent more is new.
        const tally = (entries) => entries.reduce((map, entry) => map.set(entry, (map.get(entry) ?? 0) + 1), new Map());
        const [then, today] = [tally(before), tally(now)];
        const fewer = [...then].filter(([entry, count]) => (today.get(entry) ?? 0) < count);
        const more = [...today].filter(([entry, count]) => count > (then.get(entry) ?? 0)).map(([entry, count]) => [entry, count - (then.get(entry) ?? 0)]);
        if (fewer.length === 0 && more.every(([entry]) => isNew(entry))) {
          added.set(name, new Map(more));
          console.log(`${name}: ${now.length} requests, each old one translated as many times (Setup's lanes interleave: not compared in order), and ${more.reduce((sum, [, count]) => sum + count, 0)} new`);
          continue;
        }
        console.log(`${name}: fewer: ${fewer.slice(0, 3).map(([entry]) => entry.replaceAll('\n', ' + ')).join(' | ')}; more not new: ${more.filter(([entry]) => !isNew(entry)).slice(0, 3).map(([entry]) => entry.replaceAll('\n', ' + ')).join(' | ')}`);
      }
      if (first) {
        failures.push(name);
        console.log(`${name}: first difference at request ${first.at + 1} of today's\n  ${BEFORE}, translated: ${first.then?.replaceAll('\n', ' + ')}\n  today:               ${first.today?.replaceAll('\n', ' + ')}`);
        continue;
      }
      added.set(name, extra);
      const count = [...extra.values()].reduce((sum, each) => sum + each, 0);
      console.log(`${name}: ${now.length} requests, ${BEFORE}'s translated in the same order${count ? `, and ${count} new` : ''}`);
    }
  } finally {
    await rm(before21, { recursive: true, force: true });
  }
  console.log(`\n${failures.length ? `NOT the same in ${failures.join(', ')}` : 'the same requests, in the same number and order, but for the three changes'}`);
  return { added, failures };
}

/** A baseline translated, with today's additions as entries of their own (or added to an entry the translation already has). */
function translate(text, extra = new Map()) {
  const lines = translateText(text).split('\n');
  const body = new Map(extra);
  const out = [];
  for (const line of lines) {
    const found = /^(\d+) x (.*)$/.exec(line);
    const entry = found && [...body.keys()].find((each) => each.split('\n')[0] === found[2] && !each.includes('\n'));
    if (entry) { out.push(`${Number(found[1]) + body.get(entry)} x ${found[2]}`); body.delete(entry); continue; }
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

async function put(translations) {
  for (const [name, { text, translated }] of translations) {
    if (translated === text) continue;
    if (text.includes(ACCESS_NOTE)) throw new Error(`${name}.txt was translated already.`);
    const lines = translated.split('\n');
    await writeFile(path.join(BASELINE_DIR, `${name}.txt`), [...lines.filter((line) => line.startsWith('#')), ACCESS_NOTE, ...lines.filter((line) => !line.startsWith('#'))].join('\n'));
    console.log(`${name}.txt translated`);
  }
}

/** The browsers' start-up baselines: no Setup there, so the settings' `$select` alone. */
async function browsers(dir, write) {
  const files = (await readdir(BASELINE_DIR)).filter((file) => /^browser-participant-start\..+\.txt$/.test(file));
  if (dir) await mkdir(dir, { recursive: true });
  for (const file of files) {
    const text = await readFile(path.join(BASELINE_DIR, file), 'utf8');
    const translated = translateText(text);
    if (write) {
      if (text.includes(ACCESS_NOTE)) throw new Error(`${file} was translated already.`);
      if (translated === text) continue;
      const lines = translated.split('\n');
      await writeFile(path.join(BASELINE_DIR, file), [...lines.filter((line) => line.startsWith('#')), ACCESS_NOTE, ...lines.filter((line) => !line.startsWith('#'))].join('\n'));
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
