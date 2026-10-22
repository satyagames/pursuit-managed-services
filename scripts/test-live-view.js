// Phase 17: what the Live display works out for itself before it draws (lib/admin/live-view.js): which question full screen shows and where
// Previous and Next take it, the type size a window asks for, which keys move it, the heading over the question, the notice of answers that could
// not be read, and the words of a session in the picker. These were written inside LiveDisplay.svelte until Phase 17 moved them out unchanged;
// each case here is what that screen showed.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  liveBrand, pagerStep, presentScaleFor, sectionTitleOf, sessionLabel, shownIndex, stepFrom, unreadableText,
} from '../migration/src/lib/admin/live-view.js';
import { unreadableNotice, wallUnreadableNotice } from '../migration/src/lib/results/unreadable.js';
import { masterColours } from '../migration/src/lib/brand/legacy-colours.js';

/** The product's name, as lib/common/app-name.ts spells it (the display hands it in). */
const APP_NAME = 'Pursuit Managed Services';

describe('the Live display, worked out before it draws (Phase 17)', () => {
  const questions = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }];

  it('the question on screen: the one with the shown id, else the shown place kept inside the list', () => {
    assert.equal(shownIndex(questions, 'q2', 0), 1);
    assert.equal(shownIndex(questions, 'gone', 1), 1, 'a question that has gone: its place');
    assert.equal(shownIndex(questions, 'gone', 7), 2, 'past the end: the last');
    assert.equal(shownIndex(questions, '', 0), 0);
    assert.equal(shownIndex([], '', 3), 0, 'no questions: 0');
  });

  it('Previous and Next: one step, and round again at either end', () => {
    assert.equal(stepFrom(0, 1, 3), 1);
    assert.equal(stepFrom(2, 1, 3), 0);
    assert.equal(stepFrom(0, -1, 3), 2);
    assert.equal(stepFrom(1, -1, 3), 0);
    assert.equal(stepFrom(0, 1, 1), 0);
  });

  it('the type for a projector: the window width over 1000, between 1.2 and 2.4, to the nearest 0.05', () => {
    assert.equal(presentScaleFor(800), 1.2);
    assert.equal(presentScaleFor(1366), 1.35);
    assert.equal(presentScaleFor(1536), 1.55);
    assert.equal(presentScaleFor(1920), 1.9);
    assert.equal(presentScaleFor(3840), 2.4);
  });

  it('the keys that move full screen: the left and right arrows with no modifier, nothing else', () => {
    const key = (name, extra = {}) => ({ key: name, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...extra });
    assert.equal(pagerStep(key('ArrowRight')), 1);
    assert.equal(pagerStep(key('ArrowLeft')), -1);
    assert.equal(pagerStep(key('ArrowUp')), null);
    assert.equal(pagerStep(key('Enter')), null);
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) assert.equal(pagerStep(key('ArrowRight', { [modifier]: true })), null, modifier);
  });

  it('the heading over the question: the title of its activity, or nothing', () => {
    const sections = [{ title: 'Warm up', questions: [{ id: 'q1' }] }, { title: 'Quiz', questions: [{ id: 'q2' }, { id: 'q3' }] }];
    assert.equal(sectionTitleOf(sections, 'q3'), 'Quiz');
    assert.equal(sectionTitleOf(sections, 'q1'), 'Warm up');
    assert.equal(sectionTitleOf(sections, 'missing'), '');
    assert.equal(sectionTitleOf(sections, undefined), '');
  });

  it('answers that could not be read: by name on the admin view, how many on the wall, nothing when all were read', () => {
    const results = {
      unreadable: [{ id: 't-1', reason: 'its saved answers are not valid JSON' }, { id: 't-2', reason: 'its saved answers are not valid JSON' }],
      tracks: [{ id: 't-1', participantName: 'Søren Kjær' }, { id: 't-2' }],
    };
    assert.equal(unreadableText(results, false), unreadableNotice(results.unreadable, new Map([['t-1', 'Søren Kjær']])));
    assert.match(unreadableText(results, false), /Søren Kjær/);
    assert.equal(unreadableText(results, true), wallUnreadableNotice(2));
    assert.doesNotMatch(unreadableText(results, true), /Søren/, 'no name on the wall');
    assert.equal(unreadableText({ unreadable: [], tracks: [] }, false), '');
    assert.equal(unreadableText({ tracks: [] }, true), '');
    assert.equal(unreadableText(null, false), '');
  });

  it("the client's look on the display: its name (else the product's), its logo unless retired, its colours (stored theme first), defaults", () => {
    assert.deepEqual(liveBrand(null, APP_NAME), { name: APP_NAME, logoUrl: null, primary: '#0f172a', secondary: '#64748b' });
    assert.deepEqual(liveBrand({ name: '  ', logoUrl: '   ' }, APP_NAME), { name: APP_NAME, logoUrl: null, primary: '#0f172a', secondary: '#64748b' });
    const client = { name: ' Kroger ', logoUrl: ' assets/kroger.png ', primaryColor: '#123456', secondaryColor: '#abcdef' };
    const look = liveBrand(client, APP_NAME);
    assert.equal(look.name, 'Kroger');
    assert.equal(look.logoUrl, 'assets/kroger.png');
    const colours = masterColours(client);
    assert.equal(look.primary, colours.primaryColor ?? '#0f172a');
    assert.equal(look.secondary, colours.secondaryColor ?? '#64748b');
    const themed = { name: 'Harbour', theme: { colors: { primary: '#0a7d32' } } };
    assert.equal(liveBrand(themed, APP_NAME).primary, masterColours(themed).primaryColor ?? '#0f172a');
    assert.equal(liveBrand({ name: 'X', logoUrl: 'assets/images/clients/kroger-logo.svg' }, APP_NAME).logoUrl, null, 'a retired logo is dropped, as everywhere else');
  });

  it("a session in the picker: its client's name (else the id), its date and its status", () => {
    const clients = [{ id: 'c-kroger', name: 'Kroger' }];
    assert.equal(sessionLabel({ id: 's1', clientId: 'c-kroger', date: '2026-10-22', status: 'in-progress' }, clients), 'Kroger · 2026-10-22 · in-progress');
    assert.equal(sessionLabel({ id: 's2', clientId: 'c-gone' }, clients), 'c-gone ·  · ');
  });
});
