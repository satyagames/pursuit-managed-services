// The maths behind "Crop and fit": a picture is moved and zoomed inside a frame whose shape is locked to a
// slot's, and the result is drawn to exactly the slot's size. Plain JS with JSDoc and no DOM, so
// `node --test` runs it (scripts/test-brand.js); CropDialog.svelte only turns gestures into these calls
// and draws what drawPlan() says.
//
// Everything is in the frame's own pixels (the OUTPUT size, e.g. 1200 x 1200), not screen pixels: the
// dialog shows the frame smaller or larger and converts.
//
//   source  the decoded picture, { width, height } in its own pixels
//   frame   the output, { width, height } = the slot's size
//   view    { scale, cx, cy }: `scale` output pixels per source pixel; (cx, cy) the source point that sits
//           at the frame's centre
//
// A picture that does not fill the frame (zoomed out far enough to show all of a wide logo) is centred
// in that direction and the rest stays transparent; one that fills it can be moved only as far as keeps
// it filled, so the frame never shows an edge by accident.

/** The most a picture can be zoomed in beyond the scale at which it first fills the frame. */
export const MAX_ZOOM = 4;

/** @typedef {{ width: number, height: number }} Size */
/** @typedef {{ scale: number, cx: number, cy: number }} View */
/** @typedef {{ min: number, max: number }} ScaleRange */

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** The scale at which the picture just covers the frame. @param {Size} source @param {Size} frame */
export const coverScale = (source, frame) => Math.max(frame.width / source.width, frame.height / source.height);
/** The scale at which the whole picture just fits inside the frame. @param {Size} source @param {Size} frame */
export const containScale = (source, frame) => Math.min(frame.width / source.width, frame.height / source.height);

/**
 * The scales a view may take. A slot that can be transparent lets the picture shrink until it all fits
 * (`letterbox`); one that cannot (a JPEG background) never shows an empty edge, so it starts at "covers".
 * @param {Size} source @param {Size} frame @param {{ letterbox: boolean }} options
 * @returns {ScaleRange}
 */
export function scaleRange(source, frame, { letterbox }) {
  const cover = coverScale(source, frame);
  const min = letterbox ? containScale(source, frame) : cover;
  return { min, max: Math.max(min, cover * MAX_ZOOM) };
}

/**
 * The view that fills the frame ('cover') or shows all of the picture ('contain'), centred.
 * @param {Size} source @param {Size} frame @param {'cover' | 'contain'} mode
 * @returns {View}
 */
export function fitView(source, frame, mode) {
  return { scale: mode === 'cover' ? coverScale(source, frame) : containScale(source, frame), cx: source.width / 2, cy: source.height / 2 };
}

/**
 * The nearest legal view: the scale inside its range, and the centre where the frame stays covered
 * (or the picture centred, along an axis it does not fill).
 * @param {View} view @param {Size} source @param {Size} frame @param {ScaleRange} range
 * @returns {View}
 */
export function clampView(view, source, frame, range) {
  const scale = clamp(view.scale, range.min, range.max);
  const axis = (centre, size, frameSize) => {
    if (size * scale <= frameSize + 1e-9) return size / 2;
    const half = frameSize / (2 * scale);
    return clamp(centre, half, size - half);
  };
  return { scale, cx: axis(view.cx, source.width, frame.width), cy: axis(view.cy, source.height, frame.height) };
}

/**
 * Moves the picture by (dx, dy) frame pixels: a positive dx drags the picture to the right, so the part
 * of it that is in the middle moves left.
 * @param {View} view @param {number} dx @param {number} dy @param {Size} source @param {Size} frame @param {ScaleRange} range
 * @returns {View}
 */
export function panBy(view, dx, dy, source, frame, range) {
  return clampView({ scale: view.scale, cx: view.cx - dx / view.scale, cy: view.cy - dy / view.scale }, source, frame, range);
}

/**
 * Changes the scale while keeping the point of the picture under `anchor` (frame pixels; the frame's
 * centre by default) where it is.
 * @param {View} view @param {number} scale @param {Size} source @param {Size} frame @param {ScaleRange} range
 * @param {{ x: number, y: number }} [anchor]
 * @returns {View}
 */
export function zoomTo(view, scale, source, frame, range, anchor = { x: frame.width / 2, y: frame.height / 2 }) {
  const next = clamp(scale, range.min, range.max);
  const under = { x: view.cx + (anchor.x - frame.width / 2) / view.scale, y: view.cy + (anchor.y - frame.height / 2) / view.scale };
  return clampView({ scale: next, cx: under.x - (anchor.x - frame.width / 2) / next, cy: under.y - (anchor.y - frame.height / 2) / next }, source, frame, range);
}

/**
 * Where the slider is (0 to 1) for a scale, and the scale for a slider position. The slider is
 * logarithmic, so each step zooms by about the same amount.
 * @param {number} scale @param {ScaleRange} range
 */
export const sliderOf = (scale, range) => (range.max === range.min ? 0 : Math.log(clamp(scale, range.min, range.max) / range.min) / Math.log(range.max / range.min));
/** @param {number} position @param {ScaleRange} range */
export const scaleOf = (position, range) => range.min * (range.max / range.min) ** clamp(position, 0, 1);

/**
 * What to hand to `drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh)` to paint the view: the part of the
 * picture that is inside the frame, and the part of the frame it lands on. Destination edges are whole
 * pixels, so a letterboxed picture does not get a half-transparent seam. Both rectangles are empty
 * (zero width) only if the picture is not in the frame at all, which clampView() prevents.
 * @param {Size} source @param {Size} frame @param {View} view
 */
export function drawPlan(source, frame, view) {
  const left = frame.width / 2 - view.cx * view.scale;
  const top = frame.height / 2 - view.cy * view.scale;
  const dx = Math.max(0, Math.round(left));
  const dy = Math.max(0, Math.round(top));
  const dx2 = Math.min(frame.width, Math.round(left + source.width * view.scale));
  const dy2 = Math.min(frame.height, Math.round(top + source.height * view.scale));
  const dw = Math.max(0, dx2 - dx);
  const dh = Math.max(0, dy2 - dy);
  const sx = clamp((dx - left) / view.scale, 0, source.width);
  const sy = clamp((dy - top) / view.scale, 0, source.height);
  return { sx, sy, sw: Math.min(source.width - sx, dw / view.scale), sh: Math.min(source.height - sy, dh / view.scale), dx, dy, dw, dh };
}

/**
 * Arrow keys move the picture, plus and minus zoom. Returns the new view, or null for a key that does
 * nothing here. A step is 2% of the frame (10% with Shift), and zoom is a quarter step of the slider.
 * @param {string} key @param {boolean} shift @param {View} view @param {Size} source @param {Size} frame @param {ScaleRange} range
 * @returns {View | null}
 */
export function keyboardView(key, shift, view, source, frame, range) {
  const step = (shift ? 0.1 : 0.02) * Math.max(frame.width, frame.height);
  switch (key) {
    // Left moves the picture to the left, like dragging it there.
    case 'ArrowLeft': return panBy(view, -step, 0, source, frame, range);
    case 'ArrowRight': return panBy(view, step, 0, source, frame, range);
    case 'ArrowUp': return panBy(view, 0, -step, source, frame, range);
    case 'ArrowDown': return panBy(view, 0, step, source, frame, range);
    case '+': case '=': return zoomTo(view, scaleOf(sliderOf(view.scale, range) + (shift ? 0.1 : 0.04), range), source, frame, range);
    case '-': case '_': return zoomTo(view, scaleOf(sliderOf(view.scale, range) - (shift ? 0.1 : 0.04), range), source, frame, range);
    default: return null;
  }
}
