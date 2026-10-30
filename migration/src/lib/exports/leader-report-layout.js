// The leader report, placed on A4 pages. Input: the report as data (lib/exports/leader-report.js) and a measure made from the embedded
// fonts (lib/exports/report-fonts.js). Output: pages of primitives in millimetres, which lib/exports/leader-report-pdf.js only draws:
//   { kind: 'text', x, y, w, text, size, bold?, color, align? }   ONE line; y is the baseline; w is the box it must stay inside
//   { kind: 'rect', x, y, w, h, fill?, stroke?, radius? }
//   { kind: 'line', x, y, x2, y2, color, width? }                width in mm (0.2 when it is not given)
//   { kind: 'tick' | 'cross', x, y, size, color }                the mark beside a right or a wrong answer (never colour alone)
//   { kind: 'image', x, y, w, h, data }                          the client's logo
//   { kind: 'wordmark', x, y, w }                                the Deloitte wordmark
// Everything is measured here, so a test can check that no line leaves its box or the page without opening a PDF.
//
// How it flows. Content is a list of ROWS (a height and its items); a block of rows stays on one page when it fits a page, and
// otherwise breaks between rows (a long comment is one row a line, so it carries on overleaf and is never cut). A row marked
// `glue` is never the last on a page.
//
// Each question's chart in "Results by activity" (Phase 11b) is the Live display's: lib/results/results-chart-figure.js draws the chart model's bars, split,
// scale or words in the Results palette (lib/results/results-palette.js, from styles/results-tokens.css), with its headline and "N of M got it right first
// time" above it.
//
// Phase 13 (EXPORT-DESIGN.md): page 1 is "At a glance" (four tiles, one takeaway per activity from lib/results/export-summary.js, the hardest and easiest
// question, how to read the report) and never needs a second page; each activity then starts a page of its own under a band with its title, its
// three numbers and its takeaway, and each question is one framed card that is never split. The client's colour is the cover's title band and
// nothing else; rules and marks are the Results palette's (Deloitte Green, brand guide p. 42), words its black and grey (p. 37).
//
// Plain JS with JSDoc and no DOM.

import { LIVE_FILES_NOTE, NO_ANSWERS, STRAY_TITLE, UNREADABLE_PERSON, answeredLine, scoreLine, wholePercent } from './leader-report.js';
import { MISSING } from './report-fonts.js';
import { chartFigure } from '../results/results-chart-figure.js';
import { fewAnswersLine, numberWords } from '../results/results-chart-model.js';

/** @typedef {import('./leader-report.js').LeaderReport} LeaderReport */
/** @typedef {{ kind: string, x: number, y: number, [key: string]: any }} Item */
/** @typedef {{ h: number, items: Item[], glue?: boolean }} RowBox */

export const PAGE = Object.freeze({ width: 210, height: 297, left: 16, right: 16, top: 16, bottom: 19 });
export const CONFIDENTIAL = 'Confidential – internal';
/** The session's status on the cover (page 1), in one line each; the full "Session: ..." line, with the time it ended, is on the last page. */
export const SESSION_ENDED = 'This session had ended when the report was made.';
export const SESSION_NOT_ENDED = 'This session had not ended when the report was made, so answers may still arrive.';
export const WORDMARK_RATIO = 53 / 283.46; // height over width, the viewBox of components/DeloitteWordmark.svelte

const LEFT = PAGE.left;
const WIDTH = PAGE.width - PAGE.left - PAGE.right;
const BOTTOM = PAGE.height - PAGE.bottom;
const HEADER = 10; // the running head of every page but the cover
const PT = 25.4 / 72;
const PLATE = '#0B1F3A';
/** "How to read this report" on page 1: three lines. */
export const HOW_TO_READ = Object.freeze([
  'Each activity has its own pages: its takeaway first, then every question with its chart.',
  'For a question with a correct answer the bars count first answers; the correct one has a tick and the word “Correct”.',
  'A figure that rests on fewer than five answers says so; how everything is counted is on the last page.',
]);

const leading = (size) => size * PT * 1.36;
const baseline = (size) => size * PT * 1.02;
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const sum = (values) => values.reduce((total, value) => total + value, 0);

/**
 * @param {LeaderReport} report
 * @param {ReturnType<typeof import('./report-fonts.js').createMeasure>} measure
 * @param {{ logo?: { data: string, width: number, height: number } | null, palette: import('../results/results-palette.js').Palette }} assets The palette is the Results palette (lib/results/results-palette.js).
 * @returns {{ pages: { items: Item[], section: string }[], missing: number }}
 */
export function layoutLeaderReport(report, measure, { logo = null, palette } = /** @type {any} */ ({})) {
  if (!palette) throw new Error('layoutLeaderReport needs the Results palette (lib/results-palette.js).');
  const before = measure.stats.missing;
  let pages = compose(report, measure, logo, false, palette);
  const missing = measure.stats.missing - before;
  // Something could not be printed: say so on the cover, which means laying the pages out once more.
  if (missing > 0) pages = compose(report, measure, logo, true, palette);
  return { pages, missing };
}

function compose(report, measure, logo, noteMissing, palette) {
  const { accent, ink } = report.brand;
  const joined = report.summary.joined;
  // The words and rules of every page are the Results palette's: black and its secondary grey (brand guide p. 37), its gridline grey and shade.
  const INK = palette.text;
  const MUTED = palette.textSecondary;
  const RULE = palette.grid;
  const TINT = palette.bandShade;
  const GREEN = palette.brand;

  // ---- Text -------------------------------------------------------------------------------------------------------------------------

  /** Lines that fit `width`. A word longer than a line is broken; a line break in the text (a comment) is kept. */
  function wrap(value, width, size, bold = false, keepBreaks = false) {
    const lines = [];
    const space = measure.width(' ', size, bold);
    for (const paragraph of measure.clean(value, { keepBreaks }).split('\n')) {
      let line = '';
      let used = 0;
      for (const word of paragraph.split(' ')) {
        if (!word) continue;
        const wide = measure.width(word, size, bold);
        if (line && used + space + wide <= width) { line += ` ${word}`; used += space + wide; continue; }
        if (line) lines.push(line);
        let rest = word;
        while (measure.width(rest, size, bold) > width && rest.length > 1) {
          let cut = 1;
          while (cut < rest.length && measure.width(rest.slice(0, cut + 1), size, bold) <= width) cut += 1;
          lines.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        line = rest;
        used = measure.width(rest, size, bold);
      }
      lines.push(line);
    }
    while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }

  /** At most `max` lines; the last ends in an ellipsis when something was left out. Never used for a comment. */
  function fit(value, width, size, bold = false, max = 1) {
    const lines = wrap(value, width, size, bold);
    if (lines.length <= max) return lines;
    let last = `${lines[max - 1]}…`;
    while (last.length > 1 && measure.width(last, size, bold) > width) last = `${last.slice(0, -2)}…`;
    return [...lines.slice(0, max - 1), last];
  }

  /** @returns {Item} one line, its baseline `top` below the row's top */
  const text = (x, top, w, line, size, style = {}) => ({ kind: 'text', x, y: top + baseline(size), w, text: line, size, color: INK, ...style });
  /** @returns {RowBox} */
  const row = (h, items = [], glue = false) => ({ h, items, glue });
  const gap = (h) => row(h);

  /** A paragraph: one row a line. */
  function paragraph(value, { x = LEFT, w = WIDTH - (x - LEFT), size = 9.5, bold = false, color = INK, max = 0, glue = false, keepBreaks = false, bar = '' } = {}) {
    const lines = max ? fit(value, w, size, bold, max) : wrap(value, w, size, bold, keepBreaks);
    return lines.map((line, index) => row(leading(size), [
      ...(bar ? [{ kind: 'rect', x: LEFT, y: -0.1, w: 0.7, h: leading(size) + 0.1, fill: bar }] : []),
      text(x, 0, w, line, size, { bold, color }),
    ], glue || index < lines.length - 1 && lines.length <= 3));
  }

  /** The measure the chart figure lays its words out with: the embedded fonts', and fit() where a line may be cut. */
  const figureMeasure = {
    wrap: (value, width, size, bold, max) => (max ? fit(value, width, size, bold, max) : wrap(value, width, size, bold)),
    width: (value, size, bold) => measure.width(measure.clean(value), size, bold),
    lineHeight: leading,
  };

  /** Rows marked with what they are (a test finds a chart's words by it); the writer draws them as any other. */
  const marked = (rows, role) => rows.map((box) => ({ ...box, items: box.items.map((item) => ({ ...item, role })) }));

  /**
   * A question's chart as rows: one for each bar (a chart longer than what is left of a page carries on overleaf between two bars), or one for a
   * split bar, a scale or the words. A text item's top becomes its baseline, as this file places text.
   */
  function figureRows(chart, x, width) {
    const figure = chartFigure(chart, { x, width, palette, measure: figureMeasure, size: 9, maxLabelLines: 4, comments: 0, plot: 22, points: true });
    if (figure.items.length === 0) return [];
    const cuts = [0, ...(figure.breaks?.length ? figure.breaks : [figure.h])];
    return cuts.slice(0, -1).map((top, index) => {
      const bottom = cuts[index + 1];
      const last = index === cuts.length - 2;
      const inRow = figure.items.filter((item) => item.y >= top - 0.01 && (last || item.y < bottom - 0.01));
      return row(bottom - top, inRow.map((item) => {
        const y = item.y - top;
        if (item.kind === 'text') return { ...item, y: y + baseline(item.size), text: measure.clean(item.text) };
        if (item.kind === 'line') return { ...item, y, y2: item.y2 - top };
        return { ...item, y };
      }));
    });
  }

  // ---- Pages ------------------------------------------------------------------------------------------------------------------------

  /** @type {{ items: Item[], section: string }[]} */
  const pages = [];
  let page = /** @type {{ items: Item[], section: string }} */ (/** @type {unknown} */ (null));
  let y = 0;
  let top = 0;
  let section = '';
  let head = '';
  const newPage = () => {
    page = { items: [], section, head };
    pages.push(page);
    top = pages.length === 1 ? PAGE.top : PAGE.top + HEADER;
    y = top;
  };
  const put = (box) => {
    for (const item of box.items) page.items.push({ ...item, y: item.y + y, ...(item.y2 === undefined ? {} : { y2: item.y2 + y }) });
    y += box.h;
  };
  /** Places rows: together on one page when they fit one, and otherwise row by row. */
  function block(rows, { keep = true } = {}) {
    // (Space at the end of a block is not part of what has to fit.)
    let last = rows.length;
    while (last > 0 && rows[last - 1].items.length === 0) last -= 1;
    const total = sum(rows.slice(0, last).map((box) => box.h));
    if (keep && total > BOTTOM - y && total <= BOTTOM - (PAGE.top + HEADER) && y > top) newPage();
    rows.forEach((box, index) => {
      if (box.items.length === 0 && y === top) return; // no space at the top of a page
      let need = box.h;
      for (let next = index; rows[next].glue && next + 1 < rows.length; next += 1) need += rows[next + 1].h;
      if (need > BOTTOM - y && y > top) newPage();
      if (box.items.length === 0 && y === top) return;
      put(box);
    });
  }
  function startSection(title, intro) {
    section = title;
    head = title;
    newPage();
    block([
      row(leading(16) + 1, [text(LEFT, 0, WIDTH, fit(title, WIDTH, 16, true)[0], 16, { bold: true })], true),
      row(1.4, [{ kind: 'rect', x: LEFT, y: 0, w: 22, h: 0.9, fill: GREEN }], true),
      gap(2.5),
      ...marked(paragraph(intro, { size: 8.8, color: MUTED }), 'section-intro'),
      gap(4),
    ], { keep: false });
  }

  // ---- 1. Cover and summary ---------------------------------------------------------------------------------------------------------

  section = 'Summary';
  newPage();
  const markWidth = 34;
  const markHeight = markWidth * WORDMARK_RATIO;
  let headHeight = markHeight;
  if (logo && logo.width > 0 && logo.height > 0) {
    const dark = report.brand.plate === 'dark';
    const pad = dark ? 3 : 0;
    const scale = Math.min((62 - pad * 2) / logo.width, (22 - pad * 2) / logo.height);
    const [w, h] = [logo.width * scale, logo.height * scale];
    // A logo drawn for the dark plate (white artwork) would vanish on a white page: it keeps its plate.
    if (dark) page.items.push({ kind: 'rect', x: LEFT, y, w: w + pad * 2, h: h + pad * 2, fill: PLATE, radius: 1.5 });
    page.items.push({ kind: 'image', x: LEFT + pad, y: y + pad, w, h, data: logo.data });
    headHeight = Math.max(markHeight, h + pad * 2);
  }
  page.items.push({ kind: 'wordmark', x: PAGE.width - PAGE.right - markWidth, y: y + (headHeight - markHeight) / 2, w: markWidth });
  y += headHeight + 7;

  // The title band, in the client's colour: the one place the report wears it.
  const inner = WIDTH - 16;
  const band = [
    { size: 9, bold: true, lines: ['LEADER REPORT'], after: 1.5 },
    { size: 25, bold: true, lines: fit(report.meta.clientName, inner, 25, true, 3), after: 1 },
    ...(report.meta.eventTitle ? [{ size: 13, bold: false, lines: fit(report.meta.eventTitle, inner, 13, false, 2), after: 0.5 }] : []),
    { size: 11, bold: false, lines: fit(report.meta.dateText || 'No date recorded', inner, 11), after: 0 },
  ];
  const bandHeight = 14 + sum(band.map((part) => part.lines.length * leading(part.size) + part.after));
  page.items.push({ kind: 'rect', x: LEFT, y, w: WIDTH, h: bandHeight, fill: accent, radius: 2, role: 'title-band' });
  let cursor = y + 7;
  for (const part of band) {
    for (const line of part.lines) {
      page.items.push({ ...text(LEFT + 8, cursor, inner, line, part.size, { bold: part.bold, color: ink, role: 'title-band' }) });
      cursor += leading(part.size);
    }
    cursor += part.after;
  }
  y += bandHeight + 7;

  // At a glance: four tiles, what each activity found, the hardest and easiest question, how to read the report, and when it was made. It is
  // laid out with as many activities as leave room for the rest, so page 1 never needs a second page; any left over are counted in one line.
  const { summary } = report;
  const questionCount = report.activities.reduce((total, activity) => total + activity.questions.length, 0);
  const tileWidth = (WIDTH - 15) / 4;
  const tiles = [
    { figure: summary.joined.toLocaleString('en-US'), label: 'People who joined', detail: 'Everyone who opened it' },
    { figure: summary.answeredSomething.toLocaleString('en-US'), label: 'People who answered', detail: summary.answeredNothing > 0 ? `${summary.answeredNothing} answered nothing` : '' },
    { figure: summary.answers.toLocaleString('en-US'), label: summary.answers === 1 ? 'Answer' : 'Answers', detail: `Across ${numberWords(questionCount)} ${questionCount === 1 ? 'question' : 'questions'}` },
    { figure: `${summary.finishedAll} of ${summary.joined}`, label: 'Finished every activity', detail: summary.joined > 0 ? `${wholePercent((summary.finishedAll / summary.joined) * 100)} of those who joined` : '' },
  ];
  const tileHeight = 33;
  const tileItems = tiles.flatMap((tile, index) => {
    const x = LEFT + index * (tileWidth + 5);
    const label = fit(tile.label, tileWidth - 9, 8.8, true, 2);
    return [
      { kind: 'rect', x, y: 0, w: tileWidth, h: tileHeight, stroke: RULE, radius: 2 },
      { kind: 'rect', x: x + 3, y: 4.5, w: 1.1, h: tileHeight - 9, fill: GREEN },
      text(x + 6.5, 3.2, tileWidth - 9, fit(tile.figure, tileWidth - 9, 20, true)[0], 20, { bold: true }),
      ...label.map((line, at) => text(x + 6.5, 12.6 + at * leading(8.8), tileWidth - 9, line, 8.8, { bold: true })),
      ...fit(tile.detail, tileWidth - 9, 8, false, 2).filter(Boolean).map((line, at) => text(x + 6.5, 12.6 + label.length * leading(8.8) + 0.4 + at * leading(8), tileWidth - 9, line, 8, { color: MUTED })),
    ];
  });
  const heading = (title, size = 11) => row(leading(size) + 1.5, [text(LEFT, 0, WIDTH, title, size, { bold: true })], true);

  const takeaways = report.activities.map((activity) => {
    const title = fit(`${activity.title}${activity.off ? ' (switched off)' : ''}`, 46, 9.2, true, 2);
    const said = fit(activity.summary.takeaway, WIDTH - 54, 8.8, false, 3);
    const h = Math.max(title.length * leading(9.2), said.length * leading(8.8)) + 2.2;
    return row(h, [
      { kind: 'rect', x: LEFT, y: 0.3, w: 0.9, h: h - 2, fill: GREEN },
      ...title.map((line, at) => text(LEFT + 3.5, at * leading(9.2), 46, line, 9.2, { bold: true })),
      ...said.map((line, at) => text(LEFT + 54, at * leading(8.8) + 0.2, WIDTH - 54, line, 8.8, { role: 'takeaway' })),
    ]);
  });

  const highlights = [heading('Hardest and easiest question')];
  // (Phase 20: a session with the confidence check says how far confidence moved, in confidence-shift.js's one line.)
  if (summary.confidence) highlights.push(...paragraph(summary.confidence.line, { size: 8.8 }), gap(1.6));
  highlights.push(...paragraph(summary.averageScore === null ? 'No graded question was answered, so there is no first-try score.' : `Average first-try score: ${wholePercent(summary.averageScore)}, over ${plural(summary.scored, 'participant')}.`, { size: 8.8, color: MUTED }), gap(1.6));
  if (summary.hardest && summary.easiest) {
    const boxWidth = (WIDTH - 6) / 2;
    const boxes = [['Hardest (fewest right first time)', summary.hardest], ['Easiest (most right first time)', summary.easiest]].map(([label, question], index) => {
      const x = LEFT + index * (boxWidth + 6);
      const prompt = fit(question.prompt, boxWidth - 10, 9.6, true, 3);
      const items = [
        text(x + 5, 3, boxWidth - 10, label, 8.4, { bold: true, color: MUTED }),
        text(x + 5, 3 + leading(8.4), boxWidth - 10, fit(`Question ${question.number}, ${question.activity}`, boxWidth - 10, 8.2)[0], 8.2, { color: MUTED }),
        ...prompt.map((line, at) => text(x + 5, 4 + leading(8.4) + leading(8.2) + at * leading(9.6), boxWidth - 10, line, 9.6, { bold: true })),
        text(x + 5, 5 + leading(8.4) + leading(8.2) + prompt.length * leading(9.6), boxWidth - 10, `${question.right} of ${question.answered} right first time (${wholePercent(question.percent)})`, 9.2),
      ];
      return { x, items, h: 9 + leading(8.4) + leading(8.2) + prompt.length * leading(9.6) + leading(9.2) };
    });
    const h = Math.max(...boxes.map((box) => box.h));
    highlights.push(row(h, boxes.flatMap((box) => [{ kind: 'rect', x: box.x, y: 0, w: boxWidth, h, stroke: RULE, radius: 2 }, ...box.items])));
  } else if (summary.flat) {
    highlights.push(...paragraph(summary.flat.questions === 1
      ? `Only one graded question was answered (${wholePercent(summary.flat.percent)} right first time), so there is nothing to compare.`
      : `All ${summary.flat.questions} graded questions had the same share right first time (${wholePercent(summary.flat.percent)}), so none stands out.`, { color: MUTED }));
  } else highlights.push(...paragraph('No graded question was answered, so there is no hardest or easiest question.', { color: MUTED }));

  // How to read this report: a tinted box of three lines, each a bullet.
  const readLines = HOW_TO_READ.flatMap((line) => wrap(line, WIDTH - 16, 8.4).map((part, at) => ({ part, first: at === 0 })));
  const readHeight = 6.5 + leading(9.5) + 1 + readLines.length * leading(8.4);
  const howToRead = row(readHeight, [
    { kind: 'rect', x: LEFT, y: 0, w: WIDTH, h: readHeight, fill: TINT, stroke: RULE, radius: 2, role: 'how-to-read' },
    text(LEFT + 5, 3.2, WIDTH - 10, 'How to read this report', 9.5, { bold: true, role: 'how-to-read' }),
    ...readLines.flatMap(({ part, first }, at) => {
      const top = 3.2 + leading(9.5) + 1 + at * leading(8.4);
      return [...(first ? [text(LEFT + 5, top, 3, '•', 8.4, { color: MUTED, role: 'how-to-read' })] : []), text(LEFT + 9, top, WIDTH - 14, part, 8.4, { role: 'how-to-read', bullet: first })];
    }),
  ]);

  // Then one line: when it was made, and where the counting rules are; and (Phase 8) whether the session had ended: a leader who reads only page 1
  // of a report made during the event must learn that answers are still arriving, so a session that had not ended says so in bold. A sample client's
  // content not yet confirmed (Phase 9b, SAM-2) and answers that could not be read (DI-6) are said here too, in bold.
  const closing = [
    ...paragraph(`Made on ${report.meta.generated} from the answers saved for this session. How the numbers are counted is on the last page.`, { size: 8.8, color: MUTED }),
    gap(1.6),
    ...paragraph(report.meta.ended ? SESSION_ENDED : SESSION_NOT_ENDED, report.meta.ended ? { size: 8.8, color: MUTED } : { size: 9.2, bold: true }),
    ...(report.meta.sampleNotice ? [gap(1.6), ...paragraph(report.meta.sampleNotice, { size: 9.2, bold: true })] : []),
    ...(report.meta.unreadableNotice ? [gap(1.6), ...paragraph(report.meta.unreadableNotice, { size: 9.2, bold: true })] : []),
  ];

  const coverRows = (shown) => {
    const hidden = takeaways.length - shown;
    return [
      row(leading(14) + 1.5, [text(LEFT, 0, WIDTH, 'At a glance', 14, { bold: true })], true),
      row(1.4, [{ kind: 'rect', x: LEFT, y: 0, w: 22, h: 0.9, fill: GREEN }], true),
      gap(2.5),
      row(tileHeight, tileItems),
      gap(6),
      heading('What each activity found'),
      ...(takeaways.length === 0 ? paragraph('This session has no activity that is switched on.', { color: MUTED }) : takeaways.slice(0, shown)),
      ...(hidden > 0 ? paragraph(`And ${numberWords(hidden)} more ${hidden === 1 ? 'activity' : 'activities'}, each on its own pages.`, { size: 8.8, color: MUTED }) : []),
      gap(5),
      ...highlights,
      gap(5),
      howToRead,
      gap(4),
      ...closing,
    ];
  };
  const room = BOTTOM - y;
  let shown = takeaways.length;
  while (shown > 0 && sum(coverRows(shown).map((box) => box.h)) > room) shown -= 1;
  for (const box of coverRows(shown)) put(box);

  // ---- 2. Results by activity: each activity on pages of its own ---------------------------------------------------------------------

  startSection('Results by activity', 'Each activity starts a new page with what it found, then every question as the Live display shows it. For a question with a correct answer the bars count first answers only; the correct answer is in bold, with a tick and the word “Correct”.');
  if (report.activities.length === 0) block(paragraph('This session has no activity that is switched on, so there are no results.', { color: MUTED }));
  const indent = LEFT + 12;
  const cardWidth = WIDTH - 16;
  /** Rows stacked into one, so they can only be placed together (and framed). */
  const stack = (rows) => {
    let top = 0;
    const items = [];
    for (const box of rows) {
      for (const item of box.items) items.push({ ...item, y: item.y + top, ...(item.y2 === undefined ? {} : { y2: item.y2 + top }) });
      top += box.h;
    }
    return { h: top, items };
  };
  report.activities.forEach((activity, order) => {
    head = activity.title;
    if (order > 0) newPage();
    else page.head = head;
    const { summary: found } = activity;
    const answers = activity.questions.reduce((total, question) => total + question.respondents, 0);
    // The band: the activity's title, whether it is switched off, its purpose line, its three numbers and its takeaway.
    const parts = [
      ...fit(activity.title, WIDTH - 10, 13, true, 2).map((line) => ({ line, size: 13, bold: true, role: 'activity-title' })),
      ...(activity.off ? [{ line: 'Switched off when this report was made.', size: 8.4, color: MUTED }] : []),
      ...(activity.description ? fit(activity.description, WIDTH - 10, 8.8, false, 2).map((line) => ({ line, size: 8.8, color: MUTED })) : []),
      { line: `${plural(activity.questions.length, 'question')} · ${plural(answers, 'answer')} · ${activity.finished} of ${joined} finished`, size: 9, color: MUTED, after: 1.4 },
      ...wrap(found.takeaway, WIDTH - 10, 9.6, true).map((line) => ({ line, size: 9.6, bold: true, role: 'takeaway' })),
    ];
    const bandH = parts.reduce((total, part) => total + leading(part.size) + (part.after ?? 0), 0) + 8;
    let top = 4;
    const bandItems = [
      { kind: 'rect', x: LEFT, y: 0, w: WIDTH, h: bandH, fill: TINT, radius: 2, role: 'activity-band' },
      { kind: 'rect', x: LEFT, y: 0, w: 1.4, h: bandH, fill: GREEN },
    ];
    for (const part of parts) {
      bandItems.push(text(LEFT + 6, top, WIDTH - 10, part.line, part.size, { bold: part.bold, color: part.color ?? INK, ...(part.role ? { role: part.role } : {}) }));
      top += leading(part.size) + (part.after ?? 0);
    }
    const lead = [row(bandH, bandItems, true), gap(4)];
    if (activity.questions.length === 0) { block([...lead, ...paragraph('This activity has no questions.', { color: MUTED }), gap(5)]); return; }
    activity.questions.forEach((question, index) => {
      const rows = [gap(3.4)];
      const prompt = wrap(question.prompt, cardWidth - 8, 10.4, true);
      prompt.forEach((line, at) => rows.push(row(leading(10.4), [
        ...(at === 0 ? [text(LEFT + 4, 0, 8, `Q${question.number}`, 10.4, { bold: true, color: MUTED })] : []),
        text(indent, 0, cardWidth - 8, line, 10.4, { bold: true }),
      ])));
      const meta = [`${question.kindLabel}. Answered by ${question.respondents} of ${joined}.`, fewAnswersLine(question.respondents)].filter(Boolean).join(' ');
      for (const line of wrap(meta, cardWidth - 8, 8.2)) rows.push(row(leading(8.2), [text(indent, 0, cardWidth - 8, line, 8.2, { color: MUTED })]));
      rows.push(gap(1.4));
      // As the Live display's card: the headline, then for a graded question "N of M got it right first time", then the chart (Phase 11b).
      const { chart } = question;
      rows.push(...marked(paragraph(chart.headline, { x: indent, w: cardWidth - 8, size: 9.6, bold: true, color: palette.text }), 'headline'));
      if (chart.gradedLine) rows.push(...marked(paragraph(chart.gradedLine, { x: indent, w: cardWidth - 8, size: 8.8, bold: true, color: palette.textSecondary }), 'graded-line'));
      rows.push(gap(1.6));
      rows.push(...figureRows(chart, indent, cardWidth - 8));
      // A ranking's caption says what its score means. (A multiple choice's is in the notes below, and so are answers to an option that has gone.)
      if (question.kind === 'ranking' && chart.caption) rows.push(...marked(paragraph(chart.caption, { x: indent, w: cardWidth - 8, size: 8.2, color: palette.textSecondary }), 'caption'));
      const facts = [];
      // (Prompt 23: Art of the Possible's own lines: where to start, and the disagreements apart.)
      if (question.kind === 'matrix' && question.respondents > 0) {
        const names = (list) => list.map((row) => `${row.label} (${row.people})`).join('; ');
        if (chart.where.start.length > 0) facts.push([`Where to start: ${names(chart.where.start)}`, true]);
        if (chart.where.discuss.length > 0) facts.push([`Discuss, guests disagree: ${names(chart.where.discuss)}`, false]);
      }
      if (question.kind === 'text') facts.push([`${plural(question.respondents, 'written answer')}. ${question.respondents > 0 ? 'Each is in “What participants said”, word for word.' : ''}`, false]);
      else if (question.respondents === 0) facts.push(['Nobody answered this question.', false]);
      if (question.firstTry && question.respondents > 0) {
        facts.push([`Right first time: ${question.firstTry.right} of ${question.firstTry.answered} (${wholePercent(question.firstTry.percent)})`, true]);
        facts.push([question.commonWrong ? `Most common wrong first answer: ${question.commonWrong.label} (${question.commonWrong.count} of ${question.respondents})` : 'Nobody gave a wrong first answer.', false]);
        if (question.retries) {
          const { later, shown: told, open } = question.retries;
          facts.push([`After a wrong first answer: ${[later ? `${later} got it right on the second try` : '', told ? `${told} ${told === 1 ? 'was' : 'were'} shown the answer` : '', open ? `${open} did not try again` : ''].filter(Boolean).join(', ')}.`, false]);
        }
      }
      if (question.average) facts.push([`Average: ${question.average.value.toFixed(1)} on a scale of ${question.average.min} to ${question.average.max} (${plural(question.average.answers, 'answer')})`, true]);
      if (question.ranking && question.respondents > 0) {
        facts.push([`Points: with ${plural(question.ranking.length, 'option')}, a first place earns ${question.ranking.length}, the next one fewer, the last 1.`, false]);
        facts.push([`Average place: ${question.ranking.map((option) => `${option.label} ${option.averagePlace === null ? '–' : option.averagePlace.toFixed(1)}`).join('; ')}`, false]);
      }
      rows.push(gap(0.8));
      for (const [fact, bold] of facts) rows.push(...paragraph(fact, { x: indent, w: cardWidth - 8, size: 9, bold }));
      for (const note of question.notes) rows.push(...paragraph(note, { x: indent, w: cardWidth - 8, size: 8.2, color: MUTED }));
      rows.push(gap(3));
      const whole = stack(rows);
      const before = index === 0 ? lead : [];
      // A card that fits a page is one row in a frame, so it is never split; one longer than a page (some forty answer options) breaks between two bars.
      if (whole.h <= BOTTOM - (PAGE.top + HEADER)) {
        const card = row(whole.h, [
          { kind: 'rect', x: LEFT, y: 0, w: WIDTH, h: whole.h, stroke: RULE, radius: 2, role: 'card', of: question.id },
          { kind: 'rect', x: LEFT, y: 0, w: WIDTH, h: 1, fill: GREEN, role: 'card-rule' },
          ...whole.items.map((item) => ({ ...item, card: question.id })),
        ]);
        block([...before, card, gap(4)]);
      } else block([...before, ...rows, gap(4)]);
    });
    // A graded activity ends with its scoreboard: the average share right first time, and the question most often missed.
    if (found.scoreboard) block([...marked(paragraph(found.scoreboard.line, { x: LEFT + 4, w: WIDTH - 4, size: 9.2, bold: true, bar: GREEN }), 'scoreboard'), gap(5)]);
  });
  head = '';

  // ---- 3. What participants said ----------------------------------------------------------------------------------------------------

  // (With Hide names, Prompt 21 decision B, nobody's name is printed: the line says how people are shown instead.)
  startSection('What participants said', report.meta.namesHidden ? 'Every written answer, word for word, with the person who wrote it as Guest 1, Guest 2 … (names are hidden).' : 'Every written answer, word for word, with the name of the person who wrote it.');
  if (report.comments.length === 0) block(paragraph('This session had no question that asked for a written answer.', { color: MUTED }));
  for (const question of report.comments) {
    block([
      row(leading(8.2), [text(LEFT, 0, WIDTH, fit(`Question ${question.number}, ${question.activity}`, WIDTH, 8.2)[0], 8.2, { color: MUTED })], true),
      ...paragraph(question.prompt, { size: 10.4, bold: true, glue: true }),
      row(leading(8.2) + 2, [text(LEFT, 0, WIDTH, question.entries.length === 0 ? 'Nobody wrote an answer.' : plural(question.entries.length, 'written answer'), 8.2, { color: MUTED })]),
    ]);
    for (const entry of question.entries) {
      block([
        ...fit(entry.name, WIDTH - 4, 9, true, 2).map((line) => row(leading(9), [{ kind: 'rect', x: LEFT, y: 0, w: 0.7, h: leading(9), fill: GREEN }, text(LEFT + 4, 0, WIDTH - 4, line, 9, { bold: true })], true)),
        ...paragraph(entry.text, { x: LEFT + 4, size: 9.5, keepBreaks: true, bar: GREEN }),
        gap(3),
      ]);
    }
    block([gap(3)]);
  }

  // ---- 4. Participants --------------------------------------------------------------------------------------------------------------

  startSection('Participants', 'One block for each person, in the order they joined. For a question with a correct answer, the answer shown first is the first one they gave; a tick or a cross says whether it was right.');
  if (report.participants.length === 0) block(paragraph('Nobody joined this session.', { color: MUTED }));
  for (const person of report.participants) {
    const rows = [];
    const name = fit(person.name, WIDTH - 60, 12, true, 3);
    name.forEach((line, index) => rows.push(row(leading(12), [
      text(LEFT, 0, WIDTH - 60, line, 12, { bold: true }),
      ...(index === 0 ? [text(LEFT + WIDTH - 58, 1, 58, `Activities finished: ${person.activitiesFinished} of ${person.activityCount}`, 9, { align: 'right' })] : []),
    ], true)));
    rows.push(...paragraph(`First-try score: ${scoreLine(person)}. ${answeredLine(person)}.`, { size: 9, glue: true }));
    rows.push(...paragraph(`${person.joined}.`, { size: 8.2, color: MUTED }));
    if (person.restart) rows.push(...paragraph(person.restart, { size: 8.6 }));
    rows.push(gap(1.2));
    if (person.unreadable) rows.push(...paragraph(UNREADABLE_PERSON, { size: 9.5, bold: true }));
    else if (person.answered === 0) rows.push(...paragraph(`${NO_ANSWERS}.`, { size: 9.5, bold: true }));
    else {
      for (const activity of person.activities) {
        const status = activity.status === 'finished' ? 'Finished' : activity.status === 'started' ? 'Started, not finished' : 'Not started';
        rows.push(row(leading(9.2) + 1.6, [
          { kind: 'rect', x: LEFT, y: 0, w: WIDTH, h: leading(9.2) + 1, fill: TINT },
          text(LEFT + 2, 0.5, WIDTH - 56, fit(`${activity.title}${activity.off ? ' (switched off)' : ''}`, WIDTH - 56, 9.2, true)[0], 9.2, { bold: true }),
          text(LEFT + WIDTH - 52, 0.6, 50, status, 8.6, { align: 'right' }),
        ], activity.status !== 'not-started' && activity.rows.length > 0));
        if (activity.status === 'not-started') continue;
        for (const answer of activity.rows) {
          const prompt = fit(answer.prompt, 74, 8.6, false, 2);
          const said = answer.answered
            ? wrap(answer.said, 86, 9, false, answer.kind === 'text').map((line) => ({ line, color: INK }))
            : [{ line: 'Not answered', color: MUTED }];
          const count = Math.max(prompt.length, said.length);
          for (let index = 0; index < count; index += 1) {
            rows.push(row(leading(9), [
              ...(index === 0 ? [text(LEFT + 2, 0.15, 9, `Q${answer.number}`, 8.2, { color: MUTED })] : []),
              ...(prompt[index] ? [text(LEFT + 11, 0.1, 74, prompt[index], 8.6)] : []),
              ...(index === 0 && answer.verdict ? [{ kind: answer.verdict === 'right' ? 'tick' : 'cross', x: LEFT + 87.4, y: 0.75, size: 2.9, color: INK }] : []),
              ...(said[index] ? [text(LEFT + 92, 0, 86, said[index].line, 9, { color: said[index].color })] : []),
            ], index < count - 1 && count <= 4));
          }
          rows.push(gap(0.5));
        }
      }
    }
    if (person.strays > 0) rows.push(...paragraph(`${plural(person.strays, 'answer')} to questions no longer in the activity: listed near the end of this report.`, { size: 8.2, color: MUTED }));
    rows.push(gap(2.2), row(0.4, [{ kind: 'line', x: LEFT, y: 0, x2: LEFT + WIDTH, y2: 0, color: RULE }]), gap(4));
    block(rows);
  }

  // ---- 5. Questions no longer in the activity (only when there are any) ------------------------------------------------------------

  if (report.strays.length > 0) {
    startSection(STRAY_TITLE, 'These answers were given to questions that have since been deleted or taken out of this session’s activities. They are shown so that nothing is lost, and they are counted in no score and no total.');
    for (const stray of report.strays) {
      block([
        ...paragraph(stray.title, { size: 10.4, bold: true, glue: true }),
        row(leading(8.2) + 1.6, [text(LEFT, 0, WIDTH, plural(stray.entries.length, 'answer'), 8.2, { color: MUTED })], true),
        ...stray.entries.flatMap((entry) => {
          const lines = wrap(entry.text, WIDTH - 60, 9, false, true);
          return [...lines.map((line, index) => row(leading(9), [
            ...(index === 0 ? [text(LEFT, 0, 56, fit(entry.name, 56, 9, true)[0], 9, { bold: true })] : []),
            text(LEFT + 60, 0, WIDTH - 60, line, 9),
          ])), gap(0.8)];
        }),
        gap(5),
      ]);
    }
  }

  // ---- 6. How the numbers are counted (always the last section): which session, and the rules --------------------------------------

  startSection('How the numbers are counted', 'Every figure and name in this report follows these rules.');
  const aboutWidth = WIDTH - 12;
  const about = [];
  const aboutLine = (value, style = {}) => {
    const size = style.size ?? 8.4;
    const lines = wrap(value, aboutWidth - (style.indent ?? 0), size, style.bold);
    lines.forEach((line, index) => about.push({ line, size, ...style, after: index === lines.length - 1 ? style.after ?? 0 : 0 }));
  };
  aboutLine('About this report', { size: 11, bold: true, after: 1.2 });
  aboutLine(`Session: ${[report.meta.clientName, report.meta.eventTitle, report.meta.dateText].filter(Boolean).join(', ')}. ${report.meta.status}.`, { after: 1.6 });
  const notes = [...report.rules, LIVE_FILES_NOTE, ...report.notes, ...(noteMissing ? [`A character this report’s font cannot print (an emoji, a script other than Latin) appears as ${MISSING}. The participant CSV holds every answer in full.`] : [])];
  for (const note of notes) {
    const from = about.length;
    aboutLine(note, { indent: 3.4, after: 0.7 });
    about[from].bullet = true;
  }
  const aboutHeight = 10 + sum(about.map((part) => leading(part.size) + (part.after ?? 0)));
  const aboutItems = [{ kind: 'rect', x: LEFT, y: 0, w: WIDTH, h: aboutHeight, fill: TINT, stroke: RULE, radius: 2 }];
  cursor = 5;
  for (const part of about) {
    if (part.bullet) aboutItems.push(text(LEFT + 6, cursor, 3, '•', part.size, { color: MUTED }));
    aboutItems.push(text(LEFT + 6 + (part.indent ?? 0), cursor, aboutWidth - (part.indent ?? 0), part.line, part.size, { bold: part.bold }));
    cursor += leading(part.size) + (part.after ?? 0);
  }
  block([row(aboutHeight, aboutItems), gap(7)]);

  // ---- Running head and foot --------------------------------------------------------------------------------------------------------

  const client = fit(report.meta.clientName, 70, 7.8)[0];
  pages.forEach((sheet, index) => {
    if (index > 0) {
      sheet.items.push(
        text(LEFT, PAGE.top - 0.6, 110, fit(`${report.meta.clientName}, leader report`, 110, 7.8)[0], 7.8, { color: MUTED }),
        text(LEFT + WIDTH - 64, PAGE.top - 0.6, 64, fit(sheet.head || sheet.section, 64, 7.8)[0], 7.8, { color: MUTED, align: 'right' }),
        { kind: 'line', x: LEFT, y: PAGE.top + 4.6, x2: LEFT + WIDTH, y2: PAGE.top + 4.6, color: RULE },
      );
    }
    const foot = PAGE.height - 13.5;
    sheet.items.push(
      { kind: 'line', x: LEFT, y: foot - 2.2, x2: LEFT + WIDTH, y2: foot - 2.2, color: RULE },
      text(LEFT, foot, 50, CONFIDENTIAL, 7.8, { color: MUTED }),
      text(LEFT + 54, foot, 70, client, 7.8, { color: MUTED, align: 'center' }),
      text(LEFT + WIDTH - 50, foot, 50, `Page ${index + 1} of ${pages.length}`, 7.8, { color: MUTED, align: 'right' }),
    );
  });
  return pages;
}
