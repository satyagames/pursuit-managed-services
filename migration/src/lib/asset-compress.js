// "Compress to the size cap": the finished picture must be at most a slot's size in bytes, ending at exactly
// the slot's pixel size whenever that is possible. Plain JS with JSDoc and no DOM: the drawing and the
// encoding are handed in (`render`, `encode`), so `node --test` runs the whole loop with a fake encoder
// (scripts/test-brand.js) and asset-image.ts hands in a canvas.
//
// The order, per size:
//   1. the slot's lossy format first (WebP; for the background WebP then JPEG), from high quality down;
//      the highest quality that fits wins
//   2. a browser that cannot make that format (Safari cannot encode WebP) answers with a PNG instead: the
//      loop notices the answer is not what it asked for, stops asking, and uses what is left
//   3. PNG (lossless, one try) where the slot allows it
//   4. if nothing fits, the picture is made a little smaller and the whole thing is tried again, in steps,
//      never below MIN_SCALE_SHARE (75%) of the slot's width
//   5. if even that does not fit, it stops and says what to do
// Transparency is not this module's concern: the canvas it is given carries it, and only formats that keep
// it are offered for a slot that needs it (spec.formats).

import { MIN_SCALE_SHARE, formatBytes } from './asset-specs.js';

/** Quality ladders, best first. The last is the lowest quality ever used. */
export const QUALITIES = Object.freeze({
  'image/webp': Object.freeze([0.92, 0.85, 0.78, 0.7, 0.62, 0.55]),
  'image/jpeg': Object.freeze([0.9, 0.82, 0.74, 0.66, 0.58, 0.5]),
});
/** Share of the slot's width tried, in order. 1 is the exact slot size. */
export const SCALE_STEPS = Object.freeze([1, 0.95, 0.9, 0.85, 0.8, MIN_SCALE_SHARE]);

/**
 * @typedef {object} Encoded
 * @property {string} mime  The format it really is, which may not be the one asked for.
 * @property {number} bytes
 * @property {unknown} data Whatever the caller needs to keep (a Blob).
 *
 * @typedef {object} Compressed
 * @property {unknown} data
 * @property {string} mime
 * @property {number} bytes
 * @property {number} width
 * @property {number} height
 * @property {number | null} quality  null for PNG.
 * @property {boolean} scaledDown   Smaller than the slot's size, to fit the cap.
 * @property {number} encodes       How many times the encoder ran.
 */

export class CompressError extends Error {
  /**
   * @param {string} message
   * @param {{ cap: number, smallest: { bytes: number, width: number, height: number, mime: string } | null, lossyMissing: boolean }} detail
   */
  constructor(message, detail) {
    super(message);
    this.name = 'CompressError';
    Object.assign(this, detail);
  }
}

/**
 * @param {object} input
 * @param {import('./asset-specs.js').SlotSpec} input.spec
 * @param {(width: number, height: number) => unknown | Promise<unknown>} input.render
 *   Draws the picture at this size and returns something `encode` understands (a canvas).
 * @param {(canvas: any, mime: string, quality?: number) => Promise<Encoded | null>} input.encode
 *   Null (or another mime) means this browser cannot make `mime`.
 * @param {readonly number[]} [input.steps]
 * @returns {Promise<Compressed>}
 */
export async function compressToCap({ spec, render, encode, steps = SCALE_STEPS }) {
  const cap = spec.maxBytes;
  /** Formats this browser turned out not to make. */
  const missing = new Set();
  /** @type {{ bytes: number, width: number, height: number, mime: string } | null} */
  let smallest = null;
  let encodes = 0;
  const note = (encoded, width, height) => {
    if (!smallest || encoded.bytes < smallest.bytes) smallest = { bytes: encoded.bytes, width, height, mime: encoded.mime };
  };

  for (const share of steps) {
    if (share < MIN_SCALE_SHARE - 1e-9) break;
    const width = share === 1 ? spec.width : Math.round(spec.width * share);
    const height = share === 1 ? spec.height : Math.round((width * spec.height) / spec.width);
    const canvas = await render(width, height);

    for (const mime of spec.formats) {
      if (mime === 'image/png') {
        encodes += 1;
        const encoded = await encode(canvas, mime);
        if (!encoded || encoded.mime !== mime) continue;
        note(encoded, width, height);
        if (encoded.bytes <= cap) return { data: encoded.data, mime, bytes: encoded.bytes, width, height, quality: null, scaledDown: share < 1, encodes };
        continue;
      }
      const ladder = QUALITIES[mime];
      if (!ladder || missing.has(mime)) continue;
      // The lowest quality first: if even that is too big there is no point in the better ones.
      encodes += 1;
      const floor = await encode(canvas, mime, ladder[ladder.length - 1]);
      if (!floor || floor.mime !== mime) { missing.add(mime); continue; }
      note(floor, width, height);
      if (floor.bytes > cap) continue;
      let best = { encoded: floor, quality: ladder[ladder.length - 1] };
      for (const quality of ladder.slice(0, -1)) {
        encodes += 1;
        const encoded = await encode(canvas, mime, quality);
        if (encoded && encoded.mime === mime && encoded.bytes <= cap) { best = { encoded, quality }; break; }
      }
      return { data: best.encoded.data, mime, bytes: best.encoded.bytes, width, height, quality: best.quality, scaledDown: share < 1, encodes };
    }
  }

  const lossy = spec.formats.filter((mime) => mime !== 'image/png');
  const lossyMissing = lossy.length > 0 && lossy.every((mime) => missing.has(mime));
  const seen = /** @type {{ bytes: number, width: number, height: number, mime: string } | null} */ (smallest);
  const where = seen ? ` The smallest it could be made was ${formatBytes(seen.bytes)} at ${seen.width} × ${seen.height} px.` : '';
  throw new CompressError(
    `This picture is too detailed to fit in ${formatBytes(cap)} (the limit for the ${spec.title.toLowerCase()}).${where} `
    + `${lossyMissing ? 'This browser can only save it as a PNG, which is larger than the WebP other browsers make; try a computer’s browser (Chrome or Edge), or ' : 'Try '}`
    + 'a simpler picture (flat colours, fewer gradients or photo details), or start from a smaller original.',
    { cap, smallest: seen, lossyMissing },
  );
}
