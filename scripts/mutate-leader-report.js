// A mutation check of the leader report's counting. Each entry below breaks ONE rule of migration/src/lib/leader-report.js (or, for the
// rule that names a participant, of lib/participant-names.js, which the report and Admin → Results share) on purpose, in a copy beside it,
// never the file itself; scripts/test-leader-report.js is then run against the broken copy and MUST fail.
// A mutation the tests do not notice ("survived") is a rule nothing is holding, and this script exits 1.
//
//   node scripts/mutate-leader-report.js            (npm run test:report:mutations)
//
// It is not part of `npm test`: it runs the unit tests once per mutation (about 25 short runs).

import { spawnSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.join(import.meta.dirname, '..');
const LIB = path.join(ROOT, 'migration', 'src', 'lib');
const SOURCE = path.join(LIB, 'leader-report.js');
// The rule that names a participant moved to its own file in Phase 7c. A mutation's text is found in exactly one of these two files.
const NAMES = path.join(LIB, 'participant-names.js');
const TESTS = path.join(ROOT, 'scripts', 'test-leader-report.js');

/** [what is broken, the exact text to find (once), what to put in its place] */
const MUTATIONS = [
  ['A question’s first-try count uses the LAST answer (a Retry would raise it)',
    'const right = given.filter(({ record }) => isRight(question, record.first, record)).length;',
    'const right = given.filter(({ record }) => isRight(question, record.final, record)).length;'],
  ['A person’s score counts the LAST answer',
    'if (row.answered && question.kind === \'graded\') { gradedAnswered += 1; if (row.firstRight) gradedRight += 1; }',
    'if (row.answered && question.kind === \'graded\') { gradedAnswered += 1; if (row.finalRight) gradedRight += 1; }'],
  ['A score is out of every graded question, not the ones answered',
    'scorePercent: gradedAnswered > 0 ? share(gradedRight, gradedAnswered) : null,',
    'scorePercent: gradedAnswered > 0 ? share(gradedRight, allQuestions.filter((question) => question.kind === \'graded\').length) : null,'],
  ['The average includes people with no graded answer, as zero',
    'averageScore: scored.length > 0 ? scored.reduce((sum, person) => sum + /** @type {number} */ (person.scorePercent), 0) / scored.length : null,',
    'averageScore: scored.length > 0 ? scored.reduce((sum, person) => sum + /** @type {number} */ (person.scorePercent), 0) / participants.length : null,'],
  ['The bars of a graded question count the LAST answer',
    'for (const id of kind === \'graded\' ? [record.first] : [...new Set(list(record.counted))]) {',
    'for (const id of kind === \'graded\' ? [record.final] : [...new Set(list(record.counted))]) {'],
  ['The most common wrong answer is the LEAST common',
    'const wrong = rows.filter((row) => !row.correct && row.count > 0).sort((a, b) => b.count - a.count)[0];',
    'const wrong = rows.filter((row) => !row.correct && row.count > 0).sort((a, b) => a.count - b.count)[0];'],
  ['The most common "wrong" answer may be the right one',
    'const wrong = rows.filter((row) => !row.correct && row.count > 0).sort((a, b) => b.count - a.count)[0];',
    'const wrong = rows.filter((row) => row.count > 0).sort((a, b) => b.count - a.count)[0];'],
  ['A wrong first answer that was never tried again counts as final (so "finished" is too generous)',
    'const isFinal = (question, record) => isRecordSettled({ correct: record.stored, attempts: record.attempts ?? MAX_WRONG_TRIES }) || isRight(question, record.final, record);',
    'const isFinal = () => true;'],
  ['"Finished" needs only one answer in the activity',
    'status: rows.length > 0 && final === rows.length ? \'finished\' : given > 0 ? \'started\' : \'not-started\' };',
    'status: rows.length > 0 && final > 0 ? \'finished\' : given > 0 ? \'started\' : \'not-started\' };'],
  ['A switched-off activity must be finished too',
    'const required = own.filter((activity) => !activity.off && activity.rows.length > 0);',
    'const required = own.filter((activity) => activity.rows.length > 0);'],
  ['A switched-off activity with answers is left out',
    'if (!on && !own.some((question) => answeredIds.has(String(question.id)))) continue;',
    'if (!on) continue;'],
  ['Answers to a deleted question are dropped without a word',
    'if (placed.has(questionId)) continue;',
    'if (placed.has(questionId) || !strayIndex.has(questionId)) continue;'],
  ['An unnamed participant is given the number 0 first',
    'if (isUnnamed) name = `Unnamed participant ${unnamed += 1}`;',
    'if (isUnnamed) name = `Unnamed participant ${unnamed++}`;'],
  ['A second visit under the same name is not told apart',
    'if (count > 1) name = `${name} (${count})`;',
    'if (count > 99) name = `${name} (${count})`;'],
  ['A guest’s visit takes the name of the iPad’s account',
    'if (!name && !track.visitorId && track.sharePointUserId !== null && track.sharePointUserId !== undefined) name = byAccount.get(String(track.sharePointUserId)) ?? \'\';',
    'if (!name && track.sharePointUserId !== null && track.sharePointUserId !== undefined) name = byAccount.get(String(track.sharePointUserId)) ?? \'\';'],
  ['Participants are listed newest first',
    'const ordered = [...tracks].sort((a, b) => String(a.createdAt ?? \'\').localeCompare(String(b.createdAt ?? \'\')) || String(a.id).localeCompare(String(b.id)));',
    'const ordered = [...tracks].sort((a, b) => String(b.createdAt ?? \'\').localeCompare(String(a.createdAt ?? \'\')) || String(a.id).localeCompare(String(b.id)));'],
  ['A restart is not mentioned',
    'restart: track?.restartedAt\n',
    'restart: track?.neverSet\n'],
  ['Ranking points are one too few (the last place earns nothing)',
    'score: places.reduce((sum, place) => sum + (size - place + 1), 0)',
    'score: places.reduce((sum, place) => sum + (size - place), 0)'],
  ['The confidence average divides by one answer too many',
    'result.average = { value: chosen.reduce((sum, value) => sum + value, 0) / chosen.length,',
    'result.average = { value: chosen.reduce((sum, value) => sum + value, 0) / (chosen.length + 1),'],
  ['A percentage is a share of the picks, not of the people (choose-any would add up to 100)',
    'for (const row of rows) row.percent = share(row.count, respondents);',
    'for (const row of rows) row.percent = share(row.count, rows.reduce((sum, each) => sum + each.count, 0));'],
  ['Hardest and easiest are the wrong way round',
    'hardest: flat ? null : highlight(ranked(1)), easiest: flat ? null : highlight(ranked(-1)),',
    'hardest: flat ? null : highlight(ranked(-1)), easiest: flat ? null : highlight(ranked(1)),'],
  ['A switched-off question can be "the hardest"',
    'const graded = results.filter((activity) => !activity.off).flatMap(',
    'const graded = results.flatMap('],
  ['An answer whose option was removed is judged wrong, whatever was recorded',
    'return option ? option.correct === true : record.first === id && record.stored === true;',
    'return option ? option.correct === true : false;'],
  ['The CSV does not guard against a formula',
    'if (FORMULA_AT_START.test(text)) text = `\'${text}`;',
    'if (/^[\\t\\r]/.test(text)) text = `\'${text}`;'],
  // Phase 9a: the guard also covers a sign behind white space, and one after a semicolon or a tab inside the text.
  ['The CSV lets a formula through behind a space',
    'const FORMULA_AT_START = new RegExp(`^${BLANK}[=+\\\\-@]|^[\\\\t\\\\r]`);',
    'const FORMULA_AT_START = new RegExp(`^[=+\\\\-@]|^[\\\\t\\\\r]`);'],
  ['The CSV lets a formula through after a semicolon inside a cell',
    "let text = String(value ?? '').replace(FORMULA_AFTER_SPLIT, \"$1\'\");",
    "let text = String(value ?? '');"],
  ['The CSV has no byte-order mark',
    'export const participantAnswersCsv = (report) => `${BOM}${',
    'export const participantAnswersCsv = (report) => `${'],
  ['The CSV leaves out the people who answered nothing',
    'for (const person of report.participants) {\n    for (const activity of person.activities) {',
    'for (const person of report.participants.filter((each) => each.answered > 0)) {\n    for (const activity of person.activities) {'],
  ['The CSV’s "Correct" and "Correct on first try" are swapped',
    'row.answered ? yes(row.finalRight) : \'\', row.answered ? yes(row.firstRight) : \'\'',
    'row.answered ? yes(row.firstRight) : \'\', row.answered ? yes(row.finalRight) : \'\''],
  // Phase 9b: answers that could not be read, and sample content.
  ['The cover never says that answers could not be read',
    'unreadableNotice: unreadableText,',
    "unreadableNotice: '',"],
  ['Somebody whose answers could not be read is counted as having "answered nothing"',
    'answeredNothing: participants.filter((person) => person.answered === 0 && person.strays === 0 && !person.unreadable).length,',
    'answeredNothing: participants.filter((person) => person.answered === 0 && person.strays === 0).length,'],
  ['A sample client\'s cover never says it is not yet confirmed',
    "sampleNotice: needsConfirmation(client) ? SAMPLE_REPORT_LINE : '',",
    "sampleNotice: '',"],
  ['Every client\'s cover says the content is not yet confirmed',
    "sampleNotice: needsConfirmation(client) ? SAMPLE_REPORT_LINE : '',",
    "sampleNotice: client ? SAMPLE_REPORT_LINE : '',"],
  ['A light client colour is used as it is (a bar that cannot be seen on white)',
    'for (let step = 1; contrastRatio(accent, \'#FFFFFF\') < MIN_GRAPHIC_CONTRAST && step <= 50; step += 1)',
    'for (let step = 1; contrastRatio(accent, \'#FFFFFF\') < 1 && step <= 50; step += 1)'],
];

const run = (modulePath) => spawnSync(process.execPath, ['--test', TESTS], {
  cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...(modulePath ? { LEADER_REPORT_MODULE: pathToFileURL(modulePath).href } : {}) },
});

const source = await readFile(SOURCE, 'utf8');
const names = await readFile(NAMES, 'utf8');
const control = run(null);
if (control.status !== 0) {
  console.error('The tests do not pass on the real file, so a mutation check would prove nothing.\n', control.stdout.slice(-2000));
  process.exit(1);
}

const survived = [];
let number = 0;
for (const [what, find, replace] of MUTATIONS) {
  number += 1;
  const inReport = source.split(find).length - 1;
  const inNames = names.split(find).length - 1;
  if (inReport + inNames !== 1) {
    console.error(`Mutation ${number} no longer applies (its text is in the files ${inReport + inNames} times, not once): ${what}`);
    process.exit(1);
  }
  const mutant = path.join(LIB, `.leader-report.mutant-${number}.js`);
  const mutantNames = path.join(LIB, `.participant-names.mutant-${number}.js`);
  if (inReport === 1) await writeFile(mutant, source.replace(find, replace));
  else {
    // The broken naming rule is wired in by a copy of the report that imports it from the copy.
    await writeFile(mutantNames, names.replace(find, replace));
    await writeFile(mutant, source.split('./participant-names.js').join(`./.participant-names.mutant-${number}.js`));
  }
  let result;
  try { result = run(mutant); } finally { await rm(mutant, { force: true }); await rm(mutantNames, { force: true }); }
  const failed = result.stdout.match(/^ℹ fail (\d+)/m)?.[1] ?? '?';
  const killed = result.status !== 0;
  if (!killed) survived.push(what);
  console.log(`${killed ? 'caught  ' : 'SURVIVED'}  ${String(number).padStart(2)}  ${what}${killed ? `  (${failed} test${failed === '1' ? '' : 's'} failed)` : ''}`);
}

console.log(`\n${MUTATIONS.length - survived.length} of ${MUTATIONS.length} mutations caught.`);
if (survived.length > 0) {
  console.error(`Not caught:\n${survived.map((what) => `  - ${what}`).join('\n')}`);
  process.exit(1);
}
