// `npm run doctor`: checks this computer for what the project needs, and says what to do about each thing that is missing.
// Read-only: it installs and changes nothing. Use it first on a computer the project was just moved to.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isPortFree, output, portFor, PORTS } from './local-env.js';
import { ensureNode, MIN, nodeIsNewEnough, ROOT } from './node-guard.js';

// The doctor must explain an old Node, not hide it: it switches to the project's own Node 22 only when one is there to switch to.
if (!nodeIsNewEnough() && existsSync(path.join(ROOT, '.local', 'node22'))) ensureNode(import.meta.filename);

const readJson = (...parts) => JSON.parse(readFileSync(path.join(ROOT, ...parts), 'utf8'));
const check = (ok, name, detail, fix) => ({ ok, name, detail, fix });

/** Everything that needs no slow command. */
function installChecks() {
  const lockedVite = readJson('package-lock.json').packages['node_modules/vite']?.version;
  const vitePackage = path.join(ROOT, 'node_modules', 'vite', 'package.json');
  const haveVite = existsSync(vitePackage) ? readJson('node_modules', 'vite', 'package.json').version : null;
  return [
    check(nodeIsNewEnough(), `Node ${process.versions.node}`, `needs ${MIN.major}.${MIN.minor} or newer`, 'Install Node 22 LTS: winget install OpenJS.NodeJS.LTS  (or nvm install 22), then open a new window.'),
    check(haveVite === lockedVite, `Vite ${haveVite ?? 'not installed'}`, `the lock file wants ${lockedVite}`, 'Run npm ci in the project folder. If node_modules came from another computer, delete the folder first: it holds files for that computer only.'),
    check(!haveVite || existsSync(path.join(ROOT, 'node_modules', 'rolldown', 'package.json')), "Vite's bundler present", 'rolldown', 'Run npm ci again; the install was cut short.'),
    check(existsSync(path.join(ROOT, 'server', 'data', 'sessions.json')), 'dummy-data seed (server/data)', 'npm run dev copies it to .local-data/', 'Restore server/data from git: git checkout -- server/data'),
  ];
}

/** The checks that run a program or open a port: all started together, so the slowest one sets the time. */
async function systemChecks() {
  const [npm, git, playwright, python] = await Promise.all([
    output('npm', ['-v']),
    output('git', ['--version']),
    output(process.execPath, ['node_modules/playwright/cli.js', '--version']),
    output('python3', ['--version']).then((found) => found ?? output('python', ['--version'])),
  ]);
  const ports = await Promise.all(Object.entries(PORTS).map(async ([key]) => ({ key, port: portFor(key), free: await isPortFree(portFor(key)) })));
  return [
    check(Boolean(npm), `npm ${npm ?? 'not found'}`, 'comes with Node', 'Reinstall Node 22 LTS from nodejs.org.'),
    check(Boolean(git), 'git', 'needed for the build id and for package:release', 'Install Git for Windows (winget install Git.Git).'),
    ...ports.map(({ key, port, free }) => check(free, `port ${port} free (${key === 'server' ? 'server' : `${key} page`})`, 'for npm run dev', `Something is already using it (an earlier npm run dev?). Close it, or set ${PORTS[key].env}.`)),
    check(true, `Playwright ${playwright ?? 'not installed'}`, 'only for the browser tests (npm run test:migration)', 'Only if you run those: node node_modules/playwright/cli.js install chromium webkit'),
    check(true, `python3 ${python ?? 'not found'}`, 'only to regenerate the embedded fonts (npm run build:report-fonts)', 'Only if you regenerate fonts: install Python 3 and pip install fonttools brotli'),
  ];
}

const results = [...installChecks(), ...(await systemChecks())];
const bad = results.filter((result) => !result.ok);
console.log('');
for (const result of results) {
  console.log(`  ${result.ok ? 'OK ' : 'FIX'}  ${result.name}   (${result.detail})`);
  if (!result.ok) console.log(`       -> ${result.fix}`);
}
console.log(bad.length ? `\n  ${bad.length} thing(s) to fix before npm run dev / npm run build will work.\n` : '\n  All good: npm run dev to try it, npm run build to make the files to upload.\n');
process.exit(bad.length ? 1 : 0);
