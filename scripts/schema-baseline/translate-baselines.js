// Phase 10c-2b, part D: the proof that the new list names and schema v2 changed what the data layer sends in exactly one way, the
// names. Every request baseline (scripts/request-baseline/*.txt, recorded before Phase 10b and amended since only for tests that were
// removed or changed on purpose) is translated: each list's old title to its new one, the picture library's to its new one, and each
// column that was renamed (Order) to its new name. A fresh recording after part D must then equal the translation EXACTLY, by the same
// comparison as always (scripts/request-baseline.js differences()), in every node suite and in the three browsers' start-up.
//
//   node scripts/schema-baseline/translate-baselines.js --check       record every node suite afresh and compare it with its translated
//                                                                    baseline (writes nothing); says how many entries the translation moved
//   node scripts/schema-baseline/translate-baselines.js --to <dir>    write every baseline, translated, into <dir>: the browsers' proof is
//                                                                    PMS_BASELINE_DIR=<dir> npx playwright test ... request-baseline
//   node scripts/schema-baseline/translate-baselines.js --write       ONLY after both proofs passed: put the translation in place, with a
//                                                                    line in each file's header that says so. Refuses a file already translated.
//
// What is translated comes from the snapshot of the old schema (scripts/schema-baseline/schema-before-10c2b.json) and the schema file
// (migration/src/lib/schema/pms-schema.js), never from a table of its own: an old title, a library or a column the two do not name cannot be mapped.
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIBRARY, LISTS } from '../../migration/src/lib/schema/pms-schema.js';
import { BASELINE_DIR, NODE_SUITES, differences, parse, recordSuite } from '../request-baseline.js';
import { readSnapshot } from '../schema-snapshot.js';

export const TRANSLATED_NOTE = '# Translated in Phase 10c-2b from the 10c-2a recording above: each old list title to its PMS name, ClientLogos to PMSClientImages, Order to SortOrder (scripts/schema-baseline/translate-baselines.js), after a fresh recording of the new names equalled the translation exactly. Nothing else was changed.';

/** { titles: Map(old -> new), library: [old, new], columns: Map(old -> new) } from the snapshot and the schema file. */
export async function mapping() {
  const { schema } = await readSnapshot();
  const titles = new Map(Object.entries(schema.lists).map(([key, list]) => [list.title, LISTS[key].title]));
  const columns = new Map();
  for (const [key, list] of Object.entries(schema.lists)) {
    for (const column of list.columns) {
      const now = column.field && LISTS[key].fields[column.field]?.column;
      if (now && now !== column.column) {
        if (columns.has(column.column) && columns.get(column.column) !== now) throw new Error(`${column.column} became two names: ${columns.get(column.column)} and ${now}.`);
        columns.set(column.column, now);
      }
    }
  }
  return { titles, library: [schema.library, LIBRARY], columns };
}

/** Titles a baseline names that are no list of the old schema, left as they are. */
export const LEFT = new Set();

/** One line of a baseline (an entry, or a read a batch carried) with the old names put into the new. A header line is left as it is. */
export function translateLine(line, { titles, library, columns }) {
  if (line.startsWith('#')) return line;
  let out = line.replace(/getbytitle\('([^']+)'\)/g, (whole, title) => {
    if (title === library[0]) return `getbytitle('${library[1]}')`;
    // (A title that is no list of the old schema is a test's own on purpose, such as a library named in the settings that the site
    // lacks: it is left as it is, and said, in LEFT.)
    if (!titles.has(title)) { LEFT.add(decodeURIComponent(title)); return whole; }
    return `getbytitle('${titles.get(title)}')`;
  });
  // The library's folder, wherever an address names it (a file's path, the folder an upload goes to), between separators that may be
  // encoded (`/sites/cec/ClientLogos/x.png` or `%2Fsites%2Fcec%2FClientLogos%2Fx.png`).
  out = out.replace(new RegExp(`(?<=/|%2F)${library[0]}(?=/|%2F|'|$)`, 'gi'), library[1]);
  // A renamed column, in the query of an address ($filter, $select): as a whole word after the `?`.
  const query = out.indexOf('?');
  if (query !== -1 && columns.size) {
    out = out.slice(0, query) + out.slice(query).replace(new RegExp(`\\b(${[...columns.keys()].join('|')})\\b`, 'g'), (name) => columns.get(name));
  }
  return out;
}

export const translate = (text, map) => text.split('\n').map((line) => translateLine(line, map)).join('\n');

/** Every baseline file's name (without .txt). */
const baselineNames = async () => (await readdir(BASELINE_DIR)).filter((file) => file.endsWith('.txt')).map((file) => file.slice(0, -4)).sort();

async function check() {
  const map = await mapping();
  let entries = 0;
  let moved = 0;
  let failed = false;
  for (const name of NODE_SUITES) {
    const text = await readFile(path.join(BASELINE_DIR, `${name}.txt`), 'utf8');
    const old = parse(text);
    const translated = parse(translate(text, map));
    const changed = [...old.keys()].filter((entry) => !translated.has(entry)).length;
    entries += old.size;
    moved += changed;
    const found = differences(translated, await recordSuite(name));
    console.log(`${name}: ${found.length ? `${found.length} DIFFERENCE${found.length === 1 ? '' : 'S'} from the translation` : 'equals the translation'} (${old.size} entries, ${changed} translated)`);
    for (const difference of found) console.log(`  ${difference.replaceAll('\n', '\n    ')}`);
    failed ||= found.length > 0;
  }
  console.log(`\nnode suites: ${entries} entries, ${moved} of them translated; ${failed ? 'NOT equal' : 'every fresh recording equals its translated baseline'}`);
  if (LEFT.size) console.log(`left as they were (a test's own titles, no list of the schema): ${[...LEFT].join(', ')}`);
  process.exitCode = failed ? 1 : 0;
}

async function writeTo(dir) {
  const map = await mapping();
  await mkdir(dir, { recursive: true });
  let moved = 0;
  for (const name of await baselineNames()) {
    const text = await readFile(path.join(BASELINE_DIR, `${name}.txt`), 'utf8');
    const translated = translate(text, map);
    const old = parse(text);
    const now = parse(translated);
    moved += [...old.keys()].filter((entry) => !now.has(entry)).length;
    await writeFile(path.join(dir, `${name}.txt`), translated);
  }
  console.log(`Wrote ${(await baselineNames()).length} translated baselines to ${dir} (${moved} entries translated in all).`);
}

async function writeInPlace() {
  const map = await mapping();
  for (const name of await baselineNames()) {
    const file = path.join(BASELINE_DIR, `${name}.txt`);
    const text = await readFile(file, 'utf8');
    if (text.includes(TRANSLATED_NOTE)) throw new Error(`${name}.txt was translated already.`);
    const lines = translate(text, map).split('\n');
    const header = lines.filter((line) => line.startsWith('#'));
    const body = lines.filter((line) => !line.startsWith('#'));
    await writeFile(file, [...header, TRANSLATED_NOTE, ...body].join('\n'));
    console.log(`${name}.txt: translated in place`);
  }
}

// ---- Part E: the browsers' start-up, after the mock began with the AppSettings item ----------------------------------------------------
// Until part E the browser spec's set-up (seeding, then Go live) CREATED the AppSettings item, which took id 78 of the mock's sequence; since
// part E a site starts with that item, as Setup will make it, under an id of its own, so every item made after it has an id one lower. That
// is the only change in what the participant page sends. `--e-shift --to <dir>` writes the three browser baselines with items(N) for N > 78
// as items(N - 1); the proof is that request-baseline.spec.ts, pointed at <dir>, finds no difference in any engine. `--e-shift --write`
// then puts them in place, with a header line.
export const E_SHIFTED_FROM = 78;
export const E_SHIFT_NOTE = `# Amended in Phase 10c-2b, part E: every item id above ${E_SHIFTED_FROM} one lower, because a site now starts with the AppSettings item (it used to be created during the set-up, as id ${E_SHIFTED_FROM}); a fresh recording equalled that exactly in Chromium, WebKit and Firefox. Nothing else was changed (scripts/schema-baseline/translate-baselines.js --e-shift).`;
export const shiftIds = (text) => text.split('\n').map((line) => (line.startsWith('#') ? line : line.replace(/items\((\d+)\)/g, (whole, id) => (Number(id) > E_SHIFTED_FROM ? `items(${Number(id) - 1})` : whole)))).join('\n');
const BROWSERS = ['chromium', 'webkit', 'firefox'].map((engine) => `browser-participant-start.${engine}`);

async function eShift(to) {
  for (const name of BROWSERS) {
    const file = path.join(BASELINE_DIR, `${name}.txt`);
    const text = await readFile(file, 'utf8');
    if (text.includes(E_SHIFT_NOTE)) throw new Error(`${name}.txt was shifted already.`);
    const lines = shiftIds(text).split('\n');
    const out = to ? shiftIds(text) : [...lines.filter((line) => line.startsWith('#')), E_SHIFT_NOTE, ...lines.filter((line) => !line.startsWith('#'))].join('\n');
    await writeFile(to ? path.join(to, `${name}.txt`) : file, out);
    console.log(`${name}.txt: ${to ? `shifted into ${to}` : 'shifted in place'}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && process.argv.includes('--e-shift')) {
  const to = process.argv.includes('--to') ? path.resolve(process.argv[process.argv.indexOf('--to') + 1]) : null;
  if (to) await mkdir(to, { recursive: true });
  if (!to && !process.argv.includes('--write')) throw new Error('--e-shift needs --to <dir> (the proof) or --write (after it).');
  await eShift(to);
} else if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.includes('--check')) await check();
  else if (process.argv.includes('--to')) await writeTo(path.resolve(process.argv[process.argv.indexOf('--to') + 1]));
  else if (process.argv.includes('--write')) await writeInPlace();
  else console.log('Use --check, --to <dir> or --write (see the top of the file).');
}
