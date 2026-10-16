// The request baseline (Phase 10b): every SharePoint REST request the mocked suites send, as it was BEFORE the list namespace and the
// settings file were added, and the comparison of a fresh recording with it.
//
//   node scripts/request-baseline.js            compare a fresh recording of every node suite with scripts/request-baseline/*.txt
//   node scripts/request-baseline.js --write    record a suite that has no baseline yet (it never writes over one)
//   node scripts/request-baseline.js --amend <suite> --tests '<pattern>'
//                                               take the requests of tests that were REMOVED out of a baseline, or replace those of
//                                               tests that were CHANGED on purpose; see amendment() below for what it insists on
//   node scripts/request-baseline.js --amend <suite> --tests '<pattern>' --code
//                                               the same, for a change in the CODE, or in a HELPER the suite imports, that is meant to
//                                               change what the named tests send (Phase 10c-2a): the "before" is then the last commit's
//                                               whole tree, not only its suite
//   node scripts/request-baseline.js --explain <suite>
//                                               read-only: which test each difference between the last commit and today belongs to
//
// The point of it: with an empty list prefix, the data layer must send character for character the requests it sent before. So the
// files in scripts/request-baseline/ were recorded at the commit named in RECORDED_AT and are NOT regenerated to make a comparison
// pass: a difference is a finding, to be explained. scripts/test-request-baseline.js runs the comparison as part of `npm test`, and
// scripts/migration-tests/request-baseline.spec.ts does the same for the participant page's start-up in a real browser.
//
// What a baseline holds: one entry for each distinct request, with how many times it was sent. A request is its method and its
// address without the host, exactly as the data layer wrote it; a `$batch` and the reads it carried are one entry. Two things are
// written as placeholders because they differ on every run: a UUID (<uuid>) and an instant (<time>). The ORDER of requests is not
// compared. A count marked `~` is one that depends on timing (a poll that fits one more look into the same test on a faster run):
// such an entry may be sent any number of times, or not at all; an address that is not in the baseline always fails.
import { exec, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ROOT = path.join(import.meta.dirname, '..');
// (PMS_BASELINE_DIR points every comparison at another folder of baselines: Phase 10c-2b's translation proof, scripts/schema-baseline/translate-baselines.js.)
export const BASELINE_DIR = process.env.PMS_BASELINE_DIR ? path.resolve(process.env.PMS_BASELINE_DIR) : path.join(import.meta.dirname, 'request-baseline');
export const RECORDED_AT = '2ad1520 (the local tag legacy-final), before Phase 10b changed anything';
/**
 * A suite that did not exist at RECORDED_AT says when it was recorded, in its own header. It is recorded with `--write` once green and pins
 * what the code under test sends from then on; no baseline of the other suites was touched to add it.
 */
export const RECORDED_LATER = Object.freeze({
  'test-provision': 'the end of Phase 10c-3 part C (Setup plans and makes the lists), when the suite was first recorded',
  'test-site-ready': 'the end of Phase 10c-3 part D (the site is marked ready only when the check is clean), when the suite was first recorded',
  'test-setup-admins': 'the end of Phase 10c-3 part E (Add an admin; the import brings no admins), when the suite was first recorded',
  'test-text-limits': 'the end of Phase 10c-3 part F (inputs respect the lists\' text limits), when the suite was first recorded',
  'test-sample-pictures': 'the end of Phase 10f part B (the sample clients get VJR\'s pictures), when the suite was first recorded',
  'test-named-reads': 'the end of Phase 10h part A (every item read names its columns), when the suite was first recorded',
});

/**
 * The node suites that are recorded: every one that drives the data layer against a mocked SharePoint. test-sharepoint.js is the legacy
 * functions on its own stubs; the rest use scripts/sharepoint-fake.js. scripts/test-oracle.js is left out: its reads are the same
 * shapes as the live-display, names and report suites, for a thousand generated ids (150 kB of baseline for no new address).
 */
export const NODE_SUITES = [
  'test-sharepoint', 'test-participant-storage', 'test-admin-today', 'test-admin-content', 'test-brand-storage', 'test-live-display',
  'test-participant-names', 'test-leader-report-pdf', 'test-seeds', 'test-review-9a', 'test-provision', 'test-site-ready', 'test-setup-admins', 'test-text-limits',
  'test-sample-pictures', 'test-named-reads',
];

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}(?::|%3A)\d{2}(?::|%3A)\d{2}(?:\.\d+)?Z/g;
const CARRIED = '    carries ';

/** A recording with the two things that differ on every run written as placeholders. */
export const normalise = (text) => text.replace(UUID, '<uuid>').replace(INSTANT, '<time>');

/**
 * The lines of a recording (scripts/request-recorder.js writes them) as Map(entry -> times sent). A `$batch` line and the indented
 * lines of the reads it carried are one entry.
 * @param {string} text
 * @returns {Map<string, number>}
 */
export function tally(text) {
  const entries = [];
  for (const line of normalise(text).split('\n')) {
    if (!line.trim()) continue;
    if (line.startsWith(CARRIED) && entries.length) entries[entries.length - 1] += `\n${line}`;
    else entries.push(line);
  }
  const counts = new Map();
  for (const entry of entries) counts.set(entry, (counts.get(entry) ?? 0) + 1);
  return counts;
}

/** One request of the fake's own log (scripts/sharepoint-fake.js) as recorder lines: how the browser spec feeds `tally`. */
export function linesOf(entry) {
  const address = (url) => String(url).replace(/^https?:\/\/[^/]+/, '');
  return [`${entry.method} ${address(entry.url)}`, ...(entry.parts ?? []).map((part) => `${CARRIED}${part.method} ${address(part.url)}`)].join('\n');
}

/**
 * Several recordings of the same thing as one baseline: Map(entry -> { count, loose }). A count that is not the same in every
 * recording (an entry missing from one counts as 0) is `loose`.
 * @param {Map<string, number>[]} recordings
 */
export function combine(recordings) {
  const baseline = new Map();
  for (const entry of new Set(recordings.flatMap((recording) => [...recording.keys()]))) {
    const counts = recordings.map((recording) => recording.get(entry) ?? 0);
    baseline.set(entry, { count: Math.max(...counts), loose: new Set(counts).size > 1 });
  }
  return baseline;
}

const byText = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);

/** A baseline as the text of its file. */
export function render(what, baseline, recordedAt = RECORDED_AT) {
  return [
    `# Request baseline: ${what}.`,
    `# Recorded at ${recordedAt}.`,
    '# Do not regenerate this file to make a comparison pass: a difference is a finding. See scripts/request-baseline.js.',
    '# One entry for each distinct request and how many times it was sent ("~": the count depends on timing). <uuid> and <time> are placeholders.',
    ...[...baseline].sort(byText).map(([entry, { count, loose }]) => `${loose ? '~' : ''}${count} x ${entry}`),
    '',
  ].join('\n');
}

/** The text of a baseline file as Map(entry -> { count, loose }). */
export function parse(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const start = /^(~?)(\d+) x (.*)$/.exec(line);
    if (start) entries.push({ entry: start[3], count: Number(start[2]), loose: start[1] === '~' });
    else if (line.startsWith(CARRIED) && entries.length) entries[entries.length - 1].entry += `\n${line}`;
    else throw new Error(`A baseline line is neither an entry nor a carried read: ${line}`);
  }
  return new Map(entries.map(({ entry, count, loose }) => [entry, { count, loose }]));
}

/**
 * Every way a fresh recording differs from its baseline, in words; empty when it does not.
 * @param {Map<string, { count: number, loose: boolean }>} baseline
 * @param {Map<string, number>} recording
 * @returns {string[]}
 */
export function differences(baseline, recording) {
  const found = [];
  for (const [entry, { count, loose }] of baseline) {
    const now = recording.get(entry) ?? 0;
    if (loose || now === count) continue;
    found.push(now === 0 ? `No longer sent (the baseline has it ${count} x):\n${entry}` : `Sent ${now} x, the baseline has ${count} x:\n${entry}`);
  }
  for (const [entry, now] of recording) {
    if (!baseline.has(entry)) found.push(`Not in the baseline (sent ${now} x):\n${entry}`);
  }
  return found;
}

export const baselineFile = (name) => path.join(BASELINE_DIR, `${name}.txt`);
export const readBaseline = async (name) => parse(await readFile(baselineFile(name), 'utf8'));

/** Writes a baseline that does not exist yet. An existing one is never written over: delete it by hand if a new one is really meant. */
export async function writeBaseline(name, what, recordings) {
  const file = baselineFile(name);
  if (existsSync(file)) throw new Error(`${path.relative(ROOT, file)} exists and is not written over: it is the record of what was sent before Phase 10b.`);
  await mkdir(BASELINE_DIR, { recursive: true });
  await writeFile(file, render(what, combine(recordings), RECORDED_LATER[name] ?? RECORDED_AT));
  return file;
}

/**
 * Runs one node suite under the recorder and resolves to its tally. The suite itself must pass.
 * `script` is another file to run in its place (amendBaseline: the suite as the last commit has it); `skip` is a pattern of test
 * names that are not run (node's own --test-skip-pattern: a skipped `describe` does not run its hooks either).
 * `root` is another copy of the tree to run the suite IN (its own `scripts/<name>.js`, its own code, its own helpers): the last commit's,
 * for an amendment with `--code`. `byTest: true` resolves to { tally, tests } instead, `tests` being tallyByTest() of the same run.
 */
export async function recordSuite(name, env = {}, { root = ROOT, script = path.join(root, 'scripts', `${name}.js`), skip = null, byTest = false } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pms-requests-'));
  const file = path.join(dir, 'requests.txt');
  const testsFile = path.join(dir, 'requests-by-test.jsonl');
  // The suite is run as a plain script, not as a child of a test runner (this may itself be running under `node --test`).
  const { NODE_TEST_CONTEXT: _runner, ...inherited } = process.env;
  const what = `${path.relative(root, script)}${root === ROOT ? '' : ' (in the copy of the last commit)'}`;
  try {
    // (The recorder is always today's: it only writes down what is sent, and `byTest` needs the one that notes the test.)
    await promisify(execFile)(process.execPath, [...(skip ? [`--test-skip-pattern=${skip}`] : []), '--import', new URL('./request-recorder.js', import.meta.url).href, script], {
      cwd: root, env: { ...inherited, ...env, PMS_RECORD_REQUESTS: file, ...(byTest ? { PMS_RECORD_TESTS: testsFile } : {}) }, maxBuffer: 64 * 1024 * 1024,
    }).catch((error) => { throw new Error(`${what} failed while its requests were being recorded${skip ? ` (without the tests matching ${skip})` : ''}:\n${String(error.stdout ?? '').slice(-4000)}\n${String(error.stderr ?? '').slice(-2000)}`); });
    const counted = tally(existsSync(file) ? await readFile(file, 'utf8') : '');
    return byTest ? { tally: counted, tests: tallyByTest(existsSync(testsFile) ? await readFile(testsFile, 'utf8') : '') } : counted;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The by-test file of a recording (scripts/request-recorder.js with PMS_RECORD_TESTS) as Map(test name -> Map(entry -> times sent)).
 * @param {string} text
 * @returns {Map<string, Map<string, number>>}
 */
export function tallyByTest(text) {
  const tests = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const { test, entry } = JSON.parse(line);
    const counts = tests.get(test) ?? tests.set(test, new Map()).get(test);
    const key = normalise(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return tests;
}

/**
 * Which test each difference belongs to (Phase 10c-2a). `before` and `after` are tallyByTest() of the same suite at two moments. Resolves to
 * [{ test, changes: [{ entry, before, after }] }] for every test whose requests are not what they were, a test that exists on one side only
 * included (its other side is all zeros), in the order the tests ran. Pure.
 * @param {Map<string, Map<string, number>>} before
 * @param {Map<string, Map<string, number>>} after
 */
export function explain(before, after) {
  const found = [];
  for (const test of new Set([...before.keys(), ...after.keys()])) {
    const [was, now] = [before.get(test) ?? new Map(), after.get(test) ?? new Map()];
    const changes = [...new Set([...was.keys(), ...now.keys()])].sort()
      .map((entry) => ({ entry, before: was.get(entry) ?? 0, after: now.get(entry) ?? 0 }))
      .filter((change) => change.before !== change.after);
    if (changes.length) found.push({ test, gone: !after.has(test), fresh: !before.has(test), changes });
  }
  return found;
}

/**
 * The last commit's whole tree (tracked files only) in a folder of its own, with this checkout's node_modules: where an amendment with
 * `--code`, and `--explain`, make their "before" recordings. Resolves to the folder; the caller removes it.
 */
export async function exportLastCommit() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pms-last-commit-'));
  await promisify(exec)(`git archive --format=tar HEAD | tar -x -C "${dir}"`, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  await symlink(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  return dir;
}

/**
 * What an amendment may write, or why it may not (Phase 10c-1). Pure: amendBaseline() makes the recordings.
 *
 * A baseline is never regenerated to make a comparison pass. But a test that is removed takes its requests with it, and a test that is
 * changed on purpose sends others, and the baseline has to follow THOSE requests and no others. So an amendment names the tests, and
 * is refused unless two things hold:
 *
 *   1. `headFull` (the suite as the last commit has it, run on today's tree) equals the baseline. Nothing but the suite itself has
 *      changed what it sends: a change in the data layer, the app or a helper stops here, as the finding it is.
 *   2. `headKept` and `nowKept` (the last commit's suite and today's, each with the named tests skipped) are the same. Every test that
 *      was NOT named sends what it sent.
 *
 * Then the new baseline is today's recording (`nowFull`, one or more runs), and `changes` says, for every entry whose count is not
 * what it was, the old count and the new: lowered, dropped or new. An entry whose count depends on timing ("~") is left as it was,
 * unless only the named tests ever sent it.
 *
 * The same two rules serve a change in the CODE (amendBaseline with `code`, Phase 10c-2a: a read that is no longer made, a filter that
 * lost a term), and a change in a HELPER that the suite imports (a fixture that makes its visits another way: without `code`, rule 1
 * stops that too, because the last commit's suite run with today's helper is not the baseline). The recordings named `head...` are
 * then made on the last commit's whole tree, so rule 1 says "the last commit, tests, helpers and code, sends its baseline" and rule 2
 * says "every test that was not named sends today what it sent at the last commit". What this function is handed differs; what it
 * decides does not.
 * @param {Map<string, { count: number, loose: boolean }>} baseline
 * @param {{ headFull: Map<string, number>, headKept: Map<string, number>, nowKept: Map<string, number>, nowFull: Map<string, number>[] }} recordings
 * @returns {{ problems: string[], next: Map<string, { count: number, loose: boolean }>, changes: string[] }}
 */
export function amendment(baseline, { headFull, headKept, nowKept, nowFull }) {
  const stopped = (problems) => ({ problems, next: baseline, changes: [] });
  const drifted = differences(baseline, headFull);
  if (drifted.length) return stopped(drifted.map((difference) => `Before any test was changed, the suite does not send what its baseline holds. ${difference}`));
  const others = [];
  for (const entry of new Set([...headKept.keys(), ...nowKept.keys()])) {
    if (baseline.get(entry)?.loose) continue; // a count that depends on timing is not held, here as in every comparison
    const [before, now] = [headKept.get(entry) ?? 0, nowKept.get(entry) ?? 0];
    if (before !== now) others.push(`A test that was not named sends something else (${before} x before, ${now} x now):\n${entry}`);
  }
  if (others.length) return stopped(others);

  const next = new Map();
  for (const [entry, { count, loose }] of combine(nowFull)) {
    const was = baseline.get(entry);
    // An entry whose count depends on timing is left exactly as it was: that count is not held, and a few recordings are no reason to move it.
    next.set(entry, was?.loose ? was : { count, loose });
  }
  // A timing-dependent entry that no recording happened to send stays, unless only the named tests ever sent it.
  for (const [entry, was] of baseline) {
    if (was.loose && !next.has(entry) && (headKept.has(entry) || !headFull.has(entry))) next.set(entry, was);
  }
  const shown = ({ count, loose }) => `${loose ? '~' : ''}${count} x`;
  const changes = [];
  for (const [entry, was] of [...baseline].sort(byText)) {
    const now = next.get(entry);
    if (!now) changes.push(`dropped (was ${shown(was)}):\n${entry}`);
    else if (now.count !== was.count) changes.push(`${shown(was)} -> ${shown(now)}:\n${entry}`);
  }
  for (const [entry, now] of [...next].sort(byText)) {
    if (!baseline.has(entry)) changes.push(`new (${shown(now)}):\n${entry}`);
  }
  return { problems: [], next, changes };
}

/**
 * Amends one suite's baseline for the tests whose names match `pattern` (removed, or changed on purpose), by amendment()'s rules.
 * Run it after the test file is edited and BEFORE any code is: it compares with the suite as the last commit has it. It writes the
 * file only when nothing stops it, adds a line to the file's header saying what was amended, and resolves to what it found.
 */
export async function amendBaseline(name, pattern, { runs = 3, why = '', code = false } = {}) {
  if (!NODE_SUITES.includes(name)) throw new Error(`${name} is not a recorded suite: ${NODE_SUITES.join(', ')}`);
  if (!pattern) throw new Error("Name the tests: --tests '<pattern of test names>'");
  const file = baselineFile(name);
  const text = await readFile(file, 'utf8');
  // Without `code`: the suite as the last commit has it, beside today's so that its imports find today's code and helpers (only the tests
  // may have changed). With `code`: the last commit's whole tree, in a folder of its own (the code may have changed too).
  const committed = path.join(ROOT, 'scripts', `.${name}.committed.js`);
  const lastCommit = code ? await exportLastCommit() : null;
  if (!code) {
    const { stdout } = await promisify(execFile)('git', ['show', `HEAD:scripts/${name}.js`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    await writeFile(committed, stdout);
  }
  const before = code ? { root: lastCommit } : { script: committed };
  let recordings;
  try {
    const headFull = await recordSuite(name, {}, before);
    const headKept = await recordSuite(name, {}, { ...before, skip: pattern });
    const nowKept = await recordSuite(name, {}, { skip: pattern });
    const nowFull = [];
    for (let run = 0; run < runs; run += 1) nowFull.push(await recordSuite(name));
    recordings = { headFull, headKept, nowKept, nowFull };
  } finally {
    await rm(committed, { force: true });
    if (lastCommit) await rm(lastCommit, { recursive: true, force: true });
  }
  const found = amendment(parse(text), recordings);
  if (found.problems.length || !found.changes.length) return found;
  const header = text.split('\n').filter((line) => line.startsWith('#'));
  const note = `# Amended (${found.changes.length} entr${found.changes.length === 1 ? 'y' : 'ies'}) for the tests matching /${pattern}/${code ? ', compared with the last commit\'s whole tree (its code and helpers, not only its suite)' : ''}${why ? `: ${why}` : ''}. Nothing else was changed (scripts/request-baseline.js, amendment()).`;
  const entries = [...found.next].sort(byText).map(([entry, { count, loose }]) => `${loose ? '~' : ''}${count} x ${entry}`);
  await writeFile(file, [...header, note, ...entries, ''].join('\n'));
  return found;
}

/**
 * `--explain <suite>`: the suite recorded test by test on the last commit's tree and on today's, and every test whose requests differ.
 * Read-only. Resolves to explain()'s list.
 */
export async function explainSuite(name) {
  if (!NODE_SUITES.includes(name) && !existsSync(path.join(ROOT, 'scripts', `${name}.js`))) throw new Error(`There is no scripts/${name}.js.`);
  const lastCommit = await exportLastCommit();
  try {
    const had = existsSync(path.join(lastCommit, 'scripts', `${name}.js`));
    const before = had ? (await recordSuite(name, {}, { root: lastCommit, byTest: true })).tests : new Map();
    const after = existsSync(path.join(ROOT, 'scripts', `${name}.js`)) ? (await recordSuite(name, {}, { byTest: true })).tests : new Map();
    return explain(before, after);
  } finally {
    await rm(lastCommit, { recursive: true, force: true });
  }
}

const flag = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && process.argv.includes('--explain')) {
  const name = flag('--explain');
  const found = await explainSuite(name);
  const sum = (key) => found.reduce((total, test) => total + test.changes.reduce((count, change) => count + change[key], 0), 0);
  console.log(`${name}: ${found.length} test${found.length === 1 ? '' : 's'} send${found.length === 1 ? 's' : ''} something else than at the last commit (${sum('before')} requests before, ${sum('after')} now, in the entries that changed)`);
  for (const { test, gone, fresh, changes } of found) {
    console.log(`\n### ${test}${gone ? ' (removed)' : fresh ? ' (new)' : ''}\n`);
    console.log('| Before | Now | Request |\n|---|---|---|');
    for (const change of changes) console.log(`| ${change.before} | ${change.after} | \`${change.entry.replaceAll('\n    carries ', ' + ').replaceAll('|', '\\|')}\` |`);
  }
} else if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && process.argv.includes('--amend')) {
  const name = flag('--amend');
  const found = await amendBaseline(name, flag('--tests'), { runs: Number(flag('--runs')) || 3, why: flag('--why') ?? '', code: process.argv.includes('--code') });
  if (found.problems.length) {
    console.log(`${name}: NOT amended. ${found.problems.length} thing${found.problems.length === 1 ? '' : 's'} in the way:`);
    for (const problem of found.problems) console.log(`  ${problem.replaceAll('\n', '\n    ')}`);
    process.exitCode = 1;
  } else if (!found.changes.length) {
    console.log(`${name}: nothing to amend: with or without those tests, the suite sends what its baseline holds`);
  } else {
    console.log(`${name}: amended, ${found.changes.length} entr${found.changes.length === 1 ? 'y' : 'ies'} (every other entry is as it was):`);
    for (const change of found.changes) console.log(`  ${change.replaceAll('\n', '\n    ')}`);
  }
} else if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const write = process.argv.includes('--write');
  const runs = Number(flag('--runs')) || 5;
  let failed = false;
  for (const name of NODE_SUITES) {
    if (write) {
      if (existsSync(baselineFile(name))) { console.log(`${name}: has a baseline, left as it is`); continue; }
      const recordings = [];
      for (let run = 0; run < runs; run += 1) recordings.push(await recordSuite(name));
      await writeBaseline(name, `scripts/${name}.js on the mocked SharePoint REST (${runs} recordings)`, recordings);
      console.log(`${name}: recorded`);
      continue;
    }
    const baseline = await readBaseline(name);
    const recording = await recordSuite(name);
    const found = differences(baseline, recording);
    const sent = [...recording.values()].reduce((sum, count) => sum + count, 0);
    console.log(`${name}: ${found.length ? `${found.length} DIFFERENCE${found.length === 1 ? '' : 'S'}` : 'identical'} (${recording.size} distinct requests, ${sent} sent)`);
    for (const difference of found) console.log(`  ${difference.replaceAll('\n', '\n    ')}`);
    failed ||= found.length > 0;
  }
  process.exitCode = failed ? 1 : 0;
}
