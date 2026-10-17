/**
 * The browser half of picture handling: decode a chosen file, draw the cropped view to a canvas of exactly the
 * slot's size, and encode it under the size cap. Everything decided by arithmetic is in the plain modules this
 * calls (crop-math.js, asset-compress.js, asset-specs.js), which have unit tests; this file only does what
 * needs a canvas.
 *
 * Re-encoding through a canvas is also what strips a picture's hidden data: its EXIF (camera, place, time), colour
 * profile and any other metadata do not survive a canvas, and a rotated phone photo is drawn the right way up
 * because the browser applies its EXIF orientation when it decodes (the output is never rotated again).
 */
import { compressToCap, type Compressed, type Encoded } from './asset-compress.js';
import type { SlotSpec } from './asset-specs.js';
import { drawPlan, type View } from './crop-math.js';
import { logoStats, type LogoStats } from './brand-studio.js';

export type Decoded = {
  img: HTMLImageElement;
  /** The picture's size as displayed: after its EXIF rotation. */
  width: number;
  height: number;
  /** An object address for showing the original in the crop dialog. */
  url: string;
  release: () => void;
};

/** A message to show an administrator as it is. */
export class PictureError extends Error {
  constructor(message: string, readonly kind: 'damaged' | 'too-large-to-open' | 'encode') {
    super(message);
    this.name = 'PictureError';
  }
}

/** Opens a picture file for cropping. A damaged or truncated file is a PictureError, in plain words. */
export async function decodeImage(file: Blob): Promise<Decoded> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new PictureError('This picture looks damaged and could not be opened. Open it in a picture program and save it again as a PNG, JPEG or WebP, or choose another.', 'damaged');
  }
  if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) {
    URL.revokeObjectURL(url);
    throw new PictureError('This picture has no size, so it could not be opened. Choose another.', 'damaged');
  }
  return { img, width: img.naturalWidth, height: img.naturalHeight, url, release: () => URL.revokeObjectURL(url) };
}

const canvasOf = (width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

function context(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) throw new PictureError('This browser could not prepare the picture (no drawing surface). Try another browser.', 'encode');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/**
 * Draws part of a picture smaller. A big step down in one go aliases (and some browsers do not smooth it), so a
 * reduction of more than 2x is made in halves.
 */
function drawReduced(target: CanvasRenderingContext2D, source: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) {
  let from: CanvasImageSource = source;
  let [x, y, w, h] = [sx, sy, sw, sh];
  while (w / dw > 2 && h / dh > 2) {
    const half = canvasOf(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    context(half).drawImage(from, x, y, w, h, 0, 0, half.width, half.height);
    from = half;
    [x, y, w, h] = [0, 0, half.width, half.height];
  }
  target.drawImage(from, x, y, w, h, dx, dy, dw, dh);
}

/** The cropped view drawn at `share` of the slot's size (1 = exactly the slot's). */
export function renderView(decoded: Decoded, spec: SlotSpec, view: View, width = spec.width, height = spec.height): HTMLCanvasElement {
  const canvas = canvasOf(width, height);
  const ctx = context(canvas);
  // A picture that cannot be transparent (the background, a JPEG) starts on the page's own near-black, never on nothing.
  if (!spec.transparent) {
    ctx.fillStyle = '#000102';
    ctx.fillRect(0, 0, width, height);
  }
  const plan = drawPlan(decoded, spec, view);
  const factor = width / spec.width;
  const left = Math.round(plan.dx * factor);
  const top = Math.round(plan.dy * factor);
  const right = Math.round((plan.dx + plan.dw) * factor);
  const bottom = Math.round((plan.dy + plan.dh) * factor);
  if (right > left && bottom > top) drawReduced(ctx, decoded.img, plan.sx, plan.sy, plan.sw, plan.sh, left, top, right - left, bottom - top);
  return canvas;
}

/** What `canvas.toBlob` really made. A browser that cannot make `mime` answers with a PNG, which the caller notices. */
export function encodeCanvas(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Encoded | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob ? { mime: blob.type || 'image/png', bytes: blob.size, data: blob } : null), mime, quality);
    } catch {
      resolve(null);
    }
  });
}

export type Prepared = Omit<Compressed, 'data'> & {
  blob: Blob;
  /** An object address for showing it; the caller releases it. */
  url: string;
};

/** Crops, draws and compresses to the slot's cap. Throws a CompressError (with the words to show) when it cannot. */
export async function prepareAsset(decoded: Decoded, spec: SlotSpec, view: View): Promise<Prepared> {
  const result = await compressToCap({
    spec,
    render: (width, height) => renderView(decoded, spec, view, width, height),
    encode: (canvas, mime, quality) => encodeCanvas(canvas as HTMLCanvasElement, mime, quality),
  });
  const { data, ...rest } = result;
  const blob = data as Blob;
  return { ...rest, blob, url: URL.createObjectURL(blob) };
}

/**
 * Whether a picture has any see-through part (so it is fitted whole by default and drawn on a checkerboard).
 * Looked at on a small copy.
 */
export function hasTransparency(decoded: Decoded): boolean {
  const size = 96;
  const scale = Math.min(1, size / Math.max(decoded.width, decoded.height));
  const canvas = canvasOf(Math.max(1, Math.round(decoded.width * scale)), Math.max(1, Math.round(decoded.height * scale)));
  const ctx = context(canvas);
  ctx.drawImage(decoded.img, 0, 0, canvas.width, canvas.height);
  try {
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 3; index < data.length; index += 4) if (data[index] < 250) return true;
  } catch { /* unreadable: treat as opaque */ }
  return false;
}

/**
 * How light or dark a logo is, from a small copy of it, for the plate advice. Null when the browser will not let
 * the page read the pixels (a picture from another site) or the picture will not open.
 */
export async function measureLogo(source: string): Promise<LogoStats | null> {
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = source;
    await img.decode();
    const width = 96;
    const height = Math.max(1, Math.round((width * (img.naturalHeight || 1)) / (img.naturalWidth || 1)));
    const canvas = canvasOf(width, Math.min(height, 192));
    const ctx = context(canvas);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return logoStats(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  } catch {
    return null;
  }
}
