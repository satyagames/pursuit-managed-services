// Since Phase 10c-1 this file belongs to the new build alone (migration/): the legacy app that shared it is kept in the tag legacy-final.
/**
 * resultsExport.js: turns a session's aggregated results (the tree that
 * migration/src/lib/session-results.js readSessionResults() returns) into files for the facilitator.
 *
 *   CSV  summary by activity (Phase 13): summaryRows() and resultsToCsv() build it, downloadCsv() saves it.
 *   PDF  downloadPdf(): the summary pack (jsPDF): a summary page, then a page for each live activity (Phase 13).
 *   PPT  downloadPptx(): the same pack as 16:9 slides with speaker notes (PptxGenJS).
 *
 * Nothing here fetches data. Every file shows each question as the Live display's chart does,
 * from the same chart model (Phase 11b) and the same takeaways (lib/export-summary.js, Phase 13),
 * so every file agrees with what the screen shows. The PDF and PPT are built from one layout
 * (see "The summary pack"), so they match each other too. The caller passes the client's brand (branding.js's currentBrand()) and the
 * Results palette; without a brand the report is unbranded.
 */

import { embeddedAssetUrl } from './assets.js';
import { MULTI_CAPTION, RANKING_CAPTION, answerCounts, answersFrom, chartOf, fewAnswersLine } from '../../migration/src/lib/results-chart-model.js';
import { chartFigure } from '../../migration/src/lib/results-chart-figure.js';
import { summarizeSession } from '../../migration/src/lib/export-summary.js';
import { binaryString, createMeasure, loadReportFonts } from '../../migration/src/lib/report-fonts.js';
import { csvCell } from '../../migration/src/lib/leader-report.js';

/** The summary CSV's columns, in reading order (Phase 13, EXPORT-DESIGN.md 3.3). */
export const SUMMARY_COLUMNS = Object.freeze(['Client', 'Session date', 'Activity', 'Question number', 'Question', 'Question type', 'Option', 'Answers', 'Share of answers (%)', 'Rank or score', 'Correct option', 'Top choice', 'Answers to this question', 'Takeaway']);

/** The sections a session is showing (a section an admin hasn't enabled has no results to export). */
export const liveSections = (results) => results.sections.filter((section) => section.enabled === true);

/** A question's type in words, as a spreadsheet's reader would name it. */
const TYPE_WORDS = Object.freeze({
  'single-select': 'Single choice', 'multi-select': 'Multiple choice', 'true-false': 'True or false',
  'confidence-continuum': 'Confidence scale', 'ranked-voting': 'Ranking', 'open-text-feedback': 'Written answer',
});

/**
 * "Summary by activity": one row per option of each live question, in the screen's order (the chart model's: single and multiple choice
 * highest first, true or false and a scale in their own order, a ranking by its support score), with the client, the session's date (ISO), the
 * question's number and type in words, the answers to the option and their share as whole numbers (the screen's), a scale step's place or a
 * ranking's support score, the correct answer and the top choice marked "Yes", the answers to the question, and the question's headline on its
 * first row. A written-answer question's rows are the words that came up most (each with the comments it is in). Then every comment is a row of
 * its own, "Comment", with no name and no share. Numbers are numbers.
 */
export function summaryRows(results, brand = {}) {
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
    if (chart.kind === 'text') {
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
function saveBlob(blob, fileName) {
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


// ---- The summary pack (PDF and PPT) ------------------------------------------------------
// Phase 13 (EXPORT-DESIGN.md, 3.2): the executive summary of the session's live results, not a miniature of the screen. Page 1 is the summary
// (the title, the client, the date, "N answers from M iPads", and one takeaway per live activity from lib/export-summary.js, nothing else); then
// each live activity has a page of its own (a second when it has more than four questions): its title, its takeaway, and a card for each
// question with the chart the Live display shows (lib/results-chart-model.js, drawn by lib/results-chart-figure.js in the colours of
// styles/results-tokens.css). Nobody is named: the charts are made with no names.
//
// buildReport() turns the aggregated results into a plain model, layoutReport() places it on 16:9 pages (297 x 167 mm) as rectangles, lines,
// ticks, text lines and images, measured in the embedded Open Sans (lib/report-fonts.js), and the two writers only draw them: the PDF puts each
// page in the middle of an A4 landscape sheet, the PowerPoint makes it a 16:9 slide of native text and shapes, with speaker notes. So the two
// files can't drift apart, and the writers hold no layout logic. A slide must read when projected: no word under 12 pt, titles at 28 pt, the
// takeaway and each card's headline at 18 pt.

/** The pack's page: 16:9, as wide as A4 landscape. */
export const PACK_PAGE = Object.freeze({ width: 297, height: (297 * 9) / 16, margin: 12 });
/** The PDF's sheet: A4 landscape, the page in its middle. */
const SHEET = Object.freeze({ width: 297, height: 210 });
const SHEET_OFFSET = (SHEET.height - PACK_PAGE.height) / 2;
const FOOTER = 9;
/** Where the body of a page ends: below it are the footer's rule and words, and nothing else. */
export const PACK_BODY_BOTTOM = PACK_PAGE.height - PACK_PAGE.margin - FOOTER;
const SIZE = Object.freeze({ title: 28, takeaway: 18, headline: 18, heading: 18, question: 14, details: 14, small: 12, chart: 13.7 });
const FONT = { pptx: 'Open Sans' };
const PT_MM = 25.4 / 72;
const lineHeight = (size) => size * PT_MM * 1.25;
const CARDS_A_PAGE = 4;

/** The model both files are drawn from: each live activity with its charts and takeaway, with nobody's name in it. */
export function buildReport(results, brand = {}) {
  const sections = liveSections(results);
  const activities = sections.map((section) => ({
    id: String(section.id), title: section.title || 'Untitled activity', description: section.description ?? '',
    charts: section.questions.map((question) => chartOf(question, { names: null })),
  }));
  let number = 0;
  const questions = activities.flatMap((activity) => activity.charts.map((chart) => ({ number: number += 1, section: activity.title, activityId: activity.id, respondents: chart.answered, chart })));
  // "N answers from M iPads" as the Live display says it (Phase 11b): the iPads that answered, not every visit that began.
  const counts = answerCounts(sections.flatMap((section) => section.questions));
  const date = results.session.date ? new Date(`${results.session.date}T12:00:00`) : null;
  return {
    clientName: brand.name ?? '',
    logoUrl: brand.logoUrl ?? null,
    primary: hex6(brand.primaryColor, '0F172A'),
    secondary: hex6(brand.secondaryColor, '64748B'),
    sessionDate: date && !Number.isNaN(date.getTime())
      ? date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : '',
    sessionDay: /^\d{4}-\d{2}-\d{2}$/.test(String(results.session.date ?? '')) ? results.session.date : '',
    iPads: counts.visits,
    answers: counts.answers,
    activities,
    questions,
    summary: summarizeSession(activities),
  };
}

// ---- Colors
// The header band and the activity pages' strip are the client's; everything else is the Results palette (lib/results-palette.js, read from
// results-tokens.css), passed in.

/** "#0060A9" / "#06a" / "0060a9" as "0060A9"; `fallback` when it isn't a color. */
function hex6(value, fallback) {
  let hex = String(value ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3,4}$/i.test(hex)) hex = [...hex.slice(0, 3)].map((c) => c + c).join('');
  return /^[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(hex) ? hex.slice(0, 6).toUpperCase() : fallback;
}

const channels = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Black or white, whichever reads better on `hex` (a pale brand color would lose white text). */
function readableOn(hex) {
  const luminance = (value) => {
    const [r, g, b] = channels(value).map((c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  // Whichever has the more contrast (Phase 11b: a fixed threshold of 0.4 put white words on a colour of middle lightness, such as
  // #3C8DBC, at 3.7:1; one of the two always has 4.5:1 or more).
  const ground = luminance(hex);
  const onWhite = 1.05 / (ground + 0.05);
  const onDark = (ground + 0.05) / (luminance('111827') + 0.05);
  return onDark > onWhite ? '111827' : 'FFFFFF';
}

/** A palette colour ("#0076A8") as the writers take it ("0076A8"). */
const bare = (hex) => String(hex).replace(/^#/, '').toUpperCase();

// ---- Text measuring
// In the embedded Open Sans's own widths (lib/report-fonts.js createMeasure): the PDF draws that font, and PowerPoint names it. A machine without
// Open Sans shows Arial, which is narrower, so a line that fits in Open Sans fits there too.

/** Wrapping and widths from a font measure. @param {{ clean: (text: string) => string, width: (text: string, size: number, bold?: boolean) => number }} measure */
function textMeasure(measure) {
  const width = (text, size, bold = false) => measure.width(measure.clean(text), size, bold);
  /** Splits `text` into at most `maxLines` lines that fit `w` mm; the last one ends in "…" if cut. */
  function wrap(text, w, size, { bold = false, maxLines = 0 } = {}) {
    const words = String(text ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const fits = (line) => width(line, size, bold) <= w;
    const lines = [];
    let line = '';
    for (let word of words) {
      while (!fits(word) && [...word].length > 1) { // a single word wider than the line: break it
        const letters = [...word];
        let room = 1;
        while (room < letters.length && fits(letters.slice(0, room + 1).join(''))) room += 1;
        if (line) { lines.push(line); line = ''; }
        lines.push(letters.slice(0, room).join(''));
        word = letters.slice(room).join('');
      }
      if (!line || fits(`${line} ${word}`)) line = line ? `${line} ${word}` : word;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    if (!maxLines || lines.length <= maxLines) return lines;
    let last = `${lines[maxLines - 1]}…`;
    while (!fits(last) && last.length > 2) last = `${last.slice(0, -2)}…`;
    return [...lines.slice(0, maxLines - 1), last];
  }
  return { width, wrap, figure: { wrap: (text, w, size, bold, max) => wrap(text, w, size, { bold, maxLines: max }), width, lineHeight } };
}

// ---- Layout
// Primitives: { kind: 'rect', x, y, w, h, fill?, stroke?, radius? }
//             { kind: 'line', x, y, x2, y2, color, width }                 (width in mm)
//             { kind: 'tick', x, y, size, color }                           (the mark beside a correct answer)
//             { kind: 'text', x, y, w, h, text, size, bold?, color, align? }  (one line, centred in h)
//             { kind: 'image', x, y, w, h, data }
// An item inside a question's card carries `card: <question id>`; the card's frame is `role: 'card'`. A page is { kind, items, notes }.

const rect = (x, y, w, h, style = {}) => ({ kind: 'rect', x, y, w, h, ...style });
const label = (x, y, w, h, text, size, color, style = {}) => ({ kind: 'text', x, y, w, h, text, size, color, ...style });

/** What a speaker says about how a question was counted, in a sentence. */
function countingRule(chart) {
  const shares = 'Each share is of the people who answered this question, rounded so the shares add up to 100%.';
  if (chart.kind === 'text') return 'A word is counted once for each comment it is in; nobody is named.';
  if (chart.kind === 'multi') return MULTI_CAPTION;
  if (chart.kind === 'ranking') return `Support scores come from where each person ranked each answer: ${RANKING_CAPTION}`;
  if (chart.kind === 'scale') return `${shares} The average is of the steps people chose.`;
  return chart.graded ? `For a question with a correct answer, the bars count each person’s first answer. ${shares}` : shares;
}

/** The figure's neutral items as this file's primitives: a text line keeps its box, centred in it. */
function fromFigure(item) {
  if (item.kind === 'text' || item.kind === 'line' || item.kind === 'tick') return { ...item, color: bare(item.color) };
  return { ...item, ...(item.fill && { fill: bare(item.fill) }), ...(item.stroke && { stroke: bare(item.stroke) }) };
}

/**
 * One question's card at (x, y), `w` wide: the headline (the answer first), the question, how many answered (and "Only N answers." under five),
 * "N of M got it right first time", the chart and its caption. Returns { items, height }.
 */
function layoutCard(question, palette, text, x, y, w, { compact = false } = {}) {
  // A compact card (one too tall for a page otherwise) keeps two lines of headline, one of question, one a label and one comment; the full words are
  // in the speaker notes and the summary CSV.
  const [headlineLines, promptLines, labelLines, comments] = compact ? [2, 1, 1, 1] : [4, 3, 2, 3];
  const pad = 4;
  const { chart } = question;
  const inner = w - pad * 2;
  const items = [];
  const ink = bare(palette.text);
  const soft = bare(palette.textSecondary);
  let cursor = y + 1.2 + pad - 0.6;
  const lines = (words, size, color, { bold = false, max = 0, after = 0, role } = {}) => {
    for (const line of text.wrap(words, inner, size, { bold, maxLines: max })) {
      items.push(label(x + pad, cursor, inner, lineHeight(size), line, size, color, { bold, ...(role ? { role } : {}) }));
      cursor += lineHeight(size);
    }
    cursor += after;
  };
  lines(chart.headline, SIZE.headline, ink, { bold: true, max: headlineLines, after: 0.6, role: 'headline' });
  lines(chart.prompt, SIZE.question, ink, { max: promptLines, after: 0.4, role: 'prompt' });
  // How many answered: "Only four answers." under five, so a share of a few people never reads like one of many.
  lines(fewAnswersLine(chart.answered) || `${chart.answered.toLocaleString('en-US')} answered.`, SIZE.small, soft, { max: 1, after: chart.gradedLine ? 0 : 1.6 });
  if (chart.gradedLine) lines(chart.gradedLine, SIZE.small, soft, { bold: true, max: 2, after: 1.6 });

  const figure = chartFigure(chart, { x: x + pad, width: inner, palette, measure: text.figure, size: SIZE.chart, maxLabelLines: labelLines, comments, plot: 16, points: false });
  for (const item of figure.items) items.push(fromFigure({ ...item, y: item.y + cursor, ...(item.y2 === undefined ? {} : { y2: item.y2 + cursor }) }));
  cursor += figure.h;
  if (chart.caption) { cursor += 0.8; lines(chart.caption, SIZE.small, soft, { max: 3 }); }
  if (chart.removedLine) { cursor += 0.8; lines(chart.removedLine, SIZE.small, soft, { max: 3 }); }
  return { items, height: cursor + pad - y };
}

/**
 * Places the pack on pages: [{ kind: 'summary' | 'activity', items, notes }]. `palette` is the Results palette (lib/results-palette.js) and
 * `measure` the embedded fonts' (lib/report-fonts.js createMeasure).
 */
export function layoutReport(report, logo = null, palette = null, measure = null) {
  if (!palette) throw new Error('layoutReport needs the Results palette (lib/results-palette.js).');
  if (!measure) throw new Error('layoutReport needs the measure of the embedded fonts (lib/report-fonts.js createMeasure).');
  const text = textMeasure(measure);
  const { width: W, height: H, margin: M } = PACK_PAGE;
  const bottom = PACK_BODY_BOTTOM;
  const ink = bare(palette.text);
  const soft = bare(palette.textSecondary);
  const green = bare(palette.brand);
  const pages = [];
  const session = [report.clientName, report.sessionDate].filter(Boolean).join(' · ');
  const iPadsLine = answersFrom({ answers: report.answers, visits: report.iPads });

  // ---- Page 1: the summary.
  const summaryPage = (first) => {
    const page = { kind: 'summary', items: [], notes: '' };
    pages.push(page);
    if (first) {
      const bandH = 40;
      const onBand = readableOn(report.primary);
      page.items.push(rect(0, 0, W, bandH, { fill: report.primary, role: 'band' }), rect(0, bandH, W, 1.4, { fill: green }));
      let x = M;
      if (logo) {
        // On a white plate, so a logo drawn for a light page still shows on any brand color.
        const plate = { w: 54, h: 26 };
        const top = (bandH - plate.h) / 2;
        page.items.push(rect(x, top, plate.w, plate.h, { fill: 'FFFFFF', radius: 2 }));
        const scale = Math.min((plate.w - 6) / logo.width, (plate.h - 6) / logo.height);
        const [w, h] = [logo.width * scale, logo.height * scale];
        page.items.push({ kind: 'image', x: x + (plate.w - w) / 2, y: top + (plate.h - h) / 2, w, h, data: logo.data });
        x += plate.w + 8;
      }
      const room = W - M - x;
      page.items.push(label(x, 6, room, lineHeight(SIZE.title), text.wrap('Session results', room, SIZE.title, { bold: true, maxLines: 1 })[0], SIZE.title, onBand, { bold: true, role: 'page-title' }));
      text.wrap([session, iPadsLine].filter(Boolean).join(' · '), room, SIZE.details, { maxLines: 2 }).forEach((line, at) => page.items.push(label(x, 20 + at * lineHeight(SIZE.details), room, lineHeight(SIZE.details), line, SIZE.details, onBand, { role: 'details' })));
      page.top = bandH + 7;
    } else {
      page.items.push(rect(0, 0, W, 4, { fill: report.primary, role: 'band' }));
      page.top = 10;
    }
    const heading = first ? 'What each activity found' : 'What each activity found (continued)';
    page.items.push(label(M, page.top, W - M * 2, lineHeight(SIZE.heading), heading, SIZE.heading, ink, { bold: true, role: 'heading' }));
    page.top += lineHeight(SIZE.heading) + 3;
    return page;
  };
  let page = summaryPage(true);
  const notes = [`Session results${report.clientName ? ` for ${report.clientName}` : ''}${report.sessionDate ? `, ${report.sessionDate}` : ''}. ${iPadsLine}; a visit that answered nothing is not counted.`];
  if (report.summary.activities.length === 0) {
    page.items.push(label(M, page.top, W - M * 2, lineHeight(SIZE.takeaway), 'No live activities in this session yet.', SIZE.takeaway, soft));
  }
  const titleWidth = 74;
  for (const activity of report.summary.activities) {
    const title = text.wrap(activity.title, titleWidth - 4, SIZE.takeaway, { bold: true, maxLines: 2 });
    const said = text.wrap(activity.takeaway, W - M * 2 - titleWidth - 4, SIZE.takeaway);
    const h = Math.max(title.length, said.length) * lineHeight(SIZE.takeaway) + 4;
    if (page.top + h > bottom) { page.notes = notes.join(' '); notes.length = 0; page = summaryPage(false); }
    page.items.push(rect(M, page.top + 0.6, 1.2, h - 5, { fill: green }));
    title.forEach((line, at) => page.items.push(label(M + 4, page.top + at * lineHeight(SIZE.takeaway), titleWidth - 4, lineHeight(SIZE.takeaway), line, SIZE.takeaway, ink, { bold: true, role: 'activity-title' })));
    said.forEach((line, at) => page.items.push(label(M + titleWidth + 4, page.top + at * lineHeight(SIZE.takeaway), W - M * 2 - titleWidth - 4, lineHeight(SIZE.takeaway), line, SIZE.takeaway, ink, { role: 'takeaway' })));
    notes.push(`${activity.title}: ${activity.takeaway}`);
    page.top += h;
  }
  page.notes = notes.join(' ');

  // ---- Each live activity: its title and takeaway, then its cards, two across, four a page at most.
  const gap = 8;
  const cardWidth = (W - M * 2 - gap) / 2;
  report.summary.activities.forEach((activity, index) => {
    const own = report.questions.filter((question) => question.activityId === report.activities[index].id);
    const start = (first) => {
      const sheet = { kind: 'activity', activity: activity.title, items: [rect(0, 0, W, 4, { fill: report.primary, role: 'band' })], notes: [] };
      pages.push(sheet);
      let top = 8;
      // A long title is cut before " (continued)", never the word itself.
      const more = first ? '' : ' (continued)';
      const title = `${text.wrap(activity.title, W - M * 2 - text.width(more, SIZE.title, true), SIZE.title, { bold: true, maxLines: 1 })[0]}${more}`;
      sheet.items.push(label(M, top, W - M * 2, lineHeight(SIZE.title), title, SIZE.title, ink, { bold: true, role: 'page-title' }));
      top += lineHeight(SIZE.title) + 1;
      if (first) {
        for (const line of text.wrap(activity.takeaway, W - M * 2, SIZE.takeaway, { maxLines: 4 })) {
          sheet.items.push(label(M, top, W - M * 2, lineHeight(SIZE.takeaway), line, SIZE.takeaway, ink, { role: 'takeaway' }));
          top += lineHeight(SIZE.takeaway);
        }
        // Its numbers, as the leader report's band has them: how many questions, and how many answers to them.
        const count = (n, one) => `${n.toLocaleString('en-US')} ${n === 1 ? one : `${one}s`}`;
        sheet.items.push(label(M, top + 0.6, W - M * 2, lineHeight(SIZE.details), `${count(own.length, 'question')} · ${count(activity.answers, 'answer')}`, SIZE.details, soft, { role: 'details' }));
        top += lineHeight(SIZE.details) + 0.6;
      }
      sheet.items.push(rect(M, top + 1.5, 30, 1.2, { fill: green }));
      sheet.top = top + 6;
      sheet.cards = 0;
      sheet.fresh = !first;
      return sheet;
    };
    let sheet = start(true);
    const room = () => bottom - sheet.top;
    if (own.length === 0) {
      sheet.items.push(label(M, sheet.top, W - M * 2, lineHeight(SIZE.takeaway), 'This activity has no questions.', SIZE.takeaway, soft));
      sheet.notes.push(`${activity.title} has no questions.`);
    }
    for (let at = 0; at < own.length; at += 2) {
      const row = own.slice(at, at + 2);
      const cardX = (column) => M + column * (cardWidth + gap);
      // Laid out with two-line labels; a card too tall for an empty page is laid out again with one line a label and one comment.
      const empty = bottom - (8 + lineHeight(SIZE.title) + 1 + 6);
      const measured = row.map((question, column) => {
        const card = layoutCard(question, palette, text, cardX(column), 0, cardWidth);
        return card.height <= empty ? card : layoutCard(question, palette, text, cardX(column), 0, cardWidth, { compact: true });
      });
      const rowHeight = Math.max(...measured.map((card) => card.height));
      // A row that does not fit what is left goes to a fresh page; on a fresh page that holds nothing yet it is placed as it is.
      if (!(sheet.fresh && sheet.cards === 0) && (sheet.cards + row.length > CARDS_A_PAGE || rowHeight > room())) sheet = start(false);
      row.forEach((question, column) => {
        const top = sheet.top;
        // A white card with Deloitte Green along its top edge, as on the screen: the accent, never a bar.
        sheet.items.push(rect(cardX(column), top, cardWidth, rowHeight, { fill: bare(palette.surface), stroke: bare(palette.grid), radius: 2, card: question.chart.id, role: 'card', of: question.chart.id }));
        sheet.items.push(rect(cardX(column), top, cardWidth, 1.2, { fill: green, card: question.chart.id }));
        sheet.items.push(...measured[column].items.map((item) => ({ ...item, y: item.y + top, ...(item.y2 === undefined ? {} : { y2: item.y2 + top }), card: question.chart.id })));
        const { chart } = question;
        sheet.notes.push([`Question ${question.number}: ${chart.prompt}`, chart.headline, `${chart.answered} answered.`, chart.gradedLine, fewAnswersLine(chart.answered), countingRule(chart)].filter(Boolean).join(' '));
      });
      sheet.cards += row.length;
      sheet.top += rowHeight + 5;
    }
  });

  // ---- Footers: the session (and the activity), and "Page N of M".
  pages.forEach((sheet, index) => {
    if (Array.isArray(sheet.notes)) sheet.notes = sheet.notes.join('\n\n');
    const where = [session, sheet.activity].filter(Boolean).join(' · ');
    const y = H - M - 1;
    sheet.items.push(rect(M, y - 2.4, W - M * 2, 0.25, { fill: bare(palette.grid), role: 'footer-rule' }));
    if (where) sheet.items.push(label(M, y, W - M * 2 - 48, lineHeight(SIZE.small), text.wrap(where, W - M * 2 - 48, SIZE.small, { maxLines: 1 })[0], SIZE.small, soft, { role: 'footer' }));
    sheet.items.push(label(W - M - 44, y, 44, lineHeight(SIZE.small), `Page ${index + 1} of ${pages.length}`, SIZE.small, soft, { align: 'right', role: 'footer' }));
    delete sheet.top;
    delete sheet.cards;
    delete sheet.fresh;
  });
  return pages;
}

/** A tick as two strokes, as the leader report draws it (lib/leader-report-pdf.js): [[x1, y1, x2, y2], ...] and the stroke's width. */
function tickStrokes({ x, y, size }) {
  const start = [x + size * 0.08, y + size * 0.55];
  const bend = [start[0] + size * 0.3, start[1] + size * 0.3];
  const end = [bend[0] + size * 0.55, bend[1] - size * 0.68];
  return { strokes: [[...start, ...bend], [...bend, ...end]], width: size * 0.17 };
}

// ---- Logo
// jsPDF and PowerPoint take raster images, and a logo is often an SVG. Drawing it onto a canvas
// gives a PNG either way. A logo on another site can taint the canvas, or fail to load; the
// report then goes out with the client's name and no logo, rather than not at all.

async function loadLogo(url) {
  if (!url) return null;
  try {
    const image = new Image();
    image.src = embeddedAssetUrl(url);
    await image.decode();
    // An SVG with only a viewBox may report no size, and its ratio isn't recoverable then.
    const [w, h] = [image.naturalWidth, image.naturalHeight];
    if (!w || !h) return null;
    const scale = Math.min(4, 800 / Math.max(w, h)); // sharp when printed, but not huge
    const canvas = Object.assign(document.createElement('canvas'), {
      width: Math.round(w * scale), height: Math.round(h * scale),
    });
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL('image/png'), width: w, height: h };
  } catch (error) {
    console.warn('export: could not use the client logo, leaving it out', error);
    return null;
  }
}

// ---- Loading the libraries
// Browser bundles, loaded when an export is first used so the Master screen doesn't pay for
// them. The admin page imports the two libraries itself and sets CEC_EMBEDDED_EXPORTS (LiveDisplay.svelte),
// so loadScript() returns at once; the vendor folder its paths name was the legacy pages' and is gone.

const scripts = new Map();

function loadScript(path) {
  if (globalThis.CEC_EMBEDDED_EXPORTS) return Promise.resolve();
  if (!scripts.has(path)) {
    scripts.set(path, new Promise((resolve, reject) => {
      const publicPath = path.replace(/^\.\.\//, '');
      const script = Object.assign(document.createElement('script'), { src: new URL(publicPath, document.baseURI).href });
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        scripts.delete(path); // so the next click tries again
        reject(new Error(`Could not load ${path}. Is the server reachable?`));
      };
      document.head.append(script);
    }));
  }
  return scripts.get(path);
}

// ---- PDF

/**
 * jsPDF's standard fonts only cover Latin-1 and a few punctuation marks: emoji and other scripts are dropped, not printed as garbage. (Since
 * Phase 13 the pack embeds Open Sans, whose measure prints one replacement mark for what it lacks; this is kept for the files that still use them.)
 */
export const pdfSafe = (text) => text.replace(/[^\x20-\x7e\xa0-\xff‘’“”–—…•€™]/g, '').replace(/ {2,}/g, ' ');

/**
 * The PDF's bytes: each 16:9 page in the middle of an A4 landscape sheet, its words in the embedded Open Sans (`fonts`, lib/report-fonts.js
 * loadReportFonts), with the document's title and language. `jsPDF` is handed in (the admin page's own copy; a node test passes jsPDF's node build).
 * @returns {ArrayBuffer}
 */
export function pdfBytes(pages, report, { jsPDF, fonts, producer = 'Pursuits CEC' }) {
  if (!fonts) throw new Error('pdfBytes needs the embedded fonts (lib/report-fonts.js loadReportFonts).');
  const { clean } = createMeasure(fonts);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [SHEET.width, SHEET.height], compress: true, putOnlyUsedFonts: true });
  doc.setProperties({ title: `${report.clientName || 'Session'} session results`, creator: producer });
  doc.setLanguage('en-US');
  for (const face of [fonts.regular, fonts.bold]) {
    doc.addFileToVFS(face.file, binaryString(face.bytes));
    doc.addFont(face.file, face.name, 'normal');
  }
  doc.setLineWidth(0.25);
  const rgb = (hex) => channels(hex);
  const dy = SHEET_OFFSET;

  pages.forEach((page, index) => {
    if (index > 0) doc.addPage([SHEET.width, SHEET.height], 'landscape');
    for (const item of page.items) {
      if (item.kind === 'rect') {
        const style = item.fill && item.stroke ? 'FD' : item.fill ? 'F' : 'S';
        if (item.fill) doc.setFillColor(...rgb(item.fill));
        if (item.stroke) { doc.setDrawColor(...rgb(item.stroke)); doc.setLineWidth(0.25); }
        if (item.radius) doc.roundedRect(item.x, item.y + dy, item.w, item.h, item.radius, item.radius, style);
        else doc.rect(item.x, item.y + dy, item.w, item.h, style);
      } else if (item.kind === 'line') {
        doc.setDrawColor(...rgb(item.color));
        doc.setLineWidth(item.width ?? 0.25);
        doc.line(item.x, item.y + dy, item.x2, item.y2 + dy);
      } else if (item.kind === 'tick') {
        const { strokes, width } = tickStrokes({ ...item, y: item.y + dy });
        doc.setDrawColor(...rgb(item.color));
        doc.setLineWidth(width);
        doc.setLineCap('round');
        for (const [x1, y1, x2, y2] of strokes) doc.line(x1, y1, x2, y2);
        doc.setLineCap('butt');
      } else if (item.kind === 'image') {
        doc.addImage(item.data, 'PNG', item.x, item.y + dy, item.w, item.h, undefined, 'FAST'); // compressed, or the logo alone is over a megabyte
      } else {
        const words = clean(item.text);
        if (!words.trim()) continue;
        doc.setFont((item.bold ? fonts.bold : fonts.regular).name, 'normal');
        doc.setFontSize(item.size);
        doc.setTextColor(...rgb(item.color));
        const align = item.align ?? 'left';
        const at = align === 'right' ? item.x + item.w : align === 'center' ? item.x + item.w / 2 : item.x;
        doc.text(words, at, item.y + dy + item.h / 2, { align, baseline: 'middle' });
      }
    }
  });
  return doc.output('arraybuffer');
}

/**
 * Exports the session's summary pack as a PDF. Resolves to the file name.
 * `brand.appName`, when given, is written as the PDF's creator instead of the original product name; `brand.palette` is the
 * Results palette (lib/results-palette-source.ts RESULTS_PALETTE).
 */
export async function downloadPdf(results, brand = {}) {
  const [, logo, fonts] = await Promise.all([loadScript('../vendor/jspdf/dist/jspdf.umd.min.js'), loadLogo(brand.logoUrl), loadReportFonts()]);
  const report = buildReport(results, brand);
  const fileName = exportFileName(results, 'pdf');
  const pages = layoutReport(report, logo, brand.palette, createMeasure(fonts));
  saveBlob(new Blob([pdfBytes(pages, report, { jsPDF: window.jspdf.jsPDF, fonts, producer: brand.appName })], { type: 'application/pdf' }), fileName);
  return fileName;
}

// ---- PPT

const inches = (mm) => mm / 25.4;

/**
 * The PowerPoint file: a 16:9 slide for each page, of native text boxes and shapes (a logo is the one picture), with each page's speaker notes.
 * A Blob, or with `outputType: 'nodebuffer'` (a node test) a Buffer. `PptxGenJS` is handed in, as `jsPDF` is.
 */
export async function pptxFile(pages, report, { PptxGenJS, producer = 'Pursuits CEC', outputType = 'blob' }) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'PACK_16x9', width: inches(PACK_PAGE.width), height: inches(PACK_PAGE.height) });
  pptx.layout = 'PACK_16x9';
  pptx.title = `${report.clientName || 'Session'} session results`;
  pptx.company = producer;

  for (const page of pages) {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    for (const item of page.items) {
      const box = { x: inches(item.x), y: inches(item.y), w: inches(item.w), h: inches(item.h) };
      if (item.kind === 'rect') {
        slide.addShape(item.radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
          ...box,
          ...(item.radius && { rectRadius: inches(item.radius) }),
          fill: item.fill ? { color: item.fill } : { type: 'none' },
          line: item.stroke ? { color: item.stroke, width: 0.75 } : { type: 'none' },
        });
      } else if (item.kind === 'line' || item.kind === 'tick') {
        const { strokes, width } = item.kind === 'tick' ? tickStrokes(item) : { strokes: [[item.x, item.y, item.x2, item.y2]], width: item.width ?? 0.25 };
        for (const [x1, y1, x2, y2] of strokes) {
          slide.addShape(pptx.ShapeType.line, {
            x: inches(Math.min(x1, x2)), y: inches(Math.min(y1, y2)), w: inches(Math.abs(x2 - x1)), h: inches(Math.abs(y2 - y1)),
            flipV: (x2 - x1) * (y2 - y1) < 0,
            line: { color: item.color, width: (width * 72) / 25.4 },
          });
        }
      } else if (item.kind === 'image') {
        slide.addImage({ data: item.data, ...box });
      } else {
        slide.addText(item.text, {
          ...box, fontFace: FONT.pptx, fontSize: item.size, bold: item.bold,
          color: item.color, align: item.align ?? 'left', valign: 'middle', margin: 0, wrap: false,
        });
      }
    }
    if (page.notes) slide.addNotes(page.notes);
  }
  return pptx.write({ outputType });
}

/** Exports the same summary pack as PowerPoint slides (company = `brand.appName` when given). Resolves to the file name. */
export async function downloadPptx(results, brand = {}) {
  const [, logo, fonts] = await Promise.all([loadScript('../vendor/pptxgenjs/dist/pptxgen.bundle.js'), loadLogo(brand.logoUrl), loadReportFonts()]);
  const report = buildReport(results, brand);
  const fileName = exportFileName(results, 'pptx');
  saveBlob(await pptxFile(layoutReport(report, logo, brand.palette, createMeasure(fonts)), report, { PptxGenJS: window.PptxGenJS, producer: brand.appName }), fileName);
  return fileName;
}
