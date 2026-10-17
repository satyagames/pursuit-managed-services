// Phase 12, Part 2: the plain rules behind the fixes VJR approved from UX-REVIEW.md (one `describe` each, named by its finding). Each was run
// red on the code before its fix. The browser side of each is its spec, named in the test.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { unlockFailureText } from '../migration/src/lib/admin-unlock.js';

const unreachable = (error) => error?.name === 'TypeError';

describe('F-02: the PIN screen says why it cannot unlock', () => {
  const refused = Object.assign(new Error('SharePoint (403): Access denied. You do not have permission to perform this action or access this resource.'), { status: 403 });

  it('a 403 is the account, not the connection: it says so, names the list, and says whom to ask', () => {
    const words = unlockFailureText(refused, { isUnreachable: unreachable, adminsList: 'PMSAdminUsers' });
    assert.doesNotMatch(words, /reach the server|connection/i);
    assert.match(words, /^This account may not open the admin page\./);
    assert.match(words, /PMSAdminUsers/);
    assert.match(words, /Ask a site owner/);
  });

  it('names the support contact of pms-config.txt when there is one', () => {
    const words = unlockFailureText(refused, { isUnreachable: unreachable, adminsList: 'PMSAdminUsers', support: { name: 'Satya', contact: 'satya@example.com' } });
    assert.match(words, /Satya \(satya@example\.com\)/);
  });

  it('a lost connection, an expired sign-in and anything else keep their own words', () => {
    assert.match(unlockFailureText(new TypeError('Failed to fetch'), { isUnreachable: unreachable, adminsList: 'PMSAdminUsers' }), /^Couldn't reach the server\. Check the connection/);
    assert.match(unlockFailureText(Object.assign(new Error('x'), { status: 401 }), { isUnreachable: unreachable, adminsList: 'PMSAdminUsers' }), /sign-in has expired/);
    assert.match(unlockFailureText(Object.assign(new Error('SharePoint (500): boom'), { status: 500 }), { isUnreachable: unreachable, adminsList: 'PMSAdminUsers' }), /could not check the PIN: SharePoint \(500\): boom/);
  });
});

describe('F-04: the wall says no more than a count when answers could not be read', () => {
  it('no instruction for the admin and no list title on the projector; the admin view keeps both', async () => {
    const { wallUnreadableNotice, unreadableNotice, UNREADABLE_FIX } = await import('../migration/src/lib/unreadable.js');
    assert.equal(wallUnreadableNotice(1), "1 participant's answers could not be counted.");
    assert.equal(wallUnreadableNotice(3), "3 participants' answers could not be counted.");
    for (const count of [1, 3]) {
      assert.doesNotMatch(wallUnreadableNotice(count), /PMS|list|delete|reload/i);
    }
    assert.ok(unreadableNotice([{ id: 'v-1' }]).endsWith(UNREADABLE_FIX), 'the admin view still says what to do');
  });
});

describe('F-05: a tile picture sits on the logo plate, whatever is behind the tile', () => {
  it('LogoTile draws the picture on var(--plate), with room around it', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../migration/src/components/LogoTile.svelte', import.meta.url), 'utf8');
    const rule = /\.logo\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';
    assert.match(rule, /background:\s*var\(--plate\)/, 'the picture has the plate behind it');
    assert.match(rule, /padding:/, 'and room around it on the plate');
    assert.match(rule, /border-radius:/);
  });
});

describe('F-08: a Results card shows its Live results before the list of people', () => {
  it('the tally comes before the rows in each session card', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../migration/src/admin/AdminResults.svelte', import.meta.url), 'utf8');
    const card = source.slice(source.indexOf('<article class="card"'), source.indexOf('</article>'));
    assert.ok(card.indexOf('<details class="tally"') > 0, 'the card has its Live results');
    assert.ok(card.indexOf('<details class="tally"') < card.indexOf('<ul class="rows'), 'Live results come before the people');
  });
});

describe('Fonts: Open Sans stays embedded, and a measured fallback takes its room until it is decoded', () => {
  it('every page loads the fallback sheet; the stack is Open Sans, then the fallback; the six embedded faces are unchanged', async () => {
    const { readFileSync } = await import('node:fs');
    const read = (file) => readFileSync(new URL(`../migration/src/${file}`, import.meta.url), 'utf8');
    for (const entry of ['main.ts', 'admin-main.ts', 'setup-main.ts']) assert.match(read(entry), /import '\.\/styles\/fonts-fallback\.css';/, entry);
    assert.match(read('styles/tokens.css'), /--font-sans:\s*'Open Sans',\s*'Open Sans Fallback',[^;]*sans-serif;/);
    assert.equal((read('styles/fonts.css').match(/@font-face/g) ?? []).length, 6, 'Open Sans is still embedded, six faces');
  });

  it('the fallback face is Arial with the overrides measured from the TrueType files (scripts/local-site/font-metrics.js)', async () => {
    const { existsSync, readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../migration/src/styles/fonts-fallback.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    assert.ok(faces.length >= 2, 'a regular and a bold face');
    for (const face of faces) {
      assert.match(face, /font-family:\s*'Open Sans Fallback'/);
      assert.match(face, /src:\s*local\('Arial/);
      assert.doesNotMatch(face, /url\(/, 'nothing is downloaded for it');
    }
    const arial = ['C:/Windows/Fonts/arial.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf'].find((file) => existsSync(file));
    const expected = { size: '104.46%', ascent: '102.32%', descent: '28.05%', gap: '0.00%' };
    if (arial) {
      const { fallbackFace, readFont } = await import('./local-site/font-metrics.js');
      const measured = fallbackFace(readFont(new URL('../public/assets/Font/open-sans/OpenSans-Regular.ttf', import.meta.url)), readFont(arial));
      assert.deepEqual({ size: measured.sizeAdjust, ascent: measured.ascentOverride, descent: measured.descentOverride, gap: measured.lineGapOverride }, expected, 'the recorded figures are still what the files give');
    }
    for (const face of faces) {
      for (const [property, value] of [['size-adjust', expected.size], ['ascent-override', expected.ascent], ['descent-override', expected.descent]]) assert.ok(face.includes(`${property}: ${value};`), `${property}: ${value}`);
      assert.match(face, /line-gap-override:\s*0%/);
    }
  });
});

describe('F-10: the participant page says "Loading..." while it starts, not "Restoring your session..."', () => {
  it('a first visit has nothing to restore', async () => {
    const { readFileSync } = await import('node:fs');
    const app = readFileSync(new URL('../migration/src/App.svelte', import.meta.url), 'utf8');
    assert.match(app, /<p class="loading" role="status">Loading\.\.\.<\/p>/);
    assert.doesNotMatch(app, /Restoring your session/);
  });
});

describe('F-11: a chosen answer (a rank, a poll, multi-select) does not look like one that is not', () => {
  it('OptionPill: a 2px ring in the words colour, and the number or letter in a badge', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../migration/src/components/OptionPill.svelte', import.meta.url), 'utf8');
    const selected = /\.pill\[data-state='selected'\]\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';
    assert.match(selected, /box-shadow:\s*inset 0 0 0 2px var\(--text\)/);
    const badge = /\.pill\[data-state='selected'\] \.letter\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';
    assert.match(badge, /background:\s*var\(--text\)/);
    assert.match(badge, /color:\s*var\(--action\)/, 'the number in the button colour on white (4.9:1)');
  });
});

describe('F-14: "Correct" and "Top choice" beside a bar sit on the text\'s baseline, apart', () => {
  it('BarChart: the tags align to the baseline and a second tag is set apart', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../migration/src/admin/charts/BarChart.svelte', import.meta.url), 'utf8');
    const tag = /\.bars__tag\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';
    assert.match(tag, /align-items:\s*baseline/);
    assert.match(source, /\.bars__tag \+ \.bars__tag::before\s*\{[^}]*content:\s*'·'/);
  });
});

describe('F-13: the phone\'s sticky Next/Submit bar lets a background picture show through', () => {
  it('ActionBar: a translucent, blurred band, not 96% of the page colour', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../migration/src/components/ActionBar.svelte', import.meta.url), 'utf8');
    const sticky = /\.pms-actions\[data-sticky='true'\]\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';
    assert.doesNotMatch(sticky, /96%/);
    assert.match(sticky, /-webkit-backdrop-filter:\s*blur\(/, 'Safari needs the prefix');
    assert.match(sticky, /backdrop-filter:\s*blur\(/);
  });
});

describe('F-17: a switched-off Next or Submit can still be seen over a background picture', () => {
  it('PillButton: a 2px edge (its border and an inset line) at 70% of its words colour', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../migration/src/components/PillButton.svelte', import.meta.url), 'utf8');
    const disabled = /\.pill-button:disabled\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';
    assert.match(disabled, /border-color:\s*color-mix\(in srgb, var\(--on-disabled\) 70%, transparent\)/);
    assert.match(disabled, /box-shadow:\s*inset 0 0 0 1px color-mix\(in srgb, var\(--on-disabled\) 70%, transparent\)/, 'a 2px edge, without changing the size');
  });
});
