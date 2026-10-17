// The picture slots Brand Studio fills, and what each one accepts (PMS-IMPLEMENTATION-PLAN.md 4.4, in git history at 7347c72).
// Plain JS with JSDoc and no DOM, so `node --test` runs it (scripts/test-brand.js); AssetUploader.svelte
// only renders what it says.
//
//   hero        1200x1200  1:1  PNG or WebP with transparency  300 KB  shown as it is on Welcome
//   logo         800x400   2:1  PNG or WebP with transparency  150 KB  sits on the plate when there is no hero
//   background  1536x2048  3:4  JPEG or WebP, with a focal point 350 KB
//   tile         480x320   3:2  PNG or WebP                     60 KB  a picture on an answer tile in Content
//
// Sizes are "KB" as the admin reads them: 1 KB = 1024 bytes.

export const KB = 1024;
/** A file bigger than this is refused before anything is read from it. */
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
/** A picture is never enlarged by more than this to fill its slot. It may be enlarged up to it with a warning. */
export const MAX_UPSCALE = 2;
/** The compressor never scales a picture below this share of the slot's width to make it fit the size cap. */
export const MIN_SCALE_SHARE = 0.75;

/**
 * @typedef {'hero' | 'logo' | 'background' | 'tile'} SlotId
 * @typedef {object} SlotSpec
 * @property {SlotId} id
 * @property {string} title       What the slot is called on its card.
 * @property {string} where       One line: where participants see it.
 * @property {number} width       Output pixels. The picture ends at exactly this size.
 * @property {number} height
 * @property {string} ratio       "1:1"
 * @property {readonly string[]} formats  What the finished file may be, best first.
 * @property {boolean} transparent  Keeps a transparent background (so it is a PNG or WebP, never a JPEG).
 * @property {number} maxBytes
 * @property {'cover' | 'contain'} fit  How a picture of another shape starts out in the crop frame.
 * @property {boolean} focal     Has a focal point.
 * @property {{ shape: 'rect' | 'circle', inset: number }} safe  The guide: keep what matters inside it (inset is a share of the frame).
 */

/** @type {Readonly<Record<SlotId, SlotSpec>>} */
export const SLOTS = Object.freeze({
  hero: Object.freeze({
    id: 'hero', title: 'Hero badge', where: 'Shown as it is at the top of Welcome.',
    width: 1200, height: 1200, ratio: '1:1', formats: Object.freeze(['image/webp', 'image/png']), transparent: true,
    maxBytes: 300 * KB, fit: 'cover', focal: false, safe: Object.freeze({ shape: 'circle', inset: 0.04 }),
  }),
  logo: Object.freeze({
    id: 'logo', title: 'Client logo', where: 'Sits on the plate at the top of Welcome when there is no hero badge.',
    width: 800, height: 400, ratio: '2:1', formats: Object.freeze(['image/webp', 'image/png']), transparent: true,
    maxBytes: 150 * KB, fit: 'contain', focal: false, safe: Object.freeze({ shape: 'rect', inset: 0.06 }),
  }),
  background: Object.freeze({
    id: 'background', title: 'Background (optional)', where: 'Fills the page behind everything, darkened so the words stay readable.',
    width: 1536, height: 2048, ratio: '3:4', formats: Object.freeze(['image/webp', 'image/jpeg']), transparent: false,
    maxBytes: 350 * KB, fit: 'cover', focal: true, safe: Object.freeze({ shape: 'rect', inset: 0.2 }),
  }),
  tile: Object.freeze({
    id: 'tile', title: 'Answer picture', where: 'Fills an answer tile on a question with picture tiles.',
    width: 480, height: 320, ratio: '3:2', formats: Object.freeze(['image/webp', 'image/png']), transparent: true,
    maxBytes: 60 * KB, fit: 'contain', focal: false, safe: Object.freeze({ shape: 'rect', inset: 0.06 }),
  }),
});

/** The slot ids Brand Studio fills, in the order its cards appear. (`tile` is Content's.) */
export const BRAND_SLOTS = Object.freeze(/** @type {const} */ (['hero', 'logo', 'background']));

/** @param {string} id @returns {SlotSpec} */
export function slotSpec(id) {
  const spec = SLOTS[/** @type {SlotId} */ (id)];
  if (!spec) throw new TypeError(`Unknown picture slot ${JSON.stringify(id)}`);
  return spec;
}

const FORMAT_NAMES = { 'image/png': 'PNG', 'image/webp': 'WebP', 'image/jpeg': 'JPEG' };
/** File extension for a finished file. @param {string} mime */
export const extensionOf = (mime) => ({ 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' }[mime] ?? 'png');

/** "300 KB" or "1.5 MB" for a byte count, the way the cards print it. @param {number} bytes */
export function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${bytes >= 10 * KB ? Math.round(bytes / KB) : (bytes / KB).toFixed(1)} KB`;
}

/**
 * The lines a slot's card prints, so an admin can prepare the file: pixel size, aspect ratio, format and
 * size cap. @param {SlotSpec} spec
 */
export function describeSpec(spec) {
  const names = spec.formats.map((mime) => FORMAT_NAMES[mime]).sort((a, b) => (a === 'PNG' ? -1 : b === 'PNG' ? 1 : a.localeCompare(b)));
  return {
    size: `${spec.width} × ${spec.height} px`,
    ratio: `${spec.ratio} (${spec.width === spec.height ? 'square' : spec.width > spec.height ? 'wide' : 'tall'})`,
    format: `${names.join(' or ')}${spec.transparent ? ' with a transparent background' : ''}`,
    max: `Up to ${formatBytes(spec.maxBytes)}`,
  };
}

// ---- What a picked file is allowed to be ---------------------------------------------------------

/**
 * The scale (output pixels per source pixel) at which a picture first fills the frame: "cover" fills it
 * all, "contain" fits the whole picture inside.
 * @param {{ width: number, height: number }} source
 * @param {{ width: number, height: number }} frame
 * @param {'cover' | 'contain'} mode
 */
export function fitScale(source, frame, mode) {
  const across = frame.width / source.width;
  const down = frame.height / source.height;
  return mode === 'cover' ? Math.max(across, down) : Math.min(across, down);
}

/**
 * The narrowest picture of this shape that fills the slot without being enlarged more than MAX_UPSCALE.
 * @param {SlotSpec} spec @param {number} aspect width / height of the picture
 */
export function minimumWidth(spec, aspect) {
  const half = (value) => Math.ceil(value / MAX_UPSCALE);
  return spec.fit === 'cover'
    ? Math.max(half(spec.width), Math.ceil(aspect * half(spec.height)))
    : Math.min(half(spec.width), Math.ceil(aspect * half(spec.height)));
}

/**
 * Judges a decoded picture's size for a slot, in words an admin can act on.
 *   ok      big enough; nothing to say
 *   soft    smaller than the slot, so it is enlarged and may look soft (still accepted)
 *   reject  it would have to be enlarged more than MAX_UPSCALE times: too small to use
 * @param {SlotSpec} spec
 * @param {{ width: number, height: number }} source
 * @returns {{ level: 'ok' | 'soft' | 'reject', factor: number, message: string }}
 */
export function checkDimensions(spec, source) {
  if (!(source.width > 0 && source.height > 0)) return { level: 'reject', factor: Infinity, message: 'That picture has no size, so it cannot be used.' };
  const factor = fitScale(source, spec, spec.fit);
  const have = `${source.width} × ${source.height} px`;
  if (factor > MAX_UPSCALE) {
    const wide = minimumWidth(spec, source.width / source.height);
    return {
      level: 'reject', factor,
      message: `This picture is only ${have}, too small for the ${spec.title.toLowerCase()} (it would be enlarged ${factor.toFixed(1)} times and look blurry). Use one at least ${wide} px wide of the same shape; ${spec.width} × ${spec.height} px is best.`,
    };
  }
  if (factor > 1) {
    return {
      level: 'soft', factor,
      message: `This picture is ${have}, smaller than the ${spec.width} × ${spec.height} px this slot is made for, so it will be enlarged and may look a little soft.`,
    };
  }
  return { level: 'ok', factor, message: '' };
}

/**
 * The file input's `accept` for a slot: what the picker offers. The file's real contents are still checked.
 */
export const ACCEPT = 'image/png,image/jpeg,image/webp';
