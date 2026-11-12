// Summary by activity (CSV), the Live display's spreadsheet (Phase 13), and saving a file: summaryRows() builds its rows, resultsToCsv() its text,
// downloadCsv() saves it. Moved out of resultsExport.js unchanged (Prompt 44), which still passes these names on. The admin page's alone;
// nothing here fetches data, and every cell goes through csvCell, so none starts a formula.

import { csvCell } from './leader-report.js';
import { buildReport } from './summary-pack.js';

/** The summary CSV's columns, in reading order (Phase 13, EXPORT-DESIGN.md 3.3). */
export const SUMMARY_COLUMNS = Object.freeze(['Client', 'Session date', 'Activity', 'Question number', 'Question', 'Question type', 'Option', 'Answers', 'Share of answers (%)', 'Rank or score', 'Correct option', 'Top choice', 'Answers to this question', 'Takeaway']);


/** A question's type in words, as a spreadsheet's reader would name it. */
const TYPE_WORDS = Object.freeze({
  'single-select': 'Single choice', 'multi-select': 'Multiple choice', 'true-false': 'True or false',
  'confidence-continuum': 'Confidence scale', 'ranked-voting': 'Ranking', 'open-text-feedback': 'Survey feedback', 'art-of-the-possible': 'Art of the Possible',
});

/**
 * "Summary by activity": one row per option of each live question, in the screen's order (the chart model's: single and multiple choice
 * highest first, true or false and a scale in their own order, a ranking by its support score), with the client, the session's date (ISO), the
 * question's number and type in words, the answers to the option and their share as whole numbers (the screen's), a scale step's place or a
 * ranking's support score, the correct answer and the top choice marked "Yes", the answers to the question, and the question's headline on its
 * first row. A written-answer question's rows are the words that came up most (each with the comments it is in). Then every comment is a row of
 * its own, "Comment", with no name and no share. Numbers are numbers.
 */
function summaryRows(results, brand = {}) {
  const report = buildReport(results, brand);
  const head = [report.clientName, report.sessionDay];
  const rows = [];
  const comments = [];
  for (const question of report.questions) {
    const { chart } = question;
    const type = TYPE_WORDS[chart.type] ?? 'Single choice';
    const base = [...head, question.section, question.number, chart.prompt, type];
    const own = [];
    const yes = (value) => (value ? 'Yes' : '');
    if (chart.kind === 'matrix') {
      // (Prompt 23: a line for each sub-process: the guests who rated it, its opportunity as the score, and High-band rows marked. Nobody is named.)
      for (const row of chart.rows) own.push([row.label, row.n, '', row.opportunity === null ? '' : Math.round(row.opportunity), '', yes(row.band === 'High')]);
    } else if (chart.kind === 'text') {
      for (const word of chart.words) own.push([word.word, word.count, '', '', '', '']);
      for (const comment of chart.comments) comments.push([...head, question.section, question.number, chart.prompt, 'Comment', comment.text, '', '', '', '', '', chart.answered, '']);
    } else if (chart.kind === 'ranking') {
      for (const option of chart.options) own.push([option.label, option.rankers, '', option.score, '', yes(option.rank === 1 && chart.answered > 0)]);
    } else {
      const options = chart.kind === 'scale' && chart.scale ? chart.scale.steps : chart.options;
      for (const option of options) {
        const place = chart.kind === 'scale' && Number.isFinite(Number(option.value)) ? Number(option.value) : '';
        own.push([option.label, option.count, option.percent, place, yes(option.isCorrect), yes(option.isTop)]);
      }
    }
    if (own.length === 0) own.push(['', '', '', '', '', '']);
    own.forEach((cells, index) => rows.push([...base, ...cells, chart.answered, index === 0 ? chart.headline : '']));
  }
  return [...rows, ...comments];
}

/** The summary CSV's text: a header row, then summaryRows(), CRLF line ends; cells as the leader report writes them (csvCell). */
export const resultsToCsv = (results, brand = {}) => `${[SUMMARY_COLUMNS, ...summaryRows(results, brand)].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;

/** The file itself: a byte-order mark first, so Excel reads it as UTF-8 (accents, curly quotes in comments). */
export const summaryCsvFile = (results, brand = {}) => `${String.fromCharCode(0xFEFF)}${resultsToCsv(results, brand)}`;

/** A file name safe on every OS, e.g. "results-s-kroger-kickoff-2026-09-19.csv". */
export function exportFileName(results, extension, prefix = 'results') {
  const slug = String(results.session.id).replace(/[^\w-]+/g, '-');
  return `${prefix}-${slug}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

/** Saves a Blob as a file through the browser's download. (Safari on iPad shows its download prompt.) */
export function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000); // after the browser has started the download
}

/** Exports the session's summary by activity as a CSV download (`brand.name` is the client's name in every row). Resolves to the file name. */
export function downloadCsv(results, brand = {}) {
  const fileName = exportFileName(results, 'csv', 'summary-by-activity');
  saveBlob(new Blob([summaryCsvFile(results, brand)], { type: 'text/csv;charset=utf-8' }), fileName);
  return fileName;
}
