// Open Sans for the leader report's PDF: the two faces made by scripts/build-report-fonts.py, inflated when a report is made, and
// read just enough (which characters a face has, and how wide each one is) for the layout to measure text itself. The layout
// (lib/exports/leader-report-layout.js) then knows where every line ends without asking jsPDF, so a node test can hold it to the page.
//
// Plain JS with JSDoc and no DOM. DecompressionStream is in every browser the build targets (Safari 16.4 and later) and in node.

import { REPORT_FONTS, REPORT_FONT_DATA } from '../../assets/report-fonts/open-sans-report.js';

/**
 * @typedef {{ name: string, file: string, bold: boolean, bytes: Uint8Array, has: (codePoint: number) => boolean, advance: (codePoint: number) => number }} ReportFace
 * `advance` is a character's width in ems (0 for one the face lacks).
 * @typedef {{ regular: ReportFace, bold: ReportFace }} ReportFonts
 */

/** Printed in place of a character the faces do not have (an emoji, a script other than Latin). */
export const MISSING = String.fromCharCode(0xFFFD);

const PT_TO_MM = 25.4 / 72;

async function inflate(base64) {
  const packed = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * A TrueType file's character map (format 4, the Basic Multilingual Plane) and advance widths.
 * @param {Uint8Array} bytes
 * @returns {{ has: (codePoint: number) => boolean, advance: (codePoint: number) => number }}
 */
export function readFace(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = new Map();
  for (let index = 0, count = view.getUint16(4); index < count; index += 1) {
    const at = 12 + index * 16;
    tables.set(String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]), view.getUint32(at + 8));
  }
  const offsetOf = (tag) => {
    const offset = tables.get(tag);
    if (offset === undefined) throw new Error(`The report font has no ${tag} part.`);
    return offset;
  };
  const unitsPerEm = view.getUint16(offsetOf('head') + 18);
  const metricCount = view.getUint16(offsetOf('hhea') + 34);
  const hmtx = offsetOf('hmtx');
  const widthOfGlyph = (glyph) => view.getUint16(hmtx + Math.min(glyph, metricCount - 1) * 4) / unitsPerEm;

  // The Unicode subtable in format 4: segments of consecutive characters.
  const cmap = offsetOf('cmap');
  let sub = -1;
  for (let index = 0, count = view.getUint16(cmap + 2); index < count; index += 1) {
    const at = cmap + 4 + index * 8;
    const offset = cmap + view.getUint32(at + 4);
    const platform = view.getUint16(at);
    if ((platform === 0 || (platform === 3 && view.getUint16(at + 2) === 1)) && view.getUint16(offset) === 4) sub = offset;
  }
  if (sub < 0) throw new Error('The report font has no Unicode character map this page can read.');
  const segments = view.getUint16(sub + 6) / 2;
  const ends = sub + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;
  /** @type {Map<number, number>} character -> width in ems */
  const widths = new Map();
  for (let segment = 0; segment < segments; segment += 1) {
    const start = view.getUint16(starts + segment * 2);
    const end = view.getUint16(ends + segment * 2);
    const delta = view.getUint16(deltas + segment * 2);
    const range = view.getUint16(ranges + segment * 2);
    for (let code = start; code <= end && code !== 0xFFFF; code += 1) {
      let glyph;
      if (range === 0) glyph = (code + delta) & 0xFFFF;
      else {
        glyph = view.getUint16(ranges + segment * 2 + range + (code - start) * 2);
        if (glyph !== 0) glyph = (glyph + delta) & 0xFFFF;
      }
      if (glyph !== 0) widths.set(code, widthOfGlyph(glyph));
    }
  }
  return { has: (codePoint) => widths.has(codePoint), advance: (codePoint) => widths.get(codePoint) ?? 0 };
}

/** @type {Promise<ReportFonts> | null} */
let loading = null;

/** The two faces, inflated and read once per page. @returns {Promise<ReportFonts>} */
export function loadReportFonts() {
  loading ??= (async () => {
    // The faces were deflated as one stream, end to end: cut it at each one's size.
    const all = await inflate(REPORT_FONT_DATA);
    if (all.length !== REPORT_FONTS.reduce((sum, face) => sum + face.bytes, 0)) throw new Error('The report fonts did not unpack to their full size.');
    let from = 0;
    const [regular, bold] = REPORT_FONTS.map(({ name, bold: isBold, bytes: size }) => {
      const bytes = all.slice(from, from += size);
      return { name, file: `${name}.ttf`, bold: isBold, bytes, ...readFace(bytes) };
    });
    return { regular, bold };
  })().catch((cause) => { loading = null; throw cause; });
  return loading;
}

/**
 * What the layout measures with. `clean` makes any text printable in these faces: composed accents (NFC), tabs and odd spaces
 * as spaces, and a run of characters the faces lack as ONE U+FFFD, counted in `missing`. `width` is millimetres at a size in points.
 * @param {ReportFonts} fonts
 */
export function createMeasure(fonts) {
  const stats = { missing: 0 };
  /** @param {unknown} value @param {{ keepBreaks?: boolean }} [options] */
  function clean(value, { keepBreaks = false } = {}) {
    const text = String(value ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(keepBreaks ? /[^\S\n]/g : /\s/g, ' ');
    let out = '';
    let gap = false;
    for (const char of text) {
      const code = /** @type {number} */ (char.codePointAt(0));
      // Joiners and variation selectors belong to the character before them: they print nothing, and are not a gap of their own.
      if (code === 0x200D || (code >= 0xFE00 && code <= 0xFE0F) || (code >= 0x1F3FB && code <= 0x1F3FF)) continue;
      if (char === '\n' || fonts.regular.has(code)) { out += char; gap = false; continue; }
      if (!gap) { out += MISSING; stats.missing += 1; gap = true; }
    }
    return out;
  }
  /** @param {string} text @param {number} size points @param {boolean} [bold] */
  function width(text, size, bold = false) {
    const face = bold ? fonts.bold : fonts.regular;
    let ems = 0;
    for (let index = 0; index < text.length; index += 1) ems += face.advance(text.charCodeAt(index));
    return ems * size * PT_TO_MM;
  }
  return { clean, width, stats };
}

/** A face's bytes as the binary string jsPDF's file store takes. @param {Uint8Array} bytes */
export function binaryString(bytes) {
  let text = '';
  for (let index = 0; index < bytes.length; index += 8192) text += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return text;
}
