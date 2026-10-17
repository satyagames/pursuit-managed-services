// Bundle analysis for the three standalone pages (participant, admin, setup).
//
//   node scripts/analyze-bundle.js [--label before] [--top 12] [--json]
//
// Builds each page with the project's own Vite config into a scratch folder (build-svelte/.analysis/<page>/,
// so build-svelte/release is never touched) with one small inline Rollup plugin that records, for every
// module that ends up in the page, the code it contributes. No dependency is added: the plugin is the
// ~20 lines below, and Vite merges it into the existing config.
//
// What the numbers mean. The bundler reports a module's code before minification, so a group's bytes are
// measured on that code and then scaled so that all groups add up to the REAL minified script of the page
// (raw and gzip -9 each get their own scale), and the gzip figures of script, styles and inlined fonts are then
// scaled to add up to the page's real gzip. They are estimates of each group's share, good to a few percent;
// the page totals are exact and are what the budgets are checked against.
// Fonts and pictures inlined in the CSS as data: URIs are listed on their own lines.
//
// The same functions are used by scripts/test-bundle-budget.js, which turns the totals into `npm test` failures.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { load } from 'cheerio';
import { build } from 'vite';

export const ROOT = path.join(import.meta.dirname, '..');
export const PAGES = [
  { name: 'participant', config: 'migration/vite.config.ts', html: 'index.html' },
  { name: 'admin', config: 'migration/vite.admin.config.ts', html: 'admin.html' },
  { name: 'setup', config: 'migration/vite.setup.config.ts', html: 'setup.html' },
];

const gzipSize = (data) => gzipSync(data, { level: 9 }).length;

/** Which group a module belongs to: the npm package, or the folder of the project file. */
export function groupOf(id) {
  const clean = id.split('?')[0];
  if (clean.startsWith('\0')) return '(bundler runtime)';
  const marker = clean.lastIndexOf('/node_modules/');
  if (marker !== -1) {
    const parts = clean.slice(marker + '/node_modules/'.length).split('/');
    return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
  }
  const relative = path.relative(ROOT, clean).split(path.sep);
  if (relative[0] === 'migration' && relative[1] === 'src') {
    if (relative[2] === 'lib' && relative.length > 4) return `migration/src/lib/${relative[3]}/`;
    return relative.length > 3 ? `migration/src/${relative[2]}/` : 'migration/src (root)';
  }
  return relative.slice(0, 2).join('/');
}

function collector(sink) {
  return {
    name: 'bundle-analysis',
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk') {
          sink.chunks.push({
            code: item.code,
            modules: Object.entries(item.modules ?? {}).map(([id, module]) => ({ id, code: module.code ?? '', rendered: module.renderedLength ?? 0 })),
          });
        }
      }
    },
  };
}

/** The text of the page's <style> elements (parsed, so a "<style" inside a script string is not one). */
export function styleText(html) {
  const $ = load(html);
  return $('style').map((_index, element) => $(element).text()).get().join('\n');
}

/** Splits CSS into the base64 data: URIs (fonts, pictures) and everything else. */
function splitCss(css) {
  const uris = css.match(/url\(\s*["']?data:[^)]*\)/g) ?? [];
  return { uris: uris.join('\n'), rest: css.replace(/url\(\s*["']?data:[^)]*\)/g, 'url()'), count: uris.length };
}

/** Builds one page into the scratch folder and returns what it is made of. */
export async function analyzePage(page, { outRoot = path.join(ROOT, 'build-svelte', '.analysis'), extraPlugins = [], keepHtml = false } = {}) {
  const outDir = path.join(outRoot, page.name);
  const sink = { chunks: [] };
  await build({
    configFile: path.join(ROOT, page.config),
    plugins: [collector(sink), ...extraPlugins],
    build: { outDir, emptyOutDir: true },
    logLevel: 'silent',
  });
  const html = await readFile(path.join(outDir, page.html));
  const result = { name: page.name, htmlBytes: html.length, htmlGzip: gzipSize(html), html: keepHtml ? html.toString('utf8') : undefined };

  // JS: group the modules, then scale to the minified chunk.
  const groups = new Map();
  const modules = [];
  for (const chunk of sink.chunks) {
    for (const module of chunk.modules) {
      // A stylesheet is measured from the finished page below (vite-plugin-singlefile inlines it before this plugin sees it).
      if (module.id.split('?')[0].endsWith('.css')) continue;
      const group = groupOf(module.id);
      const entry = groups.get(group) ?? { group, rendered: 0, parts: [], modules: 0 };
      entry.rendered += module.rendered;
      entry.parts.push(module.code);
      entry.modules += 1;
      groups.set(group, entry);
      modules.push({ id: path.relative(ROOT, module.id.split('?')[0]).replaceAll(path.sep, '/'), group, rendered: module.rendered, gzip: gzipSize(module.code) });
    }
  }
  const scriptCode = sink.chunks.map((chunk) => chunk.code).join('\n');
  const scriptRaw = Buffer.byteLength(scriptCode);
  const scriptGzip = gzipSize(scriptCode);
  const measured = [...groups.values()].map((entry) => ({ ...entry, gzipOwn: gzipSize(entry.parts.join('\n')) }));
  const sumRendered = measured.reduce((sum, entry) => sum + entry.rendered, 0) || 1;
  const sumGzip = measured.reduce((sum, entry) => sum + entry.gzipOwn, 0) || 1;
  result.groups = measured
    .map((entry) => ({ group: entry.group, modules: entry.modules, raw: Math.round(entry.rendered * (scriptRaw / sumRendered)), gzip: Math.round(entry.gzipOwn * (scriptGzip / sumGzip)) }))
    .sort((a, b) => b.gzip - a.gzip);
  const moduleGzipTotal = modules.reduce((sum, module) => sum + module.gzip, 0) || 1;
  result.modules = modules
    .map((module) => ({ ...module, raw: Math.round(module.rendered * (scriptRaw / sumRendered)), gzip: Math.round(module.gzip * (scriptGzip / moduleGzipTotal)) }))
    .sort((a, b) => b.gzip - a.gzip);
  result.script = { raw: scriptRaw, gzip: scriptGzip };

  // CSS: data: URIs on their own, the rest as styles.
  const css = styleText(html.toString('utf8'));
  const { uris, rest, count } = splitCss(css);
  result.css = { raw: Buffer.byteLength(rest), gzip: gzipSize(rest) };
  result.inlined = { count, raw: Buffer.byteLength(uris), gzip: uris ? gzipSize(uris) : 0 };

  // Compressed on their own the parts add up to more than the page (one gzip stream finds repeats across
  // them), so every gzip estimate is scaled by the same factor until they add up to the page's exact size.
  const parts = result.script.gzip + result.css.gzip + result.inlined.gzip;
  const fit = result.htmlGzip / parts;
  for (const row of [...result.groups, ...result.modules]) row.gzip = Math.round(row.gzip * fit);
  result.css.gzip = Math.round(result.css.gzip * fit);
  result.inlined.gzip = Math.round(result.inlined.gzip * fit);
  result.script.gzip = Math.round(result.script.gzip * fit);
  return result;
}

export async function analyzeBuilds(options = {}) {
  const results = [];
  for (const page of PAGES) results.push(await analyzePage(page, options));
  return results;
}

const kb = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;

export function formatTable(result, top = 12) {
  const lines = [];
  lines.push(`### ${result.name} (${result.name === 'participant' ? 'index.html' : `${result.name}.html`}): ${result.htmlGzip.toLocaleString('en-US')} B gzip -9, ${result.htmlBytes.toLocaleString('en-US')} B raw`);
  lines.push('');
  lines.push('| Contributor | Modules | Raw (est.) | Gzip (est.) | Share of page gzip |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  const rows = result.groups.slice(0, top);
  const other = result.groups.slice(top);
  for (const row of rows) lines.push(`| ${row.group} | ${row.modules} | ${kb(row.raw)} | ${kb(row.gzip)} | ${((row.gzip / result.htmlGzip) * 100).toFixed(1)}% |`);
  if (other.length) {
    const gzip = other.reduce((sum, row) => sum + row.gzip, 0);
    const raw = other.reduce((sum, row) => sum + row.raw, 0);
    lines.push(`| ${other.length} smaller groups | ${other.reduce((sum, row) => sum + row.modules, 0)} | ${kb(raw)} | ${kb(gzip)} | ${((gzip / result.htmlGzip) * 100).toFixed(1)}% |`);
  }
  lines.push(`| CSS (styles) | | ${kb(result.css.raw)} | ${kb(result.css.gzip)} | ${((result.css.gzip / result.htmlGzip) * 100).toFixed(1)}% |`);
  lines.push(`| Inlined data: URIs in CSS (${result.inlined.count}: fonts, pictures) | | ${kb(result.inlined.raw)} | ${kb(result.inlined.gzip)} | ${((result.inlined.gzip / result.htmlGzip) * 100).toFixed(1)}% |`);
  lines.push('');
  lines.push(`Script total: ${kb(result.script.raw)} raw, ${kb(result.script.gzip)} gzip. Parts are scaled to add up to the page total above, which is exact.`);
  return lines.join('\n');
}

export function formatModules(result, top = 10) {
  const lines = [`Largest single modules in ${result.name}:`, '', '| Module | Raw (est.) | Gzip (est.) |', '| --- | ---: | ---: |'];
  for (const module of result.modules.slice(0, top)) lines.push(`| ${module.id} | ${kb(module.raw)} | ${kb(module.gzip)} |`);
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const top = Number(option('--top', 12));
  const label = option('--label', '');
  const results = await analyzeBuilds();
  for (const result of results) {
    console.log(formatTable(result, top));
    console.log('');
    console.log(formatModules(result, 8));
    console.log('');
  }
  if (label) {
    const dir = path.join(ROOT, 'test-results', 'bundle');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${label}.json`), JSON.stringify(results.map(({ html, ...rest }) => rest), null, 2));
    console.log(`Saved test-results/bundle/${label}.json`);
  }
  // The scratch folder is not a release: remove it.
  await rm(path.join(ROOT, 'build-svelte', '.analysis'), { recursive: true, force: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
