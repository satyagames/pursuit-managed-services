// Phase 10b: with an empty list prefix the data layer must send the requests it sent before the list namespace existed.
// Run: node --test scripts/test-request-baseline.js (part of `npm test`), or `node scripts/request-baseline.js` to read the differences.
//
// What this covers: every request (method, address without host, and the reads inside each `$batch`) that ten node suites send to a
// mocked SharePoint: the legacy functions on their own stubs (test-sharepoint.js) and nine suites on scripts/sharepoint-fake.js. The
// browser side is scripts/migration-tests/request-baseline.spec.ts (the participant page's start-up).
// What it does not cover: the order of requests, request bodies and headers other than the method, anything a suite does not exercise,
// and the real tenant, which none of this has met.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';
import { LIBRARY, LISTS } from '../public/js/pms-schema.js';
import { BASELINE_DIR, NODE_SUITES, amendBaseline, amendment, combine, differences, explain, linesOf, normalise, parse, readBaseline, recordSuite, render, tally, tallyByTest } from './request-baseline.js';

const ROOT = path.join(import.meta.dirname, '..');
const run = promisify(execFile);

describe('the mocked suites send the requests they sent before Phase 10b', () => {
  // Recorded side by side: each suite is its own process, with its own mock.
  const recordings = new Map(NODE_SUITES.map((name) => [name, recordSuite(name)]));
  for (const name of NODE_SUITES) {
    it(`scripts/${name}.js: every request is in the baseline, as many times`, async () => {
      const found = differences(await readBaseline(name), await recordings.get(name));
      assert.deepEqual(found, [], `${found.length} difference(s) from scripts/request-baseline/${name}.txt:\n\n${found.join('\n\n')}\n`);
    });
  }

  it('every baseline file belongs to a suite that is still recorded (the browser ones are the spec\'s)', async () => {
    const files = (await readdir(BASELINE_DIR)).filter((file) => file.endsWith('.txt')).map((file) => file.slice(0, -4));
    const strays = files.filter((file) => !NODE_SUITES.includes(file) && !/^browser-participant-start\.(chromium|webkit|firefox)$/.test(file));
    assert.deepEqual(strays, []);
    for (const name of NODE_SUITES) assert.ok(files.includes(name), `no baseline for ${name}`);
  });

  it('the baselines reach all twelve lists and the picture library, under the titles of the schema file', async () => {
    const titles = new Set();
    for (const name of NODE_SUITES) {
      for (const entry of (await readBaseline(name)).keys()) for (const [, title] of entry.matchAll(/getbytitle\('([^']+)'\)/g)) titles.add(title);
    }
    for (const title of [...Object.values(LISTS).map((list) => list.title), LIBRARY]) {
      assert.ok(titles.has(title), `${title} is in no baseline`);
    }
  });
});

describe('the comparison can fail', () => {
  const recording = [
    "GET /sites/cec/_api/web/lists/getbytitle('Clients')/items?$top=200",
    "GET /sites/cec/_api/web/lists/getbytitle('Clients')/items?$top=200",
    'POST /sites/cec/_api/$batch',
    "    carries GET /sites/cec/_api/web/lists/getbytitle('Sessions')/items?$filter=AppId%20eq%20%27a%27&$top=2",
    "    carries GET /sites/cec/_api/web/lists/getbytitle('Tracks')/items?$filter=AppId%20eq%20%2700000000-0000-4000-8000-000000000001%27&$top=2",
    "POST /sites/cec/_api/web/lists/getbytitle('Tracks')/items",
    '',
  ].join('\n');
  const baseline = () => combine([tally(recording)]);

  it('a recording equals itself, through the file format and back', () => {
    const text = render('a test', baseline());
    assert.deepEqual(differences(parse(text), tally(recording)), []);
    assert.equal(render('a test', parse(text)), text);
    assert.equal(parse(text).size, 3);
  });

  it('a list reached under another title is two differences: one address gone, one that is new', () => {
    const moved = recording.replace("getbytitle('Tracks')/items\n", "getbytitle('PMS3Tracks')/items\n");
    const found = differences(baseline(), tally(moved));
    assert.equal(found.length, 2);
    assert.match(found[0], /^No longer sent \(the baseline has it 1 x\):\nPOST .*getbytitle\('Tracks'\)\/items$/);
    assert.match(found[1], /^Not in the baseline \(sent 1 x\):\nPOST .*getbytitle\('PMS3Tracks'\)\/items$/);
  });

  it('a read inside a batch that changes is a difference, and so is a request sent once more or once less', () => {
    assert.equal(differences(baseline(), tally(recording.replace("getbytitle('Sessions')", "getbytitle('PMS3Sessions')"))).length, 2);
    const once = differences(baseline(), tally(recording.replace(/^GET .*\n/, '')));
    assert.deepEqual(once.map((line) => line.split('\n')[0]), ['Sent 1 x, the baseline has 2 x:']);
    assert.deepEqual(differences(baseline(), tally(`${recording}GET /sites/cec/_api/web/currentuser?$select=Id,Title\n`)).map((line) => line.split('\n')[0]), ['Not in the baseline (sent 1 x):']);
  });

  it('a count that differed between the recordings a baseline was made from is not held, but its address still is', () => {
    const more = `${recording}POST /sites/cec/_api/web/lists/getbytitle('Tracks')/items\n`;
    const loose = combine([tally(recording), tally(more)]);
    assert.deepEqual([...loose].filter(([, { loose: marked }]) => marked).map(([entry]) => entry), ["POST /sites/cec/_api/web/lists/getbytitle('Tracks')/items"]);
    assert.match(render('a test', loose), /^~2 x POST .*getbytitle\('Tracks'\)\/items$/m);
    assert.deepEqual(differences(loose, tally(recording)), []);
    assert.deepEqual(differences(loose, tally(`${more}${more}`.replaceAll(/^GET .*\n/gm, '')) ).map((line) => line.split('\n')[0]), ['No longer sent (the baseline has it 2 x):', 'Sent 2 x, the baseline has 1 x:']);
  });

  it('only a UUID and an instant are written as placeholders: an id, a date and a list title stay as they are', () => {
    const line = "GET /x/_api/web/lists/getbytitle('Tracks')/items?$filter=(SessionId eq 'kroger-2026-10-11') and (AppId eq '3f2b8c1e-9a4d-4e21-b7c6-0d5e8f1a2b3c') and (CreatedAt eq '2026-10-11T09:30:00.000Z')";
    assert.equal(normalise(line), "GET /x/_api/web/lists/getbytitle('Tracks')/items?$filter=(SessionId eq 'kroger-2026-10-11') and (AppId eq '<uuid>') and (CreatedAt eq '<time>')");
  });

  it('a request of the fake\'s own log becomes the same lines the recorder writes', () => {
    const entry = {
      method: 'POST', url: 'https://tenant.example/sites/cec/_api/$batch',
      parts: [{ method: 'GET', url: "https://tenant.example/sites/cec/_api/web/lists/getbytitle('Sessions')/items?$filter=AppId%20eq%20%27a%27&$top=2" }],
    };
    assert.equal(linesOf(entry), "POST /sites/cec/_api/$batch\n    carries GET /sites/cec/_api/web/lists/getbytitle('Sessions')/items?$filter=AppId%20eq%20%27a%27&$top=2");
    assert.equal(linesOf({ method: 'MERGE', url: "https://tenant.example/sites/cec/_api/web/lists/getbytitle('QRTokens')/items(7)" }), "MERGE /sites/cec/_api/web/lists/getbytitle('QRTokens')/items(7)");
  });
});

// Phase 10c-1: a test that is removed takes its requests with it, and the baseline has to follow those requests and no others.
describe('a baseline is amended for the tests that were named, and for nothing else', () => {
  const CLIENTS = "GET /sites/cec/_api/web/lists/getbytitle('Clients')/items?$top=200";
  const TRACK = "POST /sites/cec/_api/web/lists/getbytitle('Tracks')/items";
  const POLL = "GET /sites/cec/_api/web/lists/getbytitle('AppSettings')/items?$top=200";
  const BATCH = "POST /sites/cec/_api/$batch\n    carries GET /sites/cec/_api/web/lists/getbytitle('Sections')/items?$top=200";
  // The suite sends CLIENTS three times and TRACK once; POLL depends on timing. The named test sends one CLIENTS and the TRACK.
  const baseline = () => new Map([[CLIENTS, { count: 3, loose: false }], [TRACK, { count: 1, loose: false }], [POLL, { count: 2, loose: true }]]);
  const whole = () => new Map([[CLIENTS, 3], [TRACK, 1], [POLL, 2]]);
  const rest = () => new Map([[CLIENTS, 2], [POLL, 2]]);

  it('a removed test: its requests are lowered or dropped, each is said with the old count and the new, and no other entry moves', () => {
    const found = amendment(baseline(), { headFull: whole(), headKept: rest(), nowKept: rest(), nowFull: [rest(), rest()] });
    assert.deepEqual(found.problems, []);
    assert.deepEqual([...found.next], [[CLIENTS, { count: 2, loose: false }], [POLL, { count: 2, loose: true }]]);
    assert.deepEqual(found.changes, [`3 x -> 2 x:\n${CLIENTS}`, `dropped (was 1 x):\n${TRACK}`]);
  });

  it('a test changed on purpose: what it sends now replaces what it sent, and a request that is new is said to be new', () => {
    const now = new Map([...rest(), [BATCH, 4]]);
    const found = amendment(baseline(), { headFull: whole(), headKept: rest(), nowKept: rest(), nowFull: [now, now] });
    assert.deepEqual(found.problems, []);
    assert.deepEqual(found.changes, [`3 x -> 2 x:\n${CLIENTS}`, `dropped (was 1 x):\n${TRACK}`, `new (4 x):\n${BATCH}`]);
    assert.deepEqual(found.next.get(BATCH), { count: 4, loose: false });
  });

  it('is refused when the CODE changed what the suite sends: the last commit\'s suite, run today, is not the baseline', () => {
    const drifted = new Map([[CLIENTS, 2], [TRACK, 1], [POLL, 2]]);
    const before = baseline();
    const found = amendment(before, { headFull: drifted, headKept: rest(), nowKept: rest(), nowFull: [rest()] });
    assert.deepEqual(found.problems.map((problem) => problem.split('\n')[0]), ['Before any test was changed, the suite does not send what its baseline holds. Sent 2 x, the baseline has 3 x:']);
    assert.deepEqual(found.changes, []);
    assert.equal(found.next, before, 'and nothing is offered to be written');
  });

  it('is refused when a test that was NOT named sends something else, more or less often or to a new address', () => {
    const nowKept = new Map([[CLIENTS, 1], [POLL, 2], [BATCH, 1]]);
    const found = amendment(baseline(), { headFull: whole(), headKept: rest(), nowKept, nowFull: [nowKept] });
    assert.deepEqual(found.problems.map((problem) => problem.split('\n')[0]).sort(), [
      'A test that was not named sends something else (0 x before, 1 x now):',
      'A test that was not named sends something else (2 x before, 1 x now):',
    ]);
    assert.deepEqual(found.changes, []);
  });

  it('a count that depends on timing is left exactly as it was, however often a recording saw it; it goes only when the named tests alone sent it', () => {
    // One recording saw the poll once, one not at all, one five times: the entry is as it was, and is not called a change.
    const once = new Map([[CLIENTS, 3], [TRACK, 1], [POLL, 1]]);
    const never = new Map([[CLIENTS, 3], [TRACK, 1]]);
    const often = new Map([[CLIENTS, 3], [TRACK, 1], [POLL, 5]]);
    let found = amendment(baseline(), { headFull: whole(), headKept: once, nowKept: never, nowFull: [once, never, often] });
    assert.deepEqual(found.problems, [], 'its count is not compared, here as in every comparison');
    assert.deepEqual(found.changes, []);
    assert.deepEqual(found.next.get(POLL), { count: 2, loose: true });
    // No recording sent it, but the last commit's suite sends it without the named tests: timing, so it stays.
    found = amendment(baseline(), { headFull: whole(), headKept: once, nowKept: never, nowFull: [never] });
    assert.deepEqual(found.next.get(POLL), { count: 2, loose: true });
    assert.deepEqual(found.changes, []);
    // Without the named tests nobody sends it, before or now: it was theirs, and it goes, said like any other.
    found = amendment(baseline(), { headFull: whole(), headKept: never, nowKept: never, nowFull: [never] });
    assert.deepEqual(found.changes, [`dropped (was ~2 x):\n${POLL}`]);
  });

  it('with nothing to follow it changes nothing, and it is only for a suite that has a baseline and for tests that are named', async () => {
    const found = amendment(baseline(), { headFull: whole(), headKept: whole(), nowKept: whole(), nowFull: [whole()] });
    assert.deepEqual([found.problems, found.changes], [[], []]);
    assert.deepEqual([...found.next], [...baseline()]);
    await assert.rejects(amendBaseline('test-oracle', 'anything'), /is not a recorded suite/);
    await assert.rejects(amendBaseline(NODE_SUITES[0], ''), /Name the tests/);
  });
});

// Phase 10c-2a: a change in the code that is MEANT to change what some tests send (a read that is no longer made, a filter that lost a
// term) is followed by the same two rules, with the "before" recorded on the last commit's whole tree (`--amend ... --code`); and
// `--explain` says which test each difference belongs to. amendment() itself is not changed, and the tests above are its tests.
describe('an amendment that follows a change in the code, and the explanation test by test', () => {
  const LIST = (title) => `GET /sites/cec/_api/web/lists/getbytitle('${title}')/items`;
  const USER = 'GET /sites/cec/_api/web/currentuser';

  /** A tree with one small suite in it, whose first test asks for a list named by that tree's own code. */
  async function copyOfTheTree(title) {
    const copy = await mkdtemp(path.join(os.tmpdir(), 'pms-copy-'));
    await mkdir(path.join(copy, 'scripts'));
    await mkdir(path.join(copy, 'lib'));
    await writeFile(path.join(copy, 'lib', 'where.js'), `export const TITLE = '${title}';\n`);
    await writeFile(path.join(copy, 'scripts', 'test-probe.js'), `
      import { describe, it, test } from 'node:test';
      import { TITLE } from '../lib/where.js';
      globalThis.fetch = async () => new Response('{}');
      const ask = (rest) => fetch('https://tenant.example/sites/cec/_api/web/' + rest);
      test('the list', async () => { await ask("lists/getbytitle('" + TITLE + "')/items"); });
      describe('who', () => { it('is signed in', async () => { await ask('currentuser'); await ask('currentuser'); }); });
    `);
    return copy;
  }

  it('"before" is recorded in another copy of the tree: that copy\'s suite, run with that copy\'s code', async () => {
    const copy = await copyOfTheTree('OlderTitle');
    try {
      const whole = await recordSuite('test-probe', {}, { root: copy });
      assert.deepEqual([...whole].sort(), [[LIST('OlderTitle'), 1], [USER, 2]].sort());
      assert.deepEqual([...(await recordSuite('test-probe', {}, { root: copy, skip: 'is signed in' })).keys()], [LIST('OlderTitle')], 'and a named test can be left out there too');
    } finally {
      await rm(copy, { recursive: true, force: true });
    }
  });

  it('a recording can say which test sent each request, by the name node gives it, without changing what is recorded', async () => {
    const copy = await copyOfTheTree('Clients');
    try {
      const plain = await recordSuite('test-probe', {}, { root: copy });
      const { tally: counted, tests } = await recordSuite('test-probe', {}, { root: copy, byTest: true });
      assert.deepEqual([...counted].sort(), [...plain].sort());
      assert.deepEqual([...tests].map(([name, entries]) => [name, [...entries]]), [['the list', [[LIST('Clients'), 1]]], ['who > is signed in', [[USER, 2]]]]);
    } finally {
      await rm(copy, { recursive: true, force: true });
    }
  });

  it('the by-test file is read with the same two placeholders as every recording', () => {
    const line = (test, entry) => JSON.stringify({ test, entry });
    const id = ['3f2b8c1e', '9a4d', '4e21', 'b7c6', '0d5e8f1a2b3c'].join('-');
    const tests = tallyByTest([line('a', `${LIST('Tracks')}?$filter=AppId eq '${id}'`), line('a', `${LIST('Tracks')}?$filter=AppId eq '${id.replace('3f', '4a')}'`), line('b', USER), ''].join('\n'));
    assert.deepEqual([...tests].map(([name, entries]) => [name, [...entries]]), [['a', [[`${LIST('Tracks')}?$filter=AppId eq '<uuid>'`, 2]]], ['b', [[USER, 1]]]]);
  });

  it('explain(): each test whose requests differ, entry by entry with the count before and now; a test on one side only is said to be removed or new', () => {
    const [A, B, C] = [LIST('Clients'), LIST('Responses'), USER];
    const before = new Map([['kept', new Map([[A, 2], [B, 1]])], ['same', new Map([[A, 1]])], ['removed', new Map([[C, 3]])]]);
    const after = new Map([['kept', new Map([[A, 1], [C, 1]])], ['same', new Map([[A, 1]])], ['added', new Map([[B, 2]])]]);
    assert.deepEqual(explain(before, after), [
      // (A test's entries are in the order of their text: that is the order of a baseline file.)
      { test: 'kept', gone: false, fresh: false, changes: [{ entry: C, before: 0, after: 1 }, { entry: A, before: 2, after: 1 }, { entry: B, before: 1, after: 0 }] },
      { test: 'removed', gone: true, fresh: false, changes: [{ entry: C, before: 3, after: 0 }] },
      { test: 'added', gone: false, fresh: true, changes: [{ entry: B, before: 0, after: 2 }] },
    ]);
    assert.deepEqual(explain(before, before), [], 'nothing differs: nothing is said');
  });

  it('the same two rules decide it: a test that was not named and sends something else since the last commit stops it', () => {
    // What amendBaseline hands over with `code`: the head recordings are the last commit's TREE. Its code sent B once in a test that is
    // not named; today's code no longer does. That is a change nobody named, and nothing is written.
    const [A, B] = [LIST('Clients'), LIST('Responses')];
    const baseline = new Map([[A, { count: 2, loose: false }], [B, { count: 2, loose: false }]]);
    const found = amendment(baseline, { headFull: new Map([[A, 2], [B, 2]]), headKept: new Map([[A, 1], [B, 1]]), nowKept: new Map([[A, 1]]), nowFull: [new Map([[A, 2]])] });
    assert.deepEqual(found.problems.map((problem) => problem.split('\n')[0]), ['A test that was not named sends something else (1 x before, 0 x now):']);
    // Named, it is followed, and said: B is dropped, with its old count.
    const named = amendment(baseline, { headFull: new Map([[A, 2], [B, 2]]), headKept: new Map([[A, 1]]), nowKept: new Map([[A, 1]]), nowFull: [new Map([[A, 2]])] });
    assert.deepEqual([named.problems, named.changes], [[], [`dropped (was 2 x):\n${B}`]]);
  });
});

describe('the recorder only records', () => {
  const script = `
    const seen = [];
    const first = async (url, options) => { seen.push(['first', url, options.method ?? 'GET']); return new Response('{}'); };
    const real = globalThis.fetch;
    globalThis.fetch = first;
    console.log(JSON.stringify({ same: globalThis.fetch === globalThis.fetch }));
    const fallback = globalThis.fetch;
    globalThis.fetch = async (url, options) => { seen.push(['second', url]); return fallback(url, options); };
    const reply = await fetch('https://tenant.example/sites/cec/_api/web/lists/getbytitle(\\'Clients\\')/items(3)', { method: 'POST', headers: { 'X-HTTP-Method': 'MERGE' } });
    await fetch('http://localhost:1/api/clients', {});
    await fetch('https://tenant.example/sites/cec/_api/$batch', { method: 'POST', body: '--b\\r\\nContent-Type: application/http\\r\\n\\r\\nGET https://tenant.example/sites/cec/_api/web/currentuser HTTP/1.1\\r\\nAccept: application/json\\r\\n\\r\\n--b--\\r\\n' });
    globalThis.fetch = real;
    console.log(JSON.stringify({ seen, text: await reply.text(), restored: globalThis.fetch === real }));
  `;

  it('notes each request once (a stub that hands on to the one before it included), changes no answer, and leaves the local server out', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pms-recorder-'));
    try {
      const file = path.join(dir, 'requests.txt');
      await writeFile(path.join(dir, 'probe.mjs'), script);
      const { NODE_TEST_CONTEXT: _runner, ...env } = process.env;
      const { stdout } = await run(process.execPath, ['--import', new URL('./request-recorder.js', import.meta.url).href, path.join(dir, 'probe.mjs')], { cwd: ROOT, env: { ...env, PMS_RECORD_REQUESTS: file } });
      const [identity, outcome] = stdout.trim().split('\n').map((line) => JSON.parse(line));
      assert.equal(identity.same, true, 'reading fetch twice gives the same function');
      assert.equal(outcome.text, '{}');
      assert.equal(outcome.restored, true);
      assert.deepEqual(outcome.seen.map(([who]) => who), ['second', 'first', 'second', 'first', 'second', 'first'], 'both stubs still ran, in order, for all three requests');
      assert.equal(await readFile(file, 'utf8'), [
        "MERGE /sites/cec/_api/web/lists/getbytitle('Clients')/items(3)",
        'POST /sites/cec/_api/$batch',
        '    carries GET /sites/cec/_api/web/currentuser',
        '',
      ].join('\n'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does nothing at all without PMS_RECORD_REQUESTS: fetch stays the plain property it was', async () => {
    const { NODE_TEST_CONTEXT: _runner, PMS_RECORD_REQUESTS: _file, ...env } = process.env;
    const { stdout } = await run(process.execPath, ['--import', new URL('./request-recorder.js', import.meta.url).href, '-e',
      "console.log(JSON.stringify('value' in Object.getOwnPropertyDescriptor(globalThis, 'fetch')))"], { cwd: ROOT, env });
    assert.equal(stdout.trim(), 'true');
  });
});
