// The screens Brand Studio previews, and the geometry that goes with them. Plain JS with JSDoc and no DOM,
// so `node --test` runs it (scripts/test-brand.js).

/** @typedef {{ id: string, label: string, width: number, height: number }} Device */

/** CSS pixels of the screens an admin is asked to check. The preview frame is exactly this size. */
export const DEVICES = Object.freeze(/** @type {readonly Device[]} */ ([
  { id: 'phone', label: 'iPhone', width: 390, height: 844 },
  { id: 'ipad-portrait', label: 'iPad portrait', width: 820, height: 1180 },
  { id: 'ipad-landscape', label: 'iPad landscape', width: 1180, height: 820 },
  { id: 'desktop', label: 'Desktop', width: 1440, height: 900 },
]));

/** The device with this id, or the phone. @param {string} id */
export const deviceById = (id) => DEVICES.find((device) => device.id === id) ?? DEVICES[0];

/**
 * How big the preview is drawn so it fits `available` CSS pixels across (never enlarged): the frame
 * itself stays the device's real size and is scaled down by `scale`.
 * @param {Device} device @param {number} available
 */
export function fitToWidth(device, available) {
  const scale = Math.min(1, Math.max(0.05, available / device.width));
  return { scale, width: Math.round(device.width * scale), height: Math.round(device.height * scale) };
}

/**
 * How much of a background picture a screen shows when the picture fills ("covers") the page: the share of
 * its width and of its height that is in view. A phone is tall and thin, so it shows the middle of the width;
 * a desktop is wide, so it shows the middle of the height. The area that every screen shows is the picture's
 * safe area: keep what matters there.
 * @param {{ width: number, height: number }} picture @param {Device} device
 * @returns {{ x: number, y: number }}
 */
export function visibleShare(picture, device) {
  const pictureShape = picture.width / picture.height;
  const screenShape = device.width / device.height;
  return screenShape < pictureShape ? { x: screenShape / pictureShape, y: 1 } : { x: 1, y: pictureShape / screenShape };
}

/**
 * The guide drawn on a slot's picture: the part to keep what matters inside, as shares (0 to 1) of the
 * picture's width and height. For most slots it is the picture less an inset (a circle for the hero
 * badge). For the background it is what EVERY screen shows whatever its shape (a phone shows the middle of
 * the width, a desktop the middle of the height), placed where the focal point puts it: the window of the
 * screen that shows least is inside the window of every other, so it is the one to keep clear.
 * @param {{ width: number, height: number, focal: boolean, safe: { shape: 'rect' | 'circle', inset: number } }} spec
 * @param {{ x: number, y: number } | null} [focus] percentages; the middle when absent
 * @returns {{ shape: 'rect' | 'circle', x: number, y: number, width: number, height: number }}
 */
export function safeArea(spec, focus = null) {
  if (spec.focal) {
    const shares = DEVICES.map((device) => visibleShare(spec, device));
    const across = Math.min(...shares.map((share) => share.x));
    const down = Math.min(...shares.map((share) => share.y));
    const at = focus ?? { x: 50, y: 50 };
    return { shape: 'rect', x: (at.x / 100) * (1 - across), y: (at.y / 100) * (1 - down), width: across, height: down };
  }
  const { inset, shape } = spec.safe;
  return { shape, x: inset, y: inset, width: 1 - 2 * inset, height: 1 - 2 * inset };
}
