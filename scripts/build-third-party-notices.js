// Writes THIRD-PARTY-NOTICES.txt (Phase 9c, LIC-1 in REVIEW-9A.md, in git history at 7347c72): the licence of every piece of runtime code and every font that ends
// up inside a built page, from the licence files in node_modules and migration/src/assets, with versions from package-lock.json.
//   node scripts/build-third-party-notices.js [output file]     (default build-svelte/THIRD-PARTY-NOTICES.txt, which is git-ignored)
// A PROPOSAL for whoever owns licence compliance to confirm. It is an extra file to upload beside the pages and changes none of them.
// Where a licence file is missing the entry says so; no licence text is ever written from memory.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const FONT_LICENCES = ['migration/src/assets/fonts/LICENSE-OpenSans-Apache-2.0.txt', 'migration/src/assets/report-fonts/LICENSE-OpenSans-Apache-2.0.txt'];
const INSIDE_JSZIP = "bundled inside jszip's own prebuilt dist file; the version is the one the lock file records for jszip's dependency";

/**
 * The runtime dependencies of the review's table ("Dependencies and licences"), and nothing else: the dev tools never enter a page.
 * `lock` is the package's path in package-lock.json; `stopBefore` ends the text where a second licence the page does not use begins.
 */
export const RUNTIME_DEPENDENCIES = [
  { name: 'svelte', where: 'all three pages (the runtime)' },
  { name: 'svelte-spa-router', where: 'participant page (hash routes)' },
  { name: 'regexparam', where: 'participant page, with svelte-spa-router' },
  { name: 'canvas-confetti', where: 'participant page and admin page (confetti)' },
  { name: 'lean-qr', where: 'admin page (QR pictures)' },
  { name: 'jspdf', where: 'admin page (PDF exports, loaded when first used)' },
  { name: 'fflate', where: 'admin page, with jspdf' },
  { name: 'fast-png', where: 'admin page, with jspdf' },
  { name: 'iobuffer', where: 'admin page, with jspdf' },
  { name: 'pako', lock: 'node_modules/pako', where: 'admin page, with jspdf' },
  { name: '@babel/runtime', where: 'admin page, with jspdf' },
  { name: 'pptxgenjs', where: 'admin page (PowerPoint export, loaded when first used)' },
  {
    name: 'jszip',
    where: 'admin page, with pptxgenjs',
    licenceName: 'MIT or GPL-3.0-or-later (the package offers both); used here under MIT',
    stopBefore: /^GPL version 3\s*$/m,
    note: 'The GPL-3.0-or-later option in the same licence file is not the one used here and is not reproduced.',
  },
  { name: 'lie', where: `admin page, ${INSIDE_JSZIP}` },
  { name: 'pako', lock: 'node_modules/jszip/node_modules/pako', where: `admin page, ${INSIDE_JSZIP}` },
  { name: 'readable-stream', where: `admin page, ${INSIDE_JSZIP}` },
  { name: 'setimmediate', where: `admin page, ${INSIDE_JSZIP}` },
  {
    name: 'Open Sans',
    font: true,
    files: FONT_LICENCES,
    licenceName: 'Apache-2.0',
    version: 'font files (subset to WOFF2 for the pages and to TrueType for the leader report), no version number',
    fontFile: 'public/assets/Font/open-sans/OpenSans-Regular.ttf',
    where: 'participant page and admin page (all faces), and inside each leader report PDF',
  },
  { name: 'tailwindcss', where: 'all three pages, as generated CSS (its reset and the utilities used)' },
];

const RULE = '='.repeat(78);
const THIN = '-'.repeat(78);

/** The copyright notice a font file carries in its own name table (name ID 0, Windows platform), or ''. */
export function fontCopyright(buffer) {
  for (let i = 0, tables = buffer.readUInt16BE(4); i < tables; i++) {
    const entry = 12 + i * 16;
    if (buffer.toString('latin1', entry, entry + 4) !== 'name') continue;
    const table = buffer.readUInt32BE(entry + 8);
    const strings = table + buffer.readUInt16BE(table + 4);
    for (let r = 0, count = buffer.readUInt16BE(table + 2); r < count; r++) {
      const record = table + 6 + r * 12;
      if (buffer.readUInt16BE(record) !== 3 || buffer.readUInt16BE(record + 6) !== 0) continue;
      const from = strings + buffer.readUInt16BE(record + 10);
      return Buffer.from(buffer.subarray(from, from + buffer.readUInt16BE(record + 8))).swap16().toString('utf16le');
    }
  }
  return '';
}

/**
 * Lines of a licence text that are a copyright notice. Not Apache's appendix template ("Copyright [yyyy] [name of copyright owner]"), nor a
 * sentence that merely mentions a "copyright owner", nor a bare "Copyright" heading (jsPDF's notice continues on "(c) <years> <name>" lines).
 */
export function copyrightLines(text) {
  return [...text.matchAll(/^[ \t#]*(?:copyright\b|(?:\(c\)|©)\s*\d)[^\n]*$/gim)]
    .map((match) => match[0].replace(/^[ \t#]+/, '').trimEnd())
    .filter((line) => !/\[(yyyy|name of copyright owner)\]/i.test(line) && !/^copyright$/i.test(line) && !/^copyright (notice|owner|holder|license|statement|law|and|in)\b/i.test(line));
}

async function readIfThere(file) {
  try {
    return (await readFile(file, 'utf8')).replace(/\r\n/g, '\n').trimEnd();
  } catch {
    return null;
  }
}

async function licenceFor(base, dependency) {
  const candidates = dependency.files ?? ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE.markdown', 'LICENCE', 'license', 'license.md', 'LICENSE-MIT'].map((name) => `${dependency.lock ?? `node_modules/${dependency.name}`}/${name}`);
  const found = [];
  for (const relative of candidates) {
    const text = await readIfThere(path.join(base, relative));
    if (text) found.push({ relative, text });
    if (text && !dependency.files) break;
  }
  return found;
}

/**
 * @param {{ root?: string, dependencies?: typeof RUNTIME_DEPENDENCIES }} [options]
 * @returns {Promise<{ text: string, entries: object[], missing: string[], warnings: string[] }>}
 */
export async function buildNotices({ root: base = root, dependencies = RUNTIME_DEPENDENCIES } = {}) {
  const lock = JSON.parse(await readFile(path.join(base, 'package-lock.json'), 'utf8')).packages;
  const entries = [];
  const missing = [];
  const warnings = [];
  for (const dependency of dependencies) {
    const lockPath = dependency.lock ?? `node_modules/${dependency.name}`;
    const locked = lock[lockPath];
    if (!dependency.font && !locked) throw new Error(`${lockPath} is not in package-lock.json`);
    const version = dependency.version ?? locked.version;
    const installed = dependency.font ? null : JSON.parse((await readIfThere(path.join(base, lockPath, 'package.json'))) ?? 'null');
    if (installed && installed.version !== version) warnings.push(`${dependency.name}: the lock file says ${version} but node_modules holds ${installed.version}`);

    const files = await licenceFor(base, dependency);
    let texts = [...new Map(files.map((file) => [file.text, file])).values()];
    if (dependency.stopBefore) texts = texts.map((file) => ({ ...file, text: file.text.split(dependency.stopBefore)[0].trimEnd() }));
    const label = dependency.font ? dependency.name : `${dependency.name} ${version}`;
    const licence = (dependency.licenceName ?? locked?.license ?? 'not stated in the lock file').replace(/^\((.*)\)$/, '$1'); // the lock file writes (MIT AND Zlib)
    const lines = [RULE, label, `Licence: ${licence}`, `Used in: ${dependency.where}`];
    if (texts.length === 0) {
      missing.push(label);
      lines.push(`Licence file: NO LICENCE FILE FOUND in ${lockPath}/. Its licence text is not reproduced here and must be obtained from the package's own source.`);
    } else {
      lines.push(`Licence file${files.length > 1 ? 's' : ''}: ${files.map((file) => file.relative).join(', ')}${files.length > texts.length ? ' (identical text)' : ''}`);
      const copyright = [...new Set(texts.flatMap((file) => copyrightLines(file.text)))];
      if (dependency.fontFile) {
        const fromFont = fontCopyright(await readFile(path.join(base, dependency.fontFile)));
        if (fromFont) copyright.push(`${fromFont}   [read from the font file ${path.basename(dependency.fontFile)}, name ID 0; the licence file has no copyright line]`);
      }
      if (copyright.length > 0) lines.push(...copyright.map((line, index) => `${index === 0 ? 'Copyright line: ' : '                '}${line}`));
      else {
        const author = installed?.author;
        lines.push(`Copyright line: none in the licence file${author ? `; the package.json author field says ${typeof author === 'string' ? author : [author.name, author.email && `<${author.email}>`].filter(Boolean).join(' ')}` : ''}.`);
      }
      if (dependency.note) lines.push(`Note: ${dependency.note}`);
    }
    lines.push(THIN, ...texts.map((file) => file.text), '');
    entries.push({ name: dependency.name, version, label, lockPath, licence, files: texts.map((file) => file.relative), text: lines.join('\n') });
  }

  const index = entries.map((entry) => `  ${entry.label}  (${entry.licence ?? 'see entry'})`);
  const text = [
    'THIRD-PARTY NOTICES',
    '',
    'The Pursuit Managed Services pages (index.html, admin.html and setup.html) are single files that contain the open-source code and fonts listed here.',
    'Each licence asks that its notice travels with copies; this file is that notice. It is made by scripts/build-third-party-notices.js from the licence files',
    'in the project\'s node_modules folder and migration/src/assets, with the versions in package-lock.json.',
    '',
    'STATUS: a proposal for whoever owns licence compliance to confirm. It is an extra file to upload beside the pages; it is not part of them and changes none of them.',
    missing.length > 0 ? `\nLICENCE FILES MISSING FOR: ${missing.join(', ')}. Those entries say so and carry no licence text.\n` : '',
    'Contents',
    ...index,
    '',
    ...entries.map((entry) => entry.text),
  ].join('\n').replace(/\n{3,}/g, '\n\n');
  return { text: `${text.trimEnd()}\n`, entries, missing, warnings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const output = path.resolve(process.argv[2] ?? path.join(root, 'build-svelte', 'THIRD-PARTY-NOTICES.txt'));
  const { text, entries, missing, warnings } = await buildNotices();
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, text);
  console.log(`${path.relative(root, output)}: ${entries.length} entries, ${text.length} characters`);
  for (const line of warnings) console.log(`WARNING: ${line}`);
  console.log(missing.length > 0 ? `LICENCE FILE MISSING for: ${missing.join(', ')}` : 'Every entry has a licence file.');
}
