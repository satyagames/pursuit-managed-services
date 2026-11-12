// The Live display's files (the summary pack as PDF and PowerPoint, and Summary by activity as CSV). The admin page's alone: the bundle test
// keeps it out of the participant page. It was public/js/resultsExport.js until Phase 14.
/**
 * resultsExport.js: turns a session's aggregated results (the tree that
 * migration/src/lib/results/session-results.js readSessionResults() returns) into files for the facilitator.
 *
 *   CSV  summary by activity (Phase 13): summaryRows() and resultsToCsv() build it, downloadCsv() saves it.
 *   PDF  downloadPdf(): the summary pack (jsPDF): a summary page, then a page for each live activity (Phase 13).
 *   PPT  downloadPptx(): the same pack as 16:9 slides with speaker notes (PptxGenJS).
 *
 * Nothing here fetches data. Every file shows each question as the Live display's chart does,
 * from the same chart model (Phase 11b) and the same takeaways (lib/results/export-summary.js, Phase 13),
 * so every file agrees with what the screen shows. The PDF and PPT are built from one layout
 * (see "The summary pack"), so they match each other too. The caller passes the client's brand (branding.js's currentBrand()) and the
 * Results palette; without a brand the report is unbranded.
 */

import { embeddedAssetUrl } from '../brand/assets.js';
import { markShape } from '../results/results-chart-figure.js';
import { binaryString, createMeasure, loadReportFonts } from './report-fonts.js';
import { packPalette } from './report-look.js';
import { PACK_PAGE, SHEET, SHEET_OFFSET, FONT, buildReport, channels, layoutReport, tickStrokes } from './summary-pack.js';
import { exportFileName, saveBlob } from './summary-csv.js';
// (Prompt 44: the CSV is lib/exports/summary-csv.js, the pack's model and layout lib/exports/summary-pack.js; their names are passed on here, as before.)
export { liveSections, PACK_PAGE, PACK_BODY_BOTTOM, buildReport, layoutReport } from './summary-pack.js';
export { SUMMARY_COLUMNS, summaryRows, resultsToCsv, summaryCsvFile, exportFileName, downloadCsv } from './summary-csv.js';

// (The charts' palette in each look is report-look.js's, shared with the leader report; passed on here as it always was.)
export { packPalette };
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
 * The PDF's bytes: each 16:9 page in the middle of an A4 landscape sheet, its words in the embedded Open Sans (`fonts`, lib/exports/report-fonts.js
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
    // (Prompt 34) A Dark page fills its whole sheet black; a Light one leaves the paper white.
    if (page.background && page.background !== 'FFFFFF') { doc.setFillColor(...rgb(page.background)); doc.rect(0, 0, SHEET.width, SHEET.height, 'F'); }
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
      } else if (item.kind === 'mark') {
        const { circle, triangle } = markShape({ ...item, y: item.y + dy });
        doc.setFillColor(...rgb(item.color));
        if (circle) doc.circle(circle.cx, circle.cy, circle.r, 'F');
        else doc.triangle(...triangle.flat(), 'F');
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
 * Results palette (lib/results/results-palette-source.ts RESULTS_PALETTE).
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
    slide.background = { color: page.background ?? 'FFFFFF' };
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
      } else if (item.kind === 'mark') {
        const { circle, flip } = markShape(item);
        const size = circle ? circle.r * 2 : item.size;
        const at = circle ? { x: circle.cx - circle.r, y: circle.cy - circle.r } : { x: item.x, y: item.y };
        slide.addShape(circle ? pptx.ShapeType.ellipse : pptx.ShapeType.triangle, {
          x: inches(at.x), y: inches(at.y), w: inches(size), h: inches(size), flipV: Boolean(flip), fill: { color: item.color }, line: { type: 'none' },
        });
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
