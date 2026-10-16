// Since Phase 10c-1 this file belongs to the new build alone (migration/): the legacy app that shared it is kept in the tag legacy-final.
/**
 * resultsExport.js: turns a session's aggregated results (the tree that
 * migration/src/lib/session-results.js readSessionResults() returns) into files for the facilitator.
 *
 *   CSV  resultsToCsv() builds the text, downloadCsv() saves it.
 *   PDF  downloadPdf(): a branded one-pager (jsPDF).
 *   PPT  downloadPptx(): the same one-pager as a slide (PptxGenJS).
 *
 * Nothing here fetches data. The CSV's numbers come straight from the tally (count,
 * percent, score); the PDF and PPT show each question as the Live display's chart does,
 * from the same chart model (Phase 11b), so every file agrees with what the screen shows.
 * The PDF and PPT are built from one layout (see "One-page report"), so they match each
 * other too. The caller passes the client's brand (branding.js's currentBrand()) and the
 * Results palette; without a brand the report is unbranded.
 */

import { embeddedAssetUrl } from './assets.js';
import { answerCounts, answersFrom, chartOf } from '../../migration/src/lib/results-chart-model.js';
import { chartFigure } from '../../migration/src/lib/results-chart-figure.js';

const COLUMNS = ['Activity', 'Question', 'Type', 'Option', 'Count', 'Percentage', 'Score', 'Respondents'];

/** The sections a session is showing (a section an admin hasn't enabled has no results to export). */
export const liveSections = (results) => results.sections.filter((section) => section.enabled === true);

/**
 * One row per option of each question: section, question, type, option, count,
 * percentage (0-100, one decimal), and respondents (how many iPads answered the
 * question). Ranked-voting rows also carry their Borda score, and their percentage is the
 * option's share of all points. An open-text question has no options, so each
 * comment is a row of its own: the comment in the Option column, a count of 1 and no
 * percentage.
 */
export function resultsRows(results) {
  const rows = [];
  for (const section of liveSections(results)) {
    for (const question of section.questions) {
      const base = [section.title, question.prompt, question.type];
      if (question.type === 'open-text-feedback') {
        for (const response of question.responses) {
          rows.push([...base, String(response.answer), 1, '', '', question.respondents]);
        }
        continue;
      }
      for (const option of question.options) {
        rows.push([
          ...base, option.label, option.count, option.percent.toFixed(1), option.score ?? '', question.respondents,
        ]);
      }
    }
  }
  return rows;
}

/**
 * A CSV field, quoted when it holds a comma, quote or line break. Text that starts
 * with = + - @ (or a tab/CR) would run as a formula when the file is opened in Excel, and
 * comments come from the audience, so those get a leading apostrophe. Numbers
 * pass through untouched, so a negative number stays one.
 */
function csvField(value) {
  if (typeof value === 'number') return String(value);
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The results as CSV text: a header row, then resultsRows(), CRLF line ends. */
export function resultsToCsv(results) {
  return [COLUMNS, ...resultsRows(results)].map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}

/** A file name safe on every OS, e.g. "results-s-kroger-kickoff-2026-09-19.csv". */
export function exportFileName(results, extension) {
  const slug = String(results.session.id).replace(/[^\w-]+/g, '-');
  return `results-${slug}-${new Date().toISOString().slice(0, 10)}.${extension}`;
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

function saveFile(text, fileName, mimeType) {
  // The byte-order mark makes Excel read the file as UTF-8 (accents, curly quotes in comments).
  saveBlob(new Blob(['\ufeff', text], { type: `${mimeType};charset=utf-8` }), fileName);
}

/** Exports the session's current results as a CSV download. Resolves to the file name. */
export function downloadCsv(results) {
  const fileName = exportFileName(results, 'csv');
  saveFile(resultsToCsv(results), fileName, 'text/csv');
  return fileName;
}


// ---- One-page report (PDF and PPT) --------------------------------------------------------
// A branded summary of the session: a header band with the client's logo and colors, then a
// card per live question with the chart the Live display shows (Phase 11b): the same headline,
// "N of M got it right first time", bars in the same order, the correct answer with a tick and
// "Correct", the top choice, a scale's columns and average, a ranking's places and support
// scores, the words that came up most, all from lib/results-chart-model.js and drawn by
// lib/results-chart-figure.js in the colours of styles/results-tokens.css. Nobody is named: the
// charts are made with no names. It fits one page for a typical session and flows onto more
// pages otherwise.
//
// buildReport() turns the aggregated results into a plain model, layoutReport() places it
// on A4-landscape pages as rectangles, lines, ticks, text lines and images (all in
// millimetres), and the PDF and PPT writers only draw those. So the two files can't drift
// apart, and the writers hold no layout logic.

const PAGE = { width: 297, height: 210, margin: 12 };
const FOOTER_HEIGHT = 8;
const FONT = { pdf: 'helvetica', pptx: 'Arial' }; // metric-compatible, so one layout fits both

/** The model both files are drawn from: each live question's chart, with nobody's name in it. */
export function buildReport(results, brand = {}) {
  const sections = liveSections(results);
  const questions = sections.flatMap((section) => section.questions.map((question) => ({
    section: section.title,
    respondents: question.respondents,
    chart: chartOf(question, { names: null }),
  })));
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
    iPads: counts.visits,
    answers: counts.answers,
    questions,
  };
}

// ---- Colors
// The header band is the client's (its primary and secondary); everything in a card, and the
// footer, is the Results palette (lib/results-palette.js, read from results-tokens.css), passed in.

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
// Both formats use Arial-metric fonts, so approximate Arial glyph widths (in em) are close
// enough to wrap and truncate text. Rounded up a little, so a line that "fits" really does.
const PT_MM = 25.4 / 72;
function glyphWidth(char) {
  if (/[ilj.,:;'|!()\[\]’‘·]/.test(char)) return 0.28;
  if (/[frt\-“”"]/.test(char)) return 0.36;
  if (/[mwMW—%]/.test(char)) return 0.86;
  if (/[A-Z]/.test(char)) return 0.7;
  if (/[0-9]/.test(char)) return 0.56;
  return 0.54;
}
const textWidth = (text, size, bold) =>
  [...text].reduce((sum, char) => sum + glyphWidth(char), 0) * size * PT_MM * (bold ? 1.06 : 1);

/** Splits `text` into at most `maxLines` lines that fit `width` mm; the last one ends in "…" if cut. */
function wrap(text, width, size, { bold = false, maxLines = 1 } = {}) {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const fits = (line) => textWidth(line, size, bold) <= width;
  const lines = [];
  let line = '';
  for (let word of words) {
    while (!fits(word)) { // a single word wider than the line: break it
      const room = Math.max(1, [...word].findIndex((_, i) => !fits(word.slice(0, i + 1))));
      if (line) { lines.push(line); line = ''; }
      lines.push([...word].slice(0, room).join(''));
      word = [...word].slice(room).join('');
    }
    if (!line || fits(`${line} ${word}`)) line = line ? `${line} ${word}` : word;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  let last = `${lines[maxLines - 1]}…`;
  while (!fits(last) && last.length > 2) last = `${last.slice(0, -2)}…`;
  return [...lines.slice(0, maxLines - 1), last];
}

const lineHeight = (size) => size * PT_MM * 1.32;

/** The measure the chart figure lays its words out with (lib/results-chart-figure.js). */
const MEASURE = {
  wrap: (text, width, size, bold, max) => wrap(text, width, size, { bold, maxLines: max || 99 }),
  width: (text, size, bold) => textWidth(text, size, bold),
  lineHeight,
};

// ---- Layout
// Primitives: { kind: 'rect', x, y, w, h, fill?, stroke?, radius? }
//             { kind: 'line', x, y, x2, y2, color, width }                 (width in mm)
//             { kind: 'tick', x, y, size, color }                           (the mark beside a correct answer)
//             { kind: 'text', x, y, w, h, text, size, bold?, italic?, color, align? }  (one line, centred in h)
//             { kind: 'image', x, y, w, h, data }
// An item inside a question's card carries `card: true` (a test holds those to the palette).

const rect = (x, y, w, h, style = {}) => ({ kind: 'rect', x, y, w, h, ...style });
const label = (x, y, w, h, text, size, color, style = {}) => ({ kind: 'text', x, y, w, h, text, size, color, ...style });

/** The header band. Returns its primitives and its height. */
function layoutHeader(report, logo, { first }) {
  const { width, margin } = PAGE;
  const height = first ? 26 : 14;
  const ink = readableOn(report.primary);
  const items = [
    rect(0, 0, width, height, { fill: report.primary }),
    rect(0, height, width, 1.6, { fill: report.secondary }),
  ];
  let x = margin;
  if (logo && first) {
    // On a white plate, so a logo drawn for a light page still shows on any brand color.
    const plate = { w: 44, h: 17 };
    const y = (height - plate.h) / 2;
    items.push(rect(x, y, plate.w, plate.h, { fill: 'FFFFFF', radius: 2 }));
    const scale = Math.min((plate.w - 6) / logo.width, (plate.h - 6) / logo.height);
    const [w, h] = [logo.width * scale, logo.height * scale];
    items.push({ kind: 'image', x: x + (plate.w - w) / 2, y: y + (plate.h - h) / 2, w, h, data: logo.data });
    x += plate.w + 8;
  }
  const textWidthAvail = width - margin - x;
  if (first) {
    items.push(label(x, 4.5, textWidthAvail, 9, 'Session results', 22, ink, { bold: true }));
    const details = [
      report.clientName, report.sessionDate,
      answersFrom({ answers: report.answers, visits: report.iPads }),
    ].filter(Boolean).join('  ·  ');
    items.push(label(x, 15, textWidthAvail, 6, details, 11, ink));
  } else {
    items.push(label(x, 0, textWidthAvail, height, `${report.clientName ? `${report.clientName}  ·  ` : ''}Session results (continued)`, 11, ink, { bold: true }));
  }
  return { items, height: height + 1.6 };
}

const CARD = { pad: 3.5, headlineSize: 9.5, promptSize: 8.8, metaSize: 7.6, chartSize: 7.8, captionSize: 7.2, rule: 1 };
const MAX_COMMENTS = 3;

/** The figure's neutral items as this file's primitives: a text line keeps its box, centred in it. */
function fromFigure(item) {
  if (item.kind === 'text') return { ...item, color: bare(item.color) };
  if (item.kind === 'line' || item.kind === 'tick') return { ...item, color: bare(item.color) };
  return { ...item, ...(item.fill && { fill: bare(item.fill) }), ...(item.stroke && { stroke: bare(item.stroke) }) };
}

/** One question's card at (x, y), `w` wide. Returns { items, height } (height without the row stretch). */
function layoutCard(question, palette, x, y, w) {
  const { pad } = CARD;
  const { chart } = question;
  const inner = w - pad * 2;
  const items = [];
  const ink = bare(palette.text);
  const soft = bare(palette.textSecondary);
  let cursor = y + CARD.rule + pad - 0.6;
  const lines = (text, size, color, { bold = false, max = 2, after = 0 } = {}) => {
    for (const line of wrap(text, inner, size, { bold, maxLines: max })) {
      items.push(label(x + pad, cursor, inner, lineHeight(size), line, size, color, { bold }));
      cursor += lineHeight(size);
    }
    cursor += after;
  };

  // As the screen's card: the headline, the question, then how many answered and how many got it right first time.
  lines(chart.headline, CARD.headlineSize, ink, { bold: true, max: 3, after: 0.4 });
  lines(chart.prompt, CARD.promptSize, ink, { bold: true, max: 2, after: 0.4 });
  lines(`${question.section}  ·  ${chart.answered} answered`, CARD.metaSize, soft, { max: 2, after: chart.gradedLine ? 0 : 1.6 });
  if (chart.gradedLine) lines(chart.gradedLine, CARD.metaSize, soft, { bold: true, max: 2, after: 1.6 });

  const figure = chartFigure(chart, { x: x + pad, width: inner, palette, measure: MEASURE, size: CARD.chartSize, maxLabelLines: 2, comments: MAX_COMMENTS, plot: 14, points: false });
  for (const item of figure.items) items.push(fromFigure({ ...item, y: item.y + cursor, ...(item.y2 === undefined ? {} : { y2: item.y2 + cursor }) }));
  cursor += figure.h;
  if (chart.caption) { cursor += 0.6; lines(chart.caption, CARD.captionSize, soft, { max: 2 }); }
  if (chart.removedLine) { cursor += 0.6; lines(chart.removedLine, CARD.captionSize, soft, { max: 2 }); }
  return { items: items.map((item) => ({ ...item, card: true })), height: cursor + pad - y };
}

/** One layout attempt: cards `columns` across, and a row that doesn't fit below starts a new page. */
function layoutInColumns(report, logo, palette, columns) {
  const { width, height, margin } = PAGE;
  const gap = 8;
  const cardWidth = (width - margin * 2 - gap * (columns - 1)) / columns;
  const bottom = height - margin - FOOTER_HEIGHT;
  const pages = [];
  let page = null;
  let top = 0;
  let rowsOnPage = 0;

  const startPage = () => {
    rowsOnPage = 0;
    const header = layoutHeader(report, logo, { first: pages.length === 0 });
    page = { items: [...header.items] };
    pages.push(page);
    top = header.height + 6;
  };
  startPage();

  if (report.questions.length === 0) {
    page.items.push(label(margin, top, width - margin * 2, 8, 'No live questions in this session yet.', 12, bare(palette.textSecondary)));
  }

  for (let i = 0; i < report.questions.length; i += columns) {
    const row = report.questions.slice(i, i + columns);
    const cardX = (column) => margin + column * (cardWidth + gap);
    const measured = row.map((question, column) => layoutCard(question, palette, cardX(column), top, cardWidth));
    const rowHeight = Math.max(...measured.map((card) => card.height));
    if (top + rowHeight > bottom && rowsOnPage > 0) {
      startPage(); // doesn't fit below: continue on a fresh page
      i -= columns;
      continue;
    }
    row.forEach((_, column) => {
      // A white card with Deloitte Green along its top edge, as on the screen: the accent, never a bar.
      page.items.push(rect(cardX(column), top, cardWidth, rowHeight, { fill: bare(palette.surface), stroke: bare(palette.grid), radius: 2, card: true }));
      page.items.push(rect(cardX(column), top, cardWidth, CARD.rule, { fill: bare(palette.brand), card: true }));
      page.items.push(...measured[column].items);
    });
    top += rowHeight + 5;
    rowsOnPage += 1;
  }
  return pages;
}

/**
 * Places the report on pages: [{ items }]. It aims for one page, so it tries two and three
 * cards across and keeps the roomiest layout (fewest columns) that needs the fewest pages.
 * `palette` is the Results palette (lib/results-palette.js).
 */
export function layoutReport(report, logo = null, palette = null) {
  if (!palette) throw new Error('layoutReport needs the Results palette (lib/results-palette.js).');
  const { width, height, margin } = PAGE;
  let pages = null;
  for (const columns of [2, 3]) {
    const attempt = layoutInColumns(report, logo, palette, columns);
    if (!pages || attempt.length < pages.length) pages = attempt;
  }
  const stamp = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const soft = bare(palette.textSecondary);
  pages.forEach((page, index) => {
    page.items.push(label(margin, height - margin - 4, 150, 4, `Generated ${stamp}`, 7.5, soft));
    page.items.push(label(width - margin - 40, height - margin - 4, 40, 4, `Page ${index + 1} of ${pages.length}`, 7.5, soft, { align: 'right' }));
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

/** jsPDF's standard fonts only cover Latin-1 and a few punctuation marks. Emoji and other scripts are dropped, not printed as garbage. */
export const pdfSafe = (text) => text.replace(/[^\x20-\x7e\xa0-\xff‘’“”–—…•€™]/g, '').replace(/ {2,}/g, ' ');

/**
 * The PDF's bytes. `jsPDF` is handed in (the admin page's own copy; a node test passes jsPDF's node build).
 * @returns {ArrayBuffer}
 */
export function pdfBytes(pages, report, { jsPDF, producer = 'Pursuits CEC' }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [PAGE.width, PAGE.height] });
  doc.setProperties({ title: `${report.clientName || 'Session'} results`, creator: producer });
  doc.setLineWidth(0.25);
  const rgb = (hex) => channels(hex);

  pages.forEach((page, index) => {
    if (index > 0) doc.addPage([PAGE.width, PAGE.height], 'landscape');
    for (const item of page.items) {
      if (item.kind === 'rect') {
        const style = item.fill && item.stroke ? 'FD' : item.fill ? 'F' : 'S';
        if (item.fill) doc.setFillColor(...rgb(item.fill));
        if (item.stroke) doc.setDrawColor(...rgb(item.stroke));
        if (item.radius) doc.roundedRect(item.x, item.y, item.w, item.h, item.radius, item.radius, style);
        else doc.rect(item.x, item.y, item.w, item.h, style);
      } else if (item.kind === 'line') {
        doc.setDrawColor(...rgb(item.color));
        doc.setLineWidth(item.width ?? 0.25);
        doc.line(item.x, item.y, item.x2, item.y2);
      } else if (item.kind === 'tick') {
        const { strokes, width } = tickStrokes(item);
        doc.setDrawColor(...rgb(item.color));
        doc.setLineWidth(width);
        doc.setLineCap('round');
        for (const [x1, y1, x2, y2] of strokes) doc.line(x1, y1, x2, y2);
        doc.setLineCap('butt');
      } else if (item.kind === 'image') {
        doc.addImage(item.data, 'PNG', item.x, item.y, item.w, item.h, undefined, 'FAST'); // compressed, or the logo alone is over a megabyte
      } else {
        doc.setFont(FONT.pdf, item.bold ? 'bold' : item.italic ? 'italic' : 'normal');
        doc.setFontSize(item.size);
        doc.setTextColor(...rgb(item.color));
        const align = item.align ?? 'left';
        const at = align === 'right' ? item.x + item.w : align === 'center' ? item.x + item.w / 2 : item.x;
        doc.text(pdfSafe(item.text), at, item.y + item.h / 2, { align, baseline: 'middle' });
      }
    }
  });
  return doc.output('arraybuffer');
}

/**
 * Exports a one-page branded PDF of the session's results. Resolves to the file name.
 * `brand.appName`, when given, is written as the PDF's creator instead of the original product name; `brand.palette` is the
 * Results palette (lib/results-palette-source.ts RESULTS_PALETTE).
 */
export async function downloadPdf(results, brand = {}) {
  const [, logo] = await Promise.all([loadScript('../vendor/jspdf/dist/jspdf.umd.min.js'), loadLogo(brand.logoUrl)]);
  const report = buildReport(results, brand);
  const fileName = exportFileName(results, 'pdf');
  saveBlob(new Blob([pdfBytes(layoutReport(report, logo, brand.palette), report, { jsPDF: window.jspdf.jsPDF, producer: brand.appName })], { type: 'application/pdf' }), fileName);
  return fileName;
}

// ---- PPT

const inches = (mm) => mm / 25.4;

/**
 * The PowerPoint file: a Blob, or with `outputType: 'nodebuffer'` (a node test) a Buffer. `PptxGenJS` is handed in, as `jsPDF` is.
 */
export async function pptxFile(pages, report, { PptxGenJS, producer = 'Pursuits CEC', outputType = 'blob' }) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'A4_LANDSCAPE', width: inches(PAGE.width), height: inches(PAGE.height) });
  pptx.layout = 'A4_LANDSCAPE';
  pptx.title = `${report.clientName || 'Session'} results`;
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
          ...box, fontFace: FONT.pptx, fontSize: item.size, bold: item.bold, italic: item.italic,
          color: item.color, align: item.align ?? 'left', valign: 'middle', margin: 0, wrap: false,
        });
      }
    }
  }
  return pptx.write({ outputType });
}

/** Exports the same one-pager as a PowerPoint slide (company = `brand.appName` when given). Resolves to the file name. */
export async function downloadPptx(results, brand = {}) {
  const [, logo] = await Promise.all([loadScript('../vendor/pptxgenjs/dist/pptxgen.bundle.js'), loadLogo(brand.logoUrl)]);
  const report = buildReport(results, brand);
  const fileName = exportFileName(results, 'pptx');
  saveBlob(await pptxFile(layoutReport(report, logo, brand.palette), report, { PptxGenJS: window.PptxGenJS, producer: brand.appName }), fileName);
  return fileName;
}
