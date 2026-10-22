// Writes docs/MODULES.md, the module map, from the code: for each folder of migration/src and scripts, what it is for (the one hand-written
// line below), and, read from the files themselves, each module's header, its exports, the folders it imports, the folders that import it and
// the node suites that import it. Phase 14.
//
//   npm run docs:modules     write docs/MODULES.md
//   (scripts/test-modules-map.js, in npm test, fails when the committed file is not what this would write, or a folder has no purpose here)
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { headerOf } from './module-header.js';

const ROOT = path.join(import.meta.dirname, '..');
export const MODULES_FILE = path.join(ROOT, 'docs', 'MODULES.md');

/** What each folder is for: the only words of the map written by hand. A folder with code and no line here fails the test. */
export const PURPOSE = {
  'migration/src': 'The three entries (`main.ts`, `admin-main.ts`, `setup-main.ts`), the three apps (`App.svelte`, `AdminApp.svelte`, `SetupApp.svelte`) and their page-wide CSS. The HTML shells are `migration/index.html`, `admin.html` and `setup.html`.',
  'migration/src/lib/data': 'The data layer: dataService.js, the door every page imports, over its parts (core.js holds the state and alone talks to SharePoint REST or, on the local server, its JSON API), and grouping of long id lists into short reads. Every page carries it.',
  'migration/src/lib/schema': 'The lists and columns: `pms-schema.js`, the names every page carries, and `pms-schema-meta.js`, everything else about them (Setup, the tests and the generators only).',
  'migration/src/lib/settings': 'How a page starts: the browser check, where its settings come from (`pms-config.txt`, the build, its address), which site and lists are its own, and the stop screen.',
  'migration/src/lib/participant': 'The participant page: the boot sequence, the visit, the activities held for the page\'s life, the pager\'s rules, saving answers, screen moves.',
  'migration/src/lib/common': 'Shared by the pages: the product name, the heading focus rule, kiosk lock-down, the polling schedule and its one timer, the admin page\'s address.',
  'migration/src/lib/admin': 'The admin page\'s rules and data: Today, Clients, Content, Guests and QR, Results, the Live display\'s session, the PIN check.',
  'migration/src/lib/results': 'Results counted and shown: the tally, the chart model (every number a chart shows), the palette, the figure on paper, names, the takeaways, where a tooltip goes.',
  'migration/src/lib/exports': 'The files a leader gets: the leader report (data, counting, layout, PDF writer, fonts) and the Live display\'s summary pack (PDF, PowerPoint) and summary CSV.',
  'migration/src/lib/brand': 'A client\'s look: deriving a readable theme from a colour, the stored theme, Brand Studio\'s rules, picture slots, cropping, compressing and naming.',
  'migration/src/lib/effects': 'Sounds and confetti, behind one door (`effects.ts`): which moment makes which effect, the cues as data, Web Audio, canvas-confetti.',
  'migration/src/lib/motion': 'The participant screens\' motion, behind one door (`motion.ts`): the plan by kind of question and part of a screen, the tokens and shapes (CSS), the level and the governor.',
  'migration/src/lib/setup': 'The Setup page\'s own modules: the plan and Create, Mark the site as ready, the admins, the seed-file import, the sample clients and their pictures, the self-test\'s probes.',
  'migration/src/admin': 'The admin page\'s screens (Svelte): the five tabs, Brand Studio, dialogs, the Live display, the print sheet, the report buttons.',
  'migration/src/admin/charts': 'The Results charts, drawn by hand in HTML and SVG (no chart library): the card, bars, the scale, the split bar, words, names, the table view, the tooltip.',
  'migration/src/components': 'The participant page\'s building blocks (Svelte): the shell, pills, buttons, the hero plate, tiles, the progress bar, the sound switch.',
  'migration/src/pager': 'The pager: one question per screen, its answers, and an activity\'s completion screen.',
  'migration/src/routes': 'The participant page\'s screens: Welcome, the Activities hub, the quiz route, the finale, "not live", the preview, and the old addresses that redirect.',
  'migration/src/setup': 'Setup\'s pieces (Svelte): the copy panel, where the lists are, the plan view, and the sample pictures as data.',
  'migration/src/dev': 'The styleguide, `#/styleguide` on the dev server only (absent from builds).',
  'migration/src/unsupported': 'The "needs a recent browser" notice: a page and an ES5 check, put into each HTML shell at build time.',
  'migration/src/styles': 'Tokens (colour, type), the focus ring, the fonts (inlined Open Sans and the metric-matched fallback), the Results palette, and `legacy/`, the old sheets the pages still load.',
  'migration/src/assets/report-fonts': 'The Open Sans subset of the leader report (generated by `npm run build:report-fonts`, with its licence).',
  'migration/src/assets': 'Inlined assets: Open Sans as WOFF2, the report\'s TrueType subset, the six sample pictures.',
  'scripts': 'Node tests (`test-*.js`, run by `npm test` and the `test:*` scripts), the mocked SharePoint (`sharepoint-fake.js`), the oracle, the bundle and request baselines, the generators and the release packager.',
  'scripts/migration-tests': 'The Playwright specs of `npm run test:migration`, and their harnesses (`admin-local.ts`, `polling-support.ts`, `fixtures.ts`).',
  'scripts/local-site': 'The local PCOE stand-in (`npm run local:site`), its scenarios and VJR\'s dummy dataset, the screenshot harness and the measurements.',
  'scripts/rehearsal-tests': 'The rehearsal of RUNBOOK.md on the mock with a package\'s own pages (`npm run test:rehearsal`).',
  'scripts/styleguide-tests': 'The styleguide\'s audit (`npm run test:styleguide`).',
  'scripts/request-baseline': 'Every SharePoint request each recorded suite sends, as recorded at `legacy-final` and amended only on purpose (`npm run test:baseline`).',
  'scripts/schema-baseline': 'The schema as it was before Phase 10c-2b, and the scripts that translated the request baselines (each baseline names the one that touched it).',
  'server': 'The local stand-in for SharePoint: an Express API over JSON files (`server/data/`, committed seed data), with ETag concurrency and picture uploads. Development and tests only.',
};

const files = execSync('git ls-files migration/src scripts server', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
const code = files.filter((file) => /\.(js|mjs|ts|svelte)$/.test(file) && !file.startsWith('scripts/request-baseline/'));
const text = new Map(code.map((file) => [file, readFileSync(path.join(ROOT, file), 'utf8')]));
const folderOf = (file) => path.posix.dirname(file);

/** What a file imports, resolved to tracked files (a .js spelling of a .ts file included). */
function importsOf(file) {
  const out = new Set();
  for (const match of text.get(file).matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"?]+)/g)) {
    const target = path.posix.normalize(path.posix.join(folderOf(file), match[1]));
    for (const candidate of [target, target.replace(/\.js$/, '.ts'), `${target}.js`, `${target}.ts`, `${target}/index.ts`]) {
      if (text.has(candidate)) { out.add(candidate); break; }
    }
  }
  return [...out];
}
const graph = new Map(code.map((file) => [file, importsOf(file)]));

function exportsOf(source) {
  const names = new Set();
  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(',')) { const name = part.trim().split(/\s+as\s+/).pop().trim(); if (name && name !== 'type') names.add(name); }
  }
  if (/export\s+default\b/.test(source)) names.add('default');
  return [...names];
}

/** The first sentence of a module's header. */
function firstSentence(source) {
  const header = headerOf(source).split('\n').map((line) => line.replace(/^\s*(\/\*\*?|\*\/|\*|\/\/)\s?/, '').trim()).join(' ').replace(/\s+/g, ' ').trim();
  const end = header.search(/(?<=[.:])\s(?=[A-Z(`])/);
  return (end > 0 ? header.slice(0, end) : header).replace(/\|/g, '\\|');
}

const label = (folder) => folder.replace(/^migration\/src\/lib\//, 'lib/').replace(/^migration\/src\/?/, 'src/').replace(/\/$/, '') || 'src';

/** docs/MODULES.md, as text. */
export function modulesMap() {
  const folders = [...new Set(code.map(folderOf))].sort();
  const lines = [];
  const add = (...more) => lines.push(...more);
  add('# Module map', '',
    '<!-- Generated by scripts/build-modules-map.js from the code and the folder purposes written in it. Do not edit by hand: run `npm run docs:modules` (scripts/test-modules-map.js fails when this file is stale). -->',
    '',
    'Where the code is and what each part may touch. The folders of `migration/src/lib` are the modules; each file in them starts with a header that',
    'says what it owns, what it reads and writes, and what it must not do (`scripts/test-module-headers.js` holds that). The data flow is',
    '[DATA-FLOW.md](DATA-FLOW.md), the rules of each part [RULES.md](RULES.md).', '',
    '## How the lib folders depend on each other', '',
    'An arrow means "imports from", read from the code. What each built page really carries is what `npm run analyze:bundle` lists, by folder; `npm run test:bundle`',
    'holds what the participant page must not carry (the libraries of the admin page, the Results charts, the exports, the modules of Setup).', '', '```mermaid', 'flowchart LR');
  const libFolders = folders.filter((folder) => folder.startsWith('migration/src/lib/'));
  const edges = new Set();
  for (const from of libFolders) {
    for (const file of code.filter((f) => folderOf(f) === from)) {
      for (const target of graph.get(file)) {
        const to = folderOf(target);
        if (to !== from && libFolders.includes(to)) edges.add(`  ${label(from).replace('lib/', '')} --> ${label(to).replace('lib/', '')}`);
      }
    }
  }
  add(...[...edges].sort(), '```', '', '## The folders', '', '| Folder | What it is for | Files |', '|---|---|---:|');
  for (const folder of folders) {
    const count = code.filter((file) => folderOf(file) === folder).length;
    add(`| \`${folder}/\` | ${PURPOSE[folder] ?? ''} | ${count} |`);
  }
  for (const folder of libFolders) {
    const own = code.filter((file) => folderOf(file) === folder).sort();
    const usedBy = new Set();
    const tests = new Set();
    const uses = new Set();
    for (const file of own) {
      for (const target of graph.get(file)) if (folderOf(target) !== folder) uses.add(label(folderOf(target)));
    }
    for (const [file, targets] of graph) {
      if (folderOf(file) === folder || !targets.some((target) => folderOf(target) === folder)) continue;
      if (/^scripts\/test-[\w-]+\.js$/.test(file)) tests.add(path.posix.basename(file));
      else if (!file.startsWith('scripts/')) usedBy.add(label(folderOf(file)));
    }
    add('', `## \`${label(folder)}/\``, '', PURPOSE[folder], '',
      `- **Imports from:** ${[...uses].sort().map((name) => `\`${name}\``).join(', ') || 'nothing of the app'}`,
      `- **Imported by:** ${[...usedBy].sort().map((name) => `\`${name}\``).join(', ') || 'no other folder'}`,
      `- **Node suites that import it:** ${[...tests].sort().map((name) => `\`${name}\``).join(', ') || 'none directly (the browser specs and the suites of the modules that use it)'}`,
      '', '| Module | What it is (its header) | Exports |', '|---|---|---|');
    for (const file of own) {
      const names = exportsOf(text.get(file));
      add(`| \`${path.posix.basename(file)}\` | ${firstSentence(text.get(file))} | ${names.length > 14 ? `${names.length} exports` : names.map((name) => `\`${name}\``).join(', ')} |`);
    }
  }
  add('', '## Pages and their entries', '',
    '| Page | HTML shell | Entry | App | Vite config |', '|---|---|---|---|---|',
    '| Participant (`index.html`) | `migration/index.html` | `migration/src/main.ts` | `migration/src/App.svelte` | `migration/vite.config.ts` |',
    '| Admin (`admin.html`) | `migration/admin.html` | `migration/src/admin-main.ts` | `migration/src/AdminApp.svelte` | `migration/vite.admin.config.ts` |',
    '| Setup (`setup.html`) | `migration/setup.html` | `migration/src/setup-main.ts` | `migration/src/SetupApp.svelte` | `migration/vite.setup.config.ts` |',
    '', '`npm run build:svelte:release` (`scripts/build-svelte-release.js`) builds the three into one file each with `vite-plugin-singlefile`.', '');
  return lines.join('\n');
}

export const foldersWithoutPurpose = () => [...new Set(code.map(folderOf))].filter((folder) => !PURPOSE[folder]);

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  writeFileSync(MODULES_FILE, modulesMap());
  console.log(`wrote ${path.relative(ROOT, MODULES_FILE)}`);
}
