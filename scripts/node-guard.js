// The Node check that runs before `npm run dev`, `npm run build` and `npm run doctor`.
//
// Vite 8 (and this project) need Node 22.12 or later. A machine whose default Node is older (the Windows development laptop has 20.13) used
// to fail inside Vite with an error about `crypto.hash` that says nothing about the cause. This file says it in plain words instead, and,
// where Node 22 is kept inside the project (`.local/node22`), starts the script again with it, so the command just works.
//
// Used by scripts/dev.js, scripts/build.js and scripts/doctor.js. It prints, it never installs anything.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const ROOT = path.join(import.meta.dirname, '..');
export const MIN = { major: 22, minor: 12 };

/** Is this "major.minor.patch" string new enough? */
export function nodeIsNewEnough(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  return major > MIN.major || (major === MIN.major && minor >= MIN.minor);
}

/** The Node 22 kept in the project, if there is one: .local/node22/node.exe (Windows) or .local/node22/bin/node. */
function projectNode() {
  for (const candidate of [path.join(ROOT, '.local', 'node22', 'node.exe'), path.join(ROOT, '.local', 'node22', 'bin', 'node')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function explain() {
  const windows = process.platform === 'win32';
  return [
    '',
    `  This project needs Node ${MIN.major}.${MIN.minor} or newer. This computer is using Node ${process.versions.node}.`,
    '  (Vite 8, which builds the pages, will not start on an older Node.)',
    '',
    '  Fix, once:',
    windows
      ? '    winget install OpenJS.NodeJS.LTS        (or install "nvm-windows", then: nvm install 22 && nvm use 22)'
      : '    nvm install && nvm use                  (reads .nvmrc; or install Node 22 LTS from nodejs.org)',
    '  Then close this window, open a new one, and check:  node -v   (it must say v22.12 or higher)',
    '  Then, in the project folder:  npm ci   and run this command again.',
    '',
  ].join('\n');
}

/**
 * Call first thing in a script, with that script's own path (import.meta.filename). Returns when this Node is fine. When it is too
 * old: starts the same script with the project's own Node 22 if there is one (and exits with its status), otherwise explains and exits 1.
 */
export function ensureNode(scriptPath) {
  if (nodeIsNewEnough()) return;
  const own = projectNode();
  if (own && !process.env.PMS_NODE_REEXEC) {
    console.log(`Node ${process.versions.node} is too old here; using ${path.relative(ROOT, own)} instead.\n`);
    const run = spawnSync(own, [scriptPath, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, PMS_NODE_REEXEC: '1' } });
    process.exit(run.status ?? 1);
  }
  console.error(explain());
  process.exit(1);
}

/** The packages are installed (Vite is the one every command needs). Exits with the fix when they are not. */
export function ensureInstalled() {
  if (existsSync(path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'))) return;
  console.error('\n  The packages are not installed here (or the install was cut short).\n  Run, in the project folder:  npm ci\n  (Do not copy node_modules from another computer: it holds files for that computer only.)\n');
  process.exit(1);
}
