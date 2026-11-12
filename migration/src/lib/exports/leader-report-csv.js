// The leader report's spreadsheets (Phase 7b, Prompt 23): All answers (CSV), Art of the Possible in long form, the file names, and the one rule
// that no cell starts a formula (csvCell). Moved out of leader-report.js unchanged (Prompt 44), which passes these names on. Plain JS, no DOM.

import { STRAY_TITLE } from './leader-report-text.js';

// ---- The participant CSV ----------------------------------------------------------------------------------------------------------------

/** The byte-order mark that makes a spreadsheet read the file as UTF-8. Written as a number: the character itself does not show in an editor. */
const BOM = String.fromCharCode(0xFEFF);

export const CSV_COLUMNS = Object.freeze(['Client', 'Date', 'Participant', 'Activity', 'Question', 'First answer', 'Final answer', 'Correct', 'Correct on first try', 'Attempts', 'Answered at']);
/** The two columns a session with the confidence check adds (Phase 20): each guest's Before and After score, on every row of theirs. */
export const CHECK_CSV_COLUMNS = Object.freeze(['Confidence before', 'Confidence after']);
/** The CSV's header: CSV_COLUMNS, and CHECK_CSV_COLUMNS when the session lists the client's check. @param {{ summary: { confidence?: unknown } }} report */
export const csvColumns = (report) => (report.summary.confidence ? [...CSV_COLUMNS, ...CHECK_CSV_COLUMNS] : [...CSV_COLUMNS]);

// White space a spreadsheet ignores in front of a formula's sign: what \s matches, and the zero-width space (written as a number:
// the character itself does not show in an editor).
const BLANK = `[\\s${String.fromCharCode(0x200B)}]*`;
const FORMULA_AT_START = new RegExp(`^${BLANK}[=+\\-@]|^[\\t\\r]`);
const FORMULA_AFTER_SPLIT = new RegExp(`([;\\t])(?=${BLANK}[=+\\-@])`, 'g');

/**
 * One CSV cell. Text that would start a formula in a spreadsheet (= + - @, or a tab or carriage return) gets a leading
 * apostrophe, because names and comments come from the audience; a number stays a number. White space in front of the sign does
 * not get it through, and neither does a semicolon or a tab inside the text (a spreadsheet set to split on those would begin a new
 * cell there, whatever this file's own commas and quotes say): the sign after one gets the apostrophe too.
 * @param {unknown} value
 */
export function csvCell(value) {
  if (typeof value === 'number') return String(value);
  let text = String(value ?? '').replace(FORMULA_AFTER_SPLIT, "$1'");
  if (FORMULA_AT_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * One row for each participant and question (an unanswered question is a row with no answer and 0 attempts, so someone who
 * joined and answered nothing is still in the file), then the answers to questions no longer in an activity.
 * @param {LeaderReport} report
 */
export function participantAnswersRows(report) {
  const yes = (value) => (value === null ? '' : value ? 'Yes' : 'No');
  const head = [report.meta.clientName, report.meta.date];
  const rows = [];
  const checked = Boolean(report.summary.confidence);
  for (const person of report.participants) {
    const scores = checked ? [person.confidence?.before ?? '', person.confidence?.after ?? ''] : [];
    for (const activity of person.activities) {
      for (const row of activity.rows) {
        rows.push([...head, person.name, activity.title, row.prompt, row.first, row.final, row.answered ? yes(row.finalRight) : '', row.answered ? yes(row.firstRight) : '', row.attempts ?? '', report.at.sortable(row.at), ...scores]);
      }
    }
  }
  for (const stray of report.strays) {
    for (const entry of stray.entries) rows.push([...head, entry.name, `(${STRAY_TITLE})`, stray.title, entry.text, entry.text, '', '', '', '', ...(checked ? ['', ''] : [])]);
  }
  return rows;
}

/** The file's text: a byte-order mark (so a spreadsheet reads accented names as UTF-8), a header row, CRLF line ends. @param {LeaderReport} report */
export const participantAnswersCsv = (report) => `${BOM}${[csvColumns(report), ...participantAnswersRows(report)].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;

/** The long file of an Art of the Possible question (Prompt 23): one line for each guest, sub-process and criterion. */
export const MATRIX_CSV_COLUMNS = Object.freeze(['Client', 'Date', 'Participant', 'Activity', 'Sub-process', 'People', 'Criterion', 'Rating', 'Answered at']);

/** Does the report have one? It offers the file only then. @param {LeaderReport} report */
export const hasMatrix = (report) => report.activities.some((activity) => activity.questions.some((question) => question.kind === 'matrix'));

/** The file's text, as the other CSVs write it: the same names (Hide names applies), csvCell, a byte-order mark, CRLF line ends. @param {LeaderReport} report */
export function matrixLongCsv(report) {
  const rows = report.activities.flatMap((activity) => activity.questions.flatMap((question) => (question.matrixCells ?? []).map((cell) => [report.meta.clientName, report.meta.date, cell.name, activity.title, cell.row, cell.people, cell.criterion, cell.rating, cell.at])));
  return `${BOM}${[MATRIX_CSV_COLUMNS, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** "leader-report-kroger-2026-10-11-2026-10-12.pdf": like exportFileName() in resultsExport.js, safe on every OS. */
export function reportFileName(prefix, sessionId, extension, now = new Date()) {
  return `${prefix}-${String(sessionId).replace(/[^\w-]+/g, '-')}-${new Date(now).toISOString().slice(0, 10)}.${extension}`;
}
