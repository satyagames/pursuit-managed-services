// Writes docs/project-map.json: the project in one machine-readable file, for a model or a tool to orient by. Phase 14.
// Every fact is read from its source (package.json, the schema file, the chart model, the module map's folder purposes); the few words written
// here are the roles of the libraries and the commands' meanings, and the test holds each command and library to package.json.
//
//   npm run docs:project-map     write docs/project-map.json
//   (scripts/test-project-map.js, in npm test, fails when the committed file is not what this would write)
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIBRARY, LISTS, VERSION } from '../migration/src/lib/schema/pms-schema.js';
import { META } from '../migration/src/lib/schema/pms-schema-meta.js';
import { chartKind } from '../migration/src/lib/results/results-chart-model.js';
import { PURPOSE } from './build-modules-map.js';

const ROOT = path.join(import.meta.dirname, '..');
export const PROJECT_MAP_FILE = path.join(ROOT, 'docs', 'project-map.json');

/** What each library is for. The test fails on a library of package.json with no role here, or a role for one that is not there. */
export const ROLES = {
  svelte: 'UI framework (Svelte 5, runes) of the three pages',
  'svelte-spa-router': 'hash routes of the participant page',
  jspdf: 'PDF writer: the leader report and the summary pack (admin page only)',
  pptxgenjs: 'PowerPoint writer: the summary pack (admin page only)',
  'lean-qr': 'QR codes on the admin page',
  'canvas-confetti': 'confetti, behind lib/effects/effects.ts',
  express: 'the local stand-in for SharePoint (server/), development and tests only',
  cors: 'the local server',
  vite: 'build and dev server',
  'vite-plugin-singlefile': 'inlines everything so each page is one HTML file',
  '@sveltejs/vite-plugin-svelte': 'Svelte in Vite',
  tailwindcss: 'utility CSS (Tailwind 4)',
  '@tailwindcss/vite': 'Tailwind in Vite',
  typescript: 'types of the .ts and .svelte files',
  'svelte-check': 'npm run check:svelte',
  '@playwright/test': 'browser tests in Chromium, WebKit and Firefox',
  '@axe-core/playwright': 'accessibility checks in the browser tests (in no page)',
  'pdfjs-dist': 'reads back the PDFs the tests make (in no page)',
  'chart.js': 'only the bundle test\'s deliberately leaky build: no page uses it',
  cheerio: 'reads built HTML in the build tests and the bundle analysis',
  esbuild: 'bundles the audio analysis for a browser test',
};

/** The commands a newcomer needs, and what each does. The test fails on one that package.json does not have. */
export const COMMANDS = {
  'npm install': 'install the dependencies',
  'npm run dev': 'the local server (API and pictures, no page) on port 3000',
  'npm run dev:svelte': 'the participant page from Vite (5173); dev:svelte:admin 5175, dev:svelte:setup 5176',
  'npm run build:svelte:release': 'build the three pages into build-svelte/release/',
  'npm run check:svelte': 'type and accessibility diagnostics',
  'npm test': 'every node suite (about 20 s)',
  'npm run test:migration': 'build and run the browser specs (Chromium, WebKit, Firefox)',
  'npm run test:report': 'the leader report, CSVs and summary pack, read back',
  'npm run test:report:mutations': 'the report tests catch deliberate breakages',
  'npm run oracle -- --seeds 500': 'recount 500 random sessions with independent rules',
  'npm run test:charts': 'the Results charts\' numbers and palette',
  'npm run test:bundle': 'page sizes and what the participant page must not carry',
  'npm run local:site -- --open': 'the local PCOE stand-in, serving the newest release package',
  'npm run package:release': 'the release package (clean committed tree only)',
  'npm run docs:check': 'the documents name only what is there',
};

export function projectMap() {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const library = (deps, dev) => Object.entries(deps).sort().map(([name, version]) => ({ name, version, dev, role: ROLES[name] ?? null }));
  return {
    name: 'Pursuit Managed Services',
    package: pkg.name,
    purpose: 'An interactive session app for Deloitte client visits: participants answer short activities on iPads, a facilitator runs the day and shows live results, leaders get a report. Three single-file HTML pages that run from a SharePoint document folder and keep their data in SharePoint lists, through the browser\'s own sign-in; no server, no CDN.',
    node: pkg.engines.node,
    runtime: 'three static HTML pages in one SharePoint document folder; same-origin SharePoint REST (/_api) with the signed-in user; settings in pms-config.txt beside the pages',
    pages: [
      { page: 'index.html', who: 'participants (iPads)', shell: 'migration/index.html', entry: 'migration/src/main.ts', app: 'migration/src/App.svelte', vite: 'migration/vite.config.ts' },
      { page: 'admin.html', who: 'facilitators and admins (PIN)', shell: 'migration/admin.html', entry: 'migration/src/admin-main.ts', app: 'migration/src/AdminApp.svelte', vite: 'migration/vite.admin.config.ts' },
      { page: 'setup.html', who: 'the site owner', shell: 'migration/setup.html', entry: 'migration/src/setup-main.ts', app: 'migration/src/SetupApp.svelte', vite: 'migration/vite.setup.config.ts' },
    ],
    stack: [...library(pkg.dependencies, false), ...library(pkg.devDependencies, true)],
    sharePoint: {
      schemaVersion: VERSION,
      lists: Object.entries(LISTS).map(([key, { title }]) => ({ key, title, purpose: META[key].purpose })),
      library: LIBRARY,
      schemaFiles: ['migration/src/lib/schema/pms-schema.js', 'migration/src/lib/schema/pms-schema-meta.js'],
      reference: 'SHAREPOINT-LISTS.md',
    },
    questionTypes: META.questions.columns.QuestionType.values.map((type) => ({ type, chart: chartKind(type) })),
    commands: COMMANDS,
    gates: ['npm run check:svelte', 'npm test', 'npm run test:baseline', 'npm run test:bundle', 'npm run test:report', 'npm run test:report:mutations', 'npm run oracle -- --seeds 500', 'npm run test:charts', 'npm run test:local-site', 'npm run test:migration'],
    folders: Object.fromEntries(Object.entries(PURPOSE).sort()),
    documents: {
      'CLAUDE.md': 'start here', 'docs/MODULES.md': 'module map', 'docs/DATA-FLOW.md': 'data flow', 'docs/SHAREPOINT.md': 'SharePoint and deployment', 'docs/ONBOARDING.md': 'adding a person to the site',
      'docs/DECISIONS.md': 'binding decisions', 'docs/RULES.md': 'rule book', 'docs/TESTING.md': 'gates', 'docs/HISTORY.md': 'phases', 'QA-TESTING.md': 'manual checks',
    },
  };
}

export const projectMapText = () => `${JSON.stringify(projectMap(), null, 2)}\n`;

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  writeFileSync(PROJECT_MAP_FILE, projectMapText());
  console.log(`wrote ${path.relative(ROOT, PROJECT_MAP_FILE)}`);
}
