// `npm run dev`: everything needed to try the app on this computer, in one command, with a local dummy database.
//
//   npm run dev                  the local server (API + pictures) and the three pages, with dummy data in .local-data/
//   npm run dev -- --reset       throw the dummy data away and start again from the seed (server/data)
//   npm run dev -- --only admin  only that page (participant, admin or setup; a comma-separated list works); the server always runs
//   npm run dev -- --open        also open the participant and admin pages in the browser
//
// What it starts (the same processes the old docs asked for in four terminals):
//   server/index.js   the stand-in for SharePoint: the JSON-file API under /api and the uploaded pictures (port 3000)
//   Vite x 3          the participant page (5173), the admin page (5175) and Setup (5176), each sending /api and /assets to the server
//
// The dummy data is a COPY of server/data (and of the pictures in public/assets/images/clients) made on first run into .local-data/, which git
// ignores. Playing with the app therefore never changes a tracked file, and the tree stays clean for `npm run package:release`.
// Ports can be moved with PORT, VITE_PORT, VITE_ADMIN_PORT and VITE_SETUP_PORT. It is development only: nothing here goes into a page.

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isPortFree, portFor, PORTS, stripAnsi } from './local-env.js';
import { ensureInstalled, ensureNode, ROOT } from './node-guard.js';

ensureNode(import.meta.filename);
ensureInstalled();

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
if (has('help') || args.includes('-h')) {
  console.log('npm run dev [-- --reset] [-- --only participant|admin|setup] [-- --open]');
  process.exit(0);
}

const PAGE_DEFS = [
  { key: 'participant', label: 'Participant', config: 'migration/vite.config.ts', path: '/' },
  { key: 'admin', label: 'Admin', config: 'migration/vite.admin.config.ts', path: '/admin.html' },
  { key: 'setup', label: 'Setup', config: 'migration/vite.setup.config.ts', path: '/setup.html' },
];
const onlyAt = args.indexOf('--only');
const only = onlyAt >= 0 ? String(args[onlyAt + 1] ?? '').split(',').filter(Boolean) : null;
const pages = PAGE_DEFS.filter((page) => !only || only.includes(page.key)).map((page) => ({ ...page, port: portFor(page.key), env: PORTS[page.key].env }));
if (!pages.length) {
  console.error('  --only takes participant, admin or setup (or a comma-separated list).');
  process.exit(1);
}
const apiPort = portFor('server');

// ---- The dummy database -------------------------------------------------------------------------------------------------------------
const localRoot = path.join(ROOT, '.local-data');
const userChoseData = Boolean(process.env.DATA_DIR);
const dataDir = userChoseData ? path.resolve(process.env.DATA_DIR) : path.join(localRoot, 'data');
const uploadDir = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(localRoot, 'uploads');

/** Copies the seed into .local-data/ the first time (or after --reset). A DATA_DIR the user set is theirs and is never touched. */
function prepareData() {
  if (userChoseData) return;
  if (has('reset')) rmSync(localRoot, { recursive: true, force: true });
  if (existsSync(dataDir)) return;
  mkdirSync(dataDir, { recursive: true });
  const seed = path.join(ROOT, 'server', 'data');
  for (const file of readdirSync(seed).filter((name) => name.endsWith('.json'))) cpSync(path.join(seed, file), path.join(dataDir, file));
  mkdirSync(uploadDir, { recursive: true });
  const pictures = path.join(ROOT, 'public', 'assets', 'images', 'clients');
  if (existsSync(pictures)) cpSync(pictures, uploadDir, { recursive: true });
  console.log(`  Made a fresh dummy database in ${path.relative(ROOT, localRoot)}/ (a copy of server/data).`);
}

// ---- Ports --------------------------------------------------------------------------------------------------------------------------
async function checkPorts() {
  const wanted = [{ name: 'the server', port: apiPort, env: PORTS.server.env }, ...pages.map((page) => ({ name: `the ${page.key} page`, port: page.port, env: page.env }))];
  const free = await Promise.all(wanted.map((item) => isPortFree(item.port)));
  const busy = wanted.filter((_, at) => !free[at]);
  if (!busy.length) return;
  console.error('\n  These ports are already in use, probably by an earlier `npm run dev` that is still open:');
  for (const item of busy) console.error(`    ${item.port}  (${item.name}; to move it: set ${item.env}=<another port>)`);
  console.error('  Close that window (Ctrl+C in it), or use other ports, and run this again.\n');
  process.exit(1);
}

// ---- The processes and their output ---------------------------------------------------------------------------------------------------
const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const baseEnv = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', PORT: String(apiPort), CEC_DEV_API_TARGET: `http://localhost:${apiPort}` };
const children = [];
const up = new Set(); // labels of the processes that have said they are listening
let stopping = false;

// Lines that only repeat what the summary says, or that are Vite's own banner.
const QUIET = /^\s*(➜|VITE v|press h|pursuits-cec API running|api:|data:|pages:|LAN:|\(!\)|\d+:\d+:\d+ [AP]M \[vite\] \(client\) (Forced re-optimization|Re-optimizing))/i;

function start(label, scriptArgs, extraEnv = {}) {
  const child = spawn(process.execPath, scriptArgs, { cwd: ROOT, env: { ...baseEnv, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const onData = (chunk) => {
    for (const raw of String(chunk).split(/\r?\n/)) {
      const line = stripAnsi(raw);
      if (!line.trim()) continue;
      if (/API running|Local:/.test(line) && !up.has(label)) {
        up.add(label);
        if (up.size === pages.length + 1) printSummary();
      }
      if (!QUIET.test(line)) console.log(`[${label}] ${line}`);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code) => {
    if (stopping) return;
    console.error(`\n  [${label}] stopped on its own (exit ${code}). Scroll up for the reason. Stopping the rest.\n`);
    stop(1);
  });
}

function stop(code = 0) {
  stopping = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 400);
}

// ---- What the person sees -----------------------------------------------------------------------------------------------------------
const lanAddress = () => Object.values(os.networkInterfaces()).flat().find((nic) => nic?.family === 'IPv4' && !nic.internal)?.address ?? null;

function openInBrowser(urls) {
  const [command, prefix] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '']] : process.platform === 'darwin' ? ['open', []] : ['xdg-open', []];
  for (const url of urls) spawn(command, [...prefix, url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

function printSummary() {
  const lan = lanAddress();
  const row = (name, url) => console.log(`  ${name.padEnd(13)}${url}`);
  console.log('\n  Pursuit Managed Services: running locally with dummy data\n');
  for (const page of pages) row(page.label, `http://localhost:${page.port}${page.path}`);
  if (lan) row('iPad / phone', `http://${lan}:${pages[0].port}${pages[0].path}   (same Wi-Fi; the admin page is the same address with its port)`);
  row('Server (API)', `http://localhost:${apiPort}/api`);
  console.log(`\n  Demo admin PIN: 1234        Dummy data: ${userChoseData ? dataDir : path.relative(ROOT, dataDir) + '/'}   (start again with: npm run dev -- --reset)`);
  console.log('  Change a file and the page reloads by itself.  Stop everything with Ctrl+C.\n');
  if (has('open')) openInBrowser(pages.filter((page) => page.key !== 'setup').map((page) => `http://localhost:${page.port}${page.path}`));
}

// ---- Go -----------------------------------------------------------------------------------------------------------------------------
prepareData();
await checkPorts();
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
start('server', ['--watch', 'server/index.js'], { DATA_DIR: dataDir, UPLOAD_DIR: uploadDir });
for (const page of pages) start(page.key, [viteBin, '--config', page.config], { [page.env]: String(page.port) });
