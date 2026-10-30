// A Results chart on paper (Phase 11b): what the screen's charts (admin/charts/) draw, as rectangles, lines, ticks and single lines of text in
// millimetres, from the chart model (lib/results/results-chart-model.js chartOf) and the palette (lib/results/results-palette.js). The Live display's one-page
// PDF and PowerPoint (migration/src/lib/exports/resultsExport.js) and the leader report (lib/exports/leader-report-layout.js) both draw their charts with it, so the two
// files and the screen show the same bars, in the same order and colours, with the same words:
//   - single and multiple choice, and a ranking: one bar a row, the label on the left (wrapped, cut only past `maxLabelLines`), the value on the
//     right; the top choice full blue and "Top choice", the correct answer Dark Green with a tick and "Correct" in bold, the rest the tint; a
//     ranking's place before its label and its support score as the bar;
//   - true or false: the two sides as one bar, each with its share, and the correct side's tick and word;
//   - a confidence scale: a column for each step in the blue ramp, its share above it, its words below, and the average as a line with its words;
//   - written answers: the words that came up most, and (when asked) the first few comments, with nobody's name.
// Nothing is coloured that the screen does not colour, and right or wrong is never colour alone. No numbers are worked out here.
//
// The caller measures text (its own fonts) and turns the neutral items into its own: a text item is ONE line, `y` the top of its line box and
// `h` that box's height, `w` the box it must stay inside. Plain JS with JSDoc and no DOM.

import { MULTI_CAPTION, WORDS_HEADING, people } from './results-chart-model.js';
import { rampFill, toneFill } from './results-palette.js';

export { MULTI_CAPTION };

/** @typedef {import('./results-palette.js').Palette} Palette */
/** @typedef {{ kind: string, x: number, y: number, [key: string]: any }} Item */
/**
 * @typedef {object} Measure
 * @property {(text: string, width: number, size: number, bold: boolean, max: number) => string[]} wrap Lines that fit `width`; at most `max` (0: no limit), the last ending in an ellipsis when something was left out.
 * @property {(text: string, size: number, bold: boolean) => number} width
 * @property {(size: number) => number} lineHeight
 */

/** The words of a bar row's value: "3 · 75%" (as the screen's bars), or a ranking's support score, and its points when asked. */
export function valueOf(chart, row, { points = false } = {}) {
  if (chart.kind === 'ranking') return points ? `Support ${row.score} · ${row.points} pts` : `Support ${row.score}`;
  return `${row.count} · ${row.percent}%`;
}

/** Each bar row as the screen's ResultCard builds them: its fill, its share of the track, its tags. */
export function barRows(chart) {
  if (chart.kind === 'ranking') {
    return chart.options.map((item) => ({ id: item.id, label: item.label, row: item, fraction: clamp(item.score / 100), tone: item.rank === 1 && chart.answered > 0 ? 'top' : 'rest', tags: [], rank: item.rankLabel, strong: false }));
  }
  return chart.options.map((option) => ({
    id: option.id, label: option.label, row: option, fraction: clamp(option.share), rank: '',
    tone: option.isCorrect ? 'correct' : option.isTop ? 'top' : 'rest',
    strong: option.isCorrect,
    tags: [...(option.isCorrect ? [{ text: 'Correct', tick: true }] : []), ...(option.isTop ? [{ text: 'Top choice', tick: false }] : [])],
  }));
}

const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));

/**
 * The chart of one question at (x, 0), `width` wide.
 * @param {any} chart chartOf(question, { names: null })
 * @param {{ x: number, width: number, palette: Palette, measure: Measure, size?: number, maxLabelLines?: number, comments?: number, plot?: number, points?: boolean, matrixRows?: number }} options
 * @returns {{ h: number, items: Item[], breaks?: number[] }}
 */
export function chartFigure(chart, { x, width, palette, measure, size = 8.5, maxLabelLines = 2, comments = 0, plot = 18, points = false, matrixRows = 25 }) {
  if (chart.kind === 'matrix') return matrixFigure(chart, { x, width, palette, measure, size, maxLabelLines, matrixRows });
  if (chart.kind === 'text') return wordsFigure(chart, { x, width, palette, measure, size, comments });
  if (chart.answered === 0 && chart.kind !== 'scale') return { h: 0, items: [] };
  if (chart.kind === 'truefalse' && chart.sides) return splitFigure(chart, { x, width, palette, measure, size });
  if (chart.kind === 'scale' && chart.scale) return scaleFigure(chart, { x, width, palette, measure, size, plot });
  return barsFigure(chart, { x, width, palette, measure, size, maxLabelLines, points });
}

/** A line of text: one line, its box `w` wide and `h` high, its top at `y`. */
const line = (x, y, w, h, text, size, color, style = {}) => ({ kind: 'text', x, y, w, h, text, size, color, ...style });

/**
 * An Art of the Possible heat map (Prompt 23): a row for each sub-process, its people, a shaded cell with the mean for each criterion, its opportunity, and its band with the shape and
 * the word (never colour alone). The shades are the screen's four steps of the blue ramp; the words on them are white from the third. `matrixRows` is how many are drawn (the pack's page
 * has room for 10), and a line says how many more there are.
 */
function matrixFigure(chart, { x, width, palette, measure, size, maxLabelLines, matrixRows }) {
  const lh = measure.lineHeight(size);
  const small = size * 0.88;
  const smallLh = measure.lineHeight(small);
  const criteria = chart.criteria ?? [];
  const peopleWidth = Math.max(10, width * 0.08);
  const scoreWidth = Math.max(16, width * 0.11);
  const bandWidth = Math.max(16, width * 0.11);
  const labelWidth = Math.max(20, width * 0.3);
  const cellWidth = Math.max(8, (width - labelWidth - peopleWidth - scoreWidth - bandWidth) / Math.max(1, criteria.length));
  const peopleX = x + labelWidth;
  const cellX = peopleX + peopleWidth;
  const scoreX = cellX + cellWidth * criteria.length;
  const bandX = scoreX + scoreWidth;
  const items = [];
  const breaks = [];
  let y = 0;
  // The header: each column's name, in as many lines as it takes.
  const heads = criteria.map((criterion) => measure.wrap(criterion.label, cellWidth - 0.6, small, true, 3));
  const headHeight = Math.max(1, ...heads.map((lines) => lines.length)) * smallLh + 1;
  items.push(line(peopleX, y, peopleWidth - 0.5, smallLh, 'People', small, palette.textSecondary, { bold: true, role: 'head' }));
  heads.forEach((lines, at) => lines.forEach((text, n) => items.push(line(cellX + at * cellWidth, y + n * smallLh, cellWidth - 0.6, smallLh, text, small, palette.textSecondary, { bold: true, role: 'head' }))));
  items.push(line(scoreX, y, scoreWidth - 0.5, smallLh, 'Opportunity', small, palette.textSecondary, { bold: true, role: 'head' }));
  items.push(line(bandX, y, bandWidth, smallLh, 'Band', small, palette.textSecondary, { bold: true, role: 'head' }));
  y += headHeight;
  breaks.push(y);
  const bandInk = { High: palette.bandHigh, Medium: palette.bandMedium, Low: palette.bandLow };
  const shown = chart.rows.slice(0, matrixRows);
  for (const row of shown) {
    const labels = measure.wrap(row.label, labelWidth - 1, size, false, maxLabelLines);
    const height = Math.max(labels.length * lh, lh) + 1.4;
    labels.forEach((text, at) => items.push(line(x, y + at * lh, labelWidth - 1, lh, text, size, palette.text, { role: 'label' })));
    items.push(line(peopleX, y, peopleWidth - 0.5, lh, String(row.people), size, palette.text, { role: 'people' }));
    row.criteria.forEach((cell, at) => {
      if (cell.tone !== null) items.push({ kind: 'rect', x: cellX + at * cellWidth, y, w: cellWidth - 0.6, h: height - 0.6, fill: palette.ramps[4][cell.tone], role: 'heat' });
      if (cell.meanText) items.push(line(cellX + at * cellWidth + 0.8, y, cellWidth - 2, lh, cell.meanText, size, cell.tone >= 2 ? palette.surface : palette.text, { bold: true, role: 'value' }));
    });
    if (row.opportunityText) items.push(line(scoreX, y, scoreWidth - 0.5, lh, row.opportunityText, size, palette.text, { bold: true, role: 'value' }));
    items.push(line(bandX, y, bandWidth, lh, row.band ? `${row.mark} ${row.band}` : 'No ratings', small, bandInk[row.band] ?? palette.textSecondary, { bold: true, role: 'band' }));
    y += height;
    breaks.push(y);
  }
  const more = chart.rows.length - shown.length;
  if (more > 0) {
    items.push(line(x, y, width, smallLh, `And ${more} more ${more === 1 ? 'sub-process' : 'sub-processes'}.`, small, palette.textSecondary, { role: 'more' }));
    y += smallLh;
    breaks[breaks.length - 1] = y;
  }
  return { h: y, items, breaks };
}

function barsFigure(chart, { x, width, palette, measure, size, maxLabelLines, points }) {
  const lh = measure.lineHeight(size);
  const tagSize = size * 0.88;
  const tagLh = measure.lineHeight(tagSize);
  const rows = barRows(chart);
  const rankWidth = chart.kind === 'ranking' ? Math.max(...rows.map((row) => measure.width(row.rank, size, true)), measure.width('0', size, true)) + 2 : 0;
  const values = rows.map((row) => valueOf(chart, row.row, { points }));
  const valueWidth = Math.max(...values.map((value) => measure.width(value, size, true))) + 0.5;
  const labelWidth = Math.max(18, width * 0.42 - rankWidth);
  const barX = x + rankWidth + labelWidth + 2;
  const barWidth = Math.max(10, width - rankWidth - labelWidth - 2 - valueWidth - 2);
  const barHeight = Math.min(3.4, lh * 0.72);
  const items = [];
  /** Where one row ends and the next begins: a caller that flows a chart over pages may break it there. */
  const breaks = [];
  let y = 0;
  rows.forEach((row, index) => {
    const labels = measure.wrap(row.label, labelWidth, size, row.strong, maxLabelLines);
    const tagsHeight = row.tags.length > 0 ? tagLh : 0;
    const height = Math.max(labels.length * lh + tagsHeight, lh) + 1.2;
    if (row.rank) items.push(line(x, y, rankWidth - 1, lh, row.rank, size, palette.text, { bold: true, align: 'right', role: 'rank' }));
    labels.forEach((text, at) => items.push(line(x + rankWidth, y + at * lh, labelWidth, lh, text, size, palette.text, { bold: row.strong, role: 'label' })));
    if (row.tags.length > 0) {
      let tagX = x + rankWidth;
      const tagY = y + labels.length * lh;
      for (const tag of row.tags) {
        if (tag.tick) {
          items.push({ kind: 'tick', x: tagX, y: tagY + (tagLh - tagSize * 0.3) / 2, size: tagSize * 0.3, color: palette.correct });
          tagX += tagSize * 0.3 + 0.8;
        }
        const words = tag.text;
        const w = measure.width(words, tagSize, true);
        items.push(line(tagX, tagY, Math.min(w + 0.5, x + rankWidth + labelWidth - tagX), tagLh, words, tagSize, tag.tick ? palette.text : palette.textSecondary, { bold: true, role: 'tag' }));
        tagX += w + 2.4;
      }
    }
    const barY = y + (lh - barHeight) / 2;
    // The gridlines at 0, 50 and 100% (as the screen's), drawn row by row so a chart can carry on overleaf between two rows.
    for (const at of [0, 0.5, 1]) items.push({ kind: 'line', x: barX + at * barWidth, y, x2: barX + at * barWidth, y2: y + height, color: palette.grid, width: 0.2, role: 'grid' });
    if (row.fraction > 0) items.push({ kind: 'rect', x: barX, y: barY, w: Math.max(0.6, row.fraction * barWidth), h: barHeight, fill: toneFill(palette, /** @type {any} */ (row.tone)), role: 'bar', tone: row.tone, of: row.id });
    items.push(line(barX + barWidth + 2, y, valueWidth, lh, values[index], size, palette.text, { bold: true, align: 'right', role: 'value' }));
    y += height;
    breaks.push(y);
  });
  return { h: y, items, breaks };
}

function splitFigure(chart, { x, width, palette, measure, size }) {
  const lh = measure.lineHeight(size);
  const tagSize = size * 0.88;
  const tagLh = measure.lineHeight(tagSize);
  const half = (width - 4) / 2;
  const items = [];
  const [left, right] = chart.sides;
  const sides = [[left, x, 'left'], [right, x + width - half, 'right']];
  const tagged = sides.some(([side]) => side.isCorrect);
  for (const [side, at, align] of sides) {
    const label = measure.wrap(side.label, half, size, true, 1)[0];
    items.push(line(at, 0, half, lh, label, size, palette.text, { bold: true, align, role: 'label' }));
    items.push(line(at, lh, half, lh, `${people(side.count)} · ${side.percent}%`, size, palette.text, { align, role: 'value' }));
    if (side.isCorrect) {
      const w = measure.width('Correct', tagSize, true);
      const tick = tagSize * 0.3;
      const start = align === 'left' ? at : at + half - w - tick - 0.8;
      items.push({ kind: 'tick', x: start, y: lh * 2 + (tagLh - tick) / 2, size: tick, color: palette.correct });
      items.push(line(start + tick + 0.8, lh * 2, w + 0.5, tagLh, 'Correct', tagSize, palette.text, { bold: true, role: 'tag' }));
    }
  }
  const barY = lh * 2 + (tagged ? tagLh : 0) + 0.8;
  const barHeight = Math.min(4.2, lh * 0.9);
  items.push({ kind: 'line', x, y: barY - 0.6, x2: x, y2: barY + barHeight + 0.6, color: palette.grid, width: 0.2, role: 'grid' });
  items.push({ kind: 'line', x: x + width, y: barY - 0.6, x2: x + width, y2: barY + barHeight + 0.6, color: palette.grid, width: 0.2, role: 'grid' });
  const tone = (side) => (side.isCorrect ? 'correct' : side.isTop ? 'top' : 'rest');
  const leftWidth = clamp(left.share) * width;
  const rightWidth = clamp(right.share) * width;
  if (leftWidth > 0) items.push({ kind: 'rect', x, y: barY, w: Math.max(0.6, leftWidth), h: barHeight, fill: toneFill(palette, tone(left)), role: 'bar', tone: tone(left), of: left.id });
  // A thin white gap between the two sides, so they are two marks even in greyscale.
  if (rightWidth > 0) items.push({ kind: 'rect', x: x + width - rightWidth, y: barY, w: Math.max(0.6, rightWidth), h: barHeight, fill: toneFill(palette, tone(right)), role: 'bar', tone: tone(right), of: right.id });
  if (leftWidth > 0 && rightWidth > 0) items.push({ kind: 'rect', x: x + leftWidth - 0.3, y: barY, w: 0.6, h: barHeight, fill: palette.surface, role: 'gap' });
  return { h: barY + barHeight + 1.4, items };
}

function scaleFigure(chart, { x, width, palette, measure, size, plot }) {
  // As the screen's ScaleChart: the average's words above the plot; behind the columns every other band shaded; each column as tall as its
  // count against the tallest, with its count and share on top; the average as a line across the plot, with a mark under the axis; the steps'
  // words under it, and with more than three steps the bands' names under those.
  const { scale } = chart;
  const steps = scale.steps;
  const lh = measure.lineHeight(size);
  const labelSize = size * 0.92;
  const labelLh = measure.lineHeight(labelSize);
  const stepWidth = width / Math.max(1, steps.length);
  const column = Math.max(3, Math.min(stepWidth * 0.4, 14, stepWidth - 1));
  const peak = Math.max(1, ...steps.map((step) => step.count));
  const items = [];
  const plotTop = (scale.averageAt === null ? 0 : lh + 0.8) + lh;
  const base = plotTop + plot;
  scale.bands.forEach((band, index) => {
    if (index % 2 === 0) items.push({ kind: 'rect', x: x + stepWidth * band.from, y: plotTop - lh, w: stepWidth * (band.to - band.from + 1), h: base - plotTop + lh, fill: palette.bandShade, role: 'band' });
  });
  const at = scale.averageAt === null ? null : x + stepWidth * (scale.averageAt + 0.5);
  if (at !== null) items.push({ kind: 'line', x: at, y: plotTop, x2: at, y2: base + 1.2, color: palette.marker, width: 0.6, role: 'average' });
  steps.forEach((step, index) => {
    const centre = x + stepWidth * (index + 0.5);
    const height = (step.count / peak) * plot;
    if (height > 0) items.push({ kind: 'rect', x: centre - column / 2, y: base - Math.max(0.5, height), w: column, h: Math.max(0.5, height), fill: rampFill(palette, step.tone, scale.tones), role: 'bar', of: step.id });
    items.push(line(centre - stepWidth / 2, base - height - lh, stepWidth, lh, `${step.count} · ${step.percent}%`, size, palette.text, { bold: true, align: 'center', role: 'value' }));
    measure.wrap(step.label, stepWidth - 1.2, labelSize, false, 2).forEach((text, line_) => items.push(line(centre - stepWidth / 2 + 0.6, base + 1.6 + line_ * labelLh, stepWidth - 1.2, labelLh, text, labelSize, palette.textSecondary, { align: 'center', role: 'label' })));
  });
  items.push({ kind: 'line', x, y: base, x2: x + width, y2: base, color: palette.grid, width: 0.25, role: 'axis' });
  if (at !== null) {
    const words = scale.averageText;
    const w = measure.width(words, size, true) + 0.5;
    const left = Math.max(x, Math.min(x + width - w, at - w / 2));
    items.push(line(left, 0, w, lh, words, size, palette.text, { bold: true, role: 'average-label' }));
  }
  const labelLines = Math.max(1, ...steps.map((step) => measure.wrap(step.label, stepWidth - 1.2, labelSize, false, 2).length));
  let h = base + 1.6 + labelLines * labelLh + 0.6;
  if (steps.length > 3) {
    for (const band of scale.bands) {
      const span = stepWidth * (band.to - band.from + 1);
      items.push(line(x + stepWidth * band.from + 0.6, h, span - 1.2, labelLh, measure.wrap(band.name, span - 1.2, labelSize, true, 1)[0] ?? '', labelSize, palette.textSecondary, { bold: true, align: 'center', role: 'band-name' }));
    }
    h += labelLh + 0.6;
  }
  return { h, items };
}

function wordsFigure(chart, { x, width, palette, measure, size, comments }) {
  const lh = measure.lineHeight(size);
  const items = [];
  let y = 0;
  if (chart.words.length > 0) {
    items.push(line(x, y, width, lh, WORDS_HEADING, size, palette.text, { bold: true, role: 'words-heading' }));
    y += lh;
    for (const text of measure.wrap(chart.words.map((word) => `${word.word} (${word.count})`).join(', '), width, size, false, 3)) {
      items.push(line(x, y, width, lh, text, size, palette.text, { role: 'words' }));
      y += lh;
    }
    y += 1;
  }
  const shown = chart.comments.slice(0, comments);
  for (const comment of shown) {
    for (const text of measure.wrap(`“${comment.text}”`, width, size, false, 2)) {
      items.push(line(x, y, width, lh, text, size, palette.text, { role: 'comment' }));
      y += lh;
    }
    y += 0.8;
  }
  const more = chart.comments.length - shown.length;
  if (comments > 0 && more > 0) {
    items.push(line(x, y, width, lh, `+ ${more} more ${more === 1 ? 'comment' : 'comments'}`, size * 0.92, palette.textSecondary, { role: 'more' }));
    y += lh;
  }
  return { h: y, items };
}
