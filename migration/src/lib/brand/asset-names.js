// File names for uploaded pictures, and the hash behind them. Plain JS with JSDoc and no DOM.
//
// A picture is stored under a name built from what it is: `<slug>-<slot>-<hash>.<ext>`, flat (no
// subfolders), where the hash is the first 10 hex digits of the SHA-256 of the file's bytes. So:
//   - replacing a picture with a different one gives a new name, and a page that cached the old one
//     can never show it by mistake (the address changes with the content);
//   - uploading the very same bytes again gives the same name, which is harmless;
//   - a name says whose it is, so "remove the old file" can be refused for any file that is not this
//     client's own upload (it never touches a seeded logo or another client's picture).
// SHA-256 is written out here rather than taken from crypto.subtle, which does not exist on a page
// opened over plain http (an iPad on the LAN reaching the dev server), and is not async to test.

import { extensionOf } from './asset-specs.js';

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (value, bits) => (value >>> bits) | (value << (32 - bits));

/**
 * SHA-256 of some bytes, as 64 lower-case hex digits.
 * @param {Uint8Array} bytes
 */
export function sha256Hex(bytes) {
  const length = bytes.length;
  const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
  view.setUint32(padded.length - 4, (length << 3) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) w[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotr(w[index - 15], 7) ^ rotr(w[index - 15], 18) ^ (w[index - 15] >>> 3);
      const s1 = rotr(w[index - 2], 17) ^ rotr(w[index - 2], 19) ^ (w[index - 2] >>> 10);
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let index = 0; index < 64; index += 1) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[index] + w[index]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h, (word) => word.toString(16).padStart(8, '0')).join('');
}

/** How many hash digits a name carries. */
export const HASH_LENGTH = 10;
const SLOT_NAMES = ['hero', 'logo', 'background', 'tile'];
const NAME = /^([a-z0-9]+(?:-[a-z0-9]+)*)-(hero|logo|background|tile)-([0-9a-f]{10})\.(png|webp|jpg)$/;

/**
 * The stored name for a picture: `<slug>-<slot>-<hash>.<ext>`.
 * @param {string} slug The client's slug (a to z, 0 to 9, hyphens).
 * @param {string} slot  hero, logo, background or tile
 * @param {Uint8Array} bytes The finished file.
 * @param {string} mime  image/png, image/webp or image/jpeg
 */
export function assetFileName(slug, slot, bytes, mime) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new TypeError(`Not a client slug: ${JSON.stringify(slug)}`);
  if (!SLOT_NAMES.includes(slot)) throw new TypeError(`Not a picture slot: ${JSON.stringify(slot)}`);
  return `${slug}-${slot}-${sha256Hex(bytes).slice(0, HASH_LENGTH)}.${extensionOf(mime)}`;
}

/** The last part of an address, without a query or fragment. @param {string} url */
export const fileNameOf = (url) => decodeURIComponent(String(url).split(/[?#]/)[0].split('/').pop() ?? '');

/**
 * Is this address one of OUR uploads for this client (so it is ours to remove)? Matches on the name
 * only: `<slug>-<slot>-<10 hex>.<ext>` with this client's slug. A seeded logo, a picture pasted from
 * elsewhere and another client's file all answer no.
 * @param {string | null | undefined} url @param {string} slug
 */
export function isOwnUpload(url, slug) {
  if (!url) return false;
  const match = NAME.exec(fileNameOf(url));
  return match !== null && match[1] === slug;
}
