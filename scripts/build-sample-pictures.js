// The sample clients' pictures (Phase 10f), made by Brand Studio itself: `npm run build:sample-pictures`.
//
// VJR supplied six pictures for Kroger and Domino's (a logo, a hero and a background each). They are in the git-ignored folder
// `.local/sample-images/` (`<client>-<slot>.jpg`), so only a machine that has them can run this. Nothing here decides how a picture is
// cropped, sized, encoded or named: the BUILT admin page does, in Chromium, exactly as for an admin. For each client this opens Brand
// Studio against a scratch local server whose sample clients have no pictures, chooses each file for its slot, accepts the crop as it
// starts ("Use this picture"), and presses Save. What Brand Studio stored is then the result: the files it uploaded (cropped, drawn
// at the slot's size, compressed under the slot's cap, named `<slug>-<slot>-<10 hex of their SHA-256>.<ext>`) and the theme it wrote.
//
// It writes, and these are committed:
//   migration/src/assets/sample-pictures/<name>   the six files: what Setup's "Seed sample clients" uploads (src/setup/sample-picture-data.ts)
//   public/assets/images/clients/<name>           the same six files: the local server's uploads, which server/data/clients.json points at
//   migration/src/lib/sample-pictures.js          their names, types, sizes and hashes, and the focal point Brand Studio stored
//   migration/src/setup/sample-picture-data.ts    Setup's imports of the six files, one by one by name (never a glob)
// and test-results/sample-pictures/report.json (what Brand Studio said on the way: a picture enlarged, or made smaller to fit its cap).
// A sample picture of an earlier run that is not one of the six is removed from both folders. Run it again only when a source picture,
// a slot's rules or the encoder change; scripts/test-sample-pictures.js holds the committed files to the manifest.
//   node scripts/build-sample-pictures.js --check   makes them again and says whether they are the committed six, byte for byte; writes nothing
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { freePort } from './free-port.js';
import { samplePack } from '../migration/src/lib/sample-clients.js';

const ROOT = path.join(import.meta.dirname, '..');
const SOURCES = path.join(ROOT, '.local', 'sample-images');
const PICTURES = path.join(ROOT, 'migration', 'src', 'assets', 'sample-pictures');
const UPLOADS = path.join(ROOT, 'public', 'assets', 'images', 'clients');
const MANIFEST = path.join(ROOT, 'migration', 'src', 'lib', 'sample-pictures.js');
const IMPORTS = path.join(ROOT, 'migration', 'src', 'setup', 'sample-picture-data.ts');
const REPORT = path.join(ROOT, 'test-results', 'sample-pictures', 'report.json');
const CLIENTS = [{ id: 'c-kroger', name: 'Kroger', slug: 'kroger' }, { id: 'c-dominos', name: "Domino's", slug: 'dominos' }];
const SLOTS = ['hero', 'logo', 'background'];
const SAMPLE_NAME = /^(?:kroger|dominos)-(?:hero|logo|background)-[0-9a-f]{10}\.(?:webp|png|jpg)$/;
const ORIGIN = 'http://pms.test';
const CHECK = process.argv.includes('--check');
const PIN = '1234'; // server/data/adminusers.json, the local server's mock PIN

const missing = [];
for (const { slug } of CLIENTS) for (const slot of SLOTS) {
  try { await stat(path.join(SOURCES, `${slug}-${slot}.jpg`)); } catch { missing.push(`.local/sample-images/${slug}-${slot}.jpg`); }
}
if (missing.length) {
  console.error(`The sample pictures are made from VJR's six files, and these are missing:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

// 1. The admin page as it is built for release (same config), into a scratch folder.
const out = path.join(ROOT, 'build-svelte', '.sample-pictures');
await build({ configFile: path.join(ROOT, 'migration', 'vite.admin.config.ts'), logLevel: 'warn', build: { outDir: out, emptyOutDir: true } });
const adminHtml = await readFile(path.join(out, 'admin.html'));

// 2. A scratch local server: the committed data, with the sample clients as the seeds make them before any picture (no logo, no hero, no background).
const data = await mkdtemp(path.join(os.tmpdir(), 'pms-sample-pictures-'));
await readdir(path.join(ROOT, 'server', 'data')).then((files) => Promise.all(files.filter((file) => file.endsWith('.json'))
  .map((file) => copyFile(path.join(ROOT, 'server', 'data', file), path.join(data, file)))));
await writeFile(path.join(data, 'clients.json'), `${JSON.stringify(samplePack().clients, null, 2)}\n`);
const port = await freePort();
const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  env: { ...process.env, PORT: String(port), DATA_DIR: data, UPLOAD_DIR: path.join(data, 'uploads') }, stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  server.once('exit', (code) => reject(new Error(`the scratch server exited early (code ${code})`)));
  server.stdout.on('data', (chunk) => String(chunk).includes('running') && resolve());
});
const api = `http://127.0.0.1:${port}`;

const report = { madeAt: new Date().toISOString(), browser: '', clients: {} };
const browser = await chromium.launch();
report.browser = `Chromium ${browser.version()}`;
try {
  for (const client of CLIENTS) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    // The page is served as the admin page of a folder on a plain-http address, which the page takes for the local server.
    await page.route(`${ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/PMS/admin.html') return route.fulfill({ body: adminHtml, contentType: 'text/html' });
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/assets/')) {
        const response = await route.fetch({ url: `${api}${url.pathname}${url.search}` });
        return route.fulfill({ response });
      }
      return route.fulfill({ status: 404, body: '' });
    });
    await page.goto(`${ORIGIN}/PMS/admin.html`);
    await page.getByRole('textbox', { name: 'PIN' }).fill(PIN);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await page.getByRole('tab', { name: 'Clients', exact: true }).click();
    await page.locator('.row').filter({ hasText: client.name }).getByRole('button', { name: 'Brand' }).click();
    await page.getByRole('heading', { name: new RegExp(`Brand Studio · ${client.name}`) }).waitFor();
    const said = {};
    for (const slot of SLOTS) {
      const card = page.locator(`section.asset[data-slot="${slot}"]`);
      await page.locator(`input[type="file"][data-slot="${slot}"]`).setInputFiles(path.join(SOURCES, `${client.slug}-${slot}.jpg`));
      const dialog = page.getByRole('dialog', { name: /Crop and fit/ });
      await dialog.waitFor();
      const warning = await dialog.locator('.crop__warn').textContent().catch(() => null);
      await dialog.getByRole('button', { name: 'Use this picture' }).click();
      // Either the picture is in ("Not saved yet") or Brand Studio refused it in words.
      await Promise.race([
        card.getByTestId(`${slot}-status`).getByText('Not saved yet').waitFor({ timeout: 60_000 }),
        card.locator('.asset__problem').waitFor({ timeout: 60_000 }),
      ]);
      const problem = await card.locator('.asset__problem').textContent({ timeout: 100 }).catch(() => null);
      if (problem) throw new Error(`Brand Studio refused ${client.slug}-${slot}.jpg: ${problem}`);
      const notice = await card.locator('.asset__notice').textContent({ timeout: 100 }).catch(() => null);
      said[slot] = { warning: warning?.trim() || null, notice: notice?.trim() || null };
    }
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByTestId('brand-status').getByText('All changes saved').waitFor({ timeout: 60_000 });
    const stored = await (await fetch(`${api}/api/clients/${client.id}`)).json();
    report.clients[client.id] = { said, theme: stored.theme, logoUrl: stored.logoUrl };
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}

// 3. The files Brand Studio uploaded, into both folders; what it wrote, into the manifest. (With --check: only compared with the committed six.)
if (CHECK) {
  const { SAMPLE_PICTURES } = await import('../migration/src/lib/sample-pictures.js');
  const differ = [];
  for (const client of CLIENTS) for (const slot of SLOTS) {
    const made = path.basename(report.clients[client.id].theme.assets[slot]);
    const committed = SAMPLE_PICTURES[client.id][slot].name;
    const same = made === committed && Buffer.compare(await readFile(path.join(data, 'uploads', made)), await readFile(path.join(PICTURES, committed))) === 0;
    console.log(`  ${same ? 'same     ' : 'DIFFERENT'} ${client.id} ${slot}: made ${made}, committed ${committed}`);
    if (!same) differ.push(`${client.id} ${slot}`);
  }
  await rm(data, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
  console.log(differ.length ? `Brand Studio in ${report.browser} makes ${differ.length} of the six differently.` : `Brand Studio in ${report.browser} makes the committed six, byte for byte.`);
  process.exit(differ.length ? 1 : 0);
}
await mkdir(PICTURES, { recursive: true });
await mkdir(UPLOADS, { recursive: true });
const manifest = {};
const kept = new Set();
for (const client of CLIENTS) {
  const { theme, logoUrl } = report.clients[client.id];
  if (logoUrl !== theme.assets.logo) throw new Error(`${client.id}: Brand Studio wrote LogoUrl ${logoUrl} beside the theme's logo ${theme.assets.logo}`);
  const entry = {};
  for (const slot of SLOTS) {
    const name = path.basename(theme.assets[slot]);
    if (!SAMPLE_NAME.test(name) || !name.startsWith(`${client.slug}-${slot}-`)) throw new Error(`${client.id}: an unexpected ${slot} address ${theme.assets[slot]}`);
    const bytes = await readFile(path.join(data, 'uploads', name));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (!name.includes(`-${sha256.slice(0, 10)}.`)) throw new Error(`${name} does not carry the hash of its bytes (${sha256})`);
    const type = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' }[name.split('.').pop()];
    const size = await pixelSize(bytes, type);
    entry[slot] = { name, type, bytes: bytes.length, ...size, sha256 };
    await writeFile(path.join(PICTURES, name), bytes);
    await writeFile(path.join(UPLOADS, name), bytes);
    kept.add(name);
  }
  manifest[client.id] = { ...entry, backgroundFocus: theme.assets.backgroundFocus, plate: theme.plate ?? 'light' };
}
for (const folder of [PICTURES, UPLOADS]) {
  for (const name of await readdir(folder)) if (SAMPLE_NAME.test(name) && !kept.has(name)) await rm(path.join(folder, name));
}
await rm(data, { recursive: true, force: true });
await rm(out, { recursive: true, force: true });

// (No full hash: the name carries its first 10 digits, and a page of the release package holds no 64-hex string, which its proof checks.)
const pictureLine = (picture) => `{ name: '${picture.name}', type: '${picture.type}', bytes: ${picture.bytes}, width: ${picture.width}, height: ${picture.height} }`;
await writeFile(MANIFEST, [
  '// GENERATED by scripts/build-sample-pictures.js (npm run build:sample-pictures): do not edit by hand. Plain JS, no DOM.',
  '//',
  "// The sample clients' pictures (Phase 10f): VJR's six pictures (the clients' real logos, supplied by VJR for this internal app, and a",
  '// hero and a background each), as Brand Studio stored them when they were chosen for their slots and saved: its crop as it starts, drawn',
  "// at the slot's size and compressed under the slot's cap, by the built admin page in Chromium. A logo is used as a file, never redrawn",
  '// or imitated. The files are migration/src/assets/sample-pictures/<name> (Setup uploads them) and public/assets/images/clients/<name>',
  "// (the local server's uploads); scripts/test-sample-pictures.js holds both to this list.",
  '',
  '/** For each sample client: its hero, logo and background as stored (the name ends with the first 10 hex digits of the file\'s SHA-256), and what Brand Studio stored beside them. */',
  'export const SAMPLE_PICTURES = Object.freeze({',
  ...CLIENTS.map(({ id }) => {
    const entry = manifest[id];
    return [
      `  '${id}': Object.freeze({`,
      ...SLOTS.map((slot) => `    ${slot}: Object.freeze(${pictureLine(entry[slot])}),`),
      `    backgroundFocus: Object.freeze({ x: ${entry.backgroundFocus.x}, y: ${entry.backgroundFocus.y} }),`,
      `    plate: '${entry.plate}',`,
      '  }),',
    ].join('\n');
  }),
  '});',
  '',
  '/** The six file names, in order: Kroger then Domino\'s, hero, logo and background. */',
  "export const SAMPLE_PICTURE_NAMES = Object.freeze(Object.values(SAMPLE_PICTURES).flatMap((entry) => [entry.hero.name, entry.logo.name, entry.background.name]));",
  '',
].join('\n'));

const variable = (name) => name.replace(/-[0-9a-f]{10}\.\w+$/, '').replace(/-(\w)/g, (_, letter) => letter.toUpperCase());
await mkdir(path.dirname(IMPORTS), { recursive: true });
await writeFile(IMPORTS, [
  '// GENERATED by scripts/build-sample-pictures.js (npm run build:sample-pictures): do not edit by hand.',
  '//',
  "// The six sample pictures, inside the Setup page and no other (npm run test:bundle holds that): \"Seed sample clients\" uploads them to the",
  "// picture library. Each is imported by its name, never by a glob, so nothing else in the folder can reach a page.",
  ...[...kept].map((name) => `import ${variable(name)} from '../assets/sample-pictures/${name}?inline';`),
  '',
  '/** Each picture as a data: address, by file name. */',
  'export const SAMPLE_PICTURE_DATA: Readonly<Record<string, string>> = Object.freeze({',
  ...[...kept].map((name) => `  '${name}': ${variable(name)},`),
  '});',
  '',
].join('\n'));

await mkdir(path.dirname(REPORT), { recursive: true });
await writeFile(REPORT, `${JSON.stringify({ ...report, manifest }, null, 2)}\n`);
console.log(`Made by Brand Studio in ${report.browser}:`);
for (const client of CLIENTS) for (const slot of SLOTS) {
  const picture = manifest[client.id][slot];
  const { warning, notice } = report.clients[client.id].said[slot];
  console.log(`  ${picture.name.padEnd(34)} ${picture.type.padEnd(10)} ${String(picture.bytes).padStart(7)} B  ${picture.width} x ${picture.height}${warning ? `  (warned: ${warning})` : ''}${notice ? `  (${notice})` : ''}`);
}
const total = Object.values(manifest).flatMap((entry) => SLOTS.map((slot) => entry[slot].bytes)).reduce((sum, bytes) => sum + bytes, 0);
console.log(`  ${total} B in all. Written: ${path.relative(ROOT, MANIFEST)}, ${path.relative(ROOT, IMPORTS)}, and the files in both folders.`);

/** A picture's pixel size, read from its header (WebP VP8/VP8L/VP8X, PNG, JPEG). */
async function pixelSize(bytes, type) {
  if (type === 'image/png') return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (type === 'image/webp') {
    const chunk = bytes.toString('latin1', 12, 16);
    if (chunk === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (chunk === 'VP8L') { const bits = bytes.readUInt32LE(21); return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }; }
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  for (let at = 2; at < bytes.length;) {
    const marker = bytes[at + 1];
    const length = bytes.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
    at += 2 + length;
  }
  throw new Error('no size in this JPEG');
}
