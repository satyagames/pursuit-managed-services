// Prompt 23, Parts 1 and 3: what an Art of the Possible question may be (lib/schema/aop-rules.js, which the data layer and the screen both ask), the editor's rules
// (lib/admin/aop-editor.js: defaults, ids, paste) and what a copy does with a client's sub-process list. Every refusal has plain words and a test.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import './fresh-page.js';
import { AOP_LIMITS, criteriaProblem, fteProblem, guestPictureProblem, rowsProblem } from '../migration/src/lib/schema/aop-rules.js';
import { COPIED_FROM, DEFAULT_CRITERIA, copiedFrom, defaultCriteria, editingNotice, instructionFor, newCriterion, parsePastedRows, rowsLine } from '../migration/src/lib/admin/aop-editor.js';
import { createSharePointFake } from './sharepoint-fake.js';

const ok = (at = 0) => ({ id: `c-${String(at).repeat(6)}`, label: `Criterion ${at}`, hint: '', direction: 'favours' });

describe('the limits, one by one', () => {
  it('criteria: 2 to 6, unique ids, a label of 1 to 40, a hint of at most 160, one of three directions, the JSON at most 1,800', () => {
    assert.equal(criteriaProblem([ok(1), ok(2)]), '');
    assert.equal(criteriaProblem(Array.from({ length: 6 }, (_, at) => ok(at))), '');
    assert.match(criteriaProblem([ok(1)]), /at least 2 criteria/);
    assert.match(criteriaProblem(Array.from({ length: 7 }, (_, at) => ok(at))), /at most 6 criteria/);
    assert.match(criteriaProblem('nope'), /at least 2 criteria/);
    assert.match(criteriaProblem([ok(1), ok(1)]), /same id/);
    assert.match(criteriaProblem([ok(1), { ...ok(2), label: '  ' }]), /needs a name/);
    assert.match(criteriaProblem([ok(1), { ...ok(2), label: 'x'.repeat(41) }]), /40 characters/);
    assert.equal(criteriaProblem([ok(1), { ...ok(2), label: 'x'.repeat(40) }]), '');
    assert.match(criteriaProblem([ok(1), { ...ok(2), hint: 'x'.repeat(161) }]), /160 characters/);
    assert.match(criteriaProblem([ok(1), { ...ok(2), direction: 'sideways' }]), /Favours, Counts against or Not in the score/);
    const wide = Array.from({ length: 6 }, (_, at) => ({ ...ok(at), label: 'x'.repeat(40), hint: '"'.repeat(160) }));
    assert.match(criteriaProblem(wide), /too long to store/);
    assert.equal(AOP_LIMITS.maxJson, 1800);
  });
  it('people: a number of at most one decimal, 0 to 99,999; blank is 0', () => {
    for (const good of ['', null, undefined, 0, '0', 29, '29', '7.5', 99999, '99999']) assert.equal(fteProblem(good), '', String(good));
    for (const bad of ['-1', -1, '100000', '1.25', 'many', '1,200', NaN]) assert.match(fteProblem(bad), /number from 0 to 99,999/, String(bad));
  });
  it('rows: 2 to 25, each named, at most 255 characters, different from each other', () => {
    const row = (label, value = 1) => ({ label, value });
    const many = (count) => Array.from({ length: count }, (_, at) => row(`Row ${at}`));
    assert.equal(rowsProblem(many(2)), '');
    assert.equal(rowsProblem(many(25)), '');
    assert.match(rowsProblem(many(1)), /at least 2 sub-processes/);
    assert.match(rowsProblem(many(26)), /at most 25 sub-processes/);
    assert.match(rowsProblem([row('A'), row('')]), /Sub-process 2 needs a name/);
    assert.match(rowsProblem([row('A'), row('x'.repeat(256))]), /255 characters/);
    assert.match(rowsProblem([row('A'), row(' a ')]), /different from each other/);
    assert.match(rowsProblem([row('A'), row('B', 'lots')]), /Sub-process 2 \(B\): .*number from 0 to 99,999/);
  });
  it('a guest\'s picture: empty, or an address of this library\'s guest pictures; never external, never data:, at most 255', () => {
    const name = 'g-0123456789-abcdef0123.webp';
    const site = { origin: 'https://contoso.sharepoint.com' };
    assert.equal(guestPictureProblem('', site), '');
    assert.equal(guestPictureProblem(null, site), '');
    assert.equal(guestPictureProblem(`https://contoso.sharepoint.com/sites/pms/PMSClientImages/${name}`, site), '');
    assert.equal(guestPictureProblem(`/assets/images/clients/${name}`), '');
    assert.match(guestPictureProblem(`https://elsewhere.example/${name}`, site), /this site's picture library/);
    assert.match(guestPictureProblem(`data:image/png;base64,AAAA/${name}`, site), /this site's picture library/);
    assert.match(guestPictureProblem(`javascript:alert(1)//${name}`, site), /this site's picture library/);
    assert.match(guestPictureProblem('https://contoso.sharepoint.com/sites/pms/PMSClientImages/jane-doe.webp', site), /this site's picture library/);
    assert.match(guestPictureProblem(`https://contoso.sharepoint.com/${'x'.repeat(250)}/${name}`, site), /255 characters/);
  });
});

describe('the editor\'s rules', () => {
  it('the defaults are the sample\'s five, with ASSUMED directions, and each new list has ids of its own', () => {
    assert.deepEqual(DEFAULT_CRITERIA.map((each) => [each.label, each.direction]), [
      ['Strategic value', 'against'], ['Volume / repeatability', 'favours'], ['Standardisation', 'favours'], ['Compliance / risk', 'against'], ['Outsourcing suitability', 'favours'],
    ]);
    const [one, two] = [defaultCriteria(), defaultCriteria()];
    assert.equal(criteriaProblem(one), '');
    for (const criterion of one) assert.match(criterion.id, /^c-[0-9a-f]{6}$/);
    assert.notDeepEqual(one.map((each) => each.id), two.map((each) => each.id));
  });
  it('a criterion\'s id is never reused: after remove and add, the new one has an id that none before had', () => {
    const used = new Set(['c-000000']);
    const random = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1];
    const made = newCriterion(used, () => random.shift() / 16);
    assert.equal(made.id, 'c-111111');
    assert.ok(used.has('c-111111'), 'it is remembered, so removing it does not free it');
    assert.deepEqual([made.label, made.hint, made.direction], ['', '', 'favours']);
  });
  it('the instruction follows the number of criteria', () => {
    assert.equal(instructionFor(5), 'Rate each sub-process on five criteria');
    assert.equal(instructionFor(2), 'Rate each sub-process on two criteria');
  });
  it('the running line says rows and people', () => {
    assert.equal(rowsLine([{ label: 'A', people: '29' }, { label: 'B', people: '84' }, { label: ' ', people: '50' }]), '2 sub-processes, 113 people in scope');
    assert.equal(rowsLine([{ label: 'A', people: '1.5' }]), '1 sub-process, 1.5 people in scope');
  });
  it('editing with answers says what each edit does', () => {
    assert.equal(editingNotice(0), '');
    assert.equal(editingNotice(3), '3 guests have already rated. Renaming is safe. Removing a row hides its ratings from Results. Adding a row asks those guests for it again.');
    assert.match(editingNotice(1), /^1 guest has already rated\./);
  });
});

describe('Paste from a spreadsheet', () => {
  it('reads tabs, name then people, with a thousands comma, quotes and no people', () => {
    const parsed = parsePastedRows('Corp accounting – GL\t29\n"AP, AR"\t"1,200"\nOther finance\t\nNational admin\n');
    assert.deepEqual(parsed.rows, [{ label: 'Corp accounting – GL', people: '29' }, { label: 'AP, AR', people: '1200' }, { label: 'Other finance', people: '' }, { label: 'National admin', people: '' }]);
    assert.deepEqual([parsed.blanks, parsed.duplicates, parsed.problems, parsed.refused], [0, [], [], '']);
  });
  it('lists blanks and duplicates, against what is there and within the paste', () => {
    const parsed = parsePastedRows('A\t1\n\n  \nB\t2\na\t3\nExisting\t4\n', { existing: ['existing'] });
    assert.deepEqual(parsed.rows.map((row) => row.label), ['A', 'B']);
    assert.equal(parsed.blanks, 2);
    assert.deepEqual(parsed.duplicates, ['a', 'Existing']);
  });
  it('a row whose people cannot be read is listed and not added', () => {
    const parsed = parsePastedRows('A\tmany\nB\t2\n');
    assert.deepEqual(parsed.rows.map((row) => row.label), ['B']);
    assert.match(parsed.problems[0], /^A: /);
  });
  it('26 rows are refused at 25: nothing is added', () => {
    const text = Array.from({ length: 26 }, (_, at) => `Row ${at}\t1`).join('\n');
    assert.match(parsePastedRows(text).refused, /at most 25/);
    assert.equal(parsePastedRows(Array.from({ length: 24 }, (_, at) => `Row ${at}`).join('\n'), { existing: ['x', 'y'] }).refused, 'That would make 26 sub-processes: an activity can have at most 25.');
    assert.equal(parsePastedRows(Array.from({ length: 25 }, (_, at) => `Row ${at}`).join('\n')).refused, '');
  });
});

describe('the data layer asks the same rules, and sends nothing when they say no', () => {
  let ds; let fake;
  before(async () => {
    fake = createSharePointFake();
    fake.install();
    ds = await import(`../migration/src/lib/data/dataService.js?page=${Date.now()}`);
    ds.configure({ sharePoint: fake.settings });
  });
  after(() => fake.uninstall?.());
  const criteria = [ok(1), ok(2)];
  it('a question\'s criteria', async () => {
    fake.reset();
    await assert.rejects(ds.createQuestion({ id: 'q-a', sectionId: 's', type: 'art-of-the-possible', prompt: 'P', optionIds: [], order: 1, criteria: [ok(1)] }), { code: 'invalid-value', message: /at least 2 criteria/ });
    await assert.rejects(ds.updateQuestion('q-a', { criteria: [ok(1), { ...ok(2), direction: 'up' }] }), { code: 'invalid-value' });
    assert.equal(fake.writes().length, 0);
  });
  it('a question\'s number of rows, once it says them', async () => {
    fake.reset();
    await assert.rejects(ds.updateQuestion('q-a', { type: 'art-of-the-possible', optionIds: ['one'] }), { code: 'invalid-value', message: /at least 2 sub-processes/ });
    await assert.rejects(ds.updateQuestion('q-a', { type: 'art-of-the-possible', optionIds: Array.from({ length: 26 }, (_, at) => `o${at}`) }), { message: /at most 25/ });
    assert.equal(fake.writes().length, 0);
  });
  it('a row\'s fields are made by one call, which refuses bad people', () => {
    assert.deepEqual(ds.matrixRowFields({ label: ' GL ', people: '29' }), { label: 'GL', value: 29, correct: null });
    assert.deepEqual(ds.matrixRowFields({ label: 'GL', people: '' }), { label: 'GL', value: 0, correct: null });
    assert.throws(() => ds.matrixRowFields({ label: 'GL', people: '1.25' }), { code: 'invalid-value' });
    assert.throws(() => ds.matrixRowFields({ label: ' ', people: '1' }), { code: 'invalid-value' });
  });
  it('a guest\'s picture address', async () => {
    fake.reset();
    await assert.rejects(ds.createVisitor({ sessionId: 's', displayName: 'A', pictureUrl: 'https://elsewhere.example/g-0123456789-abcdef0123.webp' }), { code: 'invalid-value' });
    await assert.rejects(ds.updateVisitor('v', { pictureUrl: 'data:image/png;base64,AAAA' }), { code: 'invalid-value' });
    assert.equal(fake.writes().length, 0);
  });
  it('a stored answer of more than 6,000 characters is refused, and one of a plain question is as it was', async () => {
    const long = Array.from({ length: 200 }, (_, at) => `row-${at}-${'x'.repeat(40)}:c-aaaaaa=1`);
    await assert.rejects(ds.saveParticipantResponses({ trackId: 't', sessionId: 's', responses: [{ questionId: 'q', answer: long }] }), { code: 'answer-too-long', message: /too long/ });
  });
  it('a question that is not this type is written exactly as before', async () => {
    fake.reset();
    await ds.createQuestion({ id: 'q-plain', sectionId: 's', type: 'single-select', prompt: 'P', optionIds: [], order: 1 });
    assert.ok(!JSON.stringify(fake.writes().at(-1)).includes('Criteria'));
  });
});

describe('who may write it', () => {
  it('a role with content.edit may, and a role without it sends no request', async () => {
    const { writeGuard } = await import('../migration/src/lib/access/guard.js');
    const fake = createSharePointFake();
    fake.install();
    const ds = await import(`../migration/src/lib/data/dataService.js?page=guard${Date.now()}`);
    ds.configure({ sharePoint: fake.settings });
    const criteria = [ok(1), ok(2)];
    const question = (id) => ({ id, sectionId: 's', type: 'art-of-the-possible', prompt: 'P', optionIds: [], order: 1, criteria });
    const email = 'a@example.com';
    const access = (role) => ({ person: { key: email, email, name: email, loginName: email }, owner: false, legacy: false, user: { id: email, fullName: email, email, status: 'Active', source: 'Typed' },
      assignments: [{ id: role, userKey: email, role, scopeType: 'global', clientId: null, sessionId: null, periodFrom: null, periodTo: null, validUntil: null, extras: '', grantedBy: email }] });
    ds.setAccessGuard(writeGuard(access('Super admin'), ds.sharePointListTitles()));
    await ds.createQuestion(question('q-admin'));
    fake.reset();
    ds.setAccessGuard(writeGuard(access('Leadership'), ds.sharePointListTitles()));
    await assert.rejects(ds.createQuestion(question('q-no')), (error) => error.name === 'AccessDenied' || error.code === 'access-denied');
    assert.equal(fake.writes().length, 0, 'no request');
  });
});

describe('copying', () => {
  const sections = [{ id: 'sec', title: 'Art', order: 1, questionIds: ['q'], clientId: 'c-kroger' }];
  const criteria = [ok(1), ok(2)];
  const questions = [{ id: 'q', sectionId: 'sec', type: 'art-of-the-possible', prompt: 'Rate', optionIds: ['o1', 'o2'], order: 1, criteria }, { id: 'p', sectionId: 'sec', type: 'single-select', prompt: 'Poll', optionIds: [], order: 2 }];
  const options = [{ id: 'o1', questionId: 'q', label: 'GL', value: 29 }, { id: 'o2', questionId: 'q', label: 'AP', value: 28 }];
  let ds;
  before(async () => { ds = await import(`../migration/src/lib/data/dataService.js?page=${Date.now() + 1}`); });
  it('to another client: the criteria and the rows travel, and the plan says whose list it is', () => {
    const plan = ds.planCopy({ sections, questions, options, toClientId: 'c-dominos', fromClientName: 'Kroger', toClientName: 'Domino\'s' });
    const [copy] = plan.items[0].questions;
    assert.deepEqual(copy.criteria, criteria);
    assert.deepEqual(plan.items[0].options.map((option) => [option.label, option.value]), [['GL', 29], ['AP', 28]]);
    assert.deepEqual(plan.notices, ['This list is Kroger\'s. Replace the sub-processes before using it for Domino\'s.']);
    assert.equal(copy.layout, `${COPIED_FROM}Kroger`);
    assert.equal(copiedFrom(copy), 'Kroger');
  });
  it('a duplicate in the same client carries no warning', () => {
    const plan = ds.planCopy({ sections, questions, options, toClientId: 'c-kroger', ids: 'random', retitle: true, fromClientName: 'Kroger', toClientName: 'Kroger', makeId: (() => { let at = 0; return () => `n${at += 1}`; })() });
    assert.deepEqual(plan.notices, []);
    assert.equal(plan.items[0].questions[0].layout, undefined);
    assert.deepEqual(plan.items[0].questions[0].criteria, criteria);
  });
  it('a plan with no such question has no notices, and a plain question carries no criteria', () => {
    const plain = ds.planCopy({ sections: [{ ...sections[0], questionIds: ['p'] }], questions, options: [], toClientId: 'c-dominos' });
    assert.deepEqual(plain.notices, []);
    assert.equal('criteria' in plain.items[0].questions[0], false);
  });
  it('a copied question\'s flag is not a layout', () => {
    assert.equal(copiedFrom({ layout: 'image-grid' }), '');
    assert.equal(copiedFrom({ layout: null }), '');
  });
});
