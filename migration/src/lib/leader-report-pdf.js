// Draws the leader report's pages (lib/leader-report-layout.js) with jsPDF: rectangles, lines, single lines of text in the embedded
// Open Sans, the client's logo as a picture, and two shapes that are paths (the tick and cross beside an answer, and the Deloitte
// wordmark). No HTML is rendered and nothing here decides where anything goes. It draws a page, says so, and lets the browser
// breathe before the next, so the screen can show "Preparing page 12 of 40" and a Cancel that works.
//
// jsPDF is handed in (the admin page loads it only when an export is first used; a node test passes its own), so this file
// imports nothing heavy. Plain JS with JSDoc and no DOM.

import { PAGE } from './leader-report-layout.js';
import { binaryString } from './report-fonts.js';

/** @typedef {{ viewBox: number[], shapes: ({ d: string, fill: string } | { rect: number[], fill: string })[] }} Wordmark */

const rgb = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

/**
 * An SVG path as moves, lines, curves and closes, every point measured from the origin: enough of the path language for the wordmark
 * (M L H V C S Z, either case). A shape using anything else is refused, not drawn wrongly.
 * @param {string} d
 * @returns {{ op: 'm' | 'l' | 'c' | 'h', c: number[] }[]}
 */
export function svgPath(d) {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/g) ?? [];
  const out = [];
  let at = 0;
  let [x, y, startX, startY, lastX, lastY] = [0, 0, 0, 0, 0, 0];
  let command = '';
  const number = () => Number(tokens[at++]);
  while (at < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[at])) command = tokens[at++];
    const relative = command === command.toLowerCase();
    const [dx, dy] = relative ? [x, y] : [0, 0];
    switch (command.toLowerCase()) {
      case 'm': x = number() + dx; y = number() + dy; [startX, startY] = [x, y]; out.push({ op: 'm', c: [x, y] }); command = relative ? 'l' : 'L'; break;
      case 'l': x = number() + dx; y = number() + dy; out.push({ op: 'l', c: [x, y] }); break;
      case 'h': x = number() + dx; out.push({ op: 'l', c: [x, y] }); break;
      case 'v': y = number() + dy; out.push({ op: 'l', c: [x, y] }); break;
      case 'c': case 's': {
        // A smooth curve's first control point mirrors the last one of the curve before it.
        const [x1, y1] = command.toLowerCase() === 'c' ? [number() + dx, number() + dy] : [2 * x - lastX, 2 * y - lastY];
        const [x2, y2] = [number() + dx, number() + dy];
        x = number() + dx; y = number() + dy;
        out.push({ op: 'c', c: [x1, y1, x2, y2, x, y] });
        [lastX, lastY] = [x2, y2];
        continue;
      }
      case 'z': x = startX; y = startY; out.push({ op: 'h', c: [] }); break;
      default: throw new Error(`The wordmark uses a path command this report cannot draw: ${command}`);
    }
    [lastX, lastY] = [x, y];
  }
  return out;
}

/** The wordmark at (x, y), `width` wide. Its white letters are drawn black, for a white page; the green dot keeps its colour. */
function drawWordmark(doc, wordmark, x, y, width) {
  const [minX, minY, boxWidth] = wordmark.viewBox;
  const scale = width / boxWidth;
  const px = (value) => x + (value - minX) * scale;
  const py = (value) => y + (value - minY) * scale;
  for (const shape of wordmark.shapes) {
    doc.setFillColor(.../^#f{3}(?:f{3})?$/i.test(shape.fill) ? [0, 0, 0] : rgb(shape.fill.length === 4 ? `#${[...shape.fill.slice(1)].map((c) => c + c).join('')}` : shape.fill));
    if ('rect' in shape) { doc.rect(px(shape.rect[0]), py(shape.rect[1]), shape.rect[2] * scale, shape.rect[3] * scale, 'F'); continue; }
    for (const { op, c } of svgPath(shape.d)) {
      if (op === 'm') doc.moveTo(px(c[0]), py(c[1]));
      else if (op === 'l') doc.lineTo(px(c[0]), py(c[1]));
      else if (op === 'c') doc.curveTo(px(c[0]), py(c[1]), px(c[2]), py(c[3]), px(c[4]), py(c[5]));
      else doc.close();
    }
    doc.fill();
  }
}

/**
 * The finished PDF's bytes.
 * @param {object} input
 * @param {any} input.jsPDF The jsPDF class.
 * @param {{ items: any[] }[]} input.pages
 * @param {import('./report-fonts.js').ReportFonts} input.fonts
 * @param {Wordmark | null} [input.wordmark]
 * @param {{ title: string, subject?: string, creator?: string }} input.properties
 * @param {(progress: { page: number, pages: number }) => void} [input.onProgress] Called before each page is drawn.
 * @param {AbortSignal | null} [input.signal] Cancel: the promise rejects with an AbortError and nothing is saved.
 * @param {() => Promise<void>} [input.pause] What "let the browser breathe" is; a test passes its own.
 * @returns {Promise<ArrayBuffer>}
 */
export async function writeLeaderReportPdf({ jsPDF, pages, fonts, wordmark = null, properties, onProgress = () => {}, signal = null, pause = () => new Promise((resolve) => { setTimeout(resolve, 0); }) }) {
  const doc = new jsPDF({ unit: 'mm', format: [PAGE.width, PAGE.height], orientation: 'portrait', compress: true, putOnlyUsedFonts: true });
  doc.setProperties(properties);
  // The document's language (Phase 13), so a screen reader reads it as English.
  doc.setLanguage('en-US');
  for (const face of [fonts.regular, fonts.bold]) {
    doc.addFileToVFS(face.file, binaryString(face.bytes));
    doc.addFont(face.file, face.name, 'normal');
  }
  doc.setLineCap('round');
  doc.setLineJoin('round');
  for (let index = 0; index < pages.length; index += 1) {
    if (signal?.aborted) throw new DOMException('The report was cancelled.', 'AbortError');
    onProgress({ page: index + 1, pages: pages.length });
    if (index > 0) doc.addPage([PAGE.width, PAGE.height], 'portrait');
    for (const item of pages[index].items) {
      if (item.kind === 'text') {
        if (!item.text) continue;
        doc.setFont((item.bold ? fonts.bold : fonts.regular).name, 'normal');
        doc.setFontSize(item.size);
        doc.setTextColor(...rgb(item.color));
        const align = item.align ?? 'left';
        doc.text(item.text, align === 'right' ? item.x + item.w : align === 'center' ? item.x + item.w / 2 : item.x, item.y, { align });
      } else if (item.kind === 'rect') {
        if (item.fill) doc.setFillColor(...rgb(item.fill));
        if (item.stroke) { doc.setDrawColor(...rgb(item.stroke)); doc.setLineWidth(0.2); }
        const style = item.fill && item.stroke ? 'FD' : item.fill ? 'F' : 'S';
        if (item.radius) doc.roundedRect(item.x, item.y, item.w, item.h, item.radius, item.radius, style);
        else doc.rect(item.x, item.y, item.w, item.h, style);
      } else if (item.kind === 'line') {
        doc.setDrawColor(...rgb(item.color));
        doc.setLineWidth(item.width ?? 0.2);
        doc.line(item.x, item.y, item.x2, item.y2);
      } else if (item.kind === 'tick' || item.kind === 'cross') {
        const { x, y, size } = item;
        doc.setDrawColor(...rgb(item.color));
        doc.setLineWidth(size * 0.17);
        if (item.kind === 'tick') doc.lines([[size * 0.3, size * 0.3], [size * 0.55, size * 0.68 * -1]], x + size * 0.08, y + size * 0.55, [1, 1], 'S', false);
        else { doc.line(x + size * 0.16, y + size * 0.16, x + size * 0.84, y + size * 0.84); doc.line(x + size * 0.84, y + size * 0.16, x + size * 0.16, y + size * 0.84); }
      } else if (item.kind === 'image') {
        doc.addImage(item.data, 'PNG', item.x, item.y, item.w, item.h, 'client-logo', 'FAST');
      } else if (item.kind === 'wordmark' && wordmark) {
        drawWordmark(doc, wordmark, item.x, item.y, item.w);
      }
    }
    await pause();
  }
  if (signal?.aborted) throw new DOMException('The report was cancelled.', 'AbortError');
  return doc.output('arraybuffer');
}
