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
  // (The washes are fixed colours, not a mix: WebKit's checker could not read a color-mix() ground.)
  ['--aop-well-ink', '--aop-wash', 4.5, 'words on a row band and the view switch'],
  ['--aop-well-ink', '--aop-done-wash', 4.5, 'words on a finished row'],
  ['--aop-well-ink', '--aop-rule', 4.5, 'words on the track of the bar'],
  // (Prompt 42) The caption under the legend, in the muted grey; the level menu's words, and its chosen row on the wash, are the words above.
  ['--aop-empty-edge', '--aop-well', 4.5, 'the caption under the legend'],
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

  it('the level menu and the legend take the boxes\' own colours, edges, shapes and letters (Prompt 42)', async () => {
    const grid = await readFile(path.join(ROOT, 'migration', 'src', 'pager', 'MatrixRating.svelte'), 'utf8');
    for (const [level, name] of [[1, 'low'], [2, 'medium'], [3, 'high']]) {
      const rule = grid.match(new RegExp(String.raw`\[data-level='${level}'\]:is\(([^)]*)\) \{([^}]*)\}`));
      assert.ok(rule, `the level ${level} rule`);
      assert.deepEqual(rule[1].split(',').map((each) => each.trim()).sort(), ['.matrix-cell', '.matrix-chip', '.matrix-segment', '.matrix-swatch'], 'a box, a menu or summary chip, a segment and a legend swatch: one rule');
      assert.match(rule[2], new RegExp(String.raw`color: var\(--aop-on-${name}\);\s*background: var\(--aop-${name}\);\s*border: 2px solid var\(--aop-${name}-edge\);`));
    }
    assert.ok(grid.includes('<span class="matrix-chip" data-level={choice} aria-hidden="true">{@render mark(choice, 12)}<span class="matrix-chip-letter">'), 'each menu row has the shape and the letter');
    assert.match(grid, /\.matrix-chip-letter \{\s*font-size: var\(--aop-letter-size\);\s*font-weight: var\(--aop-letter-weight\);/, 'the menu letter is the box letter (19 px bold)');
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

// Prompt 36: the finale's fixed colours, read from routes/ThankYou.svelte's own styles: the medal's ink on its lime, and the cards' figures and words
// on their white (the figures are large; the words are body text, held to 4.5:1).
describe('the finale\'s medal and cards (Prompt 36)', () => {
  it('the medal\'s ink on the lime and the cards\' text on white are readable', async () => {
    const svelte = await readFile(path.join(ROOT, 'migration', 'src', 'routes', 'ThankYou.svelte'), 'utf8');
    const rule = (selector) => {
      const body = svelte.split(`\n  ${selector} {`)[1]?.split('}')[0] ?? '';
      const colour = (property) => new RegExp(`\\n\\s*${property}:\\s*(#[0-9a-f]{6})`, 'i').exec(body)?.[1];
      return { color: colour('color'), background: colour('background') };
    };
    const medal = rule('.pms-medal');
    const card = rule('.pms-card');
    assert.ok(medal.color && medal.background && card.color && card.background, 'the colours are found');
    const medalRatio = contrastRatio(medal.color, medal.background);
    const cardRatio = contrastRatio(card.color, card.background);
    console.log(`  medal ink ${medal.color} on ${medal.background}: ${medalRatio.toFixed(2)}:1; card text ${card.color} on ${card.background}: ${cardRatio.toFixed(2)}:1`);
    assert.ok(medalRatio >= 4.5, `the medal's check ${medalRatio.toFixed(2)}:1`);
    assert.ok(cardRatio >= 4.5, `the cards' words ${cardRatio.toFixed(2)}:1`);
  });
});
