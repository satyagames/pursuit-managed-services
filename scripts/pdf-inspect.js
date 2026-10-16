// Reads a finished PDF back with pdf.js (a dev dependency: it is in no page), so a test can assert what a reader of the file
// gets: the words on each page and where they are, the page sizes, and whether every font is embedded. Used by
// scripts/test-leader-report.js (node) and scripts/migration-tests/leader-report.spec.ts (the file a browser downloaded).

import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';

const MM = 25.4 / 72; // one PDF point in millimetres

/**
 * @param {Uint8Array | ArrayBuffer | Buffer} data
 * @returns {Promise<{ pages: { width: number, height: number, items: { text: string, x: number, y: number, width: number, size: number, font: string }[], text: string }[], fonts: { name: string, embedded: boolean, type: string }[], info: Record<string, any> }>}
 * Positions are millimetres from the page's top-left corner, like the report's own layout; `y` is the baseline.
 */
export async function inspectPdf(data) {
  const bytes = new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  const pdf = await getDocument({ data: bytes, useSystemFonts: false, disableFontFace: true, fontExtraProperties: true, verbosity: VerbosityLevel.ERRORS }).promise;
  const fonts = new Map();
  const pages = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    await page.getOperatorList(); // loads the page's fonts into commonObjs
    // (pdf.js puts a lone space between two runs of text on a line; those are not text the file holds.)
    const items = content.items.filter((item) => typeof item.str === 'string' && item.str.trim().length > 0).map((item) => ({
      text: item.str, x: item.transform[4] * MM, y: (viewport.height - item.transform[5]) * MM, width: item.width * MM, size: Math.hypot(item.transform[0], item.transform[1]), font: item.fontName,
    }));
    for (const name of new Set(items.map((item) => item.font))) {
      if (fonts.has(name)) continue;
      const font = page.commonObjs.get(name);
      fonts.set(name, { name: font.name, embedded: font.missingFile === false && Boolean(font.data?.length), type: font.type });
    }
    for (const item of items) item.font = fonts.get(item.font).name;
    pages.push({ width: viewport.width * MM, height: viewport.height * MM, items, text: items.map((item) => item.text).join(' ') });
  }
  const { info } = await pdf.getMetadata();
  await pdf.destroy();
  return { pages, fonts: [...fonts.values()], info };
}

/** Text with every run of white space removed: what to compare when a line break may fall anywhere. */
export const squash = (text) => String(text).normalize('NFC').replace(/\s+/g, '');
