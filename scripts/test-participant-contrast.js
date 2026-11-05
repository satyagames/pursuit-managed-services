// Prompt 35: the Art of Possibility's three rating colours. Run: node --test scripts/test-participant-contrast.js (also part of npm test)
//
// Reads migration/src/styles/aop-level-tokens.css itself (not a copy of its values) and holds each pair to the contrast it is stated to have (WCAG 2.2:
// 4.5:1 for words, 3:1 for large bold words, 3:1 for a mark that carries meaning). The three fills are fixed colours, the one exception to the plate
// tokens (granted by the site owner for this question only); Medium and High are too light to stand on the white well alone, so every rated box also
// has an edge of its own darker colour, and it is the edge that is held to 3:1. Every box also carries a shape and a letter
// (lib/participant/aop-levels.js), so Low and High never differ by colour alone: the check below simulates the two commonest colour blindnesses and
// prints how close the fills come, for the report. It prints every measured ratio.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PLATE_COLOURS, contrastRatio } from '../migration/src/lib/brand/theme.js';
import { LEVEL_LOOK } from '../migration/src/lib/participant/aop-levels.js';

const ROOT = path.join(import.meta.dirname, '..');
const CSS = await readFile(path.join(ROOT, 'migration', 'src', 'styles', 'aop-level-tokens.css'), 'utf8');
const TOKENS = Object.fromEntries([...CSS.matchAll(/(--aop-[a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((match) => [match[1], match[2].toUpperCase()]));
const token = (name) => {
  assert.ok(TOKENS[name], `${name} is in aop-level-tokens.css`);
  return TOKENS[name];
};

// [foreground, background, at least, what it is].
const PAIRS = [
  ['--aop-on-low', '--aop-low', 3, 'Low letter (19 px bold: large text)'],
  ['--aop-on-medium', '--aop-medium', 4.5, 'Medium letter'],
  ['--aop-on-high', '--aop-high', 4.5, 'High letter'],
  ['--aop-low-edge', '--aop-well', 3, 'Low box edge on the well'],
  ['--aop-medium-edge', '--aop-well', 3, 'Medium box edge on the well'],
  ['--aop-high-edge', '--aop-well', 3, 'High box edge on the well'],
  ['--aop-empty-edge', '--aop-well', 3, 'empty box edge and its + on the well'],
  ['--aop-well-ink', '--aop-well', 4.5, 'words on the well'],
];

describe('the three rating colours (Prompt 35)', () => {
  it('are the fills the site owner granted', () => {
    assert.equal(token('--aop-low'), '#E63A2E');
    assert.equal(token('--aop-medium'), '#F5A623');
    assert.equal(token('--aop-high'), '#3DBB5E');
    assert.equal(token('--aop-well'), '#FFFFFF');
  });

  it('every pair has the contrast it needs', () => {
    const broken = [];
    for (const [fore, back, floor, what] of PAIRS) {
      const ratio = contrastRatio(token(fore), token(back));
      console.log(`  ${what}: ${token(fore)} on ${token(back)} = ${ratio.toFixed(2)}:1 (at least ${floor})`);
      if (ratio < floor) broken.push(`${what}: ${ratio.toFixed(2)}:1, under ${floor}:1`);
    }
    assert.deepEqual(broken, []);
  });

  it('the well stands out on a dark plate, and its edges carry it on a light one', () => {
    const dark = contrastRatio(token('--aop-well'), PLATE_COLOURS.dark);
    console.log(`  the well on the dark plate: ${dark.toFixed(2)}:1`);
    assert.ok(dark >= 3);
    // On the light plate the well is the plate's own white: what must show is every box's edge, held above.
    assert.equal(PLATE_COLOURS.light, token('--aop-well'));
  });

  it('a Low letter is large text: 19 px and bold (WCAG large text is 18.66 px bold or 24 px)', () => {
    assert.match(CSS, /--aop-letter-size:\s*19px;/);
    assert.match(CSS, /--aop-letter-weight:\s*700;/);
  });

  it('every level has its own word, letter and shape, so colour is never alone', () => {
    const looks = [1, 2, 3].map((level) => LEVEL_LOOK[level]);
    assert.deepEqual(looks.map((look) => look.name), ['Low', 'Medium', 'High']);
    assert.deepEqual(looks.map((look) => look.letter), ['L', 'M', 'H']);
    assert.equal(new Set(looks.map((look) => look.shape)).size, 3, 'three shapes');
    for (const look of looks) assert.match(look.path, /^M[\d\s.,MLHVZCQ-]+$/i, `${look.name} has an SVG path`);
    assert.ok(looks.every((look) => look.path.length < 120), 'the shapes are tiny');
  });

  it('under protanopia and deuteranopia Low and High come close in colour, which is why the shape and letter are there (printed)', () => {
    // Machado, Oliveira and Fernandes (2009), severity 1.0, applied in linear RGB.
    const MATRICES = {
      protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
      deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
    };
    const linear = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    const back = (rgb) => `#${rgb.map((v) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    const simulate = (hex, m) => back(m.map((row) => Math.min(1, Math.max(0, row.reduce((sum, k, at) => sum + k * linear(hex)[at], 0)))));
    for (const [kind, m] of Object.entries(MATRICES)) {
      const low = simulate(token('--aop-low'), m);
      const high = simulate(token('--aop-high'), m);
      console.log(`  ${kind}: Low looks ${low}, High looks ${high}, ${contrastRatio(low, high).toFixed(2)}:1 apart`);
      assert.match(low, /^#[0-9A-F]{6}$/);
    }
  });
});
