// Phase 17: what Brand Studio works out for itself before it draws (lib/admin/brand-studio-view.js): the look its preview is given, the page
// gradient of its colour strip, whether a typed colour is wrong, the word for each pairing of the contrast table, what each picture slot says,
// the address that previews the saved look on a device, and what a save says. These were written inside BrandStudio.svelte until Phase 17
// moved them out unchanged; each case here is what that screen showed. The rules of a look (lib/brand/brand-studio.js) are tested in
// test-brand.js.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  colourInvalid, contrastResult, displayUrl, lookOf, pageGradient, previewAddress, savedMessage, slotStatus,
} from '../migration/src/lib/admin/brand-studio-view.js';

describe('Brand Studio, worked out before it draws (Phase 17)', () => {
  it("the preview's look: the scene, the client's name and words, the draft's pictures, plate and focus, the Animations switch", () => {
    const words = { eventTitle: 'Innovation Day', eventSubtitle: 'Hosted by Deloitte', welcomeLine: 'Welcome', logoText: 'KR' };
    const draft = { plate: 'dark', focus: { x: 20, y: 80 }, assets: { hero: 'hero.webp', logo: null, background: 'back.webp' } };
    assert.deepEqual(lookOf({ scene: 'quiz', clientName: 'Kroger', words, draft, motion: false }), {
      scene: 'quiz', clientName: 'Kroger', eventTitle: 'Innovation Day', eventSubtitle: 'Hosted by Deloitte', welcomeLine: 'Welcome', logoText: 'KR',
      heroUrl: 'hero.webp', logoUrl: null, plate: 'dark', backgroundUrl: 'back.webp', backgroundFocus: { x: 20, y: 80 }, motion: false,
    });
    assert.deepEqual(lookOf({ scene: 'welcome', clientName: 'K', words, draft: { ...draft, focus: null }, motion: true }).backgroundFocus, { x: 50, y: 50 }, 'a background with no focus is centred');
    assert.equal(lookOf({ scene: 'welcome', clientName: 'K', words, draft: { ...draft, assets: { ...draft.assets, background: null } }, motion: true }).backgroundFocus, null, 'no background, no focus');
  });

  it("a picture's address as the page shows it: the page's own copy when it carries one, else the address; none stays none", () => {
    assert.equal(displayUrl(null), null);
    assert.equal(displayUrl(''), null);
    assert.equal(displayUrl('Clients/kroger/logo.png'), 'Clients/kroger/logo.png');
    globalThis.CEC_ASSETS = { 'assets/brand/hero.webp': 'data:image/webp;base64,AAAA' };
    try {
      assert.equal(displayUrl('assets/brand/hero.webp'), 'data:image/webp;base64,AAAA');
    } finally {
      delete globalThis.CEC_ASSETS;
    }
  });

  it('the strip: the page gradient from its three tokens', () => {
    assert.equal(pageGradient({ '--bg-top': '#111111', '--bg-mid': '#222222', '--bg-bottom': '#333333' }),
      'linear-gradient(to bottom, #111111 0%, #222222 58%, #333333 100%)');
  });

  it('a typed colour is wrong only once something is typed that is not a colour (a blank accent is "none")', () => {
    assert.equal(colourInvalid(null), false);
    assert.equal(colourInvalid('#045BCC'), false);
    assert.equal(colourInvalid('045bcc'), false);
    assert.equal(colourInvalid('blue-ish'), true);
    assert.equal(colourInvalid(''), true, 'a blank primary is wrong');
    assert.equal(colourInvalid('', { blankIsNone: true }), false, 'a blank accent is none');
    assert.equal(colourInvalid('   ', { blankIsNone: true }), false);
    assert.equal(colourInvalid('nope', { blankIsNone: true }), true);
  });

  it("the contrast table's result: a mark and a word, never colour alone", () => {
    assert.equal(contrastResult({ id: 'text-on-page', pass: true }), '✓ Pass');
    assert.equal(contrastResult({ id: 'text-on-page', pass: false }), '✕ Fails');
    assert.equal(contrastResult({ id: 'accent-rule', pass: false }), '✕ Not drawn');
    assert.equal(contrastResult({ id: 'accent-rule', pass: true }), '✓ Pass');
  });

  it('what a picture slot says: chosen and not saved, set (saved or not), or not set', () => {
    const prepared = { url: 'blob:1' };
    assert.equal(slotStatus({ pending: prepared, current: 'blob:1', saved: 'old.webp' }), 'Not saved yet');
    assert.equal(slotStatus({ pending: null, current: 'old.webp', saved: 'old.webp' }), 'Saved');
    assert.equal(slotStatus({ pending: null, current: 'copied.webp', saved: null }), 'Not saved yet');
    assert.equal(slotStatus({ pending: null, current: null, saved: 'old.webp' }), 'Not set');
    assert.equal(slotStatus({ pending: null, current: null, saved: null }), 'Not set');
  });

  it("the device preview's address: the participant page with ?preview=<client id>", () => {
    assert.equal(previewAddress('https://contoso.sharepoint.com/sites/PCOE/PMS/index.html', 'c-kroger'), 'https://contoso.sharepoint.com/sites/PCOE/PMS/index.html?preview=c-kroger');
    assert.equal(previewAddress('http://127.0.0.1:5188/index.html?x=1#/', 'c 1'), 'http://127.0.0.1:5188/index.html?x=1&preview=c+1#/');
  });

  it('what a save says: Saved, or how many old pictures are left to delete by hand', () => {
    assert.deepEqual(savedMessage(0), { message: 'Saved', kind: 'success' });
    assert.deepEqual(savedMessage(1), { message: 'Saved. An old picture could not be removed and can be deleted from the library by hand.', kind: 'info' });
    assert.deepEqual(savedMessage(3), { message: 'Saved. 3 old pictures could not be removed and can be deleted from the library by hand.', kind: 'info' });
  });
});
