// `npm run dev`: everything needed to try the app on this computer, in one command, with a local dummy database.
//
//   npm run dev                  the local server (API + pictures) and the three pages, with dummy data in .local-data/
//   npm run dev -- --reset       throw the dummy data away and start again from the seed (server/data)
//   npm run dev -- --only admin  only that page (participant, admin or setup); the server always runs
//   npm run dev -- --open        also open the participant and admin pages in the browser
//
// What it starts (the same four processes the old docs asked for in four terminals):
//   server/index.js   the stand-in for SharePoint: the JSON-file API under /api and the uploaded pictures (port 3000)
//   Vite x 3          the participant page (5173), the admin page (5175) and Setup (5176), each sending /api and /assets to the server
//
// The dummy data is a COPY of server/data (and of the pictures in public/assets/images/clients) made on first run into .local-data/, which git
// ignores. Playing with the app therefore never changes a tracked file, and the tree stays clean for `npm run package:release`.
// Ports can be moved with PORT, VITE_PORT, VITE_ADMIN_PORT and VITE_SETUP_PORT. It is development only: nothing here goes into a page.

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ensureInstalled, ensureNode, ROOT } from './node-guard.js';

ensureNode(import.meta.filename);
ensureInstalled();

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('npm run dev [-- --reset] [-- --only participant|admin|setup] [-- --open]');
  process.exit(0);
}
const flag = (name) => args.includes(`--${name}`);
const only = (() => {
  const at = args.indexOf('--only');
  return at >= 0 ? String(args[at + 1] ?? '').split(',').filter(Boolean) : null;
})();

const PAGES = [
  { key: 'participant', label: 'Participant', config: 'migration/vite.config.ts', env: 'VITE_PORT', port: 5173, path: '/' },
  { key: 'admin', label: 'Admin', config: 'migration/vite.admin.config.ts', env: 'VITE_ADMIN_PORT', port: 5175, path: '/admin.html' },
  { key: 'setup', label: 'Setup', config: 'migration/vite.setup.config.ts', env: 'VITE_SETUP_PORT', port: 5176, path: '/setup.html' },
].filter((page) => !only || only.includes(page.key)).map((page) => ({ ...page, port: Number(process.env[page.env]) || page.port }));
if (!PAGES.length) {
  console.error('  --only takes participant, admin or setup (or a comma-separated list).');
  process.exit(1);
}
const API_PORT = Number(process.env.PORT) || 3000;

// ---- The dummy database -------------------------------------------------------------------------------------------------------------
const LOCAL = path.join(ROOT, '.local-data');
const userChoseData = Boolean(process.env.DATA_DIR);
const dataDir = userChoseData ? path.resolve(process.env.DATA_DIR) : path.join(LOCAL, 'data');
const uploadDir = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(LOCAL, 'uploads');

if (!userChoseData) {
  if (flag('reset')) rmSync(LOCAL, { recursive: true, force: true });
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
    for (const file of readdirSync(path.join(ROOT, 'server', 'data')).filter((name) => name.endsWith('.json'))) {
      cpSync(path.join(ROOT, 'server', 'data', file), path.join(dataDir, file));
    }
    mkdirSync(uploadDir, { recursive: true });
    const seedPictures = path.join(ROOT, 'public', 'assets', 'images', 'clients');
    if (existsSync(seedPictures)) cpSync(seedPictures, uploadDir, { recursive: true });
    console.log(`  Made a fresh dummy database in ${path.relative(ROOT, LOCAL)}/ (a copy of server/data).`);
  }
}

// ---- Ports --------------------------------------------------------------------------------------------------------------------------
const isFree = (port) => new Promise((resolve) => {
  const probe = net.createServer();
  probe.once('error', () => resolve(false));
  probe.once('listening', () => probe.close(() => resolve(true)));
  probe.listen(port);
});
const wanted = [{ name: 'the server', port: API_PORT, env: 'PORT' }, ...PAGES.map((page) => ({ name: `the ${page.key} page`, port: page.port, env: page.env }))];
const busy = [];
for (const item of wanted) if (!(await isFree(item.port))) busy.push(item);
if (busy.length) {
  console.error('\n  These ports are already in use, probably by an earlier `npm run dev` that is still open:');
  for (const item of busy) console.error(`    ${item.port}  (${item.name}; to move it: set ${item.env}=<another port>)`);
  console.error('  Close that window (Ctrl+C in it), or use other ports, and run this again.\n');
  process.exit(1);
}

// ---- Start everything ---------------------------------------------------------------------------------------------------------------
const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const env = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CEC_DEV_API_TARGET: `http://localhost:${API_PORT}`, PORT: String(API_PORT) };
const children = [];
const ready = new Map(); // label -> the address Vite printed as "Network", if any
let summaryShown = false;
let stopping = false;

const QUIET = /^\s*(➜|VITE v|press h|pursuits-cec API running|api:|data:|pages:|LAN:|\(!\)|\d+:\d+:\d+ [AP]M \[vite\] \(client\) (Forced re-optimization|Re-optimizing))/i;

function start(label, scriptArgs, extraEnv = {}) {
  const child = spawn(process.execPath, scriptArgs, { cwd: ROOT, env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const onData = (chunk) => {
    for (const raw of String(chunk).split(/\r?\n/)) {
      const line = raw.replace(/\x1b\[[0-9;]*m/g, '');
      if (!line.trim()) continue;
      if (/API running|Local:/.test(line) && !ready.has(label)) {
        ready.set(label, null);
        maybeSummary();
      }
      const network = line.match(/Network:\s+(http\S+)/);
      if (network) ready.set(label, network[1]);
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

function lanAddress() {
  return Object.values(os.networkInterfaces()).flat().find((net_) => net_?.family === 'IPv4' && !net_.internal)?.address ?? null;
}

function maybeSummary() {
  if (summaryShown || ready.size < PAGES.length + 1) return;
  summaryShown = true;
  const lan = lanAddress();
  const line = (name, url) => console.log(`  ${name.padEnd(13)}${url}`);
  console.log('\n  Pursuit Managed Services: running locally with dummy data\n');
  for (const page of PAGES) line(page.label, `http://localhost:${page.port}${page.path}`);
  if (lan) line('iPad / phone', `http://${lan}:${PAGES[0].port}${PAGES[0].path}   (same Wi-Fi; the admin page is the same address with its port)`);
  line('Server (API)', `http://localhost:${API_PORT}/api`);
  console.log(`\n  Demo admin PIN: 1234        Dummy data: ${userChoseData ? dataDir : path.relative(ROOT, dataDir) + '/'}   (start again with: npm run dev -- --reset)`);
  console.log('  Change a file and the page reloads by itself.  Stop everything with Ctrl+C.\n');
  if (flag('open')) openInBrowser(PAGES.filter((page) => page.key !== 'setup').map((page) => `http://localhost:${page.port}${page.path}`));
}

function openInBrowser(urls) {
  for (const url of urls) {
    const [command, commandArgs] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    spawn(command, commandArgs, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  }
}

function stop(code = 0) {
  stopping = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 400);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

start('server', ['--watch', 'server/index.js'], { DATA_DIR: dataDir, UPLOAD_DIR: uploadDir });
for (const page of PAGES) start(page.key, [viteBin, '--config', page.config], { [page.env]: String(page.port) });
