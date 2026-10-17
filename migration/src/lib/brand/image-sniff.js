// What a picked file really is, from its first bytes (not its name or the type the browser guessed).
// Plain JS with JSDoc and no DOM, so `node --test` runs it (scripts/test-brand.js).
//
// Brand Studio takes PNG, JPEG and WebP only, and says why it does not take the rest:
//   SVG   a drawing can carry script and is not allowed to be stored on SharePoint; it is also drawn
//         differently by each browser
//   GIF   a GIF is usually animated, which would play on every participant's iPad and make the page heavy
//   animated PNG / WebP  the same reason
// A file that is none of these (a Word file renamed to .png, a truncated download) is "not a picture".

import { MAX_INPUT_BYTES, formatBytes } from './asset-specs.js';

/** @typedef {'png' | 'jpeg' | 'webp' | 'gif' | 'svg' | 'unknown'} ImageKind */

const ascii = (bytes, from, to) => String.fromCharCode(...bytes.subarray(from, to));

/**
 * The picture format a byte array starts with, and whether it is animated.
 * @param {Uint8Array} bytes The whole file (an animated PNG shows itself only after its header).
 * @returns {{ kind: ImageKind, mime: string | null, animated: boolean }}
 */
export function sniffImage(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 4) === 'PNG' && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return { kind: 'png', mime: 'image/png', animated: isAnimatedPng(bytes) };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { kind: 'jpeg', mime: 'image/jpeg', animated: false };
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return { kind: 'webp', mime: 'image/webp', animated: isAnimatedWebp(bytes) };
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) return { kind: 'gif', mime: 'image/gif', animated: true };
  // SVG is text: look for an <svg element near the start (after an XML prolog, a comment or a doctype).
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 2048)).replace(/^﻿/, '');
  if (/<svg[\s>]/i.test(head)) return { kind: 'svg', mime: 'image/svg+xml', animated: false };
  return { kind: 'unknown', mime: null, animated: false };
}

/** An animated PNG (APNG) has an acTL chunk before its first IDAT. @param {Uint8Array} bytes */
function isAnimatedPng(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, offset + 8);
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    offset += 12 + length;
  }
  return false;
}

/** A WebP is animated when its VP8X header says so (flag bit 1) or it carries an ANIM chunk. @param {Uint8Array} bytes */
function isAnimatedWebp(bytes) {
  if (ascii(bytes, 12, 16) === 'VP8X' && bytes.length > 20) return (bytes[20] & 0x02) !== 0;
  return false;
}

/**
 * Is a picture cut short (a download that stopped, a file that was truncated)? Browsers happily draw the part that
 * arrived, so the file would be accepted and the picture would be wrong: a PNG must end with its IEND chunk, a JPEG
 * with its end-of-image marker, and a WebP must be as long as its header says.
 * @param {'png' | 'jpeg' | 'webp'} kind @param {Uint8Array} bytes
 */
export function isTruncated(kind, bytes) {
  if (kind === 'png') {
    const tail = ascii(bytes, Math.max(0, bytes.length - 8), Math.max(0, bytes.length - 4));
    return tail !== 'IEND' || bytes.length < 33;
  }
  if (kind === 'jpeg') {
    for (let index = bytes.length - 2; index >= Math.max(2, bytes.length - 64); index -= 1) if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) return false;
    return true;
  }
  const declared = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8;
  return bytes.length < declared;
}

/**
 * The whole decision for a picked file: may it go on to be decoded and cropped? A refusal carries a
 * plain-language message (what is wrong and what to do).
 * @param {{ size: number, bytes: Uint8Array | null }} file `bytes` may be null for a file refused on size alone.
 * @returns {{ ok: true, kind: 'png' | 'jpeg' | 'webp', mime: string } | { ok: false, reason: 'empty' | 'too-large' | 'svg' | 'gif' | 'animated' | 'not-a-picture' | 'damaged', message: string }}
 */
export function inspectFile({ size, bytes }) {
  if (size === 0) return { ok: false, reason: 'empty', message: 'That file is empty. Choose a picture.' };
  if (size > MAX_INPUT_BYTES) {
    return { ok: false, reason: 'too-large', message: `That file is ${formatBytes(size)}, over the ${formatBytes(MAX_INPUT_BYTES)} limit for a picture to choose. Pick a smaller one, or save it at a lower size first.` };
  }
  const found = sniffImage(bytes ?? new Uint8Array());
  if (found.kind === 'svg') {
    return {
      ok: false, reason: 'svg',
      message: 'SVG drawings are not accepted. They can carry hidden script, so SharePoint will not store them, and each browser draws them a little differently. Export the logo as a PNG or WebP with a transparent background and choose that.',
    };
  }
  if (found.kind === 'gif') {
    return {
      ok: false, reason: 'gif',
      message: 'GIF pictures are not accepted: most are animated, and an animation would play on every participant’s iPad and make the page slow. Save a still picture as a PNG or WebP and choose that.',
    };
  }
  if (found.animated) {
    return { ok: false, reason: 'animated', message: 'Animated pictures are not accepted. Save a still picture (one frame) as a PNG or WebP and choose that.' };
  }
  if (found.kind === 'unknown') {
    return { ok: false, reason: 'not-a-picture', message: 'That file is not a picture this page can read. Choose a PNG, JPEG or WebP picture.' };
  }
  if (isTruncated(/** @type {'png' | 'jpeg' | 'webp'} */ (found.kind), /** @type {Uint8Array} */ (bytes))) {
    return { ok: false, reason: 'damaged', message: 'This picture looks damaged: the file stops short, as if the download or copy did not finish. Copy it again from where it came from, or choose another.' };
  }
  return { ok: true, kind: found.kind, mime: /** @type {string} */ (found.mime) };
}
