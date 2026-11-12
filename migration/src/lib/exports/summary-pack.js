// The summary pack's model and layout (Phase 13): buildReport() turns a session's results into a plain model, layoutReport() places it on
// 16:9 pages as rectangles, lines, ticks, words and pictures measured in the embedded Open Sans. Moved out of resultsExport.js unchanged
// (Prompt 44), which keeps the two writers (PDF, PowerPoint) and still passes these names on. No library and no request here.

import { MULTI_CAPTION, RANKING_CAPTION, answerCounts, answersFrom, chartOf, fewAnswersLine } from '../results/results-chart-model.js';
import { confidenceLine } from '../results/confidence-shift.js';
import { chartFigure } from '../results/results-chart-figure.js';
import { summarizeSession } from '../results/export-summary.js';
import { LOOK, packPalette } from './report-look.js';
import { wallUnreadableNotice } from '../results/unreadable.js';

/** The sections a session is showing (a section an admin hasn't enabled has no results to export). */
export const liveSections = (results) => results.sections.filter((section) => section.enabled === true);


// ---- The summary pack (PDF and PPT) ------------------------------------------------------
// Phase 13 (EXPORT-DESIGN.md, 3.2): the executive summary of the session's live results, not a miniature of the screen. Page 1 is the summary
// (the title, the client, the date, "N answers from M iPads", and one takeaway per live activity from lib/results/export-summary.js, nothing else); then
// each live activity has a page of its own (a second when it has more than four questions): its title, its takeaway, and a card for each
// question with the chart the Live display shows (lib/results/results-chart-model.js, drawn by lib/results/results-chart-figure.js in the colours of
// styles/results-tokens.css). Nobody is named: the charts are made with no names.
//
// buildReport() turns the aggregated results into a plain model, layoutReport() places it on 16:9 pages (297 x 167 mm) as rectangles, lines,
// ticks, text lines and images, measured in the embedded Open Sans (lib/exports/report-fonts.js), and the two writers only draw them: the PDF puts each
// page in the middle of an A4 landscape sheet, the PowerPoint makes it a 16:9 slide of native text and shapes, with speaker notes. So the two
// files can't drift apart, and the writers hold no layout logic. A slide must read when projected: no word under 12 pt, titles at 28 pt, the
// takeaway and each card's headline at 18 pt.

/** The pack's page: 16:9, as wide as A4 landscape. */
export const PACK_PAGE = Object.freeze({ width: 297, height: (297 * 9) / 16, margin: 12 });
/** The PDF's sheet: A4 landscape, the page in its middle. */
export const SHEET = Object.freeze({ width: 297, height: 210 });
export const SHEET_OFFSET = (SHEET.height - PACK_PAGE.height) / 2;
const FOOTER = 9;
/** Where the body of a page ends: below it are the footer's rule and words, and nothing else. */
export const PACK_BODY_BOTTOM = PACK_PAGE.height - PACK_PAGE.margin - FOOTER;
const SIZE = Object.freeze({ title: 28, figure: 36, takeaway: 18, headline: 18, heading: 18, question: 14, details: 14, small: 12, chart: 13.7 });
export const FONT = { pptx: 'Open Sans' };
const PT_MM = 25.4 / 72;
const lineHeight = (size) => size * PT_MM * 1.25;
const CARDS_A_PAGE = 4;

/** The model both files are drawn from: each live activity with its charts and takeaway, with nobody's name in it. */
export function buildReport(results, brand = {}) {
  const sections = liveSections(results);
  const activities = sections.map((section) => ({
    id: String(section.id), title: section.title || 'Untitled activity', description: section.description ?? '',
    charts: section.questions.map((question) => chartOf(question, { names: null, guests: results.tracks?.length ?? null })),
  }));
  let number = 0;
  const questions = activities.flatMap((activity) => activity.charts.map((chart) => ({ number: number += 1, section: activity.title, activityId: activity.id, respondents: chart.answered, chart })));
  // "N answers from M iPads" as the Live display says it (Phase 11b): the iPads that answered, not every visit that began.
  const counts = answerCounts(sections.flatMap((section) => section.questions));
  const date = results.session.date ? new Date(`${results.session.date}T12:00:00`) : null;
  return {
    clientName: brand.name ?? '',
    // (Prompt 34) Light or Dark, as the Live display's Download row chose; Light when nothing chose.
    look: brand.look === 'dark' ? 'dark' : 'light',
    logoUrl: brand.logoUrl ?? null,
    primary: hex6(brand.primaryColor, '0F172A'),
    secondary: hex6(brand.secondaryColor, '64748B'),
    sessionDate: date && !Number.isNaN(date.getTime())
      ? date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : '',
    sessionDay: /^\d{4}-\d{2}-\d{2}$/.test(String(results.session.date ?? '')) ? results.session.date : '',
    iPads: counts.visits,
    answers: counts.answers,
    // Answer items that could not be read (Phase 9b, DI-6): not counted, and said on the summary in the wall's words, with no name.
    unreadable: (results.unreadable ?? []).length,
    activities,
    questions,
    summary: summarizeSession(activities),
    // (Phase 20) a session that lists the client's confidence check: its one line, from confidence-shift.js; '' otherwise, and nothing is drawn.
    confidence: results.confidenceCheck ? confidenceLine(results.confidenceCheck) : '',
  };
}

// ---- Colors
// Prompt 34: the pack wears the app's look, Light (white, prints well) or Dark (black, as the wall), and no client colour (the client's logo keeps
// its place on the cover). Every colour is lib/exports/report-look.js's, the admin tokens written as hex once. The charts take the Results palette
// (lib/results/results-palette.js) with the brief's colours put in: the top choice, the rest, the correct answer and a scale's ramp.

/** "#0060A9" / "#06a" / "0060a9" as "0060A9"; `fallback` when it isn't a color. */
function hex6(value, fallback) {
  let hex = String(value ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3,4}$/i.test(hex)) hex = [...hex.slice(0, 3)].map((c) => c + c).join('');
  return /^[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(hex) ? hex.slice(0, 6).toUpperCase() : fallback;
}

export const channels = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** The page's own colours in a look, as the writers take them ("046A38"): its ground, words, titles, figures, frames and bands. */
function pageLook(look) {
  const h = (key) => LOOK[key].slice(1);
  return look === 'dark'
    ? { ground: h('black'), ink: h('onDeep'), soft: h('onDeep'), title: h('onDeep'), figure: h('lime'), frame: h('lime'), band: h('text'), rule: h('textMuted'), lime: h('lime'), plate: h('page') }
    : { ground: h('page'), ink: h('text'), soft: h('textMuted'), title: h('deep'), figure: h('deep'), frame: h('cardLine'), band: h('greenWash'), rule: h('cardLine'), lime: h('lime'), plate: h('page') };
}

/** A palette colour ("#0076A8") as the writers take it ("0076A8"). */
const bare = (hex) => String(hex).replace(/^#/, '').toUpperCase();

// ---- Text measuring
// In the embedded Open Sans's own widths (lib/exports/report-fonts.js createMeasure): the PDF draws that font, and PowerPoint names it. A machine without
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
//             { kind: 'mark', x, y, size, shape, color }                    (a band's mark: 'up', 'dot' or 'down'; results-chart-figure.js markShape)
//             { kind: 'text', x, y, w, h, text, size, bold?, color, align? }  (one line, centred in h)
//             { kind: 'image', x, y, w, h, data }
// An item inside a question's card carries `card: <question id>`; the card's frame is `role: 'card'`. A page is { kind, items, notes }.

const rect = (x, y, w, h, style = {}) => ({ kind: 'rect', x, y, w, h, ...style });
const label = (x, y, w, h, text, size, color, style = {}) => ({ kind: 'text', x, y, w, h, text, size, color, ...style });

/** What a speaker says about how a question was counted, in a sentence. */
function countingRule(chart) {
  const shares = 'Each share is of the people who answered this question, rounded so the shares add up to 100%.';
  if (chart.kind === 'matrix') return 'Opportunity is worked out from each person\'s first ratings, with each criterion\'s direction; nobody is named.';
  if (chart.kind === 'text') return 'A word is counted once for each comment it is in; nobody is named.';
  if (chart.kind === 'multi') return MULTI_CAPTION;
  if (chart.kind === 'ranking') return `Support scores come from where each person ranked each answer: ${RANKING_CAPTION}`;
  if (chart.kind === 'scale') return `${shares} The average is of the steps people chose.`;
  return chart.graded ? `For a question with a correct answer, the bars count each person’s first answer. ${shares}` : shares;
}

/** The figure's neutral items as this file's primitives: a text line keeps its box, centred in it. */
function fromFigure(item) {
  if (item.kind === 'text' || item.kind === 'line' || item.kind === 'tick' || item.kind === 'mark') return { ...item, color: bare(item.color) };
  return { ...item, ...(item.fill && { fill: bare(item.fill) }), ...(item.stroke && { stroke: bare(item.stroke) }) };
}

/**
 * One question's card at (x, y), `w` wide: the headline (the answer first), the question, how many answered (and "Only N answers." under five),
 * "N of M got it right first time", the chart and its caption. Returns { items, height }.
 */
function layoutCard(question, palette, text, x, y, w, { compact = false, matrixRows = 10 } = {}) {
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
  lines(chart.headline, SIZE.headline, ink, { bold: true, max: headlineLines, role: 'headline' });
  // (Prompt 34) The band that names the card runs from its top to just under the headline.
  const band = cursor + 1.2 - y;
  cursor += 2.4;
  lines(chart.prompt, SIZE.question, ink, { max: promptLines, after: 0.4, role: 'prompt' });
  // How many answered: "Only four answers." under five, so a share of a few people never reads like one of many.
  lines(fewAnswersLine(chart.answered) || `${chart.answered.toLocaleString('en-US')} answered.`, SIZE.small, soft, { max: 1, after: chart.gradedLine ? 0 : 1.6 });
  if (chart.gradedLine) lines(chart.gradedLine, SIZE.small, soft, { bold: true, max: 2, after: 1.6 });

  const figure = chartFigure(chart, { x: x + pad, width: inner, palette, measure: text.figure, size: SIZE.chart, maxLabelLines: labelLines, comments, matrixRows, plot: 16, points: false });
  for (const item of figure.items) items.push(fromFigure({ ...item, y: item.y + cursor, ...(item.y2 === undefined ? {} : { y2: item.y2 + cursor }) }));
  cursor += figure.h;
  if (chart.caption) { cursor += 0.8; lines(chart.caption, SIZE.small, soft, { max: 3 }); }
  if (chart.removedLine) { cursor += 0.8; lines(chart.removedLine, SIZE.small, soft, { max: 3 }); }
  return { items, height: cursor + pad - y, band };
}

/**
 * Places the pack on pages: [{ kind: 'summary' | 'activity', background, items, notes }]. `palette` is the Results palette (lib/results/results-palette.js),
 * `measure` the embedded fonts' (lib/exports/report-fonts.js createMeasure) and `look` Light or Dark (Prompt 34; the report's own, else Light).
 */
export function layoutReport(report, logo = null, palette = null, measure = null, { look = report.look ?? 'light' } = {}) {
  if (!palette) throw new Error('layoutReport needs the Results palette (lib/results-palette.js).');
  if (!measure) throw new Error('layoutReport needs the measure of the embedded fonts (lib/report-fonts.js createMeasure).');
  const text = textMeasure(measure);
  const { width: W, height: H, margin: M } = PACK_PAGE;
  const bottom = PACK_BODY_BOTTOM;
  const ui = pageLook(look);
  const charts = packPalette(look, palette);
  const { ink, soft } = ui;
  const pages = [];
  const session = [report.clientName, report.sessionDate].filter(Boolean).join(' · ');
  const iPadsLine = answersFrom({ answers: report.answers, visits: report.iPads });
  const activityCount = report.summary.activities.length;

  /**
   * Every page's head (Prompt 34): a small upper-case label, then the title in 28 pt with a lime bar at its left; `room` is the title's width.
   * Returns where the page's body starts.
   */
  const head = (page, tag, title, room = W - M * 2) => {
    page.items.push(label(M, 6, room, lineHeight(SIZE.small), tag.toUpperCase(), SIZE.small, soft, { bold: true, role: 'section-label' }));
    const top = 6 + lineHeight(SIZE.small) + 1;
    page.items.push(rect(M, top + 1.5, 1.8, lineHeight(SIZE.title) - 3, { fill: ui.lime, role: 'title-bar' }));
    page.items.push(label(M + 5, top, room - 5, lineHeight(SIZE.title), text.wrap(title, room - 5, SIZE.title, { bold: true, maxLines: 1 })[0], SIZE.title, ui.title, { bold: true, role: 'page-title' }));
    return top + lineHeight(SIZE.title) + 1;
  };
  const newPage = (kind, extra = {}) => {
    const page = { kind, background: ui.ground, items: [], notes: '', ...extra };
    pages.push(page);
    return page;
  };

  // ---- Page 1: the summary. The session's figures large, each with its caption, then one takeaway per activity.
  const summaryPage = (first) => {
    const page = newPage('summary');
    let room = W - M * 2;
    if (first && logo) {
      // On a white plate at the right, so a logo drawn for a light page shows on the dark one too.
      const plate = { w: 54, h: 24 };
      const x = W - M - plate.w;
      page.items.push(rect(x, 6, plate.w, plate.h, { fill: ui.plate, radius: 2 }));
      const scale = Math.min((plate.w - 6) / logo.width, (plate.h - 6) / logo.height);
      const [w, h] = [logo.width * scale, logo.height * scale];
      page.items.push({ kind: 'image', x: x + (plate.w - w) / 2, y: 6 + (plate.h - h) / 2, w, h, data: logo.data });
      room -= plate.w + 6;
    }
    page.top = head(page, 'Summary', 'Session results', room);
    if (first) {
      text.wrap([session, iPadsLine].filter(Boolean).join(' · '), room, SIZE.details, { maxLines: 2 }).forEach((line) => {
        page.items.push(label(M, page.top, room, lineHeight(SIZE.details), line, SIZE.details, soft, { role: 'details' }));
        page.top += lineHeight(SIZE.details);
      });
      // Number, caption, number, caption: in an outlined box, thin rules between them.
      const figures = [[report.answers, 'Answer', 'Answers'], [report.iPads, 'iPad', 'iPads'], [activityCount, 'Activity', 'Activities']];
      const cell = 46;
      const boxH = lineHeight(SIZE.figure) + lineHeight(SIZE.small) + 4;
      const y = page.top + 3;
      page.items.push(rect(M, y, cell * figures.length, boxH, { stroke: ui.frame, radius: 2, role: 'figures-box' }));
      figures.forEach(([n, one, many], at) => {
        const caption = n === 1 ? one : many;
        const x = M + at * cell;
        if (at > 0) page.items.push(rect(x, y + 3, 0.25, boxH - 6, { fill: ui.rule }));
        page.items.push(label(x + 4, y + 1.5, cell - 8, lineHeight(SIZE.figure), n.toLocaleString('en-US'), SIZE.figure, ui.figure, { bold: true, role: 'figure' }));
        page.items.push(label(x + 4, y + 1.5 + lineHeight(SIZE.figure), cell - 8, lineHeight(SIZE.small), caption, SIZE.small, soft, { role: 'caption' }));
      });
      page.top = y + boxH + 5;
      if (report.unreadable > 0) {
        for (const line of text.wrap(wallUnreadableNotice(report.unreadable), W - M * 2, SIZE.details, { bold: true })) {
          page.items.push(label(M, page.top, W - M * 2, lineHeight(SIZE.details), line, SIZE.details, ink, { bold: true, role: 'notice' }));
          page.top += lineHeight(SIZE.details);
        }
        page.top += 3;
      }
    }
    const heading = first ? 'What each activity found' : 'What each activity found (continued)';
    page.items.push(label(M, page.top, W - M * 2, lineHeight(SIZE.heading), heading, SIZE.heading, ink, { bold: true, role: 'heading' }));
    page.top += lineHeight(SIZE.heading) + 3;
    return page;
  };
  let page = summaryPage(true);
  const notes = [`Session results${report.clientName ? ` for ${report.clientName}` : ''}${report.sessionDate ? `, ${report.sessionDate}` : ''}. ${iPadsLine}; a visit that answered nothing is not counted.${report.unreadable > 0 ? ` ${wallUnreadableNotice(report.unreadable)}` : ''}`];
  if (activityCount === 0) {
    page.items.push(label(M, page.top, W - M * 2, lineHeight(SIZE.takeaway), 'No live activities in this session yet.', SIZE.takeaway, soft));
  }
  const titleWidth = 74;
  for (const activity of report.summary.activities) {
    const title = text.wrap(activity.title, titleWidth - 4, SIZE.takeaway, { bold: true, maxLines: 2 });
    const said = text.wrap(activity.takeaway, W - M * 2 - titleWidth - 4, SIZE.takeaway);
    const h = Math.max(title.length, said.length) * lineHeight(SIZE.takeaway) + 4;
    if (page.top + h > bottom) { page.notes = notes.join(' '); notes.length = 0; page = summaryPage(false); }
    page.items.push(rect(M, page.top + 0.6, 1.2, h - 5, { fill: ui.lime }));
    title.forEach((line, at) => page.items.push(label(M + 4, page.top + at * lineHeight(SIZE.takeaway), titleWidth - 4, lineHeight(SIZE.takeaway), line, SIZE.takeaway, ink, { bold: true, role: 'activity-title' })));
    said.forEach((line, at) => page.items.push(label(M + titleWidth + 4, page.top + at * lineHeight(SIZE.takeaway), W - M * 2 - titleWidth - 4, lineHeight(SIZE.takeaway), line, SIZE.takeaway, ink, { role: 'takeaway' })));
    notes.push(`${activity.title}: ${activity.takeaway}`);
    page.top += h;
  }
  if (report.confidence) {
    const said = text.wrap(report.confidence, W - M * 2, SIZE.takeaway);
    const h = said.length * lineHeight(SIZE.takeaway) + 4;
    if (page.top + h > bottom) { page.notes = notes.join(' '); notes.length = 0; page = summaryPage(false); }
    said.forEach((line, at) => page.items.push(label(M, page.top + at * lineHeight(SIZE.takeaway), W - M * 2, lineHeight(SIZE.takeaway), line, SIZE.takeaway, ink, { role: 'confidence' })));
    notes.push(report.confidence);
    page.top += h;
  }
  page.notes = notes.join(' ');

  // ---- Each live activity: its title and takeaway, then its cards, two across, four a page at most. (Prompt 34) An Art of the Possible heat map
  // has a card the width of the page to itself, with as many of its sub-processes as the page has room for, and "And N more" for the rest (the
  // leader report and the summary CSV have every one).
  const gap = 8;
  const cardWidth = (W - M * 2 - gap) / 2;
  const fullWidth = W - M * 2;
  const isMatrix = (question) => question?.chart.kind === 'matrix';
  const MATRIX_ROWS = 10;
  /** The heat map's card with the most rows (ten at most) that is no taller than `limit`, and how many rows it shows; null when not even one fits. */
  const fitMatrix = (question, limit) => {
    for (let rows = Math.max(1, Math.min(MATRIX_ROWS, question.chart.rows.length)); rows >= 1; rows -= 1) {
      const card = layoutCard(question, charts, text, M, 0, fullWidth, { matrixRows: rows });
      if (card.height <= limit) return { card, rows };
    }
    return null;
  };
  report.summary.activities.forEach((activity, index) => {
    const own = report.questions.filter((question) => question.activityId === report.activities[index].id);
    const start = (first) => {
      const sheet = newPage('activity', { activity: activity.title, notes: [] });
      // A long title is cut before " (continued)", never the word itself.
      const more = first ? '' : ' (continued)';
      const title = `${text.wrap(activity.title, W - M * 2 - 5 - text.width(more, SIZE.title, true), SIZE.title, { bold: true, maxLines: 1 })[0]}${more}`;
      let top = head(sheet, `Activity ${index + 1} of ${activityCount}`, title);
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
      sheet.top = top + 4;
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
    // The room under a fresh page's head (its label and title, nothing else).
    const empty = bottom - (6 + lineHeight(SIZE.small) + 1 + lineHeight(SIZE.title) + 1 + 4);
    for (let at = 0; at < own.length;) {
      // A heat map is a row of its own, and so is a card just before one.
      const row = isMatrix(own[at]) || isMatrix(own[at + 1]) ? [own[at]] : own.slice(at, at + 2);
      at += row.length;
      const width = isMatrix(row[0]) ? fullWidth : cardWidth;
      const cardX = (column) => M + column * (cardWidth + gap);
      let measured;
      if (isMatrix(row[0])) {
        // Here, under what is on the page already, when at least five of its rows (or all of them) fit; else at the top of a fresh page.
        const here = sheet.cards < CARDS_A_PAGE ? fitMatrix(row[0], room()) : null;
        if (!here || (here.rows < Math.min(5, row[0].chart.rows.length) && !(sheet.fresh && sheet.cards === 0))) {
          if (!(sheet.fresh && sheet.cards === 0)) sheet = start(false);
          measured = [(fitMatrix(row[0], room()) ?? { card: layoutCard(row[0], charts, text, M, 0, fullWidth, { compact: true, matrixRows: 1 }) }).card];
        } else measured = [here.card];
      } else {
        // Laid out with two-line labels; a card too tall for an empty page is laid out again with one line a label and one comment.
        measured = row.map((question, column) => {
          const card = layoutCard(question, charts, text, cardX(column), 0, cardWidth);
          return card.height <= empty ? card : layoutCard(question, charts, text, cardX(column), 0, cardWidth, { compact: true });
        });
      }
      const rowHeight = Math.max(...measured.map((card) => card.height));
      // A row that does not fit what is left goes to a fresh page; on a fresh page that holds nothing yet it is placed as it is.
      if (!(sheet.fresh && sheet.cards === 0) && (sheet.cards + row.length > CARDS_A_PAGE || rowHeight > room())) sheet = start(false);
      const bandH = Math.max(...measured.map((card) => card.band));
      row.forEach((question, column) => {
        const top = sheet.top;
        const id = question.chart.id;
        // (Prompt 34) An outlined card, and a band across its top in the pale green (Dark: the near-black) naming it with its headline.
        sheet.items.push(rect(cardX(column), top, width, rowHeight, { fill: ui.ground, stroke: ui.frame, radius: 3, card: id, role: 'card', of: id }));
        sheet.items.push(rect(cardX(column) + 0.8, top + 0.8, width - 1.6, measured[column].band - 0.8, { fill: ui.band, radius: 2, card: id, role: 'card-band' }));
        sheet.items.push(...measured[column].items.map((item) => ({ ...item, y: item.y + top, ...(item.y2 === undefined ? {} : { y2: item.y2 + top }), card: id })));
        const { chart } = question;
        sheet.notes.push([`Question ${question.number}: ${chart.prompt}`, chart.headline, `${chart.answered} answered.`, chart.gradedLine, fewAnswersLine(chart.answered), countingRule(chart)].filter(Boolean).join(' '));
      });
      sheet.cards += row.length;
      sheet.top += rowHeight + 5;
    }
  });

  // ---- Footers: where the figures come from (the session and how many people), the activity, and "Page N of M".
  const people = `${report.iPads.toLocaleString('en-US')} ${report.iPads === 1 ? 'person' : 'people'}`;
  pages.forEach((sheet, index) => {
    if (Array.isArray(sheet.notes)) sheet.notes = sheet.notes.join('\n\n');
    const where = [`Source: ${session || 'this session'}`, people, sheet.activity].filter(Boolean).join(' · ');
    const y = H - M - 1;
    sheet.items.push(rect(M, y - 2.4, W - M * 2, 0.25, { fill: ui.rule, role: 'footer-rule' }));
    sheet.items.push(label(M, y, W - M * 2 - 48, lineHeight(SIZE.small), text.wrap(where, W - M * 2 - 48, SIZE.small, { maxLines: 1 })[0], SIZE.small, soft, { role: 'footer' }));
    sheet.items.push(label(W - M - 44, y, 44, lineHeight(SIZE.small), `Page ${index + 1} of ${pages.length}`, SIZE.small, soft, { align: 'right', role: 'footer' }));
    delete sheet.top;
    delete sheet.cards;
    delete sheet.fresh;
  });
  return pages;
}

/** A tick as two strokes, as the leader report draws it (lib/exports/leader-report-pdf.js): [[x1, y1, x2, y2], ...] and the stroke's width. */
export function tickStrokes({ x, y, size }) {
  const start = [x + size * 0.08, y + size * 0.55];
  const bend = [start[0] + size * 0.3, start[1] + size * 0.3];
  const end = [bend[0] + size * 0.55, bend[1] - size * 0.68];
  return { strokes: [[...start, ...bend], [...bend, ...end]], width: size * 0.17 };
}
