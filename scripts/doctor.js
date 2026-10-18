// `npm run doctor`: checks this computer for what the project needs, and says what to do about each thing that is missing.
// Read-only: it installs and changes nothing. Use it first on a computer the project was just moved to.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { ensureNode, MIN, nodeIsNewEnough, ROOT } from './node-guard.js';

// Not ensureNode() in every case: the doctor must explain an old Node, not hide it by switching to another one.
if (!nodeIsNewEnough() && existsSync(path.join(ROOT, '.local', 'node22'))) ensureNode(import.meta.filename);

const results = [];
const add = (ok, name, detail, fix) => results.push({ ok, name, detail, fix });
const tryRun = (command, commandArgs) => {
  try { return execFileSync(command, commandArgs, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32' }).trim(); } catch { return null; }
};

add(nodeIsNewEnough(), `Node ${process.versions.node}`, `needs ${MIN.major}.${MIN.minor} or newer`, 'Install Node 22 LTS: winget install OpenJS.NodeJS.LTS  (or nvm install 22), then open a new window.');
const npm = tryRun('npm', ['-v']);
add(Boolean(npm), `npm ${npm ?? 'not found'}`, 'comes with Node', 'Reinstall Node 22 LTS from nodejs.org.');

const lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')).packages;
const wantVite = lock['node_modules/vite']?.version;
const haveVite = existsSync(path.join(ROOT, 'node_modules', 'vite', 'package.json')) ? JSON.parse(readFileSync(path.join(ROOT, 'node_modules', 'vite', 'package.json'), 'utf8')).version : null;
add(haveVite === wantVite, `Vite ${haveVite ?? 'not installed'}`, `the lock file wants ${wantVite}`, 'Run npm ci in the project folder. If node_modules came from another computer, delete the folder first: it holds files for that computer only.');

const bundler = haveVite && existsSync(path.join(ROOT, 'node_modules', 'rolldown', 'package.json'));
add(Boolean(bundler) || !haveVite, 'Vite\'s bundler present', 'rolldown', 'Run npm ci again; the install was cut short.');

add(Boolean(tryRun('git', ['--version'])), 'git', 'needed for the build id and for package:release', 'Install Git for Windows (winget install Git.Git).');
add(existsSync(path.join(ROOT, 'server', 'data', 'sessions.json')), 'dummy-data seed (server/data)', 'npm run dev copies it to .local-data/', 'Restore server/data from git: git checkout -- server/data');

for (const [name, port] of [['server', Number(process.env.PORT) || 3000], ['participant page', 5173], ['admin page', 5175], ['setup page', 5176]]) {
  const free = await new Promise((resolve) => { const probe = net.createServer(); probe.once('error', () => resolve(false)); probe.once('listening', () => probe.close(() => resolve(true))); probe.listen(port); });
  add(free, `port ${port} free (${name})`, 'for npm run dev', 'Something is already using it (an earlier npm run dev?). Close it, or set PORT / VITE_PORT / VITE_ADMIN_PORT / VITE_SETUP_PORT.');
}

const playwright = tryRun(process.execPath, ['node_modules/playwright/cli.js', '--version']);
add(true, `Playwright ${playwright ?? 'not installed'}`, 'only for the browser tests (npm run test:migration)', 'Only if you run those: node node_modules/playwright/cli.js install chromium webkit');
add(true, `python3 ${tryRun('python3', ['--version']) ?? tryRun('python', ['--version']) ?? 'not found'}`, 'only to regenerate the embedded fonts (npm run build:report-fonts)', 'Only if you regenerate fonts: install Python 3 and pip install fonttools brotli');

let bad = 0;
console.log('');
for (const result of results) {
  console.log(`  ${result.ok ? 'OK ' : 'FIX'}  ${result.name}   (${result.detail})`);
  if (!result.ok) { bad += 1; console.log(`       -> ${result.fix}`); }
}
console.log(bad ? `\n  ${bad} thing(s) to fix before npm run dev / npm run build will work.\n` : '\n  All good: npm run dev to try it, npm run build to make the files to upload.\n');
process.exit(bad ? 1 : 0);
