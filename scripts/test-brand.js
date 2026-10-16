// Phase 6, Brand Studio, below the browser: the plain functions (no DOM) that decide what a picture may
// be, how it is cropped and compressed, what a colour does to the page and what a save writes. The
// browser side (the dialogs, the preview, the participant page) is scripts/migration-tests/brand-*.spec.ts.
// Run: npm run test:brand (also part of npm test).
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  ACCEPT, BRAND_SLOTS, KB, MAX_INPUT_BYTES, MAX_UPSCALE, MIN_SCALE_SHARE, SLOTS, checkDimensions, describeSpec, extensionOf, fitScale,
  formatBytes, minimumWidth, slotSpec,
} from '../migration/src/lib/asset-specs.js';
import { inspectFile, isTruncated, sniffImage } from '../migration/src/lib/image-sniff.js';
import {
  MAX_ZOOM, clampView, containScale, coverScale, drawPlan, fitView, keyboardView, panBy, scaleOf, scaleRange, sliderOf, zoomTo,
} from '../migration/src/lib/crop-math.js';
import { CompressError, QUALITIES, SCALE_STEPS, compressToCap } from '../migration/src/lib/asset-compress.js';
import { SCRIM_ALPHA, SCRIM_COLOUR, minimumScrimAlpha, worstTextContrast } from '../migration/src/lib/scrim.js';
import { assetFileName, fileNameOf, isOwnUpload, sha256Hex } from '../migration/src/lib/asset-names.js';
import {
  DARK_PIXEL, LIGHT_PIXEL, MOSTLY, OPEN_PAGES_NOTE, PRESETS, brandReport, changesForSave, contrastRows, copyColoursFrom, draftFromClient,
  legacyColours, logoStats, logoUrlChange, masterColours, plateAdvice, resetColours, sameDraft,
} from '../migration/src/lib/brand-studio.js';
import { DEVICES, deviceById, fitToWidth, safeArea, visibleShare } from '../migration/src/lib/brand-devices.js';
import { buildClientTheme, resolveClientTheme, reviseClientTheme, safeFocus, safePlate } from '../migration/src/lib/client-theme.js';
import {
  DEFAULT_PRIMARY, MIN_GRAPHIC_CONTRAST, MIN_TEXT_CONTRAST, PLATE_COLOURS, SURFACE_ALPHA, compositeOver, contrastRatio, deriveTheme, isNearDangerHue,
  relativeLuminance,
} from '../migration/src/lib/theme.js';
import { samplePack } from '../migration/src/lib/sample-clients.js';

const ROOT = path.join(import.meta.dirname, '..');
const WHITE = '#FFFFFF';

// ---- Pictures as bytes -----------------------------------------------------------------------------

const ascii = (text) => Uint8Array.from(text, (char) => char.charCodeAt(0));
const concat = (...parts) => Uint8Array.from(parts.flatMap((part) => [...part]));
const u32 = (value) => Uint8Array.of(value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
const chunk = (type, data = new Uint8Array()) => concat(u32(data.length), ascii(type), data, u32(0));
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const png = (...chunks) => concat(PNG_SIGNATURE, chunk('IHDR', new Uint8Array(13)), ...chunks, chunk('IDAT', Uint8Array.of(1, 2, 3)), chunk('IEND'));
const jpeg = () => Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 0xff, 0xd9);
const le32 = (value) => Uint8Array.of(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, value >>> 24);
const webp = (flags = 0) => concat(ascii('RIFF'), le32(22), ascii('WEBP'), ascii('VP8X'), le32(10), Uint8Array.of(flags, 0, 0, 0), new Uint8Array(6));

// ---- The slots ---------------------------------------------------------------------------------------

describe('picture slots (the brief, exactly)', () => {
  it('has the sizes, shapes, formats and caps that were asked for', () => {
    assert.deepEqual(Object.keys(SLOTS), ['hero', 'logo', 'background', 'tile']);
    assert.deepEqual([...BRAND_SLOTS], ['hero', 'logo', 'background']);
    const table = Object.values(SLOTS).map((spec) => [spec.id, spec.width, spec.height, spec.ratio, spec.formats.join(','), spec.transparent, spec.maxBytes / KB]);
    assert.deepEqual(table, [
      ['hero', 1200, 1200, '1:1', 'image/webp,image/png', true, 300],
      ['logo', 800, 400, '2:1', 'image/webp,image/png', true, 150],
      ['background', 1536, 2048, '3:4', 'image/webp,image/jpeg', false, 350],
      ['tile', 480, 320, '3:2', 'image/webp,image/png', true, 60],
    ]);
    for (const spec of Object.values(SLOTS)) {
      const [across, down] = spec.ratio.split(':').map(Number);
      assert.equal(spec.width / spec.height, across / down, `${spec.id}: the pixel size is the stated shape`);
      assert.ok(spec.formats.includes('image/webp'), 'WebP is always tried first');
    }
    assert.equal(SLOTS.background.focal, true);
    assert.ok(Object.values(SLOTS).filter((spec) => spec.id !== 'background').every((spec) => !spec.focal));
    assert.throws(() => slotSpec('banner'), /Unknown picture slot/);
    assert.equal(ACCEPT, 'image/png,image/jpeg,image/webp', 'the picker offers PNG, JPEG and WebP and nothing else');
  });

  it('prints the specs on a slot card', () => {
    assert.deepEqual(describeSpec(SLOTS.hero), { size: '1200 × 1200 px', ratio: '1:1 (square)', format: 'PNG or WebP with a transparent background', max: 'Up to 300 KB' });
    assert.deepEqual(describeSpec(SLOTS.logo), { size: '800 × 400 px', ratio: '2:1 (wide)', format: 'PNG or WebP with a transparent background', max: 'Up to 150 KB' });
    assert.deepEqual(describeSpec(SLOTS.background), { size: '1536 × 2048 px', ratio: '3:4 (tall)', format: 'JPEG or WebP', max: 'Up to 350 KB' });
    assert.equal(describeSpec(SLOTS.tile).max, 'Up to 60 KB');
    assert.equal(formatBytes(150 * KB), '150 KB');
    assert.equal(formatBytes(10 * 1024 * 1024), '10 MB');
    assert.equal(formatBytes(1536), '1.5 KB');
    assert.deepEqual(['image/png', 'image/webp', 'image/jpeg', 'image/gif'].map(extensionOf), ['png', 'webp', 'jpg', 'png']);
  });

  it('judges a picture\'s size: fine, soft (enlarged a little), or too small (enlarged more than twice)', () => {
    const ok = checkDimensions(SLOTS.hero, { width: 1200, height: 1200 });
    assert.deepEqual([ok.level, ok.message], ['ok', '']);
    assert.equal(checkDimensions(SLOTS.hero, { width: 4000, height: 3000 }).level, 'ok');
    const soft = checkDimensions(SLOTS.hero, { width: 700, height: 700 });
    assert.equal(soft.level, 'soft');
    assert.match(soft.message, /700 × 700 px, smaller than the 1200 × 1200 px/);
    const tiny = checkDimensions(SLOTS.hero, { width: 100, height: 100 });
    assert.equal(tiny.level, 'reject');
    assert.match(tiny.message, /only 100 × 100 px/);
    assert.match(tiny.message, /at least 600 px wide/);
    assert.equal(checkDimensions(SLOTS.hero, { width: 600, height: 600 }).level, 'soft', 'exactly twice is the limit');
    assert.equal(checkDimensions(SLOTS.hero, { width: 599, height: 599 }).level, 'reject');
    assert.equal(checkDimensions(SLOTS.hero, { width: 0, height: 10 }).level, 'reject');
    assert.equal(MAX_UPSCALE, 2);
    // A logo is fitted whole (contain): a wide one is judged by its width, not by the frame's height.
    assert.equal(checkDimensions(SLOTS.logo, { width: 1000, height: 200 }).level, 'ok');
    assert.equal(checkDimensions(SLOTS.logo, { width: 500, height: 100 }).level, 'soft');
    assert.equal(checkDimensions(SLOTS.logo, { width: 300, height: 60 }).level, 'reject');
    // A tall background is judged by covering the whole 3:4 frame.
    assert.equal(checkDimensions(SLOTS.background, { width: 4000, height: 1000 }).level, 'reject', 'a thin strip would be enlarged 2.05 times to fill the height');
    assert.equal(checkDimensions(SLOTS.background, { width: 3000, height: 4000 }).level, 'ok');
  });

  it('the stated minimum width really is the narrowest that is accepted', () => {
    for (const spec of Object.values(SLOTS)) {
      for (const aspect of [0.4, 0.75, 1, 1.5, 2, 4]) {
        const wide = minimumWidth(spec, aspect);
        const at = (width) => checkDimensions(spec, { width, height: Math.round(width / aspect) }).level;
        assert.notEqual(at(wide + 1), 'reject', `${spec.id} at ${aspect}: ${wide + 1} wide is accepted`);
        assert.equal(at(Math.max(1, Math.floor(wide * 0.85))), 'reject', `${spec.id} at ${aspect}: 85% of ${wide} is not`);
      }
    }
    assert.equal(fitScale({ width: 400, height: 200 }, { width: 800, height: 400 }, 'cover'), 2);
    assert.equal(fitScale({ width: 400, height: 100 }, { width: 800, height: 400 }, 'contain'), 2);
    assert.equal(fitScale({ width: 400, height: 100 }, { width: 800, height: 400 }, 'cover'), 4);
  });
});

// ---- What a file is -----------------------------------------------------------------------------------

describe('what a picked file is (by its bytes, not its name)', () => {
  it('recognises PNG, JPEG and WebP, and the formats it refuses', () => {
    assert.deepEqual([png(), jpeg(), webp()].map((bytes) => sniffImage(bytes).kind), ['png', 'jpeg', 'webp']);
    assert.equal(sniffImage(ascii('GIF89a\x01\x00\x01\x00')).kind, 'gif');
    assert.equal(sniffImage(ascii('GIF87a')).kind, 'gif');
    assert.equal(sniffImage(ascii('<?xml version="1.0"?>\n<!-- c --><svg xmlns="http://www.w3.org/2000/svg"/>')).kind, 'svg');
    assert.equal(sniffImage(ascii('﻿<svg viewBox="0 0 1 1"></svg>')).kind, 'svg');
    assert.equal(sniffImage(ascii('PK\x03\x04 not a picture')).kind, 'unknown');
    assert.equal(sniffImage(new Uint8Array()).kind, 'unknown');
    assert.equal(sniffImage(Uint8Array.of(0x89, 0x50)).kind, 'unknown', 'a truncated header is not a picture');
  });

  it('finds animated PNG and WebP', () => {
    assert.equal(sniffImage(png()).animated, false);
    assert.equal(sniffImage(png(chunk('acTL', new Uint8Array(8)))).animated, true, 'an APNG has acTL before its first IDAT');
    assert.equal(sniffImage(webp(0)).animated, false);
    assert.equal(sniffImage(webp(0x02)).animated, true, 'a WebP with the animation flag');
    assert.equal(sniffImage(ascii('GIF89a')).animated, true);
  });

  it('refuses what it should, with a message that says what to do', () => {
    const verdict = (bytes, size = bytes.length) => inspectFile({ size, bytes });
    assert.deepEqual(verdict(png()).ok && verdict(png()).kind, 'png');
    assert.equal(verdict(jpeg()).mime, 'image/jpeg');
    const svg = verdict(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    assert.equal(svg.ok, false);
    assert.equal(svg.reason, 'svg');
    assert.match(svg.message, /SVG drawings are not accepted/);
    assert.match(svg.message, /script/);
    assert.match(svg.message, /PNG or WebP/);
    const gif = verdict(ascii('GIF89a....'));
    assert.equal(gif.reason, 'gif');
    assert.match(gif.message, /animated/);
    assert.match(gif.message, /still picture/);
    assert.equal(verdict(png(chunk('acTL', new Uint8Array(8)))).reason, 'animated');
    assert.equal(verdict(ascii('hello world')).reason, 'not-a-picture');
    assert.match(verdict(ascii('hello world')).message, /not a picture/);
    assert.equal(verdict(new Uint8Array(), 0).reason, 'empty');
  });

  it('refuses a picture that stops short (a PNG with no end, a JPEG with no end, a WebP shorter than its header says)', () => {
    const cut = (bytes) => bytes.subarray(0, Math.floor(bytes.length * 0.6));
    assert.equal(isTruncated('png', png()), false);
    assert.equal(isTruncated('png', cut(png())), true);
    assert.equal(isTruncated('jpeg', jpeg()), false);
    assert.equal(isTruncated('jpeg', concat(jpeg().subarray(0, 8), new Uint8Array(200))), true);
    assert.equal(isTruncated('webp', webp()), false);
    assert.equal(isTruncated('webp', cut(webp())), true);
    const damaged = inspectFile({ size: 40, bytes: cut(png(chunk('tEXt', new Uint8Array(50)))) });
    assert.equal(damaged.ok, false);
    assert.equal(damaged.reason, 'damaged');
    assert.match(damaged.message, /looks damaged/);
    assert.equal(inspectFile({ size: png().length, bytes: png() }).ok, true);
  });

  it('refuses a file over 10 MB without needing to read it, and takes one of exactly 10 MB', () => {
    assert.equal(MAX_INPUT_BYTES, 10 * 1024 * 1024);
    const big = inspectFile({ size: MAX_INPUT_BYTES + 1, bytes: null });
    assert.equal(big.ok, false);
    assert.equal(big.reason, 'too-large');
    assert.match(big.message, /over the 10 MB limit/);
    assert.equal(inspectFile({ size: MAX_INPUT_BYTES, bytes: png() }).ok, true);
  });
});

// ---- Crop and fit --------------------------------------------------------------------------------------

describe('crop and fit', () => {
  const frame = { width: 1200, height: 1200 };
  const wide = { width: 3000, height: 1000 };

  it('cover fills the frame and contain shows all of the picture', () => {
    assert.equal(coverScale(wide, frame), 1.2);
    assert.equal(containScale(wide, frame), 0.4);
    assert.deepEqual(fitView(wide, frame, 'cover'), { scale: 1.2, cx: 1500, cy: 500 });
    assert.deepEqual(fitView(wide, frame, 'contain'), { scale: 0.4, cx: 1500, cy: 500 });
    assert.deepEqual(scaleRange(wide, frame, { letterbox: true }), { min: 0.4, max: 1.2 * MAX_ZOOM });
    assert.deepEqual(scaleRange(wide, frame, { letterbox: false }), { min: 1.2, max: 1.2 * MAX_ZOOM });
  });

  it('a picture that fills the frame cannot be moved off it; one that does not fill it stays centred', () => {
    const range = scaleRange(wide, frame, { letterbox: true });
    // Covering: the frame always sees picture.
    const covering = fitView(wide, frame, 'cover');
    for (const [dx, dy] of [[10_000, 0], [-10_000, 0], [0, 10_000], [123, -456]]) {
      const moved = panBy(covering, dx, dy, wide, frame, range);
      const plan = drawPlan(wide, frame, moved);
      assert.deepEqual([plan.dx, plan.dy, plan.dw, plan.dh], [0, 0, 1200, 1200], `no gap after moving by ${dx},${dy}`);
      assert.ok(plan.sx >= 0 && plan.sx + plan.sw <= wide.width + 1e-6);
    }
    assert.ok(Math.abs(panBy(covering, 10_000, 0, wide, frame, range).cx - 500) < 1e-9, 'the frame is 1000 source px wide, so its centre cannot go left of 500');
    // Contained: a wide picture in a square frame is centred and cannot be dragged sideways or up.
    const contained = fitView(wide, frame, 'contain');
    assert.deepEqual(panBy(contained, 300, 300, wide, frame, range), contained);
  });

  it('drags the way a finger does, and zoom keeps the point under the pointer still', () => {
    const range = scaleRange(wide, frame, { letterbox: true });
    const view = { scale: 1.2 * 2, cx: 1500, cy: 500 };
    const right = panBy(view, 100, 0, wide, frame, range);
    assert.ok(right.cx < view.cx, 'dragging the picture right moves what is in the middle to the left');
    assert.ok(Math.abs(view.cx - right.cx - 100 / view.scale) < 1e-9);
    const anchor = { x: 900, y: 300 };
    const sourceUnder = (candidate) => ({ x: candidate.cx + (anchor.x - frame.width / 2) / candidate.scale, y: candidate.cy + (anchor.y - frame.height / 2) / candidate.scale });
    const before = sourceUnder(view);
    const zoomed = zoomTo(view, view.scale * 1.5, wide, frame, range, anchor);
    assert.ok(zoomed.scale > view.scale);
    const after = sourceUnder(zoomed);
    assert.ok(Math.abs(after.x - before.x) < 1e-6 && Math.abs(after.y - before.y) < 1e-6, 'the point under the pointer did not move');
    assert.equal(zoomTo(view, 1e9, wide, frame, range).scale, range.max, 'zoom stops at the most');
    assert.equal(zoomTo(view, 0, wide, frame, range).scale, range.min, 'and at the least');
  });

  it('draws a plan that lands on exactly the frame, or on a centred strip of it when letterboxed', () => {
    const cover = drawPlan(wide, frame, fitView(wide, frame, 'cover'));
    assert.deepEqual([cover.dx, cover.dy, cover.dw, cover.dh], [0, 0, 1200, 1200]);
    assert.ok(Math.abs(cover.sw - 1000) < 1e-9 && Math.abs(cover.sh - 1000) < 1e-9, 'the middle 1000 x 1000 of the 3000 x 1000');
    assert.ok(Math.abs(cover.sx - 1000) < 1e-9 && cover.sy === 0);
    const contain = drawPlan(wide, frame, fitView(wide, frame, 'contain'));
    assert.deepEqual([contain.dx, contain.dy, contain.dw, contain.dh], [0, 400, 1200, 400], 'a 3:1 picture is a strip across the middle of a square');
    assert.deepEqual([contain.sx, contain.sy, contain.sw, contain.sh], [0, 0, 3000, 1000]);
    // A picture exactly the slot's shape and size maps one to one.
    const same = drawPlan(frame, frame, fitView(frame, frame, 'cover'));
    assert.deepEqual(same, { sx: 0, sy: 0, sw: 1200, sh: 1200, dx: 0, dy: 0, dw: 1200, dh: 1200 });
    // Destination edges are whole pixels even for an awkward scale.
    const odd = drawPlan({ width: 777, height: 333 }, { width: 800, height: 400 }, fitView({ width: 777, height: 333 }, { width: 800, height: 400 }, 'contain'));
    for (const edge of [odd.dx, odd.dy, odd.dw, odd.dh]) assert.equal(edge, Math.round(edge));
  });

  it('the slider is logarithmic and agrees with the scale', () => {
    const range = scaleRange(wide, frame, { letterbox: true });
    assert.equal(sliderOf(range.min, range), 0);
    assert.ok(Math.abs(sliderOf(range.max, range) - 1) < 1e-12);
    for (const position of [0, 0.1, 0.5, 0.9, 1]) assert.ok(Math.abs(sliderOf(scaleOf(position, range), range) - position) < 1e-9);
    assert.equal(sliderOf(1, { min: 1, max: 1 }), 0);
  });

  it('arrow keys pan, plus and minus zoom, shift takes bigger steps; other keys do nothing', () => {
    const range = scaleRange(wide, frame, { letterbox: true });
    const view = { scale: 2.4, cx: 1500, cy: 500 };
    const left = keyboardView('ArrowLeft', false, view, wide, frame, range);
    const right = keyboardView('ArrowRight', false, view, wide, frame, range);
    assert.ok(left.cx < view.cx && right.cx > view.cx || left.cx > view.cx, 'the arrows move it');
    assert.equal(left.cx - view.cx, -(right.cx - view.cx), 'left and right are equal and opposite');
    const bigger = keyboardView('ArrowRight', true, view, wide, frame, range);
    assert.ok(Math.abs(bigger.cx - view.cx) > Math.abs(right.cx - view.cx));
    assert.ok(keyboardView('+', false, view, wide, frame, range).scale > view.scale);
    assert.ok(keyboardView('-', false, view, wide, frame, range).scale < view.scale);
    assert.equal(keyboardView('a', false, view, wide, frame, range), null);
    // From a seen-edge position, the arrow into the edge does nothing more.
    const edge = clampView({ scale: 2.4, cx: 0, cy: 500 }, wide, frame, range);
    assert.deepEqual(keyboardView('ArrowRight', false, edge, wide, frame, range), edge, 'already at the left edge of the picture');
  });

  it('whatever a user does, a view that fills the frame never shows an empty edge (random walk)', () => {
    let seed = 7;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (const source of [{ width: 2000, height: 3000 }, { width: 5000, height: 1200 }, { width: 900, height: 900 }, { width: 6000, height: 4000 }]) {
      for (const [spec, letterbox] of [[SLOTS.background, false], [SLOTS.hero, true]]) {
        const slotFrame = { width: spec.width, height: spec.height };
        const range = scaleRange(source, slotFrame, { letterbox });
        let view = fitView(source, slotFrame, letterbox ? 'contain' : 'cover');
        for (let step = 0; step < 200; step += 1) {
          const choice = random();
          if (choice < 0.5) view = panBy(view, (random() - 0.5) * 800, (random() - 0.5) * 800, source, slotFrame, range);
          else view = zoomTo(view, view.scale * (0.6 + random() * 0.9), source, slotFrame, range, { x: random() * slotFrame.width, y: random() * slotFrame.height });
          const plan = drawPlan(source, slotFrame, view);
          assert.ok(view.scale >= range.min - 1e-9 && view.scale <= range.max + 1e-9);
          assert.ok(plan.sx >= -1e-6 && plan.sy >= -1e-6 && plan.sx + plan.sw <= source.width + 1e-6 && plan.sy + plan.sh <= source.height + 1e-6, 'the source rectangle is inside the picture');
          if (view.scale >= coverScale(source, slotFrame) - 1e-9) assert.deepEqual([plan.dx, plan.dy, plan.dw, plan.dh], [0, 0, slotFrame.width, slotFrame.height], 'no empty edge');
        }
      }
    }
  });
});

// ---- Compress to the cap ------------------------------------------------------------------------------

describe('compress to the size cap', () => {
  /**
   * A fake encoder. Size model: bytes = pixels * bytesPerPixel(mime, quality), so smaller pictures and lower
   * qualities are smaller, as with a real encoder. `unsupported` lists formats the "browser" answers with a PNG.
   */
  function encoder({ complexity = 1, unsupported = [], log = [] } = {}) {
    const bytesPer = { 'image/webp': (q) => 0.05 + 0.5 * q * q, 'image/jpeg': (q) => 0.08 + 0.6 * q * q, 'image/png': () => 0.55 };
    return {
      log,
      render: (width, height) => ({ width, height }),
      encode: async (canvas, mime, quality) => {
        const real = unsupported.includes(mime) ? 'image/png' : mime;
        const bytes = Math.round(canvas.width * canvas.height * bytesPer[real](quality) * complexity * 0.1);
        log.push([mime, real, quality ?? null, canvas.width, canvas.height, bytes]);
        return { mime: real, bytes, data: `${real}:${canvas.width}x${canvas.height}:${bytes}` };
      },
    };
  }

  it('uses the best WebP that fits, at exactly the slot\'s size', async () => {
    const fake = encoder({ complexity: 0.4 });
    const result = await compressToCap({ spec: SLOTS.hero, render: fake.render, encode: fake.encode });
    assert.equal(result.mime, 'image/webp');
    assert.deepEqual([result.width, result.height, result.scaledDown], [1200, 1200, false]);
    assert.ok(result.bytes <= SLOTS.hero.maxBytes);
    assert.equal(result.quality, QUALITIES['image/webp'][0], 'the best quality fits, so it is used');
  });

  it('steps the quality down until the file fits, and keeps the size', async () => {
    const fake = encoder({ complexity: 7 });
    const result = await compressToCap({ spec: SLOTS.hero, render: fake.render, encode: fake.encode });
    assert.equal(result.mime, 'image/webp');
    assert.ok(result.bytes <= SLOTS.hero.maxBytes);
    assert.deepEqual([result.width, result.height], [1200, 1200]);
    const ladder = QUALITIES['image/webp'];
    assert.ok(result.quality < ladder[0] && result.quality >= ladder[ladder.length - 1]);
    // It is the BEST quality that fits: the one above it would not have.
    const above = ladder[ladder.indexOf(result.quality) - 1];
    assert.ok(fake.log.some(([, , quality, , , bytes]) => quality === above && bytes > SLOTS.hero.maxBytes), 'the next quality up was tried and was too big');
  });

  it('when the browser cannot make WebP (Safari answers with PNG) it uses PNG, then scales down in steps', async () => {
    const small = encoder({ unsupported: ['image/webp'], complexity: 0.5 });
    const first = await compressToCap({ spec: SLOTS.hero, render: small.render, encode: small.encode });
    assert.equal(first.mime, 'image/png');
    assert.deepEqual([first.width, first.height, first.scaledDown, first.quality], [1200, 1200, false, null]);
    assert.equal(small.log.filter(([asked]) => asked === 'image/webp').length, 1, 'it asked for WebP once, saw PNG come back, and stopped asking');

    const heavy = encoder({ unsupported: ['image/webp'], complexity: 6 });
    const second = await compressToCap({ spec: SLOTS.hero, render: heavy.render, encode: heavy.encode });
    assert.equal(second.mime, 'image/png');
    assert.equal(second.scaledDown, true);
    assert.ok(second.bytes <= SLOTS.hero.maxBytes);
    assert.ok(second.width < 1200 && second.width >= Math.round(1200 * MIN_SCALE_SHARE), `scaled to ${second.width}`);
    assert.equal(second.width, second.height, 'the shape is kept');
    // Larger steps were tried first, in order.
    const widths = [...new Set(heavy.log.filter(([, real]) => real === 'image/png').map(([, , , width]) => width))];
    assert.deepEqual(widths, [...widths].sort((a, b) => b - a));
    assert.equal(widths[0], 1200);
  });

  it('never goes below 75% of the slot\'s width, and then says what to do', async () => {
    const hopeless = encoder({ unsupported: ['image/webp'], complexity: 12, log: [] });
    await assert.rejects(
      compressToCap({ spec: SLOTS.hero, render: hopeless.render, encode: hopeless.encode }),
      (error) => {
        assert.ok(error instanceof CompressError);
        assert.match(error.message, /too detailed to fit in 300 KB/);
        assert.match(error.message, /simpler picture/);
        assert.match(error.message, /Chrome or Edge/, 'a browser that cannot make WebP is told about it');
        assert.equal(error.lossyMissing, true);
        assert.equal(error.cap, 300 * KB);
        assert.ok(error.smallest.width >= 900);
        return true;
      },
    );
    const smallestAsked = Math.min(...hopeless.log.map(([, , , width]) => width));
    assert.equal(smallestAsked, Math.round(1200 * MIN_SCALE_SHARE), 'the last step was 75%, not less');
    assert.equal(SCALE_STEPS.at(-1), MIN_SCALE_SHARE);

    const lossyOnly = encoder({ complexity: 80 });
    await assert.rejects(compressToCap({ spec: SLOTS.logo, render: lossyOnly.render, encode: lossyOnly.encode }), (error) => {
      assert.equal(error.lossyMissing, false);
      assert.doesNotMatch(error.message, /Chrome or Edge/);
      return true;
    });
  });

  it('a background falls back from WebP to JPEG; a picture that needs transparency is never made a JPEG', async () => {
    const safari = encoder({ unsupported: ['image/webp'], complexity: 1 });
    const background = await compressToCap({ spec: SLOTS.background, render: safari.render, encode: safari.encode });
    assert.equal(background.mime, 'image/jpeg');
    assert.deepEqual([background.width, background.height], [1536, 2048]);
    assert.ok(background.bytes <= SLOTS.background.maxBytes);
    assert.ok(!safari.log.some(([asked]) => asked === 'image/png'), 'a background is never a PNG');

    const logo = encoder({ unsupported: ['image/webp'], complexity: 0.3 });
    await compressToCap({ spec: SLOTS.logo, render: logo.render, encode: logo.encode });
    assert.ok(!logo.log.some(([asked]) => asked === 'image/jpeg'), 'a logo is never a JPEG');
    for (const spec of Object.values(SLOTS)) assert.ok(spec.transparent === !spec.formats.includes('image/jpeg'));
  });

  it('keeps the shape at every size and stays within a sensible number of encodes', async () => {
    const fake = encoder({ unsupported: ['image/webp'], complexity: 10 });
    const result = await compressToCap({ spec: SLOTS.logo, render: fake.render, encode: fake.encode });
    assert.equal(result.width / result.height, 2);
    for (const [, , , width, height] of fake.log) assert.ok(Math.abs(width / height - 2) < 0.01);
    assert.ok(result.encodes <= 24, `${result.encodes} encodes`);
    assert.equal(result.encodes, fake.log.length);
  });
});

// ---- Colour --------------------------------------------------------------------------------------------

describe('deriveTheme keeps white text readable for any primary', () => {
  const PRIMARIES = {
    'standard blue': '#045BCC', Kroger: '#0060A9', "Domino's": '#0B648F', yellow: '#FFFF00', gold: '#FFD700', amber: '#F5C400', white: '#FFFFFF', 'off-white': '#F8F8F8',
    black: '#000000', 'near black': '#0A0A0A', red: '#E21737', 'deep red': '#C8102E', 'pure red': '#FF0000', 'Deloitte green': '#86BC25', 'forest green': '#2B7A3D',
    lime: '#00FF00', orange: '#FF6600', tangerine: '#F28C28', purple: '#5B3A99', plum: '#8B2F6F', cyan: '#00FFFF', grey: '#808080', 'light grey': '#CCCCCC',
    navy: '#0B3A75', teal: '#0B7285', pink: '#FF69B4', brown: '#6B4423', chartreuse: '#BFFF00', 'sky blue': '#87CEEB', 'hot magenta': '#FF00FF',
  };

  it('covers at least 25 primaries, including yellow, white, black, Domino\'s and Kroger', () => {
    assert.ok(Object.keys(PRIMARIES).length >= 25);
    for (const name of ['yellow', 'white', 'black', "Domino's", 'Kroger']) assert.ok(PRIMARIES[name], name);
    for (const [name, primary] of Object.entries(PRIMARIES)) {
      for (const plate of ['light', 'dark']) {
        const theme = deriveTheme(primary, undefined, { plate });
        const t = theme.tokens;
        for (const ground of [t['--bg-mid'], t['--bg-bottom']]) {
          const pill = contrastRatio(WHITE, compositeOver(WHITE, SURFACE_ALPHA, ground));
          assert.ok(pill >= MIN_TEXT_CONTRAST, `${name}: white on a pill over ${ground} is ${pill.toFixed(2)}`);
        }
        const button = contrastRatio(WHITE, t['--action']);
        assert.ok(button >= MIN_TEXT_CONTRAST, `${name}: white on the button ${t['--action']} is ${button.toFixed(2)}`);
        assert.ok(Math.abs(theme.contrast.action - button) < 1e-9 && theme.contrast.surface >= MIN_TEXT_CONTRAST);
        // The page colours are the same whichever plate the logo is on.
        assert.deepEqual([t['--bg-mid'], t['--action']], [deriveTheme(primary).tokens['--bg-mid'], deriveTheme(primary).tokens['--action']]);
        // What was adjusted is reported, and asking again with the adjusted colour changes nothing more.
        const changed = theme.adjustments.find((item) => item.token === '--bg-mid');
        if (changed) {
          assert.equal(changed.from, primary.toUpperCase());
          assert.equal(deriveTheme(t['--bg-mid']).adjustments.filter((item) => item.token === '--bg-mid').length, 0, `${name}: the adjusted colour is already readable`);
        } else {
          assert.equal(t['--bg-mid'], primary.toUpperCase(), `${name}: not adjusted, so used as chosen`);
        }
      }
    }
  });

  it('the light ones are darkened and say so; the standard blue, Kroger and Domino\'s are used as chosen', () => {
    for (const name of ['yellow', 'gold', 'white', 'off-white', 'cyan', 'lime', 'light grey', 'chartreuse', 'sky blue']) {
      const change = deriveTheme(PRIMARIES[name]).adjustments.find((item) => item.token === '--bg-mid');
      assert.ok(change, `${name} is adjusted`);
      assert.ok(relativeLuminance(change.to) < relativeLuminance(change.from));
    }
    for (const name of ['standard blue', 'Kroger', "Domino's", 'black', 'navy']) {
      assert.deepEqual(deriveTheme(PRIMARIES[name]).adjustments, [], `${name} needs no adjustment`);
    }
  });

  it('black does not break anything: the gradient stays black and the pills still carry white text', () => {
    const theme = deriveTheme('#000000');
    assert.equal(theme.tokens['--bg-mid'], '#000000');
    assert.ok(theme.contrast.surface > 15);
  });

  it('the plate decides whether an accent ring is drawn', () => {
    assert.equal(PLATE_COLOURS.light, '#FFFFFF');
    const navy = '#0B2A55';
    assert.equal(deriveTheme('#0B648F', navy, { plate: 'light' }).tokens['--accent-ring'], navy, 'navy shows on the white plate');
    assert.equal(deriveTheme('#0B648F', navy, { plate: 'dark' }).tokens['--accent-ring'], 'rgb(255 255 255 / 0)', 'and is lost on the dark one');
    assert.equal(deriveTheme('#0B648F', '#FFFFFF', { plate: 'dark' }).tokens['--accent-ring'], '#FFFFFF', 'white shows on the dark plate');
    assert.equal(deriveTheme('#0B648F', '#FFFFFF', { plate: 'light' }).tokens['--accent-ring'], 'rgb(255 255 255 / 0)');
    const reason = deriveTheme('#0B648F', navy, { plate: 'dark' }).adjustments.find((item) => item.token === '--accent-ring').reason;
    assert.match(reason, /the dark plate/);
    assert.deepEqual(deriveTheme('#0B648F', '#E21737').tokens, deriveTheme('#0B648F', '#E21737', { plate: 'light' }).tokens, 'light is the default');
    assert.ok(contrastRatio(navy, PLATE_COLOURS.dark) < MIN_GRAPHIC_CONTRAST);
  });
});

describe('the plate suits the logo', () => {
  /** An RGBA picture `size x size`: a block of `colour` (at `alpha`) on a transparent ground. */
  function picture(colour, { coverage = 0.4, alpha = 255, size = 40 } = {}) {
    const data = new Uint8ClampedArray(size * size * 4);
    const count = Math.round(size * size * coverage);
    for (let pixel = 0; pixel < size * size; pixel += 1) {
      if (pixel < count) data.set([...colour, alpha], pixel * 4);
    }
    return data;
  }

  it('measures how much of a logo is drawn, and how light or dark that is', () => {
    const white = logoStats(picture([255, 255, 255]));
    assert.ok(Math.abs(white.opaque - 0.4) < 0.01);
    assert.equal(white.light, 1);
    assert.equal(white.dark, 0);
    const black = logoStats(picture([0, 0, 0]));
    assert.deepEqual([black.light, black.dark], [0, 1]);
    const blue = logoStats(picture([4, 91, 204]));
    assert.deepEqual([blue.light, blue.dark], [0, 0]);
    assert.equal(logoStats(picture([255, 255, 255], { alpha: 40 })).opaque, 0, 'faint pixels do not count as drawn');
    assert.deepEqual(logoStats(new Uint8ClampedArray()), { opaque: 0, light: 0, dark: 0 });
    assert.ok(LIGHT_PIXEL > 0.5 && DARK_PIXEL < 0.1 && MOSTLY >= 0.5);
  });

  it('warns that a white logo vanishes on the light plate and suggests the dark one, and the reverse', () => {
    const white = logoStats(picture([255, 255, 255]));
    const advice = plateAdvice('light', white);
    assert.equal(advice.suggest, 'dark');
    assert.match(advice.message, /Dark plate/);
    assert.deepEqual(plateAdvice('dark', white), { message: '', suggest: null }, 'a white logo on the dark plate is right');
    const black = logoStats(picture([0, 0, 0]));
    assert.equal(plateAdvice('dark', black).suggest, 'light');
    assert.equal(plateAdvice('light', black).message, '');
    assert.equal(plateAdvice('light', logoStats(picture([4, 91, 204]))).message, '');
    assert.equal(plateAdvice('light', null).message, '');
    assert.equal(plateAdvice('light', logoStats(picture([255, 255, 255], { coverage: 0 }))).message, '', 'an empty picture is not judged');
    // Mostly white with a coloured mark: the threshold is 80% of the drawn pixels.
    const mixed = (marked) => { const data = new Uint8ClampedArray(picture([255, 255, 255], { coverage: 1 })); for (let pixel = 0; pixel < marked; pixel += 1) data.set([200, 30, 30, 255], pixel * 4); return logoStats(data); };
    assert.equal(plateAdvice('light', mixed(200)).suggest, 'dark', '87% white is mostly white');
    assert.equal(plateAdvice('light', mixed(400)).message, '', '75% white is not');
  });
});

describe('the scrim over a background picture is computed, not guessed', () => {
  it('is the least that keeps white text at 4.5:1 over a pure white photo, on a pill as well as on the page', () => {
    const minimum = minimumScrimAlpha();
    assert.ok(minimum > 0.5 && minimum < 0.9, `minimum ${minimum}`);
    assert.ok(worstTextContrast(minimum) >= MIN_TEXT_CONTRAST - 1e-9);
    assert.ok(worstTextContrast(minimum - 0.002) < MIN_TEXT_CONTRAST, 'a hair less fails');
    assert.ok(SCRIM_ALPHA >= minimum && SCRIM_ALPHA - minimum < 0.01 + 1e-9, 'rounded up to a whole percent');
    assert.ok(worstTextContrast(SCRIM_ALPHA) >= MIN_TEXT_CONTRAST);
    assert.ok(worstTextContrast(SCRIM_ALPHA - 0.01) < MIN_TEXT_CONTRAST, 'one percent less is below 4.5:1');
    assert.equal(SCRIM_COLOUR, '#000102');
    // It is the pill that sets the limit: the page text alone would need less.
    const pageOnly = (alpha) => contrastRatio(WHITE, compositeOver(SCRIM_COLOUR, alpha, WHITE));
    assert.ok(pageOnly(SCRIM_ALPHA - 0.1) >= MIN_TEXT_CONTRAST - 0.7);
    assert.ok(worstTextContrast(SCRIM_ALPHA - 0.1) < pageOnly(SCRIM_ALPHA - 0.1));
    // The old fixed 60-78% gradient did not hold for a white photo.
    assert.ok(worstTextContrast(0.6) < MIN_TEXT_CONTRAST, 'the scrim the shell used to have was too thin at the top');
  });

  it('needs less over a darker photo and nothing over a black one', () => {
    assert.ok(minimumScrimAlpha({ photo: '#808080' }) < minimumScrimAlpha());
    assert.equal(minimumScrimAlpha({ photo: '#000000' }), 0);
    assert.ok(worstTextContrast(SCRIM_ALPHA, { photo: '#F0F0F0' }) >= MIN_TEXT_CONTRAST);
  });
});

describe('file names', () => {
  it('SHA-256 agrees with node\'s for every length around the block edges and for random data', () => {
    assert.equal(sha256Hex(new Uint8Array()), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(sha256Hex(ascii('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    for (let length = 0; length <= 200; length += 1) {
      const bytes = randomBytes(length);
      assert.equal(sha256Hex(bytes), createHash('sha256').update(bytes).digest('hex'), `length ${length}`);
    }
    for (const length of [4096, 65_535, 300_000]) {
      const bytes = randomBytes(length);
      assert.equal(sha256Hex(bytes), createHash('sha256').update(bytes).digest('hex'), `length ${length}`);
    }
  });

  it('names a picture <slug>-<slot>-<hash>.<ext>, flat, and the same bytes give the same name', () => {
    const bytes = ascii('a picture');
    const name = assetFileName('kroger', 'hero', bytes, 'image/webp');
    assert.match(name, /^kroger-hero-[0-9a-f]{10}\.webp$/);
    assert.equal(name, assetFileName('kroger', 'hero', bytes, 'image/webp'));
    assert.notEqual(name, assetFileName('kroger', 'hero', ascii('another picture'), 'image/webp'), 'new content, new name');
    assert.equal(assetFileName('dominos', 'background', bytes, 'image/jpeg').split('.').pop(), 'jpg');
    assert.ok(!name.includes('/'));
    assert.throws(() => assetFileName('Not A Slug', 'hero', bytes, 'image/png'), /Not a client slug/);
    assert.throws(() => assetFileName('kroger', 'banner', bytes, 'image/png'), /Not a picture slot/);
    assert.throws(() => assetFileName('../x', 'hero', bytes, 'image/png'), TypeError);
  });

  it('only calls a file its own upload when the name is this client\'s', () => {
    const own = 'https://tenant.example/sites/cec/ClientLogos/kroger-hero-0123456789.webp';
    assert.equal(fileNameOf(own), 'kroger-hero-0123456789.webp');
    assert.equal(fileNameOf('/assets/x/y.png?v=2#frag'), 'y.png');
    assert.equal(isOwnUpload(own, 'kroger'), true);
    assert.equal(isOwnUpload(own, 'dominos'), false, 'another client\'s file is never removed');
    assert.equal(isOwnUpload('/assets/images/clients/kroger-logo.svg', 'kroger'), false, 'a seeded logo is not an upload');
    assert.equal(isOwnUpload('/assets/images/clients/upload-1760000000000-ab12cd34.png', 'kroger'), false, 'neither is an older upload');
    assert.equal(isOwnUpload('https://elsewhere.example/kroger-hero-0123456789.webp', 'kroger'), true, 'the name decides; the caller checks the folder');
    assert.equal(isOwnUpload('kroger-hero-0123456789.exe', 'kroger'), false);
    assert.equal(isOwnUpload('kroger-hero-0123.webp', 'kroger'), false);
    assert.equal(isOwnUpload(null, 'kroger'), false);
    assert.equal(isOwnUpload('my-co-hero-0123456789.png', 'my-co'), true);
    assert.equal(isOwnUpload('my-co-hero-0123456789.png', 'my'), false);
  });
});

describe('devices', () => {
  it('has the four previews that were asked for', () => {
    assert.deepEqual(DEVICES.map((device) => [device.id, device.width, device.height]), [
      ['phone', 390, 844], ['ipad-portrait', 820, 1180], ['ipad-landscape', 1180, 820], ['desktop', 1440, 900],
    ]);
    assert.equal(deviceById('desktop').width, 1440);
    assert.equal(deviceById('nope').id, 'phone');
  });

  it('works out how much of the background a screen shows, which is where the safe area comes from', () => {
    const background = { width: 1536, height: 2048 };
    assert.ok(Math.abs(visibleShare(background, DEVICES[0]).x - (390 / 844) / 0.75) < 1e-9, 'a phone shows the middle 62% of the width');
    assert.equal(visibleShare(background, DEVICES[0]).y, 1);
    assert.ok(Math.abs(visibleShare(background, DEVICES[3]).y - 0.75 / 1.6) < 1e-9, 'a desktop shows the middle 47% of the height');
    assert.equal(visibleShare(background, DEVICES[3]).x, 1);
    assert.deepEqual(fitToWidth(DEVICES[3], 720), { scale: 0.5, width: 720, height: 450 });
    assert.equal(fitToWidth(DEVICES[0], 1000).scale, 1, 'never enlarged');
  });

  it('draws the safe area: an inset for most slots, and what every screen shows for the background', () => {
    assert.deepEqual(safeArea(SLOTS.logo), { shape: 'rect', x: 0.06, y: 0.06, width: 0.88, height: 0.88 });
    assert.equal(safeArea(SLOTS.hero).shape, 'circle');
    const middle = safeArea(SLOTS.background);
    assert.ok(Math.abs(middle.width - (390 / 844) / 0.75) < 1e-9, 'the phone shows least across');
    assert.ok(Math.abs(middle.height - 0.75 / (1440 / 900)) < 1e-9, 'the desktop shows least down');
    assert.ok(Math.abs(middle.x + middle.width / 2 - 0.5) < 1e-9 && Math.abs(middle.y + middle.height / 2 - 0.5) < 1e-9, 'centred by default');
    const corner = safeArea(SLOTS.background, { x: 0, y: 100 });
    assert.deepEqual([corner.x, corner.y + corner.height], [0, 1], 'a focal point at the corner puts the window in the corner');
    // The window of the smallest screen lies inside the window of every other screen, wherever the focal point is.
    for (const focus of [{ x: 0, y: 0 }, { x: 30, y: 70 }, { x: 100, y: 50 }]) {
      const safe = safeArea(SLOTS.background, focus);
      for (const device of DEVICES) {
        const share = visibleShare(SLOTS.background, device);
        const left = (focus.x / 100) * (1 - share.x);
        const top = (focus.y / 100) * (1 - share.y);
        assert.ok(safe.x >= left - 1e-9 && safe.x + safe.width <= left + share.x + 1e-9, `${device.id} across at ${focus.x}`);
        assert.ok(safe.y >= top - 1e-9 && safe.y + safe.height <= top + share.y + 1e-9, `${device.id} down at ${focus.y}`);
      }
    }
  });
});

// ---- A draft and a save ---------------------------------------------------------------------------------

const clients = Object.fromEntries(samplePack().clients.map((client) => [client.id, client]));

describe('a client\'s draft', () => {
  it('starts from the stored theme, or the standard blue, and the older logo is the logo until one is chosen', () => {
    // (Phase 9b: Kroger ships with no logo now, so a client with an older LogoUrl is made from it.)
    const withOlderLogo = { ...clients['c-kroger'], logoUrl: '/assets/images/clients/acme-logo.png' };
    const kroger = draftFromClient(withOlderLogo);
    assert.equal(kroger.primary, '#045BCC');
    assert.equal(kroger.accent, null);
    assert.equal(kroger.plate, 'light');
    assert.equal(kroger.assets.logo, '/assets/images/clients/acme-logo.png', 'the older LogoUrl');
    assert.equal(draftFromClient(clients['c-kroger']).assets.logo, null, 'and none at all when there is none');
    assert.equal(kroger.assets.hero, null);
    const dominos = draftFromClient(clients['c-dominos']);
    assert.deepEqual([dominos.primary, dominos.accent], ['#0B648F', '#E21737']);
    assert.deepEqual(draftFromClient({ name: 'Plain', primaryColor: '#008044' }), { primary: DEFAULT_PRIMARY, accent: null, plate: 'light', assets: { hero: null, logo: null, background: null }, focus: null }, 'its older colour was chosen for the legacy pages and is not carried over');
    assert.equal(draftFromClient(null).primary, DEFAULT_PRIMARY);
    assert.equal(draftFromClient({ theme: { primary: 'nope', accent: 'blue', plate: 'green', assets: 'x' } }).plate, 'light');
    assert.ok(sameDraft(kroger, draftFromClient(withOlderLogo)));
    assert.ok(!sameDraft(kroger, { ...kroger, primary: '#123456' }));
    assert.ok(sameDraft(kroger, { ...kroger, primary: '#045bcc' }), 'case does not matter');
  });

  it('resets to the standard blue (keeping the pictures) and copies another client\'s colours (never its pictures)', () => {
    const draft = { ...draftFromClient(clients['c-dominos']), plate: 'dark', assets: { hero: 'https://x/dominos-hero-0123456789.png', logo: null, background: null } };
    const reset = resetColours(draft);
    assert.deepEqual([reset.primary, reset.accent, reset.plate], [DEFAULT_PRIMARY, null, 'light']);
    assert.equal(reset.assets.hero, draft.assets.hero);
    const copied = copyColoursFrom(draftFromClient({ ...clients['c-kroger'], logoUrl: '/assets/images/clients/acme-logo.png' }), clients['c-dominos']);
    assert.deepEqual([copied.primary, copied.accent], ['#0B648F', '#E21737']);
    assert.equal(copied.assets.logo, '/assets/images/clients/acme-logo.png', 'a client keeps its own logo');
  });
});

describe('the checks on a draft', () => {
  const draft = (primary, accent = null, plate = 'light') => ({ primary, accent, plate, assets: { hero: null, logo: null, background: null }, focus: null });

  it('lists the contrast of each pairing, passing for the standard blue', () => {
    const { rows } = contrastRows(draft('#045BCC'));
    assert.deepEqual(rows.map((row) => row.id), ['page-text', 'pill-text', 'button-text']);
    assert.ok(rows.every((row) => row.pass && row.ratio >= row.need));
    assert.deepEqual(rows.map((row) => row.need), [4.5, 4.5, 4.5]);
    const withAccent = contrastRows(draft('#0B648F', '#E21737')).rows;
    assert.deepEqual(withAccent.map((row) => row.id), ['page-text', 'pill-text', 'button-text', 'accent-rule', 'accent-ring']);
    const [rule, ring] = withAccent.slice(3);
    assert.deepEqual([rule.pass, ring.pass, rule.need], [false, true, 3], 'red is lost on the blue page and clear on the white plate');
  });

  it('says "adjusted for readability" with before and after, and the adjusted colour is what auto-fix uses', () => {
    const report = brandReport(draft('#FFD100'));
    assert.deepEqual(report.adjusted.from, '#FFD100');
    assert.equal(report.adjusted.to, report.theme.tokens['--bg-mid']);
    assert.ok(report.rows.every((row) => row.pass), 'after the adjustment everything passes');
    assert.ok(report.warnings.some((warning) => warning.id === 'primary-light'));
    assert.equal(brandReport(draft('#045BCC')).adjusted, null);
    assert.deepEqual(brandReport(draft(report.adjusted.to)).adjusted, null, 'auto-fix settles: nothing more to adjust');
  });

  it('warns about a red accent, a red primary, a very light or dark primary and an accent that will not show', () => {
    const ids = (value) => brandReport(value).warnings.map((warning) => warning.id);
    assert.ok(ids(draft('#0B648F', '#E21737')).includes('accent-near-red'), "Domino's own accent is near the wrong-answer red");
    assert.ok(ids(draft('#0B648F', '#C8102E')).includes('accent-near-red'));
    assert.ok(!ids(draft('#0B648F', '#FFD100')).includes('accent-near-red'));
    assert.ok(ids(draft('#C8102E')).includes('primary-near-red'));
    assert.ok(!ids(draft('#045BCC')).includes('primary-near-red'));
    assert.ok(ids(draft('#FFFFFF')).includes('primary-light'));
    assert.ok(ids(draft('#000000')).includes('primary-dark'));
    assert.ok(ids(draft('#0B648F', '#E21737')).includes('accent-rule'), 'fails 3:1 where used (the rule)');
    assert.ok(ids(draft('#0B648F', '#FFD100')).includes('accent-ring'), 'a yellow accent has no ring on white');
    assert.deepEqual(ids(draft('#045BCC')), [], 'the standard look has nothing to warn about');
    assert.ok(isNearDangerHue('#E21737'));
    const warning = brandReport(draft('#0B648F', '#E21737')).warnings.find((entry) => entry.id === 'accent-near-red').message;
    assert.match(warning, /30°/);
    assert.match(warning, /never on a button/);
  });

  it('adds the plate warning once the logo is measured', () => {
    const white = { opaque: 0.4, light: 1, dark: 0 };
    assert.ok(brandReport(draft('#045BCC'), { logo: white }).warnings.some((warning) => warning.id === 'plate'));
    assert.ok(!brandReport(draft('#045BCC', null, 'dark'), { logo: white }).warnings.some((warning) => warning.id === 'plate'));
    assert.ok(!brandReport(draft('#045BCC')).warnings.some((warning) => warning.id === 'plate'));
  });
});

describe('what a save writes, and what the older screens read', () => {
  const krogerDraft = (change = {}) => ({ ...draftFromClient(clients['c-kroger']), ...change });

  it('writes the theme at version + 1 with tokens derived again, the client\'s words kept, and the older colours from the theme', () => {
    const client = clients['c-kroger'];
    const next = krogerDraft({ primary: '#0B648F', accent: '#FFD100', plate: 'dark' });
    const changes = changesForSave(client, next, draftFromClient(client));
    assert.equal(changes.themeVersion, client.themeVersion + 1);
    assert.equal(changes.theme.version, changes.themeVersion);
    assert.deepEqual(changes.theme.tokens, deriveTheme('#0B648F', '#FFD100', { plate: 'dark' }).tokens);
    assert.equal(changes.theme.plate, 'dark');
    assert.deepEqual(changes.theme.copy, client.theme.copy, 'the words are the Clients screen\'s');
    assert.equal(changes.primaryColor, '#0B648F');
    assert.equal(changes.secondaryColor, '#FFD100', 'the accent when there is one');
    assert.equal(changes.theme.assets.tile, null, 'tile stays reserved and unused');
    assert.equal(resolveClientTheme({ ...client, ...changes }).source, 'stored');
  });

  it('writes the older colours as the page really is: a light primary is the darkened one; no accent means the button colour', () => {
    const light = legacyColours({ primary: '#FFD100' });
    assert.equal(light.primaryColor, deriveTheme('#FFD100').tokens['--bg-mid']);
    assert.equal(light.secondaryColor, deriveTheme('#FFD100').tokens['--action']);
    assert.deepEqual(legacyColours({ primary: '#0B648F', accent: '#e21737' }), { primaryColor: '#0B648F', secondaryColor: '#E21737' });
    const changes = changesForSave(clients['c-kroger'], krogerDraft(), draftFromClient(clients['c-kroger']));
    assert.equal(changes.primaryColor, '#045BCC');
    assert.equal(changes.secondaryColor, '#296CD4');
  });

  it('keeps Clients.LogoUrl in step with the logo for the legacy app, and leaves it alone otherwise', () => {
    // (A client with an older LogoUrl: Kroger ships with none now, Phase 9b.)
    const client = { ...clients['c-kroger'], logoUrl: '/assets/images/clients/acme-logo.png' };
    const saved = draftFromClient(client);
    assert.deepEqual(logoUrlChange(saved, saved), {});
    assert.deepEqual(logoUrlChange({ ...saved, assets: { ...saved.assets, logo: 'https://x/kroger-logo-0123456789.png' } }, saved), { logoUrl: 'https://x/kroger-logo-0123456789.png' });
    assert.deepEqual(logoUrlChange({ ...saved, assets: { ...saved.assets, logo: null } }, saved), { logoUrl: '' }, 'a removed logo clears it');
    // A logo that is only the older LogoUrl is not copied into the theme.
    assert.equal(changesForSave(client, saved, saved).theme.assets.logo, null);
    assert.equal('logoUrl' in changesForSave(client, saved, saved), false);
    const chosen = changesForSave(client, { ...saved, assets: { ...saved.assets, logo: 'https://x/kroger-logo-0123456789.png' } }, saved);
    assert.equal(chosen.theme.assets.logo, 'https://x/kroger-logo-0123456789.png');
    assert.equal(chosen.logoUrl, 'https://x/kroger-logo-0123456789.png');
    assert.equal(resolveClientTheme({ ...client, ...chosen }).assets.logo, 'https://x/kroger-logo-0123456789.png');
  });

  it('stores the background\'s focal point with the picture, and none without one', () => {
    const client = clients['c-kroger'];
    const saved = draftFromClient(client);
    const withPicture = changesForSave(client, { ...saved, assets: { ...saved.assets, background: 'https://x/kroger-background-0123456789.webp' }, focus: { x: 30.04, y: 71.26 } }, saved);
    assert.deepEqual(withPicture.theme.assets.backgroundFocus, { x: 30, y: 71.3 });
    assert.deepEqual(resolveClientTheme({ ...client, ...withPicture }).assets.backgroundFocus, { x: 30, y: 71.3 });
    assert.deepEqual(changesForSave(client, { ...saved, assets: { ...saved.assets, background: 'https://x/kroger-background-0123456789.webp' } }, saved).theme.assets.backgroundFocus, { x: 50, y: 50 }, 'centre unless one was set');
    assert.equal(changesForSave(client, { ...saved, focus: { x: 10, y: 10 } }, saved).theme.assets.backgroundFocus, undefined, 'a focal point means nothing without a picture');
    assert.equal('plate' in changesForSave(client, saved, saved).theme, false, 'the light plate is the absence of a plate');
    assert.equal(changesForSave(client, { ...saved, plate: 'dark' }, saved).theme.plate, 'dark');
    assert.deepEqual(safeFocus({ x: -5, y: 300 }), { x: 0, y: 100 });
    assert.equal(safeFocus({ x: 'a', y: 1 }), null);
    assert.equal(safeFocus(null), null);
    assert.equal(safePlate('dark'), 'dark');
    assert.equal(safePlate('green'), 'light');
  });

  it('the Master screen and exports read the stored theme when there is one, and the older fields otherwise', () => {
    assert.deepEqual(masterColours(clients['c-dominos']), { primaryColor: '#0B648F', secondaryColor: '#E21737', source: 'theme' });
    const stored = masterColours({ ...clients['c-kroger'], primaryColor: '#111111', secondaryColor: '#222222' });
    assert.equal(stored.source, 'theme');
    assert.equal(stored.primaryColor, '#045BCC', 'the stored theme wins over a stale older field');
    assert.deepEqual(masterColours({ id: 'old', primaryColor: '#123456', secondaryColor: '#654321' }), { primaryColor: '#123456', secondaryColor: '#654321', source: 'legacy' });
    assert.deepEqual(masterColours({ id: 'old', primaryColor: 'blue', theme: { primary: 'nope' } }), { primaryColor: null, secondaryColor: null, source: 'none' });
    assert.equal(masterColours(null).source, 'none');
  });

  it('round-trips the plate and the focal point through the stored theme, and revising a client\'s words keeps them', () => {
    const built = buildClientTheme({ primary: '#0B648F', accent: '#FFD100', plate: 'dark', version: 3, assets: { background: 'https://x/b.webp', backgroundFocus: { x: 20, y: 80 } } });
    assert.equal(built.plate, 'dark');
    const resolved = resolveClientTheme({ name: 'X', theme: built, themeVersion: 3 });
    assert.equal(resolved.plate, 'dark');
    assert.deepEqual(resolved.assets.backgroundFocus, { x: 20, y: 80 });
    assert.equal(resolved.tokens['--accent-ring'], '#FFD100', 'a yellow ring shows on the dark plate (it is lost on the white one)');
    assert.equal(resolveClientTheme({ name: 'X', theme: { ...built, plate: 'light', tokens: undefined }, themeVersion: 3 }).tokens['--accent-ring'], 'rgb(255 255 255 / 0)');
    const revised = reviseClientTheme(built, { version: 4, copy: { eventTitle: 'New' } });
    assert.equal(revised.plate, 'dark');
    assert.deepEqual(revised.assets.backgroundFocus, { x: 20, y: 80 });
    assert.equal(revised.assets.background, 'https://x/b.webp');
    // Tokens stored for another version are not trusted: they are derived again, plate included.
    const stale = resolveClientTheme({ name: 'X', theme: { ...built, tokens: { ...built.tokens, '--bg-mid': '#FF0000' } }, themeVersion: 9 });
    assert.equal(stale.tokens['--bg-mid'], '#0B648F');
    assert.equal(stale.plate, 'dark');
    assert.equal(resolveClientTheme({ name: 'No theme' }).plate, 'light');
  });

  it('prints a note about open pages that the participant code bears out', async () => {
    assert.match(OPEN_PAGES_NOTE, /already open keep the old look until they are reloaded/);
    assert.match(OPEN_PAGES_NOTE, /Nothing is pushed/);
    const experience = await readFile(path.join(ROOT, 'migration', 'src', 'lib', 'experience.svelte.ts'), 'utf8');
    const app = await readFile(path.join(ROOT, 'migration', 'src', 'App.svelte'), 'utf8');
    // What tells an open page that something else is live: these three AppSettings fields, nothing about a theme.
    const key = /const keyOf = .*JSON\.stringify\(\[(.*)\]\)/.exec(experience)?.[1] ?? '';
    assert.deepEqual(key.split(',').map((part) => /settings\?\.(\w+)/.exec(part)?.[1]), ['activeSessionId', 'activeClientId', 'activatedAt']);
    const watch = /async function checkServer\(\)[^{]*\{[\s\S]*?\n  \}\n/.exec(app)?.[0] ?? '';
    assert.ok(watch.includes('isStale(settings)') && watch.includes('settings.activeSessionId !== track.sessionId'));
    assert.doesNotMatch(watch, /themeVersion|resolveClientTheme|getClient\b/, 'the watcher never re-reads a client\'s theme');
    // The theme is applied in one place, which runs when the page loads or when something else is live.
    assert.equal((app.match(/adoptExperience\(/g) ?? []).length, 1, 'adoptExperience is called from showExperience only');
    assert.ok(/showExperience\(boot\.experience/.test(app) && /showExperience\(live\)/.test(app));
  });

  it('the dark plate in the stylesheet is the one the theme uses for its ring', async () => {
    const css = await readFile(path.join(ROOT, 'migration', 'src', 'styles', 'tokens.css'), 'utf8');
    assert.equal(/--plate-dark:\s*(#[0-9a-f]{6})/i.exec(css)?.[1].toUpperCase(), PLATE_COLOURS.dark);
    assert.equal(/--plate:\s*(#[0-9a-f]{6})/i.exec(css)?.[1].toUpperCase(), PLATE_COLOURS.light);
  });

  it('offers the presets, starting with the standard blue', () => {
    assert.equal(PRESETS[0].hex, DEFAULT_PRIMARY);
    assert.ok(PRESETS.length >= 6 && PRESETS.length <= 10);
    for (const preset of PRESETS) assert.ok(deriveTheme(preset.hex).adjustments.length === 0, `${preset.name} needs no adjusting`);
  });
});
