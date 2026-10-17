// Phase 5b: the admin's Content and Guests screens, below the browser. The rules (grouping, order,
// pasted names, guest status, CSV, the print sheet, what a copy is) are plain functions; copying,
// duplicating, assigning, deleting and the bulk guest work (migration/src/lib/data/dataService.js, section 6) run
// against the mocked SharePoint REST (scripts/sharepoint-fake.js), which counts every request and can
// be told to fail one, and against the real local server on a scratch copy of server/data, and the two
// must leave the same records. Run: npm run test:content (also part of npm test).
//
// Like the storage suite this proves the adapter sends the requests it should, in the numbers it
// should, with the pacing it should. It is not the real tenant (QA-TESTING.md section 9).
import assert from 'node:assert/strict';
import { freePort } from './free-port.js';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import * as ds from '../migration/src/lib/data/dataService.js';
import {
  activitiesOfClient, CARDS_PER_PAGE, MAX_GUEST_NAME, completedTrackIds, copyOutcome, copyTotalsText, csvCell, csvFileName, defaultClientId, guestKey, guestRows,
  guestsCsv, imageUrlProblem, lastClientId, layoutApplies, nextOrder, orderedContent, paginate, parseGuestNames, pasteSummary,
  picturesStillShown, printCards, reorderActivities, rememberClient, statusCounts, titleProblem,
} from '../migration/src/lib/admin/admin-content.js';
import { samplePack } from '../migration/src/lib/setup/sample-clients.js';
import { seedPack } from '../migration/src/lib/setup/seed.js';
import { STRAYS, TITLE, UNINDEXED, createSharePointFake } from './sharepoint-fake.js';

const ROOT = path.join(import.meta.dirname, '..');
const realFetch = globalThis.fetch;
const DAY = '2026-10-11';
const measured = [];
const shape = (entry) => `${entry.method} ${entry.list ?? entry.path.split('/_api')[1]}${entry.parts ? ` [${entry.parts.map((part) => part.list ?? part.path.split('/_api')[1]).join(', ')}]` : ''}`;
const writesOf = (fake, list) => fake.requests.filter((entry) => entry.method === 'POST' && entry.list === list && !entry.path.endsWith('/$batch'));

/** A page of its own: the data service as a separate module, so no write token or list metadata is shared between "admins". */
let pages = 0;
async function freshPage(settings) {
  const page = await import(`../migration/src/lib/data/dataService.js?content-page=${pages += 1}`);
  page.configure(settings);
  return page;
}

async function site(options = {}) {
  const fake = createSharePointFake(options);
  fake.install();
  ds.configure({ sharePoint: fake.settings });
  await seedPack(ds, samplePack());
  return fake;
}

const acme = (extra = {}) => ({ id: 'c-acme', name: 'Acme', slug: 'acme', status: 'active', logoUrl: '', primaryColor: '#045bcc', secondaryColor: '#64748b', createdAt: '2026-10-11T00:00:00.000Z', themeVersion: 1, ...extra });

// ---- The rules --------------------------------------------------------------------------------------

describe('which client, which activities, in what order', () => {
  const clients = [{ id: 'c-z', name: 'Zed', status: 'active' }, { id: 'c-b', name: 'Beta', status: 'archived' }, { id: 'c-a', name: 'Alpha', status: 'active' }];

  it('opens on the client picked earlier this visit, else the live one, else the first active one by name', () => {
    assert.equal(defaultClientId({ clients, liveClientId: 'c-z', last: 'c-a' }), 'c-a');
    assert.equal(defaultClientId({ clients, liveClientId: 'c-z', last: null }), 'c-z');
    assert.equal(defaultClientId({ clients, liveClientId: null, last: 'c-z' }), 'c-z');
    assert.equal(defaultClientId({ clients, liveClientId: 'c-gone', last: 'c-gone' }), 'c-a', 'a client that no longer exists is not a starting point');
    assert.equal(defaultClientId({ clients: [clients[1]] }), 'c-b', 'only an archived client: better than nothing');
    assert.equal(defaultClientId({ clients: [] }), '');
  });

  it('a client picked this visit is kept only while the live client is the one that was live when it was picked', () => {
    assert.equal(lastClientId(null), null, 'nothing picked yet');
    rememberClient('c-b', 'c-z');
    assert.equal(lastClientId('c-z'), 'c-b');
    assert.equal(lastClientId('c-a'), null, 'something else went live since: the screen follows it');
    assert.equal(lastClientId(null), null);
    rememberClient('c-a', null);
    assert.equal(lastClientId(null), 'c-a', 'nothing live: the last one used');
    assert.equal(lastClientId('c-z'), null);
  });

  it("one client's activities, in order: another client's, and one that names no client, are not among them", () => {
    const sections = [
      { id: 's3', title: 'Third', order: 3, clientId: 'c-a' }, { id: 's1', title: 'First', order: 1, clientId: 'c-a' }, { id: 's9', title: 'Other', order: 1, clientId: 'c-b' },
      { id: 'u2', title: 'Loose B', order: 2 }, { id: 'u1', title: 'Loose A', order: 2, clientId: '' }, { id: 's2', title: 'Second', order: 2, clientId: 'c-a' },
      { id: 's4', title: 'Alpha', order: 3, clientId: 'c-a' },
    ];
    assert.deepEqual(activitiesOfClient(sections, 'c-a').map((section) => section.id), ['s1', 's2', 's4', 's3'], 'in order, and ties fall back to the title');
    assert.deepEqual(activitiesOfClient(sections, 'c-b').map((section) => section.id), ['s9']);
    assert.deepEqual(activitiesOfClient(sections, 'c-nobody'), []);
  });

  it('a title is needed, short, and not another activity of the same client', () => {
    const siblings = [{ id: 's1', title: 'History' }, { id: 's2', title: 'Brands' }];
    assert.match(titleProblem('  ', siblings), /Enter a name/);
    assert.match(titleProblem('x'.repeat(101), siblings), /100 characters/);
    assert.match(titleProblem('  history ', siblings), /already has an activity called "History"/);
    assert.equal(titleProblem('History', siblings, 's1'), '', 'renaming an activity to its own title is no clash');
    assert.equal(titleProblem('Quiz', siblings), '');
  });

  it('moving an activity renumbers the client list and changes only what moved', () => {
    const owned = [{ id: 'a', order: 1 }, { id: 'b', order: 2 }, { id: 'c', order: 3 }];
    const down = reorderActivities(owned, 'a', 1);
    assert.deepEqual(down.next.map((section) => section.id), ['b', 'a', 'c']);
    assert.deepEqual(down.changes, [{ id: 'b', order: 1 }, { id: 'a', order: 2 }], 'c did not move: no write for it');
    assert.equal(reorderActivities(owned, 'a', -1), null, 'the first cannot go up');
    assert.equal(reorderActivities(owned, 'c', 1), null, 'the last cannot go down');
    // Older data where two activities share an order: one move separates them all.
    const tied = reorderActivities([{ id: 'a', order: 0 }, { id: 'b', order: 0 }, { id: 'c', order: 0 }], 'c', -1);
    assert.deepEqual(tied.next.map((section) => [section.id, section.order]), [['a', 1], ['c', 2], ['b', 3]]);
    assert.equal(nextOrder([{ order: 4 }, { order: 2 }]), 5);
    assert.equal(nextOrder([]), 1);
  });

  it("puts questions in the order participants meet them, and each question's options in its own order", () => {
    const section = { questionIds: ['q2', 'q1', 'q-gone', 'q3'] };
    const questions = [{ id: 'q1', order: 1, optionIds: ['o2', 'o1'] }, { id: 'q2', order: 1 }, { id: 'q3', order: 0 }];
    const options = [{ id: 'o1' }, { id: 'o2' }];
    const content = orderedContent(section, questions, options);
    assert.deepEqual(content.map((question) => question.id), ['q3', 'q2', 'q1'], 'by Order, ties by the activity list; a question that is gone is left out');
    assert.deepEqual(content[2].options.map((option) => option.id), ['o2', 'o1']);
  });

  it('layout applies to choices, and a picture address is a web address, a path on this site, or nothing', () => {
    for (const type of ['single-select', 'multi-select', 'true-false']) assert.equal(layoutApplies(type), true, type);
    for (const type of ['ranked-voting', 'confidence-continuum', 'open-text-feedback']) assert.equal(layoutApplies(type), false, type);
    for (const good of ['', '  ', 'https://example.com/a.png', 'http://example.com/a.png', '/assets/images/a.png', 'assets/a.png']) assert.equal(imageUrlProblem(good), '', good);
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'ftp://x/y.png', 'https://example.com/a b.png']) assert.notEqual(imageUrlProblem(bad), '', bad);
    assert.match(imageUrlProblem(`https://example.com/${'a'.repeat(250)}.png`), /limit is 255/);
  });
});

describe('pasted guest names', () => {
  it('reads one name per line, trims, collapses spaces, and counts blank lines', () => {
    const parsed = parseGuestNames('  Jordan   Lee \n\nCasey Park\r\n   \nMorgan\tDay\n');
    assert.deepEqual(parsed.names, ['Jordan Lee', 'Casey Park', 'Morgan Day']);
    assert.equal(parsed.blankLines, 3, 'the empty line, the line of spaces, and the one after the last newline');
    assert.deepEqual(parsed.duplicates, []);
  });

  it('also reads commas and semicolons, on one line or many', () => {
    assert.deepEqual(parseGuestNames('Jordan Lee, Casey Park;Morgan Day').names, ['Jordan Lee', 'Casey Park', 'Morgan Day']);
    assert.deepEqual(parseGuestNames('Jordan Lee, Casey Park\nMorgan Day, Riley Fox,').names, ['Jordan Lee', 'Casey Park', 'Morgan Day', 'Riley Fox'], 'a trailing comma adds nobody');
  });

  it('sets aside a name repeated in the paste or already on the roster, whatever its case and spacing', () => {
    const parsed = parseGuestNames('Jordan Lee\njordan  lee\nCasey Park\nCASEY PARK\nNew Person', { existing: ['Casey  Park', 'Someone Else'] });
    assert.deepEqual(parsed.names, ['Jordan Lee', 'New Person']);
    assert.deepEqual(parsed.duplicates.map((entry) => [entry.name, entry.reason]), [['jordan lee', 'in-paste'], ['Casey Park', 'on-roster'], ['CASEY PARK', 'in-paste']]);
    assert.equal(pasteSummary(parsed), '2 new, 3 duplicates skipped.');
  });

  it(`cuts a name to ${MAX_GUEST_NAME} characters without splitting a letter, and compares the cut name`, () => {
    const long = `${'Ab'.repeat(40)}`;
    const parsed = parseGuestNames(`${long}\n${long.slice(0, MAX_GUEST_NAME)}\n${'😀'.repeat(70)}`);
    assert.equal(parsed.names[0].length, MAX_GUEST_NAME);
    assert.equal(parsed.names.length, 2, 'the second line is the first, cut: a duplicate');
    assert.deepEqual(parsed.duplicates.map((entry) => entry.reason), ['in-paste']);
    assert.equal(Array.from(parsed.names[1]).length, MAX_GUEST_NAME, 'counted in letters, so an emoji is not cut in half');
    assert.equal(parsed.shortened.length, 2);
    assert.match(pasteSummary(parsed), /2 names shortened to 60 characters/);
    assert.equal(pasteSummary(parseGuestNames('A\n\nB')), '2 new, 0 duplicates skipped. 1 blank line ignored.');
  });

  it('control characters are spaces, accents are kept, and the key matches the data service one', () => {
    assert.deepEqual(parseGuestNames('Zoë\u0000Ångström​X').names.map((name) => name.replace(/​/g, '')), ['Zoë Ångström X'.replace(' X', 'X')]);
    for (const name of ['Jordan  Lee', 'ZOË', "O'Brien", ' Ünal  Çelik ', 'é']) assert.equal(guestKey(name), ds.guestNameKey(name), name);
  });
});

describe('guest status, from real data', () => {
  const visitors = [
    { id: 'v-none', displayName: 'Noor' }, { id: 'v-wait', displayName: 'Wren' }, { id: 'v-join', displayName: 'Jo' },
    { id: 'v-done', displayName: 'Dee' }, { id: 'v-off', displayName: 'Off', enabled: false }, { id: 'v-new', displayName: 'Returning' },
  ];
  const tokens = [
    { id: 't-wait', visitorId: 'v-wait', used: false, createdAt: '2026-10-11T09:00:00Z' },
    { id: 't-join', visitorId: 'v-join', used: true, createdAt: '2026-10-11T09:00:00Z' },
    { id: 't-done', visitorId: 'v-done', used: true, createdAt: '2026-10-11T09:00:00Z' },
    { id: 't-old', visitorId: 'v-none', used: true, expiredAt: '2026-10-11T10:00:00Z', createdAt: '2026-10-11T09:00:00Z' },
    { id: 't-returning-1', visitorId: 'v-new', used: true, createdAt: '2026-10-11T09:00:00Z' },
    { id: 't-returning-2', visitorId: 'v-new', used: false, createdAt: '2026-10-11T11:00:00Z' },
  ];
  const tracks = [{ id: 'tr-join', visitorId: 'v-join' }, { id: 'tr-done', visitorId: 'v-done' }, { id: 'tr-new', visitorId: 'v-new' }];
  const sections = [{ enabled: true, questionIds: ['q1', 'q2'] }, { enabled: false, questionIds: ['q3'] }];
  const answer = (track, questionId, extra = {}) => ({ clientTrackId: track, questionId, correct: null, attempts: 1, ...extra });

  it('No code, Not scanned, Joined, Completed and Disabled, by name', () => {
    const completed = completedTrackIds({ tracks, sections, responses: [answer('tr-done', 'q1'), answer('tr-done', 'q2'), answer('tr-join', 'q1')] });
    const rows = guestRows({ visitors, tokens, tracks, completed });
    assert.deepEqual(rows.map((row) => [row.visitor.displayName, row.label]), [
      ['Dee', 'Completed'], ['Jo', 'Joined'], ['Noor', 'No code'], ['Off', 'Disabled'], ['Returning', 'Joined'], ['Wren', 'Not scanned'],
    ]);
    assert.deepEqual(statusCounts(rows), { none: 1, waiting: 1, joined: 2, completed: 1, disabled: 1 });
    assert.equal(rows.find((row) => row.visitor.id === 'v-none').code, null, 'an expired code is no code');
  });

  it('finished means a settled answer to every live question: a wrong first try still open is not settled', () => {
    const open = [answer('tr-done', 'q1'), answer('tr-done', 'q2', { correct: false, attempts: 1 })];
    assert.equal(completedTrackIds({ tracks, sections, responses: open }).has('tr-done'), false);
    const revealed = [answer('tr-done', 'q1'), answer('tr-done', 'q2', { correct: false, attempts: 2 })];
    assert.equal(completedTrackIds({ tracks, sections, responses: revealed }).has('tr-done'), true, 'after two wrong tries the answer is revealed, and the question is settled');
    assert.equal(completedTrackIds({ tracks, sections: [{ enabled: true, questionIds: [] }], responses: revealed }).size, 0, 'with no question nobody has finished anything');
    assert.equal(completedTrackIds({ tracks, sections, responses: [answer('tr-done', 'q1'), answer('someone-else', 'q2')] }).size, 0);
  });

  it('the CSV has the name, the status and whether they joined, and a spreadsheet cannot run a name', () => {
    const rows = guestRows({ visitors: [{ id: 'a', displayName: 'Lee, Jordan "JJ"' }, { id: 'b', displayName: '=HYPERLINK("x")' }, { id: 'c', displayName: 'Zoë' }], tokens: [{ id: 't', visitorId: 'a', used: true }], tracks: [{ id: 'tr', visitorId: 'a' }] });
    const csv = guestsCsv(rows);
    assert.equal(csv.charCodeAt(0), 0xfeff, 'a byte-order mark, so accents survive a spreadsheet');
    assert.deepEqual(csv.slice(1).split('\r\n'), ['Name,Code status,Joined', `'=HYPERLINK("x")`.replace(/^'/, "\"'=").slice(0, 0) + '"\'=HYPERLINK(""x"")",No code,No', '"Lee, Jordan ""JJ""",Joined,Yes', 'Zoë,No code,No', '']);
    assert.equal(csvCell('+1'), "'+1");
    assert.equal(csvCell('a\nb'), '"a\nb"');
    assert.equal(csvFileName({ clientName: "Domino's Pizza", date: DAY }), 'guests-dominos-pizza-2026-10-11.csv');
    assert.equal(csvFileName({}), 'guests-list.csv');
  });

  it('the print sheet has a card for each guest holding a code nobody has scanned, 12 to a page', () => {
    const rows = guestRows({ visitors, tokens, tracks });
    const { cards, left } = printCards(rows, (id) => `https://example.test/index.html?qr=${id}`);
    assert.deepEqual(cards.map((card) => card.name), ['Returning', 'Wren'], 'Returning joined once, and holds a new code for another visit');
    assert.equal(cards[1].url, 'https://example.test/index.html?qr=t-wait');
    assert.deepEqual(left, { none: 1, joined: 2, disabled: 1 });
    const many = Array.from({ length: 25 }, (_, index) => index);
    assert.deepEqual(paginate(many).map((page) => page.length), [CARDS_PER_PAGE, CARDS_PER_PAGE, 1]);
    assert.deepEqual(paginate([]), []);
  });
});

describe('what a copy is', () => {
  const sections = [
    { id: 'sec-a', title: 'History', order: 4, enabled: true, industryTags: ['x'], questionIds: ['q-a1', 'q-gone', 'q-a2'], clientId: 'c-src', description: 'About us' },
    { id: 'sec-b', title: 'Brands', order: 7, enabled: true, questionIds: ['q-b1'], clientId: 'c-src', description: '' },
  ];
  const questions = [
    { id: 'q-a1', sectionId: 'sec-a', type: 'single-select', prompt: 'One?', optionIds: ['o-2', 'o-1'], order: 1, layout: 'image-grid' },
    { id: 'q-a2', sectionId: 'sec-a', type: 'open-text-feedback', prompt: 'Say', optionIds: [], order: 2 },
    { id: 'q-b1', sectionId: 'sec-b', type: 'single-select', prompt: 'Brand?', optionIds: ['o-3'], order: 1 },
  ];
  const options = [
    { id: 'o-1', questionId: 'q-a1', label: 'Yes', value: 'yes', correct: true, imageUrl: 'https://example.test/y.png' },
    { id: 'o-2', questionId: 'q-a1', label: 'No', value: 'no', correct: false, imageUrl: null },
    { id: 'o-3', questionId: 'q-b1', label: 'Maybe', value: 'maybe', correct: null },
  ];

  it('copies activities, questions and options with new ids and the new client, not live, after what the client has', () => {
    const plan = ds.planCopy({ sections, questions, options, toClientId: 'c-dst', targetSections: [{ id: 'x', title: 'Existing', order: 3, clientId: 'c-dst' }] });
    assert.deepEqual(plan.items.map((item) => [item.section.id, item.section.title, item.section.order, item.section.enabled, item.section.clientId]), [
      ['sec-a~c-dst', 'History', 4, false, 'c-dst'], ['sec-b~c-dst', 'Brands', 5, false, 'c-dst'],
    ]);
    assert.deepEqual(plan.totals, { activities: 2, questions: 3, options: 3 }, 'a question that is gone is not copied');
    assert.equal(copyTotalsText(plan.totals), '2 activities, 3 questions, 3 options');
    assert.equal(copyTotalsText({ activities: 1, questions: 1, options: 1 }), '1 activity, 1 question, 1 option');
    const [history] = plan.items;
    assert.deepEqual(history.section.questionIds, ['q-a1~c-dst', 'q-a2~c-dst']);
    assert.deepEqual(history.questions[0], { id: 'q-a1~c-dst', sectionId: 'sec-a~c-dst', type: 'single-select', prompt: 'One?', optionIds: ['o-2~c-dst', 'o-1~c-dst'], order: 1, layout: 'image-grid' });
    assert.deepEqual(history.options.map((option) => [option.id, option.questionId, option.label, option.correct]), [['o-2~c-dst', 'q-a1~c-dst', 'No', false], ['o-1~c-dst', 'q-a1~c-dst', 'Yes', true]], 'options in the question\'s order');
    assert.equal(history.options[1].imageUrl, 'https://example.test/y.png');
    assert.equal('imageUrl' in history.options[0], false, 'a picture travels only when there is one');
    assert.equal('layout' in plan.items[1].questions[0], false, 'and so does a layout');
    assert.equal(history.section.description, 'About us');
    assert.equal('description' in plan.items[1].section, false);
    assert.equal(history.section.id.split('~').length, 2, 'ids are source id, separator, client id');
  });

  it('skips an activity the client already has by title, or has copied before, and says why', () => {
    const target = [{ id: 'z', title: ' brands ', order: 1, clientId: 'c-dst' }, { id: 'sec-a~c-dst', title: 'History (renamed)', order: 2, clientId: 'c-dst' }];
    const plan = ds.planCopy({ sections, questions, options, toClientId: 'c-dst', targetSections: target });
    assert.deepEqual(plan.items, []);
    assert.deepEqual(plan.skipped.map((entry) => [entry.source.id, entry.reason]), [['sec-a', 'already-copied'], ['sec-b', 'title-exists']]);
    assert.match(plan.skipped[0].message, /copied here before \(it may have been renamed since\)/);
    assert.match(plan.skipped[1].message, /"Brands" is already one of this client's activities/);
    // The same title chosen twice is one activity.
    const twice = ds.planCopy({ sections: [sections[0], { ...sections[0], id: 'sec-a2' }], questions, options, toClientId: 'c-dst' });
    assert.equal(twice.items.length, 1);
  });

  it('a copy of a copy starts again from the original, and a duplicate gets new ids and a title of its own', () => {
    assert.equal(ds.copyIdFor('sec-a~c-dst', 'c-third'), 'sec-a~c-third');
    assert.equal(ds.copyTitle('Quiz', ['Quiz', 'quiz (copy)']), 'Quiz (copy 2)');
    let next = 0;
    const plan = ds.planCopy({ sections: [sections[0]], questions, options, toClientId: 'c-src', targetSections: [sections[0], sections[1]], ids: 'random', retitle: true, makeId: () => `new-${next += 1}` });
    assert.equal(plan.items[0].section.title, 'History (copy)');
    assert.equal(plan.items[0].section.order, 8, 'after the client\'s last activity');
    assert.ok(plan.items[0].section.id.startsWith('new-'));
    assert.ok(plan.items[0].questions.every((question) => question.sectionId === plan.items[0].section.id));
  });

  it('says in words what happened', () => {
    const copy = (extra = {}) => ({ copied: [], skipped: [], failed: [], notAttempted: [], stopped: null, liveSessionSynced: null, ...extra });
    const source = (title) => ({ title });
    assert.deepEqual(copyOutcome(copy({ copied: [{}, {}] }), 'Acme'), { headline: 'Copied 2 activities to Acme. They are not live yet.', level: 'success', lines: [], rerun: false });
    const partial = copyOutcome(copy({ copied: [{}], failed: [{ source: source('B'), error: new Error('SharePoint (503): busy') }], notAttempted: [source('C')], stopped: 'failures', skipped: [{ source: source('A'), message: '"A" is already one of this client\'s activities.' }] }), 'Acme');
    assert.equal(partial.level, 'warning');
    assert.equal(partial.rerun, true);
    assert.deepEqual(partial.lines, ['Skipped: "A" is already one of this client\'s activities.', 'Not copied: "B" (SharePoint (503): busy). Nothing of it was kept.', 'Not tried: "C".']);
    assert.equal(copyOutcome(copy({ failed: [{ source: source('B'), error: new Error('no') }] }), 'Acme').level, 'error');
    assert.equal(copyOutcome(copy(), 'Acme').headline, 'Nothing to copy: everything chosen is already there.');
    assert.match(copyOutcome(copy({ copied: [{}], liveSessionSynced: false }), 'Acme').lines[0], /Acme is live, and its results may not count the new activities/);
  });
});

// ---- On SharePoint (mocked): copying, and what it costs ---------------------------------------------

/** Counts how many requests are in flight at once (each is held for a moment, as a network would). */
function watchConcurrency() {
  const inner = globalThis.fetch;
  const seen = { inFlight: 0, max: 0, started: [] };
  globalThis.fetch = async (...args) => {
    seen.inFlight += 1;
    seen.max = Math.max(seen.max, seen.inFlight);
    seen.started.push(Date.now());
    await new Promise((resolve) => { setTimeout(resolve, 4); });
    try { return await inner(...args); } finally { seen.inFlight -= 1; }
  };
  return { seen, stop() { globalThis.fetch = inner; } };
}

const dump = async (api, clientId) => {
  const [sections] = await api.readLists([{ list: 'sections', where: { clientId } }]);
  const content = await api.readActivityContent(sections);
  const strip = (record) => Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)));
  const sort = (list) => list.map(strip).sort((a, b) => a.id.localeCompare(b.id));
  return { sections: sort(sections), questions: sort(content.questions), options: sort(content.options) };
};

describe('on SharePoint (mocked)', () => {
  let fake;
  before(() => { fake = null; });
  after(() => { globalThis.fetch = realFetch; ds.configure({ baseUrl: '/api' }); });

  it('copies two activities whole, not live, with every record in the numbers the screen promised, and counts the requests', async () => {
    fake = await site();
    await ds.createClient(acme());
    const page = await freshPage({ sharePoint: fake.settings });
    const [sections] = await page.readLists([{ list: 'sections', where: { clientId: 'c-kroger' } }]);
    const chosen = sections.filter((section) => ['sec-trivia', 'sec-guess-the-brand'].includes(section.id));
    const content = await page.readActivityContent(chosen);
    const plan = page.planCopy({ sections: chosen, ...content, toClientId: 'c-acme' });
    assert.deepEqual(plan.totals, { activities: 2, questions: 6, options: content.options.length });

    const watch = watchConcurrency();
    fake.reset();
    const progress = [];
    const result = await page.copyActivities({ toClientId: 'c-acme', content: { sections: chosen, ...content }, onProgress: (step) => progress.push(step) });
    watch.stop();
    assert.deepEqual(result.copied.map((item) => item.section.title), ["Kroger's History", 'Guess the Brand']);
    assert.deepEqual(result.failed, []);
    assert.equal(result.liveSessionSynced, null, 'Acme is not live');
    const total = plan.totals.activities + plan.totals.questions + plan.totals.options;
    assert.equal(progress.length, total);
    assert.deepEqual(progress.at(-1), { written: total, total, activity: 'Guess the Brand', activityIndex: 2, activities: 2 });

    const made = await dump(page, 'c-acme');
    assert.deepEqual(made.sections.map((section) => [section.id, section.enabled, section.order, section.clientId]), [['sec-guess-the-brand~c-acme', false, 2, 'c-acme'], ['sec-trivia~c-acme', false, 1, 'c-acme']]);
    assert.equal(made.questions.length, 6);
    assert.equal(made.options.length, content.options.length);
    assert.ok(made.options.every((option) => option.questionId.endsWith('~c-acme')));
    assert.ok(made.questions.every((question) => question.optionIds.every((id) => made.options.some((option) => option.id === id))), 'every question refers only to options that exist');

    const writes = fake.requests.filter((entry) => entry.method !== 'GET' && !entry.path.endsWith('/contextinfo') && !entry.path.endsWith('/$batch'));
    assert.deepEqual([writes.filter((entry) => entry.list === 'options').length, writes.filter((entry) => entry.list === 'questions').length, writes.filter((entry) => entry.list === 'sections').length], [content.options.length, 6, 2]);
    assert.equal(writes.length, total, 'one POST per record and nothing else is written');
    const firstActivity = writes.map((entry, index) => ({ entry, index })).filter(({ entry }) => /^[oq]-trivia/.test(entry.appId));
    assert.equal(firstActivity.length, 25, "the first activity's 20 options and 5 questions");
    assert.ok(writes.findIndex((entry) => entry.list === 'sections') > firstActivity.at(-1).index, 'the first activity is whole before its record appears');
    assert.ok(watch.seen.max <= 3, `at most 3 requests at a time (saw ${watch.seen.max})`);
    assert.ok(watch.seen.max >= 2, 'but it does use the lanes');
    const gets = fake.requests.filter((entry) => entry.method === 'GET' || entry.path.endsWith('/$batch')).length;
    measured.push([`Copy 2 activities (${plan.totals.questions} questions, ${plan.totals.options} options) to another client, first copy on a fresh page`, fake.requests.length, `${total} writes + ${fake.requests.length - total} others (${gets} reads incl. list metadata, the write token)`]);
    assert.ok(fake.requests.length - total <= 14, `not more than 14 requests beside the writes (saw ${fake.requests.length - total})`);
    measured.push(['  pacing', watch.seen.max, `at most ${watch.seen.max} in flight; ${PACE_NOTE}`]);
  });

  it('copying again does nothing; skipping is by title, and by origin after a rename', async () => {
    fake = await site();
    await ds.createClient(acme());
    const page = await freshPage({ sharePoint: fake.settings });
    await page.copyActivities({ toClientId: 'c-acme', sectionIds: ['sec-trivia'] });
    fake.reset();
    const again = await page.copyActivities({ toClientId: 'c-acme', sectionIds: ['sec-trivia'] });
    assert.deepEqual(again.copied, []);
    assert.deepEqual(again.skipped.map((entry) => entry.reason), ['title-exists']);
    assert.equal(fake.requests.filter((entry) => entry.method !== 'GET' && !entry.path.endsWith('/contextinfo') && !entry.path.endsWith('/$batch')).length, 0, 'not one write');
    // Renamed since: still the same activity.
    await page.updateSection('sec-trivia~c-acme', { title: 'Our own history' });
    const renamed = await page.copyActivities({ toClientId: 'c-acme', sectionIds: ['sec-trivia'] });
    assert.deepEqual(renamed.skipped.map((entry) => entry.reason), ['already-copied']);
    // A title the client has under another id is a clash too, so the target keeps reading unambiguously.
    await ds.createSection({ id: 'own', title: "Domino's History", order: 9, enabled: true, industryTags: [], questionIds: [], clientId: 'c-acme' });
    const clash = await page.copyActivities({ toClientId: 'c-acme', sectionIds: ['sec-dominos-history'] });
    assert.deepEqual(clash.skipped.map((entry) => entry.reason), ['title-exists']);
  });

  it('a write that fails leaves no half-built activity, the other activity is copied, and running it again completes only the missing one', async () => {
    fake = await site();
    await ds.createClient(acme());
    const page = await freshPage({ sharePoint: fake.settings });
    // The 8th option written (inside the first activity) fails once.
    let options = 0;
    fake.failNext({ status: 503, times: 1, when: (entry) => entry.method === 'POST' && entry.list === 'options' && (options += 1) === 8 });
    const first = await page.copyActivities({ toClientId: 'c-acme', sectionIds: ['sec-trivia', 'sec-guess-the-brand'], gapMs: 0 });
    assert.deepEqual(first.copied.map((item) => item.section.id), ['sec-guess-the-brand~c-acme'], 'the activity after the failed one was still copied');
    assert.deepEqual(first.failed.map((entry) => [entry.source.id, entry.error.status]), [['sec-trivia', 503]]);
    assert.equal(first.stopped, null);
    assert.equal(copyOutcome(first, 'Acme').level, 'warning');
    const left = await dump(page, 'c-acme');
    assert.deepEqual(left.sections.map((section) => section.id), ['sec-guess-the-brand~c-acme'], 'no record of the failed activity');
    for (const list of ['options', 'questions']) {
      const orphans = fake.lists.get(list).filter((row) => row.AppId.includes('trivia') && row.AppId.endsWith('~c-acme'));
      assert.deepEqual(orphans.map((row) => row.AppId), [], `no ${list} of the failed activity were left behind`);
    }
    assert.equal(fake.lists.get('questions').filter((row) => row.AppId.endsWith('~c-acme')).length, 1, "only the finished activity's question");

    fake.reset();
    const again = await page.copyActivities({ toClientId: 'c-acme', sectionIds: ['sec-trivia', 'sec-guess-the-brand'], gapMs: 0 });
    assert.deepEqual(again.copied.map((item) => item.section.id), ['sec-trivia~c-acme']);
    assert.deepEqual(again.skipped.map((entry) => [entry.source.id, entry.reason]), [['sec-guess-the-brand', 'title-exists']]);
    const writes = fake.requests.filter((entry) => entry.method === 'POST' && ['options', 'questions', 'sections'].includes(entry.list));
    const planned = ds.planCopy({ ...(await page.readActivityContent([await ds.getSection('sec-trivia')]).then((content) => ({ sections: [{ ...first.failed[0].source }], ...content }))), toClientId: 'c-x' }).totals;
    assert.equal(writes.length, planned.activities + planned.questions + planned.options, 'only the missing activity was written');
    assert.equal((await dump(page, 'c-acme')).sections.length, 2);
    measured.push(['Re-run after a failure: copies only the activity that is missing', fake.requests.length, `${writes.length} writes`]);
  });

  it('writes over what a failed run could not clean up (a record whose id is taken), and does not call that a failure', async () => {
    fake = await site();
    await ds.createClient(acme());
    const page = await freshPage({ sharePoint: fake.settings });
    await ds.createOption({ id: 'o-trivia-1-a~c-acme', questionId: 'stale', label: 'Stale', value: 'stale', correct: null });
    const result = await page.copyActivities({ toClientId: 'c-acme', sectionIds: ['sec-trivia'], gapMs: 0 });
    assert.deepEqual(result.failed, []);
    const stored = fake.item('options', 'o-trivia-1-a~c-acme');
    assert.equal(stored.QuestionId, 'q-trivia-1~c-acme');
    assert.notEqual(stored.Label, 'Stale');
  });

  it('stops after two activities in a row fail, and says what it did not try', async () => {
    fake = await site();
    await ds.createClient(acme());
    const page = await freshPage({ sharePoint: fake.settings });
    fake.failNext({ status: 503, times: 100, when: (entry) => entry.method === 'POST' && entry.list === 'options' });
    const result = await page.copyActivities({ toClientId: 'c-acme', sectionIds: ['sec-trivia', 'sec-guess-the-brand', 'sec-dominos-history', 'sec-dominos-innovation'], gapMs: 0 });
    assert.equal(result.stopped, 'failures');
    assert.deepEqual(result.failed.map((entry) => entry.source.id), ['sec-trivia', 'sec-guess-the-brand']);
    assert.deepEqual(result.notAttempted.map((entry) => entry.id), ['sec-dominos-history', 'sec-dominos-innovation']);
    assert.equal((await dump(page, 'c-acme')).sections.length, 0);
    assert.equal(fake.lists.get('options').filter((row) => row.AppId.endsWith('~c-acme')).length, 0, 'nothing left');
  });

  it('a stop request finishes by undoing the activity in flight', async () => {
    fake = await site();
    await ds.createClient(acme());
    const page = await freshPage({ sharePoint: fake.settings });
    const stop = new AbortController();
    const result = await page.copyActivities({
      toClientId: 'c-acme', sectionIds: ['sec-trivia', 'sec-guess-the-brand'], gapMs: 0, signal: stop.signal,
      onProgress: ({ written }) => { if (written === 5) stop.abort(); },
    });
    assert.equal(result.stopped, 'aborted');
    assert.deepEqual(result.copied, []);
    assert.equal((await dump(page, 'c-acme')).sections.length, 0);
    assert.equal(fake.lists.get('options').filter((row) => row.AppId.endsWith('~c-acme')).length, 0);
    assert.deepEqual(result.notAttempted.map((entry) => entry.id), ['sec-trivia', 'sec-guess-the-brand']);
  });

  it('a copy made for the live client joins the live session, so its results count it; another client\'s does not', async () => {
    fake = await site();
    await ds.createClient(acme());
    const { session } = await ds.activateClient('c-dominos', DAY);
    const page = await freshPage({ sharePoint: fake.settings });
    const result = await page.copyActivities({ toClientId: 'c-dominos', sectionIds: ['sec-trivia'], retitle: true, ids: 'random', gapMs: 0 });
    assert.equal(result.liveSessionSynced, true);
    const live = await ds.getSession(session.id);
    assert.ok(live.sectionIds.includes(result.copied[0].section.id));
    const other = await page.copyActivities({ toClientId: 'c-acme', sectionIds: ['sec-trivia'], gapMs: 0 });
    assert.equal(other.liveSessionSynced, null);
    assert.ok(!(await ds.getSession(session.id)).sectionIds.includes('sec-trivia~c-acme'));
  });

  it('duplicates an activity of its own client, titled "(copy)", not live, with ids of its own; an activity with no client cannot be', async () => {
    fake = await site();
    const page = await freshPage({ sharePoint: fake.settings });
    const first = await page.duplicateActivity('sec-trivia', { gapMs: 0 });
    const second = await page.duplicateActivity('sec-trivia', { gapMs: 0 });
    assert.deepEqual([first.copied[0].section.title, second.copied[0].section.title], ["Kroger's History (copy)", "Kroger's History (copy 2)"]);
    assert.ok(first.copied[0].section.enabled === false && first.copied[0].section.clientId === 'c-kroger');
    assert.notEqual(first.copied[0].section.id, second.copied[0].section.id);
    assert.deepEqual(first.copied[0].section.order, 3, 'after the last of Kroger\'s two');
    await ds.createSection({ id: 'loose', title: 'Loose', order: 1, enabled: false, industryTags: [], questionIds: [] });
    await assert.rejects(page.duplicateActivity('loose'), { code: 'activity-unassigned' });
    await assert.rejects(page.duplicateActivity('nope'), { code: 'activity-missing' });
  });

  it('deletes an activity with its questions and options, and takes it out of the live session', async () => {
    fake = await site();
    const { session } = await ds.activateClient('c-dominos', DAY);
    const page = await freshPage({ sharePoint: fake.settings });
    const section = await ds.getSection('sec-dominos-innovation');
    const before = await page.readActivityContent([section]);
    fake.reset();
    const result = await page.deleteActivity('sec-dominos-innovation', { gapMs: 0 });
    assert.deepEqual(result.deleted, { questions: before.questions.length, options: before.options.length });
    assert.deepEqual(result.leftovers, []);
    assert.equal(fake.item('sections', 'sec-dominos-innovation'), undefined);
    assert.equal(fake.lists.get('questions').filter((row) => (section.questionIds).includes(row.AppId)).length, 0);
    assert.ok(!(await ds.getSession(session.id)).sectionIds.includes('sec-dominos-innovation'));
    assert.deepEqual(await page.deleteActivity('sec-dominos-innovation'), { deleted: { questions: 0, options: 0 }, leftovers: [] }, 'deleting twice is no error');
    const firstDelete = fake.requests.findIndex((entry) => entry.method === 'POST' && /DELETE/.test(JSON.stringify(entry)) || entry.method === 'DELETE');
    assert.ok(firstDelete >= 0);
    // The activity record goes first: participants stop seeing it before its questions go.
    const deletes = fake.requests.filter((entry) => entry.method === 'DELETE');
    assert.equal(deletes[0].list, 'sections');
    measured.push([`Delete an activity (${before.questions.length} questions, ${before.options.length} options)`, fake.requests.length, `${deletes.length} deletes`]);
  });
});

const PACE_NOTE = '3 writes in flight, 120 ms between one lane\'s writes, Retry-After honoured by the adapter';

// ---- Guests, in bulk -----------------------------------------------------------------------------------

/** The live session's guests, read the way the admin reads them. */
const rosterOf = async (sessionId) => (await ds.readLists([{ list: 'visitorroster', where: { sessionId } }]))[0];

async function guestSite(guestCount = 0) {
  const fake = await site();
  const { session } = await ds.activateClient('c-kroger', DAY);
  await ds.setSessionParticipationMode(session.id, 'client-visit');
  const names = Array.from({ length: guestCount }, (_, index) => `Guest ${String(index + 1).padStart(2, '0')}`);
  for (const name of names) await ds.createVisitor({ sessionId: session.id, displayName: name, enabled: true });
  return { fake, session, names };
}

describe('guests in bulk, on SharePoint (mocked)', () => {
  after(() => { globalThis.fetch = realFetch; ds.configure({ baseUrl: '/api' }); });

  it('adds a pasted list: new names only, and adding it twice adds nobody', async () => {
    const { fake, session } = await guestSite(0);
    const page = await freshPage({ sharePoint: fake.settings });
    await ds.createVisitor({ sessionId: session.id, displayName: 'Already Here', enabled: true });
    const parsed = parseGuestNames('Jordan Lee\nCasey Park, Morgan Day\n\nalready here\nJordan Lee');
    const watch = watchConcurrency();
    fake.reset();
    const result = await page.addGuests(session.id, parsed.names);
    watch.stop();
    assert.deepEqual(result.added.map((visitor) => visitor.displayName).sort(), ['Casey Park', 'Jordan Lee', 'Morgan Day']);
    assert.deepEqual(result.failed, []);
    assert.equal(writesOf(fake, 'visitorroster').length, 3);
    assert.ok(watch.seen.max <= 3);
    const again = await page.addGuests(session.id, ['Jordan Lee', 'Casey  Park', 'Brand New']);
    assert.deepEqual(again.added.map((visitor) => visitor.displayName), ['Brand New']);
    assert.deepEqual(again.skipped, ['Jordan Lee', 'Casey  Park'], 'checked against the roster as it is now, not as the screen last saw it');
    assert.equal((await rosterOf(session.id)).length, 5);
    await assert.rejects(page.addGuests('nope', ['X']), { code: 'session-missing' });
    await ds.endSession(session.id).catch(() => {});
  });

  it('refuses a session that is not the live one', async () => {
    const { fake, session } = await guestSite(0);
    await ds.createSession({ id: 'other', clientId: 'c-kroger', date: '2026-09-18', sectionIds: [], status: 'in-progress' });
    const page = await freshPage({ sharePoint: fake.settings });
    await assert.rejects(page.addGuests('other', ['X']), { code: 'session-not-active' });
    await ds.endSession(session.id);
    await assert.rejects(page.addGuests(session.id, ['X']), { code: 'session-ended' });
  });

  it('makes a code for every enabled guest without one, once; running it again, or after a failure, makes only what is missing', async () => {
    const { fake, session, names } = await guestSite(14);
    const roster = await rosterOf(session.id);
    const byName = Object.fromEntries(roster.map((visitor) => [visitor.displayName, visitor]));
    await ds.provisionQrToken('c-kroger', session.id, { visitorId: byName['Guest 01'].id }); // one already has a code
    await ds.setVisitorEnabled(byName['Guest 02'].id, false); // one is switched off
    const page = await freshPage({ sharePoint: fake.settings });
    const watch = watchConcurrency();
    fake.reset();
    const progress = [];
    const first = await page.provisionGuestCodes(session.id, { onProgress: (step) => progress.push(step) });
    watch.stop();
    const expected = names.length - 2;
    assert.equal(first.created.length, expected);
    assert.equal(first.alreadyHad, names.length - 1 - expected + 0, 'the guest who had a code');
    assert.deepEqual(progress.at(-1), { done: expected, total: expected });
    const posts = writesOf(fake, 'qrtokens');
    assert.equal(posts.length, expected, 'one POST per code and nothing else is written');
    assert.ok(watch.seen.max <= 3 && watch.seen.max >= 2, `paced at most 3 at a time (saw ${watch.seen.max})`);
    const gaps = watch.seen.started.slice().sort((a, b) => a - b);
    const elapsed = gaps.at(-1) - gaps[0];
    assert.ok(elapsed >= (Math.ceil(expected / 3) - 1) * 100, `lanes wait between writes: ${elapsed} ms for ${expected} codes`);
    const others = fake.requests.length - posts.length;
    assert.ok(others <= 8, `beside the writes: the write token, one batch, the client, the list's two metadata reads (saw ${others}: ${fake.requests.filter((entry) => entry.method !== 'POST' || entry.list !== 'qrtokens').map(shape).join(' | ')})`);
    measured.push([`Generate all codes for ${expected} guests (first run, fresh page)`, fake.requests.length, `${posts.length} writes + ${others} others; ${PACE_NOTE}`]);
    const rows = fake.lists.get('qrtokens').filter((row) => row.SessionId === session.id);
    assert.equal(new Set(rows.map((row) => row.VisitorId)).size, names.length - 1, 'every enabled guest now has exactly one');
    assert.equal(rows.length, names.length - 1);

    // Pressing it again: nothing to do, nothing written.
    fake.reset();
    const second = await page.provisionGuestCodes(session.id);
    assert.deepEqual([second.created.length, second.failed.length], [0, 0]);
    assert.equal(writesOf(fake, 'qrtokens').length, 0);
    measured.push(['Generate all codes again (nobody is missing one)', fake.requests.length, 'no writes']);

    // A guest is added, a write fails, the run is repeated: only the missing code is made.
    await ds.createVisitor({ sessionId: session.id, displayName: 'Late Guest', enabled: true });
    await ds.createVisitor({ sessionId: session.id, displayName: 'Later Guest', enabled: true });
    fake.failNext({ status: 503, times: 1, when: (entry) => entry.method === 'POST' && entry.list === 'qrtokens' });
    const third = await page.provisionGuestCodes(session.id, { gapMs: 0 });
    assert.equal(third.created.length, 1);
    assert.equal(third.failed.length, 1);
    assert.equal(third.failed[0].error.status, 503);
    const fourth = await page.provisionGuestCodes(session.id, { gapMs: 0 });
    assert.equal(fourth.created.length, 1, 'the one that failed');
    assert.equal(fourth.alreadyHad, names.length - 1 + 1);
    assert.equal((await page.provisionGuestCodes(session.id, { gapMs: 0 })).created.length, 0);
  });

  it('does not make a code for a guest who joined, and needs guest mode and a live, unended session', async () => {
    const { fake, session } = await guestSite(2);
    const [one] = await rosterOf(session.id);
    const code = await ds.provisionQrToken('c-kroger', session.id, { visitorId: one.id });
    await (await ds.openQrScan(code.id)).claim();
    const page = await freshPage({ sharePoint: fake.settings });
    const made = await page.provisionGuestCodes(session.id, { gapMs: 0 });
    assert.equal(made.created.length, 1, 'only the guest who has not joined and has no code');
    assert.equal(made.created.every((entry) => entry.visitorId !== one.id), true);
    await ds.setSessionParticipationMode(session.id, 'staff');
    await assert.rejects(page.provisionGuestCodes(session.id), { code: 'visitor-required' });
    await ds.setSessionParticipationMode(session.id, 'client-visit');
    await ds.endSession(session.id);
    await assert.rejects(page.provisionGuestCodes(session.id), { code: 'session-ended' });
  });

  it('a code made in bulk is the code provisionQrToken makes: same fields, and it is scanned like any other', async () => {
    const { fake, session } = await guestSite(1);
    const [visitor] = await rosterOf(session.id);
    const page = await freshPage({ sharePoint: fake.settings });
    const { created } = await page.provisionGuestCodes(session.id, { gapMs: 0 });
    const token = await ds.getQrToken(created[0].tokenId);
    assert.deepEqual({ ...token, id: 'x', createdAt: 'x' }, { id: 'x', clientId: 'c-kroger', sessionId: session.id, visitorId: visitor.id, used: false, createdAt: 'x', usedAt: null, clientTrackId: null });
    const track = await (await ds.openQrScan(token.id)).claim();
    assert.equal(track.participantName, visitor.displayName);
    assert.equal(track.visitorId, visitor.id);
  });

  it('the QR link is the participant page of this site and the code, whether the page is on SharePoint or served locally', () => {
    const sharePointPage = 'https://tenant.example/sites/cec/Shared%20Documents/p_cec_02/admin.html#guests';
    const base = new URL('index.html', sharePointPage).href;
    assert.equal(ds.qrUrl('0b1c', base), 'https://tenant.example/sites/cec/Shared%20Documents/p_cec_02/index.html?qr=0b1c');
    assert.equal(ds.qrTokenFromSearch(new URL(ds.qrUrl('0b1c', base)).search), '0b1c');
    assert.equal(ds.qrUrl('a b', 'http://192.168.1.20:3000/index.html'), 'http://192.168.1.20:3000/index.html?qr=a+b');
  });
});

// ---- The two adapters leave the same records ------------------------------------------------------------

/** Everything the section does, in one run; what it leaves behind, as plain data an assertion can compare. */
async function wholeRun(api) {
  const out = {};
  await api.createClient(acme());
  const copy = await api.copyActivities({ toClientId: 'c-acme', sectionIds: ['sec-trivia', 'sec-guess-the-brand', 'sec-dominos-history'], gapMs: 0 });
  out.copy = { copied: copy.copied.map((item) => item.section.id), skipped: copy.skipped.map((entry) => [entry.source.id, entry.reason]), failed: copy.failed.length };
  out.afterCopy = await dump(api, 'c-acme');
  out.again = (await api.copyActivities({ toClientId: 'c-acme', sectionIds: ['sec-trivia', 'sec-guess-the-brand'], gapMs: 0 })).skipped.map((entry) => entry.reason);
  const dup = await api.duplicateActivity('sec-trivia~c-acme', { gapMs: 0 });
  out.duplicate = [dup.copied[0].section.title, dup.copied[0].section.order, dup.copied[0].questions.length, dup.copied[0].options.length];
  out.orders = (await api.readLists([{ list: 'sections', where: { clientId: 'c-acme' } }]))[0].map((section) => [section.id.replace(/^[0-9a-f-]{36}$/, 'random'), section.order]).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  const deleted = await api.deleteActivity('sec-dominos-history~c-acme', { gapMs: 0 });
  out.deleted = deleted.deleted;
  out.afterDelete = (await dump(api, 'c-acme')).sections.map((section) => section.id).filter((id) => !/^[0-9a-f-]{36}$/.test(id));

  const { session } = await api.activateClient('c-kroger', DAY);
  await api.setSessionParticipationMode(session.id, 'client-visit');
  const added = await api.addGuests(session.id, ['Jordan Lee', 'Casey Park', 'Morgan Day'], { gapMs: 0 });
  out.guests = [added.added.map((visitor) => visitor.displayName).sort(), added.skipped, added.failed.length];
  const codes = await api.provisionGuestCodes(session.id, { gapMs: 0 });
  out.codes = [codes.created.length, codes.alreadyHad, codes.failed.length];
  out.codesAgain = (await api.provisionGuestCodes(session.id, { gapMs: 0 })).created.length;
  const [tokens, visitors] = await api.readLists([{ list: 'qrtokens', where: { sessionId: session.id } }, { list: 'visitorroster', where: { sessionId: session.id } }]);
  out.tokenShape = tokens.map((token) => [visitors.find((visitor) => visitor.id === token.visitorId).displayName, token.used, token.expiredAt ?? null, token.clientId]).sort();
  return out;
}

describe('both adapters leave the same records', () => {
  let server;
  let dataDir;
  after(async () => {
    server?.kill();
    globalThis.fetch = realFetch;
    ds.configure({ baseUrl: '/api' });
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  /** A page on the real local server, which runs on a scratch copy of server/data and is started once for this group. */
  let port;
  async function localPage() {
    if (!server) {
      dataDir = await mkdtemp(path.join(os.tmpdir(), 'cec-content-'));
      await cp(path.join(ROOT, 'server', 'data'), dataDir, { recursive: true });
      port = await freePort();
      server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'inherit'] });
      await new Promise((resolve, reject) => {
        server.once('exit', (code) => reject(new Error(`server exited early (code ${code})`)));
        server.stdout.on('data', (chunk) => String(chunk).includes('running') && resolve());
      });
    }
    return freshPage({ baseUrl: `http://localhost:${port}/api` });
  }

  it('copy, duplicate, delete, bulk guests and bulk codes: SharePoint (mocked) and the local server agree', async () => {
    const fake = await site();
    const onSharePoint = await wholeRun(await freshPage({ sharePoint: fake.settings }));
    globalThis.fetch = realFetch;

    const local = await localPage();
    const onLocal = await wholeRun(local);

    assert.deepEqual(onLocal, onSharePoint);
    assert.equal(onLocal.copy.copied.length, 3);
    assert.deepEqual(onLocal.again, ['title-exists', 'title-exists']);
    assert.deepEqual(onLocal.guests, [['Casey Park', 'Jordan Lee', 'Morgan Day'], [], 0]);
    assert.deepEqual(onLocal.codes, [3, 0, 0]);
    assert.equal(onLocal.codesAgain, 0);
    // Nothing a test made is in the seed or the server data on disk.
    const seeded = JSON.parse(await readFile(path.join(ROOT, 'server', 'data', 'clients.json'), 'utf8'));
    assert.deepEqual(seeded.map((client) => client.id).sort(), ['c-dominos', 'c-kroger']);
  });

  // Phase 10c-2a, F2. Before a picture's file is removed, the question editor asks whether another answer still shows it (a
  // duplicate of the activity, or a copy made for another client, shows the same file). It used to ask the Options list for
  // `ImageUrl eq '<address>'`, once for each picture: a filter on a column with no index. It now reads every activity's answers
  // by their question, as Content already does, and compares the addresses itself.
  it('which pictures an answer still shows: read by question, never by a filter on the picture, the same on both adapters', async () => {
    const name = (address) => address.split('/').pop();
    const run = async (page, base, watch = () => {}) => {
      const shown = `${base}/kroger-tile-0123456789.png`;
      const replacement = `${base}/kroger-tile-aaaaaaaaaa.png`;
      const nobodys = `${base}/kroger-tile-bbbbbbbbbb.png`;
      const [section] = await page.listClientSections('c-kroger');
      const { questions, options } = await page.readActivityContent([section]);
      const first = options.find((option) => option.questionId === questions[0].id);
      await page.updateOption(first.id, { imageUrl: shown });
      watch('start');
      const alone = await picturesStillShown(page, [shown, nobodys]);
      watch('one answer shows one of two pictures');
      const { copied } = await page.duplicateActivity(section.id, { gapMs: 0 });
      // The original's picture is replaced: the duplicate still shows the old file, so the file must stay.
      await page.updateOption(first.id, { imageUrl: replacement });
      watch('start');
      const afterReplace = await picturesStillShown(page, [shown, nobodys, replacement]);
      watch('three pictures, a duplicate shows the old one');
      await page.deleteActivity(copied[0].section.id, { gapMs: 0 });
      const afterDelete = await picturesStillShown(page, [shown, nobodys]);
      return { alone: [...alone].map(name), afterReplace: [...afterReplace].map(name).sort(), afterDelete: [...afterDelete].map(name) };
    };

    const fake = await site();
    const counts = [];
    let from = 0;
    const onSharePoint = await run(await freshPage({ sharePoint: fake.settings }), `${fake.siteUrl}/${TITLE.logoLibrary}`, (what) => {
      if (what !== 'start') {
        const sent = fake.requests.slice(from);
        const addresses = sent.flatMap((entry) => [entry, ...(entry.parts ?? [])]).map((entry) => `${entry.path}${entry.query}`);
        // (Since Phase 10h a read of the answers names every column of the list, ImageUrl among them: what matters is that none filters on it.)
        assert.deepEqual(addresses.filter((address) => /\$filter=[^&]*ImageUrl/i.test(address)), [], 'no read filters on the picture column');
        assert.ok(addresses.some((address) => /QuestionId eq /.test(address)), 'the answers are read by their question');
        counts.push(sent.length);
        measured.push([`asking which pictures an answer still shows (${what})`, sent.length, 'was one request for each picture, filtered on ImageUrl']);
      }
      from = fake.requests.length;
    });
    assert.deepEqual(counts, [2, 2], 'the activities, then their answers: the same two requests however many pictures are asked about');
    globalThis.fetch = realFetch;
    const onLocal = await run(await localPage(), '/assets/images/clients');

    assert.deepEqual(onLocal, onSharePoint);
    assert.deepEqual(onLocal, { alone: ['kroger-tile-0123456789.png'], afterReplace: ['kroger-tile-0123456789.png', 'kroger-tile-aaaaaaaaaa.png'], afterDelete: [] });
  });

  it('which pictures an answer still shows: nothing is asked about no pictures, and a read that fails is "cannot tell", not "nobody"', async () => {
    const never = { readLists: () => assert.fail('asked'), readActivityContent: () => assert.fail('asked') };
    assert.deepEqual([...await picturesStillShown(never, [])], []);
    assert.equal(await picturesStillShown({ ...never, readLists: async () => { throw new Error('no connection'); } }, ['/a.png']), null);
    assert.equal(await picturesStillShown({ readLists: async () => [[{ id: 's', questionIds: ['q'] }]], readActivityContent: async () => { throw new Error('busy'); } }, ['/a.png']), null);
    // An activity with no questions has no answers, and that is an answer: nothing shows the picture.
    assert.deepEqual([...await picturesStillShown({ readLists: async () => [[]], readActivityContent: async () => ({ questions: [], options: [] }) }, ['/a.png'])], []);
  });

  it('prints what was measured', () => {
    if (!measured.length) return;
    console.log('\nMeasured against the mocked SharePoint REST:');
    for (const [what, count, note] of measured) console.log(`  ${String(count).padStart(4)}  ${what}${note ? `  [${note}]` : ''}`);
  });
});

// Phase 10b: every fake also holds the other set of lists (the prefixed ones; or the plain ones, when this suite is run a second time
// with PMS_TEST_LIST_PREFIX and its own lists are the prefixed ones). A request to them is answered, as a second copy's lists would
// answer on a real site, so nothing else in this suite would notice one: this does.
it('no request of this suite reached a list that is not its own', () => {
  assert.deepEqual(STRAYS.map((entry) => `${entry.method} ${entry.title}`), []);
  assert.deepEqual(UNINDEXED.map((entry) => `${entry.list}.${entry.unindexed}`), [], 'and none filtered on a column the schema does not index');
});
