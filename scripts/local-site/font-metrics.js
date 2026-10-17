// The font experiment of the UX review (Phase 12): a metric-matched fallback for Open Sans, MEASURED from the TrueType files, never guessed.
//
//   node scripts/local-site/font-metrics.js [<Open Sans TTF>] [<fallback TTF>]
//
// It reads each font's em, its vertical metrics (hhea, as browsers use for line height) and the advance width of every character of a sample of
// the app's own words, and prints the @font-face that makes the fallback take up the room Open Sans would: size-adjust is the ratio of the average
// widths; ascent-, descent- and line-gap-override are Open Sans's, over the adjusted em. Defaults: public/assets/Font/open-sans/OpenSans-Regular.ttf
// (the brand folder; not in git) against Windows' Arial.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
/** Words a participant and an admin read most: the sample the widths are averaged over (the app's own words, plus VJR's dataset). */
export const SAMPLE = [
  'Click here to begin', 'Which objectives are top of mind for you?', 'Tap your choices in order: the first you tap is your top choice.',
  'Reduce cost (supply chain and store operations)', 'Modernize technology (data, cloud, and commerce platforms)', 'How confident are you that Deloitte can deliver',
  'Not confident Moderately confident Very confident', 'Where is Kroger headquartered? Cincinnati, Ohio', 'Back to activities Finish Next Submit Retry',
  'Question 1 of 4', 'Most people (54%) chose Modernize technology.', '34 answers from 4 iPads', 'Today Clients Content Guests and QR Results',
].join(' ');

function tables(buffer) {
  const count = buffer.readUInt16BE(4);
  const found = {};
  for (let index = 0; index < count; index += 1) {
    const at = 12 + index * 16;
    found[buffer.toString('latin1', at, at + 4)] = { offset: buffer.readUInt32BE(at + 8), length: buffer.readUInt32BE(at + 12) };
  }
  return found;
}

/** Reads a TrueType font: its em, hhea metrics, and the advance width of a character (cmap format 4). */
export function readFont(file) {
  const buffer = readFileSync(file);
  const table = tables(buffer);
  const unitsPerEm = buffer.readUInt16BE(table.head.offset + 18);
  const hhea = table.hhea.offset;
  const ascent = buffer.readInt16BE(hhea + 4);
  const descent = buffer.readInt16BE(hhea + 6);
  const lineGap = buffer.readInt16BE(hhea + 8);
  const metricsCount = buffer.readUInt16BE(hhea + 34);
  const os2 = table['OS/2'].offset;
  const xAvgCharWidth = buffer.readInt16BE(os2 + 2);
  const cmap = table.cmap.offset;
  let format4 = null;
  for (let index = 0; index < buffer.readUInt16BE(cmap + 2); index += 1) {
    const platform = buffer.readUInt16BE(cmap + 4 + index * 8);
    const encoding = buffer.readUInt16BE(cmap + 6 + index * 8);
    const offset = cmap + buffer.readUInt32BE(cmap + 8 + index * 8);
    if (platform === 3 && encoding === 1 && buffer.readUInt16BE(offset) === 4) format4 = offset;
  }
  const segments = buffer.readUInt16BE(format4 + 6) / 2;
  const glyphOf = (code) => {
    const ends = format4 + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const ranges = deltas + segments * 2;
    for (let segment = 0; segment < segments; segment += 1) {
      if (buffer.readUInt16BE(ends + segment * 2) < code) continue;
      const start = buffer.readUInt16BE(starts + segment * 2);
      if (start > code) return 0;
      const delta = buffer.readInt16BE(deltas + segment * 2);
      const range = buffer.readUInt16BE(ranges + segment * 2);
      if (range === 0) return (code + delta) & 0xffff;
      const glyph = buffer.readUInt16BE(ranges + segment * 2 + range + (code - start) * 2);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
  const advance = (character) => {
    const glyph = glyphOf(character.codePointAt(0));
    return buffer.readUInt16BE(table.hmtx.offset + Math.min(glyph, metricsCount - 1) * 4);
  };
  return { unitsPerEm, ascent, descent, lineGap, xAvgCharWidth, advance };
}

/** The fallback face that stands in for `primary` with `fallback`'s glyphs: size-adjust and the three overrides, as percentages. */
export function fallbackFace(primary, fallback, sample = SAMPLE) {
  const width = (font) => [...sample].reduce((sum, character) => sum + font.advance(character), 0) / font.unitsPerEm;
  const sizeAdjust = width(primary) / width(fallback);
  const percent = (value) => `${(value * 100).toFixed(2)}%`;
  return {
    sizeAdjust: percent(sizeAdjust),
    ascentOverride: percent(primary.ascent / primary.unitsPerEm / sizeAdjust),
    descentOverride: percent(Math.abs(primary.descent) / primary.unitsPerEm / sizeAdjust),
    lineGapOverride: percent(primary.lineGap / primary.unitsPerEm / sizeAdjust),
    widths: { primary: width(primary), fallback: width(fallback), characters: [...sample].length },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [primaryFile = `${ROOT}public/assets/Font/open-sans/OpenSans-Regular.ttf`, ...fallbacks] = process.argv.slice(2);
  const primary = readFont(primaryFile);
  for (const [name, file] of fallbacks.length ? fallbacks.map((file) => [file, file]) : [['Arial', 'C:/Windows/Fonts/arial.ttf'], ['Segoe UI', 'C:/Windows/Fonts/segoeui.ttf']]) {
    const face = fallbackFace(primary, readFont(file));
    console.log(`/* ${name}: ${face.widths.characters} characters of the app's words are ${(face.widths.primary).toFixed(2)} em in Open Sans and ${face.widths.fallback.toFixed(2)} em in ${name}. */`);
    console.log(`@font-face { font-family: "Open Sans Fallback"; src: local("${name}"); size-adjust: ${face.sizeAdjust}; ascent-override: ${face.ascentOverride}; descent-override: ${face.descentOverride}; line-gap-override: ${face.lineGapOverride}; }`);
  }
}
