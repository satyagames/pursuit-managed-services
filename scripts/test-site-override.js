// The values a build can put into the three Svelte pages (scripts/site-override.js; Phase 9c, reworked in Phase 10b).
// Plain rules first, then how they reach a page (one constant the bundler defines; no file's text is searched and replaced), then
// real Vite builds of the participant page into a scratch folder (never build-svelte/, which other tests and the browser suite use).
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { build } from 'vite';
import { settingsProblem } from '../migration/src/lib/deploy-rules.js';
import { resolveSettings, wrongSetting } from '../migration/src/lib/deploy-settings.js';
import { NO_PREFIX, builtDefine, builtSettings, readSiteUrl } from './site-override.js';
import { TITLE } from './sharepoint-fake.js';

const root = path.join(import.meta.dirname, '..');
const run = promisify(execFile);
const source = (file) => readFile(path.join(root, file), 'utf8');

test('no environment variable: nothing is built in, and the constant is an empty object', () => {
  assert.deepEqual(builtSettings({}), {});
  assert.deepEqual(builtSettings({ PMS_SITE_URL: '', PMS_BATCH: '' }), {});
  assert.deepEqual(builtSettings({ PMS_SITE_URL: '  ', PMS_BATCH: ' ' }), {});
  assert.deepEqual(builtSettings({ PMS_BATCH: 'true' }), {}, 'grouped reads are already the default');
  assert.deepEqual(builtDefine({}), { __PMS_BUILT__: '{}' });
});

test('PMS_SITE_URL: what is accepted', () => {
  assert.deepEqual(readSiteUrl(''), null);
  assert.deepEqual(readSiteUrl('https://tenant.example.com/sites/TestSite'), { origin: 'https://tenant.example.com', siteUrl: 'https://tenant.example.com/sites/TestSite' });
  assert.deepEqual(readSiteUrl('https://tenant.example.com'), { origin: 'https://tenant.example.com', siteUrl: 'https://tenant.example.com' }, 'a root site');
  assert.deepEqual(readSiteUrl('https://tenant.example.com:8443/sites/a/b'), { origin: 'https://tenant.example.com:8443', siteUrl: 'https://tenant.example.com:8443/sites/a/b' });
  assert.equal(readSiteUrl('https://Tenant.Example.COM/sites/TestSite').origin, 'https://tenant.example.com', 'the origin is what a browser reports: lower case');
  assert.deepEqual(builtSettings({ PMS_SITE_URL: ' https://tenant.example.com/sites/TestSite ' }), { siteUrl: 'https://tenant.example.com/sites/TestSite' });
});

test('PMS_SITE_URL: what is refused, in plain words', () => {
  const refused = [
    ['http://tenant.example.com/sites/T', /must start with https:\/\//],
    ['tenant.example.com/sites/T', /is not an address/],
    ['//tenant.example.com/sites/T', /is not an address/],
    ['HTTPS-ish nonsense', /is not an address/],
    ['https://tenant.example.com/sites/T/', /must not end with a slash/],
    ['https://tenant.example.com/', /must not end with a slash/],
    ['https://tenant.example.com/sites/T?a=1', /must not have a query/],
    ['https://tenant.example.com/sites/T?', /must not have a query/],
    ['https://tenant.example.com/sites/T#top', /must not have a query/],
    ['https://user:secret@tenant.example.com/sites/T', /must not contain a user name or password/],
  ];
  for (const [value, message] of refused) {
    assert.throws(() => builtSettings({ PMS_SITE_URL: value }), message, value);
    assert.throws(() => builtSettings({ PMS_SITE_URL: value }), /Use a full address such as https:\/\//, `${value}: says what to use`);
  }
});

test('PMS_BATCH: false turns grouped reads off, and anything else that is not "true" is refused', () => {
  assert.deepEqual(builtSettings({ PMS_BATCH: 'false' }), { batch: false });
  assert.deepEqual(builtSettings({ PMS_BATCH: 'FALSE', PMS_SITE_URL: 'https://tenant.example.com/sites/T' }), { siteUrl: 'https://tenant.example.com/sites/T', batch: false });
  for (const value of ['0', 'no', 'off', 'flase']) assert.throws(() => builtSettings({ PMS_BATCH: value }), /PMS_BATCH must be "false" or left out/, value);
});

test('the five newer values: each is built in as the setting it is, and "" in quotation marks is the empty prefix, on purpose', () => {
  assert.deepEqual(builtSettings({ PMS_LIST_PREFIX: 'PMS3' }), { listPrefix: 'PMS3' });
  assert.deepEqual(builtSettings({ PMS_LIST_PREFIX: ' PMS3 ' }), { listPrefix: 'PMS3' });
  assert.deepEqual(builtSettings({ PMS_LIST_PREFIX: NO_PREFIX }), { listPrefix: '' }, 'no prefix, said on purpose');
  assert.equal(NO_PREFIX, '""');
  assert.deepEqual(builtSettings({ PMS_LIST_PREFIX: '' }), {}, 'a variable that is set and blank is not "no prefix": nothing is built in, and the page will ask for a settings file');
  assert.deepEqual(builtSettings({ PMS_LIST_PREFIX: '   ' }), {});
  assert.deepEqual(builtSettings({ PMS_LOGO_LIBRARY: 'Client Pictures' }), { logoLibrary: 'Client Pictures' });
  assert.deepEqual(builtSettings({ PMS_SUPPORT_NAME: 'Asha Rao' }), { support: { name: 'Asha Rao' } });
  assert.deepEqual(builtSettings({ PMS_SUPPORT_CONTACT: 'asha.rao@example.com' }), { support: { contact: 'asha.rao@example.com' } });
  assert.deepEqual(builtSettings({ PMS_LABEL: 'Test, folder 3' }), { label: 'Test, folder 3' });
  const all = { PMS_SITE_URL: 'https://tenant.example.com/sites/T', PMS_LIST_PREFIX: 'PMS3', PMS_LOGO_LIBRARY: 'Pictures', PMS_BATCH: 'false', PMS_SUPPORT_NAME: 'Asha Rao', PMS_SUPPORT_CONTACT: 'https://example.com/help', PMS_LABEL: 'Test, folder 3' };
  const built = builtSettings(all);
  assert.deepEqual(built, { siteUrl: 'https://tenant.example.com/sites/T', listPrefix: 'PMS3', logoLibrary: 'Pictures', batch: false, support: { name: 'Asha Rao', contact: 'https://example.com/help' }, label: 'Test, folder 3' });
  assert.deepEqual(JSON.parse(builtDefine(all).__PMS_BUILT__), built);
});

test('what the build puts in is what a page will accept: the same rules, and the same answer from the resolver', () => {
  const built = builtSettings({ PMS_LIST_PREFIX: 'PMS3', PMS_LABEL: 'Test, folder 3', PMS_SUPPORT_NAME: 'Asha Rao' });
  assert.equal(settingsProblem(built), '');
  assert.equal(wrongSetting(built), '');
  const page = 'https://tenant.example.com/sites/T/Shared%20Documents/app/index.html';
  const alone = resolveSettings({ pageUrl: page, built });
  assert.deepEqual(alone.problems, []);
  assert.deepEqual(alone.settings, { configVersion: 1, siteUrl: 'https://tenant.example.com/sites/T', batch: true, listPrefix: 'PMS3', logoLibrary: `PMS3${TITLE.logoLibrary}`, support: { name: 'Asha Rao' }, label: 'Test, folder 3' });
  assert.deepEqual(alone.sources, { siteUrl: 'derived', batch: 'default', listPrefix: 'built in', logoLibrary: 'default', support: 'built in', label: 'built in' });
  // A settings file beside the page still wins, setting by setting: what is built in is a fallback, never an override.
  const withFile = resolveSettings({ pageUrl: page, built, file: { listPrefix: 'OTHER', label: 'From the file' } });
  assert.equal(withFile.settings.listPrefix, 'OTHER');
  assert.equal(withFile.settings.label, 'From the file');
  assert.deepEqual(withFile.settings.support, { name: 'Asha Rao' });
  // The empty prefix built in, on purpose, is an answer: no settings file is needed.
  assert.deepEqual(resolveSettings({ pageUrl: page, built: builtSettings({ PMS_LIST_PREFIX: NO_PREFIX }) }).problems, []);
  assert.deepEqual(resolveSettings({ pageUrl: page, built: builtSettings({ PMS_LIST_PREFIX: '' }) }).problems, [{ id: 'PMS-CFG-001' }]);
});

test('the five newer values: what is refused, in plain words that name the variable', () => {
  const refused = [
    [{ PMS_LIST_PREFIX: '3PMS' }, /^PMS_LIST_PREFIX must be empty, or a letter followed by up to 15 letters or digits \(got "3PMS"\)\. For no prefix at all, on purpose, write PMS_LIST_PREFIX='""'\.$/],
    [{ PMS_LIST_PREFIX: 'PMS 3' }, /^PMS_LIST_PREFIX must be empty/],
    [{ PMS_LIST_PREFIX: 'PMS_3' }, /^PMS_LIST_PREFIX must be empty/],
    [{ PMS_LIST_PREFIX: 'P'.repeat(17) }, /^PMS_LIST_PREFIX must be empty/],
    [{ PMS_LIST_PREFIX: "''" }, /^PMS_LIST_PREFIX must be empty/],
    [{ PMS_LOGO_LIBRARY: 'Client/Logos' }, /^PMS_LOGO_LIBRARY must not contain \/ \(got "Client\/Logos"\)\.$/],
    [{ PMS_LOGO_LIBRARY: 'x'.repeat(101) }, /^PMS_LOGO_LIBRARY must be 1 to 100 characters/],
    [{ PMS_SUPPORT_NAME: 'x'.repeat(61) }, /^PMS_SUPPORT_NAME must be 1 to 60 characters/],
    [{ PMS_SUPPORT_CONTACT: 'x'.repeat(81) }, /^PMS_SUPPORT_CONTACT must be an email address, an https link, or up to 80 characters of text/],
    [{ PMS_LABEL: 'x'.repeat(41) }, /^PMS_LABEL must be 1 to 40 characters \(got "x{41}"\)\.$/],
    // Two that would be one list: the picture library named as a list of this copy.
    [{ PMS_LIST_PREFIX: 'PMS3', PMS_LOGO_LIBRARY: `PMS3${TITLE.tracks}` }, new RegExp(`^PMS_LOGO_LIBRARY and the ${TITLE.tracks} list would both be "PMS3${TITLE.tracks}" \\(got "PMS3${TITLE.tracks}"\\)\\.$`)],
    [{ PMS_LIST_PREFIX: NO_PREFIX, PMS_LOGO_LIBRARY: TITLE.clients.toLowerCase() }, new RegExp(`^PMS_LOGO_LIBRARY and the ${TITLE.clients} list would both be "${TITLE.clients.toLowerCase()}"`)],
  ];
  for (const [env, message] of refused) assert.throws(() => builtSettings(env), (error) => { assert.match(error.message, message, JSON.stringify(env)); return true; });
  for (const [env] of refused) assert.throws(() => builtDefine(env), Error, 'and so nothing is defined for the bundler');
});

test('the values reach a page as one constant the bundler defines: no source text is searched for and replaced', async () => {
  const script = (await source('scripts/site-override.js')).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.doesNotMatch(script, /transform\s*\(|readFile|writeFile|config\.js/, 'the build script edits no file and reads none');
  assert.match(script, /__PMS_BUILT__: JSON\.stringify\(builtSettings\(env\)\)/);
  // Every Vite config of the Svelte pages defines it, and one file of the pages reads it.
  for (const config of ['migration/vite.config.ts', 'migration/vite.admin.config.ts', 'migration/vite.setup.config.ts']) {
    assert.match(await source(config), /plugins: \[appName\(\), builtSettings\(\), /, config);
  }
  const readers = [];
  for (const file of await readdir(path.join(root, 'migration/src'), { recursive: true })) {
    if (/\.(ts|js|svelte)$/.test(file) && (await source(path.join('migration/src', file))).includes('__PMS_BUILT__')) readers.push(file.split(path.sep).join('/'));
  }
  assert.deepEqual(readers, ['lib/built-settings.ts']);
});

test('build-svelte-release.js checks the environment before it deletes or builds anything', async () => {
  const script = await source('scripts/build-svelte-release.js');
  assert.ok(script.includes("import { builtSettings } from './site-override.js';"));
  assert.ok(script.indexOf('builtSettings()') < script.indexOf('await rm(release'), 'validate first');

  const bad = await run(process.execPath, [path.join(root, 'scripts/build-svelte-release.js')], { cwd: root, env: { ...process.env, PMS_SITE_URL: 'http://nope.example.com' } }).then(() => null, (error) => error);
  assert.ok(bad, 'a refused address stops the build');
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /PMS_SITE_URL must start with https:\/\//);
  assert.ok(!/built|ready/i.test(bad.stdout), 'nothing was built');
  // The newer values are held to the same: a prefix a page would refuse stops the build, in words that name the variable.
  const prefix = await run(process.execPath, [path.join(root, 'scripts/build-svelte-release.js')], { cwd: root, env: { ...process.env, PMS_LIST_PREFIX: 'PMS 3' } }).then(() => null, (error) => error);
  assert.equal(prefix?.code, 1);
  assert.match(prefix.stderr, /PMS_LIST_PREFIX must be empty, or a letter followed by up to 15 letters or digits \(got "PMS 3"\)\./);
  assert.ok(!/built|ready/i.test(prefix.stdout), 'nothing was built');
  assert.match(script, /Built into the pages: \$\{JSON\.stringify\(built\)\}/, 'and a build that does put something in says what');
});

/** What two builds of one page differ in: the middle of each, once what they begin and end with alike is taken off. */
function difference(a, b) {
  let start = 0;
  while (start < a.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1;
  return [a.slice(start, a.length - end), b.slice(start, b.length - end)];
}

test('a real build of the participant page: with nothing set, and with both variables set', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'pms-built-'));
  const page = async (env, name) => {
    await build({
      configFile: path.join(root, 'migration/vite.config.ts'),
      define: builtDefine(env),
      logLevel: 'silent',
      build: { outDir: path.join(outDir, name), emptyOutDir: true },
    });
    return readFile(path.join(outDir, name, 'index.html'), 'utf8');
  };
  try {
    const plain = await page({}, 'plain');
    assert.ok(!plain.includes('deloitteonline.com') && !/sites\/CreativeExpCOE/.test(plain), 'no site is built in: the page finds its site from its own address');
    assert.ok(!plain.includes('__PMS_BUILT__'), 'the constant is replaced, not left as a name');

    const moved = await page({ PMS_SITE_URL: 'https://tenant.example.com/sites/TestSite', PMS_BATCH: 'false' }, 'moved');
    const [before, after] = difference(plain, moved);
    assert.ok(before.length <= 2, `the two pages differ in more than the constant: ${before.slice(0, 200)}`);
    assert.match(after, /^.{0,3}siteUrl:[`"']https:\/\/tenant\.example\.com\/sites\/TestSite[`"'],batch:(!1|false).{0,3}$/, after.slice(0, 300));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('the same through the environment alone, as build-svelte-release.js and `npm run build:svelte` do it', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'pms-built-env-'));
  try {
    const script = `import { build } from 'vite';\nawait build({ configFile: ${JSON.stringify(path.join(root, 'migration/vite.config.ts'))}, logLevel: 'silent', build: { outDir: ${JSON.stringify(path.join(outDir, 'page'))}, emptyOutDir: true } });\n`;
    const { NODE_TEST_CONTEXT: _runner, ...env } = process.env;
    await run(process.execPath, ['--input-type=module', '-e', script], { cwd: root, env: { ...env, PMS_SITE_URL: 'https://tenant.example.com/sites/FromTheEnvironment' } });
    assert.match(await readFile(path.join(outDir, 'page', 'index.html'), 'utf8'), /siteUrl:[`"']https:\/\/tenant\.example\.com\/sites\/FromTheEnvironment[`"']/);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
