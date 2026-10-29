// Phase 10b: which site and which lists a copy of the app uses, as plain cases.
// Run: node --test scripts/test-deploy-settings.js (part of `npm test`).
//
// The resolver (migration/src/lib/settings/deploy-settings.js) is one pure function, so everything here is a row: what the page's address,
// the settings file and the values built into the page are, and what must come out. Nothing here has met a real SharePoint site.
//
// Three files, on purpose. deploy-settings.js is in every page, and every page has a size to keep to, so it only DECIDES: each rule
// answers yes or no, and a problem is a code and a place ({ id: 'PMS-CFG-002', kind: 'invalid', at: 'lists.qrtokens' }).
// deploy-problems.js puts a problem into its six parts, and deploy-rules.js says which rule was broken; only Setup and the build
// load those two. Every row below is put to all three, and a row on which the deciding file and the wording disagree, or name
// different places, fails.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import * as ds from '../migration/src/lib/data/dataService.js';
import { isLocalAddress } from '../migration/src/lib/settings/address-check.js';
import { PROBLEM_IDS, PUBLISHER, problem } from '../migration/src/lib/settings/deploy-problems.js';
import { settingsProblem, siteUrlProblem, spelledOut } from '../migration/src/lib/settings/deploy-rules.js';
import { SETTINGS_FILE, listTitles, resolveSettings, siteOf, wrongSetting } from '../migration/src/lib/settings/deploy-settings.js';
import { TITLE } from './sharepoint-fake.js';

const ROOT = path.join(import.meta.dirname, '..');
const SITE = 'https://americas.internal.deloitteonline.com/sites/CreativeExpCOE';
const PAGE = `${SITE}/Shared%20Documents/p_cec_03/index.html`;
const FILE_ADDRESS = `${SITE}/Shared%20Documents/p_cec_03/pms-config.txt`;
const resolve = (input) => resolveSettings({ pageUrl: PAGE, ...input });
/** The one problem of a result, as the resolver coded it. */
const only = (result) => {
  assert.equal(result.problems.length, 1, JSON.stringify(result.problems));
  assert.equal(result.settings, null, 'a problem leaves no settings to configure the data layer with');
  return result.problems[0];
};
/** The same problem in its six parts, as Setup makes them from what the page started from. */
const sixParts = (result, input = {}) => problem(only(result), { pageUrl: input.pageUrl ?? PAGE, file: input.file, known: result.known, sources: result.sources });
/** The usual title of each list, by key, and of the picture library: the data layer's own. */
const USUAL = ds.sharePointListTitles({});
const LIST_KEYS = Object.keys(USUAL).filter((key) => key !== 'logoLibrary');
/** Where a sentence of lib/settings/deploy-rules.js says the settings are wrong: the setting it quotes first, '*' for "not an object". */
const placeIn = (sentence) => /^"([^"]+)"/.exec(sentence)?.[1] ?? '*';
const long = (length) => 'x'.repeat(length);

describe('where the page is decides whether it talks to SharePoint at all', () => {
  const local = ['http://localhost:3000/index.html', 'http://192.168.1.20:3000/p_cec_02/index.html', 'http://127.0.0.1:5188/p_cec_02/admin.html',
    'https://localhost:8443/index.html', 'https://127.0.0.1:8443/index.html', 'https://[::1]:8443/index.html', 'https://app.localhost/setup.html', 'http://tenant.example/sites/x/index.html'];
  const sharePoint = [PAGE, 'https://tenant.example/index.html', 'https://localhost.example.com/sites/a/b/index.html', 'https://192.168.1.20/sites/a/b/index.html'];

  it('http, and this computer by any of its names, are the local server: no prefix is needed and nothing built in is used', () => {
    for (const pageUrl of local) {
      assert.equal(isLocalAddress(new URL(pageUrl)), true, pageUrl);
      assert.deepEqual(resolveSettings({ pageUrl, file: { listPrefix: 'PMS3' }, built: { siteUrl: SITE, listPrefix: 'X' } }), { settings: null, sources: {}, problems: [] }, pageUrl);
      assert.deepEqual(resolveSettings({ pageUrl }), { settings: null, sources: {}, problems: [] }, 'with nothing at all it is the same: no problem');
    }
  });

  it('any other https address is SharePoint: with nothing naming its lists it is a problem, never the local server', () => {
    for (const pageUrl of sharePoint) {
      assert.equal(isLocalAddress(new URL(pageUrl)), false, pageUrl);
      assert.notEqual(resolveSettings({ pageUrl, file: { listPrefix: '' } }).settings, null, pageUrl);
      assert.equal(resolveSettings({ pageUrl }).problems[0].id, 'PMS-CFG-001', pageUrl);
    }
  });
});

describe('the site comes from the settings, or from the page\'s own address', () => {
  const derived = [
    [PAGE, SITE],
    [`${SITE}/Shared%20Documents/p_cec_03/admin.html?x=1#today`, SITE],
    ['https://tenant.example/teams/Pursuits/Docs/app/index.html', 'https://tenant.example/teams/Pursuits'],
    ['https://tenant.example/SITES/Mixed/Docs/index.html', 'https://tenant.example/SITES/Mixed'],
    ['https://tenant.example/Shared%20Documents/app/index.html', 'https://tenant.example'],
    ['https://tenant.example/index.html', 'https://tenant.example'],
    ['https://tenant.example:8443/sites/a/lib/index.html', 'https://tenant.example:8443/sites/a'],
    // Not enough of an address to hold a site and a page: the host's own site.
    ['https://tenant.example/sites/index.html', 'https://tenant.example'],
    ['https://tenant.example/personal/someone/Documents/index.html', 'https://tenant.example'],
  ];
  for (const [pageUrl, site] of derived) {
    it(`${pageUrl} is on ${site}`, () => {
      assert.equal(siteOf(new URL(pageUrl)), site);
      const result = resolveSettings({ pageUrl, file: { listPrefix: '' } });
      assert.deepEqual(result.problems, []);
      assert.equal(result.settings.siteUrl, site);
      assert.equal(result.sources.siteUrl, 'derived');
    });
  }

  it('a site that is spelled out wins over the address, when the page really is inside it', () => {
    const sub = `${SITE}/pursuits`;
    const pageUrl = `${sub}/Shared%20Documents/app/index.html`;
    assert.equal(resolveSettings({ pageUrl, file: { listPrefix: '' } }).settings.siteUrl, SITE, 'derived: a sub-site cannot be told from a library');
    const fromFile = resolveSettings({ pageUrl, file: { listPrefix: '', siteUrl: sub } });
    assert.equal(fromFile.settings.siteUrl, sub);
    assert.equal(fromFile.sources.siteUrl, 'file');
    const builtIn = resolveSettings({ pageUrl, file: { listPrefix: '' }, built: { siteUrl: sub } });
    assert.equal(builtIn.settings.siteUrl, sub);
    assert.equal(builtIn.sources.siteUrl, 'built in');
  });

  it('upper and lower case, and %20 or a space, are the same address to SharePoint', () => {
    for (const siteUrl of ['https://tenant.example/sites/CreativeExpCOE', 'https://TENANT.example/SITES/creativeexpcoe', 'https://tenant.example']) {
      const result = resolveSettings({ pageUrl: 'https://tenant.example/sites/creativeexpcoe/Shared Documents/x/index.html', file: { listPrefix: '', siteUrl } });
      assert.deepEqual(result.problems, [], siteUrl);
      assert.equal(result.settings.siteUrl, siteUrl);
    }
    const spaced = resolveSettings({ pageUrl: 'https://tenant.example/sites/My%20Site/Docs/index.html', file: { listPrefix: '', siteUrl: 'https://tenant.example/sites/My Site' } });
    assert.deepEqual(spaced.problems, []);
  });

  const elsewhere = [
    ['another host', 'https://other.example/sites/CreativeExpCOE'],
    ['another site on this host', 'https://americas.internal.deloitteonline.com/sites/OtherSite'],
    ['a site whose name only starts the same', 'https://americas.internal.deloitteonline.com/sites/Creative'],
    ['a site below the page', `${SITE}/Shared%20Documents/p_cec_03/deeper`],
    ['another port', 'https://americas.internal.deloitteonline.com:8443/sites/CreativeExpCOE'],
  ];
  for (const [what, siteUrl] of elsewhere) {
    it(`${what} is PMS-CFG-004, from the file or built in, and gives no settings`, () => {
      for (const input of [{ file: { listPrefix: 'PMS3', siteUrl } }, { file: { listPrefix: 'PMS3' }, built: { siteUrl } }]) {
        const result = resolve(input);
        assert.deepEqual(only(result), { id: 'PMS-CFG-004' });
        assert.equal(sixParts(result, input).technical, `PMS-CFG-004, opened from ${PAGE}, siteUrl ${siteUrl} (${input.built ? 'built in' : 'pms-config.txt'})`);
      }
    });
  }
});

describe('the order: the file, then what is built in, then what can be derived, then nothing', () => {
  const file = { siteUrl: SITE, listPrefix: 'FILE', lists: { qrtokens: 'GuestCodes' }, logoLibrary: 'FilePictures', batch: false, support: { name: 'File Person', contact: 'file@example.com' }, label: 'From the file' };
  const built = { siteUrl: SITE, listPrefix: 'BUILT', logoLibrary: 'BuiltPictures', batch: false, support: { name: 'Built Person', contact: 'https://example.com/help' }, label: 'Built in' };

  it('the file wins for every setting it gives', () => {
    const result = resolve({ file, built });
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.settings, { configVersion: 1, ...file });
    assert.deepEqual(result.sources, { siteUrl: 'file', listPrefix: 'file', lists: 'file', logoLibrary: 'file', batch: 'file', support: 'file', label: 'file' });
  });

  it('what is built in is used for each setting the file leaves out, one setting at a time', () => {
    const result = resolve({ file: { label: 'Only a label', batch: true }, built });
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.settings, { configVersion: 1, ...built, batch: true, label: 'Only a label' });
    assert.deepEqual(result.sources, { siteUrl: 'built in', listPrefix: 'built in', logoLibrary: 'built in', batch: 'file', support: 'built in', label: 'file' });
  });

  it('with no file at all the built-in values stand alone', () => {
    const result = resolve({ built });
    assert.deepEqual(result.settings, { configVersion: 1, ...built });
    assert.deepEqual(result.sources, { siteUrl: 'built in', listPrefix: 'built in', logoLibrary: 'built in', batch: 'built in', support: 'built in', label: 'built in' });
  });

  it('with only a prefix: the site is derived, the picture library and grouped reads take their defaults, and there is no support or label', () => {
    const result = resolve({ file: { listPrefix: 'PMS3' } });
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.settings, { configVersion: 1, siteUrl: SITE, listPrefix: 'PMS3', logoLibrary: `PMS3${TITLE.logoLibrary}`, batch: true });
    assert.deepEqual(result.sources, { siteUrl: 'derived', listPrefix: 'file', logoLibrary: 'default', batch: 'default' });
    assert.deepEqual(result.known, { siteUrl: SITE, listPrefix: 'PMS3', logoLibrary: `PMS3${TITLE.logoLibrary}`, batch: true });
  });

  it('an explicit empty prefix counts, from the file or built in, and the picture library is then ClientLogos', () => {
    for (const input of [{ file: { listPrefix: '' } }, { built: { listPrefix: '' } }, { file: {}, built: { listPrefix: '' } }]) {
      const result = resolve(input);
      assert.deepEqual(result.problems, [], JSON.stringify(input));
      assert.equal(result.settings.listPrefix, '');
      assert.equal(result.settings.logoLibrary, TITLE.logoLibrary);
    }
    assert.equal(resolve({ file: { listPrefix: '' }, built: { listPrefix: 'BUILT' } }).settings.listPrefix, '', 'the file\'s empty prefix beats a built-in one');
  });

  it('"configVersion": 1 in the file is accepted and is not one of the settings that have a source', () => {
    const result = resolve({ file: { configVersion: 1, listPrefix: 'PMS3' } });
    assert.equal(result.settings.configVersion, 1);
    assert.equal('configVersion' in result.sources, false);
  });
});

describe('PMS-CFG-001: no prefix anywhere is a problem, never a guess', () => {
  const none = [
    ['no file and nothing built in', {}, /pms-config\.txt was not found/],
    ['a file without one', { file: { label: 'Folder 3' } }, /pms-config\.txt has none/],
    ['a file without one, and other values built in', { file: {}, built: { siteUrl: SITE, batch: false, label: 'x' } }, /pms-config\.txt has none/],
    ['an empty object built in', { built: {} }, /was not found/],
  ];
  for (const [what, input, technical] of none) {
    it(what, () => {
      const result = resolve(input);
      assert.deepEqual(only(result), { id: 'PMS-CFG-001' });
      const parts = sixParts(result, input);
      assert.match(parts.technical, technical);
      assert.ok(parts.technical.startsWith('PMS-CFG-001, no listPrefix: ') && parts.technical.endsWith(`and none is built in, opened from ${PAGE}`), parts.technical);
    });
  }

  it('says what is known all the same, for Setup to show: the site, and that nothing names the lists', () => {
    const result = resolve({ file: { label: 'Folder 3' } });
    assert.deepEqual(result.known, { siteUrl: SITE, batch: true, label: 'Folder 3' });
    assert.deepEqual(result.sources, { siteUrl: 'derived', batch: 'default', label: 'file' });
  });
});

describe('PMS-CFG-002: a settings file that is there and wrong stops the page, naming the first thing wrong', () => {
  const invalid = [
    // The file as a whole
    [null, /must be one JSON object/], [[], /must be one JSON object/], ['PMS3', /must be one JSON object/], [7, /must be one JSON object/],
    // A typo must never be ignored
    [{ listPrefx: 'PMS3' }, /"listPrefx" is not a setting this app knows/],
    [{ listPrefix: 'PMS3', Label: 'x' }, /"Label" is not a setting this app knows/],
    [{ listPrefix: 'PMS3', prefix: 'PMS3' }, /"prefix" is not a setting/],
    // configVersion
    [{ configVersion: 2, listPrefix: 'PMS3' }, /"configVersion" must be 1/], [{ configVersion: '1', listPrefix: 'PMS3' }, /"configVersion" must be 1/],
    // siteUrl: its own shape
    [{ listPrefix: '', siteUrl: 'http://americas.internal.deloitteonline.com/sites/CreativeExpCOE' }, /"siteUrl" must start with https:\/\//],
    [{ listPrefix: '', siteUrl: `${SITE}/` }, /"siteUrl" must not end with a slash/],
    [{ listPrefix: '', siteUrl: `${SITE}?a=1` }, /"siteUrl" must not have a query/],
    [{ listPrefix: '', siteUrl: `${SITE}#top` }, /"siteUrl" must not have a query/],
    [{ listPrefix: '', siteUrl: 'https://user:secret@americas.internal.deloitteonline.com/sites/CreativeExpCOE' }, /"siteUrl" must not contain a user name or password/],
    [{ listPrefix: '', siteUrl: 'sites/CreativeExpCOE' }, /"siteUrl" is not an address/],
    [{ listPrefix: '', siteUrl: 42 }, /"siteUrl" is not an address/],
    // listPrefix
    [{ listPrefix: '3PMS' }, /"listPrefix" must be empty, or a letter followed by up to 15 letters or digits/],
    [{ listPrefix: 'PMS 3' }, /"listPrefix" must be empty/], [{ listPrefix: 'PMS_3' }, /"listPrefix" must be empty/], [{ listPrefix: 'PMS-3' }, /"listPrefix" must be empty/],
    [{ listPrefix: 'P'.repeat(17) }, /"listPrefix" must be empty/], [{ listPrefix: null }, /"listPrefix" must be empty/], [{ listPrefix: 3 }, /"listPrefix" must be empty/],
    [{ listPrefix: ' PMS3' }, /"listPrefix" must be empty/], [{ listPrefix: `PM${String.fromCharCode(233)}` }, /"listPrefix" must be empty/],
    // lists
    [{ listPrefix: '', lists: [] }, /"lists" must be an object/], [{ listPrefix: '', lists: 'QRTokens' }, /"lists" must be an object/],
    [{ listPrefix: '', lists: { qrtoken: 'GuestCodes' } }, /"lists\.qrtoken" is not one of this app's lists/],
    [{ listPrefix: '', lists: { QRTokens: 'GuestCodes' } }, /"lists\.QRTokens" is not one of this app's lists/],
    [{ listPrefix: '', lists: { qrtokens: '' } }, /"lists\.qrtokens" must be 1 to 100 characters/],
    [{ listPrefix: '', lists: { qrtokens: long(101) } }, /"lists\.qrtokens" must be 1 to 100 characters/],
    [{ listPrefix: '', lists: { qrtokens: 7 } }, /"lists\.qrtokens" must be 1 to 100 characters/],
    [{ listPrefix: '', lists: { qrtokens: ' Guest codes' } }, /"lists\.qrtokens" must not start or end with a space/],
    ...[...'"#%&*:<>?/\\{}|~'].map((character) => [{ listPrefix: '', lists: { qrtokens: `Guest${character}Codes` } }, /"lists\.qrtokens" must not contain /]),
    // logoLibrary: as a list title
    [{ listPrefix: '', logoLibrary: '' }, /"logoLibrary" must be 1 to 100 characters/], [{ listPrefix: '', logoLibrary: 'Client/Logos' }, /"logoLibrary" must not contain \//],
    [{ listPrefix: '', logoLibrary: long(101) }, /"logoLibrary" must be 1 to 100/],
    // batch
    [{ listPrefix: '', batch: 'false' }, /"batch" must be true or false/], [{ listPrefix: '', batch: 0 }, /"batch" must be true or false/], [{ listPrefix: '', batch: null }, /"batch" must be true or false/],
    // support
    [{ listPrefix: '', support: 'Asha Rao' }, /"support" must be an object/], [{ listPrefix: '', support: [] }, /"support" must be an object/],
    [{ listPrefix: '', support: { name: long(61) } }, /"support\.name" must be 1 to 60 characters/], [{ listPrefix: '', support: { name: '' } }, /"support\.name" must be 1 to 60/],
    [{ listPrefix: '', support: { contact: long(81) } }, /"support\.contact" must be an email address, an https link, or up to 80 characters of text/],
    [{ listPrefix: '', support: { contact: '' } }, /"support\.contact" must be/], [{ listPrefix: '', support: { contact: 5 } }, /"support\.contact" must be/],
    [{ listPrefix: '', support: { name: 'A', phone: '1' } }, /"support\.phone" is not a setting this app knows/],
    // label
    [{ listPrefix: '', label: long(41) }, /"label" must be 1 to 40 characters/], [{ listPrefix: '', label: '' }, /"label" must be 1 to 40/], [{ listPrefix: '', label: 3 }, /"label" must be 1 to 40/],
    // Two things that would be one list: every page codes these as "lists", and the words say which two
    [{ listPrefix: '', lists: { qrtokens: TITLE.clients } }, new RegExp(`"lists\\.qrtokens" and the ${TITLE.clients} list would both be "${TITLE.clients}"`)],
    [{ listPrefix: 'PMS3', lists: { qrtokens: 'GuestCodes', tracks: 'GuestCodes' } }, /would both be "GuestCodes"/],
    [{ listPrefix: 'PMS3', lists: { tracks: `pms3${TITLE.clients.toLowerCase()}` } }, /would both be/],
    [{ listPrefix: '', logoLibrary: TITLE.tracks }, new RegExp(`"logoLibrary" and the ${TITLE.tracks} list would both be "${TITLE.tracks}"`)],
  ];
  for (const [file, reason] of invalid) {
    it(`${JSON.stringify(file).slice(0, 90)}`, () => {
      const built = { listPrefix: 'BUILT' };
      const result = resolve({ file, built });
      const found = only(result);
      assert.deepEqual(Object.keys(found), ['id', 'kind', 'at']);
      assert.equal(found.id, 'PMS-CFG-002');
      assert.equal(found.kind, 'invalid', 'a file that is there and wrong never falls back to what is built in');

      // In words, as Setup has it.
      const sentence = settingsProblem(file, built);
      assert.match(sentence, reason);
      const parts = sixParts(result, { file });
      assert.equal(parts.title, "The app's settings file cannot be used");
      assert.equal(parts.what, `This page could not use its settings file, pms-config.txt: ${found.at === '*' ? 'it is not one JSON object' : `"${found.at}" is not valid`}. It has stopped rather than guess.`);
      assert.equal(parts.next, 'Open Setup (setup.html, in the same folder as this page) to see what is wrong, correct the file, then press Try again.');
      assert.equal(parts.technical, `PMS-CFG-002, not valid at ${found.at}, ${FILE_ADDRESS}`);
      const told = spelledOut(parts, { file, built });
      assert.equal(told.what, `This page could not use its settings file, pms-config.txt: ${sentence}.`);
      assert.equal(told.next, "Correct pms-config.txt in this page's folder, then reload this page.");
      assert.deepEqual({ ...told, what: '', next: '' }, { ...parts, what: '', next: '' }, 'only what happened and what to do are reworded');

      // And the place the page codes is the place those words are about.
      const place = placeIn(sentence);
      const together = /would both be/.test(sentence);
      assert.equal(found.at, together ? 'lists' : place, `the page codes "${found.at}", the rule is about "${place}"`);
      assert.equal(wrongSetting(file), together ? '' : found.at, 'two lists under one title are found in the settings as a whole, not in one of them');
    });
  }

  const valid = [
    {}, { configVersion: 1 }, { listPrefix: 'A' }, { listPrefix: 'a1B2c3D4e5F6g7H8' }, { lists: { adminusers: 'Admin Users (old)', qrtokens: "Guest's codes" } },
    { lists: {} }, { logoLibrary: 'Client Logos' }, { batch: true }, { support: {} }, { support: { name: 'Asha Rao' } }, { support: { contact: 'asha.rao@example.com' } },
    { support: { contact: 'https://example.com/help?topic=pms' } }, { support: { contact: 'Ask at the events desk, extension 4410' } }, { label: 'Test, folder 3' },
    { siteUrl: SITE }, { support: { contact: `https://example.com/${long(200)}` } }, { support: { contact: `${long(100)}@example.com` } },
  ];
  for (const file of valid) {
    it(`accepted: ${JSON.stringify(file).slice(0, 90)}`, () => {
      assert.equal(settingsProblem(file), '');
      assert.equal(wrongSetting(file), '');
      assert.deepEqual(resolve({ file, built: { listPrefix: 'PMS3' } }).problems, []);
    });
  }

  it('the same rules hold for what is built in, and say so', () => {
    const input = { file: { listPrefix: 'PMS3' }, built: { listPrefix: '3PMS' } };
    const result = resolve(input);
    assert.deepEqual(only(result), { id: 'PMS-CFG-002', kind: 'built', at: 'listPrefix' });
    const parts = sixParts(result, input);
    assert.equal(parts.title, 'The settings built into this page cannot be used');
    assert.equal(parts.what, 'The settings built into this page are not valid ("listPrefix").');
    assert.equal(parts.next, 'Build the pages again with corrected PMS_ values, then upload them.');
    assert.equal(parts.technical, `PMS-CFG-002, built in, not valid at listPrefix, opened from ${PAGE}`);
    assert.equal(spelledOut(parts, input).what, 'The settings built into this page are not valid: "listPrefix" must be empty, or a letter followed by up to 15 letters or digits.');
    assert.deepEqual(result.known, { siteUrl: SITE, batch: true, listPrefix: 'PMS3', logoLibrary: `PMS3${TITLE.logoLibrary}` }, 'nothing of a build that is wrong is used, not even to show');
    // Two lists under one title that only the built-in values make: the picture library named as a list.
    const same = { built: { listPrefix: '', logoLibrary: TITLE.tracks } };
    const told = spelledOut(sixParts(resolve(same), same), same);
    assert.equal(told.title, 'The settings built into this page cannot be used');
    assert.equal(told.what, `The settings built into this page are not valid: "logoLibrary" and the ${TITLE.tracks} list would both be "${TITLE.tracks}".`);
    assert.match(told.next, /PMS_/);
  });

  it('the deciding file and the rules in words agree on every value tried for every setting: one never accepts what the other refuses', () => {
    const pool = [null, true, false, 0, 1, 2, '', ' ', 'a', 'A1', 'PMS3', '3a', long(16), long(17), long(40), long(41), long(60), long(61), long(80), long(81), long(100), long(101), long(300), long(301),
      'a b', ' a', 'a ', 'a/b', 'a#b', 'a@b.co', `${long(90)}@b.co`, 'https://x.example', 'https://x.example/', 'https://x.example/sites/a', 'http://x.example', 'https://x.example/a?b', 'https://x.example/a#b',
      'https://u:p@x.example/a', `https://x.example/${long(290)}`, 'ftp://x.example', [], ['a'], {}, { name: 'A' }, { name: '' }, { name: 5 }, { contact: 'x' }, { contact: long(81) }, { contact: `https://x.example/${long(90)}` },
      { contact: 'http://x.example' }, { phone: '1' }, { qrtokens: 'G' }, { qrtokens: '' }, { qrtokens: 5 }, { nope: 'G' }, { logoLibrary: 'G' }, { adminusers: 'A b (c)' }, { clients: 'a|b' }];
    const keys = ['configVersion', 'siteUrl', 'listPrefix', 'lists', 'logoLibrary', 'batch', 'support', 'label', 'unknown', 'toString', 'constructor'];
    let tried = 0;
    for (const key of keys) {
      for (const value of pool) {
        const values = { [key]: value };
        const at = wrongSetting(values);
        const sentence = settingsProblem(values);
        assert.equal(Boolean(at), Boolean(sentence), `${JSON.stringify(values).slice(0, 80)}: the page says ${at ? `wrong at ${at}` : 'fine'}, the rule says ${sentence || 'fine'}`);
        if (at) assert.equal(placeIn(sentence), at, JSON.stringify(values).slice(0, 80));
        tried += 1;
      }
    }
    assert.equal(tried, keys.length * pool.length);
    for (const values of [null, [], 'x', 3, true]) assert.equal(wrongSetting(values), '*');
    assert.equal(siteUrlProblem('https://x.example/sites/a'), '');
  });

  it('a file that could not be read is the same code with its own words, and never falls back', () => {
    const PAGE_REASON = "the site sent a web page in its place, usually its sign-in page, or an error page such as 'File Not Found' when the site will not hand out this kind of file";
    const kinds = [
      [{ kind: 'unreachable' }, 'there was no connection, or no answer within 8 seconds', 'Check the connection and that you are signed in to the site, then press Try again.', 'unreachable'],
      [{ kind: 'status', status: 503 }, 'the site answered 503', 'Check the connection and that you are signed in to the site, then press Try again.', 'status 503'],
      [{ kind: 'status', status: 500 }, 'the site answered 500', 'Check the connection and that you are signed in to the site, then press Try again.', 'status 500'],
      [{ kind: 'status', status: 403 }, 'the site answered 403', 'Sign in to the site in this browser, then press Try again.', 'status 403'],
      [{ kind: 'status', status: 401 }, 'the site answered 401', 'Sign in to the site in this browser, then press Try again.', 'status 401'],
      // (Phase 10g: a web page in the file's place is its sign-in page, or an error page such as "File Not Found" when the site will not hand out this
      // kind of file, which is what the first real site did for a .json; the Details line carries the status that came back.)
      [{ kind: 'page', status: 200 }, PAGE_REASON, 'Sign in to the site in this browser, then press Try again.', 'page 200'],
      [{ kind: 'json', status: 200 }, 'it is not valid JSON', 'Open Setup (setup.html, in the same folder as this page) to see what is wrong, correct the file, then press Try again.', 'json 200'],
      [{ kind: 'page' }, PAGE_REASON, 'Sign in to the site in this browser, then press Try again.', 'page'],
      [{ kind: 'json' }, 'it is not valid JSON', 'Open Setup (setup.html, in the same folder as this page) to see what is wrong, correct the file, then press Try again.', 'json'],
    ];
    for (const [fileError, reason, next, technical] of kinds) {
      const input = { fileError, built: { listPrefix: 'PMS3', label: 'Built' } };
      const result = resolve(input);
      assert.deepEqual(only(result), { id: 'PMS-CFG-002', ...fileError }, 'the built-in prefix is NOT used: the file may say otherwise');
      const parts = sixParts(result, input);
      assert.equal(parts.what, `This page could not use its settings file, pms-config.txt: ${reason}. It has stopped rather than guess.`);
      assert.equal(parts.next, next);
      assert.equal(parts.technical, `PMS-CFG-002, ${technical}, ${FILE_ADDRESS}`);
      // Setup has nothing to add about a file it could not read either, but for the last words: it is reloaded, it has no Try again.
      assert.deepEqual(spelledOut(parts, input), { ...parts, next: next.replace(', then press Try again.', ', then reload this page.') });
      assert.match(spelledOut(parts, input).next, /reload this page\.$/);
    }
  });
});

describe('the four problems, each in six parts', () => {
  it('there are exactly four ids, and each has a title, what happened, what to do next, who to ask and a technical line', () => {
    assert.deepEqual(PROBLEM_IDS, ['PMS-CFG-001', 'PMS-CFG-002', 'PMS-CFG-003', 'PMS-CFG-004']);
    for (const id of PROBLEM_IDS) {
      for (const found of id === 'PMS-CFG-002' ? ['unreachable', 'status', 'page', 'json', 'invalid', 'built'].map((kind) => ({ id, kind, status: 503, at: 'label' })) : [{ id }]) {
        const parts = problem(found, { pageUrl: PAGE, technical: 'a detail' });
        assert.deepEqual(Object.keys(parts), ['id', 'title', 'what', 'next', 'who', 'technical']);
        assert.equal(parts.id, id);
        assert.ok(parts.title.length <= 60 && !/[.:]$/.test(parts.title), parts.title);
        for (const part of [parts.what, parts.next]) assert.match(part, /^[A-Z].*\.$/, part);
        assert.match(parts.next, /^(Open|Check|Sign|Build|Reload) /, 'what to do next starts with a verb');
        assert.equal(parts.who, PUBLISHER);
        assert.equal(parts.technical, `${id}, a detail`);
      }
    }
  });

  it('the titles and sentences are the agreed ones', () => {
    assert.deepEqual(problem({ id: 'PMS-CFG-001' }, { pageUrl: PAGE }), {
      id: 'PMS-CFG-001', title: 'This copy of the app has not been set up yet',
      what: 'The app does not know which lists belong to it, so it has stopped rather than guess.',
      next: "Open Setup (setup.html, in the same folder as this page). It shows the two ways to name this copy's lists.",
      who: 'Whoever published the app', technical: `PMS-CFG-001, no listPrefix: pms-config.txt was not found and none is built in, opened from ${PAGE}`,
    });
    assert.deepEqual(problem({ id: 'PMS-CFG-003' }), {
      id: 'PMS-CFG-003', title: 'The page asked for data before it was set up',
      what: 'A part of this page tried to read or save data before it knew which site and lists to use. Nothing was sent.',
      next: 'Reload the page. If this comes back, send the details below to whoever published the app.',
      who: 'Whoever published the app', technical: 'PMS-CFG-003',
    });
    assert.deepEqual(problem({ id: 'PMS-CFG-004' }, { pageUrl: PAGE, known: { siteUrl: 'https://other.example/sites/x' }, sources: { siteUrl: 'file' } }), {
      id: 'PMS-CFG-004', title: 'This page was opened from the wrong address',
      what: 'This copy of the app is set up for a different SharePoint site than the one it was opened from.',
      next: 'Open it from its own site, or correct the site address in the settings.',
      who: 'Whoever published the app', technical: `PMS-CFG-004, opened from ${PAGE}, siteUrl https://other.example/sites/x (pms-config.txt)`,
    });
  });

  it('on Setup itself the words do not send the person to Setup, or to a Try again it does not have', () => {
    const none = sixParts(resolve({}), {});
    assert.equal(none.next, "Open Setup (setup.html, in the same folder as this page). It shows the two ways to name this copy's lists.");
    assert.deepEqual(spelledOut(none, {}), { ...none, next: 'Use one of the two ways below to name them, then reload this page.' });
    const elsewhere = { file: { listPrefix: '', siteUrl: 'https://other.example/sites/x' } };
    assert.deepEqual(spelledOut(sixParts(resolve(elsewhere), elsewhere), elsewhere), sixParts(resolve(elsewhere), elsewhere), 'PMS-CFG-004 has nothing to reword');
  });

  it('"who to ask" is the support contact when the settings name one, in a problem too', () => {
    const who = (input) => sixParts(resolve(input), input).who;
    assert.equal(who({ file: { support: { name: 'Asha Rao', contact: 'asha.rao@example.com' } } }), 'Asha Rao, asha.rao@example.com');
    assert.equal(who({ built: { support: { name: 'Asha Rao' } } }), 'Asha Rao');
    assert.equal(who({ fileError: { kind: 'unreachable' }, built: { support: { contact: 'https://example.com/help' } } }), 'https://example.com/help');
    assert.equal(who({}), 'Whoever published the app');
  });

  it('the deciding file carries no sentence, and the participant and admin pages do not load the words', async () => {
    const code = async (file) => (await readFile(path.join(ROOT, file), 'utf8')).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const resolver = await code('migration/src/lib/settings/deploy-settings.js');
    assert.doesNotMatch(resolver, /deploy-problems|deploy-rules/);
    assert.doesNotMatch(resolver, /['"`][A-Z][a-z]+ [a-z]+ [a-z]+/, 'no sentence in the resolver');
    assert.doesNotMatch(await code('migration/src/lib/settings/start.ts'), /deploy-problems|deploy-rules/);
    for (const entry of ['migration/src/main.ts', 'migration/src/admin-main.ts']) assert.doesNotMatch(await code(entry), /deploy-problems|deploy-rules/);
    assert.match(await code('migration/src/SetupApp.svelte'), /from '\.\/lib\/settings\/deploy-problems\.js'/);
  });
});

describe('list titles: the prefix, and a list that is named on its own', () => {
  it('there is one list of the sixteen lists (twelve until Prompt 21, fifteen until its Phase 5), the data layer\'s: the resolver keeps none of its own and takes exactly its keys', async () => {
    assert.equal(LIST_KEYS.length, 16);
    assert.deepEqual(USUAL, {
      clients: TITLE.clients, sessions: TITLE.sessions, sections: TITLE.sections, questions: TITLE.questions, options: TITLE.options, tracks: TITLE.tracks, qrtokens: TITLE.qrtokens,
      appsettings: TITLE.appsettings, visitorroster: TITLE.visitorroster, uservisitlogs: TITLE.uservisitlogs, adminusers: TITLE.adminusers, responses: TITLE.responses,
      users: TITLE.users, roleassignments: TITLE.roleassignments, auditlog: TITLE.auditlog, sessionsummary: TITLE.sessionsummary, logoLibrary: TITLE.logoLibrary,
    });
    for (const key of LIST_KEYS) {
      assert.equal(wrongSetting({ lists: { [key]: 'Named' } }), '', key);
      assert.equal(settingsProblem({ lists: { [key]: 'Named' } }), '', key);
    }
    // (`theme` was a list until Phase 10c-2a: a settings file that still names it is told so, like any key that is not a list.)
    for (const key of ['logoLibrary', 'QRTokens', 'theme', 'themeconfig', 'toString', 'constructor']) {
      assert.equal(wrongSetting({ lists: { [key]: 'Named' } }), `lists.${key}`, key);
      assert.match(settingsProblem({ lists: { [key]: 'Named' } }), /is not one of this app's lists \(clients, sessions, sections, questions, options, tracks, qrtokens, appsettings, visitorroster, uservisitlogs, adminusers, responses, users, roleassignments, auditlog, sessionsummary\)$/);
    }
    for (const file of ['deploy-settings.js', 'deploy-rules.js', 'deploy-problems.js']) {
      const source = await readFile(path.join(ROOT, 'migration/src/lib/settings', file), 'utf8');
      for (const title of Object.values(USUAL)) assert.ok(!new RegExp(`['"\`]${title}['"\`]`).test(source), `${file} spells out the title ${title}`);
    }
  });

  const cases = [
    [{ listPrefix: '' }, {}],
    [{ listPrefix: 'PMS3' }, {}],
    [{ listPrefix: 'PMS3', lists: { qrtokens: 'GuestCodes' } }, { qrtokens: 'GuestCodes' }],
    [{ listPrefix: '', lists: { adminusers: 'Admin Accounts', clients: 'Client Accounts' }, logoLibrary: 'Pictures' }, { adminusers: 'Admin Accounts', clients: 'Client Accounts', logoLibrary: 'Pictures' }],
    [{ listPrefix: 'X', logoLibrary: TITLE.logoLibrary }, { logoLibrary: TITLE.logoLibrary }],
  ];
  for (const [file, named] of cases) {
    it(`${JSON.stringify(file)}: the prefix in front of each, except a list named on its own`, () => {
      const { settings, problems } = resolve({ file });
      assert.deepEqual(problems, []);
      const expected = { ...Object.fromEntries(Object.entries(USUAL).map(([key, title]) => [key, file.listPrefix + title])), ...named };
      assert.deepEqual(listTitles(settings), expected);
      ds.configure({ sharePoint: settings });
      try { assert.deepEqual(ds.sharePointListTitles(), expected, 'what the resolver says is what the data layer uses'); } finally { ds.configure({ baseUrl: '/api' }); }
    });
  }
});

describe('the example file', () => {
  it('pms-config.example.txt is accepted, for the first deployment\'s address, and names the PMS lists with no prefix, on purpose', async () => {
    const file = JSON.parse(await readFile(path.join(ROOT, 'pms-config.example.txt'), 'utf8'));
    assert.equal(settingsProblem(file), '');
    assert.equal(wrongSetting(file), '');
    const result = resolve({ file });
    assert.deepEqual(result.problems, []);
    assert.equal(result.settings.siteUrl, SITE);
    assert.equal(result.settings.listPrefix, '');
    assert.equal(listTitles(result.settings).appsettings, TITLE.appsettings);
    assert.equal(result.settings.logoLibrary, TITLE.logoLibrary);
    assert.equal(SETTINGS_FILE, 'pms-config.txt');
  });
});
