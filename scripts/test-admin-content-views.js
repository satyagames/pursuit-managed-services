// Phase 18: the Content tab's views (lib/admin/admin-content-views.js). Content is one client's workspace with two views, Activities and Brand,
// listed in one table that the strip, its keyboard, the address and the badges read. These cases hold the table complete, the address
// round trip (#content, #content/brand, the old #sections), what an unknown address falls back to, the badges' words, the keyboard's steps and
// the remembered view (in memory for the visit, as the last client is: the admin page writes nothing to browser storage).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_VIEWS, DEFAULT_VIEW, hashOfView, lastView, lookWord, rememberView, stepView, viewBadge, viewById, viewOfHash,
} from '../migration/src/lib/admin/admin-content-views.js';


describe('Content views (Phase 18)', () => {
  it('the table is complete: every view has an id, a label, an address segment and a component key, and exactly one is the default', () => {
    assert.ok(CONTENT_VIEWS.length >= 2);
    for (const view of CONTENT_VIEWS) {
      for (const key of ['id', 'label', 'component', 'heading']) assert.equal(typeof view[key], 'string', `${view.id}: ${key}`);
      assert.ok(view.id && view.label && view.component && view.heading, `${view.id}: nothing empty`);
      assert.equal(typeof view.segment, 'string', `${view.id}: segment`);
      assert.equal(typeof view.badge, 'function', `${view.id}: badge`);
      assert.equal(typeof view.isDefault, 'boolean', `${view.id}: isDefault`);
    }
    assert.equal(CONTENT_VIEWS.filter((view) => view.isDefault).length, 1, 'one default');
    assert.equal(new Set(CONTENT_VIEWS.map((view) => view.id)).size, CONTENT_VIEWS.length, 'ids are unique');
    assert.equal(new Set(CONTENT_VIEWS.map((view) => view.segment)).size, CONTENT_VIEWS.length, 'segments are unique');
    assert.deepEqual(CONTENT_VIEWS.map((view) => view.id), ['activities', 'brand'], 'Activities, then Brand');
    assert.equal(DEFAULT_VIEW, 'activities');
    assert.ok(Object.isFrozen(CONTENT_VIEWS));
  });

  it('the address of every view round-trips; the default is plain #content', () => {
    for (const view of CONTENT_VIEWS) assert.equal(viewOfHash(hashOfView(view.id)), view.id, view.id);
    assert.equal(hashOfView('activities'), '#content');
    assert.equal(hashOfView('brand'), '#content/brand');
    assert.equal(hashOfView('nonsense'), '#content', 'an unknown view is the default');
  });

  it('#content and the old #sections give the default; an unknown segment gives the default', () => {
    assert.equal(viewOfHash('#content'), 'activities');
    assert.equal(viewOfHash('#sections'), 'activities');
    assert.equal(viewOfHash('#content/'), 'activities');
    assert.equal(viewOfHash('#content/colours'), 'activities');
    assert.equal(viewOfHash('#content/brand/extra'), 'activities');
  });

  it('claims no other address', () => {
    for (const hash of ['', '#', '#today', '#clients', '#guests', '#results', '#print-guests', '#live-display', '#live-display/x/wall', '#contents', '#content-brand', '#brand']) {
      assert.equal(viewOfHash(hash), null, hash);
    }
  });

  it('a view by id, and the default for anything else', () => {
    assert.equal(viewById('brand').label, 'Brand');
    assert.equal(viewById('nope').id, 'activities');
    assert.equal(viewById(null).id, 'activities');
  });

  it("the Activities badge counts the client's activities and the live ones, from what is in memory", () => {
    const sections = [
      { id: 'a', clientId: 'c1', enabled: true }, { id: 'b', clientId: 'c1', enabled: false }, { id: 'c', clientId: 'c1', enabled: true },
      { id: 'd', clientId: 'c2', enabled: true }, { id: 'e', clientId: null, enabled: true },
    ];
    assert.deepEqual(viewBadge('activities', { sections, clientId: 'c1' }), { text: '3 · 2 live', flag: null });
    assert.deepEqual(viewBadge('activities', { sections, clientId: 'c3' }), { text: '0 · 0 live', flag: null });
    assert.deepEqual(viewBadge('activities', {}), { text: '0 · 0 live', flag: null });
  });

  it('the Brand badge says the look in words, and "Unsaved changes" while Brand holds unsaved work', () => {
    const custom = { id: 'c1', name: 'Kroger', theme: { version: 1, primary: '#0F6E3A' } };
    const standard = { id: 'c2', name: 'Plain' };
    assert.deepEqual(viewBadge('brand', { client: standard, brandDirty: false }), { text: 'Standard look', flag: null });
    assert.deepEqual(viewBadge('brand', { client: custom, brandDirty: false }), { text: 'Custom look', flag: null });
    assert.deepEqual(viewBadge('brand', { client: custom, brandDirty: true }), { text: 'Custom look', flag: 'Unsaved changes' });
    assert.deepEqual(viewBadge('brand', { client: null }), { text: 'Standard look', flag: null });
    assert.equal(lookWord(standard), 'Standard', 'the line on Activities that leads to Brand');
    assert.equal(lookWord(custom), 'Custom');
  });

  it('the strip keyboard: Left and Right wrap, Home and End go to the ends, any other key is not the strip\'s', () => {
    const last = CONTENT_VIEWS.length - 1;
    assert.equal(stepView('ArrowRight', 0), 1);
    assert.equal(stepView('ArrowRight', last), 0);
    assert.equal(stepView('ArrowLeft', 0), last);
    assert.equal(stepView('Home', last), 0);
    assert.equal(stepView('End', 0), last);
    assert.equal(stepView('Enter', 0), null);
    assert.equal(stepView('ArrowDown', 0), null);
  });

  it('the last view is remembered for the visit, in memory: no browser storage is touched; a view not in the table is the default', () => {
    const touched = [];
    const spy = { getItem: (key) => { touched.push(key); return null; }, setItem: (key) => { touched.push(key); } };
    globalThis.sessionStorage = spy;
    globalThis.localStorage = spy;
    try {
      assert.equal(lastView(), 'activities', 'nothing remembered yet');
      rememberView('brand');
      assert.equal(lastView(), 'brand');
      rememberView('activities');
      assert.equal(lastView(), 'activities');
      rememberView('gone');
      assert.equal(lastView(), 'activities', 'a view that is no longer in the table is the default');
      assert.deepEqual(touched, [], 'no browser storage');
    } finally {
      delete globalThis.sessionStorage;
      delete globalThis.localStorage;
    }
  });
});
