// Prompt 26: the proof that what the data layer sends moved only as the prompt's parts say. The baselines are never recorded again: each is translated
// by the rules below, and a fresh recording must then equal the translation exactly (--check), by the same comparison as always
// (scripts/request-baseline.js differences()). What a rule does not explain stays a difference, and --write refuses.
//
//   node scripts/schema-baseline/format-baselines.js --check          every node suite, fresh, against its translation (writes nothing)
//   node scripts/schema-baseline/format-baselines.js --write          ONLY when --check passes: the translation in place, with a line in the header of each file it changes
//   node scripts/schema-baseline/format-baselines.js --write --browsers   the browsers' start-up baselines too (their proof is request-baseline.spec.ts)
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASELINE_DIR, NODE_SUITES, differences, parse, recordSuite } from '../request-baseline.js';

/** Each rule: [the header line it adds, the test of a request or a carried read it removes, or a map of one line]. */
export const RULES = [
  {
    note: "# Amended in Prompt 26, Part 2: a write body names no item type (odata=nometadata), so no request asks for a list's ListItemEntityTypeFullName, alone or carried in a batch (scripts/schema-baseline/format-baselines.js).",
    drop: (line) => /\?\$select=ListItemEntityTypeFullName$/.test(line),
  },
];

/** A parsed baseline, translated: an entry whose request is dropped goes, a carried read that is dropped goes from its batch, and entries that become the same add up. */
export function translated(baseline) {
  const out = new Map();
  for (const [entry, { count, loose }] of baseline) {
    const [head, ...raw] = entry.split('\n');
    // (The self-test's second read in a batch asks for the list's title since then, not its item type.)
    const carried = raw.some((line) => line.includes('selftest-')) ? raw.map((line) => line.replace('?$select=ListItemEntityTypeFullName', '?$select=Title')) : raw;
    if (RULES.some(({ drop }) => drop?.(head))) continue;
    const kept = carried.filter((line) => !RULES.some(({ drop }) => drop?.(line.trim().replace(/^carries /, ''))));
    const mapped = [head, ...kept].map((line) => RULES.reduce((text, { map }) => (map ? map(text) : text), line));
    const name = mapped.join('\n');
    const held = out.get(name);
    out.set(name, { count: count + (held?.count ?? 0), loose: loose || Boolean(held?.loose) });
  }
  return out;
}

const textOf = (original, baseline) => {
  const headers = original.split('\n').filter((line) => line.startsWith('#'));
  const notes = RULES.map(({ note }) => note).filter((note) => !headers.includes(note));
  const lines = [...baseline].sort(([a], [b]) => (a.replace(/^\S+ /, '') < b.replace(/^\S+ /, '') ? -1 : 1))
    .map(([entry, { count, loose }]) => `${loose ? '~' : ''}${count} x ${entry}`);
  return [...headers, ...notes, ...lines, ''].join('\n');
};

async function run(write) {
  let bad = 0;
  for (const name of NODE_SUITES) {
    const file = path.join(BASELINE_DIR, `${name}.txt`);
    const original = await readFile(file, 'utf8');
    const baseline = translated(parse(original));
    const found = differences(baseline, await recordSuite(name));
    if (found.length) {
      bad += 1;
      console.log(`${name}: ${found.length} difference(s) a rule does not explain`);
      for (const line of found.slice(0, Number(process.env.PMS_SHOW ?? 12))) console.log(`  ${line.split('\n').slice(0, 3).join('\n    ').slice(0, 300)}`);
    } else {
      console.log(`${name}: equals its translation`);
      if (write) await writeFile(file, textOf(original, baseline));
    }
  }
  if (bad) process.exitCode = 1;
  if (write && process.argv.includes('--browsers')) {
    for (const file of (await readdir(BASELINE_DIR)).filter((each) => /^browser-participant-start\..+\.txt$/.test(each))) {
      const original = await readFile(path.join(BASELINE_DIR, file), 'utf8');
      await writeFile(path.join(BASELINE_DIR, file), textOf(original, translated(parse(original))));
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.includes('--check')) await run(false);
  else if (process.argv.includes('--write')) await run(true);
  else console.log('Use --check or --write (see the top of the file).');
}
